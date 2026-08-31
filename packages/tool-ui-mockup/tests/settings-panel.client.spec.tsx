// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { UiMockupSection, type PanelPrefs } from '../src/client/settings-panel.js'
import { zh } from '../src/client/locales.js'
import type {
  ConnectionFace,
  PrefScope,
  RpcResultLike,
  ScopeSnapshot,
} from '../src/client/shared.js'

afterEach(cleanup)

const DEFAULT_PREFS: PanelPrefs = {
  defaultFidelity: 'wireframe',
  defaultPlatform: 'web',
  defaultCount: 2,
  outputDir: 'design/images',
  pollTimeoutMinutes: 10,
  wireframeModel: '',
  highFidelityModel: '',
  defaultSize: '',
}

type Translator = ComponentProps<typeof UiMockupSection>['t']

const t = ((key: keyof typeof zh, params?: Record<string, unknown>) => {
  let text: string = zh[key]
  for (const [name, value] of Object.entries(params ?? {})) {
    text = text.replaceAll(`{${name}}`, String(value))
  }
  return text
}) as Translator

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function createPrefs(
  initial: PanelPrefs = DEFAULT_PREFS,
  options: { applyWrites?: boolean; firstWriteGate?: Promise<void> } = {},
): PrefScope<PanelPrefs> {
  let value = initial
  let revision = 1
  let firstWrite = true
  const listeners = new Set<() => void>()
  const snapshot = (): ScopeSnapshot<PanelPrefs> => ({
    status: 'ready',
    value,
    user: value,
    base: undefined,
    revision,
    writable: true,
    mode: 'host',
  })
  return {
    getSnapshot: snapshot,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    set(field, next) {
      const gate = firstWrite ? options.firstWriteGate : undefined
      firstWrite = false
      if (gate !== undefined) return gate.then(() => apply(field, next))
      return apply(field, next)
    },
    unset(field) {
      if (options.applyWrites === false) return Promise.resolve()
      value = { ...value, [field]: DEFAULT_PREFS[field as keyof PanelPrefs] }
      revision += 1
      for (const listener of listeners) listener()
      return Promise.resolve()
    },
  }

  function apply(field: string, next: unknown): Promise<void> {
    if (options.applyWrites === false) return Promise.resolve()
    value = { ...value, [field]: next }
    revision += 1
    for (const listener of listeners) listener()
    return Promise.resolve()
  }
}

function createConnection({ historyTotal = 0 }: { historyTotal?: number } = {}) {
  const call = vi.fn(
    (_channel: string, endpoint: string, _payload?: unknown): Promise<RpcResultLike<unknown>> => {
      const value =
        endpoint === 'overview'
          ? {
              provider: 'dashscope',
              credential: { configured: true, source: 'file', writable: true },
              anchor: null,
            }
          : endpoint === 'provider/status'
            ? { active: 'dashscope' }
            : endpoint === 'history/list'
              ? {
                  anchorFile: null,
                  anchorIndex: -1,
                  total: historyTotal,
                  page: 1,
                  pageSize: 5,
                  entries:
                    historyTotal === 0
                      ? []
                      : [
                          {
                            time: '2026-08-31T00:00:00.000Z',
                            description: '移动端登录页',
                            files: [],
                            anchored: false,
                          },
                        ],
                }
              : {}
      return Promise.resolve({ ok: true as const, value })
    },
  )
  const connection: ConnectionFace = { isLoopback: true, rpc: { call } }
  return { connection, call }
}

function mountPanel(options: { historyTotal?: number; prefs?: PrefScope<PanelPrefs> } = {}) {
  const { connection, call } = createConnection(options)
  const view = render(
    <UiMockupSection t={t} prefs={options.prefs ?? createPrefs()} connection={connection} />,
  )
  return { ...view, call }
}

describe('UiMockupSection tabs', () => {
  it('只让当前 tab 进入 Tab 顺序，并与 tabpanel 双向关联', () => {
    mountPanel()
    const tabs = screen.getAllByRole('tab')
    expect(tabs.map((tab) => tab.tabIndex)).toEqual([0, -1, -1, -1])

    const panel = screen.getByRole('tabpanel')
    expect(tabs[0]?.getAttribute('aria-controls')).toBe(panel.id)
    expect(panel.getAttribute('aria-labelledby')).toBe(tabs[0]?.id)
  })

  it('每个 tab 切换后都与当前 tabpanel 双向关联', () => {
    mountPanel()
    for (const tab of screen.getAllByRole('tab')) {
      fireEvent.click(tab)
      const panel = screen.getByRole('tabpanel')
      expect(tab.getAttribute('aria-controls')).toBe(panel.id)
      expect(panel.getAttribute('aria-labelledby')).toBe(tab.id)
    }
  })

  it('用方向键循环切换并支持 Home 和 End', async () => {
    mountPanel()
    const overview = screen.getByRole('tab', { name: '概览' })

    fireEvent.keyDown(overview, { key: 'ArrowRight' })
    const provider = screen.getByRole('tab', { name: '提供方与模型' })
    expect(provider.getAttribute('aria-selected')).toBe('true')
    expect(document.activeElement).toBe(provider)

    fireEvent.keyDown(provider, { key: 'ArrowLeft' })
    expect(screen.getByRole('tab', { name: '概览' }).getAttribute('aria-selected')).toBe('true')

    fireEvent.keyDown(screen.getByRole('tab', { name: '概览' }), { key: 'ArrowLeft' })
    const history = screen.getByRole('tab', { name: '生成历史' })
    expect(history.getAttribute('aria-selected')).toBe('true')
    expect(document.activeElement).toBe(history)

    fireEvent.keyDown(history, { key: 'Home' })
    expect(screen.getByRole('tab', { name: '概览' }).getAttribute('aria-selected')).toBe('true')

    fireEvent.keyDown(screen.getByRole('tab', { name: '概览' }), { key: 'End' })
    fireEvent.keyDown(screen.getByRole('tab', { name: '生成历史' }), { key: 'ArrowRight' })
    expect(screen.getByRole('tab', { name: '概览' }).getAttribute('aria-selected')).toBe('true')

    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('tab', { name: '概览' })),
    )
  })
})

describe('OverviewPage visuals', () => {
  it('使用稳定的矢量图标而不是系统 Emoji', async () => {
    const { container } = mountPanel()
    await screen.findByText('快速使用')

    expect(container.textContent).not.toContain('💬')
    expect(container.textContent).not.toContain('🖱️')
    expect(container.textContent).not.toContain('🔒')
    expect(container.querySelectorAll('svg').length).toBeGreaterThanOrEqual(3)
  })
})

describe('Settings form accessibility', () => {
  it('可通过可见字段名定位模型选择控件和凭据输入', async () => {
    mountPanel()
    fireEvent.click(screen.getByRole('tab', { name: '提供方与模型' }))

    expect(await screen.findByRole('combobox', { name: '线框图' })).toBeTruthy()
    expect(screen.getByRole('combobox', { name: '高保真' })).toBeTruthy()
    expect(await screen.findByLabelText('DASHSCOPE_API_KEY 密钥')).toBeTruthy()
  })

  it('可通过可见字段名定位轮询超时和默认尺寸', () => {
    mountPanel()
    fireEvent.click(screen.getByRole('tab', { name: '生成偏好' }))

    expect(screen.getByRole('spinbutton', { name: '轮询超时' })).toBeTruthy()
    expect(screen.getByRole('combobox', { name: '默认尺寸' })).toBeTruthy()
  })
})

describe('PreferencesPage dirty state', () => {
  it('草稿恢复为保存值后立即重新禁用保存按钮', () => {
    mountPanel()
    fireEvent.click(screen.getByRole('tab', { name: '生成偏好' }))
    const save = screen.getByRole<HTMLButtonElement>('button', { name: '保存' })
    expect(save.disabled).toBe(true)

    fireEvent.click(screen.getByRole('radio', { name: 'Mobile' }))
    expect(save.disabled).toBe(false)

    fireEvent.click(screen.getByRole('radio', { name: 'Web' }))
    expect(save.disabled).toBe(true)
  })

  it('保存成功通过礼貌状态区播报', async () => {
    mountPanel()
    fireEvent.click(screen.getByRole('tab', { name: '生成偏好' }))
    fireEvent.click(screen.getByRole('radio', { name: 'Mobile' }))
    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    expect((await screen.findByRole('status')).textContent).toBe('已保存 ✓')
  })

  it('保存期间禁用编辑和恢复默认，避免旧操作覆盖新草稿', async () => {
    const gate = deferred<void>()
    mountPanel({ prefs: createPrefs(DEFAULT_PREFS, { firstWriteGate: gate.promise }) })
    fireEvent.click(screen.getByRole('tab', { name: '生成偏好' }))
    fireEvent.click(screen.getByRole('radio', { name: 'Mobile' }))
    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    expect(screen.getByRole<HTMLInputElement>('radio', { name: 'Web' }).disabled).toBe(true)
    expect(screen.getByRole<HTMLInputElement>('radio', { name: 'Mobile' }).disabled).toBe(true)
    expect(screen.getByRole<HTMLButtonElement>('button', { name: '恢复默认' }).disabled).toBe(true)
    expect(screen.getByRole<HTMLButtonElement>('button', { name: '保存' }).disabled).toBe(true)

    fireEvent.click(screen.getByRole('radio', { name: 'Web' }))
    expect(screen.getByRole<HTMLInputElement>('radio', { name: 'Mobile' }).checked).toBe(true)

    gate.resolve()
    expect((await screen.findByRole('status')).textContent).toBe('已保存 ✓')
  })

  it('写入 resolve 但快照未变化时保留 dirty 并报告失败', async () => {
    mountPanel({ prefs: createPrefs(DEFAULT_PREFS, { applyWrites: false }) })
    fireEvent.click(screen.getByRole('tab', { name: '生成偏好' }))
    fireEvent.click(screen.getByRole('radio', { name: 'Mobile' }))
    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    await screen.findByText('设置存储未确认本次更改，请重试。')
    expect(screen.queryByText('已保存 ✓')).toBeNull()
    expect(screen.getByRole<HTMLButtonElement>('button', { name: '保存' }).disabled).toBe(false)
    expect(screen.getByRole<HTMLInputElement>('radio', { name: 'Mobile' }).checked).toBe(true)
  })

  it('恢复默认未落盘时保留当前草稿并报告失败', async () => {
    const customized = { ...DEFAULT_PREFS, defaultPlatform: 'mobile' as const, defaultCount: 3 }
    mountPanel({ prefs: createPrefs(customized, { applyWrites: false }) })
    fireEvent.click(screen.getByRole('tab', { name: '生成偏好' }))
    fireEvent.click(screen.getByRole('button', { name: '恢复默认' }))

    await screen.findByText('设置存储未确认本次更改，请重试。')
    expect(screen.getByRole<HTMLInputElement>('radio', { name: 'Mobile' }).checked).toBe(true)
    expect(screen.getByRole<HTMLInputElement>('radio', { name: '3' }).checked).toBe(true)
  })
})

describe('HistoryPage search', () => {
  it('输入草稿时保留当前结果并提示，点击搜索后从第 1 页提交', async () => {
    const { call } = mountPanel({ historyTotal: 6 })
    fireEvent.click(screen.getByRole('tab', { name: '生成历史' }))
    const search = await screen.findByRole('searchbox', { name: '搜索生成历史' })
    await waitFor(() => {
      expect(call.mock.calls.filter((args) => args[1] === 'history/list')).toHaveLength(1)
    })

    fireEvent.change(search, { target: { value: '登录' } })
    expect(call.mock.calls.filter((args) => args[1] === 'history/list')).toHaveLength(1)
    expect(screen.getByRole('status').textContent).toContain('搜索条件已更改')

    fireEvent.click(screen.getByRole('button', { name: '搜索' }))
    await waitFor(() => {
      const historyCalls = call.mock.calls.filter((args) => args[1] === 'history/list')
      expect(historyCalls).toHaveLength(2)
      expect(historyCalls[1]?.[2]).toMatchObject({ query: '登录', page: 1 })
    })

    fireEvent.click(screen.getByRole('button', { name: '下一页' }))
    await waitFor(() => {
      const historyCalls = call.mock.calls.filter((args) => args[1] === 'history/list')
      expect(historyCalls.at(-1)?.[2]).toMatchObject({ query: '登录', page: 2 })
    })
  })

  it('按 Enter 与搜索按钮使用相同的提交语义', async () => {
    const { call } = mountPanel()
    fireEvent.click(screen.getByRole('tab', { name: '生成历史' }))
    const search = await screen.findByRole('searchbox', { name: '搜索生成历史' })

    fireEvent.change(search, { target: { value: '仪表盘' } })
    fireEvent.keyDown(search, { key: 'Enter', code: 'Enter' })

    await waitFor(() => {
      const historyCalls = call.mock.calls.filter((args) => args[1] === 'history/list')
      expect(historyCalls.at(-1)?.[2]).toMatchObject({ query: '仪表盘', page: 1 })
    })
  })

  it('清空历史后仍按已提交条件重载结果', async () => {
    const { call } = mountPanel({ historyTotal: 6 })
    fireEvent.click(screen.getByRole('tab', { name: '生成历史' }))
    const search = await screen.findByRole('searchbox', { name: '搜索生成历史' })
    fireEvent.change(search, { target: { value: '登录' } })
    fireEvent.click(screen.getByRole('button', { name: '搜索' }))
    await waitFor(() => {
      expect(call.mock.calls.filter((args) => args[1] === 'history/list')).toHaveLength(2)
    })

    fireEvent.click(screen.getByRole('button', { name: '清空历史' }))
    fireEvent.click(screen.getByRole('button', { name: '确认清空?' }))

    await waitFor(() => {
      expect(call.mock.calls.some((args) => args[1] === 'history/clear')).toBe(true)
      const historyCalls = call.mock.calls.filter((args) => args[1] === 'history/list')
      expect(historyCalls.at(-1)?.[2]).toMatchObject({ query: '登录', page: 1 })
    })
  })
})
