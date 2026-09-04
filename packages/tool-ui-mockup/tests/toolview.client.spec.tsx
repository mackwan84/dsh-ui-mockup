// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { UiMockupToolview } from '../src/client/toolview.js'
import { en, zh } from '../src/client/locales.js'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

type ToolviewProps = ComponentProps<typeof UiMockupToolview>

const t = ((key: keyof typeof zh, params?: Record<string, unknown>) => {
  let text: string = zh[key]
  for (const [name, value] of Object.entries(params ?? {})) {
    text = text.replaceAll(`{${name}}`, String(value))
  }
  return text
}) as ToolviewProps['t']

const tEn = ((key: keyof typeof en, params?: Record<string, unknown>) => {
  let text: string = en[key]
  for (const [name, value] of Object.entries(params ?? {})) {
    text = text.replaceAll(`{${name}}`, String(value))
  }
  return text
}) as ToolviewProps['t']

function settledBlock(names: string[], message = '生成成功') {
  return {
    kind: 'tool-result',
    content: [
      ...names.map((name) => ({ type: 'image', attachment: { name } })),
      { type: 'text', text: message },
    ],
  }
}

// 最小 props：框架注入面的其余座席在生成中/出图两分支都不被触达
function propsOf(block: unknown): ToolviewProps {
  return {
    callId: 'call-1',
    toolName: 'ui_mockup',
    block,
    openFile: () => {},
    inputActions: { setDraft: () => {}, submit: () => {} },
    t,
  } as unknown as ToolviewProps
}

describe('UiMockupToolview 生成中计时', () => {
  it('首秒显示纯「生成中…」，不出现 0 秒噪音', () => {
    vi.useFakeTimers()
    render(<UiMockupToolview {...propsOf({})} />)
    expect(screen.getByText('生成中…')).toBeDefined()
  })

  it('未满一分钟按秒展示已耗时', () => {
    vi.useFakeTimers()
    render(<UiMockupToolview {...propsOf({})} />)
    act(() => {
      vi.advanceTimersByTime(5_000)
    })
    expect(screen.getByText('生成中 · 已耗时 5 秒')).toBeDefined()
  })

  it('超过一分钟按分秒展示已耗时', () => {
    vi.useFakeTimers()
    render(<UiMockupToolview {...propsOf({})} />)
    act(() => {
      vi.advanceTimersByTime(125_000)
    })
    expect(screen.getByText('生成中 · 已耗时 2 分 5 秒')).toBeDefined()
  })

  it('出图后停止计时并渲染图片卡片', () => {
    vi.useFakeTimers()
    const settledBlock = {
      kind: 'tool-result',
      content: [{ type: 'image', attachment: { name: 'mockup-1.png' } }],
    }
    const { rerender } = render(<UiMockupToolview {...propsOf({})} />)
    act(() => {
      vi.advanceTimersByTime(3_000)
    })
    expect(screen.getByText('生成中 · 已耗时 3 秒')).toBeDefined()

    rerender(<UiMockupToolview {...propsOf(settledBlock)} />)
    act(() => {
      vi.advanceTimersByTime(3_000)
    })
    expect(screen.queryByText(/生成中/)).toBeNull()
    expect(screen.getByAltText('mockup-1.png')).toBeDefined()
  })
})

describe('UiMockupToolview 反馈与告警', () => {
  it('英文界面发送给模型的确认、选版和修改意见仍固定为中文', () => {
    const setDraft = vi.fn()
    const submit = vi.fn()
    const baseProps = propsOf(settledBlock(['mockup-1.png', 'mockup-2.png']))
    render(
      <UiMockupToolview
        {...baseProps}
        t={tEn}
        inputActions={{ ...baseProps.inputActions, setDraft, submit }}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Confirm this version' }))
    expect(setDraft).toHaveBeenLastCalledWith('确认采用这版设计（文件：mockup-1.png）')

    fireEvent.change(screen.getByRole('combobox'), { target: { value: '1' } })
    expect(setDraft).toHaveBeenLastCalledWith('选用第 2 版（文件：mockup-2.png）')

    fireEvent.click(screen.getByRole('button', { name: 'Submit feedback' }))
    fireEvent.change(screen.getByPlaceholderText('Describe what to change…'), {
      target: { value: 'Make the button orange' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Submit & regenerate' }))
    expect(setDraft).toHaveBeenLastCalledWith(
      'Make the button orange（基于文件：mockup-1.png，请按此意见重新生成）',
    )
    expect(submit).toHaveBeenCalledTimes(3)
  })

  it('空白修改意见不能提交为选用第 1 版', () => {
    const setDraft = vi.fn()
    const submit = vi.fn()
    const baseProps = propsOf(settledBlock(['mockup-1.png']))
    render(
      <UiMockupToolview
        {...baseProps}
        inputActions={{ ...baseProps.inputActions, setDraft, submit }}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: '提交修改意见' }))
    const button = screen.getByRole<HTMLButtonElement>('button', { name: '提交并重新生成' })
    expect(button.disabled).toBe(true)

    fireEvent.change(screen.getByPlaceholderText('描述要修改的地方…'), {
      target: { value: '   ' },
    })
    expect(button.disabled).toBe(true)
    fireEvent.click(button)
    expect(setDraft).not.toHaveBeenCalled()
    expect(submit).not.toHaveBeenCalled()
  })

  it('有图片时仍显示部分下载失败和附件超限告警', () => {
    render(
      <UiMockupToolview
        {...propsOf(
          settledBlock(
            ['mockup-1.png'],
            '已生成 1 张。 注意: 有 1 张下载失败(第 2 张: HTTP 404), 其余图片已保留。 其中 1 张超过会话附件大小上限, 仅保存到工作区, 未在对话中展示。',
          ),
        )}
      />,
    )

    expect(screen.getByText(/注意: 有 1 张下载失败/)).toBeDefined()
    expect(screen.getByText(/其中 1 张超过会话附件大小上限/)).toBeDefined()
  })
})
