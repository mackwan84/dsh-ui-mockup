import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context, Service } from '@deepseek-ai/cordis'
import Include from '@deepseek-ai/cordis-plugin-include'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import { ImageGenerationService } from '@mackwan84/dsh-image'
import DashscopeImageProvider from '@mackwan84/dsh-image-dashscope'
import {
  apply as uiMockupApply,
  inject as uiMockupInject,
  name as uiMockupName,
} from '@mackwan84/dsh-tool-ui-mockup'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/** 凭据桩：从进程环境按引用名读取。 */
class CredentialsStub extends Service {
  constructor(ctx: Context) {
    super(ctx, 'credentials')
  }

  async resolve(ref: string) {
    const value = process.env[ref]
    return value !== undefined && value !== '' ? { value } : undefined
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

/** settings 服务桩：接受命名空间注册，resolved 值 = 默认 + 组合 base。 */
class SettingsStub extends Service {
  readonly namespaces: string[] = []

  constructor(ctx: Context) {
    super(ctx, 'settings')
  }

  register(ns: string, _schema: unknown, options?: { base?: Record<string, unknown> }) {
    this.namespaces.push(ns)
    const resolved: Record<string, unknown> = {
      defaultFidelity: 'wireframe',
      defaultPlatform: 'web',
      defaultCount: 2,
      outputDir: 'design/images',
      pollTimeoutMinutes: 10,
      wireframeModel: '',
      highFidelityModel: '',
      defaultSize: '',
      ...options?.base,
    }
    return { get: () => resolved as never }
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

async function bootComposition(dir: string): Promise<Booted> {
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
      '- id: image-dashscope',
      "  name: '@mackwan84/dsh-image-dashscope'",
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

beforeEach(() => {
  vi.stubEnv('DASHSCOPE_API_KEY', 'sk-composition-key')
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

      // 工作区落盘 + 附件 + 历史记录
      const files = await readdir(join(dir, 'design/images'))
      expect(files).toHaveLength(1)
      expect(files[0]!.startsWith('mockup-')).toBe(true)
      expect(booted.attachments.saved).toHaveLength(1)
      expect(booted.attachments.saved[0]!.mediaType).toBe('image/png')
      const history = await readFile(join(dir, 'design/history.jsonl'), 'utf8')
      expect(history).toContain('"model":"qwen-image-3.0"')
      expect(history).toContain('"status":"generated"')
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
                results: [{ url: 'https://oss.example/mock.png' }],
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
      await mkdir(join(dir, 'design/images'), { recursive: true })
      await writeFile(join(dir, 'design/images/mockup-a.png'), png)

      // 正常命中：返回 200 与图片字节，Content-Type 与扩展名一致
      const ok = await dispatchRoute(route!.handler, '/ui-mockup/images/mockup-a.png')
      expect(ok.status).toBe(200)
      expect(ok.body).toEqual(png)
      expect(ok.headers?.['Content-Type']).toBe('image/png')

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
              output: { task_status: 'SUCCEEDED', results: [{ url: 'https://oss.example/m.png' }] },
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

      await writeFile(join(otherDir, 'design/images/mockup-b.png'), png)
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
      // 预置锚点：mockup-seed.png + anchor.json（与面板 anchor/set 的落盘一致）
      await mkdir(join(dir, 'design/images'), { recursive: true })
      const seed = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
      await writeFile(join(dir, 'design/images/mockup-seed.png'), seed)
      await writeFile(
        join(dir, 'design/anchor.json'),
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

  it('reports missing credentials with a machine reason from test-connection', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-uimock-composition-'))
    try {
      vi.stubEnv('DASHSCOPE_API_KEY', '')
      const booted = await bootComposition(dir)
      const overview = valueOf<{ credentialReady: boolean }>(
        await booted.connection.call('/ui-mockup', 'overview'),
      )
      expect(overview.credentialReady).toBe(false)
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

  it('serves overview/history/anchor/clear endpoints with trust boundary on cwd', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-uimock-composition-'))
    try {
      const booted = await bootComposition(dir)

      // 制造两条历史（直接写文件，避免依赖生成流程）
      await mkdir(join(dir, 'design/images'), { recursive: true })
      await writeFile(join(dir, 'design/images/mockup-h1.png'), Buffer.from([0x01]))
      await writeFile(
        join(dir, 'design/history.jsonl'),
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
      const overviewValue = valueOf<{ provider: string; credentialReady: boolean; anchor: null }>(
        await call('overview'),
      )
      expect(overviewValue.provider).toBe('dashscope')
      expect(overviewValue.credentialReady).toBe(true)
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
      expect(await readFile(join(dir, 'design/history.jsonl'), 'utf8')).toBe('')
      const overviewCleared = valueOf<{ anchor: string | null }>(await call('overview'))
      expect(overviewCleared.anchor).toBeNull()

      // anchor/set 对不存在的文件名给出明确错误码
      const missing = await call('anchor/set', { cwd: dir, file: 'mockup-missing.png' })
      expect(missing.ok).toBe(false)
      if (!missing.ok) expect(missing.error.code).toBe('NOT_FOUND')

      // 图片文件本体不被清空历史删除
      await expect(readFile(join(dir, 'design/images/mockup-h1.png'))).resolves.toBeDefined()
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
