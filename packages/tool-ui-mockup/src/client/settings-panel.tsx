/**
 * 「UI 草图」设置区块：单个 settings.section 挂四张子页（概览 / 提供方与模型 /
 * 生成偏好 / 生成历史），子页内切换与已确认线框一致。
 * 视觉完全使用 DSH 主题令牌（--dsw-*）与原生控件，浅/深色自适应；
 * 数据面：偏好经同名 settings 命名空间镜像读写，历史/锚点/测试连接走私有 RPC 频道。
 */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Button, Input, StateDot } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { callPanel, imageUrl, type ConnectionFace, type PrefScope } from './shared.js'
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
    <div style={sectionStyle}>
      {/* 子页切换：对齐原生 Plugins 设置区的 tab 范式（底边线 + active 下划线） */}
      <div role="tablist" style={tabsStyle}>
        {SUBPAGES.map((key) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={page === key}
            data-active={page === key}
            onClick={() => setPage(key)}
            style={page === key ? { ...tabStyle, ...tabActiveStyle } : tabStyle}
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

/* ---------------- 原生令牌与共享原子 ---------------- */

/**
 * DSH 真实主题令牌（--dsw-alias-*，与 ui-theme / ui-settings-plugins 的
 * module.css 同名同用途）与原生设置区实测尺寸。布局仍用内联样式，但取值
 * 逐项对齐 fields.module.css / PluginsSettingsSection.module.css，不再自造。
 */
const tokens = {
  labelPrimary: 'var(--dsw-alias-label-primary)',
  labelSecondary: 'var(--dsw-alias-label-secondary)',
  labelTertiary: 'var(--dsw-alias-label-tertiary)',
  labelError: 'var(--dsw-alias-label-error)',
  border: 'var(--dsw-alias-border-l2)',
  bgLayer: 'var(--dsw-alias-bg-layer-3)',
  brand: 'var(--dsw-alias-brand-primary)',
} as const

/** 面板根容器：与原生设置 section 同宽（max-width 760px）。 */
const sectionStyle = {
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
  maxWidth: 760,
  width: '100%',
  color: tokens.labelPrimary,
} as const

const tabsStyle = {
  display: 'flex',
  alignItems: 'flex-end',
  gap: 22,
  borderBottom: `1px solid ${tokens.border}`,
  marginTop: 2,
} as const

const tabStyle = {
  position: 'relative' as const,
  border: 0,
  padding: '7px 1px 9px',
  background: 'transparent',
  color: tokens.labelTertiary,
  font: 'inherit',
  fontSize: 13,
  lineHeight: '20px',
  cursor: 'pointer',
}

const tabActiveStyle = {
  color: tokens.labelPrimary,
} as const

/** select 与原生 .input 同款（34px 高 / 8px 圆角 / layer-3 背景 / focus 品牌色边框）。 */
const selectStyle = {
  height: 34,
  padding: '0 12px',
  border: `1px solid ${tokens.border}`,
  borderRadius: 8,
  background: tokens.bgLayer,
  font: 'inherit',
  fontSize: 13,
  lineHeight: '20px',
  color: tokens.labelPrimary,
} as const

/** 状态点：直接复用原语 StateDot（done 绿 / warning 琥珀），观感与会话列表一致。 */
function StatusDot({ ok, busy }: { ok: boolean; busy?: boolean }) {
  return <StateDot state={busy ? 'ongoing' : ok ? 'done' : 'warning'} className="ui-mockup-dot" />
}

/**
 * 卡片容器：恢复已确认线框的圆角卡片布局，视觉用真实令牌
 * （border-l2 边框 / 8px 圆角 / 标题 15px·600 对齐原生 heading 层级）。
 */
function Card({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        border: `1px solid ${tokens.border}`,
        borderRadius: 8,
        padding: '10px 12px',
      }}
    >
      {title !== undefined && (
        <span style={{ fontSize: 15, fontWeight: 600, lineHeight: '22px' }}>{title}</span>
      )}
      {children}
    </div>
  )
}

/**
 * 字段行：横排（label 左 96px，控件右）。为对齐原生 `.field + .field { border-top }`
 * 的表单节奏，相邻字段行之间画 1px 分隔线；卡片内首行由调用方传 `first` 免除。
 * 内容区统一 min-height 34（控件基准高）并垂直居中，使 radio / 输入框 / 纯文字行
 * 各行等高、底边齐平，分隔线间距一致。
 */
function FieldRow({
  label,
  children,
  first = false,
}: {
  label: string
  children: ReactNode
  first?: boolean
}) {
  return (
    <label
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        flexWrap: 'wrap',
        minHeight: 34,
        paddingTop: 10,
        ...(first ? {} : { borderTop: `1px solid ${tokens.border}` }),
      }}
    >
      <span
        style={{ minWidth: 96, fontSize: 13, lineHeight: '20px', color: tokens.labelSecondary }}
      >
        {label}
      </span>
      {children}
    </label>
  )
}

/** 提示行：对齐原生 hint（12px tertiary）/ invalid（12px error），不带边框。 */
function Notice({ children, danger }: { children: ReactNode; danger?: boolean }) {
  return (
    <p
      style={{
        margin: 0,
        fontSize: 12,
        lineHeight: '20px',
        color: danger ? tokens.labelError : tokens.labelTertiary,
      }}
    >
      {children}
    </p>
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

  if (error !== '') return <Notice danger>{t('panel.loadFailed', { error })}</Notice>
  if (data === undefined)
    return <div style={{ color: tokens.labelTertiary }}>{t('panel.loading')}</div>

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <p style={{ margin: 0, fontSize: 13, lineHeight: '20px', color: tokens.labelTertiary }}>
        {t('panel.overview.intro')}
      </p>
      <Card title={t('panel.overview.quickTitle')}>
        {QUICK_STEPS.map((step) => (
          <div key={step.title} style={{ display: 'flex', gap: 8 }}>
            <span aria-hidden>{step.icon}</span>
            <p style={{ margin: 0, lineHeight: '20px' }}>
              <strong style={{ fontSize: 13 }}>{t(step.title)}</strong>
              <br />
              <span style={{ fontSize: 13, color: tokens.labelSecondary }}>{t(step.body)}</span>
            </p>
          </div>
        ))}
      </Card>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          fontSize: 13,
          lineHeight: '20px',
          color: tokens.labelSecondary,
        }}
      >
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

const WIREFRAME_MODEL_HINTS = ['', 'qwen-image-3.0', 'qwen-image-2.0', 'wan2.7-image']
const HIGH_FIDELITY_MODEL_HINTS = [
  '',
  'qwen-image-3.0-pro',
  'qwen-image-2.0-pro',
  'wan2.7-image-pro',
]

/**
 * 参考图（I2I）模式是 qwen-image 系端点的能力边界：wan 系模型 + 风格锚点
 * 组合会被 Provider 以 INVALID_PARAMETER 明确拒绝。当前默认模型命中时提示。
 */
function nonQwenModel(...models: Array<string | undefined>): string | undefined {
  return models.find(
    (model) => model !== undefined && model !== '' && !model.startsWith('qwen-image'),
  )
}

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

  /** 纯状态文本（不含来源），供提供方选中卡第一行使用；来源另起一行淡化展示。 */
  const credentialStatus =
    credential === undefined
      ? t('panel.credential.checking')
      : credential.configured
        ? t('panel.credential.ready')
        : t('panel.credential.missing')

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

      <Card title={t('panel.provider.title')}>
        {/* 已确认线框：两张横排单选卡片（选中态加粗边框，另一张置灰「即将支持」） */}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <label
            style={{
              flex: '1 1 200px',
              border: `2px solid ${tokens.brand}`,
              borderRadius: 8,
              padding: '8px 10px',
              cursor: 'default',
            }}
          >
            <input type="radio" name="ui-mockup-provider" checked readOnly />{' '}
            <strong style={{ fontSize: 13 }}>{t('panel.provider.dashscopeName')}</strong>
            <div
              style={{
                marginTop: 4,
                display: 'flex',
                flexDirection: 'column',
                gap: 2,
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  fontSize: 12,
                  lineHeight: '17px',
                  color: tokens.labelSecondary,
                }}
              >
                <StatusDot ok={credential?.configured === true} />
                {credentialStatus}
              </div>
              {credential?.configured && sourceLabel !== undefined && (
                <div
                  style={{
                    fontSize: 12,
                    lineHeight: '17px',
                    color: tokens.labelTertiary,
                    paddingLeft: 14,
                  }}
                >
                  {sourceLabel}
                </div>
              )}
            </div>
          </label>
          <label
            aria-disabled
            style={{
              flex: '1 1 200px',
              border: `1px dashed ${tokens.border}`,
              borderRadius: 8,
              padding: '8px 10px',
              opacity: 0.45,
            }}
          >
            <input type="radio" name="ui-mockup-provider" disabled />{' '}
            <span style={{ fontSize: 13 }}>{t('panel.provider.volcengineName')}</span>
            <div style={{ fontSize: 12, lineHeight: '17px', marginTop: 4 }}>
              {t('panel.provider.comingSoon')}
            </div>
          </label>
        </div>
      </Card>

      <Card title={t('panel.credential.title')}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              flex: 1,
              fontSize: 13,
              lineHeight: '20px',
              color: tokens.labelSecondary,
            }}
          >
            <StatusDot ok={credential?.configured === true} busy={testing} />
            {credentialLine}
          </span>
          <Button variant="outline" size="sm" onClick={() => void runTest()} disabled={testing}>
            {testing ? t('panel.testing') : t('panel.testConnection')}
          </Button>
        </div>
        {testResult !== null && <Notice>{testResult}</Notice>}
        {/* 写入即覆盖、永不回显：草稿只在本地 state，回显的永远只有三个状态事实 */}
        {credential?.writable === true ? (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <Input
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
            <Button
              variant="primary"
              size="sm"
              disabled={keyBusy || keyDraft.trim() === ''}
              onClick={() => void applyKey('credential/set')}
            >
              {t('panel.credential.save')}
            </Button>
            {credential.configured && (
              <Button
                variant="ghost"
                size="sm"
                disabled={keyBusy}
                onClick={() => void applyKey('credential/unset')}
              >
                {t('panel.credential.clear')}
              </Button>
            )}
          </div>
        ) : credential !== undefined && credential.configured ? (
          <Notice>{t('panel.credential.notWritable', { source: sourceLabel ?? '' })}</Notice>
        ) : null}
        {keyNotice !== null && (
          <Notice danger={keyNotice.kind === 'error'}>{keyNotice.text}</Notice>
        )}
        <div
          style={{
            fontSize: 12,
            lineHeight: '17px',
            color: tokens.labelTertiary,
            display: 'flex',
            flexDirection: 'column',
            gap: 2,
            marginTop: 2,
          }}
        >
          <span style={{ fontWeight: 500, color: tokens.labelSecondary }}>
            {t('panel.credential.howTitle')}
          </span>
          <ol style={{ margin: 0, paddingLeft: 18 }}>
            <li>{t('panel.credential.way1')}</li>
            <li>{t('panel.credential.way2')}</li>
            <li>{t('panel.credential.way3')}</li>
            <li>{t('panel.credential.way4')}</li>
          </ol>
        </div>
      </Card>

      <Card title={t('panel.models.title')}>
        <FieldRow first label={t('panel.models.wireframe')}>
          <select
            value={snap.value?.wireframeModel ?? ''}
            onChange={(event) =>
              void writePref(prefs, 'wireframeModel', event.target.value.trim(), setWriteError)
            }
            style={{ ...selectStyle, width: 260 }}
          >
            <option value="">{t('panel.models.followDefault')}</option>
            {WIREFRAME_MODEL_HINTS.filter(Boolean).map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </FieldRow>
        <FieldRow label={t('panel.models.highFidelity')}>
          <select
            value={snap.value?.highFidelityModel ?? ''}
            onChange={(event) =>
              void writePref(prefs, 'highFidelityModel', event.target.value.trim(), setWriteError)
            }
            style={{ ...selectStyle, width: 260 }}
          >
            <option value="">{t('panel.models.followDefault')}</option>
            {HIGH_FIDELITY_MODEL_HINTS.filter(Boolean).map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </FieldRow>
        <Notice>
          {`${t('panel.models.wireframe')}: ${WIREFRAME_MODEL_HINTS.filter(Boolean).join(', ')} · ${t('panel.models.highFidelity')}: ${HIGH_FIDELITY_MODEL_HINTS.filter(Boolean).join(', ')}`}
        </Notice>
        {nonQwenModel(snap.value?.wireframeModel, snap.value?.highFidelityModel) !== undefined && (
          <Notice>{t('panel.models.nonQwenWarning')}</Notice>
        )}
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
    try {
      await prefs.set('defaultFidelity', draft.defaultFidelity)
      await prefs.set('defaultPlatform', draft.defaultPlatform)
      await prefs.set('defaultCount', Math.min(4, Math.max(1, Math.round(draft.defaultCount))))
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
        <FieldRow first label={t('panel.prefs.fidelity')}>
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
        {/* 输出目录已由设计资产库接管($DSH_HOME/mockups/<工作区>/images)，不再可配 */}
        <FieldRow label={t('panel.prefs.pollTimeout')}>
          <Input
            type="number"
            min={1}
            max={60}
            style={{ width: 100 }}
            value={draft.pollTimeoutMinutes}
            onChange={(event) => patch({ pollTimeoutMinutes: Number(event.target.value) })}
            disabled={readonlyNote}
          />
          <span style={{ fontSize: 12, color: tokens.labelTertiary }}>
            {t('panel.prefs.minutes')}
          </span>
        </FieldRow>
        <FieldRow label={t('panel.prefs.backoff')}>
          <span style={{ fontSize: 13, lineHeight: '20px', color: tokens.labelTertiary }}>
            {t('panel.prefs.backoffFixed')}
          </span>
        </FieldRow>
        <FieldRow label={t('panel.prefs.size')}>
          <select
            value={draft.defaultSize}
            onChange={(event) => patch({ defaultSize: event.target.value })}
            disabled={readonlyNote}
            style={selectStyle}
          >
            <option value="">{t('panel.models.followDefault')}</option>
            <option value="1024*1024">1024*1024</option>
            <option value="1280*720">1280*720</option>
            <option value="720*1280">720*1280</option>
          </select>
        </FieldRow>
      </Card>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => void resetDefaults()}
          disabled={readonlyNote}
        >
          {t('panel.prefs.reset')}
        </Button>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          {savedAt > 0 && !dirty && (
            <span style={{ fontSize: 12, color: tokens.labelTertiary }}>
              {t('panel.prefs.saved')}
            </span>
          )}
          <Button
            variant="primary"
            size="sm"
            onClick={() => void save()}
            disabled={readonlyNote || !dirty}
          >
            {t('panel.prefs.save')}
          </Button>
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
  // 客户端第三方插件拿不到会话服务（ctx.get('sessions') 恒 undefined），
  // 历史/缩略图/锚点请求一律不传 cwd，由宿主按「会话 cwd → 最近登记根 → 进程根」
  // 回退链解析工作区——这是已验证有效的唯一路径。
  const cwd: string | undefined = undefined
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

  if (error !== '') return <Notice danger>{t('panel.loadFailed', { error })}</Notice>
  if (rows === undefined)
    return <div style={{ color: tokens.labelTertiary }}>{t('panel.loading')}</div>

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', gap: 8 }}>
        <Input
          style={{ flex: 1 }}
          placeholder={t('panel.history.searchPlaceholder')}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') void reload(query)
          }}
        />
        <Button
          variant="ghost"
          size="sm"
          onClick={() =>
            confirmingClear
              ? void act('history/clear', { cwd }).finally(() => setConfirmingClear(false))
              : setConfirmingClear(true)
          }
          onBlur={() => setConfirmingClear(false)}
          style={
            confirmingClear
              ? { color: tokens.labelError, borderColor: tokens.labelError }
              : undefined
          }
        >
          {confirmingClear ? t('panel.history.confirmClear') : t('panel.history.clear')}
        </Button>
      </div>

      {rows.length === 0 && (
        <div
          style={{
            color: tokens.labelTertiary,
            fontSize: 13,
            lineHeight: '20px',
            padding: '18px 0',
            textAlign: 'center',
          }}
        >
          {t('panel.history.empty')}
        </div>
      )}

      {rows.map((row, index) => {
        const first = row.files[0]
        const name = first === undefined ? '' : (first.split('/').pop() ?? '')
        return (
          /* 已确认线框：横向卡片行；锚点行整行边框加粗 + 右上角旗标徽标 */
          <div
            key={`${row.time}:${index}`}
            style={{
              display: 'flex',
              gap: 10,
              alignItems: 'center',
              border: `${row.anchored ? 2 : 1}px solid ${tokens.border}`,
              borderRadius: 8,
              padding: 8,
              position: 'relative',
            }}
          >
            {row.anchored && (
              <span
                style={{
                  position: 'absolute',
                  top: -9,
                  right: 10,
                  background: 'var(--dsw-alias-bg-module-platform)',
                  borderRadius: 999,
                  fontSize: 11,
                  lineHeight: '17px',
                  padding: '1px 8px',
                  fontWeight: 500,
                  color: tokens.labelSecondary,
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
                  borderRadius: 8,
                  border: `1px solid ${tokens.border}`,
                  objectFit: 'cover',
                  background: tokens.bgLayer,
                  flexShrink: 0,
                }}
              />
            )}
            <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
              <div
                style={{
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  fontSize: 13,
                  lineHeight: '20px',
                  fontWeight: row.anchored ? 600 : 400,
                }}
              >
                {row.description}
              </div>
              <div style={{ fontSize: 12, lineHeight: '17px', color: tokens.labelTertiary }}>
                {formatTime(row.time)} · {row.model ?? '—'} · {row.size ?? '—'} ·{' '}
                {t('panel.history.fileCount', { n: row.files.length })}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {/* 设锚入口在对话卡片（点哪张设哪张）；历史页只保留解除与查看 */}
              {row.anchored && (
                <Button variant="ghost" size="sm" onClick={() => void act('anchor/unset', { cwd })}>
                  {t('panel.history.unsetAnchor')}
                </Button>
              )}
              {name !== '' && (
                <a href={imageUrl(name, cwd)} target="_blank" rel="noreferrer">
                  <Button variant="outline" size="sm">
                    {t('card.openOriginal')}
                  </Button>
                </a>
              )}
            </div>
          </div>
        )
      })}
      {anchorFile !== null && rows.some((r) => r.anchored) && (
        <Notice>{t('panel.history.anchorHint')}</Notice>
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
