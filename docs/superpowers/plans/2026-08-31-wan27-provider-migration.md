# DashScope Wan 2.7 Provider Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 删除旧 Wan 模型与旧 text2image 端点，仅支持 Wan 2.7/Pro 的文生图和单参考图 I2I，并让设置、文档与真实验收保持一致。

**Architecture:** DashScope Provider 显式区分 Qwen Image 与 Wan 2.7；两者复用现有异步 `image-generation/generation` 端点、messages 输入和 choices 输出，但 Wan 2.7 使用独立尺寸规则。Consumer 将参考图能力从“仅 Qwen”扩展为“Qwen 或 Wan 2.7”，旧/未知模型在 Provider 发网关请求前失败。

**Tech Stack:** TypeScript、Cordis、Schemastery、Vitest、React 设置面板、DSH Web、DashScope HTTP API。

**Spec:** `docs/superpowers/specs/2026-08-31-wan27-provider-migration-design.md`

## Global Constraints

- 仅支持 `wan2.7-image` 与 `wan2.7-image-pro`；不保留 Wan 2.2/2.6/wanx 生产兼容层。
- Wan 2.7 使用异步 `POST {baseUrl}/api/v1/services/aigc/image-generation/generation`。
- Qwen 默认模型、端点、尺寸、轮询和错误语义不得改变。
- Wan 2.7 Web/Mobile 缺省尺寸固定为 `2048*1152` / `1152*2048`。
- Wan 2.7 支持单参考图和锚点 I2I；DashScope `edit()` 本次仍为 `NOT_IMPLEMENTED`。
- 不新增运行时依赖，不输出 API Key、Authorization 或完整 Base64。
- 所有实现遵循测试先行：先运行并确认预期失败，再写最小实现。
- 只提交当前任务列出的文件，保留工作区已有的无关修改和验收证据。

---

### Task 1: 迁移 DashScope Provider 到 Wan 2.7

**Files:**

- Modify: `packages/image-dashscope/tests/provider.spec.ts:76-286`
- Modify: `packages/image-dashscope/src/index.ts:70-220`

**Interfaces:**

- Consumes: `ImageGenerateSpec` 的 `model`、`platform`、`size`、`reference`、`n`、`cwd`。
- Produces: `modelFamilyOf(model): 'qwen' | 'wan27'`、`toWan27Size(model, size, platform, hasReference): string`；`generate()` 对 Qwen 保持原行为，对 Wan 2.7 生成官方 messages 请求。

- [ ] **Step 1: 把旧 Wan 响应测试改成仅接受 choices 输出**

在 `packages/image-dashscope/tests/provider.spec.ts` 删除：

```ts
it('reads wanx results[].url', () => {
  expect(extractImageUrls({ results: [{ url: 'https://oss/a.png' }] })).toEqual([
    'https://oss/a.png',
  ])
})
```

增加防回归断言：

```ts
it('ignores retired Wan results output', () => {
  expect(extractImageUrls({ results: [{ url: 'https://oss/legacy.png' }] })).toEqual([])
})
```

- [ ] **Step 2: 先写 Wan 2.7 T2I、I2I、默认尺寸和旧模型拒绝测试**

用现有 `mockFetch` 增加以下测试；成功轮询响应统一使用 choices：

```ts
const wanSuccess = {
  output: {
    task_status: 'SUCCEEDED',
    choices: [{ message: { content: [{ image: 'https://oss.example/wan27.png' }] } }],
  },
}

it('uses the Wan 2.7 async messages endpoint with web defaults', async () => {
  const calls = mockFetch([
    () => new Response(JSON.stringify({ output: { task_id: 'wan27' } }), { status: 200 }),
    () => new Response(JSON.stringify(wanSuccess), { status: 200 }),
  ])
  await provider().generate({ ...wireframeSpec, model: 'wan2.7-image' })
  expect(calls[0]!.url).toBe(
    'https://dashscope.aliyuncs.com/api/v1/services/aigc/image-generation/generation',
  )
  const body = JSON.parse(bodyOf(calls[0]!)) as {
    input: { messages: Array<{ content: Array<Record<string, string>> }> }
    parameters: { size: string; n: number; watermark: boolean }
  }
  expect(body.input.messages[0]!.content).toEqual([{ text: '黑白线框图测试' }])
  expect(body.parameters).toEqual({ size: '2048*1152', n: 1, watermark: false })
})

it('uses the Wan 2.7 mobile default size', async () => {
  const calls = mockFetch([
    () => new Response(JSON.stringify({ output: { task_id: 'wan27-mobile' } }), { status: 200 }),
    () => new Response(JSON.stringify(wanSuccess), { status: 200 }),
  ])
  await provider().generate({
    ...wireframeSpec,
    model: 'wan2.7-image',
    platform: 'mobile',
  })
  const body = JSON.parse(bodyOf(calls[0]!)) as { parameters: { size: string } }
  expect(body.parameters.size).toBe('1152*2048')
})

it('inlines a reference for Wan 2.7', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-wan27-reference-'))
  try {
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47])
    await writeFile(join(dir, 'anchor.png'), bytes)
    const calls = mockFetch([
      () => new Response(JSON.stringify({ output: { task_id: 'wan27-i2i' } }), { status: 200 }),
      () => new Response(JSON.stringify(wanSuccess), { status: 200 }),
    ])
    await provider().generate({
      ...wireframeSpec,
      model: 'wan2.7-image-pro',
      reference: 'anchor.png',
      cwd: dir,
    })
    const body = JSON.parse(bodyOf(calls[0]!)) as {
      input: { messages: Array<{ content: Array<Record<string, string>> }> }
    }
    expect(body.input.messages[0]!.content).toEqual([
      { image: `data:image/png;base64,${bytes.toString('base64')}` },
      { text: '黑白线框图测试' },
    ])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

it('rejects retired and unknown models before fetch', async () => {
  const calls = mockFetch(() => new Response('{}', { status: 200 }))
  await expect(
    provider().generate({ ...wireframeSpec, model: 'wan2.2-t2i-plus' }),
  ).rejects.toMatchObject({ code: 'INVALID_PARAMETER' })
  await expect(
    provider().generate({ ...wireframeSpec, model: 'future-image-model' }),
  ).rejects.toMatchObject({ code: 'INVALID_PARAMETER' })
  expect(calls).toHaveLength(0)
})
```

- [ ] **Step 3: 写 Wan 2.7 尺寸边界失败测试**

```ts
it('enforces Wan 2.7 tier and pixel limits', async () => {
  await expect(
    provider().generate({ ...wireframeSpec, model: 'wan2.7-image', size: '4K' }),
  ).rejects.toMatchObject({ code: 'INVALID_PARAMETER' })
  await expect(
    provider().generate({
      ...wireframeSpec,
      model: 'wan2.7-image-pro',
      reference: 'anchor.png',
      size: '4K',
    }),
  ).rejects.toMatchObject({ code: 'INVALID_PARAMETER' })
  await expect(
    provider().generate({ ...wireframeSpec, model: 'wan2.7-image', size: '4096*4096' }),
  ).rejects.toMatchObject({ code: 'INVALID_PARAMETER' })
})
```

为 Pro 纯文生图增加正向测试，断言请求体保留 `size: '4K'`。

- [ ] **Step 4: 运行 Provider 测试并确认 RED**

Run:

```bash
pnpm vitest run packages/image-dashscope/tests/provider.spec.ts
```

Expected: FAIL，旧实现仍命中 `text2image/image-synthesis`、拒绝 Wan reference、使用 Qwen 默认尺寸，并接受 `wan2.2-t2i-plus`。

- [ ] **Step 5: 实现模型分类和 Wan 2.7 尺寸函数**

在 `packages/image-dashscope/src/index.ts` 增加：

```ts
type DashscopeModelFamily = 'qwen' | 'wan27'

function modelFamilyOf(model: string): DashscopeModelFamily {
  if (model.startsWith('qwen-image')) return 'qwen'
  if (model === 'wan2.7-image' || model === 'wan2.7-image-pro') return 'wan27'
  throw new ImageProviderError(
    'INVALID_PARAMETER',
    `模型 ${model} 不受支持；当前仅支持 qwen-image 系列与 wan2.7-image(-pro)`,
  )
}

function toWan27Size(
  model: string,
  size: string | undefined,
  platform: ImageGenerateSpec['platform'],
  hasReference: boolean,
): string {
  if (size === undefined || size.trim() === '') {
    return platform === 'mobile' ? '1152*2048' : '2048*1152'
  }
  const normalized = size.trim().toUpperCase()
  if (normalized === '1K' || normalized === '2K') return normalized
  if (normalized === '4K') {
    if (model === 'wan2.7-image-pro' && !hasReference) return normalized
    throw new ImageProviderError(
      'INVALID_PARAMETER',
      `模型 ${model} 在当前场景不支持 4K；请使用 1K、2K 或合法宽高`,
    )
  }
  const parsed = /^(\d+)[X*](\d+)$/.exec(normalized)
  if (parsed === null) {
    throw new ImageProviderError('INVALID_PARAMETER', `Wan 2.7 画幅 ${size} 格式无效`)
  }
  const width = Number(parsed[1])
  const height = Number(parsed[2])
  const ratio = width / height
  const maxPixels = model === 'wan2.7-image-pro' && !hasReference ? 4096 * 4096 : 2048 * 2048
  if (width * height < 768 * 768 || width * height > maxPixels || ratio < 1 / 8 || ratio > 8) {
    throw new ImageProviderError(
      'INVALID_PARAMETER',
      `Wan 2.7 画幅 ${size} 超出当前模型与场景的像素或宽高比范围`,
    )
  }
  return `${width}*${height}`
}
```

- [ ] **Step 6: 改造 generate 请求路由并删除旧输出分支**

把 `generate()` 中的旧 `isQwen` / `else text2image` 改为：

```ts
const family = modelFamilyOf(model)
const size =
  family === 'wan27'
    ? toWan27Size(
        model,
        spec.size,
        spec.platform,
        spec.reference !== undefined && spec.reference !== '',
      )
    : (spec.size ?? (spec.platform === 'mobile' ? '1440*2560' : '2560*1440'))
const content: JsonObject[] = []
if (spec.reference !== undefined && spec.reference !== '') {
  const bytes = await readFile(resolveReferencePath(spec.reference, spec.cwd))
  content.push({ image: `data:image/png;base64,${bytes.toString('base64')}` })
}
content.push({ text: spec.prompt })
const input = { messages: [{ role: 'user', content }] }
const parameters: JsonObject = { size, n }
if (family === 'wan27') parameters.watermark = false
const created = await this.createTask(
  '/api/v1/services/aigc/image-generation/generation',
  { model, input, parameters },
  apiKey,
  signal,
)
```

在 `extractImageUrls()` 删除 `record.results` 分支，只保留 choices。

- [ ] **Step 7: 更新受影响的韧性测试响应为 choices**

在 `packages/image-dashscope/tests/provider.spec.ts` 搜索所有：

```text
results: [{ url:
```

Qwen/Wan 2.7 成功任务一律替换为：

```ts
choices: [{ message: { content: [{ image: 'https://oss/r.png' }] } }]
```

不得保留任何旧 Wan `results[].url` 成功夹具。

- [ ] **Step 8: 运行 Provider 测试并确认 GREEN**

Run:

```bash
pnpm vitest run packages/image-dashscope/tests/provider.spec.ts
```

Expected: Provider 测试全部通过；不再有 `text2image/image-synthesis` 或 Wan 2.2 成功路径，
`wan2.2-t2i-plus` 只保留在“旧模型零网络拒绝”测试中。

- [ ] **Step 9: 提交 Provider 迁移**

```bash
git add packages/image-dashscope/src/index.ts packages/image-dashscope/tests/provider.spec.ts
git commit -m "feat(dashscope): 迁移 Wan 2.7 图像生成端点"
```

---

### Task 2: 让 Consumer 与设置页识别 Wan 2.7 I2I

**Files:**

- Modify: `tests/composition.spec.ts:745-810`
- Modify: `packages/tool-ui-mockup/src/index.ts:695-730,895-910`
- Modify: `packages/tool-ui-mockup/src/client/settings-panel.tsx:350-400,810-825`
- Modify: `packages/tool-ui-mockup/src/client/locales.ts:90-105,235-250`

**Interfaces:**

- Consumes: 生效 `providerId`、effective model、当前 anchor。
- Produces: `supportsDashscopeReference(model): boolean`；Wan 2.7 与 Qwen 均自动注入锚点，旧/未知模型交由 Provider 明确拒绝。

- [ ] **Step 1: 把组合测试从“Wan 跳过”改成“Wan 2.7 注入”**

将 `skips anchor injection when the effective model is not qwen-image` 测试改名并改断言：

```ts
it('auto-injects the style anchor for Wan 2.7', async () => {
  // 保留现有临时目录、anchor.json 和图片准备。
  booted.settings.resolved.wireframeModel = 'wan2.7-image'
  // fetch 创建端点改为 /image-generation/generation，成功输出改为 choices。
  // 执行 ui_mockup 后断言：
  expect(value.ok, String(value.message)).toBe(true)
  expect(createUrl).toContain('/api/v1/services/aigc/image-generation/generation')
  expect(createBody).toContain('data:image/png;base64,')
  expect(String(value.message)).toContain('已按风格锚点')
  expect(String(value.message)).not.toContain('已跳过风格锚点注入')
})
```

新增旧模型失败测试：配置 `wan2.2-t2i-plus`，断言 `value.ok=false`、无图片/附件/历史且 fetch 未调用。

- [ ] **Step 2: 运行组合测试并确认 RED**

Run:

```bash
pnpm vitest run tests/composition.spec.ts
```

Expected: FAIL，当前 Consumer 仍把 Wan 2.7 归为不支持 reference 并跳过锚点。

- [ ] **Step 3: 实现 DashScope 参考图能力判断**

在 `packages/tool-ui-mockup/src/index.ts` 增加：

```ts
function supportsDashscopeReference(model: string): boolean {
  return model.startsWith('qwen-image') || model === 'wan2.7-image' || model === 'wan2.7-image-pro'
}
```

替换当前条件：

```ts
const referenceUnsupported =
  activeProviderId === 'dashscope' &&
  effectiveModel !== undefined &&
  !supportsDashscopeReference(effectiveModel)
```

保留 `anchorSkippedForModel` 作为自定义未知模型的说明，但把恢复建议改成：

```ts
message += ` 当前生效模型 ${anchorSkippedForModel} 不支持参考图(I2I), 已跳过风格锚点注入; 请改用 qwen-image 或 wan2.7-image 系列。`
```

- [ ] **Step 4: 删除设置页固定 Wan 警告**

从 `settings-panel.tsx` 删除：

- `nonQwenModel()`；
- Provider 页面底部 `panel.models.nonQwenWarning` 条件 Notice；
- “wan 系 + 锚点互斥”注释。

从 `locales.ts` 中英文词典删除 `panel.models.nonQwenWarning` 两项。

- [ ] **Step 5: 运行组合、客户端构建与类型检查**

Run:

```bash
pnpm vitest run tests/composition.spec.ts
pnpm --filter @mackwan84/dsh-tool-ui-mockup build
pnpm typecheck
```

Expected: 全部通过；设置客户端构建无缺失 locale key 或 TypeScript 错误。

- [ ] **Step 6: 提交 Consumer 与设置页迁移**

```bash
git add tests/composition.spec.ts packages/tool-ui-mockup/src/index.ts packages/tool-ui-mockup/src/client/settings-panel.tsx packages/tool-ui-mockup/src/client/locales.ts
git commit -m "feat(ui-mockup): 支持 Wan 2.7 锚点参考图"
```

---

### Task 3: 更新产品文档与验收用例

**Files:**

- Modify: `README.md`
- Modify: `docs/product-guide.md`
- Modify: `docs/implementation-plan.md`
- Modify: `docs/browser-acceptance-test-plan.md`
- Modify: `packages/image-dashscope/README.md`

**Interfaces:**

- Consumes: Task 1/2 的最终模型、端点、尺寸、I2I 和错误口径。
- Produces: 不含旧 Wan 生产指引的用户文档，以及可关闭 ACC-008/009 的验收用例。

- [ ] **Step 1: 删除旧 Wan 能力表述**

逐文件删除或替换：

```text
wan2.2
wan2.6
wanx
text2image/image-synthesis
Wan 不支持参考图
Wan 跳过锚点
```

历史验收报告中的旧模型失败证据不删除。

- [ ] **Step 2: 写入统一 Wan 2.7 口径**

文档统一说明：

```text
DashScope 当前支持 Qwen Image 与 Wan 2.7。
Wan 2.7 使用 image-generation/generation 异步端点，支持 T2I、单参考图 I2I、n=1..4。
默认 Web/Mobile 尺寸为 2048*1152 / 1152*2048。
Wan 2.7 image 不支持 4K；Pro 仅在纯文生图允许 4K。
DashScope 指令编辑仍未在本插件开放。
```

- [ ] **Step 3: 增加模型候选真实冒烟用例**

在 `docs/browser-acceptance-test-plan.md` 的生成域追加：

```markdown
| GEN-13 | P1 | B+L | DashScope 有效 | 逐一选择设置页公开的 Wan 2.7 两个候选并使用默认尺寸生成 | 两个候选均命中新版端点并成功；模型/尺寸与历史一致 | 会话、请求、历史 |
| GEN-14 | P1 | B+E | DashScope 有效 | 显式传 wan2.2/wan2.6/未知模型 | 本地 INVALID_PARAMETER；无网关请求、图片、附件或历史 | 会话、Network |
```

把 ANC-03 改为 Wan 2.7 自动注入锚点并成功；另用 GEN-14 覆盖旧模型拒绝。

- [ ] **Step 4: 格式与陈旧引用检查**

Run:

```bash
pnpm exec prettier --write README.md docs/product-guide.md docs/implementation-plan.md docs/browser-acceptance-test-plan.md packages/image-dashscope/README.md
rg -n "wan2\.[0-6]|wanx|text2image/image-synthesis|Wan.*跳过.*锚点" README.md docs/product-guide.md docs/implementation-plan.md docs/browser-acceptance-test-plan.md packages/image-dashscope/README.md packages tests
```

Expected: 第二条命令只允许命中历史验收报告、旧模型拒绝测试和设计/计划文档；不得命中生产支持、公开候选或产品使用指引。

- [ ] **Step 5: 提交文档与验收用例**

```bash
git add README.md docs/product-guide.md docs/implementation-plan.md docs/browser-acceptance-test-plan.md packages/image-dashscope/README.md
git commit -m "docs: 更新 Wan 2.7 能力与验收口径"
```

---

### Task 4: 自动化回归与发布门禁

**Files:**

- Verify only; fix only failures caused by Tasks 1–3 in their owning files.

**Interfaces:**

- Consumes: Tasks 1–3 的全部提交。
- Produces: 可进入真实 API 回归的构建产物。

- [ ] **Step 1: 运行定向测试**

```bash
pnpm vitest run packages/image-dashscope/tests/provider.spec.ts tests/composition.spec.ts
```

Expected: 两个测试文件全部通过。

- [ ] **Step 2: 运行完整工程门禁**

```bash
pnpm test
pnpm typecheck
pnpm lint
pnpm format:check
pnpm build
```

Expected: 所有命令 exit 0，无测试失败、类型错误、Lint 错误或格式差异。

- [ ] **Step 3: 检查提交与工作区边界**

```bash
git log --oneline -5
git status --short
git diff --check
```

Expected: 本计划产生三个原子提交；用户原有未提交文件仍保留且未被误提交。

---

### Task 5: 真实 DashScope 浏览器回归与报告收口

**Files:**

- Modify: `docs/test-evidence/2026-08-28-browser-acceptance/acceptance-report.md`
- Create: `docs/test-evidence/2026-08-28-browser-acceptance/screenshots/54-wan27-web-card.jpg`
- Create: `docs/test-evidence/2026-08-28-browser-acceptance/screenshots/55-wan27-web-output.png`
- Create: `docs/test-evidence/2026-08-28-browser-acceptance/screenshots/56-wan27-pro-mobile-card.jpg`
- Create: `docs/test-evidence/2026-08-28-browser-acceptance/screenshots/57-wan27-pro-mobile-v1.png`
- Create: `docs/test-evidence/2026-08-28-browser-acceptance/screenshots/58-wan27-pro-mobile-v2.png`
- Create: `docs/test-evidence/2026-08-28-browser-acceptance/screenshots/59-wan27-i2i-card.jpg`
- Create: `docs/test-evidence/2026-08-28-browser-acceptance/screenshots/60-wan27-i2i-output.png`
- Create: `docs/test-evidence/2026-08-28-browser-acceptance/screenshots/61-wan27-state-restored.jpg`

**Interfaces:**

- Consumes: Task 4 构建、现有有效 `DASHSCOPE_API_KEY`、已保存的原锚点与 Provider 状态。
- Produces: Wan 2.7 T2I/I2I/多图真实证据、状态恢复证据、ACC-008/009 关闭结论。

- [ ] **Step 1: 记录并隔离测试前状态**

记录：

```text
当前 Provider patch
当前 anchor.json
当前生成偏好
当前提交 SHA
DSH Local Build 标识
```

锚点只能移动到同目录备份，不删除；测试完成后原样恢复。

- [ ] **Step 2: 执行 Wan 2.7 默认 Web 文生图**

通过 Codex 内置浏览器切换 DashScope，调用：

```text
model=wan2.7-image
fidelity=wireframe
platform=web
count=1
不传 size/reference
```

Expected: 新异步端点成功；历史模型正确；输出方向为 Web；无 `url error`。

- [ ] **Step 3: 执行 Wan 2.7 Pro 默认 Mobile 双图**

```text
model=wan2.7-image-pro
fidelity=high-fidelity
platform=mobile
count=2
不传 size/reference
```

Expected: 两张图片、一个历史记录、多图卡片和选版/分版设锚控件正确。

- [ ] **Step 4: 执行 Wan 2.7 锚点 I2I**

把 Step 3 第 2 版临时设锚，再调用同品牌页面且不传 reference。

Expected: 原始工具结果明确记录自动注入 Wan 2.7 参考图；输出与锚点在品牌、颜色和组件语言上基本一致。

- [ ] **Step 5: 验证旧模型零网络失败**

调用 `model=wan2.2-t2i-plus`；检查：

```text
返回 INVALID_PARAMETER
无图片
无附件
history.jsonl 不新增
会话与日志无 API Key/Base64
```

- [ ] **Step 6: 恢复状态并检查证据**

恢复原 Provider、anchor 和偏好；逐张打开新截图，拒绝空白、loading、错误裁切或错误窗口；扫描证据文本中的密钥模式。

- [ ] **Step 7: 更新并格式化验收报告**

报告必须：

- 将 ACC-008/009 标为“已修复并回归”；
- 删除“Wan 2.7 跳过锚点”结论；
- 更新双供应商能力矩阵；
- 保留 Wan 2.2 历史失败作为迁移前证据；
- 使用“浏览器会话端到端耗时”，不冒充纯 API 时延。

Run:

```bash
pnpm exec prettier --write docs/test-evidence/2026-08-28-browser-acceptance/acceptance-report.md
pnpm format:check
git diff --check
```

Expected: 格式通过，无断链截图和凭据泄漏。

- [ ] **Step 8: 提交真实验收证据**

```bash
git add docs/test-evidence/2026-08-28-browser-acceptance
git commit -m "test(acceptance): 回归 Wan 2.7 真实生成链路"
```
