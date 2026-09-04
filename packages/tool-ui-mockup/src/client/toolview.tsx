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
import { imageUrl } from './shared.js'
import { zh, type NS } from './locales.js'

type Props = ToolCallViewProps & PropsLocale<typeof NS> & { anchor?: ToolviewAnchorFace }

/** 卡片锚点注入面：由注册方闭包捕获 connection 提供，直连 RPC 不经 agent。 */
export interface ToolviewAnchorFace {
  set(file: string, cwd?: string): Promise<unknown>
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
  key: 'card.confirmMessage' | 'card.selectMessage' | 'card.feedbackMessage',
  params: Record<string, string | number>,
): string {
  let text: string = zh[key]
  for (const [name, value] of Object.entries(params)) {
    text = text.replaceAll(`{${name}}`, String(value))
  }
  return text
}

/** 成功路径只显示需要用户处理的告警，不重复内部存储路径等完整工具文本。 */
function resultNotice(message: string): string {
  const starts = [message.indexOf(' 注意:'), message.indexOf(' 其中 ')].filter(
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

  // 生成耗时反馈：高保真模型单次可超 5 分钟；这里只说明本地等待时长，
  // 不能据此判断远端任务进度或存活状态。
  // 卡片挂载即本地计时（不依赖 RPC/Provider 协议），出图后块带 kind 即停表。
  const pending = !('kind' in block)
  const [elapsedSeconds, setElapsedSeconds] = useState(0)
  useEffect(() => {
    if (!pending) return undefined
    const startedAt = Date.now()
    const timer = setInterval(() => {
      setElapsedSeconds(Math.max(0, Math.round((Date.now() - startedAt) / 1000)))
    }, 1000)
    return () => clearInterval(timer)
  }, [pending])

  const setAnchor = async (name: string) => {
    if (anchor === undefined) return
    setAnchorError('')
    try {
      await anchor.set(name, cwd)
      setAnchoredNames((prev) => new Set(prev).add(name))
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
          style={{ fontSize: 12, lineHeight: '18px', color: 'var(--dsw-alias-label-warning)' }}
        >
          {notice}
        </div>
      )}
      {anchorError !== '' && (
        <div style={{ fontSize: 12, color: 'var(--dsw-alias-label-error)' }}>{anchorError}</div>
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
        {/* 图片本体在资产库（不在工作区），打开原图走图片路由新开页 */}
        {(() => {
          const firstName = images[0]!.attachment.name ?? 'mockup-1.png'
          return (
            <a href={imageUrl(firstName, cwd)} target="_blank" rel="noreferrer">
              <Button variant="ghost" size="sm">
                {t('card.openOriginal')}
              </Button>
            </a>
          )
        })()}
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
    </div>
  )
}
