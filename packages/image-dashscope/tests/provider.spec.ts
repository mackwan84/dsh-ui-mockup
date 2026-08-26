import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ImageProviderError } from '@mackwan84/dsh-image'
import DashscopeImageProvider, { Config, extractImageUrls, type Config as ConfigType } from '../src/index.js'

function makeConfig(overrides: Partial<ConfigType> = {}): ConfigType {
  return {
    apiKey: 'DASHSCOPE_API_KEY',
    baseUrl: 'https://dashscope.aliyuncs.com',
    wireframeModel: 'qwen-image-3.0',
    highFidelityModel: 'qwen-image-3.0-pro',
    pollTimeoutMs: 600_000,
    pollIntervalMs: 5_000,
    rateLimitRetries: 2,
    rateLimitBackoffMs: 25_000,
    ...overrides,
  }
}

function provider(overrides: Partial<ConfigType> = {}): DashscopeImageProvider {
  const ctx = new Context()
  ctx.provide('credentials', {
    resolve: async () => ({ value: 'sk-test-key' }),
  })
  return new DashscopeImageProvider(ctx, makeConfig(overrides))
}

const wireframeSpec = {
  prompt: '黑白线框图测试',
  fidelity: 'wireframe' as const,
  platform: 'web' as const,
}

/** 记录 fetch 调用并返回可编排的响应序列（数组逐次消费；函数则无限复用）。 */
type Responder = (url: string, init: RequestInit) => Response | Promise<Response>
function mockFetch(respond: Responder | Responder[]) {
  const calls: Array<{ url: string; init: RequestInit }> = []
  const list = Array.isArray(respond) ? respond : undefined
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    calls.push({ url, init })
    const next = list !== undefined ? list.shift() : respond
    if (next === undefined) throw new Error('unexpected extra fetch call')
    return next(url, init)
  })
  return calls
}

beforeEach(() => {
  vi.stubEnv('DASHSCOPE_API_KEY', '')
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('extractImageUrls', () => {
  it('reads wanx results[].url', () => {
    expect(extractImageUrls({ results: [{ url: 'https://oss/a.png' }] })).toEqual(['https://oss/a.png'])
  })

  it('reads qwen-image choices[].message.content[].image', () => {
    expect(extractImageUrls({
      choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: [{ image: 'https://oss/b.png', type: 'image' }] } }],
    })).toEqual(['https://oss/b.png'])
  })

  it('returns an empty list for unrelated output', () => {
    expect(extractImageUrls({ task_status: 'PENDING' })).toEqual([])
  })
})

describe('generate · qwen-image', () => {
  it('creates the async task on the image-generation endpoint and resolves polled images', async () => {
    const calls = mockFetch([
      () => new Response(JSON.stringify({ output: { task_id: 'task-1', task_status: 'PENDING' } }), { status: 200 }),
      () => new Response(JSON.stringify({
        output: {
          task_id: 'task-1',
          task_status: 'SUCCEEDED',
          choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: [{ image: 'https://oss/result.png', type: 'image' }] } }],
        },
      }), { status: 200 }),
    ])

    const result = await provider().generate(wireframeSpec)

    expect(result.model).toBe('qwen-image-3.0')
    expect(result.images).toEqual([{ url: 'https://oss/result.png' }])
    expect(calls[0]!.url).toBe('https://dashscope.aliyuncs.com/api/v1/services/aigc/image-generation/generation')
    expect(calls[0]!.init.method).toBe('POST')
    const headers = calls[0]!.init.headers as Record<string, string>
    expect(headers.Authorization).toBe('Bearer sk-test-key')
    expect(headers['X-DashScope-Async']).toBe('enable')
    const body = JSON.parse(String(calls[0]!.init.body)) as Record<string, unknown>
    expect(body.model).toBe('qwen-image-3.0')
    const messages = (body.input as { messages: Array<{ role: string; content: Array<{ text?: string }> }> }).messages
    expect(messages[0]!.content.some(item => item.text === '黑白线框图测试')).toBe(true)
    expect(calls[1]!.url).toBe('https://dashscope.aliyuncs.com/api/v1/tasks/task-1')
  })

  it('selects the high-fidelity model by fidelity', async () => {
    mockFetch([
      () => new Response(JSON.stringify({ output: { task_id: 't', task_status: 'PENDING' } }), { status: 200 }),
      () => new Response(JSON.stringify({ output: { task_status: 'SUCCEEDED', results: [{ url: 'https://oss/r.png' }] } }), { status: 200 }),
    ])
    const result = await provider().generate({ ...wireframeSpec, fidelity: 'high-fidelity' })
    expect(result.model).toBe('qwen-image-3.0-pro')
  })

  it('attaches the reference image as a base64 data URL', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-image-ref-'))
    try {
      await writeFile(join(dir, 'base.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]))
      const calls = mockFetch([
        () => new Response(JSON.stringify({ output: { task_id: 't', task_status: 'PENDING' } }), { status: 200 }),
        () => new Response(JSON.stringify({ output: { task_status: 'SUCCEEDED', results: [{ url: 'https://oss/r.png' }] } }), { status: 200 }),
      ])
      await provider().generate({ ...wireframeSpec, reference: 'base.png', cwd: dir })
      const body = JSON.parse(String(calls[0]!.init.body)) as { input: { messages: Array<{ content: Array<{ image?: string }> }> } }
      const image = body.input.messages[0]!.content.find(item => item.image !== undefined)!.image!
      expect(image.startsWith('data:image/png;base64,')).toBe(true)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('rejects a reference path escaping the working directory before any request', async () => {
    mockFetch(() => {
      throw new Error('unexpected fetch: path validation must precede any request')
    })
    await expect(provider().generate({ ...wireframeSpec, reference: '../../etc/passwd', cwd: '/tmp/workspace' }))
      .rejects.toMatchObject({ code: 'INVALID_PARAMETER' })
  })

  it('clamps n into 1..4 and resolves multiple image urls', async () => {
    const calls = mockFetch([
      () => new Response(JSON.stringify({ output: { task_id: 't', task_status: 'PENDING' } }), { status: 200 }),
      () => new Response(JSON.stringify({
        output: {
          task_status: 'SUCCEEDED',
          choices: [{ message: { role: 'assistant', content: [{ image: 'https://oss/1.png' }, { image: 'https://oss/2.png' }] } }],
        },
      }), { status: 200 }),
      () => new Response(JSON.stringify({ output: { task_id: 't', task_status: 'PENDING' } }), { status: 200 }),
      () => new Response(JSON.stringify({ output: { task_status: 'SUCCEEDED', results: [{ url: 'https://oss/r.png' }] } }), { status: 200 }),
    ])
    const multi = await provider().generate({ ...wireframeSpec, n: 9 })
    await provider().generate({ ...wireframeSpec, n: 0 })
    const first = JSON.parse(String(calls[0]!.init.body)) as { parameters: { n: number } }
    const second = JSON.parse(String(calls[2]!.init.body)) as { parameters: { n: number } }
    expect(first.parameters.n).toBe(4)
    expect(second.parameters.n).toBe(1)
    expect(multi.images).toHaveLength(2)
  })
})

describe('generate · wanx fallback', () => {
  it('uses the text2image endpoint with a plain prompt input', async () => {
    const calls = mockFetch([
      () => new Response(JSON.stringify({ output: { task_id: 't', task_status: 'PENDING' } }), { status: 200 }),
      () => new Response(JSON.stringify({ output: { task_status: 'SUCCEEDED', results: [{ url: 'https://oss/r.png' }] } }), { status: 200 }),
    ])
    await provider().generate({ ...wireframeSpec, model: 'wan2.2-t2i-plus' })
    expect(calls[0]!.url).toBe('https://dashscope.aliyuncs.com/api/v1/services/aigc/text2image/image-synthesis')
    const body = JSON.parse(String(calls[0]!.init.body)) as { input: { prompt: string } }
    expect(body.input.prompt).toBe('黑白线框图测试')
  })

  it('rejects a reference for non-qwen models', async () => {
    await expect(provider().generate({ ...wireframeSpec, model: 'wan2.2-t2i-plus', reference: 'x.png' }))
      .rejects.toMatchObject({ code: 'INVALID_PARAMETER' })
  })
})

describe('resilience', () => {
  it('retries rate-limited task creation with backoff', async () => {
    vi.useFakeTimers()
    const calls = mockFetch([
      () => new Response(JSON.stringify({ code: 'Throttling.RateQuota', message: 'Requests rate limit exceeded.' }), { status: 200 }),
      () => new Response(JSON.stringify({ code: 'Throttling.RateQuota', message: 'Requests rate limit exceeded.' }), { status: 200 }),
      () => new Response(JSON.stringify({ output: { task_id: 't', task_status: 'PENDING' } }), { status: 200 }),
      () => new Response(JSON.stringify({ output: { task_status: 'SUCCEEDED', results: [{ url: 'https://oss/r.png' }] } }), { status: 200 }),
    ])
    const promise = provider().generate(wireframeSpec)
    await vi.advanceTimersByTimeAsync(50_000)
    const result = await promise
    expect(result.images).toEqual([{ url: 'https://oss/r.png' }])
    expect(calls).toHaveLength(4)
  })

  it('gives up with RATE_LIMITED after exhausting retries', async () => {
    vi.useFakeTimers()
    mockFetch([
      () => new Response(JSON.stringify({ code: 'Throttling.RateQuota', message: 'Requests rate limit exceeded.' }), { status: 200 }),
      () => new Response(JSON.stringify({ code: 'Throttling.RateQuota', message: 'Requests rate limit exceeded.' }), { status: 200 }),
      () => new Response(JSON.stringify({ code: 'Throttling.RateQuota', message: 'Requests rate limit exceeded.' }), { status: 200 }),
    ])
    const promise = provider().generate(wireframeSpec)
    const expectation = expect(promise).rejects.toMatchObject({ code: 'RATE_LIMITED' })
    await vi.advanceTimersByTimeAsync(100_000)
    await expectation
  })

  it('rejects a FAILED task with the provider message', async () => {
    mockFetch([
      () => new Response(JSON.stringify({ output: { task_id: 't', task_status: 'PENDING' } }), { status: 200 }),
      () => new Response(JSON.stringify({ output: { task_id: 't', task_status: 'FAILED', code: 'InternalError', message: '内部错误' } }), { status: 200 }),
    ])
    await expect(provider().generate(wireframeSpec)).rejects.toMatchObject({ code: 'TASK_FAILED' })
  })

  it('times out after the poll window', async () => {
    vi.useFakeTimers()
    let count = 0
    mockFetch(() => {
      count += 1
      if (count === 1) {
        return new Response(JSON.stringify({ output: { task_id: 't', task_status: 'PENDING' } }), { status: 200 })
      }
      return new Response(JSON.stringify({ output: { task_id: 't', task_status: 'RUNNING' } }), { status: 200 })
    })
    const promise = provider({ pollTimeoutMs: 1_000, pollIntervalMs: 100 }).generate(wireframeSpec)
    const expectation = expect(promise).rejects.toMatchObject({ code: 'TIMEOUT' })
    await vi.advanceTimersByTimeAsync(5_000)
    await expectation
  })

  it('fails fast on a poll response carrying an error code instead of idling to timeout', async () => {
    const calls = mockFetch([
      () => new Response(JSON.stringify({ output: { task_id: 't', task_status: 'PENDING' } }), { status: 200 }),
      () => new Response(JSON.stringify({ code: 'InvalidApiKey', message: 'Invalid API-key provided.' }), { status: 401 }),
    ])
    await expect(provider({ pollTimeoutMs: 600_000 }).generate(wireframeSpec)).rejects.toMatchObject({ code: 'TASK_FAILED' })
    expect(calls).toHaveLength(2)
  })

  it('keeps polling through transient 5xx gateway errors', async () => {
    vi.useFakeTimers()
    const calls = mockFetch([
      () => new Response(JSON.stringify({ output: { task_id: 't', task_status: 'PENDING' } }), { status: 200 }),
      () => new Response('bad gateway', { status: 502 }),
      () => new Response(JSON.stringify({ output: { task_status: 'SUCCEEDED', results: [{ url: 'https://oss/r.png' }] } }), { status: 200 }),
    ])
    const promise = provider().generate(wireframeSpec)
    await vi.advanceTimersByTimeAsync(5_000)
    const result = await promise
    expect(result.images).toEqual([{ url: 'https://oss/r.png' }])
    expect(calls).toHaveLength(3)
  })

  it('rejects BAD_RESPONSE when the creation output is JSON null', async () => {
    mockFetch([
      () => new Response(JSON.stringify({ output: null }), { status: 200 }),
    ])
    await expect(provider().generate(wireframeSpec)).rejects.toMatchObject({ code: 'BAD_RESPONSE' })
  })

  it('fails with MISSING_CREDENTIAL when no seam and no ambient key', async () => {
    const ctx = new Context()
    const instance = new DashscopeImageProvider(ctx, makeConfig())
    await expect(instance.generate(wireframeSpec)).rejects.toMatchObject({ code: 'MISSING_CREDENTIAL' })
  })
})

describe('Config defaults', () => {
  it('keeps the product defaults for model tiering and polling', () => {
    const parsed = Config({}) as ConfigType
    expect(parsed.wireframeModel).toBe('qwen-image-3.0')
    expect(parsed.highFidelityModel).toBe('qwen-image-3.0-pro')
    expect(parsed.pollTimeoutMs).toBe(600_000)
    expect(parsed.rateLimitRetries).toBe(2)
  })

  it('rejects a non-numeric poll interval', () => {
    expect(() => Config({ pollIntervalMs: 'fast' })).toThrow()
  })
})

describe('edit', () => {
  it('is not implemented in M1', async () => {
    await expect(provider().edit({
      prompt: '修改',
      baseImage: 'x.png',
      platform: 'web',
    })).rejects.toMatchObject({ code: 'NOT_IMPLEMENTED' })
  })
})

// Keep ImageProviderError referenced (typed import) for coverage of the error path.
void ImageProviderError
