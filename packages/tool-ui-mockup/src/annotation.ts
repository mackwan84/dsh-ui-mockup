/**
 * 标注反馈纯逻辑层：标记几何（原图像素坐标）、归一化包围盒、文本投影、
 * 编号、弹窗显示坐标映射（1x/2x、devicePixelRatio）与反馈消息模板。
 * 无 IO、无 DOM、无 ctx 依赖，客户端标注叠层与单元测试共用同一实现，
 * 避免两端口径漂移（对齐 prefs.ts 的分层风格）。
 */

/** 标注工具类型：矩形圈选、自由画笔、箭头。 */
export type AnnotationTool = 'rect' | 'brush' | 'arrow'

/** 矩形圈选标记：左上角 + 宽高，原图像素坐标。 */
export interface RectMark {
  readonly tool: 'rect'
  readonly x: number
  readonly y: number
  readonly w: number
  readonly h: number
}

/** 画笔笔迹标记：有序点列，原图像素坐标。 */
export interface BrushMark {
  readonly tool: 'brush'
  readonly points: ReadonlyArray<readonly [x: number, y: number]>
}

/** 箭头标记：起点指向终点，原图像素坐标。 */
export interface ArrowMark {
  readonly tool: 'arrow'
  readonly from: readonly [x: number, y: number]
  readonly to: readonly [x: number, y: number]
}

/** 一条标注（按创建顺序编号 ①②③）。 */
export type AnnotationMark = RectMark | BrushMark | ArrowMark

/** 归一化包围盒：各边 [0,1]，坐标原点在图像左上角。 */
export interface NormalizedBox {
  readonly x0: number
  readonly y0: number
  readonly x1: number
  readonly y1: number
}

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value))

/** 投影用两位小数：文本投影稳定可读，避免浮点尾数噪音。 */
const fmt = (value: number): string => clamp01(value).toFixed(2)

/**
 * 计算标记的归一化包围盒（保留全精度，供编号布局与投影共用）。
 * 退化标记（空笔迹）与非法图像尺寸返回 null。
 */
export function markBounds(
  mark: AnnotationMark,
  imageWidth: number,
  imageHeight: number,
): NormalizedBox | null {
  if (!Number.isFinite(imageWidth) || !Number.isFinite(imageHeight)) return null
  if (imageWidth <= 0 || imageHeight <= 0) return null

  let minX: number
  let minY: number
  let maxX: number
  let maxY: number
  if (mark.tool === 'rect') {
    minX = mark.x
    minY = mark.y
    maxX = mark.x + mark.w
    maxY = mark.y + mark.h
  } else if (mark.tool === 'arrow') {
    minX = Math.min(mark.from[0], mark.to[0])
    minY = Math.min(mark.from[1], mark.to[1])
    maxX = Math.max(mark.from[0], mark.to[0])
    maxY = Math.max(mark.from[1], mark.to[1])
  } else {
    if (mark.points.length === 0) return null
    minX = Infinity
    minY = Infinity
    maxX = -Infinity
    maxY = -Infinity
    for (const [x, y] of mark.points) {
      if (x < minX) minX = x
      if (y < minY) minY = y
      if (x > maxX) maxX = x
      if (y > maxY) maxY = y
    }
  }
  // 越界坐标（异常输入或渲染误差）钳进图像区域后再归一化
  return {
    x0: clamp01(Math.min(minX, maxX) / imageWidth),
    y0: clamp01(Math.min(minY, maxY) / imageHeight),
    x1: clamp01(Math.max(minX, maxX) / imageWidth),
    y1: clamp01(Math.max(minY, maxY) / imageHeight),
  }
}

const CIRCLED_NUMBERS = [
  '①',
  '②',
  '③',
  '④',
  '⑤',
  '⑥',
  '⑦',
  '⑧',
  '⑨',
  '⑩',
  '⑪',
  '⑫',
  '⑬',
  '⑭',
  '⑮',
  '⑯',
  '⑰',
  '⑱',
  '⑲',
  '⑳',
] as const

/** 序号 → 编号字符：1~20 用带圈数字，超出退回 `(n)`（字体不再保证有带圈字形）。 */
export function numberLabel(n: number): string {
  if (Number.isInteger(n) && n >= 1 && n <= CIRCLED_NUMBERS.length) {
    return CIRCLED_NUMBERS[n - 1]!
  }
  return `(${n})`
}

/**
 * 单条标记的文本投影（纯文本反馈通道的语义载体，按工具类型区分）。
 * 编号 1 基；退化标记返回 null（编号位次不受影响）。
 */
export function projectMark(
  index: number,
  mark: AnnotationMark,
  imageWidth: number,
  imageHeight: number,
): string | null {
  const label = numberLabel(index)
  if (mark.tool === 'arrow') {
    const [fx, fy] = mark.from
    const [tx, ty] = mark.to
    return `${label}箭头 从(${fmt(fx / imageWidth)},${fmt(fy / imageHeight)}) 指向(${fmt(
      tx / imageWidth,
    )},${fmt(ty / imageHeight)})`
  }
  const box = markBounds(mark, imageWidth, imageHeight)
  if (box === null) return null
  const region = `x:[${fmt(box.x0)},${fmt(box.x1)}] y:[${fmt(box.y0)},${fmt(box.y1)}]`
  return mark.tool === 'rect' ? `${label}区域 ${region}` : `${label}笔迹 外接框 ${region}`
}

/** 按创建顺序投影全部标记；退化标记跳过但编号位次保持。 */
export function projectMarks(
  marks: readonly AnnotationMark[],
  imageWidth: number,
  imageHeight: number,
): string[] {
  const projections: string[] = []
  marks.forEach((mark, index) => {
    const projection = projectMark(index + 1, mark, imageWidth, imageHeight)
    if (projection !== null) projections.push(projection)
  })
  return projections
}

/** 弹窗缩放档位：两档切换（2x 以点击位置为中心），不做自由缩放。 */
export type ZoomLevel = 1 | 2

/** 给定缩放档下的显示尺寸（CSS 像素）。 */
export function displaySize(
  imageWidth: number,
  imageHeight: number,
  zoom: ZoomLevel,
): { width: number; height: number } {
  return { width: imageWidth * zoom, height: imageHeight * zoom }
}

/**
 * canvas 后备存储尺寸：CSS 尺寸 × devicePixelRatio，向上取整，
 * 避免高 DPI 下绘制边缘发虚。
 */
export function backingSize(
  cssWidth: number,
  cssHeight: number,
  devicePixelRatio: number,
): { width: number; height: number } {
  const ratio = Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? devicePixelRatio : 1
  return { width: Math.ceil(cssWidth * ratio), height: Math.ceil(cssHeight * ratio) }
}

/**
 * 指针位置（相对显示区域左上角，CSS 像素）→ 原图像素坐标，钳在图像边界内。
 * 1x/2x 共用同一映射：显示尺寸是原图的 zoom 倍，故除以 zoom。
 */
export function pointerToImage(
  pointerX: number,
  pointerY: number,
  zoom: ZoomLevel,
  imageWidth: number,
  imageHeight: number,
): { x: number; y: number } {
  return {
    x: Math.min(imageWidth, Math.max(0, pointerX / zoom)),
    y: Math.min(imageHeight, Math.max(0, pointerY / zoom)),
  }
}

/**
 * 编号徽标绘制锚点（原图像素坐标）：默认落在包围盒左上角；
 * 靠近图像边缘时钳回图内，避免徽标溢出不可见。
 * @returns 锚点中心与建议绘制半径（随短边自适应）。
 */
export function badgeAnchor(
  box: NormalizedBox,
  imageWidth: number,
  imageHeight: number,
): { x: number; y: number; radius: number } {
  const radius = Math.max(10, Math.round(Math.min(imageWidth, imageHeight) * 0.025))
  const rawX = box.x0 * imageWidth
  const rawY = box.y0 * imageHeight
  return {
    x: Math.min(Math.max(rawX, radius), imageWidth - radius),
    y: Math.min(Math.max(rawY, radius), imageHeight - radius),
    radius,
  }
}

/**
 * 模型可见反馈消息模板（固定中文，不随 UI 语言切换）。
 * 参数用函数式替换插入：用户意见里的 $& / $` / $' 等组合在字符串
 * 替换串中会被当作模式解释，函数返回值则原样插入（延续 0.1.3 修复约定）。
 */
const ANNOTATION_FEEDBACK_TEMPLATE =
  '对 design/images/{name} 的标注反馈（{time}）：编号区域（归一化坐标）：{regions}。意见：{opinion}'

/**
 * 标注反馈时间戳格式：固定 ISO 8601 UTC（与 history.jsonl 的 toISOString 口径一致）。
 * 模型可见文本禁止 toLocaleString 等随环境漂移的格式；会话消息本身时序有序，
 * 时间戳的真实价值是上下文压缩后仍可消歧多轮标注，不承担排序主键职责。
 */
export function formatAnnotationTimestamp(time: Date): string {
  return time.toISOString()
}

/** 组装标注反馈消息：文件名 + 时间戳 + 编号投影 + 用户意见。 */
export function buildAnnotationFeedbackMessage(params: {
  readonly name: string
  readonly time: Date
  readonly projections: readonly string[]
  readonly opinion: string
}): string {
  const values: Record<string, string> = {
    name: params.name,
    time: formatAnnotationTimestamp(params.time),
    regions: params.projections.join('；'),
    opinion: params.opinion.trim(),
  }
  let text = ANNOTATION_FEEDBACK_TEMPLATE
  for (const [key, value] of Object.entries(values)) {
    text = text.replaceAll(`{${key}}`, () => value)
  }
  return text
}
