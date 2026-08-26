import { randomUUID } from 'node:crypto'
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { basename, resolve, sep } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import { ImageProviderError, type ImageGenerateSpec } from '@mackwan84/dsh-image'
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
  execute(args: Record<string, unknown>, exec: { signal: AbortSignal }): Promise<MockupValue>
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

/** sandboxPolicy 服务的结构面（本包只读工作区根目录）。 */
interface SandboxPolicyFace {
  workspaceRoot: string
}

/** webServer 服务的结构面（本包只注册图片前缀路由）。 */
interface WebServerFace {
  register(route: {
    kind: 'exact' | 'prefix'
    path: string
    handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>
  }): () => void
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
    "- 布局与信息架构待确认: fidelity='wireframe'(默认用 qwen-image-3.0, 速度快)。",
    "- 视觉风格待确认: fidelity='high-fidelity'(默认用 qwen-image-3.0-pro, 质量优先), 建议 count=2~4 一次给多个方向供用户选择。",
    '- 同一个站点的多个页面在高保真阶段应传 reference=已确认页面的图, 保持风格一致(图生图模式)。',
    '- 用户对生成的图提出修改意见: 再次调用 ui_mockup, 在 description 中写修改后的完整界面描述, 并保持与上一版一致的 style。',
    '',
    '确认与锁定:',
    '- 生成后展示图片, 请用户反馈, 循环修改直到用户明确确认。',
    '- 用户确认某一版设计后: 把设计提炼为规格写入 design/spec.md, 内容包括配色、字体、间距、组件清单、页面清单; 该文件成为后续实现代码的依据。',
    '- design/spec.md 尚未生成或未获用户确认前, 不要开始编写前端实现代码。',
  ].join('\n'),
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

export function apply(ctx: Context) {
  const tools = ctx.get('tools') as ToolsFace
  ctx.effect(() =>
    tools.register({
      name: 'ui_mockup',
      description:
        '调用外部图像生成接口, 为界面/页面生成线框图(wireframe)或高保真(high-fidelity)设计草图, 供用户在编写实现代码之前确认界面方向。图片显示在对话中并保存到工作区 design/images/ 目录。用户需要修改时, 用修改后的完整描述再次调用。模型按精度自动选择: wireframe 用 qwen-image-3.0(快), high-fidelity 用 qwen-image-3.0-pro(质量优先); 也可用 model 参数显式覆盖。传 reference 参数可用已确认的图作为风格基准(图生图), 保持多页面风格一致。接口限流时自动退避重试。需要阿里云百炼 DASHSCOPE_API_KEY(通过凭据服务或环境变量提供)。',
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
            default: 1,
            description: '一次生成的方案数量(1-4)。风格探索时建议 2-4, 让用户挑选方向。',
          },
          model: {
            type: 'string',
            description:
              '可选: 显式覆盖模型。默认按精度自动选: wireframe→qwen-image-3.0, high-fidelity→qwen-image-3.0-pro; 也可换 wan2.2-t2i-plus 等。',
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
          const platform = args.platform === 'mobile' ? 'mobile' : 'web'
          const reference =
            typeof args.reference === 'string' && args.reference.trim() !== ''
              ? args.reference.trim()
              : undefined
          const sandboxPolicy = ctx.get('sandboxPolicy') as SandboxPolicyFace | undefined
          const workspaceRoot =
            sandboxPolicy !== undefined && typeof sandboxPolicy.workspaceRoot === 'string'
              ? sandboxPolicy.workspaceRoot
              : '.'
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
            size: typeof args.size === 'string' ? args.size : undefined,
            n: typeof args.count === 'number' ? args.count : undefined,
            model: typeof args.model === 'string' ? args.model : undefined,
            reference,
            // 参考图必须相对会话工作区根解析: 宿主进程 CWD 不保证与工作区一致
            cwd: workspaceRoot,
          }

          const service = ctx.get('image') as ImageGenerationServiceFace | undefined
          if (service === undefined) {
            return {
              ok: false,
              message:
                '未挂载图像生成服务(image): 请安装 @mackwan84/dsh-image-dashscope 并加入组合。',
            }
          }
          const generated = await service.generate(spec, exec.signal)

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
              const dir = resolve(workspaceRoot, 'design/images')
              await mkdir(dir, { recursive: true })
              await writeFile(resolve(dir, fileName), buffer)
              const relPath = `design/images/${fileName}`
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

          // 生成历史元数据：设置面板历史页的数据来源（M3 消费）。
          void appendFile(
            resolve(workspaceRoot, 'design/history.jsonl'),
            `${JSON.stringify({
              time: new Date().toISOString(),
              files: images.map((image) => image.path),
              description: args.description,
              model: generated.model,
              fidelity,
              platform,
              status: 'generated',
            })}\n`,
          ).catch(() => {})

          const label = fidelity === 'wireframe' ? '线框图' : '高保真设计稿'
          const paths = images.map((image) => image.path).join(', ')
          let message = `已用模型 ${generated.model} 生成 ${images.length} 张${label}。图片已保存到 ${paths}, 请在对话中查看并反馈; 需要修改时直接描述要改的地方。确认无误后我会将设计提炼为 design/spec.md 作为实现规格。`
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
      presentResult(_args, result): unknown {
        const images = result.content.filter((block) => block.type === 'image')
        return { card: 'generic', title: 'UI 草图', content: images }
      },
    }),
  )

  const systemPrompt = ctx.get('systemPrompt') as SystemPromptFace
  ctx.effect(() => systemPrompt.section(USAGE_SECTION))

  // 图片路由：服务工作区 design/images/ 目录，供客户端卡片 <img> 内嵌展示。
  // webServer 是 host-plane 服务，consumer 行通过 ctx.get 可选读取；读不到时
  // 图片内嵌降级为附件/文件名展示，不影响卡片与反馈按钮。
  const webServer = ctx.get('webServer') as WebServerFace | undefined
  if (webServer !== undefined) {
    ctx.effect(() =>
      webServer.register({
        kind: 'prefix',
        path: '/ui-mockup/images',
        async handler(req, res) {
          const rawPath = new URL(req.url ?? '/', 'http://x').pathname
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
          const policy = ctx.get('sandboxPolicy') as SandboxPolicyFace | undefined
          const root = resolve(policy?.workspaceRoot ?? '.')
          const filePath = resolve(root, 'design/images', fileName)
          // 防逃逸：拼接结果必须仍在工作区 design/images 之内
          if (!filePath.startsWith(root + sep)) {
            res.writeHead(400)
            res.end()
            return
          }
          try {
            const buffer = await readFile(filePath)
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
  }
}

/** image 服务的结构面（兼容 @mackwan84/dsh-image 的抽象契约）。 */
interface ImageGenerationServiceFace {
  generate(
    spec: ImageGenerateSpec,
    signal?: AbortSignal,
  ): Promise<{ model: string; images: readonly { url: string; mediaType?: string }[] }>
}

/** 供单元测试引用的内部实现。 */
export { buildPrompt }
