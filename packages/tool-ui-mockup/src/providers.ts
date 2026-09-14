/**
 * 供应商元数据表：consumer 侧全部提供方专属事实的唯一数据源。
 * 面板卡片渲染、切换校验、补丁行合并、鉴权探测、凭据名映射、模型候选
 * 一律查本表；新增提供方只需在此追加条目（openai-compat 起生效）。
 * 本模块被宿主与客户端两个半区共用，不得 import 客户端模块（host 构建
 * 刻意排除 src/client）：nameKey 用本地字面量联合表达，其成员必须是
 * locales.ts 词条字典键——字面量联合对字典键联合天然可赋值，注册表新增
 * 字典缺失的键会在客户端所有用点即刻报编译错。
 */

/** 供应商本地化名称词条键（含未挂载回退键）；新增提供方时在此扩展。 */
export type ProviderNameKey =
  | 'panel.provider.dashscopeName'
  | 'panel.provider.volcengineName'
  | 'panel.provider.openaiCompatName'
  | 'panel.provider.unknown'

/** 面板模型分层候选（首项空串 = 「跟随提供方默认」占位，渲染时过滤）。 */
export interface ProviderModelHints {
  wireframe: string[]
  highFidelity: string[]
  draft: string[]
}

/** 元数据表条目。 */
export interface ProviderMeta {
  /** 与 image 服务契约的 providerId 同名。 */
  id: string
  /** 组合行中该 Provider 插件的 patch 行 id。 */
  patchId: string
  /** npm 包名（image 服务未挂载时的安装提示用）。 */
  packageName: string
  /** 凭据引用名（Provider config 的 apiKey 缺省时的回退）。 */
  credential: string
  /** 鉴权探测默认网关（Provider config 的 baseUrl 缺省时的回退）。 */
  probeBaseUrl: string
  /** 鉴权探测路径（向该路径发空体 POST，不消耗生成配额）。 */
  probePath: string
  /** 本地化显示名词条键（panel.provider.*）。 */
  nameKey: ProviderNameKey
  /** 面板三档模型候选。 */
  hints: ProviderModelHints
  /** bundle 预置默认禁用（未启用卡给「已安装未启用」解释文案）。 */
  presetDisabled: boolean
  /**
   * 卡片状态小行的渲染风格（历史原因两家不同步，先如实建模）：
   * status = 状态点行 + 选中时附凭据来源行；note = 浅色说明行、未启用时给解释文案。
   */
  cardNotes: 'status' | 'note'
  /** 风格锚点参考图（I2I）能力闸门：false = 该模型不允许注入参考图；缺省 = 不限。 */
  supportsReference?: (model: string | undefined) => boolean
  /** 锚点被跳过注入时的用户可操作提示（supportsReference 判定不支持时使用）。 */
  referenceSkipHint?: string
}

/** DashScope 当前可安全接收单参考图的模型族（千问系与万相 2.7）。 */
function supportsDashscopeReference(model: string): boolean {
  return model.startsWith('qwen-image') || model === 'wan2.7-image' || model === 'wan2.7-image-pro'
}

/** 安装面默认生效的提供方：端点不可达/服务未挂载时按它渲染与回退。 */
export const DEFAULT_PROVIDER_ID = 'dashscope'

/** 已注册供应商（顺序即面板卡片序与补丁行追加序）。 */
export const PROVIDER_REGISTRY: readonly ProviderMeta[] = [
  {
    id: 'dashscope',
    patchId: 'image-dashscope',
    packageName: '@mackwan84/dsh-image-dashscope',
    credential: 'DASHSCOPE_API_KEY',
    probeBaseUrl: 'https://dashscope.aliyuncs.com',
    probePath: '/api/v1/services/aigc/image-generation/generation',
    nameKey: 'panel.provider.dashscopeName',
    hints: {
      wireframe: ['', 'qwen-image-3.0', 'qwen-image-2.0', 'wan2.7-image'],
      highFidelity: ['', 'qwen-image-3.0-pro', 'qwen-image-2.0-pro', 'wan2.7-image-pro'],
      draft: ['', 'qwen-image-3.0', 'wan2.7-image'],
    },
    presetDisabled: false,
    cardNotes: 'status',
    // 模型为空串（交 Provider 自决）时仍允许注入：分层默认均支持参考图
    supportsReference: (model) => model === undefined || supportsDashscopeReference(model),
    referenceSkipHint: '请改用 qwen-image 或 wan2.7-image 系列',
  },
  {
    id: 'volcengine',
    patchId: 'image-volcengine',
    packageName: '@mackwan84/dsh-image-volcengine',
    credential: 'ARK_API_KEY',
    probeBaseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    probePath: '/images/generations',
    nameKey: 'panel.provider.volcengineName',
    hints: {
      wireframe: ['', 'doubao-seedream-4-5-251128', 'doubao-seedream-4-0-250828'],
      highFidelity: ['', 'doubao-seedream-5-0-pro-260628', 'doubao-seedream-5-0-260128'],
      draft: ['', 'doubao-seedream-4-5-251128'],
    },
    presetDisabled: true,
    cardNotes: 'note',
    // seedream 系原生支持 image 参考图，无白名单
  },
  {
    id: 'openai-compat',
    patchId: 'image-openai-compat',
    packageName: '@mackwan84/dsh-image-openai-compat',
    credential: 'OPENAI_COMPAT_API_KEY',
    // 私有网关无默认地址：探测 baseUrl 以生效配置为准，空值由宿主端点给明确 reason
    probeBaseUrl: '',
    probePath: '/images/generations',
    nameKey: 'panel.provider.openaiCompatName',
    // 静态候选来自实测网关的 gpt-image 系；设置面板另会拉取 /v1/models 动态建议
    hints: {
      wireframe: ['', 'gpt-image-2'],
      highFidelity: ['', 'gpt-image-2.5-flare', 'gpt-image-2.5-sunburst'],
      draft: ['', 'gpt-image-2'],
    },
    presetDisabled: true,
    cardNotes: 'note',
    // 最小公共子集不含参考图（I2I）：无论模型为何，风格锚点一律跳过注入
    supportsReference: () => false,
    referenceSkipHint: 'OpenAI 兼容最小子集不含参考图(I2I), 请解除风格锚点或换用支持参考图的提供方',
  },
]

/** 精确查找：未注册 id（含 unknown）返回 undefined。 */
export function providerOf(id: string): ProviderMeta | undefined {
  return PROVIDER_REGISTRY.find((meta) => meta.id === id)
}

/** image 服务未挂载 / 状态端点不可达时的面板渲染回退条目：
 *  凭据名随默认提供方（与 0.2.0 面板口径一致，元数据表测试锁定）；
 *  模型候选保留通用千问系。仅用于渲染，绝不进入补丁写入、探测或切换目标。 */
export const UNKNOWN_PROVIDER_FALLBACK: ProviderMeta = {
  id: 'unknown',
  patchId: 'image-unknown',
  packageName: '',
  credential: providerOf(DEFAULT_PROVIDER_ID)?.credential ?? '',
  probeBaseUrl: '',
  probePath: '',
  nameKey: 'panel.provider.unknown',
  hints: {
    wireframe: ['', 'qwen-image-3.0'],
    highFidelity: ['', 'qwen-image-3.0-pro'],
    draft: ['', 'qwen-image-3.0'],
  },
  presetDisabled: false,
  cardNotes: 'status',
}

/** 面板用的宽容查找：未注册 id 回退到渲染回退条目，永不返回 undefined。 */
export function providerMetaOf(id: string): ProviderMeta {
  return providerOf(id) ?? UNKNOWN_PROVIDER_FALLBACK
}

/**
 * 生成切换提供方后的用户层 patch 行：注册表驱动的 N 行单选
 * （目标行启用、其余禁用，行序与注册表一致）。
 * 用户层 applied after bundle layers——bundle 插入的行由此覆盖 enabled 状态，
 * 且只携带 id/disabled 两个字段，不触碰用户可能写在同 id 行上的其他定制；
 * 已有行原位更新（保留其余字段），缺失行追加在列表尾部。
 * 纯函数：宿主端点与单测共用同一合并语义；两家场景的输出与 0.2.0
 * 两行硬编码逐字节一致（provider-switch.spec 锁定）。
 */
export function mergeProviderSwitchRows(
  patches: readonly unknown[],
  target: string,
): Record<string, unknown>[] {
  const rows: Record<string, unknown>[] = PROVIDER_REGISTRY.map((meta) => ({
    id: meta.patchId,
    disabled: meta.id !== target,
  }))
  type Entry = Record<string, unknown>
  const merged: Entry[] = patches.filter(
    (entry): entry is Entry => entry !== null && typeof entry === 'object',
  )
  for (const row of rows) {
    const index = merged.findIndex((entry) => entry['id'] === row.id)
    if (index >= 0) merged[index] = { ...merged[index]!, disabled: row.disabled }
    else merged.push(row)
  }
  return merged
}
