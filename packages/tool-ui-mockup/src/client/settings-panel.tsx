/**
 * 「UI 草图」设置区块：单个 settings.section 挂四张子页（概览 / 提供方与模型 /
 * 生成偏好 / 生成历史），子页内切换与已确认线框一致。
 * 视觉完全使用 DSH 主题令牌（--dsw-*）与原生控件，浅/深色自适应；
 * 数据面：偏好经同名 settings 命名空间镜像读写，历史/锚点/测试连接走私有 RPC 频道。
 */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import {
  callPanel,
  imageUrl,
  useCurrentSessionCwd,
  type ConnectionFace,
  type PrefScope,
} from './shared.js'
import type { NS, UiMockupKey } from './locales.js'

/** 偏好形状的客户端本地副本（不引入宿主 prefs 模块，避免把 schemastery 打进浏览器包）。 */
export interface PanelPrefs {
  defaultFidelity: 'wireframe' | 'high-fidelity'
  defaultPlatform: 'web' | 'mobile'
  defaultCount: number
  outputDir: string
  pollTimeoutMinutes: number
  wireframeModel: string
  highFidelityModel: string
  defaultSize: string
}

/** 面板本地默认值：须与宿主 DEFAULT_PREFS 保持一致（改动时两侧同步）。 */
const PANEL_DEFAULTS: PanelPrefs = {
  defaultFidelity: 'wireframe',
  defaultPlatform: 'web',
  defaultCount: 2,
  outputDir: 'design/images',
  pollTimeoutMinutes: 10,
  wireframeModel: '',
  highFidelityModel: '',
  defaultSize: '',
}

/**
 * settings 域的客户端结构面（bind 由 ui-settings 插件在运行时提供）。
 * 面板经由它把同名命名空间镜像绑到本插件 fiber；ScopeSnapshot/PrefScope
 * 定义见 ./shared.js，客户端本地不再重复。
 */

/** 注入给面板组件的运行时句柄。 */
export interface UiMockupPanelInjected {
  prefs: PrefScope<PanelPrefs>
  connection: ConnectionFace
}

type PanelProps = PropsLocale<typeof NS> & UiMockupPanelInjected

const SUBPAGES = ['overview', 'provider', 'preferences', 'history'] as const
type SubPage = (typeof SUBPAGES)[number]

/** 子页标题 key 表（i18n词条 panel.tab.*）。 */
const TAB_KEYS: Record<SubPage, `panel.tab.${SubPage}`> = {
  overview: 'panel.tab.overview',
  provider: 'panel.tab.provider',
  preferences: 'panel.tab.preferences',
  history: 'panel.tab.history',
}

export function UiMockupSection({ t, prefs, connection }: PanelProps) {
  const [page, setPage] = useState<SubPage>('overview')
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div role="tablist" style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {SUBPAGES.map((key) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={page === key}
            onClick={() => setPage(key)}
            style={{
              padding: '4px 10px',
              borderRadius: 6,
              cursor: 'pointer',
              border: `1px solid ${page === key ? 'var(--dsw-border-strong, var(--dsw-border, #999))' : 'transparent'}`,
              background:
                page === key ? 'var(--dsw-bg-subtle, rgba(127,127,127,0.12))' : 'transparent',
              color: 'inherit',
              fontWeight: page === key ? 600 : 400,
            }}
          >
            {t(TAB_KEYS[key])}
          </button>
        ))}
      </div>
      {page === 'overview' && <OverviewPage t={t} connection={connection} />}
      {page === 'provider' && <ProviderPage t={t} prefs={prefs} connection={connection} />}
      {page === 'preferences' && <PreferencesPage t={t} prefs={prefs} />}
      {page === 'history' && <HistoryPage t={t} connection={connection} />}
    </div>
  )
}

/* ---------------- 共享原子 ---------------- */

function StatusDot({ ok }: { ok: boolean }) {
  return (
    <span
      aria-hidden
      style={{
        display: 'inline-block',
        width: 8,
        height: 8,
        borderRadius: '50%',
        marginRight: 6,
        background: ok ? 'var(--dsw-success, #2e9e5b)' : 'var(--dsw-danger, #d0453c)',
      }}
    />
  )
}

function Card({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        border: '1px solid var(--dsw-border, rgba(127,127,127,0.35))',
        borderRadius: 8,
        padding: '10px 12px',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}
    >
      {children}
    </div>
  )
}

/* ---------------- 概览 ---------------- */

/** 快速使用三步的图标与词条键（显式常量，规避模板字面量推断不进字典联合）。 */
const QUICK_STEPS = [
  { icon: '💬', title: 'panel.overview.step1Title', body: 'panel.overview.step1Body' },
  { icon: '🖱️', title: 'panel.overview.step2Title', body: 'panel.overview.step2Body' },
  { icon: '🔒', title: 'panel.overview.step3Title', body: 'panel.overview.step3Body' },
] as const

/** 面板用的凭据状态（与宿主 CredentialStatus 同构）：只有三个事实，永不携带值。 */
export interface PanelCredential {
  configured: boolean
  source?: string
  writable: boolean
}

interface OverviewData {
  provider: string
  credential: PanelCredential
  anchor: string | null
}

function OverviewPage({ t, connection }: Omit<PanelProps, 'prefs'>) {
  const [data, setData] = useState<OverviewData>()
  const [error, setError] = useState('')
  useEffect(() => {
    let alive = true
    callPanel<OverviewData>(connection, 'overview')
      .then((value) => {
        if (alive) setData(value)
      })
      .catch((err: unknown) => {
        if (alive) setError(err instanceof Error ? err.message : String(err))
      })
    return () => {
      alive = false
    }
  }, [connection])

  if (error !== '')
    return (
      <div style={{ color: 'var(--dsw-danger, #d0453c)' }}>{t('panel.loadFailed', { error })}</div>
    )
  if (data === undefined) return <div>{t('panel.loading')}</div>

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <p style={{ margin: 0, lineHeight: 1.6 }}>{t('panel.overview.intro')}</p>
      <Card>
        <strong>{t('panel.overview.quickTitle')}</strong>
        {QUICK_STEPS.map((step) => (
          <div key={step.title} style={{ display: 'flex', gap: 8 }}>
            <span aria-hidden>{step.icon}</span>
            <p style={{ margin: 0, lineHeight: 1.55 }}>
              <strong>{t(step.title)}</strong>
              <br />
              {t(step.body)}
            </p>
          </div>
        ))}
      </Card>
      <div style={{ display: 'flex', alignItems: 'center', opacity: 0.85 }}>
        <StatusDot ok={data.credential.configured} />
        {t('panel.overview.statusLine', {
          provider: t('panel.provider.dashscopeName'),
          credential: data.credential.configured
            ? t('panel.credential.ready')
            : t('panel.credential.missing'),
        })}
      </div>
    </div>
  )
}

/* ---------------- 提供方与模型 ---------------- */

/** 来源层 id → 词条键（显式映射，规避模板字面量推断不进字典联合）。 */
const SOURCE_LABELS: Record<string, UiMockupKey> = {
  env: 'panel.credential.source.env',
  file: 'panel.credential.source.file',
  'project-env': 'panel.credential.source.project-env',
  'user-env': 'panel.credential.source.user-env',
  ambient: 'panel.credential.source.ambient',
}

function sourceLabelText(t: PanelProps['t'], source: string | undefined): string | undefined {
  if (source === undefined) return undefined
  const key = SOURCE_LABELS[source]
  return key === undefined ? source : t(key)
}

const WIREFRAME_MODEL_HINTS = ['', 'qwen-image-3.0', 'wan2.2-t2i-plus']
const HIGH_FIDELITY_MODEL_HINTS = ['', 'qwen-image-3.0-pro']

function ProviderPage({ t, prefs, connection }: PanelProps) {
  const snap = prefs.getSnapshot()
  usePrefSync(prefs)
  const [testResult, setTestResult] = useState<string | null>(null)
  const [testing, setTesting] = useState(false)
  const [writeError, setWriteError] = useState('')
  // 凭据状态（configured/source/writable，永不含值）：写入/清除后刷新
  const [credential, setCredential] = useState<PanelCredential | undefined>()
  const [keyDraft, setKeyDraft] = useState('')
  const [keyBusy, setKeyBusy] = useState(false)
  const [keyNotice, setKeyNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)

  const refreshCredential = useCallback(async (): Promise<PanelCredential | undefined> => {
    try {
      const value = await callPanel<{ credential: PanelCredential }>(connection, 'overview')
      setCredential(value.credential)
      return value.credential
    } catch {
      setCredential(undefined)
      return undefined
    }
  }, [connection])

  useEffect(() => {
    void refreshCredential()
  }, [refreshCredential])

  /** 写入（覆盖）或清除存储中的密钥；成功后清空草稿并刷新状态。 */
  const applyKey = async (endpoint: 'credential/set' | 'credential/unset') => {
    setKeyBusy(true)
    setKeyNotice(null)
    try {
      const payload = endpoint === 'credential/set' ? { value: keyDraft } : {}
      const result = await callPanel<{ credential: PanelCredential }>(connection, endpoint, payload)
      setCredential(result.credential)
      setKeyDraft('')
      setKeyNotice({
        kind: 'ok',
        text:
          endpoint === 'credential/set'
            ? t('panel.credential.savedNotice')
            : t('panel.credential.clearedNotice'),
      })
    } catch (err) {
      setKeyNotice({ kind: 'error', text: err instanceof Error ? err.message : String(err) })
    } finally {
      setKeyBusy(false)
    }
  }

  const runTest = async () => {
    setTesting(true)
    setTestResult(null)
    try {
      // 宿主只回机器可判的 reason + 原始 detail，用户可见文案由本端按语言渲染
      const result = await callPanel<{
        ok: boolean
        reason?: string
        detail?: string
      }>(connection, 'test-connection')
      setTestResult(
        result.ok
          ? t('panel.test.ok')
          : result.reason === 'missing-key'
            ? t('panel.test.missingKey')
            : result.reason === 'invalid-key'
              ? t('panel.test.invalidKey')
              : t('panel.test.gatewayFail', { detail: result.detail ?? '' }),
      )
    } catch (err) {
      setTestResult(err instanceof Error ? err.message : String(err))
    } finally {
      setTesting(false)
    }
  }

  const sourceLabel = sourceLabelText(t, credential?.source)

  const credentialLine =
    credential === undefined
      ? t('panel.credential.checking')
      : credential.configured
        ? sourceLabel === undefined
          ? t('panel.credential.ready')
          : t('panel.credential.readyWithSource', { source: sourceLabel })
        : t('panel.credential.missing')

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {snap.mode === 'memory' || !snap.writable ? (
        <Notice>{t('panel.readonlyBanner')}</Notice>
      ) : null}
      {writeError !== '' && <Notice danger>{writeError}</Notice>}
      <Card>
        <strong>{t('panel.provider.title')}</strong>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <label
            style={{
              flex: '1 1 200px',
              border: '2px solid var(--dsw-border-strong, var(--dsw-border, #888))',
              borderRadius: 8,
              padding: '8px 10px',
              position: 'relative',
            }}
          >
            <input type="radio" name="ui-mockup-provider" checked readOnly />{' '}
            <strong>{t('panel.provider.dashscopeName')}</strong>
            <div style={{ fontSize: 11, opacity: 0.75, display: 'flex', alignItems: 'center' }}>
              <StatusDot ok={credential?.configured === true} />
              {credentialLine}
            </div>
          </label>
          <label
            aria-disabled
            style={{
              flex: '1 1 200px',
              border: '1px dashed var(--dsw-border, rgba(127,127,127,0.35))',
              borderRadius: 8,
              padding: '8px 10px',
              opacity: 0.45,
            }}
          >
            <input type="radio" name="ui-mockup-provider" disabled />{' '}
            {t('panel.provider.volcengineName')}
            <div style={{ fontSize: 11 }}>{t('panel.provider.comingSoon')}</div>
          </label>
        </div>
      </Card>

      <Card>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: 8,
          }}
        >
          <strong>{t('panel.credential.title')}</strong>
          <button type="button" onClick={() => void runTest()} disabled={testing}>
            {testing ? t('panel.testing') : t('panel.testConnection')}
          </button>
        </div>
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <StatusDot ok={credential?.configured === true} />
          {credentialLine}
        </div>
        {testResult !== null && <div style={{ opacity: 0.85 }}>{testResult}</div>}
        {/* 写入即覆盖、永不回显：草稿只在本地 state，回显的永远只有三个状态事实 */}
        {credential?.writable === true ? (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <input
              type="password"
              style={{ flex: '1 1 220px' }}
              value={keyDraft}
              autoComplete="off"
              placeholder={t('panel.credential.writePlaceholder')}
              onChange={(event) => setKeyDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && keyDraft.trim() !== '') void applyKey('credential/set')
              }}
            />
            <button
              type="button"
              disabled={keyBusy || keyDraft.trim() === ''}
              onClick={() => void applyKey('credential/set')}
            >
              {t('panel.credential.save')}
            </button>
            {credential.configured && (
              <button
                type="button"
                disabled={keyBusy}
                onClick={() => void applyKey('credential/unset')}
              >
                {t('panel.credential.clear')}
              </button>
            )}
          </div>
        ) : credential !== undefined && credential.configured ? (
          <Notice>{t('panel.credential.notWritable', { source: sourceLabel ?? '' })}</Notice>
        ) : null}
        {keyNotice !== null && (
          <div
            style={{
              color:
                keyNotice.kind === 'error'
                  ? 'var(--dsw-danger, #d0453c)'
                  : 'var(--dsw-success, #2e9e5b)',
            }}
          >
            {keyNotice.text}
          </div>
        )}
        <div
          style={{
            fontSize: 12,
            opacity: 0.85,
            display: 'flex',
            flexDirection: 'column',
            gap: 4,
            marginTop: 4,
          }}
        >
          <span style={{ fontWeight: 600 }}>{t('panel.credential.howTitle')}</span>
          <ol style={{ margin: 0, paddingLeft: 18, lineHeight: 1.7 }}>
            <li>{t('panel.credential.way1')}</li>
            <li>{t('panel.credential.way2')}</li>
            <li>{t('panel.credential.way3')}</li>
            <li>{t('panel.credential.way4')}</li>
          </ol>
        </div>
      </Card>

      <Card>
        <strong>{t('panel.models.title')}</strong>
        <FieldRow label={t('panel.models.wireframe')}>
          <datalist id="ui-mockup-wireframe-models">
            {WIREFRAME_MODEL_HINTS.map((m) => (
              <option key={m} value={m} />
            ))}
          </datalist>
          <input
            list="ui-mockup-wireframe-models"
            value={snap.value?.wireframeModel ?? ''}
            placeholder={t('panel.models.followDefault')}
            onChange={(event) =>
              void writePref(prefs, 'wireframeModel', event.target.value.trim(), setWriteError)
            }
          />
        </FieldRow>
        <FieldRow label={t('panel.models.highFidelity')}>
          <datalist id="ui-mockup-hf-models">
            {HIGH_FIDELITY_MODEL_HINTS.map((m) => (
              <option key={m} value={m} />
            ))}
          </datalist>
          <input
            list="ui-mockup-hf-models"
            value={snap.value?.highFidelityModel ?? ''}
            placeholder={t('panel.models.followDefault')}
            onChange={(event) =>
              void writePref(prefs, 'highFidelityModel', event.target.value.trim(), setWriteError)
            }
          />
        </FieldRow>
        <div style={{ fontSize: 11, opacity: 0.7 }}>
          {`${t('panel.models.hintPrefix')} ${[...WIREFRAME_MODEL_HINTS, ...HIGH_FIDELITY_MODEL_HINTS].filter(Boolean).join(', ')}`}
        </div>
      </Card>
    </div>
  )
}

/* ---------------- 生成偏好 ---------------- */

function PreferencesPage({ t, prefs }: Omit<PanelProps, 'connection'>) {
  const snap = prefs.getSnapshot()
  usePrefSync(prefs)
  const initial = useMemo(() => snap.value ?? PANEL_DEFAULTS, [snap.value])
  const [draft, setDraft] = useState<PanelPrefs>(initial)
  const [dirty, setDirty] = useState(false)
  const [savedAt, setSavedAt] = useState(0)
  const [error, setError] = useState('')

  useEffect(() => {
    // 外部值到达/变化且本地没有未保存修改时回填草稿；避免覆盖正在编辑的内容
    if (!dirty && snap.value !== undefined) setDraft(snap.value)
  }, [dirty, snap.value])

  const patch = (part: Partial<PanelPrefs>) => {
    setDraft((prev) => ({ ...prev, ...part }))
    setDirty(true)
  }

  const save = async () => {
    setError('')
    const dir = draft.outputDir.trim()
    if (dir === '' || dir.split('/').includes('..') || dir.startsWith('/')) {
      setError(t('panel.prefs.invalidDir'))
      return
    }
    try {
      await prefs.set('defaultFidelity', draft.defaultFidelity)
      await prefs.set('defaultPlatform', draft.defaultPlatform)
      await prefs.set('defaultCount', Math.min(4, Math.max(1, Math.round(draft.defaultCount))))
      await prefs.set('outputDir', dir)
      await prefs.set('pollTimeoutMinutes', Math.max(1, Math.round(draft.pollTimeoutMinutes)))
      await prefs.set('defaultSize', draft.defaultSize)
      setDirty(false)
      setSavedAt(Date.now())
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const resetDefaults = async () => {
    setError('')
    try {
      for (const field of [
        'defaultFidelity',
        'defaultPlatform',
        'defaultCount',
        'outputDir',
        'pollTimeoutMinutes',
        'defaultSize',
      ] as const) {
        await prefs.unset(field)
      }
      setDraft(PANEL_DEFAULTS)
      setDirty(false)
      setSavedAt(Date.now())
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const readonlyNote = snap.mode === 'memory' || !snap.writable

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {readonlyNote && <Notice>{t('panel.readonlyBanner')}</Notice>}
      {error !== '' && <Notice danger>{error}</Notice>}
      <Card>
        <FieldRow label={t('panel.prefs.fidelity')}>
          <Radio
            label={t('panel.prefs.fidelityWireframe')}
            checked={draft.defaultFidelity === 'wireframe'}
            onChange={() => patch({ defaultFidelity: 'wireframe' })}
            name="pref-fidelity"
            disabled={readonlyNote}
          />
          <Radio
            label={t('panel.prefs.fidelityHigh')}
            checked={draft.defaultFidelity === 'high-fidelity'}
            onChange={() => patch({ defaultFidelity: 'high-fidelity' })}
            name="pref-fidelity"
            disabled={readonlyNote}
          />
        </FieldRow>
        <FieldRow label={t('panel.prefs.platform')}>
          <Radio
            label="Web"
            checked={draft.defaultPlatform === 'web'}
            onChange={() => patch({ defaultPlatform: 'web' })}
            name="pref-platform"
            disabled={readonlyNote}
          />
          <Radio
            label="Mobile"
            checked={draft.defaultPlatform === 'mobile'}
            onChange={() => patch({ defaultPlatform: 'mobile' })}
            name="pref-platform"
            disabled={readonlyNote}
          />
        </FieldRow>
        <FieldRow label={t('panel.prefs.count')}>
          {[1, 2, 3, 4].map((n) => (
            <Radio
              key={n}
              label={String(n)}
              checked={draft.defaultCount === n}
              onChange={() => patch({ defaultCount: n })}
              name="pref-count"
              disabled={readonlyNote}
            />
          ))}
        </FieldRow>
        <FieldRow label={t('panel.prefs.outputDir')}>
          <input
            value={draft.outputDir}
            onChange={(event) => patch({ outputDir: event.target.value })}
            disabled={readonlyNote}
            spellCheck={false}
          />
        </FieldRow>
        <FieldRow label={t('panel.prefs.pollTimeout')}>
          <input
            type="number"
            min={1}
            max={60}
            value={draft.pollTimeoutMinutes}
            onChange={(event) => patch({ pollTimeoutMinutes: Number(event.target.value) })}
            disabled={readonlyNote}
          />
          <span style={{ opacity: 0.7 }}>{t('panel.prefs.minutes')}</span>
        </FieldRow>
        <FieldRow label={t('panel.prefs.backoff')}>
          <span style={{ opacity: 0.55 }}>{t('panel.prefs.backoffFixed')}</span>
        </FieldRow>
        <FieldRow label={t('panel.prefs.size')}>
          <select
            value={draft.defaultSize}
            onChange={(event) => patch({ defaultSize: event.target.value })}
            disabled={readonlyNote}
          >
            <option value="">{t('panel.models.followDefault')}</option>
            <option value="1024*1024">1024*1024</option>
            <option value="1280*720">1280*720</option>
            <option value="720*1280">720*1280</option>
          </select>
        </FieldRow>
      </Card>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <button type="button" onClick={() => void resetDefaults()} disabled={readonlyNote}>
          {t('panel.prefs.reset')}
        </button>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          {savedAt > 0 && !dirty && <span style={{ opacity: 0.7 }}>{t('panel.prefs.saved')}</span>}
          <button
            type="button"
            onClick={() => void save()}
            disabled={readonlyNote || !dirty}
            style={{ fontWeight: 600 }}
          >
            {t('panel.prefs.save')}
          </button>
        </div>
      </div>
    </div>
  )
}

/* ---------------- 生成历史 ---------------- */

interface HistoryRow extends Record<string, unknown> {
  time: string
  description: string
  files: string[]
  model?: string
  fidelity?: string
  platform?: string
  size?: string
  anchored: boolean
}

function HistoryPage({ t, connection }: Omit<PanelProps, 'prefs'>) {
  const cwd = useCurrentSessionCwd()
  const [rows, setRows] = useState<HistoryRow[]>()
  const [anchorFile, setAnchorFile] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [error, setError] = useState('')
  const [confirmingClear, setConfirmingClear] = useState(false)

  const reload = useCallback(
    async (needle: string) => {
      setError('')
      try {
        const data = await callPanel<{ anchorFile: string | null; entries: HistoryRow[] }>(
          connection,
          'history/list',
          { cwd, query: needle },
        )
        setRows(data.entries)
        setAnchorFile(data.anchorFile)
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      }
    },
    [connection, cwd],
  )

  useEffect(() => {
    void reload(query)
    // 列表仅在 cwd/连接变化(reload 标识)时自动重载；query 由回车显式触发, 故不列入依赖
  }, [reload])

  const act = async (endpoint: string, payload: Record<string, unknown>) => {
    try {
      await callPanel(connection, endpoint, payload)
      await reload(query)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  if (error !== '')
    return (
      <div style={{ color: 'var(--dsw-danger, #d0453c)' }}>{t('panel.loadFailed', { error })}</div>
    )
  if (rows === undefined) return <div>{t('panel.loading')}</div>

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', gap: 8 }}>
        <input
          style={{ flex: 1 }}
          placeholder={t('panel.history.searchPlaceholder')}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') void reload(query)
          }}
        />
        <button
          type="button"
          onClick={() =>
            confirmingClear
              ? void act('history/clear', { cwd }).finally(() => setConfirmingClear(false))
              : setConfirmingClear(true)
          }
          onBlur={() => setConfirmingClear(false)}
          style={
            confirmingClear
              ? {
                  borderColor: 'var(--dsw-danger, #d0453c)',
                  color: 'var(--dsw-danger, #d0453c)',
                  fontWeight: 600,
                }
              : undefined
          }
        >
          {confirmingClear ? t('panel.history.confirmClear') : t('panel.history.clear')}
        </button>
      </div>

      {rows.length === 0 && (
        <div style={{ opacity: 0.65, padding: '18px 0', textAlign: 'center' }}>
          {t('panel.history.empty')}
        </div>
      )}

      {rows.map((row, index) => {
        const first = row.files[0]
        const name = first === undefined ? '' : (first.split('/').pop() ?? '')
        return (
          <div
            key={`${row.time}:${index}`}
            style={{
              display: 'flex',
              gap: 10,
              border: row.anchored
                ? '2px solid var(--dsw-border-strong, var(--dsw-border, #888))'
                : '1px solid var(--dsw-border, rgba(127,127,127,0.35))',
              borderRadius: 8,
              padding: 8,
              position: 'relative',
              alignItems: 'center',
            }}
          >
            {row.anchored && (
              <span
                style={{
                  position: 'absolute',
                  top: -9,
                  right: 10,
                  background: 'var(--dsw-bg-subtle, rgba(127,127,127,0.15))',
                  border: '1px solid var(--dsw-border, #999)',
                  borderRadius: 4,
                  fontSize: 11,
                  padding: '1px 6px',
                }}
              >
                🚩 {t('panel.history.anchorTag')}
              </span>
            )}
            {name !== '' && (
              <img
                src={imageUrl(name, cwd)}
                alt={name}
                loading="lazy"
                width={56}
                height={56}
                style={{
                  borderRadius: 6,
                  border: '1px solid var(--dsw-border, #ccc)',
                  objectFit: 'cover',
                  background: 'var(--dsw-bg-subtle, #f5f5f5)',
                }}
              />
            )}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  fontWeight: row.anchored ? 600 : 400,
                }}
              >
                {row.description}
              </div>
              <div style={{ fontSize: 11, opacity: 0.65 }}>
                {formatTime(row.time)} · {row.model ?? '—'} · {row.size ?? '—'} ·{' '}
                {t('panel.history.fileCount', { n: row.files.length })}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {row.anchored ? (
                <button type="button" onClick={() => void act('anchor/unset', { cwd })}>
                  {t('panel.history.unsetAnchor')}
                </button>
              ) : (
                first !== undefined && (
                  <button type="button" onClick={() => void act('anchor/set', { cwd, file: name })}>
                    {t('panel.history.setAnchor')}
                  </button>
                )
              )}
              {name !== '' && (
                <a href={imageUrl(name, cwd)} target="_blank" rel="noreferrer">
                  <button type="button">{t('card.openOriginal')}</button>
                </a>
              )}
            </div>
          </div>
        )
      })}
      {anchorFile !== null && rows.some((r) => r.anchored) && (
        <div style={{ fontSize: 12, opacity: 0.75 }}>{t('panel.history.anchorHint')}</div>
      )}
    </div>
  )
}

function formatTime(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/* ---------------- 小部件与钩子 ---------------- */

function FieldRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
      <span style={{ minWidth: 96, opacity: 0.85 }}>{label}</span>
      {children}
    </label>
  )
}

function Radio(props: {
  label: string
  checked: boolean
  onChange: () => void
  name: string
  disabled?: boolean
}) {
  return (
    <>
      <input
        type="radio"
        name={props.name}
        checked={props.checked}
        disabled={props.disabled}
        onChange={props.onChange}
      />{' '}
      {props.label}
    </>
  )
}

function Notice({ children, danger }: { children: ReactNode; danger?: boolean }) {
  return (
    <div
      style={{
        border: `1px solid ${danger ? 'var(--dsw-danger, #d0453c)' : 'var(--dsw-border, rgba(127,127,127,0.35))'}`,
        borderRadius: 6,
        padding: '6px 10px',
        color: danger ? 'var(--dsw-danger, #d0453c)' : undefined,
      }}
    >
      {children}
    </div>
  )
}

/** 订阅偏好快照使面板随宿主文档变更刷新（写回后镜像更新 → re-render）。 */
function usePrefSync(prefs: PrefScope<PanelPrefs>): void {
  const [, bump] = useState(0)
  useEffect(() => prefs.subscribe(() => bump((n) => n + 1)), [prefs])
}

/** 单字段写入并显示错误。 */
async function writePref(
  prefs: PrefScope<PanelPrefs>,
  field: string,
  value: unknown,
  onError: (message: string) => void,
): Promise<void> {
  try {
    await prefs.set(field, value)
    onError('')
  } catch (err) {
    onError(err instanceof Error ? err.message : String(err))
  }
}
