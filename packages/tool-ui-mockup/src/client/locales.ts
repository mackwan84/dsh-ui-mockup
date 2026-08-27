/** ui_mockup 客户端 UI 文案（双语，跟随 DSH 语言切换）：工具卡片 + 设置面板。 */

export const NS = 'ui-mockup'

/** 简体中文 UI 文案。 */
export const zh = {
  // 工具卡片
  'card.generating': '生成中…',
  'card.confirm': '确认采用这版',
  'card.select': '选用第 {n} 版',
  'card.selectPlaceholder': '选用某一版…',
  'card.openOriginal': '打开原图',
  'card.feedback': '提交修改意见',
  'card.feedbackPlaceholder': '描述要修改的地方…',
  'card.feedbackSubmit': '提交并重新生成',
  'card.feedbackCancel': '取消',
  'card.confirmMessage': '确认采用这版设计（文件：{name}）',
  'card.selectMessage': '选用第 {n} 版（文件：{name}）',
  'card.feedbackMessage': '{opinion}（基于文件：{name}，请按此意见重新生成）',

  // 设置面板：通用
  'panel.nav': 'UI 草图',
  'panel.tab.overview': '概览',
  'panel.tab.provider': '提供方与模型',
  'panel.tab.preferences': '生成偏好',
  'panel.tab.history': '生成历史',
  'panel.loading': '加载中…',
  'panel.loadFailed': '加载失败: {error}',
  'panel.readonlyBanner': '当前连接的设置存储为进程内模式或只读，偏好修改不会持久保存。',
  'panel.testConnection': '测试连接',
  'panel.testing': '测试中…',

  // 概览页
  'panel.overview.intro':
    '在研讨阶段生成 UI 线框图 / 高保真设计稿：先看图确认方向，再写实现代码，避免做完才发现界面不符合预期。',
  'panel.overview.quickTitle': '快速使用',
  'panel.overview.step1Title': '何时触发',
  'panel.overview.step1Body': '需求研讨中助手会主动提议出草图，也可以直接说「出个草图」。',
  'panel.overview.step2Title': '如何反馈',
  'panel.overview.step2Body':
    '生成图下方直接点「确认采用 / 选用第 N 版 / 提交修改意见」，或直接打字说。',
  'panel.overview.step3Title': '如何锁定',
  'panel.overview.step3Body': '确认后自动提炼进 design/spec.md，无需手动操作。',
  'panel.overview.statusLine': '当前提供方:{provider} · {credential}',

  // 提供方与模型页
  'panel.provider.title': '提供方',
  'panel.provider.dashscopeName': '阿里云百炼 DashScope',
  'panel.provider.volcengineName': '火山方舟 Volcengine',
  'panel.provider.comingSoon': '即将支持',
  'panel.credential.title': '凭据（DASHSCOPE_API_KEY）',
  'panel.credential.ready': '凭据已配置',
  'panel.credential.missing': '未配置 DASHSCOPE_API_KEY',
  'panel.credential.checking': '检测中…',
  'panel.credential.howTitle': '配置方式（按读取优先级排序, 任选其一即可）:',
  'panel.credential.way1':
    '进程环境变量: 启动 DSH 前执行 export DASHSCOPE_API_KEY=sk-xxx（CI/容器同理）',
  'panel.credential.way2':
    'DSH 密钥存储: ~/.dsh/.credentials.yaml（可在本页下方直接写入，或在 DSH 设置 · 模型页写入）',
  'panel.credential.way3':
    '项目 .env: 在启动目录（通常是项目根）的 .env 文件中写 DASHSCOPE_API_KEY=sk-xxx',
  'panel.credential.way4': 'DSH 主目录 .env: ~/.dsh/.env 中写 DASHSCOPE_API_KEY=sk-xxx',
  'panel.credential.readyWithSource': '凭据已配置 · 来源: {source}',
  'panel.credential.source.env': '进程环境变量',
  'panel.credential.source.file': 'DSH 密钥存储（~/.dsh/.credentials.yaml）',
  'panel.credential.source.project-env': '项目 .env',
  'panel.credential.source.user-env': '~/.dsh/.env',
  'panel.credential.source.ambient': '启动环境',
  'panel.credential.writePlaceholder': '输入新的 DASHSCOPE_API_KEY（写入即覆盖，不会回显）',
  'panel.credential.save': '保存（覆盖）',
  'panel.credential.clear': '清除已存密钥',
  'panel.credential.savedNotice': '已写入 DSH 密钥存储 ✓',
  'panel.credential.clearedNotice': '已清除 DSH 密钥存储中的 DASHSCOPE_API_KEY ✓',
  'panel.credential.notWritable':
    '当前密钥由更高优先级的来源（{source}）提供，面板写入不会生效；如需在面板管理，请先移除该来源中的同名变量。',
  'panel.test.ok': '凭据有效：鉴权通过，网关可达。',
  'panel.test.missingKey': '未找到 DASHSCOPE_API_KEY——请按上方「配置方式」任选其一配置后重试。',
  'panel.test.invalidKey':
    '网关拒绝了这把密钥（鉴权未通过）——请确认 DASHSCOPE_API_KEY 是否正确、是否已过期。',
  'panel.test.gatewayFail': '网关不可达: {detail}',
  'panel.models.title': '模型分层默认',
  'panel.models.wireframe': '线框图',
  'panel.models.highFidelity': '高保真',
  'panel.models.followDefault': '跟随提供方默认',
  'panel.models.hintPrefix': '可用模型:',

  // 生成偏好页
  'panel.prefs.fidelity': '保真度偏好',
  'panel.prefs.fidelityWireframe': '线框图',
  'panel.prefs.fidelityHigh': '高保真',
  'panel.prefs.platform': '目标平台',
  'panel.prefs.count': '一次生成数量',
  'panel.prefs.outputDir': '输出目录',
  'panel.prefs.pollTimeout': '轮询超时',
  'panel.prefs.minutes': '分钟',
  'panel.prefs.backoff': '限流退避策略',
  'panel.prefs.backoffFixed': '25 秒 × 2 次(自动)',
  'panel.prefs.size': '默认尺寸',
  'panel.prefs.reset': '恢复默认',
  'panel.prefs.save': '保存',
  'panel.prefs.saved': '已保存 ✓',
  'panel.prefs.invalidDir': '输出目录必须是工作区内的相对路径(不能为空、不能包含 .. 或绝对路径)。',

  // 生成历史页
  'panel.history.searchPlaceholder': '按描述搜索…',
  'panel.history.clear': '清空历史',
  'panel.history.confirmClear': '确认清空?',
  'panel.history.empty': '暂无生成历史; 出一张草图试试。',
  'panel.history.setAnchor': '设为锚点',
  'panel.history.unsetAnchor': '解除锚点',
  'panel.history.anchorTag': '风格锚点',
  'panel.history.anchorHint':
    '设为锚点后, 调用 ui_mockup 未显式传 reference 时会自动引用该图保持多页风格一致。',
  'panel.history.fileCount': '{n} 张图',
} satisfies Record<string, string>

/** 卡片命名空间的字典键联合。 */
export type UiMockupKey = keyof typeof zh

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** ui_mockup 工具卡片与设置面板文案。 */
    'ui-mockup': UiMockupKey
  }
}

/** English UI copy. */
export const en = {
  'card.generating': 'Generating…',
  'card.confirm': 'Confirm this version',
  'card.select': 'Use version {n}',
  'card.selectPlaceholder': 'Pick a version…',
  'card.openOriginal': 'Open original',
  'card.feedback': 'Submit feedback',
  'card.feedbackPlaceholder': 'Describe what to change…',
  'card.feedbackSubmit': 'Submit & regenerate',
  'card.feedbackCancel': 'Cancel',
  'card.confirmMessage': 'Confirm this design (file: {name})',
  'card.selectMessage': 'Use version {n} (file: {name})',
  'card.feedbackMessage': '{opinion} (based on file: {name}, regenerate accordingly)',

  'panel.nav': 'UI Mockups',
  'panel.tab.overview': 'Overview',
  'panel.tab.provider': 'Provider & models',
  'panel.tab.preferences': 'Preferences',
  'panel.tab.history': 'History',
  'panel.loading': 'Loading…',
  'panel.loadFailed': 'Failed to load: {error}',
  'panel.readonlyBanner':
    'This connection uses in-process or read-only settings storage; preference changes will not persist.',
  'panel.testConnection': 'Test connection',
  'panel.testing': 'Testing…',

  'panel.overview.intro':
    'Generate wireframes / high-fidelity mockups during discussion: confirm direction from the picture before writing code.',
  'panel.overview.quickTitle': 'Quick start',
  'panel.overview.step1Title': 'When to trigger',
  'panel.overview.step1Body':
    'The agent offers a sketch during requirement talks; you can also just say "sketch this".',
  'panel.overview.step2Title': 'How to give feedback',
  'panel.overview.step2Body':
    'Click "confirm / use version N / submit feedback" under the image, or type it directly.',
  'panel.overview.step3Title': 'How to lock it in',
  'panel.overview.step3Body':
    'On confirmation the design is distilled into design/spec.md automatically.',
  'panel.overview.statusLine': 'Provider: {provider} · {credential}',

  'panel.provider.title': 'Provider',
  'panel.provider.dashscopeName': 'Alibaba DashScope',
  'panel.provider.volcengineName': 'Volcengine Ark',
  'panel.provider.comingSoon': 'Coming soon',
  'panel.credential.title': 'Credentials (DASHSCOPE_API_KEY)',
  'panel.credential.ready': 'API key configured',
  'panel.credential.missing': 'DASHSCOPE_API_KEY not configured',
  'panel.credential.checking': 'Checking…',
  'panel.credential.howTitle': 'How to configure (checked in this order; any one is enough):',
  'panel.credential.way1':
    'Process environment: export DASHSCOPE_API_KEY=sk-xxx before launching DSH (same for CI/containers)',
  'panel.credential.way2':
    'DSH credential store: ~/.dsh/.credentials.yaml (written from DSH Settings · Models)',
  'panel.credential.way3':
    'Project .env: add DASHSCOPE_API_KEY=sk-xxx to the .env in the launch directory (usually the project root)',
  'panel.credential.way4': 'DSH home .env: add DASHSCOPE_API_KEY=sk-xxx to ~/.dsh/.env',
  'panel.credential.readyWithSource': 'API key configured · source: {source}',
  'panel.credential.source.env': 'process environment',
  'panel.credential.source.file': 'DSH credential store (~/.dsh/.credentials.yaml)',
  'panel.credential.source.project-env': 'project .env',
  'panel.credential.source.user-env': '~/.dsh/.env',
  'panel.credential.source.ambient': 'launch environment',
  'panel.credential.writePlaceholder':
    'Enter a new DASHSCOPE_API_KEY (overwrites, never echoed back)',
  'panel.credential.save': 'Save (overwrite)',
  'panel.credential.clear': 'Clear stored key',
  'panel.credential.savedNotice': 'Written to the DSH credential store ✓',
  'panel.credential.clearedNotice': 'DASHSCOPE_API_KEY removed from the DSH credential store ✓',
  'panel.credential.notWritable':
    'The key is currently supplied by a higher-priority source ({source}); panel writes would not take effect. Remove that variable first to manage it here.',
  'panel.test.ok': 'Credential valid: authentication passed, gateway reachable.',
  'panel.test.missingKey':
    'DASHSCOPE_API_KEY not found — configure it via any option above, then retry.',
  'panel.test.invalidKey':
    'The gateway rejected this key (authentication failed) — check that DASHSCOPE_API_KEY is correct and not expired.',
  'panel.test.gatewayFail': 'Gateway unreachable: {detail}',
  'panel.models.title': 'Model defaults by fidelity',
  'panel.models.wireframe': 'Wireframe',
  'panel.models.highFidelity': 'High fidelity',
  'panel.models.followDefault': 'Follow provider default',
  'panel.models.hintPrefix': 'Known models:',

  'panel.prefs.fidelity': 'Fidelity preference',
  'panel.prefs.fidelityWireframe': 'Wireframe',
  'panel.prefs.fidelityHigh': 'High fidelity',
  'panel.prefs.platform': 'Target platform',
  'panel.prefs.count': 'Images per request',
  'panel.prefs.outputDir': 'Output directory',
  'panel.prefs.pollTimeout': 'Polling timeout',
  'panel.prefs.minutes': 'minutes',
  'panel.prefs.backoff': 'Rate-limit backoff',
  'panel.prefs.backoffFixed': '25s × 2 (automatic)',
  'panel.prefs.size': 'Default size',
  'panel.prefs.reset': 'Reset to defaults',
  'panel.prefs.save': 'Save',
  'panel.prefs.saved': 'Saved ✓',
  'panel.prefs.invalidDir':
    'Output directory must be a relative path inside the workspace (non-empty, no "..", no absolute path).',

  'panel.history.searchPlaceholder': 'Search by description…',
  'panel.history.clear': 'Clear history',
  'panel.history.confirmClear': 'Confirm clear?',
  'panel.history.empty': 'No generations yet; ask for a sketch to get started.',
  'panel.history.setAnchor': 'Set as anchor',
  'panel.history.unsetAnchor': 'Unset anchor',
  'panel.history.anchorTag': 'Style anchor',
  'panel.history.anchorHint':
    'Once set, ui_mockup calls without an explicit reference automatically reuse this image for consistent style.',
  'panel.history.fileCount': '{n} images',
} satisfies Record<UiMockupKey, string>
