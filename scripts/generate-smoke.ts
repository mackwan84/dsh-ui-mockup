/**
 * 真实 API 冒烟测试：用本机 key 跑一次完整链路。
 * 用法：DASHSCOPE_API_KEY=sk-xxx npx tsx scripts/generate-smoke.ts
 *      ARK_API_KEY=ark-xxx npx tsx scripts/generate-smoke.ts --provider volcengine
 *      OPENAI_COMPAT_BASE_URL=https://gw/v1 OPENAI_COMPAT_API_KEY=xxx npx tsx scripts/generate-smoke.ts --provider openai-compat
 * 结果落盘到临时目录（默认 /tmp 下新建），并打印图片路径与附件信息。
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context, Service } from '@deepseek-ai/cordis'
import DashscopeImageProvider from '@mackwan84/dsh-image-dashscope'
import VolcengineImageProvider from '@mackwan84/dsh-image-volcengine'
import OpenaiCompatImageProvider from '@mackwan84/dsh-image-openai-compat'
import {
  apply as toolApply,
  inject as toolInject,
  name as toolName,
} from '@mackwan84/dsh-tool-ui-mockup'

class CredentialsStub extends Service {
  constructor(ctx: Context) {
    super(ctx, 'credentials')
  }

  async resolve(ref: string) {
    const value = process.env[ref]
    return value !== undefined && value !== '' ? { value } : undefined
  }
}

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

class SandboxPolicyStub extends Service {
  constructor(ctx: Context, config: { workspaceRoot: string }) {
    super(ctx, 'sandboxPolicy')
    this.workspaceRoot = config.workspaceRoot
  }

  readonly workspaceRoot: string

  /** 与宿主 sandboxPolicy 同名同语义：execute 里经 resolve 取会话工作区根。 */
  resolve(_request?: { session?: unknown }): { workspaceRoot: string } {
    return { workspaceRoot: this.workspaceRoot }
  }
}

class AttachmentsStub extends Service {
  constructor(ctx: Context) {
    super(ctx, 'attachments')
  }

  async saveImage(input: { data: Uint8Array; mediaType: string; name?: string }) {
    return {
      attachmentId: `smoke-${Date.now()}`,
      mediaType: input.mediaType,
      bytes: input.data.byteLength,
      width: 1280,
      height: 720,
      name: input.name,
    }
  }
}

class SystemPromptStub extends Service {
  constructor(ctx: Context) {
    super(ctx, 'systemPrompt')
  }

  section(_section: { name: string; order: number; text: string }) {
    return () => {}
  }
}

const dir = await mkdtemp(join(tmpdir(), 'dsh-uimock-smoke-'))
// --provider volcengine|openai-compat：切换烟测提供方；默认 DashScope。
// 注意 description 是位置参数，放在 --provider 之前：npx tsx … "描述" --provider volcengine
const providerIndex = process.argv.indexOf('--provider')
const providerName = providerIndex !== -1 ? process.argv[providerIndex + 1] : 'dashscope'
// 未知 provider 值直接报错，避免拼写错误（如 --provider openai-compt）静默回退 DashScope
// 而在真实网关验收时跑错提供方、消耗错额度并得到误导性结论
const KNOWN_PROVIDERS = ['dashscope', 'volcengine', 'openai-compat']
if (!KNOWN_PROVIDERS.includes(providerName ?? '')) {
  console.error(`--provider 只支持 ${KNOWN_PROVIDERS.join(' | ')}，收到: ${String(providerName)}`)
  await rm(dir, { recursive: true, force: true })
  process.exit(1)
}
const useVolcengine = providerName === 'volcengine'
const useOpenaiCompat = providerName === 'openai-compat'
const ctx = new Context()
await ctx.plugin(CredentialsStub)
await ctx.plugin(ToolsStub)
await ctx.plugin(SandboxPolicyStub, { workspaceRoot: dir })
await ctx.plugin(AttachmentsStub)
await ctx.plugin(SystemPromptStub)
if (useOpenaiCompat) {
  // openai-compat 无内置网关：地址与模型由环境变量给出（地址通常以 /v1 结尾）
  const baseUrl = (process.env['OPENAI_COMPAT_BASE_URL'] ?? '').trim()
  if (baseUrl === '') {
    console.error(
      '--provider openai-compat 需要 OPENAI_COMPAT_BASE_URL（通常以 /v1 结尾）与 OPENAI_COMPAT_API_KEY',
    )
    await rm(dir, { recursive: true, force: true })
    process.exit(1)
  }
  const model = process.env['OPENAI_COMPAT_MODEL'] ?? 'gpt-image-2'
  await ctx.plugin(OpenaiCompatImageProvider, {
    apiKey: 'OPENAI_COMPAT_API_KEY',
    baseUrl,
    wireframeModel: model,
    highFidelityModel: model,
    requestTimeoutMs: 300_000,
  })
} else {
  await ctx.plugin(useVolcengine ? VolcengineImageProvider : DashscopeImageProvider)
}
await ctx.plugin({ name: toolName, inject: toolInject, apply: toolApply })

const tools = ctx.get('tools') as unknown as ToolsStub
const definition = tools.registered.find((item) => item.name === 'ui_mockup')
if (definition === undefined) {
  console.error('ui_mockup 工具未注册')
  await rm(dir, { recursive: true, force: true })
  process.exit(1)
}

const execute = definition.execute as (
  args: Record<string, unknown>,
  exec: { signal: AbortSignal },
) => Promise<Record<string, unknown>>
const description =
  process.argv[2] ?? '一个待办事项应用的主页：顶部导航栏、任务输入框、任务列表、底部筛选栏'
console.log(
  `[smoke] 提供方: ${
    useOpenaiCompat
      ? `OpenAI 兼容网关（${process.env['OPENAI_COMPAT_MODEL'] ?? 'gpt-image-2'}）`
      : useVolcengine
        ? '火山方舟（doubao-seedream）'
        : '百炼（qwen-image-3.0）'
  }`,
)
console.log(`[smoke] 生成中：${description.slice(0, 40)}…`)
const value = await execute(
  {
    description,
    fidelity: 'wireframe',
    platform: 'web',
    // new_api 系已知方言：部分网关拒绝 n>1（400 请求参数无法处理）；
    // openai-compat 冒烟按单图跑，多图由调用方按网关能力自行多次调用
    ...(useOpenaiCompat ? { count: 1 } : {}),
  },
  { signal: new AbortController().signal },
)
console.log('[smoke] 结果:', JSON.stringify(value, null, 2).slice(0, 2000))
console.log(`[smoke] 工作区: ${dir}`)
