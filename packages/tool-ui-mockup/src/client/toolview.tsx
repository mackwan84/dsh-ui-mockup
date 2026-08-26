/**
 * ui_mockup 工具卡片：生成图内嵌展示 + 确认/选用/修改意见反馈按钮。
 * 纯展示组件，接收 tool.call.toolview 的 owner payload 与框架注入的
 * `t`（i18n）和 `inputActions`（反馈按钮通过 setDraft + submit 发送消息）。
 */
import { useState } from 'react'
import type { ToolCallViewProps } from '@deepseek-ai/dsh-client-ui-tool/client'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { NS } from './locales.js'

type Props = ToolCallViewProps & PropsLocale<typeof NS>

/** 图片附件引用（会话附件块里的 image 块所携带的最小结构）。 */
interface ImageRef {
  readonly name?: string
  readonly mediaType?: string
  readonly width?: number
  readonly height?: number
}

/** 图片文件名 → webServer 路由 URL（host 半区 /ui-mockup/images 服务 design/images/）。 */
function imageUrl(name: string): string {
  return `/ui-mockup/images/${encodeURIComponent(name)}`
}

/** 反馈按钮发送给 agent 的消息正文（中文固定，模型可见文本不随 UI 语言切换）。 */
function buildFeedbackMessage(
  t: Props['t'],
  name: string,
  index: number,
  opinion?: string,
): string {
  if (opinion !== undefined && opinion.trim() !== '') {
    return t('card.feedbackMessage', { opinion: opinion.trim(), name })
  }
  return t('card.selectMessage', { n: index + 1, name })
}

export function UiMockupToolview({ block, inputActions, openFile, t }: Props) {
  const [showFeedback, setShowFeedback] = useState(false)
  const [opinion, setOpinion] = useState('')

  if (!('kind' in block)) {
    return (
      <div style={{ padding: '8px 0', color: 'var(--dsw-text-secondary, #888)' }}>
        {t('card.generating')}
      </div>
    )
  }

  const images = block.content.filter((item) => item.type === 'image')
  const message = block.content
    .filter((item) => item.type === 'text')
    .map((item) => item.text)
    .join('')

  if (images.length === 0) {
    return <div style={{ padding: '8px 0', whiteSpace: 'pre-wrap' }}>{message}</div>
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
          return (
            <figure key={`${name}:${index}`} style={{ margin: 0 }}>
              <img
                src={imageUrl(name)}
                alt={name}
                loading="lazy"
                style={{
                  maxWidth: 240,
                  maxHeight: 240,
                  borderRadius: 6,
                  border: '1px solid var(--dsw-border, rgba(0,0,0,0.12))',
                  objectFit: 'contain',
                  background: 'var(--dsw-bg-subtle, #f5f5f5)',
                }}
              />
              <figcaption
                style={{ fontSize: 11, color: 'var(--dsw-text-secondary, #888)', marginTop: 2 }}
              >
                {name}
              </figcaption>
            </figure>
          )
        })}
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        <button
          type="button"
          onClick={() =>
            send(t('card.confirmMessage', { name: images[0]!.attachment.name ?? 'mockup.png' }))
          }
        >
          ✅ {t('card.confirm')}
        </button>
        {images.length > 1 && (
          <select
            onChange={(event) => {
              const index = Number(event.target.value)
              if (Number.isInteger(index)) {
                const name =
                  (images[index]!.attachment as ImageRef).name ?? `mockup-${index + 1}.png`
                send(buildFeedbackMessage(t, name, index))
              }
            }}
            defaultValue=""
          >
            <option value="" disabled>
              {t('card.select', { n: '' })}
            </option>
            {images.map((image, index) => (
              <option key={index} value={index}>
                {t('card.select', { n: index + 1 })}
              </option>
            ))}
          </select>
        )}
        <button
          type="button"
          onClick={() => {
            const name = (images[0]!.attachment as ImageRef).name ?? 'mockup.png'
            openFile(`design/images/${name}`)
          }}
        >
          🖼 {t('card.openOriginal')}
        </button>
        <button type="button" onClick={() => setShowFeedback((value) => !value)}>
          📝 {t('card.feedback')}
        </button>
      </div>

      {showFeedback && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <textarea
            value={opinion}
            onChange={(event) => setOpinion(event.target.value)}
            placeholder={t('card.feedbackPlaceholder')}
            rows={2}
            style={{ resize: 'vertical' }}
          />
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              onClick={() => {
                const name = (images[0]!.attachment as ImageRef).name ?? 'mockup.png'
                send(buildFeedbackMessage(t, name, 0, opinion))
                setOpinion('')
                setShowFeedback(false)
              }}
            >
              {t('card.feedbackSubmit')}
            </button>
            <button type="button" onClick={() => setShowFeedback(false)}>
              {t('card.feedbackCancel')}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
