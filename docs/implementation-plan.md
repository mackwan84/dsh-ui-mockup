# dsh-ui-mockup · 产品实施计划

> 本文档是 dsh-ui-mockup 的正式实施依据，对应经用户确认的全部需求（需求研讨记录保存在
> harness 工作区 `design/ui-mockup-plugin-plan.md`，本文为其产品化整理版）。
> 动手前以本文为准；变更需求先更新本文。

## 1. 产品目标

把「研讨阶段生成 UI 草图 → 用户确认 → 锁定设计规格」的闭环沉淀为可安装的 DSH 插件，
让个人/小团队在 Vibe Coding 中于写代码前确认界面方向，避免实现完成后才发现界面不符合预期。

## 2. 仓库架构

pnpm monorepo + npm bundle 发布：

```
dsh-ui-mockup/
├── package.json                       # root（private，workspaces）
├── pnpm-workspace.yaml
├── packages/
│   ├── image/                         # @mackwan84/dsh-image · Service Definition（图像生成/编辑契约）
│   ├── image-dashscope/               # @mackwan84/dsh-image-dashscope · 百炼 Provider（文生图 + I2I 参考图）
│   ├── image-volcengine/              # @mackwan84/dsh-image-volcengine · 火山方舟 Provider（同步 API + 指令编辑，M4）
│   └── tool-ui-mockup/                # @mackwan84/dsh-tool-ui-mockup · Consumer
│                                      #   （ui_mockup 工具 + 提示词 + 客户端卡片 + 设置面板 + i18n）
├── bundle/
│   └── ui-mockup/                     # @mackwan84/dsh-ui-mockup-bundle · dsh.bundle.patch 挂载行
│                                      #   （两行 Provider：dashscope 启用 / volcengine disabled: true）
└── docs/
```

- **capability seam 三件套**：Service Definition / Provider / Consumer，与 DSH 仓库规范一致；
- **Provider 选择语义**：对齐 DSH web 服务的 resolver 模式（配置 id → 可用性检查 → 明确错误码），不做隐式默认；
- **挂载平面**：Service + Provider 是跨会话能力（profile bundle patch 挂载）；工具与提示词是会话贡献（同一 patch 挂载，consumer 行）。

## 3. 安装与使用

```sh
# 产品形态（发布到 npm 后）
dsh plugin --profile web add @mackwan84/dsh-ui-mockup-bundle
# → pnpm 安装 → 检测 dsh.bundle.patch → 自动挂载 → 工具立即可用

# 开发期（未发布）
dsh plugin --profile web add /path/to/dsh-ui-mockup/bundle/ui-mockup
dsh plugin --profile web add github:mackwan84/dsh-ui-mockup#main   # 需 prepare 构建脚本
```

用户侧一次配置：`.env` 写入 `DASHSCOPE_API_KEY`（或设置面板填写），之后零配置使用。

## 4. 依赖策略

- 子包 `peerDependencies`：`@deepseek-ai/cordis`（4.0.1）+所需 `@deepseek-ai/dsh-*`（rc 版），dev 对齐本机 DSH 安装；
- 客户端半区：tsdown client bundle + `dsh.client` 清单；（M2 首验证点：外部 bundle 的 patch 声明 `dsh.client` 行，
  并经 `pnpm --filter <pkg> bundle` 产出 `lib/client.js`）；
- bundle 包 `dependencies` 指向四个子包（发布后用版本号，开发期 workspace:*）。

## 5. 里程碑

| 里程碑 | 内容                                                                   | 验收                                                      |
| ------ | ---------------------------------------------------------------------- | --------------------------------------------------------- |
| M1     | 骨架 + image Service + 百炼 Provider + Host 工具                       | `dsh plugin add` 本地装进 web profile，会话里能生成一张图 |
| M2     | 客户端卡片（tool.call.toolview）+ 图片路由（webServer）+ i18n 双语字典 | 卡片渲染、语言切换实时生效                                |
| M3 ✅  | 设置面板 4 页 + 资产库生成历史 + 风格锚点联动                          | 按已确认线框实现（design/spec.md），面板功能闭环          |
| M4 ✅  | 火山 Provider + I2I / 指令编辑模式 + 双提供方组合行切换                | 双提供方切换可用                                          |

每里程碑交付：单元测试、真实组合测试（Loader 真 cordis.yml）、README、invariant、打包发布检查。

## 6. 插件设计

### 6.1 Service Definition（image）

- `generate(spec)`：prompt、fidelity（wireframe/high-fidelity）、platform（web/mobile）、style、size、n(1–4)、model、reference（参考图，I2I 风格一致）。
- `edit(spec)`：base 图 + edit_note + mask（支持时局部重绘，否则整体重绘）。
- 结果：图片 URL 列表 + 元数据（宽高、mediaType）。

### 6.2 Provider · 百炼（image-dashscope）

- Config：credentials ref（默认 `DASHSCOPE_API_KEY`）、model 分层默认（wireframe→`qwen-image-3.0`、high-fidelity→`qwen-image-3.0-pro`）、size 默认、轮询窗口、限流重试策略；
- HTTP：Node fetch（正式包可用）；**凭据请求拒绝重定向**（等 DSH web 包规范）；
- 端点（2026 实测，见 §8）。

### 6.2.1 Provider · 火山方舟（image-volcengine，M4）

- Config：credentials ref（默认 `ARK_API_KEY`）、模型分层默认（线框 `doubao-seedream-4-5-251128`、
  高保真 `doubao-seedream-5-0-pro-260628`、编辑 `doubao-seededit-3-0-i2i-250628`）、
  `requestTimeoutMs`（300s，同步 API 无轮询）、限流重试策略；
- **同步 API**：`POST /api/v3/images/generations` 一次返回；`response_format: 'url'` 固定、
  `watermark: false`；size 翻译见 Provider README（档位 1K/2K/4K 或显式 WxH 合法域钳制）；
- 编辑：seededit 同端点（image + prompt）；**mask 不受支持**（方舟无掩码编辑）→ `NOT_IMPLEMENTED`；
- 多图请求串行拆单图调用（组图参数未在本仓验证）；
- 限流：HTTP 429（`ModelAccountIpmRateLimitExceeded` 等）→ 25s × 2 退避；
- 提供方切换：bundle 预置两行 Provider（volcengine 默认 `disabled: true`），用户 patch 翻转
  disabled；`ctx.image` 单槽位互斥，对齐 DSH `llm-deepseek` 单行语义；
- 面板：`provider/status` 端点按 `providerId`（契约成员）返回生效方；`test-connection`
  按生效提供方探测对应网关（空体 POST，401 无效 / 400·429 鉴权已过）。

### 6.3 Consumer 工具（tool-ui-mockup）

- 工具 `ui_mockup`（参数/模板/结果呈现沿用 MVP 验证实现）：
  - 参数：description（必填）、fidelity（用户选）、platform、style、count、model、size、reference、apiKey（仅后备，正常走 credentials）；
  - 模板：wireframe Balsamiq 风黑白线框 + 中文区块标注；high-fidelity 风格词 + 中文文案完整性；reference 时加"与基准图一致"约束；
  - 结果：落盘资产库 `$DSH_HOME/mockups/<工作区>/images/` → `attachments.saveImage` → 工具结果图片块呈现；
  - **限流自动退避重试**（Throttling/RateQuota → 25s × 2 次）。
- 提示词注入（systemPrompt section）：何时主动提议草图、fidelity 选择、确认后写 `design/spec.md`、spec 未确认不写前端代码；
- 设计锁定：用户确认后提炼 `design/spec.md`（配色、字体、间距、组件清单、页面清单）。

### 6.4 客户端 UI

- **工具卡片**：`tool.call.toolview` keyed `ui_mockup`——图片内嵌、确认/选用/修改意见按钮（消息带文件名）、打开原图；
- **图片路由**：webServer prefix `/ui-mockup/images` 服务资产库图片（cwd 经信任源全集校验）；
- **设置面板 4 页**（已确认线框）：概览 / 提供方与模型 / 生成偏好 / 生成历史；
  视觉跟随 DSH 主题（主题令牌 + 原生控件，浅/深色自适应），不做独立风格探索；
  「快速使用」文案以修正版为准（见 §6.4.1）。

#### 6.4.1 概览页「快速使用」修正文案（线框图为杜撰，禁止采纳）

- 何时触发：需求研讨中 agent 会主动提议出草图，也可以直接说「出个草图」；
- 如何反馈：生成图下方卡片直接点「确认采用 / 选用第 N 版 / 提交修改意见」，也可以直接打字说；
- 如何锁定：确认后 agent 自动提炼进 design/spec.md，用户无需操作。

### 6.5 i18n（用户确认）

- 范围：客户端 UI 全部可见字符串（工具卡片 + 设置面板 4 页），线框图中文文案均为占位；
- LocaleId `'zh' | 'en'`；回退链 `ns-当前语言 → ns-en → common → key 原样`；
- `locale.register(ns, dicts)` 一次注册全部语言、双语平衡强制；组件用框架注入 `t` 座席消费，不接触 ctx、不自行订阅；
- 模型可见文本（工具描述/提示词规则）保持中文固定，不随 UI 切换。

## 7. 配置面

1. 凭据：credentials 能力 + `.env`（`DASHSCOPE_API_KEY` / 火山 `ARK_API_KEY`），不进会话日志；
2. cordis.yml config：model、size、输出目录、轮询超时等 tunable 全部 validated Config；
3. 设置面板（settings 插槽）为 UI 入口，settings service 为源、yml 为初始值。

## 8. 已验证的关键事实与陷阱（来自 MVP 实测）

- 百炼新旧两条链路：
  - wanx 系列：`POST /api/v1/services/aigc/text2image/image-synthesis`（async 头）→ `GET /api/v1/tasks/{id}` → `output.results[].url`；
  - qwen-image 3.0 系列：`POST /api/v1/services/aigc/image-generation/generation`（async 头）→ 同任务查询 → `output.choices[].message.content[].image`；`input.messages[].content` 结构（纯文本 `{text}`；I2I 加 1-3 张 `{image}`，URL 或 base64 data URL）；
- qwen-image-3.0-pro 默认思考模式、耗时可 >5 分钟：轮询窗口 ≥10 分钟；
- 限流错误：`Throttling.RateQuota` → 25s×2 退避；
- 国际网关 `dashscope-us.aliyuncs.com` 与国内 key 不通；火山走 `ARK_API_KEY`；
- web fetch 服务仅 GET（动态插件环境）；动态插件必须 `shell.resolve()` 再 `shell.run()`；正式包无此限制；
- 工具 schema DSL：不支持 minimum/maximum、value schema 不支持 required、参数根 additionalProperties 省略或 true、
  value 对象须显式 additionalProperties 且声明 items 全部字段；
- 视觉提取依赖多模态模型：Consumer 提炼 spec 时经 `ctx.llm` 指定 image 模态模型（或要求会话用多模态模型）。

### 8.1 火山方舟事实（M4，2026 调研核对）

- 端点 `POST https://ark.cn-beijing.volces.com/api/v3/images/generations`，
  认证 `Authorization: Bearer $ARK_API_KEY`；**同步 API 无任务轮询**；
- model 可直接填 Model ID（`doubao-seedream-4-0-250828` / `doubao-seededit-3-0-i2i-250628`），
  也可填接入点 ID（`ep-xxxx`）；
- size 双轨制：档位 `1K/2K/4K`（4.0）或显式 `宽x高`（总像素 ≤ 4096x4096，宽高比 [1/16,16]，
  `1024x1024` 这类低于边长下限的不合法）；seededit 缺省 `adaptive`（跟随基准图）；
  档位与 WxH 两写法不可混用；
- 编辑复用同一端点（image + prompt），**无 mask 局部重绘**（老 inpainting 涂抹编辑属
  旧视觉技术服务 `visual.volcengineapi.com` 且已公告下线，与方舟无关）；
- 响应 `{model, created, data:[{url|b64_json}], usage}`；URL 24h 失效，须即时下载；
- 错误包裹顶层 `error:{code,message}`；限流统一 HTTP 429（`ModelAccountIpmRateLimitExceeded`
  等图像维度错误码）；401 `AuthenticationError`；400 审核类 `SensitiveContentDetected.*` 不可重试；
- seedream 4.0 无 `seed`/`guidance_scale`（3.0 代参数）；组图走 `sequential_image_generation`
  （本仓未用，多图串行拆单图）；
- 网关同步超时上限官方未公布：`requestTimeoutMs` 配置化，默认 300s。

## 9. 门禁与交付物

- 包级单元测试 + 真实组合测试（Loader 启动真实 cordis.yml；mock 仅限外部服务）；
- 每包 README（含 Model Experience 格式）+ invariant；
- 工具 schema 与模型可见文本走 runnable-example 快照；
- typecheck / lint / build / 覆盖率全绿后发布。
