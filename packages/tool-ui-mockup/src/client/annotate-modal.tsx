/**
 * 标注弹窗：点击卡片图片进入，在生成图上圈选修改区域（矩形/画笔/箭头，
 * 自动编号 ①②③），与文字意见一并提交。
 *
 * 叠层架构（提案 §4.3）：底图用 <img> 渲染（显示不需要像素），标注画在
 * 同尺寸透明 canvas 叠层上（纯几何）。提交时只发编号坐标文本 + 意见，
 * 不导出合成图（附件链路是 0.2.1 的叠加项）。
 * 组件保持纯展示：几何计算全部委托 ../annotation.js 纯函数，发送消息由
 * 父组件回调完成（slots 范式：组件不接触服务）。
 */
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
} from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import {
  badgeAnchor,
  backingSize,
  centeredScrollOffset,
  displaySize,
  findTopmostMark,
  fitZoom,
  markBounds,
  numberLabel,
  pointerToImage,
  type AnnotationMark,
  type AnnotationTool,
  type ZoomMode,
} from '../annotation.js'
import { imageUrl } from './shared.js'

/** 标注颜色：固定三色（默认红），不跟主题——标注需要在任何配色界面上醒目。 */
export type AnnotationColor = 'red' | 'yellow' | 'blue'

const COLOR_VALUES: Record<AnnotationColor, string> = {
  red: '#e53935',
  yellow: '#f9a825',
  blue: '#1e88e5',
}

/** 一条带颜色的标注（颜色只影响绘制，不进入消息投影）。 */
interface ColoredMark {
  readonly mark: AnnotationMark
  readonly color: AnnotationColor
}

/** 弹窗用到的文案键并集：宿主注入的 t 按 ui-mockup 命名空间收窄类型。 */
export type AnnotateModalTextKey =
  | 'annotate.title'
  | 'annotate.hint'
  | 'annotate.toolPan'
  | 'annotate.toolRect'
  | 'annotate.toolBrush'
  | 'annotate.toolArrow'
  | 'annotate.color'
  | 'annotate.undo'
  | 'annotate.clear'
  | 'annotate.zoomLabel'
  | 'annotate.zoomFit'
  | 'annotate.canvasLabel'
  | 'annotate.selectedMark'
  | 'annotate.cancel'
  | 'annotate.imageLoadFailed'
  | 'card.feedbackPlaceholder'
  | 'card.feedbackSubmit'
  | 'card.openOriginal'

export interface AnnotateModalProps {
  /** 被标注图的文件名（资产库语义）。 */
  readonly name: string
  /** 会话工作区（图片路由查询参数）。 */
  readonly cwd?: string
  readonly t: (key: AnnotateModalTextKey, params?: Record<string, string | number>) => string
  readonly onClose: () => void
  /** 提交：意见 + 标注（原图像素坐标）+ 图像固有尺寸。空标注允许提交（退化为纯文字意见）。 */
  readonly onSubmit: (
    opinion: string,
    marks: readonly AnnotationMark[],
    imageWidth: number,
    imageHeight: number,
  ) => void
}

/** 箭头头部两条短线的长度（CSS 像素）。 */
const ARROW_HEAD = 12

const FIXED_ZOOM_LEVELS = [0.5, 1, 1.5, 2] as const
const IMAGE_VIEWPORT_HORIZONTAL_PADDING = 32
const IMAGE_FIT_HEIGHT_VH = 0.52
const HIT_TOLERANCE_CSS_PX = 8
const PAN_CLICK_THRESHOLD_CSS_PX = 4
/** 标记快照栈上限：连续画笔每笔一份全量快照，不设上限会在长会话里只增不减。 */
const UNDO_STACK_LIMIT = 50

interface PanGesture {
  pointerId: number
  startX: number
  startY: number
  startScrollLeft: number
  startScrollTop: number
  moved: boolean
}

function drawArrowHead(
  ctx: CanvasRenderingContext2D,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
): void {
  const angle = Math.atan2(toY - fromY, toX - fromX)
  for (const offset of [Math.PI / 6, -Math.PI / 6]) {
    ctx.moveTo(toX, toY)
    ctx.lineTo(
      toX - ARROW_HEAD * Math.cos(angle - offset),
      toY - ARROW_HEAD * Math.sin(angle - offset),
    )
  }
}

/** 在叠层画一条标注 + 编号徽标（坐标由原图像素 × zoom 映射到 CSS 像素）。 */
function drawMark(
  ctx: CanvasRenderingContext2D,
  entry: ColoredMark,
  index: number,
  zoom: number,
  imageWidth: number,
  imageHeight: number,
): void {
  const { mark, color } = entry
  ctx.strokeStyle = COLOR_VALUES[color]
  ctx.lineWidth = 3
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.beginPath()
  if (mark.tool === 'rect') {
    ctx.rect(mark.x * zoom, mark.y * zoom, mark.w * zoom, mark.h * zoom)
  } else if (mark.tool === 'arrow') {
    const [fx, fy] = mark.from
    const [tx, ty] = mark.to
    ctx.moveTo(fx * zoom, fy * zoom)
    ctx.lineTo(tx * zoom, ty * zoom)
    drawArrowHead(ctx, fx * zoom, fy * zoom, tx * zoom, ty * zoom)
  } else {
    mark.points.forEach(([x, y], i) => {
      if (i === 0) ctx.moveTo(x * zoom, y * zoom)
      else ctx.lineTo(x * zoom, y * zoom)
    })
  }
  ctx.stroke()

  // 编号徽标：色底白字圆点，位置由纯函数给出（左上角，靠边自动收回图内）
  const box = markBounds(mark, imageWidth, imageHeight)
  if (box === null) return
  const anchor = badgeAnchor(box, imageWidth, imageHeight)
  const cx = anchor.x * zoom
  const cy = anchor.y * zoom
  const radius = Math.max(9, anchor.radius * zoom * 0.6)
  ctx.beginPath()
  ctx.arc(cx, cy, radius, 0, Math.PI * 2)
  ctx.fillStyle = COLOR_VALUES[color]
  ctx.fill()
  ctx.strokeStyle = '#ffffff'
  ctx.lineWidth = 2
  ctx.stroke()
  ctx.fillStyle = '#ffffff'
  ctx.font = `bold ${Math.max(10, Math.round(radius))}px system-ui, sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(String(index), cx, cy)
}

/** 选中态只增加虚线包围框，不覆盖标记自身颜色和编号。 */
function drawSelection(
  ctx: CanvasRenderingContext2D,
  mark: AnnotationMark,
  zoom: number,
  imageWidth: number,
  imageHeight: number,
): void {
  const box = markBounds(mark, imageWidth, imageHeight)
  if (box === null) return
  const padding = 6
  const x = box.x0 * imageWidth * zoom
  const y = box.y0 * imageHeight * zoom
  const width = (box.x1 - box.x0) * imageWidth * zoom
  const height = (box.y1 - box.y0) * imageHeight * zoom
  ctx.save()
  ctx.setLineDash([6, 4])
  ctx.lineWidth = 2
  ctx.strokeStyle = '#1677ff'
  ctx.strokeRect(x - padding, y - padding, width + padding * 2, height + padding * 2)
  ctx.restore()
}

/** 提交有效性门槛与退化：矩形宽高、箭头长度至少 4 原图像素，笔迹至少 2 点。 */
function isCommitable(mark: AnnotationMark): boolean {
  if (mark.tool === 'rect') return mark.w >= 4 && mark.h >= 4
  if (mark.tool === 'arrow') {
    const dx = mark.to[0] - mark.from[0]
    const dy = mark.to[1] - mark.from[1]
    return Math.hypot(dx, dy) >= 4
  }
  return mark.points.length >= 2
}

export function AnnotateModal({ name, cwd, t, onClose, onSubmit }: AnnotateModalProps) {
  const dialogRef = useRef<HTMLDivElement | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const panRef = useRef<PanGesture | null>(null)

  const [imageSize, setImageSize] = useState<{ w: number; h: number } | null>(null)
  const [imageFailed, setImageFailed] = useState(false)
  const [zoomMode, setZoomMode] = useState<ZoomMode>('fit')
  const [fitViewport, setFitViewport] = useState<{ width: number; height: number } | null>(null)
  const [tool, setTool] = useState<AnnotationTool>('pan')
  const [color, setColor] = useState<AnnotationColor>('red')
  const [marks, setMarks] = useState<readonly ColoredMark[]>([])
  const [undoStack, setUndoStack] = useState<ReadonlyArray<readonly ColoredMark[]>>([])
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null)
  const [panning, setPanning] = useState(false)
  const [draftMark, setDraftMark] = useState<AnnotationMark | null>(null)
  const [opinion, setOpinion] = useState('')

  // 弹窗打开即聚焦容器，Esc 关闭；Tab 在弹窗内循环（焦点陷阱）
  useEffect(() => {
    dialogRef.current?.focus()
  }, [])

  // 适合窗口只依赖稳定的内容宽度与视口高度上限，避免图片缩放后容器高度反向影响比例。
  useEffect(() => {
    if (imageSize === null) return undefined
    const container = containerRef.current
    if (container === null) return undefined
    const update = () => {
      const width = container.clientWidth - IMAGE_VIEWPORT_HORIZONTAL_PADDING
      const height = window.innerHeight * IMAGE_FIT_HEIGHT_VH
      setFitViewport(width > 0 && height > 0 ? { width, height } : null)
    }
    update()
    window.addEventListener('resize', update)
    const observer =
      typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(() => update())
    observer?.observe(container)
    return () => {
      window.removeEventListener('resize', update)
      observer?.disconnect()
    }
  }, [imageSize])

  const zoom =
    zoomMode === 'fit' && imageSize !== null && fitViewport !== null
      ? fitZoom(imageSize.w, imageSize.h, fitViewport.width, fitViewport.height)
      : zoomMode === 'fit'
        ? 1
        : zoomMode

  const applyMarks = (next: readonly ColoredMark[]) => {
    setUndoStack((previous) => [...previous, marks].slice(-UNDO_STACK_LIMIT))
    setMarks(next)
    setSelectedIndex(null)
  }

  const undoMarks = () => {
    const previous = undoStack[undoStack.length - 1]
    if (previous === undefined) return
    setMarks(previous)
    setUndoStack((history) => history.slice(0, -1))
    setSelectedIndex(null)
  }

  const deleteSelected = () => {
    if (selectedIndex === null || marks[selectedIndex] === undefined) return
    applyMarks(marks.filter((_, index) => index !== selectedIndex))
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    // 删除键只在画布自身聚焦时拦截：输入控件保留原生删除行为，
    // 工具条按钮等其它焦点也不该隐式删标记（与文档「聚焦画布时」一致）。
    if (event.key === 'Delete' || event.key === 'Backspace') {
      if (event.target === canvasRef.current && selectedIndex !== null) {
        event.preventDefault()
        deleteSelected()
      }
      return
    }
    if (event.key === 'Escape') {
      event.stopPropagation()
      onClose()
      return
    }
    if (event.key !== 'Tab') return
    const root = dialogRef.current
    if (root === null) return
    const focusables = Array.from(
      root.querySelectorAll<HTMLElement>(
        'button, [href], textarea, select, input, [tabindex]:not([tabindex="-1"])',
      ),
    ).filter((el) => !el.hasAttribute('disabled'))
    if (focusables.length === 0) return
    const first = focusables[0]!
    const last = focusables[focusables.length - 1]!
    const active = document.activeElement
    if (event.shiftKey && active === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && (active === last || active === root)) {
      event.preventDefault()
      first.focus()
    }
  }

  // 标注叠层全量重绘：几何在纯函数里算好，这里只做 canvas 指令
  useEffect(() => {
    const canvas = canvasRef.current
    if (canvas === null || imageSize === null) return
    const dpr = window.devicePixelRatio || 1
    const disp = displaySize(imageSize.w, imageSize.h, zoom)
    const back = backingSize(disp.width, disp.height, dpr)
    if (canvas.width !== back.width) canvas.width = back.width
    if (canvas.height !== back.height) canvas.height = back.height
    const ctx = canvas.getContext('2d')
    if (ctx === null) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, disp.width, disp.height)
    const all = draftMark === null ? marks : [...marks, { mark: draftMark, color }]
    all.forEach((entry, index) => {
      drawMark(ctx, entry, index + 1, zoom, imageSize.w, imageSize.h)
    })
    if (selectedIndex !== null && marks[selectedIndex] !== undefined) {
      drawSelection(ctx, marks[selectedIndex].mark, zoom, imageSize.w, imageSize.h)
    }
  }, [marks, draftMark, zoom, imageSize, color, selectedIndex])

  if (imageFailed) {
    return (
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('annotate.title')}
        ref={dialogRef}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        style={overlayStyle}
      >
        <div style={panelStyle}>
          <div style={{ padding: 16, fontSize: 13, color: 'var(--dsw-alias-label-primary)' }}>
            {t('annotate.imageLoadFailed')}
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '0 16px 16px' }}>
            <Button variant="ghost" size="sm" onClick={onClose}>
              {t('annotate.cancel')}
            </Button>
          </div>
        </div>
      </div>
    )
  }

  const pointOf = (event: PointerEvent<HTMLCanvasElement>): { x: number; y: number } => {
    if (imageSize === null) return { x: 0, y: 0 }
    const rect = event.currentTarget.getBoundingClientRect()
    return pointerToImage(
      event.clientX - rect.left,
      event.clientY - rect.top,
      zoom,
      imageSize.w,
      imageSize.h,
    )
  }

  const onPointerDown = (event: PointerEvent<HTMLCanvasElement>) => {
    if (imageSize === null) return
    event.currentTarget.focus()
    event.currentTarget.setPointerCapture(event.pointerId)
    if (tool === 'pan') {
      const container = containerRef.current
      if (container === null) return
      panRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        startScrollLeft: container.scrollLeft,
        startScrollTop: container.scrollTop,
        moved: false,
      }
      setPanning(true)
      return
    }
    setSelectedIndex(null)
    const p = pointOf(event)
    if (tool === 'rect') setDraftMark({ tool: 'rect', x: p.x, y: p.y, w: 0, h: 0 })
    else if (tool === 'arrow') setDraftMark({ tool: 'arrow', from: [p.x, p.y], to: [p.x, p.y] })
    else setDraftMark({ tool: 'brush', points: [[p.x, p.y]] })
  }

  const onPointerMove = (event: PointerEvent<HTMLCanvasElement>) => {
    if (tool === 'pan' && panRef.current !== null) {
      const container = containerRef.current
      if (container === null) return
      const dx = event.clientX - panRef.current.startX
      const dy = event.clientY - panRef.current.startY
      if (Math.hypot(dx, dy) >= PAN_CLICK_THRESHOLD_CSS_PX) panRef.current.moved = true
      container.scrollLeft = panRef.current.startScrollLeft - dx
      container.scrollTop = panRef.current.startScrollTop - dy
      return
    }
    if (draftMark === null || imageSize === null) return
    const p = pointOf(event)
    if (draftMark.tool === 'rect') {
      // 拖动方向任意：规范化为左上角 + 宽高
      const x0 = Math.min(draftMark.x, p.x)
      const y0 = Math.min(draftMark.y, p.y)
      setDraftMark({
        tool: 'rect',
        x: x0,
        y: y0,
        w: Math.abs(p.x - draftMark.x),
        h: Math.abs(p.y - draftMark.y),
      })
    } else if (draftMark.tool === 'arrow') {
      setDraftMark({ ...draftMark, to: [p.x, p.y] })
    } else {
      const last = draftMark.points[draftMark.points.length - 1]
      // 小于 2 原图像素的抖动不追加点列，控制密度
      if (last !== undefined && Math.hypot(p.x - last[0], p.y - last[1]) < 2) return
      setDraftMark({ ...draftMark, points: [...draftMark.points, [p.x, p.y]] })
    }
  }

  const onPointerUp = (event: PointerEvent<HTMLCanvasElement>) => {
    if (tool === 'pan') {
      const gesture = panRef.current
      panRef.current = null
      setPanning(false)
      if (gesture !== null && !gesture.moved && imageSize !== null) {
        const point = pointOf(event)
        setSelectedIndex(
          findTopmostMark(
            marks.map((entry) => entry.mark),
            point,
            HIT_TOLERANCE_CSS_PX / zoom,
          ),
        )
      }
      return
    }
    if (draftMark === null) return
    if (isCommitable(draftMark)) {
      applyMarks([...marks, { mark: draftMark, color }])
    }
    setDraftMark(null)
  }

  const onPointerCancel = () => {
    panRef.current = null
    setPanning(false)
    setDraftMark(null)
  }

  // 固定比例切换保持当前图像位置位于视口中心；适合窗口完整显示整图并归零滚动。
  const changeZoom = (next: ZoomMode) => {
    const container = containerRef.current
    const nextZoom =
      next === 'fit' && imageSize !== null && fitViewport !== null
        ? fitZoom(imageSize.w, imageSize.h, fitViewport.width, fitViewport.height)
        : next === 'fit'
          ? 1
          : next
    if (container !== null && container.clientWidth > 0 && container.clientHeight > 0) {
      requestAnimationFrame(() => {
        if (next === 'fit') {
          container.scrollLeft = 0
          container.scrollTop = 0
          return
        }
        if (zoomMode === 'fit' && imageSize !== null) {
          container.scrollLeft = Math.max(0, (imageSize.w * nextZoom - container.clientWidth) / 2)
          container.scrollTop = Math.max(0, (imageSize.h * nextZoom - container.clientHeight) / 2)
          return
        }
        container.scrollLeft = centeredScrollOffset(
          container.scrollLeft,
          container.clientWidth,
          zoom,
          nextZoom,
        )
        container.scrollTop = centeredScrollOffset(
          container.scrollTop,
          container.clientHeight,
          zoom,
          nextZoom,
        )
      })
    }
    setZoomMode(next)
  }

  const submit = () => {
    if (opinion.trim() === '' || imageSize === null) return
    onSubmit(
      opinion,
      marks.map((entry) => entry.mark),
      imageSize.w,
      imageSize.h,
    )
  }

  const disp = imageSize === null ? null : displaySize(imageSize.w, imageSize.h, zoom)

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t('annotate.title')}
      ref={dialogRef}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      style={overlayStyle}
    >
      <div style={panelStyle}>
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            gap: 8,
            padding: '12px 16px',
            borderBottom: '1px solid var(--dsw-alias-border-l2)',
          }}
        >
          <strong style={{ fontSize: 13, color: 'var(--dsw-alias-label-primary)' }}>
            {t('annotate.title')}
          </strong>
          <span style={{ fontSize: 12, color: 'var(--dsw-alias-label-tertiary)' }}>{name}</span>
          <span style={{ flex: 1 }} />
          {(['pan', 'rect', 'brush', 'arrow'] as const).map((item) => (
            <Button
              key={item}
              variant={tool === item ? 'primary' : 'ghost'}
              size="sm"
              aria-pressed={tool === item}
              onClick={() => {
                setTool(item)
                if (item !== 'pan') setSelectedIndex(null)
              }}
            >
              {t(
                item === 'pan'
                  ? 'annotate.toolPan'
                  : item === 'rect'
                    ? 'annotate.toolRect'
                    : item === 'brush'
                      ? 'annotate.toolBrush'
                      : 'annotate.toolArrow',
              )}
            </Button>
          ))}
          {(Object.keys(COLOR_VALUES) as readonly AnnotationColor[]).map((item) => (
            <button
              key={item}
              type="button"
              aria-label={t('annotate.color')}
              aria-pressed={color === item}
              onClick={() => setColor(item)}
              style={{
                width: 20,
                height: 20,
                borderRadius: 999,
                background: COLOR_VALUES[item],
                border:
                  color === item
                    ? '2px solid var(--dsw-alias-brand-primary)'
                    : '2px solid transparent',
                cursor: 'pointer',
                padding: 0,
              }}
            />
          ))}
          <Button variant="ghost" size="sm" disabled={undoStack.length === 0} onClick={undoMarks}>
            {t('annotate.undo')}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={marks.length === 0}
            onClick={() => applyMarks([])}
          >
            {t('annotate.clear')}
          </Button>
          <select
            aria-label={t('annotate.zoomLabel')}
            title={t('annotate.zoomLabel')}
            value={String(zoomMode)}
            disabled={imageSize === null}
            onChange={(event) => {
              const value = event.target.value
              const next =
                value === 'fit' ? 'fit' : FIXED_ZOOM_LEVELS.find((level) => String(level) === value)
              if (next !== undefined) changeZoom(next)
            }}
            style={{
              height: 28,
              minWidth: 104,
              padding: '0 8px',
              borderRadius: 6,
              border: '1px solid var(--dsw-alias-border-l2)',
              background: 'var(--dsw-alias-bg-layer-2)',
              color: 'var(--dsw-alias-label-primary)',
              fontSize: 12,
            }}
          >
            <option value="fit">{t('annotate.zoomFit')}</option>
            {FIXED_ZOOM_LEVELS.map((level) => (
              <option key={level} value={String(level)}>
                {Math.round(level * 100)}%
              </option>
            ))}
          </select>
        </div>

        <div
          style={{ padding: '8px 16px', fontSize: 12, color: 'var(--dsw-alias-label-tertiary)' }}
        >
          {t('annotate.hint')}
          {selectedIndex !== null && (
            <span role="status" style={{ marginLeft: 8 }}>
              {t('annotate.selectedMark', { n: numberLabel(selectedIndex + 1) })}
            </span>
          )}
        </div>

        <div
          ref={containerRef}
          style={{
            overflow: 'auto',
            padding: 16,
            background: 'var(--dsw-alias-bg-layer-3)',
            minHeight: 200,
            maxHeight: '60vh',
          }}
        >
          {/* img 必须先渲染才能触发 onLoad 拿到固有尺寸；尺寸已知后切换为
              zoom 控制的显示尺寸，并叠上透明标注画布 */}
          <div
            style={{
              position: 'relative',
              display: 'block',
              width: disp?.width,
              height: disp?.height,
              marginInline:
                disp !== null && fitViewport !== null && disp.width <= fitViewport.width
                  ? 'auto'
                  : 0,
            }}
          >
            <img
              src={imageUrl(name, cwd)}
              alt={name}
              onLoad={(event) =>
                setImageSize({
                  w: event.currentTarget.naturalWidth,
                  h: event.currentTarget.naturalHeight,
                })
              }
              onError={() => setImageFailed(true)}
              style={
                imageSize === null || disp === null
                  ? { display: 'block', maxWidth: '78vw', maxHeight: '52vh' }
                  : { display: 'block', width: disp.width, height: disp.height }
              }
            />
            {imageSize !== null && disp !== null && (
              <canvas
                ref={canvasRef}
                tabIndex={0}
                aria-label={t('annotate.canvasLabel')}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={onPointerCancel}
                style={{
                  position: 'absolute',
                  inset: 0,
                  width: disp.width,
                  height: disp.height,
                  touchAction: 'none',
                  cursor: tool === 'pan' ? (panning ? 'grabbing' : 'grab') : 'crosshair',
                }}
              />
            )}
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 16 }}>
          <textarea
            value={opinion}
            onChange={(event) => setOpinion(event.target.value)}
            placeholder={t('card.feedbackPlaceholder')}
            rows={2}
            aria-label={t('card.feedbackPlaceholder')}
            style={{
              resize: 'vertical',
              padding: '6px 12px',
              border: '1px solid var(--dsw-alias-border-l2)',
              borderRadius: 8,
              background: 'var(--dsw-alias-bg-layer-3)',
              font: 'inherit',
              fontSize: 13,
              lineHeight: '20px',
              color: 'var(--dsw-alias-label-primary)',
            }}
          />
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Button
              variant="primary"
              size="sm"
              disabled={opinion.trim() === '' || imageSize === null}
              onClick={submit}
            >
              {t('card.feedbackSubmit')}
            </Button>
            <Button variant="ghost" size="sm" onClick={onClose}>
              {t('annotate.cancel')}
            </Button>
            <span style={{ flex: 1 }} />
            <a href={imageUrl(name, cwd)} target="_blank" rel="noreferrer">
              <Button variant="ghost" size="sm">
                {t('card.openOriginal')}
              </Button>
            </a>
          </div>
        </div>
      </div>
    </div>
  )
}

const overlayStyle: CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 1000,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'rgba(0, 0, 0, 0.45)',
}

const panelStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  width: 'min(960px, 92vw)',
  maxHeight: '92vh',
  borderRadius: 12,
  background: 'var(--dsw-alias-bg-layer-1)',
  border: '1px solid var(--dsw-alias-border-l2)',
  boxShadow: '0 12px 40px rgba(0, 0, 0, 0.25)',
  outline: 'none',
  overflow: 'hidden',
}
