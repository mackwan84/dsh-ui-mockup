# dsh-ui-mockup · M4 实施计划（火山方舟 Provider + 编辑模式 + 双提供方切换）

> M4 是 implementation-plan §5 的最后一个里程碑：火山方舟 Provider、I2I / 编辑模式、
> 双提供方切换。本文是其执行依据；完成后 M4 相关事实回写 implementation-plan §8。

## 1. 目标与验收

| 项     | 内容                                                                                                         |
| ------ | ------------------------------------------------------------------------------------------------------------ |
| 里程碑 | M4：火山 Provider + I2I / 掩码编辑模式                                                                       |
| 验收   | 双提供方切换可用（安装即含两家 Provider，组合行一键切换，面板如实反映生效方）                                |
| 交付   | 新包 `@mackwan84/dsh-image-volcengine`、工具编辑入口、面板提供方状态、单测 + 组合测试、README/文档、打包检查 |

## 2. 已确认事实（本仓库侦察结论）

1. **契约已就绪**：`@mackwan84/dsh-image` 已定义 `edit(ImageEditSpec)` 抽象方法
   （prompt/baseImage/mask/size/model/cwd）与 `NOT_IMPLEMENTED` 错误码；
   dashscope Provider 的 `edit` 目前是 `NOT_IMPLEMENTED` 占位（注释明确"M4 提供"）。
2. **服务槽位单实现语义**：`ImageGenerationService extends Service`，槽位名 `image`，
   一个 context 只允许一个实现；consumer 经 `ctx.get('image')` 消费。
3. **DSH 原生多 Provider 先例**：`ctx.llm` 同为单槽位，官方 cordis.yml 只挂一行
   （`- id: llm-deepseek`）——切换提供方 = 组合行配置，无运行时聚合器。
4. **cordis patch 原生支持行禁用**：`PatchOptions.disabled?: boolean | null`
   （cordis-plugin-include 类型定义），bundle patch 可以插入"已安装但默认禁用"的行。
5. **设置面板现状**：「提供方与模型」页已有两张提供方选择卡——DashScope 选中（只读）、
   火山 disabled + "即将支持"；`test-connection` 端点硬编码探测 DashScope；
   概览页状态条文案 `panel.overview.statusLine` 已有 `{provider}` 占位（当前写死）。
6. **工具面现状**：`ui_mockup` 只有生成参数（description/fidelity/platform/style/
   count/model/size/reference）；execute 中 reference 已有"资产库路径翻译 + cwd 防逃逸"
   逻辑可复用于 baseImage；历史行 `status` 字段已落盘（`generated`）但面板未消费。
7. **工程蓝本**：image-dashscope 的 package.json / tsconfig / 测试结构即新包蓝本；
   vitest alias 需为新包加映射；`pnpm pack:all` 需追加新包；
   组合测试的 modules Map 需注册 volcengine 包名。
8. **方舟 API 与百炼的 size 体系不同**：百炼用 `"1280*720"` 像素串；方舟用
   `"1K" / "2K" / "4K"` 档位（另有宽高像素写法，见 §3），
   Provider 层必须做格式翻译，不能透传。

## 3. 方舟（Volcengine Ark）API 关键事实

> 依据：火山方舟官方文档与高可信镜像源交叉验证；实现前逐条核对 §3.6 清单。

### 3.1 端点与认证

- `POST {baseUrl}/images/generations`，默认 baseUrl `https://ark.cn-beijing.volces.com/api/v3`；
- 认证：`Authorization: Bearer <ARK_API_KEY>`；
- **同步 API**：无任务创建/轮询两段式，一次 HTTP 请求直接返回结果（与百炼 async 链路
  根本不同）。请求超时窗口用长超时（配置化，默认 ≥300s，对齐 seedream 4K 耗时上限）。

### 3.2 请求体（generate）

| 字段                          | 类型     | 说明                                                         |
| ----------------------------- | -------- | ------------------------------------------------------------ |
| `model`                       | string   | `doubao-seedream-4-0-250828`（文生图 + 参考图 + 编辑一体）等 |
| `prompt`                      | string   | 生成/编辑描述                                                |
| `image`                       | string[] | 参考图（URL 或 base64 data URL），I2I / 编辑时传入           |
| `size`                        | string   | `"1K" / "2K"（默认）/ "4K"`，或显式 `"宽x高"`                |
| `response_format`             | string   | 固定传 `url`（契约要求返回 URL）                             |
| `watermark`                   | boolean  | 固定传 `false`（草图不加水印）                               |
| `seed` / `guidance_scale`     | -        | 不透传，保持默认                                             |
| `sequential_image_generation` | object   | 多图输出控制，见 §3.5 n 的处理                               |

### 3.3 响应与错误

- 成功（同步）：`{ model, created, data: [{ url | b64_json, size }], usage }`；
- 失败：非 2xx + `{ error: { code, message } }`；HTTP 语义：
  401 鉴权失败、403 无权限/欠费、429 限流、400 参数/内容合规。
- 错误码映射：401→`MISSING_CREDENTIAL`（key 无效）、429→`RATE_LIMITED`（退避重试）、
  400→`INVALID_PARAMETER`、403→`HTTP_ERROR`、5xx→`HTTP_ERROR`（瞬态不重试）、
  其余→`HTTP_ERROR`；响应缺 `data`/`data[].url` → `BAD_RESPONSE`。

### 3.4 编辑模式（edit）

- seedream 4.0 系端点同端点编辑：`image: [<基准图>]` + `prompt: <编辑指令>`；
- **掩码（mask）局部重绘：方舟 API 不支持**（老的 inpainting 涂抹编辑属于视觉技术服务
  且已公告下线）。`ImageEditSpec.mask` 在火山实现中返回 `NOT_IMPLEMENTED`（明确错误码），
  契约字段保留。

### 3.5 n（多图）处理

- 方舟多图输出与百炼 `parameters.n` 语义不同（seedream 4.0 走组图/序列生成参数）；
- 稳妥策略：**count>1 时串行多次调用（每次 1 图）**，与 consumer 的逐张下载/附件逻辑
  自然对齐，避免依赖未充分验证的组图参数。后续验证组图参数后再优化。

### 3.6 实现前核对清单（已由 2026-08-28 官方文档调研关闭）

- [x] `size`：档位 `1K/2K/4K` 与显式 `WxH` 两写法互斥；显式 WxH 合法域为宽高比
      [1/16, 16] 且总像素 ≤ 4096x4096，且官方点名 `1024x1024` 不合法 → 实现按
      「短边 ≥ 720 且长边 ≥ 1280」钳制（与 1280x720 合法、1024x1024 不合法两事实一致）；
- [x] `image` 字段：URL 或 `data:image/<fmt>;base64,...`（格式名小写），最多 14 张
      （本 Provider 取 1 张）；
- [x] 错误包裹：顶层 `error:{code,message}`（实现防御式兼容顶层 code/message）；
- [x] 国际站：BytePlus ModelArk `https://ark.ap-southeast.bytepluses.com/api/v3`
      （baseUrl 可配置，非必选项）。

> 2026-08-28 迁移补充：SeedEdit 系列已下线；编辑默认迁移到
> `doubao-seedream-5-0-pro-260628`。真实浏览器验证表明缺省 `adaptive` 会被拒绝，
> `2K` 预设和显式 `2048x1152` 均可成功编辑。网关同步超时上限仍未确认
> （`requestTimeoutMs` 默认 300s 可配置）。

## 4. 架构决策与依据

### D1 双提供方并存：bundle 双行 + 默认禁用火山行（不做运行时聚合器）

```yaml
- insert:
    - id: image-dashscope
      name: '@mackwan84/dsh-image-dashscope'
    - id: image-volcengine
      name: '@mackwan84/dsh-image-volcengine'
      disabled: true
    - id: tool-ui-mockup
      name: '@mackwan84/dsh-tool-ui-mockup'
```

- 依据：`ctx.image` 单槽位契约 + DSH llm 的单行互斥先例 + cordis patch 原生 `disabled`；
- 切换 = 用户 patch 翻转两行 disabled（对齐 DSH 的"提供方由组合配置选择"语义）；
- 拒绝的备选：运行时 resolver 聚合器（改造 M1 架构、破坏"一个实现 per context"契约、
  且 DSH 原生无此模式）；两个独立 bundle（安装体验分裂）。
- 不引入 `prefs.provider` 偏好字段：组合行才是唯一事实源，面板只读反映，
  避免"面板改了配置但组合行没变"的两端口径漂移。

### D2 火山 Provider 镜像 dashscope 模板

Config 键面：`apiKey`（默认 `ARK_API_KEY`）、`baseUrl`、`wireframeModel` /
`highFidelityModel`（方舟无保真度分层，两键同默认 `doubao-seedream-4-0-250828`）、
`requestTimeoutMs`（同步长请求超时，默认 300_000）、`rateLimitRetries`（2）、
`rateLimitBackoffMs`（25_000）。凭据解析链、限流退避、`redirect: 'error'`、
路径防逃逸（resolveReferencePath 同款）逐项对齐。

size 翻译规则（插件统一 `"宽*高"` → 方舟）：

- `"数字*数字"` → 像素串 `"数字x数字"` 原样传（API 接受具体像素，见 §3.6 核对项）；
- 命中档位名（`1K/2K/4K`，大小写不敏感）→ 归一为大写档位传；
- 缺省 → `2K`（web/mobile 同档位，方向由 prompt 内容表达）。

### D3 工具编辑入口：`baseImage` + `editNote`（最小面）

- `ui_mockup` 新增可选参数 `baseImage`（待编辑图路径，支持 `design/images/x.png` 资产库
  引用）、`editNote`（编辑指令）；两者同时出现 → 走 `service.edit`；
- mask 不进工具层（当前无提供方支持）；`reference`/锚点注入在编辑路径跳过
  （基准图即风格基准）；
- dashscope 生效时的 edit 调用返回 `NOT_IMPLEMENTED` 明确提示（Provider 原生行为，
  consumer 不做能力嗅探）；
- 编辑结果与生成结果同卡片展示，历史行 `status: 'edited'`。

### D4 面板：新增 `provider/status` 端点，火山卡片点亮为只读状态卡

- 宿主端点 `provider/status` 返回 `{ active: 'dashscope' | 'volcengine' | 'unknown' }`
  （按 `ctx.get('image')` 的构造器识别）；测试连接按生效提供方探测对应网关
  （volcengine → ARK generations 空体 POST，语义同现有 dashscope 探测：401 无效、
  400/429 鉴权已过）；
- 火山卡片：未启用 → 显示"已安装未启用 + 启用方法（组合行翻转 disabled）"；
  启用 → 显示凭据状态 + 测试连接；概览页状态条 `{provider}` 接真实值。

### D5 文档与打包

- implementation-plan：§2 架构图补 volcengine、§5 M4 标 ✅、§8 追加方舟事实；
- README：功能特性补双提供方与编辑模式、配置节补 `ARK_API_KEY`、安装节补切换方法；
- product-guide：FAQ/流程补充；两个 Provider 包各带 README（Model Experience 格式）；
- `pack:all` 追加 image-volcengine（5 个 tarball）。

## 5. 工作分解与提交序列（原子提交）

| 序  | 提交                                        | 内容                                                         | 验收                  |
| --- | ------------------------------------------- | ------------------------------------------------------------ | --------------------- |
| ①   | `docs: M4 实施计划`                         | 本文档                                                       | 计划评审通过          |
| ②   | `feat(image-volcengine): 火山方舟 Provider` | 新包骨架 + generate/edit + 单测                              | 包内单测全绿          |
| ③   | `feat(tool-ui-mockup): 工具编辑入口`        | baseImage/editNote 参数 + execute edit 分支 + prompt/history | 既有测试回归 + 新单测 |
| ④   | `feat(tool-ui-mockup): 提供方状态与面板`    | provider/status 端点 + 火山卡点亮 + 测试连接分提供方 + i18n  | 面板单测/快照         |
| ⑤   | `build(bundle): 双 Provider 挂载行`         | cordis.patch.yml + pack:all + bundle README                  | pack:all 5 包         |
| ⑥   | `test: 组合测试与文档同步`                  | volcengine 组合 boot / edit 路径 / disabled 互斥 + 文档回写  | 全门禁绿              |

> ⑥ 若体量过大，拆 `test:` 与 `docs:` 两笔。每笔提交前跑
> `pnpm test && pnpm typecheck && pnpm lint && pnpm format:check`。

## 6. 测试矩阵

**单测（image-volcengine）**：模型分层默认与显式覆盖；size 翻译三分支；reference
data URL 注入与路径逃逸拒绝；watermark=false / response_format=url 断言；n 串行多次调用；
429 退避重试与耗尽；401→MISSING_CREDENTIAL；400/403/5xx/缺 data→对应错误码；
edit：image+prompt 组装、mask→NOT_IMPLEMENTED；signal 取消传播；凭据解析链三级回退。

**单测（tool-ui-mockup）**：参数校验（baseImage 无 editNote / 反之 → INVALID_PARAMETER，
提示要么都传要么都不传）；edit 分支 spec 组装（cwd 语义分流复用 reference 翻译）；
历史行 status=edited；prompt 编辑模板。

**组合测试（真实 cordis.yml）**：volcengine 行启用时 `ctx.image` 为 VolcengineImageProvider；
工具 baseImage+editNote 端到端（mock fetch 断言请求体、附件落盘、history）；
双 Provider 行并存时单槽位生效（disabled 互斥）；dashscope 行为回归不受影响。

**门禁**：test / typecheck / lint / format:check / build / pack:all 全绿。

## 7. 风险与回退

| 风险                                       | 缓解                                                                                                                  |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| 方舟 API 事实与 §3 有出入（字段/错误结构） | §3.6 核对清单 + 实现按防御式解析（两种错误包裹都识别）；烟测脚本 `scripts/generate-smoke.ts` 扩展 volcengine 分支实测 |
| seedream 编辑对 UI 草图类内容效果不佳      | 编辑入口为可选参数，不改变既有"重新生成"主路径                                                                        |
| 双 Provider 同时启用（用户 patch 误配）    | 后挂载者胜出（cordis 单槽位语义）；provider/status 如实反映生效方，不静默                                             |
| 同步长请求挂死                             | requestTimeoutMs 配置化 + signal 取消传播（fetch 原生 AbortSignal）                                                   |
