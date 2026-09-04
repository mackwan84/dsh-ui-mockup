// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { UiMockupToolview } from '../src/client/toolview.js'
import { en, zh } from '../src/client/locales.js'
// 告警夹具直接复用宿主构建函数：服务端文案漂移会在断言处暴露，
// 而不是客户端解析与测试各自硬编码、双双静默失真
import { buildFailuresNotice, buildOversizeNotice } from '../src/index.js'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

type ToolviewProps = ComponentProps<typeof UiMockupToolview>

// 与组件内 formatModelMessage 同款函数式替换：字符串替换串会把 $& 等当模式解释
const interpolate = (text: string, params?: Record<string, unknown>): string => {
  for (const [name, value] of Object.entries(params ?? {})) {
    text = text.replaceAll(`{${name}}`, () => String(value))
  }
  return text
}

const t = ((key: keyof typeof zh, params?: Record<string, unknown>) =>
  interpolate(zh[key], params)) as ToolviewProps['t']

const tEn = ((key: keyof typeof en, params?: Record<string, unknown>) =>
  interpolate(en[key], params)) as ToolviewProps['t']

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

  it('页面刷新后按工具调用时间恢复累计耗时并继续递增', () => {
    vi.useFakeTimers()
    const now = new Date('2026-09-04T10:00:00.000Z')
    vi.setSystemTime(now)

    render(<UiMockupToolview {...propsOf({ time: now.getTime() - 65_000 })} />)
    expect(screen.getByText('生成中 · 已耗时 1 分 5 秒')).toBeDefined()

    act(() => {
      vi.advanceTimersByTime(2_000)
    })
    expect(screen.getByText('生成中 · 已耗时 1 分 7 秒')).toBeDefined()
  })

  it('事件时间为 0 等损坏值时回退到挂载时间，不显示荒谬耗时', () => {
    vi.useFakeTimers()
    const now = new Date('2026-09-04T10:00:00.000Z')
    vi.setSystemTime(now)

    render(<UiMockupToolview {...propsOf({ time: 0 })} />)
    // time=0（1970 纪元）若被采信会显示约 55 年；回退后从挂载时刻起算
    expect(screen.getByText('生成中…')).toBeDefined()

    act(() => {
      vi.advanceTimersByTime(3_000)
    })
    expect(screen.getByText('生成中 · 已耗时 3 秒')).toBeDefined()
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

  it('意见里的 $ 替换模式组合原样进入模型消息', () => {
    const setDraft = vi.fn()
    const baseProps = propsOf(settledBlock(['mockup-1.png']))
    render(
      <UiMockupToolview
        {...baseProps}
        inputActions={{ ...baseProps.inputActions, setDraft, submit: () => {} }}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: '提交修改意见' }))
    fireEvent.change(screen.getByPlaceholderText('描述要修改的地方…'), {
      // $& / $` / $' / $$ 在字符串替换串中都是特殊模式；函数式替换必须原样保留
      target: { value: '参考 $& 与 $` 语法，价格 $$100' },
    })
    fireEvent.click(screen.getByRole('button', { name: '提交并重新生成' }))
    expect(setDraft).toHaveBeenLastCalledWith(
      '参考 $& 与 $` 语法，价格 $$100（基于文件：mockup-1.png，请按此意见重新生成）',
    )
  })

  it('有图片时仍显示部分下载失败和附件超限告警', () => {
    render(
      <UiMockupToolview
        {...propsOf(
          settledBlock(
            ['mockup-1.png'],
            // 夹具由宿主构建函数生成：标记前缀或文案漂移会在这里立即暴露
            `已生成 1 张。${buildFailuresNotice(['第 2 张: HTTP 404'])}${buildOversizeNotice(1)}`,
          ),
        )}
      />,
    )

    expect(screen.getByText(/注意: 有 1 张下载失败/)).toBeDefined()
    expect(screen.getByText(/其中 1 张超过会话附件大小上限/)).toBeDefined()
  })
})
