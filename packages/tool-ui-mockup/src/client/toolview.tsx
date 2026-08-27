/**
 * ui_mockup 工具卡片：生成图内嵌展示 + 确认/选用/修改意见反馈按钮。
 * 纯展示组件，接收 tool.call.toolview 的 owner payload 与框架注入的
 * `t`（i18n）和 `inputActions`（反馈按钮通过 setDraft + submit 发送消息）。
 * 视觉与 DSH 原生一致：Button 原语 + --dsw-alias-* 主题令牌。
 */
import { useState } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ToolCallViewProps } from '@deepseek-ai/dsh-client-ui-tool/client'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { imageUrl } from './shared.js'
import type { NS } from './locales.js'

type Props = ToolCallViewProps & PropsLocale<typeof NS>

/** 图片附件引用（会话附件块里的 image 块所携带的最小结构）。 */
interface ImageRef {
  readonly name?: string
  readonly mediaType?: string
  readonly width?: number
  readonly height?: number
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

export function UiMockupToolview({ block, inputActions, openFile, cwd, t }: Props) {
  const [showFeedback, setShowFeedback] = useState(false)
  const [opinion, setOpinion] = useState('')
  const [selected, setSelected] = useState('')

  if (!('kind' in block)) {
    return (
      <div style={{ padding: '8px 0', fontSize: 13, color: 'var(--dsw-alias-label-tertiary)' }}>
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
                  border: '1px solid var(--dsw-alias-border-l2)',
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
              </figcaption>
            </figure>
          )
        })}
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
        <Button
          variant="primary"
          size="sm"
          onClick={() =>
            send(t('card.confirmMessage', { name: images[0]!.attachment.name ?? 'mockup.png' }))
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
              send(buildFeedbackMessage(t, name, index))
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
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            const name = images[0]!.attachment.name ?? 'mockup.png'
            openFile(`design/images/${name}`)
          }}
        >
          {t('card.openOriginal')}
        </Button>
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
              onClick={() => {
                const name = images[0]!.attachment.name ?? 'mockup.png'
                send(buildFeedbackMessage(t, name, 0, opinion))
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
