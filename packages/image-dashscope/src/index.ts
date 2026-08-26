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

/** 可取消的延时：使用全局 setTimeout（测试环境可用 fake timers 控制）。 */
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
  /** 凭据引用（环境变量名），默认 `DASHSCOPE_API_KEY`。 */
  apiKey: string
  /** 网关基础地址（国内网关）。 */
  baseUrl: string
  /** 线框图默认模型。 */
  wireframeModel: string
  /** 高保真默认模型。 */
  highFidelityModel: string
  /** 任务轮询总时限（毫秒）。 */
  pollTimeoutMs: number
  /** 轮询间隔（毫秒）。 */
  pollIntervalMs: number
  /** 限流退避重试次数。 */
  rateLimitRetries: number
  /** 限流退避间隔（毫秒）。 */
  rateLimitBackoffMs: number
}

export const Config: z<Config> = z.object({
  apiKey: z.string().default('DASHSCOPE_API_KEY'),
  baseUrl: z.string().default('https://dashscope.aliyuncs.com'),
  wireframeModel: z.string().default('qwen-image-3.0'),
  highFidelityModel: z.string().default('qwen-image-3.0-pro'),
  pollTimeoutMs: z.number().default(600_000),
  pollIntervalMs: z.number().default(5_000),
  rateLimitRetries: z.number().default(2),
  rateLimitBackoffMs: z.number().default(25_000),
})

type JsonObject = Record<string, unknown>

/** 解析参考图绝对路径并校验不逃逸出工作目录：reference 是模型可控输入，防止越界读取后外发。 */
function resolveReferencePath(reference: string, cwd?: string): string {
  const root = resolve(cwd ?? '.')
  const absolute = resolve(root, reference)
  if (absolute !== root && !absolute.startsWith(root + sep)) {
    throw new ImageProviderError(
      'INVALID_PARAMETER',
      `参考图路径 ${reference} 逃逸出工作目录 ${root}`,
    )
  }
  return absolute
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

/** 识别错误响应中的限流错误码。 */
function isRateLimitCode(code: unknown): code is string {
  return typeof code === 'string' && (code.includes('Throttling') || code.includes('RateQuota'))
}

/** 从任务输出中提取图片 URL：兼容 wanx 的 results[].url 与 qwen-image 的 choices[].message.content[].image。 */
export function extractImageUrls(output: unknown): string[] {
  if (output === null || typeof output !== 'object') return []
  const record = output as JsonObject
  const urls: string[] = []
  if (Array.isArray(record.results)) {
    for (const item of record.results) {
      if (
        item !== null &&
        typeof item === 'object' &&
        typeof (item as JsonObject).url === 'string'
      ) {
        urls.push((item as JsonObject).url as string)
      }
    }
  }
  if (Array.isArray(record.choices)) {
    for (const choice of record.choices) {
      const message =
        choice !== null && typeof choice === 'object' ? (choice as JsonObject).message : undefined
      const content =
        message !== null && typeof message === 'object'
          ? (message as JsonObject).content
          : undefined
      if (Array.isArray(content)) {
        for (const item of content) {
          if (
            item !== null &&
            typeof item === 'object' &&
            typeof (item as JsonObject).image === 'string'
          ) {
            urls.push((item as JsonObject).image as string)
          }
        }
      }
    }
  }
  return urls
}

/** 阿里云百炼图像生成 Provider。 */
export default class DashscopeImageProvider extends ImageGenerationService {
  static Config = Config

  constructor(
    ctx: Context,
    public config: Config,
  ) {
    super(ctx)
  }

  /** 凭据解析顺序：credentials seam → 启动环境（.env/进程环境）→ MISSING_CREDENTIAL。纯内存/环境读取，无可取消的 IO。 */
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
    const size = spec.size ?? (spec.platform === 'mobile' ? '720*1280' : '1280*720')
    const n = Math.min(4, Math.max(1, Math.trunc(spec.n ?? 1)))
    const isQwen = model.startsWith('qwen-image')

    let path: string
    let input: JsonObject
    if (isQwen) {
      const content: JsonObject[] = []
      if (spec.reference !== undefined && spec.reference !== '') {
        const bytes = await readFile(resolveReferencePath(spec.reference, spec.cwd))
        content.push({ image: `data:image/png;base64,${bytes.toString('base64')}` })
      }
      content.push({ text: spec.prompt })
      path = '/api/v1/services/aigc/image-generation/generation'
      input = { messages: [{ role: 'user', content }] }
    } else {
      if (spec.reference !== undefined && spec.reference !== '') {
        throw new ImageProviderError(
          'INVALID_PARAMETER',
          `参考图模式仅支持 qwen-image 系列模型（当前 ${model}）`,
        )
      }
      path = '/api/v1/services/aigc/text2image/image-synthesis'
      input = { prompt: spec.prompt }
    }

    const created = await this.createTask(
      path,
      { model, input, parameters: { size, n } },
      apiKey,
      signal,
    )
    const output = created.syncOutput ?? (await this.waitForTask(created.taskId, apiKey, signal))
    const urls = extractImageUrls(output)
    if (urls.length === 0) {
      throw new ImageProviderError('BAD_RESPONSE', '任务成功但响应中没有图片 URL')
    }
    const images: GeneratedImage[] = urls.map((url) => ({ url }))
    return { model, images }
  }

  edit(_spec: ImageEditSpec, _signal?: AbortSignal): Promise<ImageGenerateResult> {
    // 编辑模式（参考图 + 编辑指令 / 掩码局部重绘）在 M4 提供。
    // 返回 rejected promise 而非同步 throw: 保持 Promise 调用契约, 调用方的 .catch() 不被绕过
    return Promise.reject(new ImageProviderError('NOT_IMPLEMENTED', '编辑模式将在后续版本提供'))
  }

  /** 创建异步任务；限流时按配置退避重试。 */
  private async createTask(
    path: string,
    body: JsonObject,
    apiKey: string,
    signal?: AbortSignal,
  ): Promise<{ taskId: string; syncOutput?: JsonObject }> {
    let last: { status: number; data: JsonObject }
    for (let attempt = 0; ; attempt++) {
      last = await this.postJson(path, body, apiKey, signal)
      const code = last.data.code
      if (isRateLimitCode(code)) {
        if (attempt < this.config.rateLimitRetries) {
          await delay(this.config.rateLimitBackoffMs, signal)
          continue
        }
        throw new ImageProviderError('RATE_LIMITED', textOf(last.data.message ?? code))
      }
      break
    }
    if (last.status !== 200) {
      throw new ImageProviderError(
        'HTTP_ERROR',
        `HTTP ${last.status}: ${textOf(last.data.message ?? last.data.code ?? '无响应体')}`,
      )
    }
    if (typeof last.data.code === 'string' && last.data.code !== '') {
      throw new ImageProviderError('INVALID_PARAMETER', textOf(last.data.message ?? last.data.code))
    }
    // 网关可能返回 "output": null（JSON null），与 undefined 一并防御，避免 null.task_id 抛裸 TypeError。
    const output = last.data.output as JsonObject | null | undefined
    if (output != null && typeof output.task_id === 'string') {
      return { taskId: output.task_id }
    }
    const syncUrls = output != null ? extractImageUrls(output) : []
    if (syncUrls.length > 0 && output != null) return { taskId: '', syncOutput: output }
    throw new ImageProviderError('BAD_RESPONSE', '创建任务响应缺少 task_id 与图片结果')
  }

  /** 轮询任务直到 SUCCEEDED / FAILED / 超时；尊重 signal 取消。 */
  private async waitForTask(
    taskId: string,
    apiKey: string,
    signal?: AbortSignal,
  ): Promise<JsonObject> {
    const deadline = Date.now() + this.config.pollTimeoutMs
    for (;;) {
      const res = await fetch(`${this.config.baseUrl}/api/v1/tasks/${taskId}`, {
        headers: { Authorization: `Bearer ${apiKey}` },
        redirect: 'error',
        signal,
      })
      const data = (await res.json().catch(() => ({}))) as JsonObject
      const code = typeof data.code === 'string' && data.code !== '' ? data.code : undefined
      // 携带错误码的响应（鉴权失效/任务不存在/参数非法等）是确定性失败：
      // 立即终止，而不是空转轮询到超时把真实根因掩盖成 TIMEOUT。
      if (code !== undefined) {
        throw new ImageProviderError(
          'TASK_FAILED',
          `轮询任务 ${taskId} 失败: HTTP ${res.status} (${code}): ${textOf(data.message ?? code)}`,
        )
      }
      // 无错误码的 4xx（除 429）同样是确定性失败（如网关 HTML 403 页）。
      if (res.status >= 400 && res.status < 500 && res.status !== 429) {
        throw new ImageProviderError(
          'HTTP_ERROR',
          `轮询任务 ${taskId} 失败: HTTP ${res.status}: ${textOf(data.message ?? '无响应体')}`,
        )
      }
      // 5xx/429 视为瞬态网关错误：任务仍在服务端运行，继续轮询直到时限。
      const output = (data.output ?? {}) as JsonObject
      const status = output.task_status
      if (status === 'SUCCEEDED') return output
      if (status === 'FAILED' || status === 'CANCELED') {
        throw new ImageProviderError('TASK_FAILED', textOf(output.message ?? output.code ?? status))
      }
      if (Date.now() >= deadline) {
        throw new ImageProviderError(
          'TIMEOUT',
          `任务 ${taskId} 超过 ${this.config.pollTimeoutMs}ms 未完成`,
        )
      }
      await delay(this.config.pollIntervalMs, signal)
    }
  }

  private async postJson(
    path: string,
    body: JsonObject,
    apiKey: string,
    signal?: AbortSignal,
  ): Promise<{ status: number; data: JsonObject }> {
    const res = await fetch(this.config.baseUrl + path, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
        'X-DashScope-Async': 'enable',
      },
      body: JSON.stringify(body),
      redirect: 'error',
      signal,
    })
    const text = await res.text()
    let data: JsonObject
    try {
      data = JSON.parse(text) as JsonObject
    } catch {
      data = { code: 'BAD_RESPONSE', message: text.slice(0, 200) }
    }
    return { status: res.status, data }
  }
}
