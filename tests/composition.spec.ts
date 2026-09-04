import { mkdtempSync, realpathSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context, Service } from '@deepseek-ai/cordis'
import Include from '@deepseek-ai/cordis-plugin-include'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import { ImageGenerationService } from '@mackwan84/dsh-image'
import DashscopeImageProvider from '@mackwan84/dsh-image-dashscope'
import VolcengineImageProvider from '@mackwan84/dsh-image-volcengine'
import {
  apply as uiMockupApply,
  inject as uiMockupInject,
  name as uiMockupName,
} from '@mackwan84/dsh-tool-ui-mockup'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * 凭据桩：从进程环境按引用名读取；describe/set/unset 模拟本地 provider 的
 * 分层语义——进程环境视为只读遮蔽层（在场则 writable=false 且写入拒绝），
 * 存储层为可写的内存 Map。
 */
class CredentialsStub extends Service {
  readonly stored = new Map<string, string>()

  constructor(ctx: Context) {
    super(ctx, 'credentials')
  }

  async resolve(ref: string) {
    const fromEnv = process.env[ref]
    if (fromEnv !== undefined && fromEnv !== '') return { value: fromEnv }
    const hit = this.stored.get(ref)
    return hit !== undefined && hit !== '' ? { value: hit } : undefined
  }

  async describe(ref: string) {
    const fromEnv = process.env[ref]
    if (fromEnv !== undefined && fromEnv !== '') {
      return { configured: true, source: 'env', writable: false }
    }
    const hit = this.stored.get(ref)
    return hit !== undefined && hit !== ''
      ? { configured: true, source: 'file', writable: true }
      : { configured: false, writable: true }
  }

  async set(ref: string, value: string) {
    if (process.env[ref] !== undefined && process.env[ref] !== '') {
      throw new Error(`reference ${ref} is shadowed by a read-only source`)
    }
    this.stored.set(ref, value)
  }

  async unset(ref: string) {
    if (process.env[ref] !== undefined && process.env[ref] !== '') {
      throw new Error(`reference ${ref} is shadowed by a read-only source`)
    }
    this.stored.delete(ref)
  }
}

/** 工具注册表桩：记录注册定义并暴露给断言。 */
class ToolsStub extends Service {
  readonly registered: Array<Record<string, unknown> & { name: string }> = []

  constructor(ctx: Context) {
    super(ctx, 'tools')
  }

  register(definition: never) {
    this.registered.push(definition)
    return () => {}
  }
}

/** 工作区策略桩：指向测试临时目录。 */
class SandboxPolicyStub extends Service {
  constructor(ctx: Context, config: { workspaceRoot: string }) {
    super(ctx, 'sandboxPolicy')
    this.workspaceRoot = config.workspaceRoot
  }

  readonly workspaceRoot: string

  resolve(request?: { session?: { header: { cwd?: string } } }) {
    return { workspaceRoot: request?.session?.header.cwd ?? this.workspaceRoot }
  }
}

/** 附件桩：记录保存调用并返回占位引用。 */
class AttachmentsStub extends Service {
  readonly saved: Array<{ name?: string; mediaType: string; bytes: number }> = []

  constructor(ctx: Context) {
    super(ctx, 'attachments')
  }

  async saveImage(input: { data: Uint8Array; mediaType: string; name?: string }) {
    this.saved.push({ name: input.name, mediaType: input.mediaType, bytes: input.data.byteLength })
    return {
      attachmentId: `att-${this.saved.length}`,
      mediaType: input.mediaType,
      bytes: input.data.byteLength,
      width: 1280,
      height: 720,
      name: input.name,
    }
  }
}

/** 系统提示词桩：记录注入的 section。 */
class SystemPromptStub extends Service {
  readonly sections: Array<{ name: string; text: string }> = []

  constructor(ctx: Context) {
    super(ctx, 'systemPrompt')
  }

  section(section: { name: string; order: number; text: string }) {
    this.sections.push(section)
    return () => {}
  }
}

/** settings 服务桩：接受命名空间注册，resolved 值 = 默认 + 组合 base；测试可改 resolved 模拟面板写入。 */
class SettingsStub extends Service {
  readonly namespaces: string[] = []

  /** 可变窗口：register().get() 返回该对象引用，改字段即等于用户层写入后的 resolved 值。 */
  readonly resolved: Record<string, unknown> = {
    defaultFidelity: 'wireframe',
    defaultPlatform: 'web',
    defaultCount: 2,
    outputDir: 'design/images',
    pollTimeoutMinutes: 10,
    wireframeModel: '',
    highFidelityModel: '',
    defaultSize: '',
  }

  constructor(ctx: Context) {
    super(ctx, 'settings')
  }

  register(ns: string, _schema: unknown, options?: { base?: Record<string, unknown> }) {
    this.namespaces.push(ns)
    Object.assign(this.resolved, options?.base ?? {})
    return { get: () => this.resolved as never }
  }
}

/** RPC 结果形状（与宿主半区 RpcResultLike 同构）。 */
type CompositionRpcResult =
  { ok: true; value: unknown } | { ok: false; error: { code: string; message: string } }

/** connection 桩：记录私有频道注册并支持测试内直接调用端点。 */
class ConnectionStub extends Service {
  readonly channels = new Map<
    string,
    (endpoint: string, payload: unknown, signal: AbortSignal) => Promise<CompositionRpcResult>
  >()

  constructor(ctx: Context) {
    super(ctx, 'connection')
  }

  get rpc() {
    return {
      handle: (
        channel: string,
        handler: (
          endpoint: string,
          payload: unknown,
          signal: AbortSignal,
        ) => Promise<CompositionRpcResult>,
      ) => {
        this.channels.set(channel, handler)
        return () => {}
      },
    }
  }

  /** 测试辅助：直接调用已注册频道的端点。 */
  async call(channel: string, endpoint: string, payload?: unknown): Promise<CompositionRpcResult> {
    const handler = this.channels.get(channel)
    if (handler === undefined) throw new Error(`channel not registered: ${channel}`)
    return handler(endpoint, payload ?? {}, new AbortController().signal)
  }
}

/** webServer 桩：记录注册的路由并暴露给断言。 */
class WebServerStub extends Service {
  readonly routes: Array<{
    kind: string
    path: string
    handler: (req: { url?: string }, res: RouteResponse) => void | Promise<void>
  }> = []

  constructor(ctx: Context) {
    super(ctx, 'webServer')
  }

  register(route: {
    kind: string
    path: string
    handler: (req: { url?: string }, res: RouteResponse) => void | Promise<void>
  }) {
    this.routes.push(route)
    return () => {}
  }
}

/** 路由响应桩：记录 writeHead/end 调用与写入字节。 */
interface RouteResponse {
  writeHead(status: number, headers?: Record<string, unknown>): void
  end(body?: Buffer): void
}

interface Booted {
  ctx: Context
  tools: ToolsStub
  attachments: AttachmentsStub
  systemPrompt: SystemPromptStub
  webServer: WebServerStub
  connection: ConnectionStub
  settings: SettingsStub
}

async function bootComposition(
  dir: string,
  options: { provider?: 'dashscope' | 'volcengine' } = {},
): Promise<Booted> {
  // 提供方行与 bundle patch 同构：默认 dashscope 启用 + volcengine 禁用（bundle 预置形态）；
  // volcengine 场景模拟用户 patch 翻转 disabled——两行并存、单槽位只生效一个。
  const providerRows =
    options.provider === 'volcengine'
      ? [
          '- id: image-dashscope',
          "  name: '@mackwan84/dsh-image-dashscope'",
          '  disabled: true',
          '- id: image-volcengine',
          "  name: '@mackwan84/dsh-image-volcengine'",
        ]
      : [
          '- id: image-dashscope',
          "  name: '@mackwan84/dsh-image-dashscope'",
          '- id: image-volcengine',
          "  name: '@mackwan84/dsh-image-volcengine'",
          '  disabled: true',
        ]
  const configPath = join(dir, 'cordis.yml')
  await writeFile(
    configPath,
    [
      '- id: credentials',
      "  name: 'test-credentials'",
      '- id: tools',
      "  name: 'test-tools'",
      '- id: sandbox-policy',
      "  name: 'test-sandbox-policy'",
      '  config:',
      `    workspaceRoot: ${JSON.stringify(dir)}`,
      '- id: attachments',
      "  name: 'test-attachments'",
      '- id: system-prompt',
      "  name: 'test-system-prompt'",
      '- id: webserver',
      "  name: 'test-webserver'",
      '- id: connection',
      "  name: 'test-connection'",
      '- id: settings',
      "  name: 'test-settings'",
      ...providerRows,
      '- id: tool-ui-mockup',
      "  name: '@mackwan84/dsh-tool-ui-mockup'",
      '',
    ].join('\n'),
  )

  const modules = new Map<string, unknown>([
    ['test-credentials', CredentialsStub],
    ['test-tools', ToolsStub],
    ['test-sandbox-policy', SandboxPolicyStub],
    ['test-attachments', AttachmentsStub],
    ['test-system-prompt', SystemPromptStub],
    ['test-webserver', WebServerStub],
    ['test-connection', ConnectionStub],
    ['test-settings', SettingsStub],
    ['@mackwan84/dsh-image-dashscope', DashscopeImageProvider],
    ['@mackwan84/dsh-image-volcengine', VolcengineImageProvider],
    [
      '@mackwan84/dsh-tool-ui-mockup',
      { name: uiMockupName, inject: uiMockupInject, apply: uiMockupApply },
    ],
  ])

  const ctx = new Context()
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  ctx.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      const hit = modules.get(specifier)
      if (hit === undefined) throw new Error(`unexpected Loader import: ${specifier}`)
      return hit
    },
  } as unknown as NonNullable<typeof ctx.loader.internal>
  await ctx.loader.create({
    name: 'cordis:include',
    config: { path: pathToFileURL(configPath).href },
  })
  await ctx.loader.await()
  return {
    ctx,
    tools: ctx.get('tools') as unknown as ToolsStub,
    attachments: ctx.get('attachments') as unknown as AttachmentsStub,
    systemPrompt: ctx.get('systemPrompt') as unknown as SystemPromptStub,
    webServer: ctx.get('webServer') as unknown as WebServerStub,
    connection: ctx.get('connection') as unknown as ConnectionStub,
    settings: ctx.get('settings') as unknown as SettingsStub,
  }
}

/** 与宿主同口径：先 canonical(REALPATH, macOS /var→/private/var) 再 slug 转义。 */
function storeDirFor(workspaceRoot: string): string {
  const home = process.env['DSH_HOME'] ?? join(homedir(), '.dsh')
  let canonical: string
  try {
    canonical = realpathSync.native(workspaceRoot)
  } catch {
    canonical = resolve(workspaceRoot)
  }
  const withTrailing = canonical.endsWith('/') ? canonical : `${canonical}/`
  return join(home, 'mockups', `-${withTrailing.split(/[\\/]+/).join('-')}-`)
}

beforeEach(() => {
  // 资产库隔离：每个用例独立的 DSH_HOME，避免污染真实 ~/.dsh
  const home = mkdtempSync(join(tmpdir(), 'dsh-uimock-home-'))
  vi.stubEnv('DSH_HOME', home)
  vi.stubEnv('DASHSCOPE_API_KEY', 'sk-composition-key')
  vi.stubEnv('ARK_API_KEY', 'ark-composition-key')
  return () => undefined
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('ui-mockup real dynamic composition', () => {
  it('boots from cordis.yml: image service provided, tool registered, usage section injected', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-uimock-composition-'))
    try {
      const booted = await bootComposition(dir)
      expect(booted.ctx.get('image')).toBeInstanceOf(ImageGenerationService)
      expect(booted.tools.registered.map((definition) => definition.name)).toContain('ui_mockup')
      expect(booted.systemPrompt.sections.map((section) => section.name)).toContain(
        'ui-mockup-usage',
      )
      expect(
        booted.systemPrompt.sections.find((section) => section.name === 'ui-mockup-usage')?.text,
      ).toContain('整图指令重绘')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('applies the preference-tier model when the call omits an explicit model', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-uimock-composition-'))
    try {
      const booted = await bootComposition(dir)
      // 模拟用户在设置面板把线框图默认模型改为 qwen-image-2.0
      booted.settings.resolved.wireframeModel = 'qwen-image-2.0'
      const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00])
      vi.stubGlobal('fetch', async (url: string) => {
        if (url.includes('image-generation/generation')) {
          return new Response(
            JSON.stringify({ output: { task_id: 'task-pref-model', task_status: 'PENDING' } }),
            { status: 200 },
          )
        }
        if (url.includes('/api/v1/tasks/task-pref-model')) {
          return new Response(
            JSON.stringify({
              output: {
                task_id: 'task-pref-model',
                task_status: 'SUCCEEDED',
                choices: [{ message: { content: [{ image: 'https://oss.example/pref.png' }] } }],
              },
            }),
            { status: 200 },
          )
        }
        if (url.includes('oss.example')) {
          return new Response(png, { status: 200, headers: { 'content-type': 'image/png' } })
        }
        throw new Error(`unexpected fetch: ${url}`)
      })

      const definition = booted.tools.registered.find((item) => item.name === 'ui_mockup')!
      const execute = definition.execute as (
        args: Record<string, unknown>,
        exec: { signal: AbortSignal; agent?: { session: { header: { cwd?: string } } } },
      ) => Promise<Record<string, unknown>>
      // 不传 model：应走偏好分层默认而不是内置 qwen-image-3.0
      const value = await execute(
        { description: '设置页线框图', fidelity: 'wireframe', platform: 'web' },
        { signal: new AbortController().signal, agent: { session: { header: { cwd: dir } } } },
      )
      expect(value.ok, String(value.message)).toBe(true)
      expect(String(value.message)).toContain('qwen-image-2.0')
      expect(String(value.message)).not.toContain('已用模型 qwen-image-3.0')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('executes the registered tool end-to-end: task flow, download, workspace files, attachment, history', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-uimock-composition-'))
    try {
      const booted = await bootComposition(dir)
      const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00])
      vi.stubGlobal('fetch', async (url: string) => {
        if (url.includes('image-generation/generation')) {
          return new Response(
            JSON.stringify({ output: { task_id: 'task-composition', task_status: 'PENDING' } }),
            { status: 200 },
          )
        }
        if (url.includes('/api/v1/tasks/task-composition')) {
          return new Response(
            JSON.stringify({
              output: {
                task_id: 'task-composition',
                task_status: 'SUCCEEDED',
                choices: [
                  {
                    finish_reason: 'stop',
                    message: {
                      role: 'assistant',
                      content: [{ image: 'https://oss.example/mock.png', type: 'image' }],
                    },
                  },
                ],
              },
            }),
            { status: 200 },
          )
        }
        if (url.includes('oss.example')) {
          return new Response(pngBytes, { status: 200, headers: { 'content-type': 'image/png' } })
        }
        throw new Error(`unexpected fetch: ${url}`)
      })

      const definition = booted.tools.registered.find((item) => item.name === 'ui_mockup')!
      const execute = definition.execute as (
        args: Record<string, unknown>,
        exec: { signal: AbortSignal; agent?: { session: { header: { cwd?: string } } } },
      ) => Promise<Record<string, unknown>>
      const value = await execute(
        { description: '在线书店主页线框图', fidelity: 'wireframe', platform: 'web' },
        { signal: new AbortController().signal, agent: { session: { header: { cwd: dir } } } },
      )

      expect(value.ok).toBe(true)
      expect(value.message).toContain('qwen-image-3.0')
      const images = value.images as Array<{ path: string }>
      expect(images).toHaveLength(1)

      // 资产库落盘(不再写工作区) + 附件 + 历史记录
      const store = storeDirFor(dir)
      const files = await readdir(join(store, 'images'))
      expect(files).toHaveLength(1)
      expect(files[0]!.startsWith('mockup-')).toBe(true)
      expect(String(value.message)).toContain(`design/images/${files[0]}`)
      expect(String(value.message)).not.toContain(store)
      expect(booted.attachments.saved).toHaveLength(1)
      expect(booted.attachments.saved[0]!.mediaType).toBe('image/png')
      const history = await readFile(join(store, 'history.jsonl'), 'utf8')
      expect(history).toContain('"model":"qwen-image-3.0"')
      expect(history).toContain('"status":"generated"')
      // 工作区不再出现运行时产物目录
      await expect(readdir(join(dir, 'design'))).rejects.toThrow()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('resolves reference against the workspace root and sniffs the real media type', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-uimock-composition-'))
    try {
      // 参考图放在工作区内; 测试进程 CWD 是仓库根, 若 reference 相对进程 CWD 解析则必然 ENOENT
      await mkdir(join(dir, 'assets'), { recursive: true })
      const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
      await writeFile(join(dir, 'assets/base.png'), pngSignature)
      const booted = await bootComposition(dir)
      let createBody = ''
      vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
        if (url.includes('image-generation/generation')) {
          createBody = typeof init?.body === 'string' ? init.body : ''
          return new Response(
            JSON.stringify({ output: { task_id: 'task-ref', task_status: 'PENDING' } }),
            { status: 200 },
          )
        }
        if (url.includes('/api/v1/tasks/task-ref')) {
          return new Response(
            JSON.stringify({
              output: {
                task_id: 'task-ref',
                task_status: 'SUCCEEDED',
                choices: [{ message: { content: [{ image: 'https://oss.example/mock.png' }] } }],
              },
            }),
            { status: 200 },
          )
        }
        if (url.includes('oss.example')) {
          // 故意返回 octet-stream: 媒体类型应由魔数嗅探纠正为 png
          return new Response(Buffer.concat([pngSignature, Buffer.from([0x00])]), {
            status: 200,
            headers: { 'content-type': 'application/octet-stream' },
          })
        }
        throw new Error(`unexpected fetch: ${url}`)
      })

      const definition = booted.tools.registered.find((item) => item.name === 'ui_mockup')!
      const execute = definition.execute as (
        args: Record<string, unknown>,
        exec: { signal: AbortSignal; agent?: { session: { header: { cwd?: string } } } },
      ) => Promise<Record<string, unknown>>
      const value = await execute(
        {
          description: '图书详情页',
          fidelity: 'high-fidelity',
          platform: 'web',
          reference: 'assets/base.png',
        },
        { signal: new AbortController().signal, agent: { session: { header: { cwd: dir } } } },
      )

      expect(value.ok).toBe(true)
      expect(createBody).toContain('data:image/png;base64,')
      const images = value.images as Array<{ mediaType: string; path: string }>
      expect(images[0]!.mediaType).toBe('image/png')
      expect(images[0]!.path.endsWith('.png')).toBe(true)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('rejects a reference path escaping the workspace root', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-uimock-composition-'))
    try {
      const booted = await bootComposition(dir)
      vi.stubGlobal('fetch', async () => {
        throw new Error('unexpected fetch: escaping reference must be rejected before any request')
      })
      const definition = booted.tools.registered.find((item) => item.name === 'ui_mockup')!
      const execute = definition.execute as (
        args: Record<string, unknown>,
        exec: { signal: AbortSignal; agent?: { session: { header: { cwd?: string } } } },
      ) => Promise<Record<string, unknown>>
      const value = await execute(
        {
          description: '任意页面',
          fidelity: 'wireframe',
          platform: 'web',
          reference: '../../etc/passwd',
        },
        { signal: new AbortController().signal, agent: { session: { header: { cwd: dir } } } },
      )
      expect(value.ok).toBe(false)
      expect(value.message).toContain('INVALID_PARAMETER')
      expect(String(value.message)).not.toContain(dir)
      expect(String(value.message)).toContain('../../etc/passwd')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('registers the image route and serves design/images/ without escaping', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-uimock-composition-'))
    try {
      const booted = await bootComposition(dir)
      const route = booted.webServer.routes.find(
        (item) => item.kind === 'prefix' && item.path === '/ui-mockup/images',
      )
      expect(route).toBeDefined()

      const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00])
      const storeA = storeDirFor(dir)
      await mkdir(join(storeA, 'images'), { recursive: true })
      await writeFile(join(storeA, 'images/mockup-a.png'), png)

      // 正常命中：返回 200 与图片字节，Content-Type 与扩展名一致
      const ok = await dispatchRoute(route!.handler, '/ui-mockup/images/mockup-a.png')
      expect(ok.status).toBe(200)
      expect(ok.body).toEqual(png)
      expect(ok.headers?.['Content-Type']).toBe('image/png')

      // 合法文件名但资产不存在：明确返回 404，不与路径/工作区拒绝的 400 混淆
      const missing = await dispatchRoute(route!.handler, '/ui-mockup/images/mockup-missing.png')
      expect(missing.status).toBe(404)
      expect(missing.body).toBeUndefined()

      // 路径逃逸（URL 规范化后脱离前缀）：拒绝
      const escaped = await dispatchRoute(route!.handler, '/ui-mockup/images/../../secret.png')
      expect(escaped.status).toBe(400)

      // 路径逃逸（%2e%2e%2f 编码，绕过 URL 规范化、命中 basename 检查）：拒绝
      const encoded = await dispatchRoute(route!.handler, '/ui-mockup/images/%2e%2e%2fsecret.png')
      expect(encoded.status).toBe(400)

      // 未知 cwd（不在信任源内）：拒绝，防本机网页借 ?cwd= 探测任意目录
      const unknownDir = await mkdtemp(join(tmpdir(), 'dsh-uimock-unknown-'))
      const probed = await dispatchRoute(
        route!.handler,
        `/ui-mockup/images/mockup-a.png?cwd=${encodeURIComponent(unknownDir)}`,
      )
      expect(probed.status).toBe(400)
      await rm(unknownDir, { recursive: true, force: true })

      // cwd 信任路径：先在 otherDir 会话真实执行一次生成（登记其工作区根），
      // 此后卡片凭 cwd 可回读该工作区的生成图
      const otherDir = await mkdtemp(join(tmpdir(), 'dsh-uimock-other-'))
      vi.stubGlobal('fetch', async (url: string) => {
        if (url.includes('image-generation/generation')) {
          return new Response(
            JSON.stringify({ output: { task_id: 'task-route', task_status: 'PENDING' } }),
            { status: 200 },
          )
        }
        if (url.includes('/api/v1/tasks/task-route')) {
          return new Response(
            JSON.stringify({
              output: {
                task_status: 'SUCCEEDED',
                choices: [{ message: { content: [{ image: 'https://oss.example/m.png' }] } }],
              },
            }),
            { status: 200 },
          )
        }
        if (url.includes('oss.example')) {
          return new Response(png, { status: 200, headers: { 'content-type': 'image/png' } })
        }
        throw new Error(`unexpected fetch: ${url}`)
      })
      const definition = booted.tools.registered.find((item) => item.name === 'ui_mockup')!
      const execute = definition.execute as (
        args: Record<string, unknown>,
        exec: { signal: AbortSignal; agent?: { session: { header: { cwd?: string } } } },
      ) => Promise<Record<string, unknown>>
      const value = await execute(
        { description: '另一会话的页面', fidelity: 'wireframe', platform: 'web' },
        { signal: new AbortController().signal, agent: { session: { header: { cwd: otherDir } } } },
      )
      expect(value.ok).toBe(true)
      vi.unstubAllGlobals()

      const storeB = storeDirFor(otherDir)
      await mkdir(join(storeB, 'images'), { recursive: true })
      await writeFile(join(storeB, 'images/mockup-b.png'), png)
      const byCwd = await dispatchRoute(
        route!.handler,
        `/ui-mockup/images/mockup-b.png?cwd=${encodeURIComponent(otherDir)}`,
      )
      expect(byCwd.status).toBe(200)
      expect(byCwd.body).toEqual(png)
      await rm(otherDir, { recursive: true, force: true })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('registers the /ui-mockup rpc channel and the preferences namespace', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-uimock-composition-'))
    try {
      const booted = await bootComposition(dir)
      expect(booted.connection.channels.has('/ui-mockup')).toBe(true)
      expect(booted.settings.namespaces).toContain('ui-mockup')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('auto-injects the style anchor as reference when the call omits one', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-uimock-composition-'))
    try {
      // 预置锚点：资产库内 mockup-seed.png + anchor.json（与面板 anchor/set 的落盘一致）
      const seedStore = storeDirFor(dir)
      await mkdir(join(seedStore, 'images'), { recursive: true })
      const seed = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
      await writeFile(join(seedStore, 'images/mockup-seed.png'), seed)
      await writeFile(
        join(seedStore, 'anchor.json'),
        `${JSON.stringify({ file: 'mockup-seed.png', time: '2026-08-27T00:00:00Z' })}\n`,
      )

      const booted = await bootComposition(dir)
      let createBody = ''
      vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
        if (url.includes('image-generation/generation')) {
          createBody = typeof init?.body === 'string' ? init.body : ''
          return new Response(
            JSON.stringify({ output: { task_id: 'task-anchor', task_status: 'PENDING' } }),
            { status: 200 },
          )
        }
        if (url.includes('/api/v1/tasks/task-anchor')) {
          return new Response(
            JSON.stringify({
              output: {
                task_id: 'task-anchor',
                task_status: 'SUCCEEDED',
                choices: [
                  {
                    finish_reason: 'stop',
                    message: {
                      role: 'assistant',
                      content: [{ image: 'https://oss.example/m.png', type: 'image' }],
                    },
                  },
                ],
              },
            }),
            { status: 200 },
          )
        }
        if (url.includes('oss.example')) {
          return new Response(seed, { status: 200, headers: { 'content-type': 'image/png' } })
        }
        throw new Error(`unexpected fetch: ${url}`)
      })

      const definition = booted.tools.registered.find((item) => item.name === 'ui_mockup')!
      const execute = definition.execute as (
        args: Record<string, unknown>,
        exec: { signal: AbortSignal; agent?: { session: { header: { cwd?: string } } } },
      ) => Promise<Record<string, unknown>>
      const value = await execute(
        { description: '续画第二个页面', fidelity: 'high-fidelity', platform: 'web' },
        { signal: new AbortController().signal, agent: { session: { header: { cwd: dir } } } },
      )
      expect(value.ok, String(value.message)).toBe(true)
      // 锚点图以 base64 进入 I2I 输入；结果消息提示已注入
      expect(createBody).toContain('data:image/png;base64,')
      expect(String(value.message)).toContain('风格锚点')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('auto-injects the style anchor for Wan 2.7', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-uimock-composition-'))
    try {
      // 预置锚点（同上），并把线框层默认模型切到支持参考图的 Wan 2.7
      const seedStore = storeDirFor(dir)
      await mkdir(join(seedStore, 'images'), { recursive: true })
      const seed = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
      await writeFile(join(seedStore, 'images/mockup-seed.png'), seed)
      await writeFile(
        join(seedStore, 'anchor.json'),
        `${JSON.stringify({ file: 'mockup-seed.png', time: '2026-08-27T00:00:00Z' })}\n`,
      )

      const booted = await bootComposition(dir)
      booted.settings.resolved.wireframeModel = 'wan2.7-image'
      let createUrl = ''
      let createBody = ''
      vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
        if (url.includes('/api/v1/services/aigc/image-generation/generation')) {
          createUrl = url
          createBody = typeof init?.body === 'string' ? init.body : ''
          return new Response(
            JSON.stringify({ output: { task_id: 'task-wan', task_status: 'PENDING' } }),
            { status: 200 },
          )
        }
        if (url.includes('/api/v1/tasks/task-wan')) {
          return new Response(
            JSON.stringify({
              output: {
                task_id: 'task-wan',
                task_status: 'SUCCEEDED',
                choices: [
                  {
                    message: {
                      content: [{ image: 'https://oss.example/wan.png' }],
                    },
                  },
                ],
              },
            }),
            { status: 200 },
          )
        }
        if (url.includes('oss.example')) {
          return new Response(seed, { status: 200, headers: { 'content-type': 'image/png' } })
        }
        throw new Error(`unexpected fetch: ${url}`)
      })

      const definition = booted.tools.registered.find((item) => item.name === 'ui_mockup')!
      const execute = definition.execute as (
        args: Record<string, unknown>,
        exec: { signal: AbortSignal; agent?: { session: { header: { cwd?: string } } } },
      ) => Promise<Record<string, unknown>>
      const value = await execute(
        { description: 'wan 系模型下的页面', fidelity: 'wireframe', platform: 'web' },
        { signal: new AbortController().signal, agent: { session: { header: { cwd: dir } } } },
      )
      expect(value.ok, String(value.message)).toBe(true)
      expect(createUrl).toContain('/api/v1/services/aigc/image-generation/generation')
      expect(createBody).toContain('data:image/png;base64,')
      expect(String(value.message)).toContain('已按风格锚点')
      expect(String(value.message)).not.toContain('已跳过风格锚点注入')
      // 锚点保持不变，后续 Wan 2.7 与 Qwen 均可继续联动
      const overview = valueOf<{ anchor: string | null }>(
        await booted.connection.call('/ui-mockup', 'overview'),
      )
      expect(overview.anchor).toBe('mockup-seed.png')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('reports missing credentials with a machine reason from test-connection', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-uimock-composition-'))
    try {
      vi.stubEnv('DASHSCOPE_API_KEY', '')
      const booted = await bootComposition(dir)
      const overview = valueOf<{ credential: { configured: boolean } }>(
        await booted.connection.call('/ui-mockup', 'overview'),
      )
      expect(overview.credential.configured).toBe(false)
      // 缺密钥时必须短路返回 missing-key, 不得发起真实网络请求
      const tested = valueOf<{ ok: boolean; reason?: string }>(
        await booted.connection.call('/ui-mockup', 'test-connection'),
      )
      expect(tested.ok).toBe(false)
      expect(tested.reason).toBe('missing-key')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('stores and clears the key via credential endpoints, reflecting source layers', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-uimock-composition-'))
    try {
      vi.stubEnv('DASHSCOPE_API_KEY', '')
      const booted = await bootComposition(dir)
      const call = (endpoint: string, payload?: unknown) =>
        booted.connection.call('/ui-mockup', endpoint, payload)

      // 环境层缺席 → 存储可写；写入即覆盖且响应只含三个状态事实（永不回值）
      const stored = valueOf<{
        credential: { configured: boolean; source?: string; writable: boolean }
      }>(await call('credential/set', { value: 'sk-panel-written' }))
      expect(stored.credential).toEqual({ configured: true, source: 'file', writable: true })
      expect(JSON.stringify(stored)).not.toContain('sk-panel-written')
      const creds = booted.ctx.get('credentials') as unknown as CredentialsStub
      expect(creds.stored.get('DASHSCOPE_API_KEY')).toBe('sk-panel-written')

      // 概览立即反映存储层来源
      const overview = valueOf<{ credential: { configured: boolean; source?: string } }>(
        await call('overview'),
      )
      expect(overview.credential).toMatchObject({ configured: true, source: 'file' })

      // 空值拒绝
      const empty = await call('credential/set', { value: '   ' })
      expect(empty.ok).toBe(false)
      if (!empty.ok) expect(empty.error.code).toBe('INVALID_PARAMETER')

      // 清除 → 回到未配置
      const cleared = valueOf<{ credential: { configured: boolean } }>(
        await call('credential/unset'),
      )
      expect(cleared.credential.configured).toBe(false)
      expect(creds.stored.has('DASHSCOPE_API_KEY')).toBe(false)

      // 环境层遮蔽时：describe 报 writable=false, 写入被拒绝并透传原因
      vi.stubEnv('DASHSCOPE_API_KEY', 'sk-from-env')
      const shadowed = valueOf<{
        credential: { configured: boolean; source?: string; writable: boolean }
      }>(await call('overview'))
      expect(shadowed.credential).toEqual({ configured: true, source: 'env', writable: false })
      const rejected = await call('credential/set', { value: 'sk-new' })
      expect(rejected.ok).toBe(false)
      if (!rejected.ok) expect(rejected.error.code).toBe('CREDENTIAL_WRITE_FAILED')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('classifies test-connection outcomes from gateway responses', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-uimock-composition-'))
    try {
      vi.stubEnv('DASHSCOPE_API_KEY', 'sk-env-key')
      const booted = await bootComposition(dir)
      const probe = async () =>
        valueOf<{ ok: boolean; reason?: string; detail?: string }>(
          await booted.connection.call('/ui-mockup', 'test-connection'),
        )

      // 鉴权失败: 401 + InvalidApiKey → invalid-key
      vi.stubGlobal(
        'fetch',
        async () =>
          new Response(JSON.stringify({ code: 'InvalidApiKey', message: 'Invalid API-key' }), {
            status: 401,
          }),
      )
      expect(await probe()).toEqual({ ok: false, reason: 'invalid-key' })

      // 鉴权通过: 有效 key 的空体请求得到 400 参数错误 → ok
      vi.stubGlobal(
        'fetch',
        async () =>
          new Response(JSON.stringify({ code: 'InvalidParameter', message: 'model required' }), {
            status: 400,
          }),
      )
      expect(await probe()).toEqual({ ok: true, reason: 'ok' })

      // 429 限流也说明鉴权已通过 → ok
      vi.stubGlobal(
        'fetch',
        async () =>
          new Response(JSON.stringify({ code: 'Throttling.RateQuota', request_id: 'x' }), {
            status: 429,
          }),
      )
      expect(await probe()).toEqual({ ok: true, reason: 'ok' })

      // 未知响应（如未来网关对无效 key 改返 403）→ unknown 灰态，不误报成功
      vi.stubGlobal(
        'fetch',
        async () =>
          new Response(JSON.stringify({ code: 'Forbidden', message: 'forbidden' }), {
            status: 403,
          }),
      )
      expect(await probe()).toEqual({ ok: false, reason: 'unknown', detail: 'HTTP 403 Forbidden' })

      // 网络层失败 → gateway + 原始错误
      vi.stubGlobal('fetch', async () => {
        throw new TypeError('fetch failed')
      })
      expect(await probe()).toMatchObject({ ok: false, reason: 'gateway' })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('serves overview/history/anchor/clear endpoints with trust boundary on cwd', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-uimock-composition-'))
    try {
      const booted = await bootComposition(dir)

      // 制造两条历史（直接写资产库文件，避免依赖生成流程）
      const epStore = storeDirFor(dir)
      await mkdir(join(epStore, 'images'), { recursive: true })
      await writeFile(join(epStore, 'images/mockup-h1.png'), Buffer.from([0x01]))
      await writeFile(
        join(epStore, 'history.jsonl'),
        [
          JSON.stringify({
            time: '2026-08-27T00:00:01Z',
            files: ['design/images/mockup-h1.png'],
            description: '登录页线框',
            model: 'qwen-image-3.0',
            fidelity: 'wireframe',
            platform: 'web',
            status: 'generated',
          }),
          JSON.stringify({
            time: '2026-08-27T00:00:02Z',
            files: ['design/images/mockup-nope.png'],
            description: '账单页高保真',
            model: 'qwen-image-3.0-pro',
            fidelity: 'high-fidelity',
            platform: 'web',
            status: 'generated',
          }),
          '',
        ].join('\n'),
      )

      const call = (endpoint: string, payload?: unknown) =>
        booted.connection.call('/ui-mockup', endpoint, payload)

      // 概览：凭据来自环境 stub，无锚点
      const overviewValue = valueOf<{
        provider: string
        credential: { configured: boolean }
        anchor: null
      }>(await call('overview'))
      expect(overviewValue.provider).toBe('dashscope')
      expect(overviewValue.credential.configured).toBe(true)
      expect(overviewValue.anchor).toBeNull()

      // 历史：默认全部、按 query 过滤、anchored 初始为 false
      const listAll = valueOf<{ entries: Array<{ description: string; anchored: boolean }> }>(
        await call('history/list', { cwd: dir }),
      )
      expect(listAll.entries).toHaveLength(2)
      const listFiltered = valueOf<{ entries: unknown[] }>(
        await call('history/list', { cwd: dir, query: '登录' }),
      )
      expect(listFiltered.entries).toHaveLength(1)

      // 不在信任源内的 cwd 拒绝
      const stranger = await mkdtemp(join(tmpdir(), 'dsh-uimock-stranger-'))
      const denied = await call('history/list', { cwd: stranger })
      expect(denied.ok).toBe(false)
      if (!denied.ok) expect(denied.error.code).toBe('UNTRUSTED_WORKSPACE')
      await rm(stranger, { recursive: true, force: true })

      // 设为锚点 → anchored 标记 + 概览可见锚点（历史按新→旧排列，按描述定位目标行）
      const setAnchor = await call('anchor/set', { cwd: dir, file: 'mockup-h1.png' })
      expect(setAnchor.ok).toBe(true)
      const listAnchored = valueOf<{
        entries: Array<{ description: string; anchored: boolean }>
      }>(await call('history/list', { cwd: dir }))
      const anchorRow = listAnchored.entries.find((entry) => entry.description === '登录页线框')
      expect(anchorRow?.anchored).toBe(true)
      expect(
        listAnchored.entries.find((entry) => entry.description === '账单页高保真')?.anchored,
      ).toBe(false)
      const overviewAfter = valueOf<{ anchor: string | null }>(await call('overview'))
      expect(overviewAfter.anchor).toBe('mockup-h1.png')

      // 清空历史 → 文件归零且锚点一并解除
      expect((await call('history/clear', { cwd: dir })).ok).toBe(true)
      expect(await readFile(join(epStore, 'history.jsonl'), 'utf8')).toBe('')
      const overviewCleared = valueOf<{ anchor: string | null }>(await call('overview'))
      expect(overviewCleared.anchor).toBeNull()

      // anchor/set 对不存在的文件名给出明确错误码
      const missing = await call('anchor/set', { cwd: dir, file: 'mockup-missing.png' })
      expect(missing.ok).toBe(false)
      if (!missing.ok) expect(missing.error.code).toBe('NOT_FOUND')

      // 图片文件本体不被清空历史删除
      await expect(readFile(join(epStore, 'images/mockup-h1.png'))).resolves.toBeDefined()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('paginates history/list with total, clamped page and anchor index', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-uimock-composition-'))
    try {
      const epStore = storeDirFor(dir)
      await mkdir(join(epStore, 'images'), { recursive: true })
      // 造 10 条历史（pageSize 8 → 2 页；默认 pageSize 5 → 2 页），第 3 条设为锚点（过滤后索引 2 → 第 1 页）
      const lines: string[] = []
      for (let i = 0; i < 10; i++) {
        const file = `mockup-p${i}.png`
        await writeFile(join(epStore, 'images', file), Buffer.from([0x01]))
        lines.push(
          JSON.stringify({
            time: `2026-08-27T00:00:${String(i).padStart(2, '0')}Z`,
            files: [`design/images/${file}`],
            description: `分页测试第 ${i} 条`,
            model: 'qwen-image-3.0',
            fidelity: 'wireframe',
            platform: 'web',
            status: 'generated',
          }),
        )
      }
      await writeFile(join(epStore, 'history.jsonl'), `${lines.join('\n')}\n`)
      await writeFile(
        join(epStore, 'anchor.json'),
        `${JSON.stringify({ file: 'mockup-p2.png', time: '2026-08-27T00:00:00Z' })}\n`,
      )

      const booted = await bootComposition(dir)
      const call = (endpoint: string, payload?: unknown) =>
        booted.connection.call('/ui-mockup', endpoint, payload)

      // 第 1 页：8 条，total 10，锚点索引 7（最新在前，p2 排第 8 → 0-based 7）在第 1 页
      const p1 = valueOf<{
        entries: unknown[]
        total: number
        page: number
        pageSize: number
        anchorIndex: number
      }>(await call('history/list', { cwd: dir, page: 1, pageSize: 8 }))
      expect(p1.entries).toHaveLength(8)
      expect(p1.total).toBe(10)
      expect(p1.page).toBe(1)
      expect(p1.pageSize).toBe(8)
      expect(p1.anchorIndex).toBe(7)

      // 第 2 页：剩余 2 条
      const p2 = valueOf<{ entries: unknown[]; page: number }>(
        await call('history/list', { cwd: dir, page: 2, pageSize: 8 }),
      )
      expect(p2.entries).toHaveLength(2)
      expect(p2.page).toBe(2)

      // 越界页码钳制到最后一页
      const clamped = valueOf<{ entries: unknown[]; page: number }>(
        await call('history/list', { cwd: dir, page: 99, pageSize: 8 }),
      )
      expect(clamped.page).toBe(2)
      expect(clamped.entries).toHaveLength(2)

      // 非法 pageSize 钳制到 [1,50]（负数取下限 1，非有限数回退默认 5）
      const badSize = valueOf<{ pageSize: number }>(
        await call('history/list', { cwd: dir, page: 1, pageSize: -3 }),
      )
      expect(badSize.pageSize).toBe(1)
      const nanSize = valueOf<{ pageSize: number }>(
        await call('history/list', { cwd: dir, page: 1, pageSize: Number.NaN }),
      )
      expect(nanSize.pageSize).toBe(5)

      // 不传 pageSize 走服务端默认 5（面板契约：默认值被误改时此处会红）
      const defaulted = valueOf<{ entries: unknown[]; pageSize: number; total: number }>(
        await call('history/list', { cwd: dir }),
      )
      expect(defaulted.pageSize).toBe(5)
      expect(defaulted.entries).toHaveLength(5)
      expect(defaulted.total).toBe(10)

      // 过滤 + 分页组合：query 命中的 4 条（描述含「第 2」仅 1 条，改用子集描述）
      // 这里用锚点所在条目的描述子串验证 anchorIndex 是相对过滤后列表的：
      // 锚点 mockup-p2.png 描述「分页测试第 2 条」，query=「第 2」仅命中它 → total 1、索引 0
      const filtered = valueOf<{
        entries: Array<{ description: string; anchored: boolean }>
        total: number
        anchorIndex: number
      }>(await call('history/list', { cwd: dir, query: '第 2', page: 1, pageSize: 8 }))
      expect(filtered.total).toBe(1)
      expect(filtered.anchorIndex).toBe(0)
      expect(filtered.entries[0]?.anchored).toBe(true)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('skips corrupted history lines and still serves the valid entries', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-uimock-composition-'))
    try {
      const epStore = storeDirFor(dir)
      await mkdir(join(epStore, 'images'), { recursive: true })
      // 损坏行来源：进程中断的半截 JSON、非 JSON 垃圾、空行（验收 §5「历史损坏行」场景）
      await writeFile(
        join(epStore, 'history.jsonl'),
        [
          JSON.stringify({
            time: '2026-08-27T00:00:01Z',
            files: ['design/images/mockup-ok1.png'],
            description: '损坏行之间的有效记录',
            model: 'qwen-image-3.0',
            fidelity: 'wireframe',
            platform: 'web',
            status: 'generated',
          }),
          '{"time": "2026-08-27T00:00:02Z", "files": [',
          'not json at all',
          '',
          JSON.stringify({
            time: '2026-08-27T00:00:03Z',
            files: ['design/images/mockup-ok2.png'],
            description: '较新的有效记录',
            model: 'qwen-image-3.0',
            fidelity: 'wireframe',
            platform: 'web',
            status: 'generated',
          }),
          '',
        ].join('\n'),
      )

      const booted = await bootComposition(dir)
      const listed = valueOf<{
        entries: Array<{ description: string }>
        total: number
      }>(await booted.connection.call('/ui-mockup', 'history/list', { cwd: dir }))
      // 损坏行被跳过而非报错；有效条目按新→旧排列
      expect(listed.total).toBe(2)
      expect(listed.entries.map((entry) => entry.description)).toEqual([
        '较新的有效记录',
        '损坏行之间的有效记录',
      ])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('treats an unreadable history file as an empty list instead of failing', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-uimock-composition-'))
    try {
      const epStore = storeDirFor(dir)
      await mkdir(join(epStore, 'images'), { recursive: true })
      // 用同名目录占位：readFile 抛 EISDIR，确定性模拟磁盘损坏/不可读，
      // 不依赖文件权限（避免 root 环境下 chmod 用例失效）
      await mkdir(join(epStore, 'history.jsonl'))

      const booted = await bootComposition(dir)
      const listed = valueOf<{ entries: unknown[]; total: number }>(
        await booted.connection.call('/ui-mockup', 'history/list', { cwd: dir }),
      )
      expect(listed.total).toBe(0)
      expect(listed.entries).toEqual([])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('boots the volcengine provider when the bundle row flips disabled', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-uimock-composition-'))
    try {
      const booted = await bootComposition(dir, { provider: 'volcengine' })
      // 两行并存但单槽位只生效一个：禁用的 dashscope 不注册，火山行胜出
      const service = booted.ctx.get('image') as unknown as InstanceType<
        typeof VolcengineImageProvider
      >
      expect(service).toBeInstanceOf(VolcengineImageProvider)
      expect(service.providerId).toBe('volcengine')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('executes the edit flow end-to-end on the volcengine provider', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-uimock-composition-'))
    try {
      const booted = await bootComposition(dir, { provider: 'volcengine' })
      // 基准图预置进资产库（design/images/ 前缀 → 资产库路径翻译的编辑路径验证）
      const store = storeDirFor(dir)
      await mkdir(join(store, 'images'), { recursive: true })
      const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00])
      await writeFile(join(store, 'images', 'mockup-base.png'), pngBytes)

      const editBodies: Array<Record<string, unknown>> = []
      vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
        if (url.includes('/images/generations')) {
          // 请求体恒为 Provider JSON.stringify 的字符串，收窄以通过 no-base-to-string
          editBodies.push(JSON.parse(init?.body as string) as Record<string, unknown>)
          return new Response(
            JSON.stringify({
              model: 'doubao-seedream-5-0-pro-260628',
              created: 0,
              data: [{ url: 'https://ark-cdn.example/edited.png' }],
            }),
            { status: 200 },
          )
        }
        if (url.includes('ark-cdn.example')) {
          return new Response(pngBytes, { status: 200, headers: { 'content-type': 'image/png' } })
        }
        throw new Error(`unexpected fetch: ${url}`)
      })

      const definition = booted.tools.registered.find((item) => item.name === 'ui_mockup')!
      const execute = definition.execute as (
        args: Record<string, unknown>,
        exec: { signal: AbortSignal; agent?: { session: { header: { cwd?: string } } } },
      ) => Promise<Record<string, unknown>>
      const value = await execute(
        {
          description: '保持其余不变',
          fidelity: 'wireframe',
          platform: 'web',
          baseImage: 'design/images/mockup-base.png',
          editNote: '把主按钮改成绿色',
        },
        { signal: new AbortController().signal, agent: { session: { header: { cwd: dir } } } },
      )

      expect(value.ok, String(value.message)).toBe(true)
      // 编辑请求直达方舟同步端点：Seedream 模型 + 基准图 data URL + 编辑指令
      expect(editBodies).toHaveLength(1)
      expect(editBodies[0]).toMatchObject({
        model: 'doubao-seedream-5-0-pro-260628',
        prompt: '把主按钮改成绿色',
        response_format: 'url',
        size: '2K',
        watermark: false,
      })
      const image = editBodies[0]!.image as string[]
      expect(image[0]).toMatch(/^data:image\/png;base64,/)
      // 结果落资产库 + 附件 + 历史标记 edited
      const images = value.images as Array<{ path: string }>
      expect(images).toHaveLength(1)
      expect(String(value.message)).toContain(`design/images/${basename(images[0]!.path)}`)
      expect(String(value.message)).not.toContain(store)
      expect(booted.attachments.saved).toHaveLength(1)
      const history = await readFile(join(store, 'history.jsonl'), 'utf8')
      expect(history).toContain('"status":"edited"')
      expect(history).toContain('doubao-seedream-5-0-pro-260628')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('rejects a half-specified edit call with a pairing hint', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-uimock-composition-'))
    try {
      const booted = await bootComposition(dir, { provider: 'volcengine' })
      const definition = booted.tools.registered.find((item) => item.name === 'ui_mockup')!
      const execute = definition.execute as (
        args: Record<string, unknown>,
        exec: { signal: AbortSignal; agent?: { session: { header: { cwd?: string } } } },
      ) => Promise<Record<string, unknown>>
      const value = await execute(
        {
          description: '只传了基准图',
          fidelity: 'wireframe',
          platform: 'web',
          baseImage: 'design/images/mockup-base.png',
        },
        { signal: new AbortController().signal, agent: { session: { header: { cwd: dir } } } },
      )
      expect(value.ok).toBe(false)
      expect(String(value.message)).toContain('成对')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('缺失的语义基准图只回显语义路径，不泄露资产库绝对路径', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-uimock-composition-'))
    try {
      const booted = await bootComposition(dir, { provider: 'volcengine' })
      const definition = booted.tools.registered.find((item) => item.name === 'ui_mockup')!
      const execute = definition.execute as (
        args: Record<string, unknown>,
        exec: { signal: AbortSignal; agent?: { session: { header: { cwd?: string } } } },
      ) => Promise<Record<string, unknown>>
      const value = await execute(
        {
          description: '编辑缺失基准图',
          fidelity: 'high-fidelity',
          platform: 'web',
          baseImage: 'design/images/mockup-missing.png',
          editNote: '把按钮改成橙色',
        },
        { signal: new AbortController().signal, agent: { session: { header: { cwd: dir } } } },
      )

      expect(value.ok).toBe(false)
      expect(String(value.message)).toContain('design/images/mockup-missing.png')
      expect(String(value.message)).not.toContain(storeDirFor(dir))
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('语义图片路径穿越在翻译层拒绝且不泄露资产库父目录', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-uimock-composition-'))
    try {
      const booted = await bootComposition(dir, { provider: 'volcengine' })
      const definition = booted.tools.registered.find((item) => item.name === 'ui_mockup')!
      const execute = definition.execute as (
        args: Record<string, unknown>,
        exec: { signal: AbortSignal; agent?: { session: { header: { cwd?: string } } } },
      ) => Promise<Record<string, unknown>>
      const reference = 'design/images/../../outside.png'
      const value = await execute(
        {
          description: '编辑越界基准图',
          fidelity: 'high-fidelity',
          baseImage: reference,
          editNote: '把按钮改成橙色',
        },
        { signal: new AbortController().signal, agent: { session: { header: { cwd: dir } } } },
      )

      expect(value.ok).toBe(false)
      expect(String(value.message)).toContain('INVALID_PARAMETER')
      expect(String(value.message)).toContain(reference)
      expect(String(value.message)).not.toContain(resolve(storeDirFor(dir), '..'))
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('writes the provider switch into the home user patch layer and reports pending', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-uimock-composition-'))
    try {
      const booted = await bootComposition(dir)
      const call = (endpoint: string, payload?: unknown) =>
        booted.connection.call('/ui-mockup', endpoint, payload)

      // 幂等：已生效提供方的切换直接返回，不写文件
      const idempotent = valueOf<{ active: string }>(
        await call('provider/switch', { provider: 'dashscope' }),
      )
      expect(idempotent.active).toBe('dashscope')

      // 非法 provider 拒绝
      const invalid = await call('provider/switch', { provider: 'openai' })
      expect(invalid.ok).toBe(false)

      // 切到火山：文件写入 home 用户层（DSH_HOME 被隔离为临时目录）；
      // 组合测试环境没有 launcher 的 HMR watcher，轮询等待落位（8s 上限）超时后
      // 如实上报 pending 而不是谎报成功。翻转语义由 mergeProviderSwitchRows 单测覆盖。
      const switched = valueOf<{ active: string; pending?: boolean }>(
        await call('provider/switch', { provider: 'volcengine' }),
      )
      expect(switched.pending).toBe(true)
      expect(switched.active).toBe('dashscope')

      const homePatch = await readFile(join(process.env['DSH_HOME']!, 'cordis.patch.yml'), 'utf8')
      expect(homePatch).toContain('id: image-dashscope')
      expect(homePatch).toContain('disabled: true')
      expect(homePatch).toContain('id: image-volcengine')
      expect(homePatch).toContain('disabled: false')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }, 20_000)

  it('refuses to rewrite a user patch layer it cannot safely parse', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-uimock-composition-'))
    try {
      const booted = await bootComposition(dir)
      const call = (endpoint: string, payload?: unknown) =>
        booted.connection.call('/ui-mockup', endpoint, payload)
      const patchFile = join(process.env['DSH_HOME']!, 'cordis.patch.yml')

      // !!js 表达式是宿主专有 schema：代写会把表达式物化成字面值，必须中止并专项提示
      const jsExpr = '- id: image-dashscope\n  config: !!js/process.env.X\n'
      await writeFile(patchFile, jsExpr, 'utf8')
      const jsResult = await call('provider/switch', { provider: 'volcengine' })
      expect(jsResult.ok).toBe(false)
      if (!jsResult.ok) expect(jsResult.error.message).toContain('!!js')
      expect(await readFile(patchFile, 'utf8')).toBe(jsExpr)

      // 合法 YAML 但非顶层数组同样是坏 patch：中止而不是用空数组覆盖
      const notArray = 'just: a-mapping\n'
      await writeFile(patchFile, notArray, 'utf8')
      const mapResult = await call('provider/switch', { provider: 'volcengine' })
      expect(mapResult.ok).toBe(false)
      if (!mapResult.ok) expect(mapResult.error.message).toContain('YAML')
      expect(await readFile(patchFile, 'utf8')).toBe(notArray)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

/** 断言 RPC 成功并取出值；给组合测试一个统一的窄化入口。 */
function valueOf<T>(result: CompositionRpcResult): T {
  if (!result.ok) throw new Error(`[${result.error.code}] ${result.error.message}`)
  return result.value as T
}

/** 以记录式响应桩调用一次路由 handler。 */
async function dispatchRoute(
  handler: (req: { url?: string }, res: RouteResponse) => void | Promise<void>,
  url: string,
): Promise<{ status: number; body?: Buffer; headers?: Record<string, unknown> }> {
  let status = 0
  let body: Buffer | undefined
  let headers: Record<string, unknown> | undefined
  const res: RouteResponse = {
    writeHead(next: number, written?: Record<string, unknown>) {
      status = next
      headers = written
    },
    end(chunk?: Buffer) {
      body = chunk
    },
  }
  await handler({ url }, res)
  return { status, body, headers }
}
