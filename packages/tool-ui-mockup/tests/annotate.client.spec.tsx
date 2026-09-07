// @vitest-environment jsdom
/**
 * 标注链路客户端回归：卡片图片进入弹窗、绘制标记后提交，
 * 编号坐标投影进入模型可见消息；Esc 关闭。
 * 画布像素绘制不在 jsdom 能力内（无 canvas 2D），组件对
 * getContext() === null 已有防御分支，这里只验交互与消息装配。
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { UiMockupToolview } from '../src/client/toolview.js'
import { zh } from '../src/client/locales.js'

afterEach(() => {
  cleanup()
})

// jsdom 的 getContext 未实现（每次调用向 stderr 打 not-implemented 噪音）：
// 文件级桩为恒返回 null，组件对 null 上下文已有防御分支
const originalGetContext = Object.getOwnPropertyDescriptor(
  HTMLCanvasElement.prototype,
  'getContext',
)
beforeAll(() => {
  Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
    value: () => null,
    writable: true,
    configurable: true,
  })
})
afterAll(() => {
  if (originalGetContext !== undefined) {
    Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', originalGetContext)
  }
})

type ToolviewProps = ComponentProps<typeof UiMockupToolview>

const interpolate = (text: string, params?: Record<string, unknown>): string => {
  for (const [name, value] of Object.entries(params ?? {})) {
    text = text.replaceAll(`{${name}}`, () => String(value))
  }
  return text
}

const t = ((key: keyof typeof zh, params?: Record<string, unknown>) =>
  interpolate(zh[key], params)) as ToolviewProps['t']

function settledBlock(names: string[]) {
  return {
    kind: 'tool-result',
    content: [
      ...names.map((name) => ({ type: 'image', attachment: { name } })),
      { type: 'text', text: '生成成功' },
    ],
  }
}

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

/** jsdom 的 img 不会真正加载：手动注入固有尺寸并派发 load。 */
function simulateImageLoad(img: HTMLImageElement, width: number, height: number): void {
  Object.defineProperty(img, 'naturalWidth', { value: width, configurable: true })
  Object.defineProperty(img, 'naturalHeight', { value: height, configurable: true })
  fireEvent.load(img)
}

/** jsdom 无 pointer capture：给画布打最小桩。 */
function prepareCanvas(canvas: HTMLCanvasElement): void {
  canvas.setPointerCapture = () => {}
  canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 2000, height: 1000 }) as DOMRect
}

/** jsdom 没有 PointerEvent：用 MouseEvent 构造同名指针事件并注入坐标。 */
function dispatchPointer(canvas: HTMLElement, type: string, x: number, y: number): void {
  act(() => {
    const event = new MouseEvent(type, {
      bubbles: true,
      cancelable: true,
      clientX: x,
      clientY: y,
    })
    canvas.dispatchEvent(event)
  })
}

/** 输入面板动作桩：本链路只用 setDraft/submit，其余成员给空实现占位。 */
function inputActionsOf(setDraft: (text: string) => void, submit: () => void) {
  return {
    setDraft,
    submit,
    addImages: () => true,
    removeImage: () => {},
    pruneImages: () => {},
  }
}

describe('标注反馈链路', () => {
  it('点击卡片图片进入标注弹窗，Esc 关闭', () => {
    render(<UiMockupToolview {...propsOf(settledBlock(['mockup-1.png']))} />)
    fireEvent.click(screen.getByRole('button', { name: /点击放大并圈选/ }))
    expect(screen.getByRole('dialog')).toBeDefined()
    expect(screen.getByText('标注修改区域')).toBeDefined()

    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('矩形标注的编号坐标投影进入模型消息，时间戳为 ISO 8601', () => {
    const setDraft = vi.fn()
    const submit = vi.fn()
    render(
      <UiMockupToolview
        {...propsOf(settledBlock(['mockup-1.png']))}
        inputActions={inputActionsOf(setDraft, submit)}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /点击放大并圈选/ }))
    // 弹窗内的图与卡片缩略图同名：弹窗是后挂载的一份
    const images = screen.getAllByAltText('mockup-1.png')
    const modalImage = images[images.length - 1] as HTMLImageElement
    simulateImageLoad(modalImage, 2000, 1000)

    const canvas = document.querySelector('canvas')!
    expect(canvas).not.toBeNull()
    prepareCanvas(canvas)
    // (200,100) → (720,240)：归一化 x:[0.10,0.36] y:[0.10,0.24]
    dispatchPointer(canvas, 'pointerdown', 200, 100)
    dispatchPointer(canvas, 'pointermove', 720, 240)
    dispatchPointer(canvas, 'pointerup', 720, 240)

    fireEvent.change(screen.getByPlaceholderText('描述要修改的地方…'), {
      target: { value: '红框改成下拉框' },
    })
    fireEvent.click(screen.getByRole('button', { name: '提交并重新生成' }))

    expect(submit).toHaveBeenCalledTimes(1)
    const message = String(setDraft.mock.calls.at(-1)?.[0])
    expect(message).toMatch(
      /^对 design\/images\/mockup-1\.png 的标注反馈（\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z）：/,
    )
    expect(message).toContain('编号区域（归一化坐标）：①区域 x:[0.10,0.36] y:[0.10,0.24]')
    expect(message).toContain('意见：红框改成下拉框')
    // 弹窗随提交关闭
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('弹窗内不画标注直接提交意见时退化为现有纯文字反馈消息', () => {
    const setDraft = vi.fn()
    render(
      <UiMockupToolview
        {...propsOf(settledBlock(['mockup-2.png']))}
        inputActions={inputActionsOf(setDraft, () => {})}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /点击放大并圈选/ }))
    const images = screen.getAllByAltText('mockup-2.png')
    simulateImageLoad(images[images.length - 1] as HTMLImageElement, 2000, 1000)

    fireEvent.change(screen.getByPlaceholderText('描述要修改的地方…'), {
      target: { value: '整体换个配色' },
    })
    fireEvent.click(screen.getByRole('button', { name: '提交并重新生成' }))

    expect(setDraft).toHaveBeenLastCalledWith(
      '整体换个配色（基于文件：mockup-2.png，请按此意见重新生成）',
    )
  })
})
