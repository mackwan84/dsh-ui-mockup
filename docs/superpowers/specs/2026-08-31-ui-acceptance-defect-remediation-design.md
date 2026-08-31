# UI 验收缺陷修复设计

## 目标

仅在 `dsh-ui-mockup` 仓库内修复验收报告中的插件侧问题：子页键盘导航与 ARIA、表单控件可访问名称、概览图标跨平台一致性、历史搜索反馈、偏好脏状态，以及插件内容在窄容器中的自适应布局。

## 范围边界

- 不修改 `/Users/l/Documents/projects/deepseek-harness`。
- 插件内部不得产生横向页面溢出；子页导航允许在极窄容器内横向滚动。
- 宿主设置弹窗固定侧栏导致的 375px 内容区过窄不可能由插件完全消除，验收报告中的 ACC-001 将拆分为“插件侧已修复、宿主侧仍待处理”。
- 不改变图像生成、Provider 切换、凭据存储或历史数据协议。
- 不引入新的运行时依赖；测试依赖只在确有需要时增加。

## 交互与状态设计

### 子页导航

四个子页采用自动激活的 WAI-ARIA Tabs 模式：

- 每个 tab 具有稳定的 `id`、`aria-controls`、`aria-selected` 和 roving `tabIndex`。
- 当前内容包裹在 `role="tabpanel"` 中，并通过 `aria-labelledby` 回指当前 tab。
- `ArrowLeft`、`ArrowRight` 循环移动，`Home`、`End` 跳到首尾；移动后同时切页并聚焦目标 tab。

### 表单可访问名称

模型选择、轮询超时、默认尺寸、凭据输入和历史搜索输入均从可见文案获得明确的 accessible name。保存结果与搜索条件待提交提示使用 `aria-live="polite"`。

### 概览图标

移除依赖操作系统字体的 Emoji，复用 `@deepseek-ai/dsh-client-ui-primitives` 中的 `IconNewChatOutline16`、`IconEditOutline16`、`IconCheckOutline16`。图标仅作装饰，保持 `aria-hidden`。

### 偏好脏状态

保存按钮状态由“当前草稿”与“本地基线”的五个可编辑字段逐项比较得出，不再记录“是否发生过 change 事件”。用户修改后恢复原值时，按钮立即重新禁用。保存和恢复默认成功后，同时更新草稿与基线；外部快照仅在本地无未保存修改时回填。

### 历史搜索

历史页维护 `queryDraft` 与 `appliedQuery`：

- 输入只更新草稿；点击“搜索”或按 Enter 才提交并回到第 1 页。
- 草稿与已提交条件不同时显示提示，明确当前列表仍对应上次搜索。
- 翻页、清空历史和锚点操作统一使用 `appliedQuery`，避免输入中的草稿意外改变结果集。
- 保留请求序号机制，继续丢弃晚到的过期响应。

## 响应式设计

新增插件私有样式表并以 `ui-mockup-*` 类名隔离：

- 根节点和所有弹性子项设置 `min-width: 0`。
- tablist 在窄容器内单行横向滚动，tab 文案不折行。
- 字段行、历史工具栏、历史卡片和操作区在窄容器内换行；select/input 最大宽度不超过容器。
- 断点使用容器查询（根节点 `container-type: inline-size` + `@container`），跟随宿主
  分配的实际内容宽度，而非视口宽度——宿主设置弹窗的固定侧栏会让两者相差上百像素，
  视口媒体查询在大屏窄内容区场景不触发。
- 320px 与 375px 视口下验证插件本身无额外横向溢出。

## 测试与验收

- 新增 jsdom 组件测试，覆盖 tabs 键盘行为、ARIA 关联、控件 accessible name、偏好值回退、搜索按钮/Enter/待提交提示。
- 运行完整 `pnpm test`、`pnpm typecheck`、`pnpm lint`、`pnpm format:check`、`pnpm build`。
- 使用浏览器复测 1440px、375px、320px，更新验收报告与截图证据。
- ACC-002、003、004、005、007 在满足上述断言后关闭；ACC-001 只关闭插件侧子项，宿主侧限制继续开放。
