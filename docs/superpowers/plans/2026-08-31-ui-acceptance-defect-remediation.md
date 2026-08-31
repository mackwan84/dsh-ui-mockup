# UI Acceptance Defect Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 `dsh-ui-mockup` 设置面板的可访问性、搜索反馈、偏好状态、图标一致性与插件侧窄容器适配问题。

**Architecture:** 保持单一设置区组件和现有 RPC/Prefs 协议不变，在组件内部引入明确的 tab/search/baseline 状态，并用一个插件私有 CSS 文件承担媒体查询。行为通过 jsdom 组件测试锁定，浏览器仅负责视觉和真实宿主集成回归。

**Tech Stack:** React 18、TypeScript、Vitest、jsdom、Testing Library、DSH UI primitives、CSS media/container-safe flex layout

**Spec:** `docs/superpowers/specs/2026-08-31-ui-acceptance-defect-remediation-design.md`

## Global Constraints

- 只修改 `dsh-ui-mockup` 仓库，不修改 `deepseek-harness`。
- 不改变 RPC、Provider、凭据或历史数据协议。
- 不新增运行时依赖；新增测试依赖必须写入 `devDependencies`。
- 保留工作区中与 Seedream 相关的既有未提交改动。
- 所有行为变更严格执行 RED → GREEN → REFACTOR。

---

### Task 1: 建立设置面板组件测试并修复 Tabs 与图标

**Files:**

- Modify: `packages/tool-ui-mockup/package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `vitest.config.ts`
- Create: `packages/tool-ui-mockup/tests/settings-panel.client.spec.tsx`
- Modify: `packages/tool-ui-mockup/src/client/settings-panel.tsx`

**Interfaces:**

- Consumes: `UiMockupSection`、`PrefScope<PanelPrefs>`、`ConnectionFace`
- Produces: 完整的自动激活 Tabs 合约与稳定的 primitives 图标

- [ ] **Step 1: 添加测试运行依赖与 TSX 匹配规则**

运行：

```bash
pnpm --filter @mackwan84/dsh-tool-ui-mockup add -D @testing-library/react jsdom
```

将 Vitest include 改为同时匹配 `*.spec.ts` 和 `*.spec.tsx`：

```ts
include: ['packages/**/tests/**/*.spec.{ts,tsx}', 'tests/**/*.spec.{ts,tsx}'],
```

- [ ] **Step 2: 写 Tabs 与概览图标的失败测试**

测试真实渲染的 `UiMockupSection`：断言初始仅一个 tab 可 Tab 聚焦；`ArrowRight`、`ArrowLeft`、`Home`、`End` 循环切换并聚焦；tab 与 tabpanel 通过 `aria-controls`/`aria-labelledby` 互相引用；概览 DOM 不再包含 `💬`、`🖱️`、`🔒`。

- [ ] **Step 3: 运行测试并确认按预期失败**

```bash
pnpm vitest run packages/tool-ui-mockup/tests/settings-panel.client.spec.tsx
```

预期：缺少 `tabpanel`、键盘不会切页、所有 tab 均可 Tab 聚焦、Emoji 仍存在。

- [ ] **Step 4: 实现最小 Tabs 与图标修复**

在 `UiMockupSection` 中使用 `useId()` 生成 tab/panel id，使用 `useRef<Array<HTMLButtonElement | null>>` 保存 tab，并在键盘处理器中计算目标索引：

```ts
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
```

目标非空时 `preventDefault()`、`setPage(SUBPAGES[nextIndex])` 并聚焦目标 tab。概览三步分别改用 `IconNewChatOutline16`、`IconEditOutline16`、`IconCheckOutline16`。

- [ ] **Step 5: 运行定向测试并确认通过**

```bash
pnpm vitest run packages/tool-ui-mockup/tests/settings-panel.client.spec.tsx
```

- [ ] **Step 6: 原子提交**

```bash
git add packages/tool-ui-mockup/package.json pnpm-lock.yaml vitest.config.ts packages/tool-ui-mockup/tests/settings-panel.client.spec.tsx packages/tool-ui-mockup/src/client/settings-panel.tsx
git commit -m "fix(ui-mockup): 完善设置子页键盘导航"
```

### Task 2: 修复表单可访问名称与偏好脏状态

**Files:**

- Modify: `packages/tool-ui-mockup/src/client/settings-panel.tsx`
- Modify: `packages/tool-ui-mockup/src/client/locales.ts`
- Modify: `packages/tool-ui-mockup/tests/settings-panel.client.spec.tsx`

**Interfaces:**

- Consumes: Task 1 的组件测试夹具
- Produces: `editablePrefsEqual(left, right): boolean` 的五字段比较行为和具名表单控件

- [ ] **Step 1: 写 accessible name 与值回退的失败测试**

断言通过角色和可见文案可定位两个模型 combobox、轮询超时 spinbutton、默认尺寸 combobox、凭据输入；修改平台后 Save 可用，恢复原平台后 Save 重新禁用；保存成功文案具有 `role="status"`。

- [ ] **Step 2: 运行测试并确认按预期失败**

```bash
pnpm vitest run packages/tool-ui-mockup/tests/settings-panel.client.spec.tsx
```

预期：控件只能靠 placeholder/DOM 位置定位，且恢复原值后 Save 仍启用。

- [ ] **Step 3: 实现最小可访问名称与基线比较**

为单一控件直接设置本地化 `aria-label`；保存反馈使用：

```tsx
<span role="status" aria-live="polite">
  {t('panel.prefs.saved')}
</span>
```

偏好状态改为：

```ts
const [baseline, setBaseline] = useState<PanelPrefs>(initial)
const dirty = !editablePrefsEqual(draft, baseline)
```

比较字段限定为 `defaultFidelity`、`defaultPlatform`、`defaultCount`、`pollTimeoutMinutes`、`defaultSize`。保存与恢复默认成功后同时更新 `draft` 和 `baseline`。

- [ ] **Step 4: 运行定向测试并确认通过**

```bash
pnpm vitest run packages/tool-ui-mockup/tests/settings-panel.client.spec.tsx
```

- [ ] **Step 5: 原子提交**

```bash
git add packages/tool-ui-mockup/src/client/settings-panel.tsx packages/tool-ui-mockup/src/client/locales.ts packages/tool-ui-mockup/tests/settings-panel.client.spec.tsx
git commit -m "fix(ui-mockup): 修复偏好状态与控件名称"
```

### Task 3: 修复历史搜索反馈与插件侧窄容器布局

**Files:**

- Create: `packages/tool-ui-mockup/src/client/settings-panel.css`
- Modify: `packages/tool-ui-mockup/src/client/settings-panel.tsx`
- Modify: `packages/tool-ui-mockup/src/client/locales.ts`
- Modify: `packages/tool-ui-mockup/tests/settings-panel.client.spec.tsx`

**Interfaces:**

- Consumes: `callPanel(connection, 'history/list', payload)` 现有协议
- Produces: `queryDraft`/`appliedQuery` 搜索状态与 `ui-mockup-*` 私有响应式类名

- [ ] **Step 1: 写搜索提交与状态分离的失败测试**

初始历史 RPC 返回后，在输入框键入文本：断言未立即发请求并出现“搜索条件已更改”提示；点击“搜索”或按 Enter：断言请求 payload 使用输入值且 `page: 1`；随后翻页：断言继续使用已提交条件。

- [ ] **Step 2: 运行测试并确认按预期失败**

```bash
pnpm vitest run packages/tool-ui-mockup/tests/settings-panel.client.spec.tsx
```

预期：没有搜索按钮和待提交提示，查询状态只有一个变量。

- [ ] **Step 3: 实现搜索状态分离**

新增双语词条 `panel.history.search`、`panel.history.searchLabel`、`panel.history.pendingSearch`。历史页使用：

```ts
const [queryDraft, setQueryDraft] = useState('')
const [appliedQuery, setAppliedQuery] = useState('')
const submitSearch = () => {
  setAppliedQuery(queryDraft)
  void reload(queryDraft, 1)
}
```

翻页、清空和锚点操作全部传 `appliedQuery`。

- [ ] **Step 4: 添加插件私有响应式 CSS**

根节点、tablist、字段行、历史工具栏、历史卡片和操作区添加 `ui-mockup-*` 类。样式至少包含：

```css
.ui-mockup-section {
  min-width: 0;
}
.ui-mockup-tabs {
  overflow-x: auto;
}
.ui-mockup-tab {
  flex: 0 0 auto;
  white-space: nowrap;
}
.ui-mockup-model-select {
  max-width: 100%;
}

@media (max-width: 640px) {
  .ui-mockup-history-toolbar,
  .ui-mockup-history-row {
    flex-wrap: wrap;
  }
  .ui-mockup-history-actions {
    width: 100%;
  }
}
```

- [ ] **Step 5: 运行定向测试、类型检查与构建**

```bash
pnpm vitest run packages/tool-ui-mockup/tests/settings-panel.client.spec.tsx
pnpm typecheck
pnpm --filter @mackwan84/dsh-tool-ui-mockup build
```

- [ ] **Step 6: 原子提交**

```bash
git add packages/tool-ui-mockup/src/client/settings-panel.css packages/tool-ui-mockup/src/client/settings-panel.tsx packages/tool-ui-mockup/src/client/locales.ts packages/tool-ui-mockup/tests/settings-panel.client.spec.tsx
git commit -m "fix(ui-mockup): 改进历史搜索与窄屏布局"
```

### Task 4: 全量回归并更新验收报告

**Files:**

- Modify: `docs/test-evidence/2026-08-28-browser-acceptance/acceptance-report.md`
- Create: `docs/test-evidence/2026-08-28-browser-acceptance/screenshots/62-*.png`

**Interfaces:**

- Consumes: Tasks 1-3 的全部修复
- Produces: 可追溯的自动化与浏览器验收结论

- [ ] **Step 1: 执行完整自动化门禁**

```bash
pnpm test
pnpm typecheck
pnpm lint
pnpm format:check
pnpm build
```

预期：全部命令退出码为 0，无新增 warning/error。

- [ ] **Step 2: 执行真实浏览器回归**

在 1440px、375px、320px 下复测四个子页；验证键盘切页、可访问名称、偏好值恢复、搜索按钮/Enter、浅深色图标和插件内部无额外横向溢出，保存截图 62 起顺序编号。

- [ ] **Step 3: 更新验收报告**

关闭 ACC-002、ACC-003、ACC-004、ACC-005、ACC-007；将 ACC-001 拆分并记录插件侧已修复、宿主侧仍受固定导航限制；附自动化命令结果和新截图路径。

- [ ] **Step 4: 最终报告提交**

```bash
git add docs/test-evidence/2026-08-28-browser-acceptance/acceptance-report.md docs/test-evidence/2026-08-28-browser-acceptance/screenshots/62-*.png
git commit -m "test(acceptance): 回归设置面板缺陷修复"
```
