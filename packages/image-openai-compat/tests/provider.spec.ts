import { Context } from '@deepseek-ai/cordis'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ImageProviderError } from '@mackwan84/dsh-image'
import OpenaiCompatImageProvider, {
  extractImages,
  toCompatSize,
  type Config as ConfigType,
} from '../src/index.js'

function makeConfig(overrides: Partial<ConfigType> = {}): ConfigType {
  return {
    apiKey: 'OPENAI_COMPAT_API_KEY',
    baseUrl: 'https://gw.corp.internal/v1',
    wireframeModel: 'gpt-image-2',
    highFidelityModel: 'gpt-image-2.5-flare',
    requestTimeoutMs: 300_000,
    ...overrides,
  }
}

function provider(overrides: Partial<ConfigType> = {}): OpenaiCompatImageProvider {
  const ctx = new Context()
  ctx.provide('credentials', {
    resolve: async () => ({ value: 'compat-test-key' }),
  })
  return new OpenaiCompatImageProvider(ctx, makeConfig(overrides))
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

function okBody(model = 'gpt-image-2', images: unknown[] = [{ b64_json: 'aWNlLg==' }]): string {
  return JSON.stringify({ model, created: 0, data: images })
}

beforeEach(() => {
  vi.stubEnv('OPENAI_COMPAT_API_KEY', '')
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('凭据解析链', () => {
  it('无凭据服务且环境变量为空时抛 MISSING_CREDENTIAL', async () => {
    const ctx = new Context()
    const p = new OpenaiCompatImageProvider(ctx, makeConfig())
    await expect(p.generate(wireframeSpec)).rejects.toMatchObject({
      code: 'MISSING_CREDENTIAL',
    })
  })

  it('credentials seam 命中时优先使用', async () => {
    const calls = mockFetch(() => new Response(okBody(), { status: 200 }))
    const result = await provider().generate(wireframeSpec)
    expect(result.model).toBe('gpt-image-2')
    expect((calls[0]!.init.headers as Record<string, string>)['Authorization']).toBe(
      'Bearer compat-test-key',
    )
  })

  it('环境变量兜底可用（无 credentials 服务）', async () => {
    vi.stubEnv('OPENAI_COMPAT_API_KEY', 'env-key')
    mockFetch(() => new Response(okBody(), { status: 200 }))
    const ctx = new Context()
    const result = await new OpenaiCompatImageProvider(ctx, makeConfig()).generate(wireframeSpec)
    expect(result.images).toHaveLength(1)
  })
})

describe('baseUrl 配置', () => {
  it('baseUrl 为空时报明确错误并提示 /v1 习惯，不自动补前缀', async () => {
    const err = await provider({ baseUrl: '' })
      .generate(wireframeSpec)
      .catch((error: unknown) => error)
    expect(err).toBeInstanceOf(ImageProviderError)
    expect((err as ImageProviderError).code).toBe('INVALID_PARAMETER')
    expect((err as ImageProviderError).message).toContain('/v1')
  })

  it('容忍尾部斜杠：拼端点时不产生双斜杠', async () => {
    const calls = mockFetch(() => new Response(okBody(), { status: 200 }))
    await provider({ baseUrl: 'https://gw.corp.internal/v1/' }).generate(wireframeSpec)
    expect(calls[0]!.url).toBe('https://gw.corp.internal/v1/images/generations')
  })
})

describe('请求形状（最小公共子集）', () => {
  it('恰好四参数：model/prompt/n/size，无 watermark 等多余字段', async () => {
    const calls = mockFetch(() => new Response(okBody(), { status: 200 }))
    await provider().generate({ ...wireframeSpec, size: '1280*720', n: 2 })
    const body = JSON.parse(bodyOf(calls[0]!)) as Record<string, unknown>
    expect(Object.keys(body).sort()).toEqual(['model', 'n', 'prompt', 'size'])
    expect(body['model']).toBe('gpt-image-2')
    expect(body['n']).toBe(2)
    expect(body['size']).toBe('1280x720')
    expect((calls[0]!.init.headers as Record<string, string>)['Content-Type']).toBe(
      'application/json',
    )
  })

  it('未传 size 时省略 size 字段（画幅交网关/模型自决）', async () => {
    const calls = mockFetch(() => new Response(okBody(), { status: 200 }))
    await provider().generate(wireframeSpec)
    const body = JSON.parse(bodyOf(calls[0]!)) as Record<string, unknown>
    expect(body).not.toHaveProperty('size')
    expect(body).not.toHaveProperty('response_format')
  })

  it('n 原生下传：多图只发一次请求（与方舟串行拆单的策略不同）', async () => {
    const calls = mockFetch(
      () =>
        new Response(okBody('gpt-image-2', [{ b64_json: 'aGk=' }, { b64_json: 'o2s=' }]), {
          status: 200,
        }),
    )
    const result = await provider().generate({ ...wireframeSpec, n: 2 })
    expect(calls).toHaveLength(1)
    expect(JSON.parse(bodyOf(calls[0]!))).toMatchObject({ n: 2 })
    expect(result.images).toHaveLength(2)
  })

  it('模型解析：显式 model 优先，其次按保真度取分层默认', async () => {
    const calls = mockFetch(() => new Response(okBody(), { status: 200 }))
    await provider().generate({ ...wireframeSpec, model: 'custom-model' })
    expect(JSON.parse(bodyOf(calls[0]!))).toMatchObject({ model: 'custom-model' })

    await provider().generate({ ...wireframeSpec, fidelity: 'high-fidelity' })
    expect(JSON.parse(bodyOf(calls[1]!))).toMatchObject({ model: 'gpt-image-2.5-flare' })
  })

  it('分层默认与显式 model 均为空时报可操作错误', async () => {
    await expect(
      provider({ wireframeModel: '', highFidelityModel: '' }).generate(wireframeSpec),
    ).rejects.toMatchObject({ code: 'INVALID_PARAMETER' })
  })
})

describe('响应归一（双格式）', () => {
  it('data[].url 原样透传', async () => {
    mockFetch(
      () => new Response(okBody('gpt-image-2', [{ url: 'https://cdn/x.png' }]), { status: 200 }),
    )
    const result = await provider().generate(wireframeSpec)
    expect(result.images[0]).toEqual({ url: 'https://cdn/x.png' })
  })

  it('data[].b64_json 归一为 data URL', async () => {
    mockFetch(() => new Response(okBody('gpt-image-2', [{ b64_json: 'aWNl' }]), { status: 200 }))
    const result = await provider().generate(wireframeSpec)
    expect(result.images[0]).toEqual({ url: 'data:image/png;base64,aWNl' })
  })

  it('url 与 b64_json 混装时按各自格式归一', () => {
    expect(extractImages([{ url: 'https://a/1.png' }, { b64_json: 'eA==' }])).toEqual([
      { url: 'https://a/1.png' },
      { url: 'data:image/png;base64,eA==' },
    ])
  })

  it('响应缺少图片结果时报 BAD_RESPONSE', async () => {
    mockFetch(
      () => new Response(JSON.stringify({ model: 'gpt-image-2', data: [] }), { status: 200 }),
    )
    await expect(provider().generate(wireframeSpec)).rejects.toMatchObject({
      code: 'BAD_RESPONSE',
    })
  })
})

describe('toCompatSize', () => {
  it('把插件统一 W*H 归一为 WxH 后透传，比例意图不变', () => {
    expect(toCompatSize('1280*720')).toBe('1280x720')
    expect(toCompatSize('1024*1024')).toBe('1024x1024')
    expect(toCompatSize(' 1536x1024 ')).toBe('1536x1024')
  })

  it('空值与未知写法原样返回（交网关校验，不做本地白名单）', () => {
    expect(toCompatSize(undefined)).toBeUndefined()
    expect(toCompatSize('')).toBeUndefined()
    expect(toCompatSize('2K')).toBe('2K')
  })
})

describe('能力边界（最小子集明确不做）', () => {
  it('edit 一律 NOT_IMPLEMENTED', async () => {
    await expect(
      provider().edit({ prompt: '改按钮', baseImage: 'design/images/a.png', platform: 'web' }),
    ).rejects.toMatchObject({ code: 'NOT_IMPLEMENTED' })
  })

  it('generate 带参考图时 NOT_IMPLEMENTED（I2I 不在最小子集）', async () => {
    await expect(
      provider().generate({ ...wireframeSpec, reference: 'design/images/anchor.png' }),
    ).rejects.toMatchObject({ code: 'NOT_IMPLEMENTED' })
  })
})

describe('基础错误映射', () => {
  it('401 鉴权失败映射为 MISSING_CREDENTIAL（凭据问题确定性信号）', async () => {
    mockFetch(
      () =>
        new Response(JSON.stringify({ error: { code: 'InvalidApiKey', message: 'bad key' } }), {
          status: 401,
        }),
    )
    await expect(provider().generate(wireframeSpec)).rejects.toMatchObject({
      code: 'MISSING_CREDENTIAL',
    })
  })

  it('其余非 2xx 映射为 HTTP_ERROR 并携带状态码与错误体信息', async () => {
    mockFetch(
      () =>
        new Response(JSON.stringify({ error: { code: 'ServerError', message: 'boom' } }), {
          status: 500,
        }),
    )
    const err = await provider()
      .generate(wireframeSpec)
      .catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ImageProviderError)
    expect((err as ImageProviderError).code).toBe('HTTP_ERROR')
    expect((err as ImageProviderError).message).toContain('500')
    expect((err as ImageProviderError).message).toContain('boom')
  })
})

/** 挂起 fetch：不主动返回，信号中止时以中止原因拒绝（与 undici 真实行为一致）。 */
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

describe('协议方言与错误完备', () => {
  it('HTTP 200 但响应体是 HTML 页时抛 BAD_RESPONSE 并携带片段（HTML-200 陷阱）', async () => {
    mockFetch(
      () => new Response('<!doctype html><html lang="en"><title>Nezha</title>', { status: 200 }),
    )
    const err = await provider()
      .generate(wireframeSpec)
      .catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ImageProviderError)
    expect((err as ImageProviderError).code).toBe('BAD_RESPONSE')
    expect((err as ImageProviderError).message).toContain('不是 JSON')
    expect((err as ImageProviderError).message).toContain('<!doctype html>')
  })

  it('429 映射为 RATE_LIMITED，error 包裹与顶层 code/message 双形态都可提取', async () => {
    mockFetch(
      () =>
        new Response(JSON.stringify({ error: { code: 'RateLimit', message: 'slow down' } }), {
          status: 429,
        }),
    )
    const first = await provider()
      .generate(wireframeSpec)
      .catch((e: unknown) => e)
    expect((first as ImageProviderError).code).toBe('RATE_LIMITED')
    expect((first as ImageProviderError).message).toContain('slow down')

    mockFetch(
      () => new Response(JSON.stringify({ code: '429', message: 'too many' }), { status: 429 }),
    )
    const second = await provider()
      .generate(wireframeSpec)
      .catch((e: unknown) => e)
    expect((second as ImageProviderError).code).toBe('RATE_LIMITED')
    expect((second as ImageProviderError).message).toContain('too many')
  })

  it('503 模型不存在（new_api 方言）映射为 HTTP_ERROR 并透传状态码与错误码', async () => {
    mockFetch(
      () =>
        new Response(
          JSON.stringify({ error: { code: 'model_not_found', message: 'no such model' } }),
          {
            status: 503,
          },
        ),
    )
    const err = await provider()
      .generate(wireframeSpec)
      .catch((e: unknown) => e)
    expect((err as ImageProviderError).code).toBe('HTTP_ERROR')
    expect((err as ImageProviderError).message).toContain('503')
    expect((err as ImageProviderError).message).toContain('model_not_found')
  })

  it('400 参数错误映射为 INVALID_PARAMETER（n>1 被网关拒绝时的典型形态）', async () => {
    mockFetch(
      () =>
        new Response(
          JSON.stringify({ error: { code: 'InvalidParameter', message: 'n not allowed' } }),
          {
            status: 400,
          },
        ),
    )
    const err = await provider()
      .generate({ ...wireframeSpec, n: 2 })
      .catch((e: unknown) => e)
    expect((err as ImageProviderError).code).toBe('INVALID_PARAMETER')
    expect((err as ImageProviderError).message).toContain('n not allowed')
  })

  it('顶层 InvalidApiKey（无 error 包裹）也判定为 MISSING_CREDENTIAL', async () => {
    mockFetch(
      () =>
        new Response(JSON.stringify({ code: 'InvalidApiKey', message: 'wrong key' }), {
          status: 401,
        }),
    )
    await expect(provider().generate(wireframeSpec)).rejects.toMatchObject({
      code: 'MISSING_CREDENTIAL',
    })
  })

  it('429 空响应体也报 RATE_LIMITED 而非 BAD_RESPONSE', async () => {
    mockFetch(() => new Response('', { status: 429 }))
    await expect(provider().generate(wireframeSpec)).rejects.toMatchObject({
      code: 'RATE_LIMITED',
    })
  })

  it('超时窗口耗尽映射为 TIMEOUT（真实挂钟，fake timers 触发不了 AbortSignal.timeout）', async () => {
    mockFetch(hangUntilAbort)
    await expect(provider({ requestTimeoutMs: 200 }).generate(wireframeSpec)).rejects.toMatchObject(
      {
        code: 'TIMEOUT',
      },
    )
  })

  it('调用方取消原样上抛 AbortError，不冒充 TIMEOUT', async () => {
    mockFetch(hangUntilAbort)
    const controller = new AbortController()
    const promise = provider().generate(wireframeSpec, controller.signal)
    const expectation = expect(promise).rejects.toMatchObject({ name: 'AbortError' })
    controller.abort()
    await expectation
  })

  it('连接失败（undici TypeError）映射为 NETWORK_ERROR', async () => {
    mockFetch(() => Promise.reject(new TypeError('fetch failed')))
    const err = await provider()
      .generate(wireframeSpec)
      .catch((e: unknown) => e)
    expect((err as ImageProviderError).code).toBe('NETWORK_ERROR')
    expect((err as ImageProviderError).message).toContain('fetch failed')
  })

  it('非传输类异常原样上抛，不伪装网络问题', async () => {
    mockFetch(() => Promise.reject(new RangeError('invalid header value')))
    await expect(provider().generate(wireframeSpec)).rejects.toBeInstanceOf(RangeError)
  })

  it('2xx 响应体是 JSON 字面量 null 时按 BAD_RESPONSE 处理，不抛裸 TypeError', async () => {
    mockFetch(() => new Response('null', { status: 200 }))
    const err = await provider()
      .generate(wireframeSpec)
      .catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ImageProviderError)
    expect((err as ImageProviderError).code).toBe('BAD_RESPONSE')
  })

  it('extractImages 跳过空串与非法条目（非数组输入返回空）', () => {
    expect(extractImages(null)).toEqual([])
    expect(extractImages('nope')).toEqual([])
    expect(
      extractImages([{ url: '' }, { b64_json: '' }, 42, null, { url: 'https://a/1.png' }]),
    ).toEqual([{ url: 'https://a/1.png' }])
  })
})
