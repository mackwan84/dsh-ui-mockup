/**
 * 「UI 草图」设置区块：单个 settings.section 挂四张子页（概览 / 提供方与模型 /
 * 生成偏好 / 生成历史），子页内切换与已确认线框一致。
 * 视觉完全使用 DSH 主题令牌（--dsw-*）与原生控件，浅/深色自适应；
 * 数据面：偏好经同名 settings 命名空间镜像读写，历史/锚点/测试连接走私有 RPC 频道。
 */
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react'
import {
  Button,
  IconCheckOutline16,
  IconEditOutline16,
  IconNewChatOutline16,
  Input,
  StateDot,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import {
  callPanel,
  imageUrl,
  HISTORY_PAGE_SIZE,
  anchorPageOf,
  type ConnectionFace,
  type PrefScope,
} from './shared.js'
import type { NS, UiMockupKey } from './locales.js'
import panelCss from './settings-panel.css?inline'

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
  const tabsId = useId()
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([])

  const selectTabFromKeyboard = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const nextIndex =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? SUBPAGES.length - 1
          : event.key === 'ArrowRight'
            ? (index + 1) % SUBPAGES.length
            : event.key === 'ArrowLeft'
              ? (index - 1 + SUBPAGES.length) % SUBPAGES.length
              : null
    if (nextIndex === null) return
    const nextPage = SUBPAGES[nextIndex]
    if (nextPage === undefined) return
    event.preventDefault()
    setPage(nextPage)
    tabRefs.current[nextIndex]?.focus()
  }

  const activeTabId = `${tabsId}-tab-${page}`
  const activePanelId = `${tabsId}-panel-${page}`
  return (
    <div className="ui-mockup-section" style={sectionStyle}>
      <style data-ui-mockup-styles>{panelCss}</style>
      {/* 子页切换：对齐原生 Plugins 设置区的 tab 范式（底边线 + active 下划线） */}
      <div role="tablist" aria-label={t('panel.nav')} className="ui-mockup-tabs" style={tabsStyle}>
        {SUBPAGES.map((key, index) => (
          <button
            key={key}
            id={`${tabsId}-tab-${key}`}
            ref={(element) => {
              tabRefs.current[index] = element
            }}
            type="button"
            role="tab"
            className="ui-mockup-tab"
            aria-selected={page === key}
            aria-controls={`${tabsId}-panel-${key}`}
            tabIndex={page === key ? 0 : -1}
            data-active={page === key}
            onClick={() => setPage(key)}
            onKeyDown={(event) => selectTabFromKeyboard(event, index)}
            style={page === key ? { ...tabStyle, ...tabActiveStyle } : tabStyle}
          >
            {t(TAB_KEYS[key])}
          </button>
        ))}
      </div>
      <div
        id={activePanelId}
        role="tabpanel"
        aria-labelledby={activeTabId}
        className="ui-mockup-tabpanel"
        tabIndex={0}
      >
        {page === 'overview' && <OverviewPage t={t} connection={connection} />}
        {page === 'provider' && <ProviderPage t={t} prefs={prefs} connection={connection} />}
        {page === 'preferences' && <PreferencesPage t={t} prefs={prefs} />}
        {page === 'history' && <HistoryPage t={t} connection={connection} />}
      </div>
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
      className="ui-mockup-card"
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
 * 无障碍：用 role=group + aria-labelledby 而非 <label> 包裹——单个 label 只能
 * 隐式关联一个可标记元素，多 radio 场景下其余选项会失去标签关联。
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
  const labelId = useId()
  return (
    <div
      role="group"
      aria-labelledby={labelId}
      className="ui-mockup-field-row"
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
        id={labelId}
        className="ui-mockup-field-label"
        style={{ fontSize: 13, lineHeight: '20px', color: tokens.labelSecondary }}
      >
        {label}
      </span>
      {children}
    </div>
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
  {
    Icon: IconNewChatOutline16,
    title: 'panel.overview.step1Title',
    body: 'panel.overview.step1Body',
  },
  { Icon: IconEditOutline16, title: 'panel.overview.step2Title', body: 'panel.overview.step2Body' },
  {
    Icon: IconCheckOutline16,
    title: 'panel.overview.step3Title',
    body: 'panel.overview.step3Body',
  },
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
    <div
      className="ui-mockup-overview"
      style={{ display: 'flex', flexDirection: 'column', gap: 12 }}
    >
      <p style={{ margin: 0, fontSize: 13, lineHeight: '20px', color: tokens.labelTertiary }}>
        {t('panel.overview.intro')}
      </p>
      <Card title={t('panel.overview.quickTitle')}>
        {QUICK_STEPS.map(({ Icon, title, body }) => (
          <div key={title} className="ui-mockup-quick-step" style={{ display: 'flex', gap: 8 }}>
            <span aria-hidden style={{ flex: 'none', color: tokens.labelSecondary, marginTop: 2 }}>
              <Icon size={16} />
            </span>
            <p style={{ margin: 0, lineHeight: '20px' }}>
              <strong style={{ fontSize: 13 }}>{t(title)}</strong>
              <br />
              <span style={{ fontSize: 13, color: tokens.labelSecondary }}>{t(body)}</span>
            </p>
          </div>
        ))}
      </Card>
      <div
        className="ui-mockup-overview-status"
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
          // 生效提供方由宿主端点给出；unknown（未挂载 image 服务）单独措辞
          provider:
            data.provider === 'volcengine' || data.provider === 'dashscope'
              ? t(PROVIDER_NAME_KEYS[data.provider])
              : t('panel.provider.unknown'),
          credential: data.credential.configured
            ? t('panel.credential.ready')
            : t('panel.credential.missing', {
                credential:
                  data.provider === 'volcengine'
                    ? PROVIDER_CREDENTIALS.volcengine
                    : PROVIDER_CREDENTIALS.dashscope,
              }),
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

const WIREFRAME_MODEL_HINTS: Record<ProviderId, string[]> = {
  dashscope: ['', 'qwen-image-3.0', 'qwen-image-2.0', 'wan2.7-image'],
  volcengine: ['', 'doubao-seedream-4-5-251128', 'doubao-seedream-4-0-250828'],
  unknown: ['', 'qwen-image-3.0'],
}
const HIGH_FIDELITY_MODEL_HINTS: Record<ProviderId, string[]> = {
  dashscope: ['', 'qwen-image-3.0-pro', 'qwen-image-2.0-pro', 'wan2.7-image-pro'],
  volcengine: ['', 'doubao-seedream-5-0-pro-260628', 'doubao-seedream-5-0-260128'],
  unknown: ['', 'qwen-image-3.0-pro'],
}

/** 生效提供方 id（宿主 provider/status 端点返回；unknown = 未挂载 image 服务）。 */
type ProviderId = 'dashscope' | 'volcengine' | 'unknown'

/** 各提供方的凭据引用名（与 Provider Config 默认值一致）。 */
const PROVIDER_CREDENTIALS: Record<ProviderId, string> = {
  dashscope: 'DASHSCOPE_API_KEY',
  volcengine: 'ARK_API_KEY',
  unknown: 'DASHSCOPE_API_KEY',
}

/** 生效提供方 id → 本地化名称键；unknown 无名可显，调用方特判。 */
const PROVIDER_NAME_KEYS: Record<Exclude<ProviderId, 'unknown'>, UiMockupKey> = {
  dashscope: 'panel.provider.dashscopeName',
  volcengine: 'panel.provider.volcengineName',
}

function ProviderPage({ t, prefs, connection }: PanelProps) {
  const snap = prefs.getSnapshot()
  usePrefSync(prefs)
  const [testResult, setTestResult] = useState<string | null>(null)
  const [testing, setTesting] = useState(false)
  const [writeError, setWriteError] = useState('')
  // 生效提供方：provider/status 端点的唯一事实源，决定卡片选中态/凭据名/模型 hints
  const [providerId, setProviderId] = useState<ProviderId>('unknown')
  // 端点不可达（旧宿主/纯内存部署）时置位：面板按安装默认（DashScope）渲染并说明原因，
  // 而不是把"检测不到"误显示成"未启用"。
  const [statusUnknown, setStatusUnknown] = useState(true)
  // 切换请求进行中：期间两张卡禁点，完成后刷新状态
  const [switching, setSwitching] = useState(false)
  // 切换落位后的伴随提示（如模型分层默认被重置）
  const [providerNotice, setProviderNotice] = useState<string | null>(null)
  // 凭据状态（configured/source/writable，永不含值）：写入/清除后刷新
  const [credential, setCredential] = useState<PanelCredential | undefined>()
  const [keyDraft, setKeyDraft] = useState('')
  const [keyBusy, setKeyBusy] = useState(false)
  const [keyNotice, setKeyNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)

  const refreshProviderStatus = useCallback(async (): Promise<ProviderId> => {
    try {
      const value = await callPanel<{ active: ProviderId }>(connection, 'provider/status')
      setProviderId(value.active)
      setStatusUnknown(false)
      return value.active
    } catch {
      setProviderId('unknown')
      setStatusUnknown(true)
      return 'unknown'
    }
  }, [connection])

  useEffect(() => {
    void refreshProviderStatus()
  }, [refreshProviderStatus])

  const credentialName = PROVIDER_CREDENTIALS[providerId]

  /** 一键切换生效提供方：宿主改写 home 用户层 patch（DSH 热重载），完成后刷新状态。 */
  const switchProvider = async (target: Exclude<ProviderId, 'unknown'>) => {
    if (switching) return
    setSwitching(true)
    setProviderNotice(null)
    try {
      const result = await callPanel<{ active: ProviderId; pending?: boolean }>(
        connection,
        'provider/switch',
        { provider: target },
      )
      // 切换落位后重置模型分层默认：模型 ID 是提供方私有的，旧提供方的值
      // 残留会被当作显式 model 直传新网关而必败（INVALID_PARAMETER）。
      // best-effort：只读/内存态偏好写不进时不阻断切换，用户可手动改回。
      if (result.active === target && result.pending !== true) {
        const current = prefs.getSnapshot().value
        if (
          current !== undefined &&
          (current.wireframeModel !== '' || current.highFidelityModel !== '')
        ) {
          try {
            await prefs.set('wireframeModel', '')
            await prefs.set('highFidelityModel', '')
            setProviderNotice(t('panel.provider.modelsReset'))
          } catch {
            // 偏好不可写：切换本身已成功，重置跳过
          }
        }
      }
    } catch (err) {
      setTestResult(err instanceof Error ? err.message : String(err))
    } finally {
      // 热重载是异步落位（宿主端点内已等待到位），刷新拿到最终状态
      await refreshProviderStatus()
      await refreshCredential()
      setSwitching(false)
    }
  }

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
            : t('panel.credential.clearedNotice', { credential: credentialName }),
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
            ? t('panel.test.missingKey', { credential: credentialName })
            : result.reason === 'invalid-key'
              ? t('panel.test.invalidKey', { credential: credentialName })
              : result.reason === 'unknown'
                ? t('panel.test.unknown', { detail: result.detail ?? '' })
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
        : t('panel.credential.missing', { credential: credentialName })

  const credentialLine =
    credential === undefined
      ? t('panel.credential.checking')
      : credential.configured
        ? sourceLabel === undefined
          ? t('panel.credential.ready')
          : t('panel.credential.readyWithSource', { source: sourceLabel })
        : t('panel.credential.missing', { credential: credentialName })

  // unknown 有两种语义，渲染分流：
  // - statusUnknown（端点不可达，旧宿主等）：按安装默认把 DashScope 渲染为选中，
  //   并说明原因——"检测不到"不等于"未启用"；
  // - 端点可达但 active=unknown：image 服务确实未挂载，两卡都未选中。
  const statusReadable = !statusUnknown
  const dashscopeActive = providerId === 'dashscope' || (providerId === 'unknown' && statusUnknown)
  const volcengineActive = providerId === 'volcengine'
  /** 选中卡：中性蓝灰边框 + 浅灰填充（对齐 DSH 原生「外观」选项卡）；未选中：border-l2 实线。 */
  const providerCardStyle = (active: boolean) => ({
    flex: '1 1 200px',
    boxSizing: 'border-box' as const,
    border: active
      ? '1px solid var(--dsw-static-neutral-bluish-400)'
      : `1px solid ${tokens.border}`,
    borderRadius: 16,
    background: active ? 'var(--dsw-alias-bg-module-platform)' : 'transparent',
    padding: '10px 14px',
    cursor: 'default',
  })
  const providerMetaStyle = {
    marginTop: 4,
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 2,
  }
  const providerStatusStyle = {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    fontSize: 12,
    lineHeight: '17px',
    color: tokens.labelSecondary,
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {snap.mode === 'memory' || !snap.writable ? (
        <Notice>{t('panel.readonlyBanner')}</Notice>
      ) : null}
      {writeError !== '' && <Notice danger>{writeError}</Notice>}

      <Card title={t('panel.provider.title')}>
        {/* 提供方卡可点击切换：宿主端点改写 home 用户层 patch（DSH 热重载即时生效），
            面板不直接写 bundle 层——组合行仍是唯一事实源，这里只是代写它。 */}
        {statusUnknown && <Notice>{t('panel.provider.unknownHint')}</Notice>}
        {providerNotice !== null && <Notice>{providerNotice}</Notice>}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <label
            className="ui-mockup-provider-card"
            style={{
              ...providerCardStyle(dashscopeActive),
              cursor: dashscopeActive || switching ? 'default' : 'pointer',
            }}
            onClick={() => {
              if (!dashscopeActive) void switchProvider('dashscope')
            }}
          >
            <input
              type="radio"
              name="ui-mockup-provider"
              checked={dashscopeActive}
              disabled={switching}
              readOnly
              aria-label={t('panel.provider.dashscopeName')}
            />{' '}
            <strong style={{ fontSize: 13 }}>{t('panel.provider.dashscopeName')}</strong>
            <div style={providerMetaStyle}>
              {dashscopeActive ? (
                <>
                  <div style={providerStatusStyle}>
                    <StatusDot ok={credential?.configured === true} busy={switching} />
                    {statusUnknown && providerId === 'unknown'
                      ? t('panel.provider.fallbackActive')
                      : credentialStatus}
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
                </>
              ) : (
                <div style={providerStatusStyle}>
                  <StatusDot ok={false} busy={switching} />
                  {t('panel.provider.inactive')}
                </div>
              )}
            </div>
          </label>
          <label
            className="ui-mockup-provider-card"
            style={{
              ...providerCardStyle(volcengineActive),
              cursor: volcengineActive || switching ? 'default' : 'pointer',
            }}
            onClick={() => {
              if (!volcengineActive) void switchProvider('volcengine')
            }}
          >
            <input
              type="radio"
              name="ui-mockup-provider"
              checked={volcengineActive}
              disabled={switching}
              readOnly
              aria-label={t('panel.provider.volcengineName')}
            />{' '}
            <strong style={{ fontSize: 13 }}>{t('panel.provider.volcengineName')}</strong>
            <div style={providerMetaStyle}>
              {volcengineActive ? (
                <div style={providerStatusStyle}>
                  <StatusDot ok={credential?.configured === true} busy={switching} />
                  {credentialStatus}
                </div>
              ) : (
                <div
                  style={{
                    fontSize: 12,
                    lineHeight: '17px',
                    color: tokens.labelTertiary,
                  }}
                >
                  {statusReadable
                    ? t('panel.provider.volcengineDisabled')
                    : t('panel.provider.inactive')}
                </div>
              )}
            </div>
          </label>
        </div>
      </Card>

      <Card title={t('panel.credential.title', { credential: credentialName })}>
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
              aria-label={t('panel.credential.keyInputLabel', { credential: credentialName })}
              style={{ flex: '1 1 220px' }}
              value={keyDraft}
              autoComplete="off"
              placeholder={t('panel.credential.writePlaceholder', { credential: credentialName })}
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
            <li>{t('panel.credential.way1', { credential: credentialName })}</li>
            <li>{t('panel.credential.way2')}</li>
            <li>{t('panel.credential.way3', { credential: credentialName })}</li>
            <li>{t('panel.credential.way4', { credential: credentialName })}</li>
          </ol>
        </div>
      </Card>

      <Card title={t('panel.models.title')}>
        <FieldRow first label={t('panel.models.wireframe')}>
          <select
            aria-label={t('panel.models.wireframe')}
            className="ui-mockup-model-select"
            value={snap.value?.wireframeModel ?? ''}
            onChange={(event) =>
              void writePref(prefs, 'wireframeModel', event.target.value.trim(), setWriteError)
            }
            style={{ ...selectStyle, width: 'min(260px, 100%)' }}
          >
            <option value="">{t('panel.models.followDefault')}</option>
            {WIREFRAME_MODEL_HINTS[providerId].filter(Boolean).map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </FieldRow>
        <FieldRow label={t('panel.models.highFidelity')}>
          <select
            aria-label={t('panel.models.highFidelity')}
            className="ui-mockup-model-select"
            value={snap.value?.highFidelityModel ?? ''}
            onChange={(event) =>
              void writePref(prefs, 'highFidelityModel', event.target.value.trim(), setWriteError)
            }
            style={{ ...selectStyle, width: 'min(260px, 100%)' }}
          >
            <option value="">{t('panel.models.followDefault')}</option>
            {HIGH_FIDELITY_MODEL_HINTS[providerId].filter(Boolean).map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </FieldRow>
        <Notice>
          {`${t('panel.models.wireframe')}: ${WIREFRAME_MODEL_HINTS[providerId].filter(Boolean).join(', ')} · ${t('panel.models.highFidelity')}: ${HIGH_FIDELITY_MODEL_HINTS[providerId].filter(Boolean).join(', ')}`}
        </Notice>
      </Card>
    </div>
  )
}

/* ---------------- 生成偏好 ---------------- */

const EDITABLE_PREF_FIELDS = [
  'defaultFidelity',
  'defaultPlatform',
  'defaultCount',
  'pollTimeoutMinutes',
  'defaultSize',
] as const

/** 只比较本页可编辑字段；Provider 模型偏好不应影响本页保存按钮。 */
function editablePrefsEqual(left: PanelPrefs, right: PanelPrefs): boolean {
  return (
    left.defaultFidelity === right.defaultFidelity &&
    left.defaultPlatform === right.defaultPlatform &&
    left.defaultCount === right.defaultCount &&
    left.pollTimeoutMinutes === right.pollTimeoutMinutes &&
    left.defaultSize === right.defaultSize
  )
}

/** unset 成功以用户层字段消失为准；resolved value 可以来自自定义 composition base。 */
function editableUserOverridesCleared(user: unknown): boolean {
  if (user === undefined) return true
  if (typeof user !== 'object' || user === null || Array.isArray(user)) return false
  return EDITABLE_PREF_FIELDS.every((field) => !Object.prototype.hasOwnProperty.call(user, field))
}

function PreferencesPage({ t, prefs }: Omit<PanelProps, 'connection'>) {
  const snap = prefs.getSnapshot()
  usePrefSync(prefs)
  const initial = useMemo(() => snap.value ?? PANEL_DEFAULTS, [snap.value])
  const [draft, setDraft] = useState<PanelPrefs>(initial)
  const [baseline, setBaseline] = useState<PanelPrefs>(initial)
  const [savedAt, setSavedAt] = useState(0)
  const [error, setError] = useState('')
  const [mutating, setMutating] = useState(false)
  const mutationLock = useRef(false)
  const dirty = !editablePrefsEqual(draft, baseline)

  useEffect(() => {
    // 外部值到达/变化且本地没有未保存修改时回填草稿；避免覆盖正在编辑的内容
    if (!dirty && !mutating && snap.value !== undefined) {
      setDraft(snap.value)
      setBaseline(snap.value)
    }
  }, [dirty, mutating, snap.value])

  const patch = (part: Partial<PanelPrefs>) => {
    if (mutationLock.current) return
    setDraft((prev) => ({ ...prev, ...part }))
  }

  const beginMutation = (): boolean => {
    if (mutationLock.current) return false
    mutationLock.current = true
    setMutating(true)
    setSavedAt(0)
    setError('')
    return true
  }

  const endMutation = () => {
    mutationLock.current = false
    setMutating(false)
  }

  const confirmApplied = (expected: PanelPrefs): PanelPrefs => {
    const actual = prefs.getSnapshot().value
    if (actual === undefined || !editablePrefsEqual(actual, expected)) {
      throw new Error(t('panel.prefs.writeNotApplied'))
    }
    return actual
  }

  const confirmResetApplied = (): PanelPrefs => {
    const current = prefs.getSnapshot()
    if (current.value === undefined || !editableUserOverridesCleared(current.user)) {
      throw new Error(t('panel.prefs.writeNotApplied'))
    }
    return current.value
  }

  const save = async () => {
    if (!beginMutation()) return
    try {
      const saved = {
        ...draft,
        defaultCount: Math.min(4, Math.max(1, Math.round(draft.defaultCount))),
        pollTimeoutMinutes: Math.max(1, Math.round(draft.pollTimeoutMinutes)),
      }
      await prefs.set('defaultFidelity', saved.defaultFidelity)
      await prefs.set('defaultPlatform', saved.defaultPlatform)
      await prefs.set('defaultCount', saved.defaultCount)
      await prefs.set('pollTimeoutMinutes', saved.pollTimeoutMinutes)
      await prefs.set('defaultSize', saved.defaultSize)
      const applied = confirmApplied(saved)
      setDraft(applied)
      setBaseline(applied)
      setSavedAt(Date.now())
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      endMutation()
    }
  }

  const resetDefaults = async () => {
    if (!beginMutation()) return
    try {
      for (const field of EDITABLE_PREF_FIELDS) {
        await prefs.unset(field)
      }
      const applied = confirmResetApplied()
      setDraft(applied)
      setBaseline(applied)
      setSavedAt(Date.now())
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      endMutation()
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
            disabled={readonlyNote || mutating}
          />
          <Radio
            label={t('panel.prefs.fidelityHigh')}
            checked={draft.defaultFidelity === 'high-fidelity'}
            onChange={() => patch({ defaultFidelity: 'high-fidelity' })}
            name="pref-fidelity"
            disabled={readonlyNote || mutating}
          />
        </FieldRow>
        <FieldRow label={t('panel.prefs.platform')}>
          <Radio
            label="Web"
            checked={draft.defaultPlatform === 'web'}
            onChange={() => patch({ defaultPlatform: 'web' })}
            name="pref-platform"
            disabled={readonlyNote || mutating}
          />
          <Radio
            label="Mobile"
            checked={draft.defaultPlatform === 'mobile'}
            onChange={() => patch({ defaultPlatform: 'mobile' })}
            name="pref-platform"
            disabled={readonlyNote || mutating}
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
              disabled={readonlyNote || mutating}
            />
          ))}
        </FieldRow>
        {/* 输出目录已由设计资产库接管($DSH_HOME/mockups/<工作区>/images)，不再可配 */}
        <FieldRow label={t('panel.prefs.pollTimeout')}>
          <Input
            type="number"
            aria-label={t('panel.prefs.pollTimeout')}
            min={1}
            max={60}
            style={{ width: 100 }}
            value={draft.pollTimeoutMinutes}
            onChange={(event) => patch({ pollTimeoutMinutes: Number(event.target.value) })}
            disabled={readonlyNote || mutating}
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
            aria-label={t('panel.prefs.size')}
            value={draft.defaultSize}
            onChange={(event) => patch({ defaultSize: event.target.value })}
            disabled={readonlyNote || mutating}
            style={selectStyle}
          >
            <option value="">{t('panel.models.followDefault')}</option>
            <option value="1024*1024">1024*1024</option>
            <option value="1280*720">1280*720</option>
            <option value="720*1280">720*1280</option>
          </select>
        </FieldRow>
      </Card>
      <div
        className="ui-mockup-preferences-footer"
        style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
      >
        <Button
          variant="ghost"
          size="sm"
          onClick={() => void resetDefaults()}
          disabled={readonlyNote || mutating}
        >
          {t('panel.prefs.reset')}
        </Button>
        <div
          className="ui-mockup-preferences-actions"
          style={{ display: 'flex', gap: 10, alignItems: 'center' }}
        >
          {savedAt > 0 && !dirty && (
            <span
              role="status"
              aria-live="polite"
              style={{ fontSize: 12, color: tokens.labelTertiary }}
            >
              {t('panel.prefs.saved')}
            </span>
          )}
          <Button
            variant="primary"
            size="sm"
            onClick={() => void save()}
            disabled={readonlyNote || mutating || !dirty}
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
  const [anchorIndex, setAnchorIndex] = useState(-1)
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [queryDraft, setQueryDraft] = useState('')
  const [appliedQuery, setAppliedQuery] = useState('')
  const [error, setError] = useState('')
  const [confirmingClear, setConfirmingClear] = useState(false)
  // 并发防护：连续翻页/搜索时多个 history/list 在飞，单调序号丢弃过期响应，
  // 避免晚到的旧响应覆盖新页码（页码高亮与内容错位）
  const requestSeq = useRef(0)

  // 服务端分页：宿主按 page/pageSize 切片返回当前页 + total + 锚点索引；
  // 页码越界由宿主钳制后回传 data.page，客户端直接采用，无需本地 clamp。
  const reload = useCallback(
    async (needle: string, targetPage: number) => {
      const seq = ++requestSeq.current
      setError('')
      try {
        const data = await callPanel<{
          anchorFile: string | null
          anchorIndex: number
          total: number
          page: number
          pageSize: number
          entries: HistoryRow[]
        }>(connection, 'history/list', {
          cwd,
          query: needle,
          page: targetPage,
          pageSize: HISTORY_PAGE_SIZE,
        })
        if (seq !== requestSeq.current) return
        setRows(data.entries)
        setAnchorFile(data.anchorFile)
        setAnchorIndex(data.anchorIndex)
        setTotal(data.total)
        setPage(data.page)
      } catch (err) {
        if (seq !== requestSeq.current) return
        setError(err instanceof Error ? err.message : String(err))
      }
    },
    [connection, cwd],
  )

  useEffect(() => {
    void reload('', 1)
    // 列表仅在 cwd/连接变化(reload 标识)时自动重载；搜索/翻页由交互显式触发。
  }, [reload])

  const submitSearch = () => {
    setAppliedQuery(queryDraft)
    void reload(queryDraft, 1)
  }

  const totalPages = Math.max(1, Math.ceil(total / HISTORY_PAGE_SIZE))
  const anchorPage = anchorPageOf(anchorIndex, HISTORY_PAGE_SIZE)

  const act = async (endpoint: string, payload: Record<string, unknown>, stayPage = page) => {
    try {
      await callPanel(connection, endpoint, payload)
      await reload(appliedQuery, stayPage)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  if (error !== '') return <Notice danger>{t('panel.loadFailed', { error })}</Notice>
  if (rows === undefined)
    return <div style={{ color: tokens.labelTertiary }}>{t('panel.loading')}</div>

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div
        role="search"
        aria-label={t('panel.history.searchLabel')}
        className="ui-mockup-history-toolbar"
        style={{ display: 'flex', gap: 8 }}
      >
        <Input
          type="search"
          aria-label={t('panel.history.searchLabel')}
          className="ui-mockup-history-search"
          style={{ flex: 1 }}
          placeholder={t('panel.history.searchPlaceholder')}
          value={queryDraft}
          onChange={(event) => setQueryDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter') return
            event.preventDefault()
            submitSearch()
          }}
        />
        <Button variant="outline" size="sm" onClick={submitSearch}>
          {t('panel.history.search')}
        </Button>
        {/* 两段确认拆为确认/取消双按钮：同按钮 onBlur 重置会让键盘用户
            Tab 离开时意外丢失确认态，双按钮语义明确且无障碍友好 */}
        {confirmingClear ? (
          <>
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                void act('history/clear', { cwd }, 1).finally(() => setConfirmingClear(false))
              }
              style={{ color: tokens.labelError, borderColor: tokens.labelError }}
            >
              {t('panel.history.confirmClear')}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setConfirmingClear(false)}>
              {t('panel.history.cancelClear')}
            </Button>
          </>
        ) : (
          <Button variant="ghost" size="sm" onClick={() => setConfirmingClear(true)}>
            {t('panel.history.clear')}
          </Button>
        )}
      </div>
      {queryDraft !== appliedQuery && (
        <span
          role="status"
          aria-live="polite"
          style={{ fontSize: 12, lineHeight: '17px', color: tokens.labelTertiary }}
        >
          {t('panel.history.pendingSearch')}
        </span>
      )}

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
          /* 已确认线框：横向卡片行；锚点行整行边框加粗 + 右上角旗标徽标。
             key 用 time+首图文件名：同秒多条 / 翻页过滤后 index 会错位，不能作 key */
          <div
            key={`${row.time}:${row.files[0] ?? index}`}
            className="ui-mockup-history-row"
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
            <div
              className="ui-mockup-history-summary"
              style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}
            >
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
            <div
              className="ui-mockup-history-actions"
              style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}
            >
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
      {anchorPage !== null && anchorPage !== page && (
        <div
          className="ui-mockup-history-anchor-nav"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            fontSize: 12,
            lineHeight: '17px',
            color: tokens.labelSecondary,
          }}
        >
          <span>🚩 {t('panel.history.anchorOnPage', { n: anchorPage })}</span>
          <Button variant="ghost" size="sm" onClick={() => void reload(appliedQuery, anchorPage)}>
            {t('panel.history.goToAnchor')}
          </Button>
        </div>
      )}

      {totalPages > 1 && (
        <div
          className="ui-mockup-history-pagination"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 8,
            flexWrap: 'wrap',
          }}
        >
          <span style={{ fontSize: 12, color: tokens.labelTertiary }}>
            {t('panel.history.totalCount', { n: total })}
          </span>
          <div
            className="ui-mockup-history-pages"
            style={{ display: 'flex', alignItems: 'center', gap: 4 }}
          >
            <Button
              variant="ghost"
              size="sm"
              disabled={page <= 1}
              onClick={() => void reload(appliedQuery, page - 1)}
            >
              {t('panel.history.prev')}
            </Button>
            {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
              <Button
                key={p}
                variant={p === page ? 'primary' : 'ghost'}
                size="sm"
                className="ui-mockup-history-page-number"
                onClick={() => void reload(appliedQuery, p)}
              >
                {p}
              </Button>
            ))}
            <Button
              variant="ghost"
              size="sm"
              disabled={page >= totalPages}
              onClick={() => void reload(appliedQuery, page + 1)}
            >
              {t('panel.history.next')}
            </Button>
          </div>
        </div>
      )}

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
  // 每个选项自带 label 包裹 input：点中文本即选中，屏幕阅读器可正确播报选项标签
  return (
    <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      <input
        type="radio"
        name={props.name}
        checked={props.checked}
        disabled={props.disabled}
        onChange={props.onChange}
      />
      {props.label}
    </label>
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
