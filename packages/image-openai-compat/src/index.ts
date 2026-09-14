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

/** 凭据 seam 的结构面（本包只读 resolve，不依赖完整类型）。 */
interface CredentialsFace {
  resolve(ref: CredentialRef): Promise<{ value: string } | undefined>
}

export interface Config {
  /** 凭据引用（环境变量名），默认 `OPENAI_COMPAT_API_KEY`。 */
  apiKey: string
  /** 网关基础地址（用户填到 /v1 为止，通常以 /v1 结尾；默认空=未配置，报明确错误，不自动补前缀）。 */
  baseUrl: string
  /** 线框图分层默认模型（部署期预置；空=未配置，生成时报可操作错误）。 */
  wireframeModel: string
  /** 高保真分层默认模型（部署期预置；空=未配置，生成时报可操作错误）。 */
  highFidelityModel: string
  /** 同步请求超时（毫秒）；生图网关常见 30~120s，慢网关建议 ≥300s。 */
  requestTimeoutMs: number
}

export const Config: z<Config> = z.object({
  apiKey: z.string().default('OPENAI_COMPAT_API_KEY'),
  baseUrl: z.string().default(''),
  wireframeModel: z.string().default(''),
  highFidelityModel: z.string().default(''),
  requestTimeoutMs: z.number().default(300_000),
})

type JsonObject = Record<string, unknown>

/**
 * 插件统一 size（"1280*720" 风格）→ OpenAI 兼容写法（"1280x720"）。
 * 只做分隔符归一与空白裁剪后透传：各家网关的预设表是方言，本地不设白名单、
 * 不改比例，由网关自行校验（拒绝时错误透传，用户显式换预设值即可）。
 */
export function toCompatSize(size: string | undefined): string | undefined {
  const trimmed = size?.trim()
  if (trimmed === undefined || trimmed === '') return undefined
  return trimmed.replaceAll('*', 'x')
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
 * 从错误响应中提取 { code, message }：OpenAI 官方包裹为 error.code/error.message，
 * 网关侧顶层 code/message 的写法也常见（含 new_api 系方言），两种包裹都识别，
 * 避免结构差异把可判定的错误变成 BAD_RESPONSE。
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

/** 从成功响应 data[] 提取图片；b64_json 归一为 data URL 以满足契约的 URL 语义。 */
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

/**
 * OpenAI 兼容网关图像生成 Provider：`POST {baseUrl}/images/generations` 同步协议，
 * 面向 one-api / new-api 等私有聚合网关（官方 OpenAI 是可配特例）。
 * 最小公共子集：model + prompt + n + size 四参数；n 原生下传；双返回格式归一；
 * 参考图（I2I）与指令编辑不在子集内，显式 NOT_IMPLEMENTED。
 */
export default class OpenaiCompatImageProvider extends ImageGenerationService {
  static Config = Config

  readonly providerId = 'openai-compat'

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
    const baseUrl = this.config.baseUrl.trim().replace(/\/+$/, '')
    if (baseUrl === '') {
      throw new ImageProviderError(
        'INVALID_PARAMETER',
        '未配置 OpenAI 兼容网关地址(baseUrl): 请在设置面板「连接配置」中填写网关地址(通常以 /v1 结尾), 或在部署配置层预置',
      )
    }
    const model =
      spec.model ??
      (spec.fidelity === 'high-fidelity'
        ? this.config.highFidelityModel
        : this.config.wireframeModel)
    if (model === undefined || model.trim() === '') {
      throw new ImageProviderError(
        'INVALID_PARAMETER',
        '未配置模型: 请在设置面板「提供方与模型」为线框图/高保真选择模型(可手填), 或在调用时显式传 model',
      )
    }
    if (spec.reference !== undefined && spec.reference !== '') {
      throw new ImageProviderError(
        'NOT_IMPLEMENTED',
        'OpenAI 兼容最小子集不含参考图(I2I): 风格锚点会被消费方跳过注入; 如需图生图请换用支持参考图的提供方',
      )
    }
    const body: JsonObject = {
      model,
      prompt: spec.prompt,
      n: Math.min(4, Math.max(1, Math.trunc(spec.n ?? 1))),
    }
    const size = toCompatSize(spec.size)
    if (size !== undefined) body.size = size

    const result = await this.postImages(body, apiKey, signal)
    return result
  }

  /** 指令编辑（/v1/images/edits，multipart）不在最小子集内。
   *  返回 rejected promise 而非同步 throw: 保持 Promise 调用契约, 调用方的 .catch() 不被绕过。 */
  edit(_spec: ImageEditSpec, _signal?: AbortSignal): Promise<ImageGenerateResult> {
    return Promise.reject(
      new ImageProviderError(
        'NOT_IMPLEMENTED',
        'OpenAI 兼容最小子集不含指令编辑(/images/edits): 请整体重新生成, 或换用支持编辑的提供方',
      ),
    )
  }

  /** 调用同步生成端点；无内置退避重试（429 直接按 RATE_LIMITED 上报，由调用方决策）。 */
  private async postImages(
    body: JsonObject,
    apiKey: string,
    signal?: AbortSignal,
  ): Promise<{ model: string; images: GeneratedImage[] }> {
    const { status, data, json } = await this.postJson('/images/generations', body, apiKey, signal)
    if (status === 429) {
      const parsed = parseErrorBody(data)
      throw new ImageProviderError(
        'RATE_LIMITED',
        textOf(parsed.message || parsed.code || '网关限流'),
      )
    }
    if (status < 200 || status >= 300) {
      const parsed = parseErrorBody(data)
      // 鉴权失败是凭据问题的确定性信号，单独给码方便面板/工具归因
      const code: ImageProviderError['code'] =
        status === 401 || parsed.code === 'InvalidApiKey' || parsed.code === 'AuthenticationError'
          ? 'MISSING_CREDENTIAL'
          : status === 400 || parsed.code === 'InvalidParameter'
            ? 'INVALID_PARAMETER'
            : 'HTTP_ERROR'
      throw new ImageProviderError(
        code,
        `HTTP ${status}${parsed.code !== '' ? ` (${parsed.code})` : ''}: ${textOf(parsed.message || '无响应体')}`,
      )
    }
    const model = typeof data.model === 'string' ? data.model : ''
    const images = extractImages(data.data)
    if (images.length === 0) {
      // 非 JSON 的 2xx 响应按网关方言处理（如地址缺 /v1 前缀时返回网关前端 HTML 页）：
      // 携带响应片段让用户可判定是地址填错还是网关异常，而不是笼统的"缺少图片结果"
      throw new ImageProviderError(
        'BAD_RESPONSE',
        json
          ? '响应缺少 data[].url / data[].b64_json 图片结果'
          : `响应不是 JSON(可能是网关前端页, 请核对 baseUrl 是否以 /v1 结尾): ${textOf(data.message)}`,
      )
    }
    return { model, images }
  }

  private async postJson(
    path: string,
    body: JsonObject,
    apiKey: string,
    signal?: AbortSignal,
  ): Promise<{ status: number; data: JsonObject; json: boolean }> {
    // 同步生成是单次长请求：超时取配置窗口与调用方 signal 的先到者
    // （AbortSignal.any 原生组合，任一触发即中断请求）。
    const timeout = AbortSignal.timeout(this.config.requestTimeoutMs)
    let res: Response
    let text: string
    try {
      res = await fetch(this.config.baseUrl.trim().replace(/\/+$/, '') + path, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
        redirect: 'error',
        signal: signal === undefined ? timeout : AbortSignal.any([signal, timeout]),
      })
      text = await res.text()
    } catch (error) {
      // 调用方取消（会话中断）原样上抛，工具层凭 signal.aborted 如实归因；
      // 内部超时窗口耗尽映射为 TIMEOUT 码，否则裸 DOMException 只能落成无错误码的泛化失败
      if (signal?.aborted) throw error
      const name = error instanceof Error ? error.name : ''
      if (name === 'TimeoutError' || name === 'AbortError') {
        throw new ImageProviderError(
          'TIMEOUT',
          `生成请求超过 ${this.config.requestTimeoutMs}ms 未完成: 可减少张数重试或调大 requestTimeoutMs`,
        )
      }
      // undici 的连接/读写失败统一抛 TypeError（fetch failed、terminated 等）；
      // 其它异常（如非法 header 值这类编程错误）原样上抛，不冒充网络问题
      if (!(error instanceof TypeError)) throw error
      throw new ImageProviderError('NETWORK_ERROR', `连接 OpenAI 兼容网关失败: ${error.message}`)
    }
    let data: JsonObject
    let json: boolean
    try {
      data = JSON.parse(text) as JsonObject
      json = true
    } catch {
      // 非 JSON 响应体（如网关前端 HTML 页）保留片段参与错误文本，并标记供上层分流
      data = { message: text.slice(0, 200) }
      json = false
    }
    return { status: res.status, data, json }
  }
}
