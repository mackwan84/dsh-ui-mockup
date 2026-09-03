// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { UiMockupToolview } from '../src/client/toolview.js'
import { zh } from '../src/client/locales.js'

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
