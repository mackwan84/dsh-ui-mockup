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

interface Booted {
  ctx: Context
  tools: ToolsStub
  attachments: AttachmentsStub
  systemPrompt: SystemPromptStub
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
        exec: { signal: AbortSignal },
      ) => Promise<Record<string, unknown>>
      const value = await execute(
        { description: '在线书店主页线框图', fidelity: 'wireframe', platform: 'web' },
        { signal: new AbortController().signal },
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
        exec: { signal: AbortSignal },
      ) => Promise<Record<string, unknown>>
      const value = await execute(
        {
          description: '图书详情页',
          fidelity: 'high-fidelity',
          platform: 'web',
          reference: 'assets/base.png',
        },
        { signal: new AbortController().signal },
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
        exec: { signal: AbortSignal },
      ) => Promise<Record<string, unknown>>
      const value = await execute(
        {
          description: '任意页面',
          fidelity: 'wireframe',
          platform: 'web',
          reference: '../../etc/passwd',
        },
        { signal: new AbortController().signal },
      )
      expect(value.ok).toBe(false)
      expect(value.message).toContain('INVALID_PARAMETER')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
