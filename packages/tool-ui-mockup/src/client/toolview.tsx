/**
 * ui_mockup 工具卡片：生成图内嵌展示 + 确认/选用/修改意见反馈按钮。
 * 纯展示组件，接收 tool.call.toolview 的 owner payload 与框架注入的
 * `t`（i18n）和 `inputActions`（反馈按钮通过 setDraft + submit 发送消息）。
 * 视觉与 DSH 原生一致：Button 原语 + --dsw-alias-* 主题令牌。
 */
import { useEffect, useState } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ToolCallViewProps } from '@deepseek-ai/dsh-client-ui-tool/client'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { buildAnnotationFeedbackMessage, projectMarks } from '../annotation.js'
import { imageUrl, RESULT_NOTICE_MARKERS } from './shared.js'
import { AnnotateModal } from './annotate-modal.js'
import { zh, type NS } from './locales.js'

type Props = ToolCallViewProps & PropsLocale<typeof NS> & { anchor?: ToolviewAnchorFace }

/** 卡片锚点注入面：由注册方闭包捕获 connection 提供，直连 RPC 不经 agent。 */
export interface ToolviewAnchorFace {
  set(file: string, cwd?: string): Promise<{ anchorFile: string; hint?: string }>
}

/** 图片附件引用（会话附件块里的 image 块所携带的最小结构）。 */
interface ImageRef {
  readonly name?: string
  readonly mediaType?: string
  readonly width?: number
  readonly height?: number
}

/** 反馈按钮发送给 agent 的消息正文（中文固定，模型可见文本不随 UI 语言切换）。 */
function buildFeedbackMessage(name: string, index: number, opinion?: string): string {
  if (opinion !== undefined && opinion.trim() !== '') {
    return formatModelMessage('card.feedbackMessage', { opinion: opinion.trim(), name })
  }
  return formatModelMessage('card.selectMessage', { n: index + 1, name })
}

/** 模型可见反馈固定中文；UI 控件文案仍由传入的 t 跟随当前界面语言。 */
function formatModelMessage(
  key: 'card.confirmMessage' | 'card.selectMessage' | 'card.feedbackMessage' | 'card.refineMessage',
  params: Record<string, string | number>,
): string {
  let text: string = zh[key]
  for (const [name, value] of Object.entries(params)) {
    // 函数式替换：用户意见里的 $& / $` / $' 等组合在字符串替换串中会被当作
    // 模式解释（占位符漏进消息或内容被吞），函数返回值则原样插入
    text = text.replaceAll(`{${name}}`, () => String(value))
  }
  return text
}

/** 成功路径只显示需要用户处理的告警，不重复内部存储路径等完整工具文本。 */
function resultNotice(message: string): string {
  const starts = RESULT_NOTICE_MARKERS.map((marker) => message.indexOf(marker)).filter(
    (index) => index >= 0,
  )
  return starts.length === 0 ? '' : message.slice(Math.min(...starts)).trim()
}

export function UiMockupToolview({ block, inputActions, cwd, t, anchor }: Props) {
  const [showFeedback, setShowFeedback] = useState(false)
  const [opinion, setOpinion] = useState('')
  const [selected, setSelected] = useState('')
  // 多图设锚下拉的受控值（选完即复位，与「选用某一版」同款交互）
  const [anchorPicked, setAnchorPicked] = useState('')
  // 本卡已设为锚点的图名集合（点击即时反馈；权威状态在历史页/概览页）
  const [anchoredNames, setAnchoredNames] = useState<ReadonlySet<string>>(new Set())
  const [anchorError, setAnchorError] = useState('')
  // 设锚提示（如「这张是方向稿」）：宿主端点按历史标记返回，展示即完成提醒义务
  const [anchorHint, setAnchorHint] = useState('')
  // 标注弹窗目标图名（资产库语义文件名）；null 表示弹窗关闭
  const [annotating, setAnnotating] = useState<string | null>(null)

  // 生成耗时反馈：运行中工具块的事件时间会随会话持久化，刷新后仍能延续计时；
  // 旧数据缺少时间（或时间为 0 等损坏值）时才回退到卡片挂载时间。出图后块带 kind 即停表。
  // 这里只说明本地已等待时长，不能据此判断远端任务进度或存活状态。
  const pending = !('kind' in block)
  const [mountedAt] = useState(() => Date.now())
  const startedAt =
    pending && Number.isFinite(block.time) && block.time > 0 ? block.time : mountedAt
  const elapsedSinceStart = () => Math.max(0, Math.round((Date.now() - startedAt) / 1000))
  const [elapsedSeconds, setElapsedSeconds] = useState(elapsedSinceStart)
  useEffect(() => {
    if (!pending) return undefined
    setElapsedSeconds(elapsedSinceStart())
    const timer = setInterval(() => {
      setElapsedSeconds(elapsedSinceStart())
    }, 1000)
    return () => clearInterval(timer)
  }, [pending, startedAt])

  const setAnchor = async (name: string) => {
    if (anchor === undefined) return
    setAnchorError('')
    setAnchorHint('')
    try {
      const result = await anchor.set(name, cwd)
      setAnchoredNames((prev) => new Set(prev).add(name))
      if (typeof result?.hint === 'string' && result.hint !== '') setAnchorHint(result.hint)
    } catch (err) {
      setAnchorError(err instanceof Error ? err.message : String(err))
    }
  }

  if (pending) {
    // 首秒仍显示纯「生成中…」，避免一闪而过的「0 秒」噪音；
    // 之后按秒/分秒两档展示已耗时
    const minutes = Math.floor(elapsedSeconds / 60)
    const seconds = elapsedSeconds % 60
    const label =
      elapsedSeconds < 1
        ? t('card.generating')
        : minutes < 1
          ? t('card.generatingSeconds', { n: seconds })
          : t('card.generatingMinutes', { m: minutes, s: seconds })
    return (
      <div style={{ padding: '8px 0', fontSize: 13, color: 'var(--dsw-alias-label-tertiary)' }}>
        {label}
      </div>
    )
  }

  const images = block.content.filter((item) => item.type === 'image')
  // 方向稿卡片入口：解析原始入参判定可见性。窗口截断时 call 为 null；
  // argsRaw 解析失败静默不显示，不影响其它按钮。
  const showRefine = (() => {
    const call = (block as { call?: { argsRaw?: string } | null }).call
    const argsRaw = call === null || call === undefined ? undefined : call.argsRaw
    if (typeof argsRaw !== 'string' || argsRaw === '') return false
    try {
      const args = JSON.parse(argsRaw) as Record<string, unknown>
      return args.fidelity === 'high-fidelity' && args.fastPreview === true
    } catch {
      return false
    }
  })()
  const message = block.content
    .filter((item) => item.type === 'text')
    .map((item) => item.text)
    .join('')
  const notice = resultNotice(message)

  if (images.length === 0) {
    return (
      <div
        style={{
          padding: '8px 0',
          whiteSpace: 'pre-wrap',
          fontSize: 13,
          lineHeight: '20px',
          color: 'var(--dsw-alias-label-primary)',
        }}
      >
        {message}
      </div>
    )
  }

  const send = (text: string) => {
    inputActions.setDraft(text)
    inputActions.submit()
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '8px 0' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {images.map((image, index) => {
          const ref = image.attachment as ImageRef
          const name = ref.name ?? `mockup-${index + 1}.png`
          const anchored = anchoredNames.has(name)
          return (
            <figure key={`${name}:${index}`} style={{ margin: 0 }}>
              {/* 点击图片进入标注弹窗（放大 + 圈选）；键盘可达，标题提示用途 */}
              <button
                type="button"
                onClick={() => setAnnotating(name)}
                title={t('card.annotateHint')}
                aria-label={`${name}: ${t('card.annotateHint')}`}
                style={{
                  background: 'none',
                  border: 'none',
                  padding: 0,
                  cursor: 'pointer',
                  display: 'block',
                }}
              >
                <img
                  src={imageUrl(name, cwd)}
                  alt={name}
                  loading="lazy"
                  style={{
                    maxWidth: 240,
                    maxHeight: 240,
                    borderRadius: 8,
                    border: `1px solid ${anchored ? 'var(--dsw-alias-brand-primary)' : 'var(--dsw-alias-border-l2)'}`,
                    objectFit: 'contain',
                    background: 'var(--dsw-alias-bg-layer-3)',
                  }}
                />
              </button>
              <figcaption
                style={{
                  fontSize: 12,
                  lineHeight: '17px',
                  color: 'var(--dsw-alias-label-tertiary)',
                  marginTop: 2,
                }}
              >
                {name}
                {anchored ? ` · ${t('card.anchored')}` : ''}
              </figcaption>
            </figure>
          )
        })}
      </div>
      {notice !== '' && (
        <div
          role="status"
          // 主题无 label 级 warning 令牌；警示文字统一用 state 系琥珀令牌（与原生 chat/plan 一致）
          style={{
            fontSize: 12,
            lineHeight: '18px',
            color: 'var(--dsw-alias-state-warn-primary)',
          }}
        >
          {notice}
        </div>
      )}
      {anchorError !== '' && (
        <div style={{ fontSize: 12, color: 'var(--dsw-alias-label-error)' }}>{anchorError}</div>
      )}
      {anchorHint !== '' && (
        <div style={{ fontSize: 12, color: 'var(--dsw-alias-state-warn-primary)' }}>
          {anchorHint}
        </div>
      )}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
        <Button
          variant="primary"
          size="sm"
          onClick={() =>
            send(
              formatModelMessage('card.confirmMessage', {
                name: images[0]!.attachment.name ?? 'mockup-1.png',
              }),
            )
          }
        >
          {t('card.confirm')}
        </Button>
        {showRefine && (
          <Button
            variant="primary"
            size="sm"
            onClick={() =>
              send(
                formatModelMessage('card.refineMessage', {
                  name: images[0]!.attachment.name ?? 'mockup-1.png',
                }),
              )
            }
          >
            {t('card.refine')}
          </Button>
        )}
        {images.length > 1 && (
          <select
            value={selected}
            onChange={(event) => {
              const raw = event.target.value
              // placeholder（空值）不可触发；Number('') === 0 会误发"选用第 1 版"
              if (raw === '') return
              const index = Number(raw)
              setSelected('')
              const name = (images[index]!.attachment as ImageRef).name ?? `mockup-${index + 1}.png`
              send(buildFeedbackMessage(name, index))
            }}
            style={{
              height: 28,
              padding: '0 8px',
              border: '1px solid var(--dsw-alias-border-l2)',
              borderRadius: 999,
              background: 'var(--dsw-alias-bg-layer-3)',
              font: 'inherit',
              fontSize: 13,
              color: 'var(--dsw-alias-label-primary)',
            }}
          >
            <option value="" disabled>
              {t('card.selectPlaceholder')}
            </option>
            {images.map((image, index) => (
              <option key={index} value={index}>
                {t('card.select', { n: index + 1 })}
              </option>
            ))}
          </select>
        )}
        {/* 设锚入口：单图直接按钮；多图下拉选版本（与「选用某一版」同款胶囊） */}
        {anchor !== undefined &&
          (images.length === 1 ? (
            <Button
              variant="ghost"
              size="sm"
              title={t('card.setAnchor')}
              onClick={() => void setAnchor(images[0]!.attachment.name ?? 'mockup-1.png')}
            >
              {t('card.setAnchorButton')}
            </Button>
          ) : (
            <select
              value={anchorPicked}
              onChange={(event) => {
                const raw = event.target.value
                // placeholder（空值）不可触发；Number('') === 0 会误设第 1 版
                if (raw === '') return
                const index = Number(raw)
                setAnchorPicked('')
                const name =
                  (images[index]!.attachment as ImageRef).name ?? `mockup-${index + 1}.png`
                void setAnchor(name)
              }}
              title={t('card.setAnchor')}
              style={{
                height: 28,
                padding: '0 8px',
                border: '1px solid var(--dsw-alias-border-l2)',
                borderRadius: 999,
                background: 'var(--dsw-alias-bg-layer-3)',
                font: 'inherit',
                fontSize: 13,
                color: 'var(--dsw-alias-label-primary)',
              }}
            >
              <option value="" disabled>
                {t('card.setAnchorSelect')}
              </option>
              {images.map((image, index) => (
                <option key={index} value={index}>
                  {t('card.setAnchorOption', { n: index + 1 })}
                </option>
              ))}
            </select>
          ))}
        {/* 「打开原图」入口移入标注弹窗底部（第 4 轮提案）：图片本体在资产库，
            弹窗内走图片路由新开页 */}
        <Button variant="ghost" size="sm" onClick={() => setShowFeedback((value) => !value)}>
          {t('card.feedback')}
        </Button>
      </div>

      {showFeedback && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <textarea
            value={opinion}
            onChange={(event) => setOpinion(event.target.value)}
            placeholder={t('card.feedbackPlaceholder')}
            rows={2}
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
          <div style={{ display: 'flex', gap: 8 }}>
            <Button
              variant="primary"
              size="sm"
              disabled={opinion.trim() === ''}
              onClick={() => {
                if (opinion.trim() === '') return
                const name = images[0]!.attachment.name ?? 'mockup-1.png'
                send(buildFeedbackMessage(name, 0, opinion))
                setOpinion('')
                setShowFeedback(false)
              }}
            >
              {t('card.feedbackSubmit')}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setShowFeedback(false)}>
              {t('card.feedbackCancel')}
            </Button>
          </div>
        </div>
      )}

      {annotating !== null && (
        <AnnotateModal
          name={annotating}
          cwd={cwd}
          t={t}
          onClose={() => setAnnotating(null)}
          onSubmit={(opinion, marks, imageWidth, imageHeight) => {
            // 有标注走编号坐标消息；无标注退化为现有纯文字意见消息
            const projections = projectMarks(marks, imageWidth, imageHeight)
            const text =
              projections.length > 0
                ? buildAnnotationFeedbackMessage({
                    name: annotating,
                    time: new Date(),
                    projections,
                    opinion,
                  })
                : buildFeedbackMessage(annotating, 0, opinion)
            send(text)
            setAnnotating(null)
          }}
        />
      )}
    </div>
  )
}
