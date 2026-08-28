import { randomUUID } from 'node:crypto'
import { realpathSync } from 'node:fs'
import { access, appendFile, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { load as loadYaml, dump as dumpYaml } from 'js-yaml'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'
import type { Context } from '@deepseek-ai/cordis'
import {
  ImageProviderError,
  type ImageEditSpec,
  type ImageGenerateSpec,
} from '@mackwan84/dsh-image'
import {
  DEFAULT_PREFS,
  PrefsSchema,
  clampCount,
  clampPage,
  clampPageSize,
  filterHistory,
  parseHistoryLine,
  sanitizeAnchorFileName,
  type HistoryEntry,
  type MockupPrefs,
} from './prefs.js'
import { buildPrompt } from './prompt.js'

export const name = 'ui-mockup'

/** 硬依赖：工具注册与使用规则注入是本插件的全部职责，等待这些服务出现。 */
export const inject = ['tools', 'systemPrompt']

/**
 * 工具注册表的结构面：裸 JSON-Schema ToolDefinition 直接 register（与 MCP 工具同路径）。
 * 本包不依赖 @deepseek-ai/dsh-tools（其发布的 rc 版本引用了未发布的 @deepseek-ai/dsh-type-meta），
 * 以最小的结构类型保持接口兼容。
 */
interface ToolsFace {
  register(definition: ToolDefinition): () => void
}

interface ToolDefinition {
  name: string
  description: string
  parameters: Record<string, unknown>
  output: {
    schema: Record<string, unknown>
    render(args: unknown, value: unknown): ContentBlock[]
  }
  execute(args: Record<string, unknown>, exec: ToolExecFace): Promise<MockupValue>
  timeoutMs?: number
  isConcurrencySafe?(): boolean
  presentResult?(args: unknown, result: { content: readonly ContentBlock[] }): unknown
}

type ContentBlock =
  | { type: 'text'; text: string }
  | {
      type: 'image'
      attachment: {
        attachmentId: string
        mediaType: string
        bytes: number
        width: number
        height: number
        name?: string
      }
    }

/** systemPrompt 服务的结构面（仅注入一节使用规则）。 */
interface SystemPromptFace {
  section(section: { name: string; order: number; text: string }): () => void
}

/** attachments 服务的结构面（本包只保存生成图）。 */
interface AttachmentsFace {
  imageLimits?: { maxImageBytes: number }
  saveImage(input: { data: Uint8Array; mediaType: string; name?: string }): Promise<{
    attachmentId: string
    mediaType: string
    bytes: number
    width: number
    height: number
    name?: string
  }>
}

/** 工具执行上下文的结构面（本包只读取消信号与会话）。 */
interface ToolExecFace {
  signal: AbortSignal
  agent?: { session: SessionFace }
}

/** 会话的结构面（本包只读工作区根目录 cwd）。 */
interface SessionFace {
  header: { cwd?: string }
}

/** sandboxPolicy 服务的结构面（按会话解析工作区根目录）。 */
interface SandboxPolicyFace {
  workspaceRoot: string
  resolve(request?: { session?: SessionFace }): { workspaceRoot: string }
}

/** webServer 服务的结构面（本包只注册图片前缀路由）。 */
interface WebServerFace {
  register(route: {
    kind: 'exact' | 'prefix'
    path: string
    handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>
  }): () => void
}

/** sessions 服务的结构面（路由 cwd 白名单只读已知会话的 cwd）。 */
interface SessionsFace {
  list(): Array<{ header: { cwd?: string } }>
}

/**
 * 凭据 seam 的结构面（对齐 CredentialProvider 的四操作抽象）：
 * resolve 取值、describe 给 UI 的安全视图（永不回值）、set/unset 落
 * provider 自管存储（~/.dsh/.credentials.yaml）。只读层（进程环境变量）
 * 遮蔽时 set/unset 由 provider 拒绝，本包原样透传错误。
 */
interface CredentialsFace {
  resolve(ref: ReturnType<typeof credentialRef>): Promise<{ value: string } | undefined>
  describe(ref: ReturnType<typeof credentialRef>): Promise<{
    configured: boolean
    source?: string
    writable: boolean
  }>
  set(ref: ReturnType<typeof credentialRef>, value: string): Promise<void>
  unset(ref: ReturnType<typeof credentialRef>): Promise<void>
}

/** 面板用的凭据状态：只有 configured/source/writable 三个事实，永不携带值。 */
interface CredentialStatus {
  configured: boolean
  source?: string
  writable: boolean
}

/**
 * settings 服务的结构面：注册偏好命名空间并读回 resolved 值。
 * 纯内存/远程浏览器等存储不可写场景下服务可能缺席或拒绝写入，
 * 本包按可选服务处理：缺席时全部偏好退化为 cordis.yml 配置层。
 */
interface SettingsFace {
  register(
    ns: string,
    schema: unknown,
    options?: { base?: Partial<MockupPrefs> },
  ): { get(): MockupPrefs }
}

/** connection 服务的结构面（本包只注册私有的设置面板数据通道）。 */
interface ConnectionFace {
  rpc: {
    handle(
      channel: string,
      handler: (
        endpoint: string,
        payload: unknown,
        signal: AbortSignal,
      ) => Promise<RpcResultLike<unknown>>,
      options: { authority: 'trusted-host' | 'loopback' },
    ): () => void
  }
}

/** 与 dsh-host-apiproxy 的 RpcResult 同构的最小形状（避免宿主半区引入该依赖）。 */
export type RpcResultLike<T> =
  | { ok: true; value: T }
  | { ok: false; error: { code: string; message: string; details?: Record<string, unknown> } }

/** 成功结果包装。 */
function rpcOk<T>(value: T): RpcResultLike<T> {
  return { ok: true, value }
}

/** 失败结果包装：错误码与提供方 resolver 语义保持一致风格。 */
function rpcError(code: string, message: string): RpcResultLike<never> {
  return { ok: false, error: { code, message } }
}

interface ImageEntry {
  path: string
  name: string
  width: number
  height: number
  attachmentId: string
  mediaType: string
  bytes: number
}

interface MockupValue {
  ok: boolean
  message: string
  images?: ImageEntry[]
}

const USAGE_SECTION = {
  name: 'ui-mockup-usage',
  order: 500,
  text: [
    '# 界面草图工具使用规则',
    '',
    '工具 ui_mockup 用于在讨论阶段生成界面草图或高保真设计稿, 让用户在开始写实现代码之前确认界面方向, 避免代码完成后才发现界面不符合预期。',
    '',
    '使用时机:',
    '- 功能需求讨论基本明确、准备开始写前端实现代码之前, 主动提议生成草图确认, 不要直接开始写代码。',
    '- 用户提到界面、页面、UI、视觉风格时, 主动询问是否需要生成草图。',
    "- 布局与信息架构待确认: fidelity='wireframe'(面板分层默认里的线框图模型, 速度快)。",
    "- 视觉风格待确认: fidelity='high-fidelity'(面板分层默认里的高保真模型, 质量优先), 建议 count=2~4 一次给多个方向供用户选择。",
    '- 同一个站点的多个页面在高保真阶段应传 reference=已确认页面的图, 保持风格一致(图生图模式)。',
    '- 用户对生成的图提出修改意见: 优先走编辑模式(同时传 baseImage=上一版生成图路径 与 editNote=修改指令, 只重绘要改的部分, 更快且更贴近原稿); 大改布局或换风格时才在 description 中写修改后的完整描述整体重新生成。',
    '- 编辑模式当前仅火山方舟 Provider 支持; 生效提供方为阿里云百炼时编辑调用会返回 NOT_IMPLEMENTED, 此时改用整体重新生成。',
    '- 模型分层默认由设置面板管理; 用户没有点名具体模型时不要传 model 参数, 否则会绕过面板配置(面板未配置时回落生效提供方的内置分层默认)。',
    '',
    '确认与锁定:',
    '- 生成后展示图片, 请用户反馈, 循环修改直到用户明确确认。',
    '- 用户确认某一版设计后: 把设计提炼为规格写入 design/spec.md, 内容包括配色、字体、间距、组件清单、页面清单; 该文件成为后续实现代码的依据。',
    '- design/spec.md 尚未生成或未获用户确认前, 不要开始编写前端实现代码。',
  ].join('\n'),
}

/** 插件 Config：设置命名空间的组合 base 层；未配置的字段取内置默认。 */
export interface MockupPluginConfig {
  defaultFidelity?: 'wireframe' | 'high-fidelity'
  defaultPlatform?: 'web' | 'mobile'
  defaultCount?: number
  /** 已由设计资产库接管，配置不再生效；保留仅为兼容旧用户层数据。 */
  outputDir?: string
  pollTimeoutMinutes?: number
  wireframeModel?: string
  highFidelityModel?: string
  defaultSize?: string
}

export const Config = PrefsSchema

/** 语义路径（agent / reference 兼容层，映射到资产库物理路径）。 */
const IMAGE_DIR = 'design/images'

import { homedir } from 'node:os'

/** 一个工作区的设计资产库物理布局（$DSH_HOME/mockups/<slug>/ 下）。 */
interface MockupStore {
  /** 工作区资产目录（绝对路径）。 */
  root: string
  /** 生成图目录（绝对路径）。 */
  imagesDir: string
  /** 锚点登记文件（绝对路径）。 */
  anchorFile: string
  /** 历史记录文件（绝对路径）。 */
  historyFile: string
}

/**
 * 工作区根 → slug：与 DSH sessions 目录同款转义——先补尾分隔符再做
 * 分隔符→`-` 替换并首尾包 `-`，例 /Users/l/x → --Users-l-x--
 * （首尾各两个 `-`：首来自前导空段+包裹，尾来自补的尾分隔符+包裹，
 * 与 ~/.dsh/sessions 的实测目录名一致）。
 */
function workspaceSlug(workspaceRoot: string): string {
  const withTrailing = workspaceRoot.endsWith('/') ? workspaceRoot : `${workspaceRoot}/`
  return `-${withTrailing.split(/[\\/]+/).join('-')}-`
}

/**
 * $DSH_HOME：与宿主 resolveDshHome 同口径——环境变量优先、默认 ~/.dsh；
 * 纯空白值视为未设置（避免把 home 解析成 cwd 下的怪目录），前导 ~ 展开为 home。
 */
function dshHome(): string {
  const fromEnv = process.env['DSH_HOME']
  if (fromEnv !== undefined && fromEnv.trim() !== '') {
    return resolve(fromEnv.startsWith('~') ? join(homedir(), fromEnv.slice(1)) : fromEnv)
  }
  return resolve(homedir(), '.dsh')
}

/**
 * 工作区的设计资产库：$DSH_HOME/mockups/<slug>/{images,anchor.json,history.jsonl}。
 * 项目工作区不再落任何运行时产物（spec.md 等交付物仍留项目内）。
 */
function storeOf(workspaceRoot: string): MockupStore {
  const root = resolve(dshHome(), 'mockups', workspaceSlug(workspaceRoot))
  return {
    root,
    imagesDir: resolve(root, 'images'),
    anchorFile: resolve(root, 'anchor.json'),
    historyFile: resolve(root, 'history.jsonl'),
  }
}

/**
 * 把语义 reference 翻译为可解析路径：
 * - `design/images/x.png` / `design/x.png`（agent 习惯写法）→ 资产库内绝对路径；
 * - 其余输入（如用户自备的 `assets/base.png`）按「相对工作区」原样返回，
 *   由 Provider 以 cwd 为根防逃逸。
 */
function translateReference(reference: string, workspaceRoot: string): string {
  const store = storeOf(workspaceRoot)
  if (reference === 'design' || reference === 'design/') return store.root
  if (reference.startsWith('design/images/')) {
    return resolve(store.imagesDir, reference.slice('design/images/'.length))
  }
  if (reference.startsWith('design/')) {
    return resolve(store.root, reference.slice('design/'.length))
  }
  return reference
}

/** 偏好生效值：settings 服务可用时以命名空间 resolved 值为准；
 * 缺席（纯内存部署）时退化为 cordis.yml 配置层覆盖内置默认。 */
export function effectivePrefs(
  scope: { get(): MockupPrefs } | undefined,
  config: MockupPluginConfig,
): MockupPrefs {
  if (scope !== undefined) return scope.get()
  const merged = { ...DEFAULT_PREFS }
  for (const [key, value] of Object.entries(config)) {
    if (value !== undefined) (merged as Record<string, unknown>)[key] = value
  }
  return merged
}

/**
 * 锚点登记是资产库里的一个两行 JSON 文件：只存「当前锚点文件名 + 时间」，
 * 不复制图片内容。读取即校验文件名合法且目标图仍存在，任一不满足视为无锚点
 * （清空历史、删图后残留的 anchor.json 自愈为空态）。
 */
async function readAnchor(workspaceRoot: string, requireExists = true): Promise<string | null> {
  const store = storeOf(workspaceRoot)
  let raw: string
  try {
    raw = await readFile(store.anchorFile, 'utf8')
  } catch {
    return null
  }
  let name: unknown
  try {
    name = (JSON.parse(raw) as Record<string, unknown>).file
  } catch {
    return null
  }
  const file = sanitizeAnchorFileName(name)
  if (file === null) return null
  if (!requireExists) return file
  try {
    await access(resolve(store.imagesDir, file))
    return file
  } catch {
    return null
  }
}

/**
 * 原子写：先写同目录临时文件再 rename（POSIX 原子），避免并发写或进程
 * 中断在 anchor.json / history.jsonl 上留下半截 JSON。
 */
async function writeFileAtomic(path: string, content: string): Promise<void> {
  const tmp = `${path}.tmp-${process.pid}-${randomUUID().slice(0, 8)}`
  await writeFile(tmp, content)
  await rename(tmp, path)
}

async function writeAnchor(workspaceRoot: string, fileName: string): Promise<void> {
  const store = storeOf(workspaceRoot)
  await mkdir(store.root, { recursive: true })
  await writeFileAtomic(
    store.anchorFile,
    `${JSON.stringify({ file: fileName, time: new Date().toISOString() })}\n`,
  )
}

/** 清除锚点：文件不存在也算清除成功（幂等）。 */
async function clearAnchor(workspaceRoot: string): Promise<void> {
  await rm(storeOf(workspaceRoot).anchorFile, { force: true })
}

/** 读取并解析历史文件；目录不存在按空历史处理。 */
async function readHistory(workspaceRoot: string): Promise<HistoryEntry[]> {
  let raw: string
  try {
    raw = await readFile(storeOf(workspaceRoot).historyFile, 'utf8')
  } catch {
    return []
  }
  return raw
    .split('\n')
    .map(parseHistoryLine)
    .filter((entry): entry is HistoryEntry => entry !== null)
    .reverse()
}

/**
 * 当前生效提供方：读 image 槽位的 providerId（唯一事实源，不从偏好/组合文件推断）。
 * 服务未挂载时 id 为 unknown、凭据名回退 DashScope（安装面默认提供方）。
 */
function activeProviderOf(ctx: Context): { id: string; credential: string } {
  const service = ctx.get('image') as ImageGenerationServiceFace | undefined
  const id = service?.providerId ?? 'unknown'
  const fallback = PROBES.dashscope.defaultCredential
  const credential =
    id === 'volcengine' || id === 'dashscope'
      ? (readProviderConfigString(service, 'apiKey') ?? PROBES[id].defaultCredential)
      : fallback
  return { id, credential }
}

/**
 * 面板用的凭据状态：credentials 服务在场时走 describe（拿到来源层与可写性），
 * 缺席时退化为启动环境探测（configured + 来源 ambient + 不可写）。
 * 返回值永不携带密钥本身。
 */
async function credentialStatus(ctx: Context, credentialName: string): Promise<CredentialStatus> {
  const ref = credentialRef(credentialName)
  const credentials = ctx.get('credentials') as CredentialsFace | undefined
  if (credentials !== undefined) {
    const info = await credentials.describe(ref).catch(() => undefined)
    if (info !== undefined) {
      return { configured: info.configured, source: info.source, writable: info.writable }
    }
  }
  // 与 Provider 相同的启动环境回退（.env / 进程环境），保证面板口径与实际生成一致
  const ambient = launchEnvironmentOf(ctx).get(ref)
  return {
    configured: ambient !== undefined && ambient.value.length > 0,
    source: 'ambient',
    writable: false,
  }
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

/** 按魔数嗅探图片真实类型：OSS 签名 URL 常以 application/octet-stream 返回生成图，content-type 不可信。 */
function detectMediaType(buffer: Buffer): string | undefined {
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(PNG_SIGNATURE)) return 'image/png'
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff)
    return 'image/jpeg'
  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString('latin1') === 'RIFF' &&
    buffer.subarray(8, 12).toString('latin1') === 'WEBP'
  )
    return 'image/webp'
  if (buffer.length >= 6) {
    const head = buffer.subarray(0, 6).toString('latin1')
    if (head === 'GIF87a' || head === 'GIF89a') return 'image/gif'
  }
  return undefined
}

/** 把 HTTP 媒体类型归一化为图片附件允许的媒体类型，未知时回退 PNG。 */
function toMediaType(contentType: string | null): string {
  if (contentType === null) return 'image/png'
  const type = contentType.split(';')[0]!.trim().toLowerCase()
  return ['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(type) ? type : 'image/png'
}

function extensionFor(mediaType: string): string {
  return mediaType === 'image/jpeg'
    ? 'jpg'
    : mediaType === 'image/webp'
      ? 'webp'
      : mediaType === 'image/gif'
        ? 'gif'
        : 'png'
}

/** 按生成图文件名扩展名推断 HTTP 媒体类型（图片路由响应头）。 */
function mediaTypeForExtension(name: string): string {
  if (name.endsWith('.jpg') || name.endsWith('.jpeg')) return 'image/jpeg'
  if (name.endsWith('.webp')) return 'image/webp'
  if (name.endsWith('.gif')) return 'image/gif'
  return 'image/png'
}

/**
 * canonical 化工作区根：realpath 解析符号链接（与宿主 sandboxPolicy 的
 * resolveWorkspaceRoot 同语义），路径暂不可达时回退词法 resolve。
 * 会话 cwd 含符号链接时（如 macOS /tmp → /private/tmp），落盘根与路由
 * 读取根必须经过同一规范化，否则卡片按原始 cwd 请求会 404。
 */
function canonicalRoot(path: string): string {
  try {
    return realpathSync.native(path)
  } catch {
    return resolve(path)
  }
}

/**
 * 路由 cwd 的信任源全集：本插件登记过的工作区根、宿主已知会话的 cwd、
 * 宿主进程级 fallback。webServer 是进程级端口，本机任意网页都能发起请求，
 * 未经验证的 cwd 等于开放任意目录的 design/images 读取。
 */
function allowedRoots(ctx: Context, known: ReadonlySet<string>): Set<string> {
  const roots = new Set(known)
  const sessions = ctx.get('sessions') as SessionsFace | undefined
  if (sessions !== undefined) {
    for (const session of sessions.list()) {
      const cwd = session.header.cwd
      if (cwd !== undefined && cwd !== '') roots.add(canonicalRoot(cwd))
    }
  }
  const policy = ctx.get('sandboxPolicy') as SandboxPolicyFace | undefined
  if (policy !== undefined) roots.add(canonicalRoot(policy.workspaceRoot))
  return roots
}

export function apply(ctx: Context, config: MockupPluginConfig = {}) {
  const tools = ctx.get('tools') as ToolsFace
  // 本插件进程内已生成过图片的工作区根（canonical）：图片路由 cwd 白名单的信任源之一
  const knownRoots = new Set<string>()
  /**
   * 偏好命名空间：settings 是晚就绪的宿主平面服务（与 webServer/connection 同类），
   * apply 瞬间 ctx.get 可能拿到 undefined 而永久错过注册——面板写入会存进设置文档
   * 但 execute 永远读不到。改用 ctx.inject 等服务就绪后再注册；服务缺席（纯内存
   * 部署）时保持 undefined，各调用点退化为 config + 内置默认，面板只读不可写。
   * effect 挂 inject 回调的 scope：服务重载时命名空间随 scope 销毁重建，引用同步复位。
   */
  let prefsScope: { get(): MockupPrefs } | undefined
  ctx.inject(['settings'], (scope) => {
    const settings = scope.get('settings') as SettingsFace
    scope.effect(() => {
      prefsScope = settings.register('ui-mockup', PrefsSchema, { base: config })
      return () => {
        prefsScope = undefined
      }
    }, 'ui-mockup: preferences namespace')
  })
  ctx.effect(() =>
    tools.register({
      name: 'ui_mockup',
      description:
        '调用外部图像生成接口, 为界面/页面生成线框图(wireframe)或高保真(high-fidelity)设计草图, 供用户在编写实现代码之前确认界面方向。图片显示在对话中并保存到 DSH 设计资产库($DSH_HOME/mockups/<工作区>/images/)。用户需要修改时, 用修改后的完整描述再次调用。模型分层默认由设置面板「提供方与模型」管理(未配置时回落生效提供方的内置分层默认); 用户未点名模型时不要传 model 参数, 以免绕过面板配置。传 reference 参数可用已确认的图作为风格基准(图生图), 保持多页面风格一致。接口限流时自动退避重试。需要生效提供方的凭据(阿里云百炼 DASHSCOPE_API_KEY 或火山方舟 ARK_API_KEY, 取决于面板生效提供方, 通过凭据服务或环境变量提供)。',
      parameters: {
        type: 'object',
        properties: {
          description: {
            type: 'string',
            description: '界面/页面的完整描述, 包括布局、区块、内容与功能。',
          },
          fidelity: {
            type: 'string',
            enum: ['wireframe', 'high-fidelity'],
            description:
              '草图精度, 由用户选择: wireframe=黑白线框图(确认布局与信息架构); high-fidelity=高保真设计稿(确认视觉风格)。',
          },
          platform: {
            type: 'string',
            enum: ['web', 'mobile'],
            default: 'web',
            description: '目标平台, 决定画幅方向。',
          },
          style: {
            type: 'string',
            description:
              '视觉风格描述(仅 high-fidelity 时使用), 例如"极简浅色"、"深色科技感"、"温暖电商风"。',
          },
          count: {
            type: 'integer',
            description:
              '一次生成的方案数量(1-4)。风格探索时建议 2-4, 让用户挑选方向; 未指定时取设置面板的「一次生成数量」偏好。',
          },
          model: {
            type: 'string',
            description:
              '可选: 显式覆盖模型。默认取设置面板「提供方与模型」的分层默认(未配置时回落生效提供方的内置分层默认)。用户未点名具体模型时请省略本参数, 否则会绕过面板配置。',
          },
          size: {
            type: 'string',
            description: '可选: 覆盖默认画幅, 如 "1024*1024"、"1280*720"、"720*1280"。',
          },
          reference: {
            type: 'string',
            description:
              '可选: 参考图路径(相对工作区), 图生图模式用它保持风格一致, 例如 design/images/mockup-xxx.png。',
          },
          baseImage: {
            type: 'string',
            description:
              '可选: 待编辑的基准图路径(相对工作区, 生成图可写 design/images/mockup-xxx.png)。与 editNote 成对出现时走指令编辑(整图重绘), 此时忽略 description 之外的生成参数。',
          },
          editNote: {
            type: 'string',
            description:
              '可选: 编辑指令, 描述在基准图上改什么(如"把主按钮改成绿色并加大间距")。与 baseImage 成对出现。',
          },
        },
        required: ['description', 'fidelity'],
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            ok: { type: 'boolean', description: '本次调用是否成功。' },
            message: { type: 'string', description: '面向用户的说明或错误信息。' },
            images: {
              type: 'array',
              description: '生成图片列表（含会话附件引用与文件路径）。',
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  path: { type: 'string' },
                  name: { type: 'string' },
                  width: { type: 'number' },
                  height: { type: 'number' },
                  attachmentId: { type: 'string' },
                  mediaType: { type: 'string' },
                  bytes: { type: 'number' },
                },
              },
            },
          },
        },
        render(_args, value): ContentBlock[] {
          const blocks: ContentBlock[] = []
          const result = value as MockupValue
          if (result.images !== undefined) {
            for (const image of result.images) {
              // 未入附件（超限/无附件服务）的条目没有可解析的引用，跳过图片块，路径已在文本中给出
              if (image.attachmentId === '') continue
              blocks.push({
                type: 'image',
                attachment: {
                  attachmentId: image.attachmentId,
                  mediaType: image.mediaType,
                  bytes: image.bytes,
                  width: image.width,
                  height: image.height,
                  name: image.name,
                },
              })
            }
          }
          blocks.push({ type: 'text', text: result.message })
          return blocks
        },
      },
      async execute(args, exec): Promise<MockupValue> {
        try {
          if (typeof args.description !== 'string' || args.description.trim() === '') {
            return { ok: false, message: '缺少 description 参数: 请描述要生成的界面内容。' }
          }
          const fidelity = args.fidelity as 'wireframe' | 'high-fidelity'
          if (fidelity !== 'wireframe' && fidelity !== 'high-fidelity') {
            return {
              ok: false,
              message: 'fidelity 必须是 "wireframe"(线框图) 或 "high-fidelity"(高保真)。',
            }
          }
          const platform =
            args.platform === 'mobile' || args.platform === 'web'
              ? args.platform
              : effectivePrefs(prefsScope, config).defaultPlatform
          let reference =
            typeof args.reference === 'string' && args.reference.trim() !== ''
              ? args.reference.trim()
              : undefined
          const sandboxPolicy = ctx.get('sandboxPolicy') as SandboxPolicyFace | undefined
          const session = exec.agent?.session
          // 会话工作区优先（sandboxPolicy.resolve 会取 session.header.cwd），
          // 退化为会话 cwd、进程级 fallback，避免图片落到宿主进程 CWD。
          // 统一 canonical 化：sandboxPolicy 返回值本身已 canonical，但 fallback
          // 分支的 header.cwd 未规范化；同时与路由白名单的比对口径保持一致。
          const workspaceRoot = canonicalRoot(
            sandboxPolicy?.resolve(session === undefined ? {} : { session })?.workspaceRoot ??
              session?.header.cwd ??
              '.',
          )
          const prefs = effectivePrefs(prefsScope, config)
          // 编辑模式：baseImage + editNote 成对出现时走指令编辑（整图重绘）。
          // 单独出现是模型常见的半截调用，显式拒绝并说明，避免静默降级为生成。
          const baseImageArg =
            typeof args.baseImage === 'string' && args.baseImage.trim() !== ''
              ? args.baseImage.trim()
              : undefined
          const editNoteArg =
            typeof args.editNote === 'string' && args.editNote.trim() !== ''
              ? args.editNote.trim()
              : undefined
          if ((baseImageArg === undefined) !== (editNoteArg === undefined)) {
            return {
              ok: false,
              message:
                'baseImage 与 editNote 必须成对出现: 编辑已有图时同时传基准图路径与编辑指令。',
            }
          }
          const isEdit = baseImageArg !== undefined
          const effectiveModel =
            typeof args.model === 'string' && args.model.trim() !== ''
              ? args.model
              : (fidelity === 'high-fidelity' ? prefs.highFidelityModel : prefs.wireframeModel) ||
                undefined
          // 风格锚点联动：调用未显式传 reference 时自动引用当前锚点（I2I 保持多页风格一致）。
          // 参考图能力按生效提供方分流：dashscope 的参考图是 qwen-image 系端点边界（wan 系等
          // 模型跳过注入并说明，否则 Provider 必以 INVALID_PARAMETER 拒绝且用户难以归因）；
          // volcengine 的 seedream 系原生支持 image 参考图，锚点正常注入。
          // 模型为空串（交 Provider 自决）时仍注入：各提供方分层默认均支持参考图。
          let anchorInjected: string | null = null
          let anchorSkippedForModel: string | null = null
          // 编辑模式不注入锚点：基准图本身就是风格基准，再叠参考图会互相干扰
          if (reference === undefined && !isEdit) {
            const anchorFile = await readAnchor(workspaceRoot)
            if (anchorFile !== null) {
              const activeProviderId = (ctx.get('image') as ImageGenerationServiceFace | undefined)
                ?.providerId
              const referenceUnsupported =
                activeProviderId !== 'volcengine' &&
                effectiveModel !== undefined &&
                !effectiveModel.startsWith('qwen-image')
              if (referenceUnsupported) {
                anchorSkippedForModel = effectiveModel
              } else {
                anchorInjected = anchorFile
                reference = `${IMAGE_DIR}/${anchorFile}`
              }
            }
          }
          // reference 语义翻译：design/ 前缀(生成图/锚点)→资产库绝对路径, 其余(用户自备图)保持相对工作区。
          // cwd 随之分流：store 路径以 store 为根防逃逸, 相对路径仍以工作区为根。
          const translatedReference =
            reference === undefined ? undefined : translateReference(reference, workspaceRoot)
          const referenceInStore =
            translatedReference !== undefined && translatedReference !== reference
          const spec: ImageGenerateSpec = {
            prompt: buildPrompt(
              {
                description: args.description,
                fidelity,
                platform,
                style: typeof args.style === 'string' ? args.style : undefined,
              },
              reference !== undefined,
            ),
            fidelity,
            platform,
            style: typeof args.style === 'string' ? args.style : undefined,
            size:
              typeof args.size === 'string' && args.size.trim() !== ''
                ? args.size
                : prefs.defaultSize.trim() !== ''
                  ? prefs.defaultSize
                  : undefined,
            n: clampCount(args.count ?? prefs.defaultCount),
            model: effectiveModel,
            // 偏好层缺字段时避免 NaN 下传；缺省让 Provider 走自身配置
            ...(Number.isFinite(prefs.pollTimeoutMinutes) && prefs.pollTimeoutMinutes > 0
              ? { pollTimeoutMs: Math.round(prefs.pollTimeoutMinutes * 60_000) }
              : {}),
            reference: translatedReference,
            // 参考图解析根随语义分流: 资产库绝对路径以 store 为根, 其余以会话工作区为根
            cwd: referenceInStore ? storeOf(workspaceRoot).root : workspaceRoot,
          }

          const service = ctx.get('image') as ImageGenerationServiceFace | undefined
          if (service === undefined) {
            return {
              ok: false,
              message:
                '未挂载图像生成服务(image): 请安装 @mackwan84/dsh-image-dashscope 或 @mackwan84/dsh-image-volcengine 并加入组合。',
            }
          }
          const generated = isEdit
            ? await service.edit(
                {
                  prompt: editNoteArg ?? '',
                  // baseImage 与 reference 同语义：design/ 前缀(生成图/锚点)→资产库
                  // 绝对路径，其余保持相对工作区；cwd 随之分流防逃逸。
                  baseImage: translateReference(baseImageArg ?? '', workspaceRoot),
                  platform,
                  size: spec.size,
                  model: effectiveModel,
                  cwd: (baseImageArg ?? '').startsWith('design/')
                    ? storeOf(workspaceRoot).root
                    : workspaceRoot,
                },
                exec.signal,
              )
            : await service.generate(spec, exec.signal)

          const attachments = ctx.get('attachments') as AttachmentsFace | undefined
          const maxImageBytes = attachments?.imageLimits?.maxImageBytes
          const stamp = Date.now()
          const runId = randomUUID().slice(0, 8)
          const images: ImageEntry[] = []
          const failures: string[] = []
          let oversize = 0
          for (let i = 0; i < generated.images.length; i++) {
            const item = generated.images[i]!
            try {
              const res = await fetch(item.url, { signal: exec.signal })
              if (!res.ok) {
                failures.push(`第 ${i + 1} 张: HTTP ${res.status}`)
                continue
              }
              const buffer = Buffer.from(await res.arrayBuffer())
              const mediaType =
                detectMediaType(buffer) ?? toMediaType(res.headers.get('content-type'))
              // 文件名带随机段: 工具标记为可并发, 同毫秒完成的两次调用不应互相覆盖
              const fileName = `mockup-${stamp}-${runId}-${i + 1}.${extensionFor(mediaType)}`
              const store = storeOf(workspaceRoot)
              await mkdir(store.imagesDir, { recursive: true })
              await writeFile(resolve(store.imagesDir, fileName), buffer)
              // 模型可见路径写真实物理位置（资产库绝对路径），避免 agent 去工作区找不到
              const relPath = resolve(store.imagesDir, fileName)
              let entry: ImageEntry
              if (
                attachments !== undefined &&
                maxImageBytes !== undefined &&
                buffer.byteLength > maxImageBytes
              ) {
                // 超过会话附件上限: 图片仍落盘工作区, 但不进附件, 避免拖垮会话上下文
                oversize += 1
                entry = {
                  path: relPath,
                  name: fileName,
                  width: 0,
                  height: 0,
                  attachmentId: '',
                  mediaType,
                  bytes: buffer.byteLength,
                }
              } else if (attachments !== undefined) {
                const ref = await attachments.saveImage({
                  data: new Uint8Array(buffer),
                  mediaType,
                  name: fileName,
                })
                entry = {
                  path: relPath,
                  name: ref.name ?? fileName,
                  width: ref.width,
                  height: ref.height,
                  attachmentId: ref.attachmentId,
                  mediaType: ref.mediaType,
                  bytes: ref.bytes,
                }
              } else {
                entry = {
                  path: relPath,
                  name: fileName,
                  width: 0,
                  height: 0,
                  attachmentId: '',
                  mediaType,
                  bytes: buffer.byteLength,
                }
              }
              images.push(entry)
            } catch (error) {
              // 中途取消如实上抛; 单张下载失败不丢弃其余已消耗配额的图片
              if (exec.signal.aborted) throw error
              failures.push(
                `第 ${i + 1} 张: ${error instanceof Error ? error.message : String(error)}`,
              )
            }
          }
          if (images.length === 0) {
            return { ok: false, message: `生成成功但全部图片下载失败: ${failures.join('; ')}` }
          }
          // 登记本工作区根：此后该会话的卡片可凭 cwd 经图片路由回看生成图
          knownRoots.add(workspaceRoot)

          // 生成历史元数据：设置面板历史页的数据来源（M3 消费）。
          // 写失败不阻断结果返回，但留 debug 日志：历史页缺记录时可据此排查。
          const historyWrite = storeOf(workspaceRoot)
          void appendFile(
            historyWrite.historyFile,
            `${JSON.stringify({
              time: new Date().toISOString(),
              files: images.map((image) => image.path),
              description: args.description,
              model: generated.model,
              fidelity,
              platform,
              ...(spec.size !== undefined ? { size: spec.size } : {}),
              status: isEdit ? 'edited' : 'generated',
            })}\n`,
          ).catch((error: unknown) => {
            ctx
              .logger('ui-mockup')
              .debug(
                `history.jsonl 写入失败: ${error instanceof Error ? error.message : String(error)}`,
              )
          })

          const label = fidelity === 'wireframe' ? '线框图' : '高保真设计稿'
          const paths = images.map((image) => image.path).join(', ')
          let message = isEdit
            ? `已用模型 ${generated.model} 按编辑指令在基准图上重绘, 生成 ${images.length} 张新版本。图片已保存到 ${paths}, 请在对话中查看并反馈。`
            : `已用模型 ${generated.model} 生成 ${images.length} 张${label}。图片已保存到 ${paths}, 请在对话中查看并反馈; 需要修改时直接描述要改的地方。确认无误后我会将设计提炼为 design/spec.md 作为实现规格。`
          if (anchorInjected !== null) {
            message += ` 已按风格锚点 ${anchorInjected} 自动注入参考图(可在设置 · UI 草图 · 生成历史中解除)。`
          }
          if (anchorSkippedForModel !== null) {
            message += ` 当前生效模型 ${anchorSkippedForModel} 不支持参考图(I2I), 已跳过风格锚点注入; 如需沿用锚点风格, 请在设置 · UI 草图 · 提供方与模型改回 qwen-image 系, 或在生成历史中解除锚点。`
          }
          if (failures.length > 0) {
            message += ` 注意: 有 ${failures.length} 张下载失败(${failures.join('; ')}), 其余图片已保留。`
          }
          if (oversize > 0) {
            message += ` 其中 ${oversize} 张超过会话附件大小上限, 仅保存到工作区, 未在对话中展示。`
          }
          return { ok: true, message, images }
        } catch (error) {
          if (error instanceof ImageProviderError) {
            return { ok: false, message: `生成失败 [${error.code}]: ${error.message}` }
          }
          return {
            ok: false,
            message: `生成失败: ${error instanceof Error ? error.message : String(error)}`,
          }
        }
      },
      timeoutMs: 900_000,
      isConcurrencySafe() {
        return true
      },
      /**
       * 双通道展示的 host 半区投影：keyed toolview（client/index.ts）接管 web 渲染，
       * 本 presentResult 产生的 resultView 会随会话日志持久化，供无 toolview
       * 能力的 UI（terminal/精简客户端）在 live 与 replay 路径回退渲染，
       * 删除它会让这些客户端退化为纯文本卡片 —— 两者是分工而非冗余。
       */
      presentResult(_args, result): unknown {
        const images = result.content.filter((block) => block.type === 'image')
        return { card: 'generic', title: 'UI 草图', content: images }
      },
    }),
  )

  const systemPrompt = ctx.get('systemPrompt') as SystemPromptFace
  ctx.effect(() => systemPrompt.section(USAGE_SECTION))

  // 图片路由：服务工作区 design/images/ 目录，供客户端卡片 <img> 内嵌展示。
  // webServer 是 host-plane 服务，其就绪晚于 tools/systemPrompt（webServer 等待
  // webStartup 提供）。若用 ctx.get 在 apply 时读取，会因未就绪返回 undefined
  // 而漏注册。改用 ctx.inject 等 webServer 就绪后再注册，不阻塞工具注册。
  ctx.inject(['webServer'], (scope) => {
    const webServer = scope.get('webServer') as WebServerFace
    // effect 挂在 scope 而非外层 ctx：inject 回调在 webServer 服务变化时会
    // unload 并 re-run，路由注册必须随本次回调的子 fiber 一起销毁，
    // 否则 disposer 悬空、注册随重载次数累积。
    scope.effect(() =>
      webServer.register({
        kind: 'prefix',
        path: '/ui-mockup/images',
        async handler(req, res) {
          const url = new URL(req.url ?? '/', 'http://x')
          const rawPath = url.pathname
          const prefix = '/ui-mockup/images/'
          if (!rawPath.startsWith(prefix)) {
            res.writeHead(400)
            res.end()
            return
          }
          const name = decodeURIComponent(rawPath.slice(prefix.length))
          // 只接受纯文件名（无路径分隔符），防路径逃逸；生成文件名恒为 mockup-*.ext
          const fileName = basename(name)
          if (fileName === '' || fileName !== name || fileName === '.' || fileName === '..') {
            res.writeHead(400)
            res.end()
            return
          }
          // 会话工作区由卡片经 query 传入（webServer 是进程级服务，无会话上下文）。
          // 信任判定与空 cwd 回退与 RPC 端点共用 trustedRoot：非空 cwd 必须命中
          // 信任源（execute 登记的根 / 已知会话 cwd），空 cwd 走「宿主会话 cwd →
          // 最近登记根 → 进程根」回退链——旧实现独立回退进程根，缩略图因此 404。
          const cwdParam = url.searchParams.get('cwd')
          const rootOrError = trustedRoot(ctx, knownRoots, cwdParam ?? '')
          if (!rootOrError.ok) {
            res.writeHead(400)
            res.end()
            return
          }
          const root = rootOrError.root
          try {
            // 信任链按工作区根判定, 文件本体在资产库该工作区目录下
            const buffer = await readFile(resolve(storeOf(root).imagesDir, fileName))
            res.writeHead(200, {
              'Content-Type': mediaTypeForExtension(fileName),
              'Content-Length': buffer.byteLength,
              'Cache-Control': 'no-store',
            })
            res.end(buffer)
          } catch {
            res.writeHead(404)
            res.end()
          }
        },
      }),
    )
  })

  /**
   * 设置面板数据通道：私有 RPC 频道，承载概览/历史/锚点/测试连接四类端点。
   * 偏好读写不在此通道——客户端直接绑定同名 settings 命名空间镜像。
   * connection 与 webServer 同为晚就绪服务，走相同的 ctx.inject 等待模式。
   */
  ctx.inject(['connection'], (scope) => {
    const connection = scope.get('connection') as ConnectionFace
    // 同图片路由：effect 挂 scope，随本轮回调的子 fiber 销毁，防止重载累积
    scope.effect(() =>
      connection.rpc.handle(
        '/ui-mockup',
        async (endpoint: string, payload: unknown): Promise<RpcResultLike<unknown>> => {
          const body = (payload ?? {}) as Record<string, unknown>
          const cwd = typeof body.cwd === 'string' ? body.cwd : ''
          switch (endpoint) {
            case 'overview': {
              const rootOrError = trustedRoot(ctx, knownRoots, cwd)
              if (!rootOrError.ok) return rootOrError.error
              const active = activeProviderOf(ctx)
              return rpcOk({
                provider: active.id,
                credential: await credentialStatus(ctx, active.credential),
                anchor: await readAnchor(rootOrError.root),
              })
            }
            case 'credential/set': {
              const credentials = ctx.get('credentials') as CredentialsFace | undefined
              if (credentials === undefined) {
                return rpcError(
                  'NOT_AVAILABLE',
                  '凭据服务不可用：当前部署没有可写密钥存储，请改用环境变量或 .env。',
                )
              }
              const value = typeof body.value === 'string' ? body.value.trim() : ''
              if (value === '') {
                return rpcError('INVALID_PARAMETER', '密钥不能为空；如需删除请用清除操作。')
              }
              try {
                await credentials.set(credentialRef(activeProviderOf(ctx).credential), value)
              } catch (error) {
                // 不原样透传上游异常文本：provider message 未来若夹带密钥片段会经
                // RPC 抵达浏览器，「永不回值」承诺同样适用于错误通道；原文留服务端日志。
                ctx
                  .logger('ui-mockup')
                  .debug(`凭据写入失败: ${error instanceof Error ? error.message : String(error)}`)
                return rpcError(
                  'CREDENTIAL_WRITE_FAILED',
                  '凭据写入失败：存储层拒绝了本次写入（可能被环境变量等只读来源遮蔽），详见宿主日志。',
                )
              }
              // 写入成功后回安全视图（仅 configured/source/writable，永不回值）
              return rpcOk({
                credential: await credentialStatus(ctx, activeProviderOf(ctx).credential),
              })
            }
            case 'credential/unset': {
              const credentials = ctx.get('credentials') as CredentialsFace | undefined
              if (credentials === undefined) {
                return rpcError('NOT_AVAILABLE', '凭据服务不可用，无存储可清除。')
              }
              try {
                await credentials.unset(credentialRef(activeProviderOf(ctx).credential))
              } catch (error) {
                // 同 credential/set：不透传上游原文，防错误通道夹带密钥
                ctx
                  .logger('ui-mockup')
                  .debug(`凭据清除失败: ${error instanceof Error ? error.message : String(error)}`)
                return rpcError(
                  'CREDENTIAL_WRITE_FAILED',
                  '凭据清除失败：存储层拒绝了本次操作，详见宿主日志。',
                )
              }
              return rpcOk({
                credential: await credentialStatus(ctx, activeProviderOf(ctx).credential),
              })
            }
            case 'history/list': {
              const rootOrError = trustedRoot(ctx, knownRoots, cwd)
              if (!rootOrError.ok) return rootOrError.error
              // 服务端分页：先按 query 过滤得到全量有序列表，再切片返回当前页，
              // 附带 total 与锚点在过滤后列表中的索引（客户端据此提示锚点所在页）。
              const all = filterHistory(
                await readHistory(rootOrError.root),
                typeof body.query === 'string' ? body.query : undefined,
              )
              const pageSize = clampPageSize(body.pageSize)
              const totalPages = Math.max(1, Math.ceil(all.length / pageSize))
              const page = clampPage(body.page, totalPages)
              const anchorFile = await readAnchor(rootOrError.root, false)
              const entries = all.slice((page - 1) * pageSize, page * pageSize)
              const anchorIndex =
                anchorFile === null
                  ? -1
                  : all.findIndex((entry) =>
                      entry.files.some((file) => basename(file) === anchorFile),
                    )
              return rpcOk({
                anchorFile,
                anchorIndex,
                total: all.length,
                page,
                pageSize,
                entries: entries.map((entry) => ({
                  ...entry,
                  anchored:
                    anchorFile !== null &&
                    entry.files.some((file) => basename(file) === anchorFile),
                })),
              })
            }
            case 'history/clear': {
              const rootOrError = trustedRoot(ctx, knownRoots, cwd)
              if (!rootOrError.ok) return rootOrError.error
              const store = storeOf(rootOrError.root)
              // 目录可能尚不存在（从未生成过就点清空），先建目录再原子截断
              await mkdir(store.root, { recursive: true })
              await writeFileAtomic(store.historyFile, '')
              // 清空历史后锚点记录指向的行不复存在，按规格一并解除
              await clearAnchor(rootOrError.root)
              return rpcOk({})
            }
            case 'anchor/set': {
              const rootOrError = trustedRoot(ctx, knownRoots, cwd)
              if (!rootOrError.ok) return rootOrError.error
              const file = sanitizeAnchorFileName(body.file)
              if (file === null)
                return rpcError('INVALID_PARAMETER', `不是合法的生成图文件名: ${String(body.file)}`)
              try {
                await access(resolve(storeOf(rootOrError.root).imagesDir, file))
              } catch {
                return rpcError('NOT_FOUND', `工作区中没有这张生成图: ${file}`)
              }
              await writeAnchor(rootOrError.root, file)
              return rpcOk({ anchorFile: file })
            }
            case 'anchor/unset': {
              const rootOrError = trustedRoot(ctx, knownRoots, cwd)
              if (!rootOrError.ok) return rootOrError.error
              await clearAnchor(rootOrError.root)
              return rpcOk({})
            }
            case 'provider/status': {
              // 面板「当前生效提供方」的唯一事实源：读 image 槽位的 providerId，
              // 不从偏好或组合文件推断，避免面板与实际挂载漂移。
              const service = ctx.get('image') as ImageGenerationServiceFace | undefined
              return rpcOk({
                active: service?.providerId ?? 'unknown',
              })
            }
            case 'provider/switch': {
              // 一键切换：改写 DSH home 用户层 patch（$DSH_HOME/cordis.patch.yml），
              // launcher 的 HMR watcher 监听该文件并事务性重放组合，image 槽位
              // 随之热替换（旧 Provider dispose、新 Provider 加载），无需重启。
              // 只写 id + disabled 两行，不触碰用户层中任何其他内容。
              const provider = body.provider
              if (provider !== 'dashscope' && provider !== 'volcengine') {
                return rpcError(
                  'INVALID_PARAMETER',
                  'provider 必须是 "dashscope" 或 "volcengine"。',
                )
              }
              const service = ctx.get('image') as ImageGenerationServiceFace | undefined
              if (service?.providerId === provider) {
                return rpcOk({ active: provider })
              }
              const patchFile = join(dshHome(), HOME_PATCH_FILENAME)
              // catch 的各分支要么赋值要么 return，TS 可判定赋值完毕
              let patches: unknown[]
              try {
                const content = await readFile(patchFile, 'utf8')
                const parsed: unknown = loadYaml(content)
                // 合法 YAML 但非数组同样是坏 patch（宿主会 fail-loud）——
                // 抛进 catch 统一走中止分支，绝不能用空数组覆盖用户文件
                if (Array.isArray(parsed)) patches = parsed
                else throw new Error('patch file is not a top-level array')
              } catch {
                // 文件不存在 = 空用户层；存在但不可解析时不要吞掉用户的错误——
                // 直接中止切换并报告，绝不能用空数组覆盖用户写好的 patch。
                let content: string | undefined
                try {
                  content = await readFile(patchFile, 'utf8')
                } catch {
                  content = undefined
                }
                if (content === undefined) {
                  patches = []
                } else if (content.includes('!!js')) {
                  // 宿主 patch schema 允许 !!js 表达式，js-yaml 默认 schema 不认；
                  // 代写会把表达式物化成字面值，只能请用户手工翻转
                  return rpcError(
                    'PROVIDER_SWITCH_FAILED',
                    `用户层 patch 文件 ${patchFile} 含 !!js 表达式（宿主专有语法，本插件无法安全代写）；请手工翻转两行 Provider 的 disabled 后再试。`,
                  )
                } else {
                  return rpcError(
                    'PROVIDER_SWITCH_FAILED',
                    `用户层 patch 文件 ${patchFile} 不是合法的 YAML 数组，请先手工修复后再切换。`,
                  )
                }
              }
              const merged = mergeProviderSwitchRows(patches, provider)
              // 临时文件 + rename 原子写：watcher 读到半截文件会误判为坏 patch。
              // js-yaml dump 无法保留原文件注释，头部注明代写来源与这一限制。
              const tmpFile = `${patchFile}.${randomUUID().slice(0, 8)}.tmp`
              try {
                await writeFile(
                  tmpFile,
                  '# 本文件由 ui-mockup 提供方切换代写（js-yaml 往返不保留原注释）\n' +
                    dumpYaml(merged, { lineWidth: -1 }),
                  'utf8',
                )
                await rename(tmpFile, patchFile)
              } catch (error) {
                await rm(tmpFile, { force: true }).catch(() => {})
                return rpcError(
                  'PROVIDER_SWITCH_FAILED',
                  `写入 ${patchFile} 失败: ${error instanceof Error ? error.message : String(error)}`,
                )
              }
              // 等热重载落位：轮询 image 槽位直到目标 providerId 或超时
              const deadline = Date.now() + 8_000
              while (Date.now() < deadline) {
                await sleep(250)
                const current = (ctx.get('image') as ImageGenerationServiceFace | undefined)
                  ?.providerId
                if (current === provider) return rpcOk({ active: current })
                // 热重载中槽位可能短暂为 undefined（旧实例已卸、新实例未就绪），继续等
              }
              const current = (ctx.get('image') as ImageGenerationServiceFace | undefined)
                ?.providerId
              return rpcOk({
                active: current ?? 'unknown',
                pending: true,
              })
            }
            case 'test-connection': {
              // 只回机器可判的 reason + 原始 detail；用户可见文案由客户端按语言渲染。
              // 探测参数随生效提供方分流（网关、凭据引用、探测路径都不同）。
              const service = ctx.get('image') as ImageGenerationServiceFace | undefined
              const probe =
                service?.providerId === 'volcengine' ? PROBES.volcengine : PROBES.dashscope
              const credentialName =
                readProviderConfigString(service, 'apiKey') ?? probe.defaultCredential
              const ref = credentialRef(credentialName)
              // 取值仅用于探测请求的 Authorization 头，永不进入任何响应
              let apiKey: string | undefined
              const credentials = ctx.get('credentials') as CredentialsFace | undefined
              if (credentials !== undefined) {
                const hit = await credentials.resolve(ref).catch(() => undefined)
                apiKey = hit?.value
              }
              if (apiKey === undefined || apiKey === '') {
                apiKey = launchEnvironmentOf(ctx).get(ref)?.value
              }
              if (apiKey === undefined || apiKey === '') {
                return rpcOk({ ok: false, reason: 'missing-key' })
              }
              const baseUrl = readProviderConfigString(service, 'baseUrl') ?? probe.defaultBaseUrl
              try {
                // 鉴权探测：向图像生成端点发空体 POST（不消耗生成配额）。
                // 两家网关都是鉴权先于参数校验：无效 key → 401；
                // 有效 key → 400 参数错误；429 限流也说明鉴权已通过。
                const res = await fetch(baseUrl + probe.path, {
                  method: 'POST',
                  headers: {
                    Authorization: `Bearer ${apiKey}`,
                    'content-type': 'application/json',
                  },
                  body: '{}',
                  signal: AbortSignal.timeout(8_000),
                  redirect: 'error',
                })
                const respBody = (await res.json().catch(() => ({}))) as { code?: unknown }
                const code = typeof respBody.code === 'string' ? respBody.code : ''
                if (
                  res.status === 401 ||
                  code.includes('InvalidApiKey') ||
                  code.includes('Unauthorized') ||
                  code.includes('AuthenticationError')
                ) {
                  return rpcOk({ ok: false, reason: 'invalid-key' })
                }
                // 正向判定鉴权已通过：网关鉴权先于参数与配额校验——
                // 400 参数错误、429 限流都说明 key 已被网关接受。
                // 其余未知响应（如未来新增的 403 或前置校验码）归入 unknown 灰态，
                // 宁可不确定也不误报「连接正常」。
                if (res.status === 400 || res.status === 429) {
                  return rpcOk({ ok: true, reason: 'ok' })
                }
                return rpcOk({
                  ok: false,
                  reason: 'unknown',
                  detail: `HTTP ${res.status}${code !== '' ? ` ${code}` : ''}`,
                })
              } catch (error) {
                return rpcOk({
                  ok: false,
                  reason: 'gateway',
                  detail: error instanceof Error ? error.message : String(error),
                })
              }
            }
            default:
              return rpcError('NOT_FOUND', `未知端点: ${endpoint}`)
          }
          // 类型穷尽保底：所有分支均已 return，执行不会到达此处
          throw new Error('unreachable')
        },
        { authority: 'trusted-host' },
      ),
    )
  })
}

/**
 * 设置面板端点的 cwd 信任检查：与图片路由同一信任源全集
 * （execute 登记的根 / 已知会话 cwd / 宿主进程 fallback）。
 * 无 cwd 时回退宿主进程级配置根（可信），与图片路由口径一致。
 */
function trustedRoot(
  ctx: Context,
  known: ReadonlySet<string>,
  cwd: string,
): { ok: true; root: string } | { ok: false; error: RpcResultLike<never> } {
  if (cwd !== '') {
    const canonical = canonicalRoot(cwd)
    if (!allowedRoots(ctx, known).has(canonical)) {
      return { ok: false, error: rpcError('UNTRUSTED_WORKSPACE', '请求的工作区不在信任源内') }
    }
    return { ok: true, root: canonical }
  }
  // 空 cwd 的回退顺序：宿主已知会话的 cwd（去重后唯一即采用——数据源头，
  // 与 allowedRoots 同源；单工作区场景直接命中）→ 本插件登记过的最近工作区根
  // （进程内 execute 插入序）→ sandboxPolicy 进程根（最后的最后）。
  // 旧实现直接退进程根：DSH 不从项目目录启动时指向无关目录，面板读到空 store。
  const sessions = ctx.get('sessions') as SessionsFace | undefined
  if (sessions !== undefined) {
    const cwds = [
      ...new Set(
        sessions
          .list()
          .map((session) => session.header.cwd)
          .filter((value): value is string => value !== undefined && value !== ''),
      ),
    ]
    if (cwds.length === 1) return { ok: true, root: canonicalRoot(cwds[0]!) }
    if (known.size > 0) {
      const latest = [...known].at(-1)!
      return { ok: true, root: canonicalRoot(latest) }
    }
  }
  const policy = ctx.get('sandboxPolicy') as SandboxPolicyFace | undefined
  return { ok: true, root: canonicalRoot(policy?.workspaceRoot ?? '.') }
}

/** image 服务的结构面（兼容 @mackwan84/dsh-image 的抽象契约）。 */
interface ImageGenerationServiceFace {
  /** 提供方稳定标识（契约成员），供面板与探测分流识别生效提供方。 */
  readonly providerId: string
  generate(
    spec: ImageGenerateSpec,
    signal?: AbortSignal,
  ): Promise<{ model: string; images: readonly { url: string; mediaType?: string }[] }>
  edit(
    spec: ImageEditSpec,
    signal?: AbortSignal,
  ): Promise<{ model: string; images: readonly { url: string; mediaType?: string }[] }>
}

/**
 * 各提供方的鉴权探测参数：网关、凭据引用名与探测路径。
 * 默认值兜底 Provider config 缺失（服务未挂载）的场景；生效 Provider 的
 * config.apiKey / config.baseUrl 可被用户改写，优先于默认值。
 */
const PROBES = {
  dashscope: {
    defaultCredential: 'DASHSCOPE_API_KEY',
    defaultBaseUrl: 'https://dashscope.aliyuncs.com',
    path: '/api/v1/services/aigc/image-generation/generation',
  },
  volcengine: {
    defaultCredential: 'ARK_API_KEY',
    defaultBaseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    path: '/images/generations',
  },
} as const

/** 从生效 Provider 的 config 读字符串字段；服务缺失或字段非字符串时返回 undefined。 */
function readProviderConfigString(
  service: ImageGenerationServiceFace | undefined,
  key: 'apiKey' | 'baseUrl',
): string | undefined {
  if (service === undefined) return undefined
  const value = (service as { config?: Record<string, unknown> }).config?.[key]
  return typeof value === 'string' && value !== '' ? value : undefined
}

/** DSH home 用户层 patch 文件（launcher 实时 watch，编辑后组合热重载）。 */
export const HOME_PATCH_FILENAME = 'cordis.patch.yml'

/**
 * 生成切换提供方后的用户层 patch 行：对两行 Provider 做 id 定向 disabled 翻转。
 * 用户层 applied after bundle layers——bundle 插入的行由此覆盖 enabled 状态，
 * 且只携带 id/disabled 两个字段，不触碰用户可能写在同 id 行上的其他定制；
 * 已有行原位更新（保留其余字段），缺失行追加在列表尾部。
 * 纯函数：宿主端点与单测共用同一合并语义。
 */
export function mergeProviderSwitchRows(
  patches: readonly unknown[],
  target: 'dashscope' | 'volcengine',
): Record<string, unknown>[] {
  const rows: Record<string, unknown>[] = [
    { id: 'image-dashscope', disabled: target !== 'dashscope' },
    { id: 'image-volcengine', disabled: target !== 'volcengine' },
  ]
  type Entry = Record<string, unknown>
  const merged: Entry[] = patches.filter(
    (entry): entry is Entry => entry !== null && typeof entry === 'object',
  )
  for (const row of rows) {
    const index = merged.findIndex((entry) => entry['id'] === row.id)
    if (index >= 0) merged[index] = { ...merged[index]!, disabled: row.disabled }
    else merged.push(row)
  }
  return merged
}

/** 供单元测试引用的内部实现。 */
export { buildPrompt, dshHome }
export {
  sanitizeOutputDir,
  clampCount,
  parseHistoryLine,
  filterHistory,
  DEFAULT_PREFS,
} from './prefs.js'
