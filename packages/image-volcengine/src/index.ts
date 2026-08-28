import { readFile } from 'node:fs/promises'
import { resolve, sep } from 'node:path'
import { inspect } from 'node:util'
import { credentialRef, type CredentialRef } from '@deepseek-ai/dsh-credentials'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import ImageGenerationService, {
  ImageProviderError,
  type GeneratedImage,
  type ImageEditSpec,
  type ImageGenerateResult,
  type ImageGenerateSpec,
} from '@mackwan84/dsh-image'

/**
 * 可取消的延时：使用全局 setTimeout（测试环境可用 fake timers 控制）。
 * 与 dashscope Provider 同构：限流退避是两个 Provider 唯一的定时等待点。
 */
function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolvePromise, rejectPromise) => {
    if (signal?.aborted) {
      rejectPromise(new DOMException('Aborted', 'AbortError'))
      return
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolvePromise()
    }, ms)
    const onAbort = () => {
      clearTimeout(timer)
      rejectPromise(new DOMException('Aborted', 'AbortError'))
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

/** 凭据 seam 的结构面（本包只读 resolve，不依赖完整类型）。 */
interface CredentialsFace {
  resolve(ref: CredentialRef): Promise<{ value: string } | undefined>
}

export interface Config {
  /** 凭据引用（环境变量名），默认 `ARK_API_KEY`。 */
  apiKey: string
  /** 方舟网关基础地址（含 /api/v3 前缀）。 */
  baseUrl: string
  /** 线框图默认模型（方舟无保真度分层，与高保真同默认）。 */
  wireframeModel: string
  /** 高保真默认模型。 */
  highFidelityModel: string
  /** 指令编辑默认模型（seededit 3.0 i2i，与生成共用同一端点）。 */
  editModel: string
  /** 同步请求超时（毫秒）；官方未公布网关上限，4K 长耗时建议 ≥300s。 */
  requestTimeoutMs: number
  /** 限流退避重试次数。 */
  rateLimitRetries: number
  /** 限流退避间隔（毫秒）。 */
  rateLimitBackoffMs: number
}

export const Config: z<Config> = z.object({
  apiKey: z.string().default('ARK_API_KEY'),
  baseUrl: z.string().default('https://ark.cn-beijing.volces.com/api/v3'),
  wireframeModel: z.string().default('doubao-seedream-4-0-250828'),
  highFidelityModel: z.string().default('doubao-seedream-4-0-250828'),
  editModel: z.string().default('doubao-seededit-3-0-i2i-250628'),
  requestTimeoutMs: z.number().default(300_000),
  rateLimitRetries: z.number().default(2),
  rateLimitBackoffMs: z.number().default(25_000),
})

type JsonObject = Record<string, unknown>

/** size 档位白名单（大小写不敏感），命中即归一为方舟官方写法。 */
const ARK_SIZE_TIERS = new Map([
  ['adaptive', 'adaptive'],
  ['1k', '1K'],
  ['2k', '2K'],
  ['4k', '4K'],
])

/**
 * 方舟显式 WxH 的合法域（官方文档：总像素 [1280x720, 4096x4096] 且宽高比 [1/16, 16]）。
 * 官方同时点名 "1024x1024" 不合法——其总像素 1,048,576 高于 921,600，说明真实校验
 * 在总像素之外还有边长约束；据此推断为「短边 ≥ 720 且长边 ≥ 1280」（与
 * 1280x720 / 720x1280 合法、1024x1024 不合法两个已确认事实一致）。
 */
const ARK_SIZE_MIN_SHORT = 720
const ARK_SIZE_MIN_LONG = 1280
const ARK_SIZE_MAX_PIXELS = 4096 * 4096
const ARK_SIZE_MAX_RATIO = 16

/** 把解析出的宽高钳制进方舟合法域；不可达（下界放大即超上界）返回 null。 */
function clampArkDimensions(
  width: number,
  height: number,
): { width: number; height: number } | null {
  const short = Math.min(width, height)
  const long = Math.max(width, height)
  if (long / short > ARK_SIZE_MAX_RATIO) return null
  // 等比放大补足边长下限（如 1024x1024 → 1280x1280、720x1280 原样）
  const scaleUp = Math.max(1, ARK_SIZE_MIN_SHORT / short, ARK_SIZE_MIN_LONG / long)
  let w = Math.ceil((width * scaleUp) / 2) * 2
  let h = Math.ceil((height * scaleUp) / 2) * 2
  // 超出总像素上界时等比缩小（极端宽高比在下界放大后即超上界的组合不可达）
  const pixels = w * h
  if (pixels > ARK_SIZE_MAX_PIXELS) {
    const scaleDown = Math.sqrt(ARK_SIZE_MAX_PIXELS / pixels)
    w = Math.floor((w * scaleDown) / 2) * 2
    h = Math.floor((h * scaleDown) / 2) * 2
    if (Math.min(w, h) < ARK_SIZE_MIN_SHORT) return null
  }
  return { width: w, height: h }
}

/**
 * 插件统一 size（"1280*720" 风格或档位名）→ 方舟生成 size 值（seedream 系）。
 * 方舟与百炼的画幅体系不同：档位 "1K/2K/4K" 与显式 "宽x高" 是两种互斥写法
 * （单次请求只传一种，天然不混用）；"adaptive" 是 seededit 专属档位，生成路径不接受。
 * 缺省按平台给 16:9 / 9:16 的显式像素（横竖方向即平台方向，无需在 prompt 里补比例描述）；
 * 显式 WxH 低于边长下限时等比放大（工具文档示例 720*1280 由此保证可用），
 * 超出总像素上界时等比缩小，宽高比越界按 INVALID_PARAMETER 拒绝。
 */
export function toArkGenerateSize(size: string | undefined, platform: 'web' | 'mobile'): string {
  if (size === undefined || size.trim() === '') {
    return platform === 'mobile' ? '1080x1920' : '1920x1080'
  }
  const normalized = size.trim().toLowerCase()
  const tier = ARK_SIZE_TIERS.get(normalized)
  if (tier !== undefined) {
    if (tier === 'adaptive') {
      throw new ImageProviderError(
        'INVALID_PARAMETER',
        'adaptive 画幅仅用于编辑模式（seededit）; 生成请用 1K/2K/4K 或 宽x高',
      )
    }
    return tier
  }
  const parsed = /^(\d+)[x*](\d+)$/.exec(normalized)
  if (parsed === null) {
    throw new ImageProviderError(
      'INVALID_PARAMETER',
      `画幅 ${size} 不是方舟接受的格式（1K/2K/4K 或 宽x高）`,
    )
  }
  const clamped = clampArkDimensions(Number(parsed[1]), Number(parsed[2]))
  if (clamped === null) {
    throw new ImageProviderError(
      'INVALID_PARAMETER',
      `画幅 ${size} 超出方舟合法范围（宽高比 [1/16, 16] 且总像素不超过 4096x4096）`,
    )
  }
  return `${clamped.width}x${clamped.height}`
}

/**
 * 编辑（seededit）size：缺省 "adaptive"（跟随基准图比例，编辑场景最稳）；
 * 显式值只做格式归一（* → x、档位大小写），不套生成的边长钳制——
 * seededit 显式像素的合法域官方未确认，交由网关校验并经错误映射如实上报。
 */
export function toArkEditSize(size: string | undefined): string {
  if (size === undefined || size.trim() === '') return 'adaptive'
  const normalized = size.trim().toLowerCase()
  const tier = ARK_SIZE_TIERS.get(normalized)
  if (tier !== undefined) return tier
  if (/^\d+x\d+$/.test(normalized)) return normalized
  if (/^\d+\*\d+$/.test(normalized)) return normalized.replace('*', 'x')
  throw new ImageProviderError(
    'INVALID_PARAMETER',
    `画幅 ${size} 不是方舟接受的格式（adaptive/1K/2K/4K 或 宽x高）`,
  )
}

/**
 * 解析图片绝对路径并校验不逃逸出工作目录：reference/baseImage 是模型可控输入，
 * 防止越界读取后外发。与 dashscope Provider 同一防逃逸口径。
 */
function resolveImagePath(imagePath: string, cwd?: string): string {
  const root = resolve(cwd ?? '.')
  const absolute = resolve(root, imagePath)
  if (absolute !== root && !absolute.startsWith(root + sep)) {
    throw new ImageProviderError(
      'INVALID_PARAMETER',
      `图片路径 ${imagePath} 逃逸出工作目录 ${root}`,
    )
  }
  return absolute
}

/** 本地图 → base64 data URL（方舟 image 字段接受 data URL，无需先上传）。 */
async function toDataUrl(imagePath: string, cwd?: string): Promise<string> {
  const bytes = await readFile(resolveImagePath(imagePath, cwd))
  return `data:image/png;base64,${bytes.toString('base64')}`
}

/** 网关错误字段是任意 JSON 值：安全序列化为可读文本，避免 [object Object] 掩盖真实原因。 */
function textOf(value: unknown): string {
  if (typeof value === 'string') return value
  if (value === null || value === undefined) return ''
  try {
    return JSON.stringify(value) ?? ''
  } catch {
    // JSON.stringify 失败(如循环引用)时退化为 inspect, 保证错误信息生成路径自身永不抛出
    return inspect(value, { depth: 2 })
  }
}

/**
 * 从错误响应中提取 { code, message }：方舟的 OpenAI 风格包裹为
 * error.code/error.message，但顶层 code/message 的写法也在网关侧出现过，
 * 两种包裹都识别，避免结构差异把可判定的错误变成 BAD_RESPONSE。
 */
function parseErrorBody(data: JsonObject): { code: string; message: string } {
  const error =
    data.error !== null && typeof data.error === 'object' ? (data.error as JsonObject) : undefined
  const code = [error?.code, data.code].find(
    (value): value is string => typeof value === 'string' && value !== '',
  )
  const message = [error?.message, data.message].find(
    (value): value is string => typeof value === 'string' && value !== '',
  )
  return { code: code ?? '', message: message ?? '' }
}

/** 从成功响应 data[] 提取图片 URL；b64_json 归一为 data URL 以满足契约的 URL 语义。 */
export function extractImages(data: unknown): GeneratedImage[] {
  if (!Array.isArray(data)) return []
  const images: GeneratedImage[] = []
  for (const item of data) {
    if (item === null || typeof item !== 'object') continue
    const record = item as JsonObject
    if (typeof record.url === 'string' && record.url !== '') {
      images.push({ url: record.url })
    } else if (typeof record.b64_json === 'string' && record.b64_json !== '') {
      images.push({ url: `data:image/png;base64,${record.b64_json}` })
    }
  }
  return images
}

/** 火山方舟图像生成 Provider：seedream 4.0 系同步 API（文生图 + 参考图 I2I + 指令编辑）。 */
export default class VolcengineImageProvider extends ImageGenerationService {
  static Config = Config

  readonly providerId = 'volcengine'

  constructor(
    ctx: Context,
    public config: Config,
  ) {
    super(ctx)
  }

  /** 凭据解析顺序：credentials seam → 启动环境（.env/进程环境）→ MISSING_CREDENTIAL。 */
  private async resolveApiKey(): Promise<string> {
    const ref = credentialRef(this.config.apiKey)
    const credentials = this.ctx.get('credentials') as CredentialsFace | undefined
    if (credentials !== undefined) {
      const hit = await credentials.resolve(ref)
      if (hit !== undefined && hit.value.length > 0) return hit.value
    }
    const ambient = launchEnvironmentOf(this.ctx).get(ref)
    if (ambient !== undefined && ambient.value.length > 0) return ambient.value
    throw new ImageProviderError(
      'MISSING_CREDENTIAL',
      `未配置 ${this.config.apiKey}：通过凭据服务存储（设置面板写入），或在该进程环境导出 ${this.config.apiKey}`,
    )
  }

  async generate(spec: ImageGenerateSpec, signal?: AbortSignal): Promise<ImageGenerateResult> {
    const apiKey = await this.resolveApiKey()
    const model =
      spec.model ??
      (spec.fidelity === 'high-fidelity'
        ? this.config.highFidelityModel
        : this.config.wireframeModel)
    const size = toArkGenerateSize(spec.size, spec.platform)
    const n = Math.min(4, Math.max(1, Math.trunc(spec.n ?? 1)))

    /**
     * 方舟的多图输出走组图/序列参数，语义与百炼 parameters.n 不同且未在本仓验证；
     * 稳妥策略是串行单图调用：consumer 逐张下载/落盘/入附件的流程不变。
     */
    const images: GeneratedImage[] = []
    let lastModel = model
    for (let i = 0; i < n; i++) {
      const body: JsonObject = {
        model,
        prompt: spec.prompt,
        response_format: 'url',
        size,
        // 草图是工作产物：关闭方舟默认的右下角 AI 生成水印
        watermark: false,
      }
      if (spec.reference !== undefined && spec.reference !== '') {
        // I2I 风格一致：参考图取 data URL，随请求体内联
        body.image = [await toDataUrl(spec.reference, spec.cwd)]
      }
      const result = await this.postImages(body, apiKey, signal)
      lastModel = result.model
      images.push(...result.images)
    }
    if (images.length === 0) {
      throw new ImageProviderError('BAD_RESPONSE', '响应成功但没有图片结果')
    }
    return { model: lastModel, images }
  }

  /**
   * 指令编辑：seedream 端点同端点编辑（image 传基准图 + prompt 传编辑指令）。
   * 方舟不支持掩码局部重绘（老 inpainting 链路已下线），mask 显式 NOT_IMPLEMENTED，
   * 让调用方拿到机器可判的错误码而非参数被静默丢弃。
   */
  async edit(spec: ImageEditSpec, signal?: AbortSignal): Promise<ImageGenerateResult> {
    if (spec.mask !== undefined && spec.mask !== '') {
      throw new ImageProviderError(
        'NOT_IMPLEMENTED',
        '方舟图像 API 不支持掩码局部重绘: 请省略 mask, 以编辑指令整体重绘',
      )
    }
    const apiKey = await this.resolveApiKey()
    // 编辑默认走 seededit 3.0 i2i（指令编辑专用），显式 spec.model 覆盖
    const model = spec.model ?? this.config.editModel
    const body: JsonObject = {
      model,
      prompt: spec.prompt,
      response_format: 'url',
      size: toArkEditSize(spec.size),
      watermark: false,
      image: [await toDataUrl(spec.baseImage, spec.cwd)],
    }
    const result = await this.postImages(body, apiKey, signal)
    if (result.images.length === 0) {
      throw new ImageProviderError('BAD_RESPONSE', '编辑响应成功但没有图片结果')
    }
    return { model: result.model, images: result.images }
  }

  /** 调用同步生成端点；429 限流按配置退避重试，其余非 2xx 一次性判定。 */
  private async postImages(
    body: JsonObject,
    apiKey: string,
    signal?: AbortSignal,
  ): Promise<{ model: string; images: GeneratedImage[] }> {
    let last: { status: number; data: JsonObject }
    for (let attempt = 0; ; attempt++) {
      last = await this.postJson('/images/generations', body, apiKey, signal)
      if (last.status === 429) {
        if (attempt < this.config.rateLimitRetries) {
          await delay(this.config.rateLimitBackoffMs, signal)
          continue
        }
        const parsed = parseErrorBody(last.data)
        throw new ImageProviderError('RATE_LIMITED', textOf(parsed.message || parsed.code || 429))
      }
      break
    }
    if (last.status < 200 || last.status >= 300) {
      const parsed = parseErrorBody(last.data)
      // 鉴权失败是凭据问题的确定性信号，单独给码方便面板/工具归因
      const code: ImageProviderError['code'] =
        last.status === 401 || parsed.code === 'AuthenticationError'
          ? 'MISSING_CREDENTIAL'
          : last.status === 400 || parsed.code === 'InvalidParameter'
            ? 'INVALID_PARAMETER'
            : 'HTTP_ERROR'
      throw new ImageProviderError(
        code,
        `HTTP ${last.status}${parsed.code !== '' ? ` (${parsed.code})` : ''}: ${textOf(parsed.message || '无响应体')}`,
      )
    }
    const model = typeof last.data.model === 'string' ? last.data.model : ''
    const images = extractImages(last.data.data)
    if (images.length === 0) {
      throw new ImageProviderError('BAD_RESPONSE', '响应缺少 data[].url 图片结果')
    }
    return { model, images }
  }

  private async postJson(
    path: string,
    body: JsonObject,
    apiKey: string,
    signal?: AbortSignal,
  ): Promise<{ status: number; data: JsonObject }> {
    // 同步生成是单次长请求：官方未公布网关超时上限，超时取配置窗口与调用方
    // signal 的先到者（AbortSignal.any 原生组合，任一触发即中断请求）。
    const timeout = AbortSignal.timeout(this.config.requestTimeoutMs)
    const res = await fetch(this.config.baseUrl + path, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      redirect: 'error',
      signal: signal === undefined ? timeout : AbortSignal.any([signal, timeout]),
    })
    const text = await res.text()
    let data: JsonObject
    try {
      data = JSON.parse(text) as JsonObject
    } catch {
      data = { message: text.slice(0, 200) }
    }
    return { status: res.status, data }
  }
}
