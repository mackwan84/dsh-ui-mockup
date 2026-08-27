/**
 * 设置面板与历史数据的纯逻辑层：设置命名空间的 schema 与默认值、
 * 输出目录/数量校验、锚点文件名校验、历史行解析与过滤。
 * 无 IO、无 ctx 依赖，宿主半区与单元测试共用同一实现，避免两端口径漂移。
 */
import z from '@deepseek-ai/schemastery'

/** 生成偏好：设置命名空间 `ui-mockup` 的 section 结构。 */
export interface MockupPrefs {
  /** 未显式指定时的草图精度（工具调用 fidelity 为必填项，此值用于提示词建议）。 */
  defaultFidelity: 'wireframe' | 'high-fidelity'
  /** 未显式指定时的目标平台。 */
  defaultPlatform: 'web' | 'mobile'
  /** 未显式指定时一次生成的方案数量。 */
  defaultCount: number
  /** 生成图落盘目录（相对会话工作区根）。 */
  outputDir: string
  /** 任务轮询总时限（分钟），经 spec.pollTimeoutMs 下传 Provider。 */
  pollTimeoutMinutes: number
  /** 线框图默认模型；空串表示交由 Provider 按其配置决定。 */
  wireframeModel: string
  /** 高保真默认模型；空串同上。 */
  highFidelityModel: string
  /** 默认画幅，如 "1280*720"；空串表示按平台默认。 */
  defaultSize: string
}

/** 偏好默认值：与已确认线框一致（线框/Web/2 张/design/images/10 分钟），模型空 = Provider 自决。 */
export const DEFAULT_PREFS: MockupPrefs = {
  defaultFidelity: 'wireframe',
  defaultPlatform: 'web',
  defaultCount: 2,
  outputDir: 'design/images',
  pollTimeoutMinutes: 10,
  wireframeModel: '',
  highFidelityModel: '',
  defaultSize: '',
}

/**
 * 设置命名空间 schema：设置服务用它解析用户层并合成最终值，
 * 同一份 envelope 随 describe 到达浏览器端做客户端校验。
 */
export const PrefsSchema = z
  .object({
    defaultFidelity: z.union(['wireframe', 'high-fidelity'] as const).default('wireframe'),
    defaultPlatform: z.union(['web', 'mobile'] as const).default('web'),
    defaultCount: z.number().min(1).max(4).step(1).default(2),
    outputDir: z.string().default('design/images'),
    pollTimeoutMinutes: z.number().min(1).max(60).default(10),
    wireframeModel: z.string().default(''),
    highFidelityModel: z.string().default(''),
    defaultSize: z.string().default(''),
  })
  .description('UI 草图偏好')

/** 把输出目录规范为「相对工作区根的子路径」；非法输入返回 null（由 UI 拒绝保存）。 */
export function sanitizeOutputDir(input: string): string | null {
  const trimmed = input.trim().replace(/^\.\//, '').replace(/\/+$/, '')
  if (trimmed === '') return null
  // 绝对路径与任何形式的向上逃逸都拒绝：落盘根必须锁定在会话工作区内
  if (/^([A-Za-z]:[\\/]|\/)/.test(input.trim())) return null
  if (trimmed.split('/').includes('..')) return null
  return trimmed
}

/** 把任意输入钳制为合法的数量 1–4；非数值回退默认。 */
export function clampCount(value: unknown): number {
  const n =
    typeof value === 'number' && Number.isFinite(value)
      ? Math.round(value)
      : DEFAULT_PREFS.defaultCount
  return Math.min(4, Math.max(1, n))
}

const IMAGE_EXT_PATTERN = /\.(png|jpe?g|webp|gif)$/i

/**
 * 校验锚点引用的是 design/images/ 下的纯文件名（无路径分隔符）：
 * 锚点文件名最终拼进落盘路径并可能进入参考图请求，这里先挡掉路径逃逸。
 * @returns 规范化的文件名；不合法返回 null。
 */
export function sanitizeAnchorFileName(input: unknown): string | null {
  if (typeof input !== 'string') return null
  const name = input.trim()
  if (name === '' || name !== name.replace(/[\\/]/g, '')) return null
  if (name === '.' || name === '..') return null
  if (!name.startsWith('mockup-')) return null
  if (!IMAGE_EXT_PATTERN.test(name)) return null
  return name
}

/** 单条生成历史（history.jsonl 一行的结构化形态）。 */
export interface HistoryEntry {
  time: string
  description: string
  files: string[]
  model?: string
  fidelity?: string
  platform?: string
  size?: string
  status?: string
}

/** 解析一行历史 JSON；损坏行静默丢弃（历史只读展示，坏行不应拖垮整个面板）。 */
export function parseHistoryLine(line: string): HistoryEntry | null {
  const trimmed = line.trim()
  if (trimmed === '') return null
  try {
    const raw = JSON.parse(trimmed) as Record<string, unknown>
    if (typeof raw.time !== 'string' || typeof raw.description !== 'string') return null
    if (!Array.isArray(raw.files)) return null
    const files = raw.files.filter((item): item is string => typeof item === 'string')
    return {
      time: raw.time,
      description: raw.description,
      files,
      model: typeof raw.model === 'string' ? raw.model : undefined,
      fidelity: typeof raw.fidelity === 'string' ? raw.fidelity : undefined,
      platform: typeof raw.platform === 'string' ? raw.platform : undefined,
      size: typeof raw.size === 'string' && raw.size !== '' ? raw.size : undefined,
      status: typeof raw.status === 'string' ? raw.status : undefined,
    }
  } catch {
    return null
  }
}

/** 按描述子串过滤历史条目；查询词大小写不敏感、空白忽略。 */
export function filterHistory(entries: HistoryEntry[], query: string | undefined): HistoryEntry[] {
  const needle = (query ?? '').trim().toLowerCase()
  if (needle === '') return entries
  return entries.filter((entry) => entry.description.toLowerCase().includes(needle))
}

/** 历史分页默认每页条数（宿主与客户端共用同一常量）。 */
export const HISTORY_PAGE_SIZE = 8

/** 钳制每页条数到 [1, 50]，防异常/恶意值；非有限数回退默认。 */
export function clampPageSize(value: unknown): number {
  const n =
    typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : HISTORY_PAGE_SIZE
  return Math.min(50, Math.max(1, n))
}

/** 钳制页码到 [1, totalPages]；非有限数回退第 1 页。 */
export function clampPage(value: unknown, totalPages: number): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : 1
  return Math.min(totalPages, Math.max(1, n))
}

/** 锚点在过滤后列表中的索引 → 所在页码（1-based）；无锚点(-1)返回 null。 */
export function anchorPageOf(anchorIndex: number, pageSize: number): number | null {
  return anchorIndex < 0 ? null : Math.floor(anchorIndex / pageSize) + 1
}
