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
  vi.restoreAllMocks()
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

function drawRect(canvas: HTMLCanvasElement, from: [number, number], to: [number, number]): void {
  dispatchPointer(canvas, 'pointerdown', from[0], from[1])
  dispatchPointer(canvas, 'pointermove', to[0], to[1])
  dispatchPointer(canvas, 'pointerup', to[0], to[1])
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

  it('缩放下拉默认适合窗口，并提供四个固定比例', () => {
    render(<UiMockupToolview {...propsOf(settledBlock(['mockup-zoom.png']))} />)
    fireEvent.click(screen.getByRole('button', { name: /点击放大并圈选/ }))
    const images = screen.getAllByAltText('mockup-zoom.png')
    simulateImageLoad(images[images.length - 1] as HTMLImageElement, 2000, 1000)

    const select = screen.queryByRole<HTMLSelectElement>('combobox', { name: '缩放比例' })
    expect(select).not.toBeNull()
    if (select === null) return
    expect(select.value).toBe('fit')
    expect(Array.from(select.options, (option) => option.text)).toEqual([
      '适合窗口',
      '50%',
      '100%',
      '150%',
      '200%',
    ])

    fireEvent.change(select, { target: { value: '1.5' } })
    const canvas = document.querySelector('canvas')
    expect(canvas?.style.width).toBe('3000px')
    expect(canvas?.style.height).toBe('1500px')
  })

  it('从适合窗口切到固定比例时从整图中心开始', () => {
    render(<UiMockupToolview {...propsOf(settledBlock(['mockup-center.png']))} />)
    fireEvent.click(screen.getByRole('button', { name: /点击放大并圈选/ }))
    const images = screen.getAllByAltText('mockup-center.png')
    simulateImageLoad(images[images.length - 1] as HTMLImageElement, 2000, 1000)

    const canvas = document.querySelector('canvas')!
    const scroller = canvas.parentElement?.parentElement as HTMLDivElement
    Object.defineProperty(scroller, 'clientWidth', { value: 800, configurable: true })
    Object.defineProperty(scroller, 'clientHeight', { value: 400, configurable: true })
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      callback(0)
      return 1
    })

    fireEvent.change(screen.getByRole('combobox', { name: '缩放比例' }), {
      target: { value: '0.5' },
    })
    expect(scroller.scrollLeft).toBe(100)
    expect(scroller.scrollTop).toBe(50)
  })

  it('默认选择/移动工具拖动画布且不创建标记', () => {
    render(<UiMockupToolview {...propsOf(settledBlock(['mockup-pan.png']))} />)
    fireEvent.click(screen.getByRole('button', { name: /点击放大并圈选/ }))
    const images = screen.getAllByAltText('mockup-pan.png')
    simulateImageLoad(images[images.length - 1] as HTMLImageElement, 2000, 1000)

    const selectAndMove = screen.queryByRole('button', { name: '选择/移动' })
    expect(selectAndMove).not.toBeNull()
    expect(selectAndMove?.getAttribute('aria-pressed')).toBe('true')
    const canvas = document.querySelector('canvas')!
    prepareCanvas(canvas)
    expect(canvas.style.cursor).toBe('grab')
    const scroller = canvas.parentElement?.parentElement as HTMLDivElement
    scroller.scrollLeft = 200
    scroller.scrollTop = 100

    dispatchPointer(canvas, 'pointerdown', 100, 100)
    dispatchPointer(canvas, 'pointermove', 70, 60)
    expect(scroller.scrollLeft).toBe(230)
    expect(scroller.scrollTop).toBe(140)
    expect(canvas.style.cursor).toBe('grabbing')
    dispatchPointer(canvas, 'pointerup', 70, 60)
    expect(canvas.style.cursor).toBe('grab')
    expect(screen.queryByText(/已选中标记/)).toBeNull()
  })

  it('工具切换时显示对应操作提示，绘图模式明确引导回选择/移动', () => {
    render(<UiMockupToolview {...propsOf(settledBlock(['mockup-mode-hint.png']))} />)
    fireEvent.click(screen.getByRole('button', { name: /点击放大并圈选/ }))

    expect(screen.getByText('拖动画布可移动图片；单击已有标记可选择。')).toBeDefined()

    fireEvent.click(screen.getByRole('button', { name: '矩形' }))
    expect(screen.getByRole('note').textContent).toBe(
      '当前为矩形工具。要选择或删除标记，请切换到「选择/移动」。',
    )

    fireEvent.click(screen.getByRole('button', { name: '箭头' }))
    expect(
      screen.getByText('当前为箭头工具。要选择或删除标记，请切换到「选择/移动」。'),
    ).toBeDefined()

    fireEvent.click(screen.getByRole('button', { name: '选择/移动' }))
    expect(screen.getByText('拖动画布可移动图片；单击已有标记可选择。')).toBeDefined()
  })

  it('说明栏固定为 44px，工具提示切换不改变高度约束', () => {
    render(<UiMockupToolview {...propsOf(settledBlock(['mockup-stable-height.png']))} />)
    fireEvent.click(screen.getByRole('button', { name: /点击放大并圈选/ }))

    const hintRow = screen.getByText('拖动画布可移动图片；单击已有标记可选择。').parentElement
    expect(hintRow?.style.height).toBe('44px')
    expect(hintRow?.style.boxSizing).toBe('border-box')

    fireEvent.click(screen.getByRole('button', { name: '矩形' }))
    expect(screen.getByRole('note').parentElement).toBe(hintRow)
    expect(hintRow?.style.height).toBe('44px')
  })

  it('选择/移动工具单选已有标记，显式删除按钮删除后剩余标记重新编号', () => {
    const setDraft = vi.fn()
    render(
      <UiMockupToolview
        {...propsOf(settledBlock(['mockup-delete.png']))}
        inputActions={inputActionsOf(setDraft, () => {})}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /点击放大并圈选/ }))
    const images = screen.getAllByAltText('mockup-delete.png')
    simulateImageLoad(images[images.length - 1] as HTMLImageElement, 2000, 1000)
    const canvas = document.querySelector('canvas')!
    prepareCanvas(canvas)

    fireEvent.click(screen.getByRole('button', { name: '矩形' }))
    drawRect(canvas, [100, 100], [300, 300])
    drawRect(canvas, [500, 100], [700, 300])
    fireEvent.click(screen.getByRole('button', { name: '选择/移动' }))
    dispatchPointer(canvas, 'pointerdown', 200, 200)
    dispatchPointer(canvas, 'pointerup', 200, 200)
    expect(screen.getByRole('status').textContent).toBe('已选中标记 ①')
    expect(screen.getByText('Delete', { selector: 'kbd' })).toBeDefined()

    fireEvent.click(screen.getByRole('button', { name: '删除选中标记 ①' }))
    expect(screen.queryByText(/已选中标记/)).toBeNull()
    fireEvent.change(screen.getByPlaceholderText('描述要修改的地方…'), {
      target: { value: '删除后编号验证' },
    })
    fireEvent.click(screen.getByRole('button', { name: '提交并重新生成' }))

    const message = String(setDraft.mock.calls.at(-1)?.[0])
    expect(message).toContain('①区域 x:[0.25,0.35] y:[0.10,0.30]')
    expect(message).not.toContain('x:[0.05,0.15]')
    expect(message).not.toContain('②区域')
  })

  it('删除和清空均可撤销，输入框 Backspace 不误删选中标记', () => {
    const setDraft = vi.fn()
    render(
      <UiMockupToolview
        {...propsOf(settledBlock(['mockup-undo-delete.png']))}
        inputActions={inputActionsOf(setDraft, () => {})}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /点击放大并圈选/ }))
    const images = screen.getAllByAltText('mockup-undo-delete.png')
    simulateImageLoad(images[images.length - 1] as HTMLImageElement, 2000, 1000)
    const canvas = document.querySelector('canvas')!
    prepareCanvas(canvas)
    fireEvent.click(screen.getByRole('button', { name: '矩形' }))
    drawRect(canvas, [100, 100], [300, 300])

    fireEvent.click(screen.getByRole('button', { name: '选择/移动' }))
    dispatchPointer(canvas, 'pointerdown', 200, 200)
    dispatchPointer(canvas, 'pointerup', 200, 200)
    fireEvent.keyDown(canvas, { key: 'Backspace' })
    fireEvent.click(screen.getByRole('button', { name: '撤销' }))

    fireEvent.click(screen.getByRole('button', { name: '清空' }))
    expect(screen.getByRole<HTMLButtonElement>('button', { name: '撤销' }).disabled).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: '撤销' }))
    dispatchPointer(canvas, 'pointerdown', 200, 200)
    dispatchPointer(canvas, 'pointerup', 200, 200)

    const textarea = screen.getByPlaceholderText('描述要修改的地方…')
    fireEvent.change(textarea, { target: { value: '输入框防误删' } })
    fireEvent.keyDown(textarea, { key: 'Backspace' })
    expect(screen.getByText('已选中标记 ①')).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: '提交并重新生成' }))
    expect(String(setDraft.mock.calls.at(-1)?.[0])).toContain('①区域 x:[0.05,0.15] y:[0.10,0.30]')
  })

  it('底图尺寸未就绪时提交按钮禁用，避免可点却静默无效', () => {
    const setDraft = vi.fn()
    render(
      <UiMockupToolview
        {...propsOf(settledBlock(['mockup-loading.png']))}
        inputActions={inputActionsOf(setDraft, () => {})}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /点击放大并圈选/ }))

    // 大图加载期间：意见已填但 imageSize 仍为 null
    fireEvent.change(screen.getByPlaceholderText('描述要修改的地方…'), {
      target: { value: '加载期间就提交' },
    })
    const submitButton = screen.getByRole<HTMLButtonElement>('button', {
      name: '提交并重新生成',
    })
    expect(submitButton.disabled).toBe(true)
    fireEvent.click(submitButton)
    expect(setDraft).not.toHaveBeenCalled()

    // 加载完成后恢复可用
    const images = screen.getAllByAltText('mockup-loading.png')
    simulateImageLoad(images[images.length - 1] as HTMLImageElement, 2000, 1000)
    expect(screen.getByRole<HTMLButtonElement>('button', { name: '提交并重新生成' }).disabled).toBe(
      false,
    )
  })

  it('焦点在工具条按钮上时删除键不删标记，只有画布聚焦才生效', () => {
    render(<UiMockupToolview {...propsOf(settledBlock(['mockup-focus-scope.png']))} />)
    fireEvent.click(screen.getByRole('button', { name: /点击放大并圈选/ }))
    const images = screen.getAllByAltText('mockup-focus-scope.png')
    simulateImageLoad(images[images.length - 1] as HTMLImageElement, 2000, 1000)
    const canvas = document.querySelector('canvas')!
    prepareCanvas(canvas)
    fireEvent.click(screen.getByRole('button', { name: '矩形' }))
    drawRect(canvas, [100, 100], [300, 300])

    fireEvent.click(screen.getByRole('button', { name: '选择/移动' }))
    dispatchPointer(canvas, 'pointerdown', 200, 200)
    dispatchPointer(canvas, 'pointerup', 200, 200)
    expect(screen.getByText('已选中标记 ①')).toBeDefined()

    // 工具条按钮与弹窗根节点持有焦点时按删除键：标记必须还在（选中态不变）
    fireEvent.keyDown(screen.getByRole('button', { name: '撤销' }), { key: 'Delete' })
    expect(screen.getByText('已选中标记 ①')).toBeDefined()
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Backspace' })
    expect(screen.getByText('已选中标记 ①')).toBeDefined()

    // 画布聚焦时才真正删除：选中态播报随之消失
    fireEvent.keyDown(canvas, { key: 'Delete' })
    expect(screen.queryByText('已选中标记 ①')).toBeNull()
    expect(screen.getByRole<HTMLButtonElement>('button', { name: '清空' }).disabled).toBe(true)
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
    fireEvent.click(screen.getByRole('button', { name: '矩形' }))
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
