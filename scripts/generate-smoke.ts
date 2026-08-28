/**
 * 真实 API 冒烟测试：用本机 key 跑一次完整链路。
 * 用法：DASHSCOPE_API_KEY=sk-xxx npx tsx scripts/generate-smoke.ts
 *      ARK_API_KEY=ark-xxx npx tsx scripts/generate-smoke.ts --provider volcengine
 * 结果落盘到临时目录（默认 /tmp 下新建），并打印图片路径与附件信息。
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context, Service } from '@deepseek-ai/cordis'
import DashscopeImageProvider from '@mackwan84/dsh-image-dashscope'
import VolcengineImageProvider from '@mackwan84/dsh-image-volcengine'
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
// --provider volcengine：切换烟测提供方（需 ARK_API_KEY）；默认 DashScope。
// 注意 description 是位置参数，放在 --provider 之前：npx tsx … "描述" --provider volcengine
const providerIndex = process.argv.indexOf('--provider')
const useVolcengine = providerIndex !== -1 && process.argv[providerIndex + 1] === 'volcengine'
const ctx = new Context()
await ctx.plugin(CredentialsStub)
await ctx.plugin(ToolsStub)
await ctx.plugin(SandboxPolicyStub, { workspaceRoot: dir })
await ctx.plugin(AttachmentsStub)
await ctx.plugin(SystemPromptStub)
await ctx.plugin(useVolcengine ? VolcengineImageProvider : DashscopeImageProvider)
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
  `[smoke] 提供方: ${useVolcengine ? '火山方舟（doubao-seedream）' : '百炼（qwen-image-3.0）'}`,
)
console.log(`[smoke] 生成中：${description.slice(0, 40)}…`)
const value = await execute(
  { description, fidelity: 'wireframe', platform: 'web' },
  { signal: new AbortController().signal },
)
console.log('[smoke] 结果:', JSON.stringify(value, null, 2).slice(0, 2000))
console.log(`[smoke] 工作区: ${dir}`)
