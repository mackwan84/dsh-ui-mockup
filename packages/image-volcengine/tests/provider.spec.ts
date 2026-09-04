import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ImageProviderError } from '@mackwan84/dsh-image'
import VolcengineImageProvider, {
  Config,
  extractImages,
  toArkEditSize,
  toArkGenerateSize,
  type Config as ConfigType,
} from '../src/index.js'

function makeConfig(overrides: Partial<ConfigType> = {}): ConfigType {
  return {
    apiKey: 'ARK_API_KEY',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    wireframeModel: 'doubao-seedream-4-5-251128',
    highFidelityModel: 'doubao-seedream-5-0-pro-260628',
    editModel: 'doubao-seedream-5-0-pro-260628',
    requestTimeoutMs: 300_000,
    rateLimitRetries: 2,
    rateLimitBackoffMs: 25_000,
    ...overrides,
  }
}

function provider(overrides: Partial<ConfigType> = {}): VolcengineImageProvider {
  const ctx = new Context()
  ctx.provide('credentials', {
    resolve: async () => ({ value: 'ark-test-key' }),
  })
  return new VolcengineImageProvider(ctx, makeConfig(overrides))
}

const wireframeSpec = {
  prompt: '黑白线框图测试',
  fidelity: 'wireframe' as const,
  platform: 'web' as const,
}

/** 记录 fetch 调用并返回可编排的响应序列（数组逐次消费；函数则无限复用）。 */
type Responder = (url: string, init: RequestInit) => Response | Promise<Response>

/** 断言辅助：所有 mock 请求体都是字符串，收窄 BodyInit 以通过 no-base-to-string。 */
function bodyOf(call: { init: RequestInit }): string {
  return call.init.body as string
}

function mockFetch(respond: Responder | Responder[]) {
  const calls: Array<{ url: string; init: RequestInit }> = []
  if (Array.isArray(respond)) {
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      calls.push({ url, init })
      const next = respond.shift()
      if (next === undefined) throw new Error('unexpected extra fetch call')
      return next(url, init)
    })
  } else {
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      calls.push({ url, init })
      return respond(url, init)
    })
  }
  return calls
}

function okBody(model = 'doubao-seedream-4-5-251128', url = 'https://ark-cdn/r.png'): string {
  return JSON.stringify({ model, created: 0, data: [{ url }] })
}

beforeEach(() => {
  vi.stubEnv('ARK_API_KEY', '')
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('toArkGenerateSize', () => {
  it('defaults to the 2K tier for every platform (product decision: minimum 2K output)', () => {
    expect(toArkGenerateSize(undefined)).toBe('2K')
    expect(toArkGenerateSize('  ')).toBe('2K')
  })

  it('normalizes tier names case-insensitively', () => {
    expect(toArkGenerateSize('1K')).toBe('1K')
    expect(toArkGenerateSize('2k')).toBe('2K')
    expect(toArkGenerateSize('4K')).toBe('4K')
  })

  it('rejects the seededit-only adaptive tier on the generate path', () => {
    expect(() => toArkGenerateSize('adaptive')).toThrowError(ImageProviderError)
  })

  it('translates plugin star syntax and keeps in-domain pixel sizes', () => {
    expect(toArkGenerateSize('2048x2048')).toBe('2048x2048')
    expect(toArkGenerateSize('2560*1440')).toBe('2560x1440')
    expect(toArkGenerateSize('1440*2560')).toBe('1440x2560')
  })

  it('scales pixel sizes up to the minimum total pixels (seedream 4.5/5.0)', () => {
    // 2026-08 实测网关约束：总像素 ≥ 3,686,400（2560x1440）
    expect(toArkGenerateSize('1280*720')).toBe('2560x1440')
    expect(toArkGenerateSize('720*1280')).toBe('1440x2560')
    expect(toArkGenerateSize('1024*1024')).toBe('1920x1920')
  })

  it('scales down pixel sizes exceeding the total-pixel ceiling', () => {
    const result = toArkGenerateSize('8192*4608')
    const [w, h] = result.split('x').map(Number) as [number, number]
    expect(w * h).toBeLessThanOrEqual(4096 * 4096)
  })

  it('rejects aspect ratios outside [1/16, 16] and unrecognized input', () => {
    expect(() => toArkGenerateSize('10000*100')).toThrowError(ImageProviderError)
    expect(() => toArkGenerateSize('大图')).toThrowError(ImageProviderError)
  })
})

describe('toArkEditSize', () => {
  it('defaults to the 2K tier accepted by Seedream edit mode', () => {
    expect(toArkEditSize(undefined)).toBe('2K')
    expect(toArkEditSize('')).toBe('2K')
  })

  it('passes tiers and pixel sizes through with format normalization only', () => {
    expect(toArkEditSize('2k')).toBe('2K')
    expect(toArkEditSize('1280*720')).toBe('1280x720')
    expect(() => toArkEditSize('宽x高')).toThrowError(ImageProviderError)
  })

  it('rejects the retired SeedEdit-only adaptive tier', () => {
    expect(() => toArkEditSize('adaptive')).toThrowError(ImageProviderError)
  })
})

describe('extractImages', () => {
  it('reads data[].url', () => {
    expect(extractImages([{ url: 'https://ark-cdn/a.png' }, { url: '' }, null])).toEqual([
      { url: 'https://ark-cdn/a.png' },
    ])
  })

  it('normalizes b64_json to a data URL', () => {
    expect(extractImages([{ b64_json: 'QUJD' }])).toEqual([{ url: 'data:image/png;base64,QUJD' }])
  })

  it('returns empty for non-array input', () => {
    expect(extractImages(undefined)).toEqual([])
    expect(extractImages({ data: [] })).toEqual([])
  })
})

describe('generate request shape', () => {
  it('posts sync generations endpoint with url format, no watermark and platform default size', async () => {
    const calls = mockFetch(() => new Response(okBody(), { status: 200 }))
    const result = await provider().generate(wireframeSpec)
    expect(calls).toHaveLength(1)
    expect(calls[0]!.url).toBe('https://ark.cn-beijing.volces.com/api/v3/images/generations')
    expect(calls[0]!.init.method).toBe('POST')
    expect(calls[0]!.init.redirect).toBe('error')
    expect(calls[0]!.init.headers).toMatchObject({ Authorization: 'Bearer ark-test-key' })
    const body = JSON.parse(bodyOf(calls[0]!)) as Record<string, unknown>
    expect(body).toMatchObject({
      model: 'doubao-seedream-4-5-251128',
      prompt: '黑白线框图测试',
      response_format: 'url',
      watermark: false,
      size: '2K',
    })
    expect(body.image).toBeUndefined()
    expect(result).toMatchObject({ model: 'doubao-seedream-4-5-251128' })
    expect(result.images).toEqual([{ url: 'https://ark-cdn/r.png' }])
  })

  it('respects explicit model and translated size', async () => {
    const calls = mockFetch(() => new Response(okBody(), { status: 200 }))
    await provider({ wireframeModel: 'doubao-seedream-3-0-t2i-250415' }).generate({
      ...wireframeSpec,
      model: 'doubao-seedream-4-0-250828',
      size: '1280*720',
    })
    const body = JSON.parse(bodyOf(calls[0]!)) as Record<string, unknown>
    expect(body.model).toBe('doubao-seedream-4-0-250828')
    // 显式画幅低于总像素下限时等比放大（seedream 4.5/5.0 实测约束）
    expect(body.size).toBe('2560x1440')
  })

  it('uses high-fidelity model default for high-fidelity spec', async () => {
    const calls = mockFetch(() => new Response(okBody(), { status: 200 }))
    await provider({ highFidelityModel: 'doubao-seedream-5-0-260128' }).generate({
      ...wireframeSpec,
      fidelity: 'high-fidelity',
    })
    const body = JSON.parse(bodyOf(calls[0]!)) as Record<string, unknown>
    expect(body.model).toBe('doubao-seedream-5-0-260128')
  })

  it('serializes n>1 into sequential single-image calls', async () => {
    const calls = mockFetch(() => new Response(okBody(), { status: 200 }))
    const result = await provider().generate({ ...wireframeSpec, n: 3 })
    expect(calls).toHaveLength(3)
    expect(result.images).toHaveLength(3)
  })

  it('inlines reference as data URL for I2I', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-image-volc-'))
    try {
      const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a])
      await writeFile(join(dir, 'anchor.png'), bytes)
      const calls = mockFetch(() => new Response(okBody(), { status: 200 }))
      await provider().generate({ ...wireframeSpec, reference: 'anchor.png', cwd: dir })
      const body = JSON.parse(bodyOf(calls[0]!)) as { image?: string[] }
      expect(body.image).toEqual([`data:image/png;base64,${bytes.toString('base64')}`])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('declares the sniffed media type instead of hardcoding png', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-image-volc-'))
    try {
      // JPEG 魔数开头：data URL 必须如实声明 image/jpeg，否则方舟按声明格式误判
      const bytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10])
      await writeFile(join(dir, 'anchor.jpg'), bytes)
      const calls = mockFetch(() => new Response(okBody(), { status: 200 }))
      await provider().generate({ ...wireframeSpec, reference: 'anchor.jpg', cwd: dir })
      const body = JSON.parse(bodyOf(calls[0]!)) as { image?: string[] }
      expect(body.image).toEqual([`data:image/jpeg;base64,${bytes.toString('base64')}`])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('rejects reference paths escaping the workspace', async () => {
    mockFetch(() => new Response(okBody(), { status: 200 }))
    await expect(
      provider().generate({ ...wireframeSpec, reference: '../secret.png', cwd: '/tmp/root' }),
    ).rejects.toMatchObject({ code: 'INVALID_PARAMETER' })
  })
})

describe('credentials', () => {
  it('falls back to ambient env when credentials seam is absent', async () => {
    vi.stubEnv('ARK_API_KEY', 'sk-env-key')
    const ctx = new Context()
    const calls = mockFetch(() => new Response(okBody(), { status: 200 }))
    await new VolcengineImageProvider(ctx, makeConfig()).generate(wireframeSpec)
    expect(calls[0]!.init.headers).toMatchObject({ Authorization: 'Bearer sk-env-key' })
  })

  it('fails with MISSING_CREDENTIAL when unconfigured', async () => {
    const ctx = new Context()
    mockFetch(() => new Response(okBody(), { status: 200 }))
    await expect(
      new VolcengineImageProvider(ctx, makeConfig()).generate(wireframeSpec),
    ).rejects.toMatchObject({ code: 'MISSING_CREDENTIAL' })
  })
})

describe('error mapping', () => {
  it('maps 401 to MISSING_CREDENTIAL', async () => {
    mockFetch(
      () =>
        new Response(
          JSON.stringify({ error: { code: 'AuthenticationError', message: 'invalid key' } }),
          { status: 401 },
        ),
    )
    await expect(provider().generate(wireframeSpec)).rejects.toMatchObject({
      code: 'MISSING_CREDENTIAL',
    })
  })

  it('maps 400 with OpenAI-style error envelope to INVALID_PARAMETER', async () => {
    mockFetch(
      () =>
        new Response(JSON.stringify({ error: { code: 'InvalidParameter', message: 'bad size' } }), {
          status: 400,
        }),
    )
    await expect(provider().generate(wireframeSpec)).rejects.toMatchObject({
      code: 'INVALID_PARAMETER',
      message: expect.stringContaining('bad size') as unknown,
    })
  })

  it('maps 403 and 5xx to HTTP_ERROR', async () => {
    mockFetch(() => new Response('{"error":{"code":"Forbidden"}}', { status: 403 }))
    await expect(provider().generate(wireframeSpec)).rejects.toMatchObject({
      code: 'HTTP_ERROR',
    })
    mockFetch(() => new Response('{"error":{"message":"boom"}}', { status: 500 }))
    await expect(provider().generate(wireframeSpec)).rejects.toMatchObject({
      code: 'HTTP_ERROR',
    })
  })

  it('maps non-JSON error body to HTTP_ERROR without crashing', async () => {
    mockFetch(() => new Response('<html>gateway</html>', { status: 502 }))
    await expect(provider().generate(wireframeSpec)).rejects.toMatchObject({
      code: 'HTTP_ERROR',
    })
  })

  it('maps success without images to BAD_RESPONSE', async () => {
    mockFetch(() => new Response(JSON.stringify({ model: 'm', data: [] }), { status: 200 }))
    await expect(provider().generate(wireframeSpec)).rejects.toMatchObject({
      code: 'BAD_RESPONSE',
    })
  })
})

describe('resilience', () => {
  it('retries 429 with backoff then succeeds', async () => {
    vi.useFakeTimers()
    const calls = mockFetch([
      () =>
        new Response(JSON.stringify({ error: { code: 'ModelAccountIpmRateLimitExceeded' } }), {
          status: 429,
        }),
      () =>
        new Response(JSON.stringify({ error: { code: 'ModelAccountIpmRateLimitExceeded' } }), {
          status: 429,
        }),
      () => new Response(okBody(), { status: 200 }),
    ])
    const promise = provider().generate(wireframeSpec)
    await vi.advanceTimersByTimeAsync(50_000)
    const result = await promise
    expect(result.images).toEqual([{ url: 'https://ark-cdn/r.png' }])
    expect(calls).toHaveLength(3)
  })

  it('gives up with RATE_LIMITED after exhausting retries', async () => {
    vi.useFakeTimers()
    mockFetch([
      () =>
        new Response(JSON.stringify({ error: { code: 'ModelAccountIpmRateLimitExceeded' } }), {
          status: 429,
        }),
      () =>
        new Response(JSON.stringify({ error: { code: 'ModelAccountIpmRateLimitExceeded' } }), {
          status: 429,
        }),
      () =>
        new Response(JSON.stringify({ error: { code: 'ModelAccountIpmRateLimitExceeded' } }), {
          status: 429,
        }),
    ])
    const promise = provider().generate(wireframeSpec)
    const expectation = expect(promise).rejects.toMatchObject({ code: 'RATE_LIMITED' })
    await vi.advanceTimersByTimeAsync(100_000)
    await expectation
  })

  it('propagates abort during backoff delay', async () => {
    vi.useFakeTimers()
    mockFetch(
      () =>
        new Response(JSON.stringify({ error: { code: 'ModelAccountIpmRateLimitExceeded' } }), {
          status: 429,
        }),
    )
    const controller = new AbortController()
    const promise = provider().generate(wireframeSpec, controller.signal)
    const expectation = expect(promise).rejects.toMatchObject({ name: 'AbortError' })
    controller.abort()
    await expectation
  })

  // 挂起 fetch：不主动返回，信号中止时以中止原因拒绝（与 undici 真实行为一致）
  function hangUntilAbort(_url: string, init: RequestInit): Promise<Response> {
    return new Promise((_resolve, reject) => {
      const signal = init.signal
      if (signal == null) return
      const onAbort = () =>
        reject(signal.reason instanceof Error ? signal.reason : new Error(String(signal.reason)))
      if (signal.aborted) onAbort()
      else signal.addEventListener('abort', onAbort, { once: true })
    })
  }

  it('maps an exhausted sync request window to the TIMEOUT code', async () => {
    // 必须用真实定时器：vi.useFakeTimers() 无法 fake AbortSignal.timeout 的内部
    // 定时器，虚拟推进不会触发超时。窗口取 200ms 真实挂钟，避免拖慢套件。
    mockFetch(hangUntilAbort)
    const promise = provider({ requestTimeoutMs: 200 }).generate(wireframeSpec)
    await expect(promise).rejects.toMatchObject({ code: 'TIMEOUT' })
  })

  it('propagates caller abort during the request without mapping it to TIMEOUT', async () => {
    mockFetch(hangUntilAbort)
    const controller = new AbortController()
    const promise = provider().generate(wireframeSpec, controller.signal)
    controller.abort()
    await expect(promise).rejects.toMatchObject({ name: 'AbortError' })
  })
})

describe('edit', () => {
  const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a])
  let editDir: string

  beforeEach(async () => {
    editDir = await mkdtemp(join(tmpdir(), 'dsh-image-volc-edit-'))
    await writeFile(join(editDir, 'mockup-1.png'), pngBytes)
  })

  afterEach(async () => {
    await rm(editDir, { recursive: true, force: true })
  })

  const editSpec = () => ({
    prompt: '把主按钮改成绿色',
    baseImage: 'mockup-1.png',
    platform: 'web' as const,
    cwd: editDir,
  })

  it('rejects mask as NOT_IMPLEMENTED without hitting the network', async () => {
    const calls = mockFetch(() => new Response(okBody(), { status: 200 }))
    await expect(provider().edit({ ...editSpec(), mask: 'm.png' })).rejects.toMatchObject({
      code: 'NOT_IMPLEMENTED',
    })
    expect(calls).toHaveLength(0)
  })

  it('posts base image and edit note on the Seedream model with 2K size', async () => {
    const calls = mockFetch(
      () => new Response(okBody('doubao-seedream-5-0-pro-260628'), { status: 200 }),
    )
    const result = await provider().edit(editSpec())
    expect(calls[0]!.url).toBe('https://ark.cn-beijing.volces.com/api/v3/images/generations')
    const body = JSON.parse(bodyOf(calls[0]!)) as Record<string, unknown>
    expect(body.prompt).toBe('把主按钮改成绿色')
    expect(body.model).toBe('doubao-seedream-5-0-pro-260628')
    expect(body.size).toBe('2K')
    expect(body.image).toEqual([`data:image/png;base64,${pngBytes.toString('base64')}`])
    expect(result.model).toBe('doubao-seedream-5-0-pro-260628')
  })

  it('lets an explicit model override the edit model default', async () => {
    const calls = mockFetch(() => new Response(okBody('m1'), { status: 200 }))
    await provider().edit({ ...editSpec(), model: 'doubao-seedream-4-0-250828' })
    const body = JSON.parse(bodyOf(calls[0]!)) as Record<string, unknown>
    expect(body.model).toBe('doubao-seedream-4-0-250828')
  })

  it('rejects base image paths escaping the workspace', async () => {
    mockFetch(() => new Response(okBody(), { status: 200 }))
    await expect(
      provider().edit({ ...editSpec(), baseImage: '../../etc/passwd' }),
    ).rejects.toMatchObject({ code: 'INVALID_PARAMETER' })
  })
})

describe('Config defaults', () => {
  it('keeps the ARK product defaults for credentials and model tiering', () => {
    const parsed = Config()
    expect(parsed.apiKey).toBe('ARK_API_KEY')
    expect(parsed.wireframeModel).toBe('doubao-seedream-4-5-251128')
    expect(parsed.highFidelityModel).toBe('doubao-seedream-5-0-pro-260628')
    expect(parsed.editModel).toBe('doubao-seedream-5-0-pro-260628')
    expect(parsed.requestTimeoutMs).toBe(300_000)
    expect(parsed.rateLimitRetries).toBe(2)
  })
})
