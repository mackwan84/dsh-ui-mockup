# dsh-ui-mockup · 架构与实现

> 当前实现版本：0.2.0。本文记录仓库结构、能力边界与经验证的关键实现事实。

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
│   ├── image-openai-compat/           # @mackwan84/dsh-image-openai-compat · OpenAI 兼容网关 Provider（最小子集，v0.3.0）
│   └── tool-ui-mockup/                # @mackwan84/dsh-tool-ui-mockup · Consumer
│                                      #   （ui_mockup 工具 + 提示词 + 客户端卡片 + 设置面板 + i18n）
├── bundle/
│   └── ui-mockup/                     # @mackwan84/dsh-ui-mockup-bundle · dsh.bundle.patch 挂载行
│                                      #   （三行 Provider：dashscope 启用 / volcengine、openai-compat disabled: true）
└── docs/
    ├── README.md                       # 文档导航与维护约定
    ├── guides/                         # 当前产品使用指南
    ├── architecture/                   # 当前架构与治理决策
    ├── references/                     # 带来源的外部技术事实
    ├── testing/vX.Y.Z/                 # 按版本冻结的用例与测试数据
    ├── releases/                       # 按版本冻结的发布结论
    └── assets/                         # 长期文档引用素材
```

- **capability seam 三件套**：Service Definition / Provider / Consumer，与 DSH 仓库规范一致；
- **Provider 选择语义**：对齐 DSH web 服务的 resolver 模式（配置 id → 可用性检查 → 明确错误码），不做隐式默认；
- **挂载平面**：Service + Provider 是跨会话能力（profile bundle patch 挂载）；工具与提示词是会话贡献（同一 patch 挂载，consumer 行）。

## 3. 安装与使用

```sh
# 产品形态
dsh plugin --profile web add @mackwan84/dsh-ui-mockup-bundle@0.2.0
# → pnpm 安装 → 检测 dsh.bundle.patch → 自动挂载 → 工具立即可用

# 开发期
dsh plugin --profile web add /path/to/dsh-ui-mockup/bundle/ui-mockup
dsh plugin --profile web add github:mackwan84/dsh-ui-mockup#main   # 需 prepare 构建脚本
```

用户侧一次配置：为生效提供方配置 `DASHSCOPE_API_KEY` 或 `ARK_API_KEY`（也可在设置面板填写），之后零配置使用。

## 4. 依赖策略

- 子包 `peerDependencies`：`@deepseek-ai/cordis`（4.0.1）+所需 `@deepseek-ai/dsh-*`（rc 版），dev 对齐本机 DSH 安装；
- 客户端半区：tsdown client bundle + `dsh.client` 清单；（M2 首验证点：外部 bundle 的 patch 声明 `dsh.client` 行，
  并经 `pnpm --filter <pkg> bundle` 产出 `lib/client.js`）；
- bundle 包 `dependencies` 指向四个子包（发布后用版本号，开发期 workspace:*）。

## 5. 里程碑

| 里程碑 | 内容                                                                                                                                         | 验收                                                           |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| M1 ✅  | 骨架 + image Service + 百炼 Provider + Host 工具                                                                                             | `dsh plugin add` 本地装进 web profile，会话里能生成一张图      |
| M2 ✅  | 客户端卡片（tool.call.toolview）+ 图片路由（webServer）+ i18n 双语字典                                                                       | 卡片渲染、语言切换实时生效                                     |
| M3 ✅  | 设置面板 4 页 + 资产库生成历史 + 风格锚点联动                                                                                                | 按已确认线框实现（design/spec.md），面板功能闭环               |
| M4 ✅  | 火山 Provider + I2I / 指令编辑模式 + 双提供方组合行切换                                                                                      | 双提供方切换可用                                               |
| M5 ✅  | 标注弹窗（选择/移动、矩形/画笔/箭头、标记选择删除 + 编号坐标文本反馈）+ `fastPreview` 方向稿 + 方向稿模型档 + 精修按钮 + 历史方向稿字段/过滤 | 标注交互与几何回归 + fastPreview 组合语义/设锚提示组合测试通过 |

每里程碑交付：单元测试、真实组合测试（Loader 真 cordis.yml）、README、invariant、打包发布检查。

## 6. 插件设计

### 6.1 Service Definition（image）

- `generate(spec)`：prompt、fidelity（wireframe/high-fidelity）、platform（web/mobile）、style、size、n(1–4)、model、reference（参考图，I2I 风格一致）。
- `edit(spec)`：base 图 + edit_note + mask（支持时局部重绘，否则整体重绘）。
- 结果：图片 URL 列表 + 元数据（宽高、mediaType）。
- 错误：Provider 失败统一为 `ImageProviderError`；HTTP 响应错误使用语义码，fetch 传输失败（undici 统一抛 `TypeError`）使用
  `NETWORK_ERROR`，Provider 自身时限耗尽使用 `TIMEOUT`，调用方主动取消保持原始取消错误；非传输类异常（如编程错误）原样上抛，不冒充 `NETWORK_ERROR`。

### 6.2 Provider · 百炼（image-dashscope）

- Config：credentials ref（默认 `DASHSCOPE_API_KEY`）、model 分层默认（wireframe→`qwen-image-3.0`、high-fidelity→`qwen-image-3.0-pro`）、size 默认、轮询窗口、限流重试策略；
- HTTP：Node fetch（正式包可用）；**凭据请求拒绝重定向**（等 DSH web 包规范）；
- 端点（2026 实测，见 §8）。

### 6.2.1 Provider · 火山方舟（image-volcengine，M4）

- Config：credentials ref（默认 `ARK_API_KEY`）、模型分层默认（线框 `doubao-seedream-4-5-251128`、
  高保真与编辑 `doubao-seedream-5-0-pro-260628`）、
  `requestTimeoutMs`（300s，同步 API 无轮询）、限流重试策略；
- **同步 API**：`POST /api/v3/images/generations` 一次返回；`response_format: 'url'` 固定、
  `watermark: false`；size 翻译见 Provider README（档位 1K/2K/4K 或显式 WxH 合法域钳制）；
- 编辑：Seedream 同端点（image + prompt）；**mask 不受支持**（方舟无掩码编辑）→ `NOT_IMPLEMENTED`；
- 多图请求串行拆单图调用（组图参数未在本仓验证）；
- 限流：HTTP 429（`ModelAccountIpmRateLimitExceeded` 等）→ 25s × 2 退避；
- 提供方切换：bundle 预置三行 Provider（volcengine 与 openai-compat 默认 `disabled: true`），
  用户 patch 翻转 disabled；`ctx.image` 单槽位互斥，对齐 DSH `llm-deepseek` 单行语义；
- 面板：`provider/status` 端点按 `providerId`（契约成员）返回生效方；`test-connection`
  按生效提供方探测对应网关（空体 POST，401 无效 / 400·429 鉴权已过）；
  无默认网关的提供方（openai-compat）未配置 baseUrl 时探测返回可操作原因而非网络异常。

### 6.2.2 Provider · OpenAI 兼容网关（image-openai-compat，v0.3.0）

- 面向 one-api / new-api 等私有聚合网关与官方 OpenAI（可配特例）：
  `POST {baseUrl}/images/generations` 同步协议，baseUrl 填到 `/v1 为止、默认空、
  未配置报明确错误、不自动补前缀；
- **最小公共子集**：`model + prompt + n + size` 四参数，无 `response_format`/`watermark`
  等任何专属参数；`n` 原生下传（单次请求多图，不串行拆单）；尺寸 `W*H → WxH` 归一后
  透传，本地不设预设白名单、不改比例，由网关自行校验；
- 双返回格式归一：`data[].b64_json` → data URL；`data[].url` 原样透传（消费方现有
  下载链路立即转存）；错误体兼容 `error.{code,message}` 包裹与顶层 `code/message`；
- 能力边界：参考图（I2I）与指令编辑显式 `NOT_IMPLEMENTED`——风格锚点经消费方元数据表
  的 `supportsReference` 闸门一律跳过注入并在结果消息说明；
- 凭据：`OPENAI_COMPAT_API_KEY`（credentials seam → 启动环境 → `MISSING_CREDENTIAL`）；
- 无内置退避重试：429 直接 `RATE_LIMITED` 上报；已知网关方言（`n>1` 拒绝、模型不存在
  503、无 `/v1` 前缀返回 HTML-200）见 `docs/references/`。

### 6.3 Consumer 工具（tool-ui-mockup）

- 工具 `ui_mockup`（参数/模板/结果呈现沿用 MVP 验证实现）：
  - 参数：description、fidelity（必填），以及 platform、style、count、model、size、reference、fastPreview；编辑时成对传 baseImage + editNote；凭据不属于工具参数；
  - `fastPreview`（0.2.0）：仅 high-fidelity 生效，用「方向稿模型」档快速产出方向稿；模型解析顺序为显式 `model` → `draftModel` 偏好（空串回落 `wireframeModel`）→ Provider 内置分层默认；与 `fidelity='wireframe'` 组合时忽略并在结果消息说明（工具 schema DSL 无法表达条件约束，执行层显式处理）；使用时机与「确认后去掉 fastPreview 跑精修档」写入 `ui-mockup-usage` 提示词规则，不仅依赖 schema 字段描述；
  - 模板：wireframe 使用无品牌名的低保真手绘线框 + 中文短标签；high-fidelity 使用风格词、单状态组件与低文字密度约束；reference 时追加与基准图一致约束；
  - 结果：落盘资产库 `$DSH_HOME/mockups/<工作区>/images/` → `attachments.saveImage` → 工具结果图片块呈现；模型只看到 `design/images/<文件名>` 语义引用；
  - 历史：逐行 JSONL；损坏行读取时跳过，坏尾行缺换行时先补分隔符再追加；历史写入失败不丢生成图片，并在成功结果中给出不会进入历史页的非致命告警；0.2.0 起方向稿记 `fastPreview: true`（纯增量字段，旧行兼容）；
  - **限流自动退避重试**（Throttling/RateQuota → 25s × 2 次）；
  - **标注反馈处理（0.2.0）**：卡片标注弹窗提交的消息形如「对 design/images/<名> 的标注反馈（ISO 时间戳）：编号区域（归一化坐标）：①…。意见：…」；提示词规则要求按编号区域空间语言组织 editNote/description、`baseImage` 恒传原图语义路径、同一图多轮标注以最新为准；`execute` 编辑分支对「标注图命名特征 + 文件不存在」的 baseImage 返回可操作错误（硬防护，避免误报「文件不存在」）。
- 提示词注入（systemPrompt section）：何时主动提议草图、fidelity 选择、确认后写 `design/spec.md`、spec 未确认不写前端代码、标注反馈消息的解读规则；
- **供应商元数据表（单一数据源）**：提供方的显示名词条键、凭据名、三档模型候选、鉴权探测参数（默认网关/路径）、补丁行 id、参考图能力闸门收敛为共享元数据模块（宿主/客户端两半区共用，模块自身不 import 客户端代码，host 构建保持排除 `src/client`）；面板卡片渲染、切换校验、切换补丁行合并（注册表驱动的 N 行单选语义）、`test-connection` 探测分流、凭据名映射全部查表；两家场景的补丁合并输出与 0.2.0 两行硬编码逐字节一致（合并纯函数测试锁定），新增提供方只需在注册表追加条目；
- 设计锁定：用户确认后提炼 `design/spec.md`（配色、字体、间距、组件清单、页面清单）。

### 6.4 客户端 UI

- **工具卡片**：`tool.call.toolview` keyed `ui_mockup`——图片内嵌（点击进入标注弹窗）、确认/选用/修改意见按钮（模型可见消息固定中文）；方向稿结果卡显示「按这版精修」按钮（解析 `block.call.argsRaw` 中 `fastPreview === true`，窗口截断 `call` 为 null 或解析失败时静默不显示）；运行中按持久化的工具调用事件时间计时，刷新后续表；空意见禁止提交，部分下载、附件超限与历史写入失败告警保持可见；「打开原图」入口在标注弹窗底部；
- **标注弹窗（0.2.0）**：叠层架构——底图 `<img>` 渲染（显示不需要像素），标注画在同尺寸透明 canvas 叠层（纯几何，几何计算全部在 `src/annotation.ts` 纯函数模块，可 node 环境单测）；默认“选择/移动”拖动滚动视口，单击已有标记按矩形内部/线段8px显示容差从上层到下层命中，选中项增加虚线包围框；说明/状态栏固定 44px 高度并使用单行双列布局，按工具状态动态切换内容但不改变弹窗高度，绘图模式使用 DSH 警示图标和语义令牌引导切回选择工具；选中态复用 DSH `Pill`/`Button`/垃圾桶图标与主题令牌，可点显式删除按钮，也可用Delete与macOS Backspace删除选中标记（仅画布自身聚焦时拦截，输入控件与工具条按钮持有焦点时不删标记）；标记快照栈使创建、删除、清空都可撤销（栈深上限 50），删除后剩余标记按顺序重新编号；矩形/画笔/箭头三种绘制工具、缩放下拉（默认“适合窗口”，完整显示且不超过100%；固定50%/100%/150%/200%切换时保持视口中心）、三色；提交时编号归一化坐标投影 + 意见经 `inputActions.setDraft + submit` 发出（底图固有尺寸未就绪前提交按钮保持禁用）；无标注提交退化为纯文字反馈；弹窗焦点陷阱 + Esc关闭，不承诺键盘绘制等价能力（canvas圈选本质不可键盘操作）；
- **图片路由**：webServer prefix `/ui-mockup/images` 服务资产库图片（cwd 经信任源全集校验）；
- **设置面板 4 页**（已确认线框）：概览 / 提供方与模型（含方向稿模型档，候选说明覆盖三个档位）/ 生成偏好 / 生成历史（方向稿标签 + 「只看方向稿」服务端过滤，工作区/连接变化时过滤位与请求参数一同复位）；
  视觉跟随 DSH 主题（主题令牌 + 原生控件，浅/深色自适应），不做独立风格探索；
  「快速使用」文案以修正版为准（见 §6.4.1）；方向稿设锚返回一次性提示（anchor/set 端点按历史标记返回 `hint`，卡片琥珀色展示）。

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
2. cordis.yml config：默认保真度、平台、数量、模型、size、轮询超时等 tunable 全部 validated Config；历史与图片输出目录由 DSH 资产库固定管理；
3. 设置面板（settings 插槽）为 UI 入口，settings service 为源、yml 为初始值。

## 8. 已验证的关键事实与陷阱（来自 MVP 实测）

- 百炼当前图像链路：
  - qwen-image 3.0 与 Wan 2.7：`POST /api/v1/services/aigc/image-generation/generation`
    （async 头）→ `GET /api/v1/tasks/{id}` →
    `output.choices[].message.content[].image`；`input.messages[].content` 结构（纯文本
    `{text}`；I2I 加 `{image}`，URL 或 base64 data URL）；
  - Wan 仅保留 `wan2.7-image` / `wan2.7-image-pro`；旧 Wan 2.2/2.6 与
    `/text2image/image-synthesis` 不再支持；
- qwen-image-3.0-pro 默认思考模式、耗时可 >5 分钟：轮询窗口 ≥10 分钟；
- 限流错误：`Throttling.RateQuota` → 25s×2 退避；
- 国际网关 `dashscope-us.aliyuncs.com` 与国内 key 不通；火山走 `ARK_API_KEY`；
- 工具 schema DSL：不支持 minimum/maximum、value schema 不支持 required、参数根 additionalProperties 省略或 true、
  value 对象须显式 additionalProperties 且声明 items 全部字段；
- 规格提炼由会话 Agent 完成：多模态模型可以直接读图；纯文本模型必须向用户索要口述，并明确标注规格未经模型读图核对。

### 8.1 火山方舟事实（M4，2026 调研核对）

- 端点 `POST https://ark.cn-beijing.volces.com/api/v3/images/generations`，
  认证 `Authorization: Bearer $ARK_API_KEY`；**同步 API 无任务轮询**；
- model 可直接填 Model ID（`doubao-seedream-4-0-250828` / `doubao-seedream-5-0-pro-260628`），
  也可填接入点 ID（`ep-xxxx`）；
- size 双轨制：档位 `1K/2K/4K`（4.0）或显式 `宽x高`（总像素 ≤ 4096x4096，宽高比 [1/16,16]，
  `1024x1024` 这类低于边长下限的不合法）；Seedream 编辑缺省 `2K`（模型按基准图比例出图）；
  档位与 WxH 两写法不可混用；
- 编辑复用同一端点（image + prompt），**无 mask 局部重绘**（老 inpainting 涂抹编辑属
  旧视觉技术服务 `visual.volcengineapi.com` 且已公告下线，与方舟无关）；
- 响应 `{model, created, data:[{url|b64_json}], usage}`；URL 24h 失效，须即时下载；
- 错误包裹顶层 `error:{code,message}`；限流统一 HTTP 429（`ModelAccountIpmRateLimitExceeded`
  等图像维度错误码）；401 `AuthenticationError`；400 审核类 `SensitiveContentDetected.*` 不可重试；
- seedream 4.0 无 `seed`/`guidance_scale`（3.0 代参数）；组图走 `sequential_image_generation`
  （本仓未用，多图串行拆单图）；
- 网关同步超时上限官方未公布：`requestTimeoutMs` 配置化，默认 300s。

### 8.2 宿主客户端契约事实（0.2.0，2026-09-04 核对本仓已安装包 0.1.1-rc.2）

- `ctx.conversation` 的声明类型是 `IConversation`（仅 `input / blocks / send / updateQueue / cancel / loadOlder`，
  「The outward face only; the concrete service stays inside this plugin」）；`createDraftImages(files)`
  只在具体类 `ConversationController` 上（`dsh-client-ui-conversation/lib/types/client/service.d.ts`），
  **不在对外契约内**。S0-a spike 结论为「三档」中的第 ② 档：运行时可用（该类以
  `super(ctx, "conversation")` 自注册、无代理收窄，`lib/client.js` 内定义 `createDraftImages` 与
  `draftAttachments` Map），类型面未公开——0.2.1 标注图附件路径以此为前提，实施时必须
  `typeof fn === 'function'` 特性探测 + try/catch + 降级坐标文本，且附退出条件（上游纳入公开面即迁移，探测失败即永久降级）；
- `InputActions` = `setDraft / addImages(ids): boolean / removeImage / pruneImages / submit`，不暴露 `state`：
  `addImages` 准入忙时返回 false；`setDraft` 整体覆写且读不到当前草稿（反馈按钮清掉用户正在输入的内容是既有行为，本迭代未扩大）；
- `DraftAttachmentId` 无公开生产者（`addImages` 在公开面但 ids 只能经内部 `createDraftImages` 产生）——向上游请求按此契约缺口陈述；
- 图片草稿/附件：composer 接受 png/jpeg/webp/gif；attachment provider 另有部署级 `mediaTypes` 白名单，
  违规抛 `UNSUPPORTED_IMAGE_TYPE`；宿主附件规范化默认长边 2048px、编码 4MiB（宿主
  `docs/subsystems/attachment.zh.md`，宿主仓事实，引用前按治理规则落 `docs/references/`）；
- `ConnectionHandle.rpc`（客户端）/ `HostConnectionRpc.handle`（宿主）为公开契约
  （「Generic logical RPC channels」/「通用 RPC 通道注册表」，`dsh-client-connection` 类型产物）：
  面板 `/ui-mockup` 私有 RPC 是被认可的插件通道，非技术债务；
- `ToolResultNode.call` 为 `{ name, argsRaw } | null`（窗口截断为 null，
  `dsh-client-runtime/lib/types/client/sessions/conversation.d.ts`）：方向稿「按这版精修」按钮据此判定可见性；
- 测试环境事实：vitest jsdom 无 canvas 2D（`getContext` 返回 null 并打 not-implemented 噪音），
  无 `PointerEvent`、`MouseEvent` 构造可携带 `clientX` 而 `PointerEvent` 不存在——
  标注几何全部拆纯函数在 node 环境单测，画布绘制留给浏览器用例。

百炼图像编辑能力与思考模式开关的调研结论（S0-b）见
[百炼图像编辑与思考模式开关事实清单](../references/dashscope-image-edit-and-thinking-mode.md)：
编辑可用（同异步端点零管线改动，进 0.2.1）；`enable_thinking` 默认 `true` 是 pro 耗时主因，
是否落地为 Provider 行为变更待产品决策。

## 9. 门禁与交付物

- 包级单元测试 + 真实组合测试（Loader 启动真实 cordis.yml；mock 仅限外部服务）；
- 每包 README（含 Model Experience 格式）+ invariant；
- 工具 schema 与模型可见文本走 runnable-example 快照；
- typecheck / lint / build / 覆盖率全绿后发布。
