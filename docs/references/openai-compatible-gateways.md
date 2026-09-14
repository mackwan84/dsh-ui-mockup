# OpenAI 兼容生图网关事实清单

> 首次核对日期：2026-09-14。事实来自本仓 v0.3.0 迭代准备期的真实网关活体验证
> （one_api / new_api 系私有网关，模型为 gpt-image 系）与 OpenAI Images API
> 官方文档交叉核对；不确定处标注「未确认」。本页是 openai-compat Provider
> 实现与「已知限制」口径的依据，复核时按此更新。

## 1. 协议面与最小公共子集

- **生图端点**：`POST {baseUrl}/images/generations`，`Authorization: Bearer $KEY`，
  JSON 请求体。这是各聚合网关对 OpenAI Images API 的通用兼容面。
  来源：[OpenAI Images API 文档](https://platform.openai.com/docs/api-reference/images)（协议基准）。
- **本仓承诺的最小公共子集**：`model + prompt + n + size` 四参数。`quality` /
  `style` / `background` / `response_format` / `watermark` 等参数各方言不一，
  一律不发送（`response_format` 缺省时网关自决，两种返回格式都可能出现）。
- **多图 `n`**：OpenAI 官方原生支持；但 **new_api 系部分网关拒绝 `n > 1`**
  （HTTP 400 请求参数无法处理），此时表现为 `INVALID_PARAMETER` 错误透传，
  用户可用 `n=1` 多次调用规避。来源：本机生图 CLI 技能排障记录（2026-09-14）。
- **尺寸**：官方为预设枚举（`1024x1024` / `1024x1536` / `1536x1024` 等）；
  走 images API 的非官方模型（如千问系经网关代理）可能接受任意 `WxH`。
  本仓策略：`W*H` 归一 `WxH` 后透传，不改比例、不设本地白名单，由网关校验。

## 2. 返回格式与归一

- `data[]` 条目为 `url`（临时链接，官方 24h 级时效）或 `b64_json`（base64 图片字节）；
  gpt-image 系官方只回 `b64_json`。来源：[OpenAI Images API 文档](https://platform.openai.com/docs/api-reference/images)。
- 本仓归一策略：`b64_json` → data URL；`url` 原样透传，由消费方立即下载转存
  进资产库（url 永不持久化）。**已知限制**：若网关返回的 url 需要鉴权头才能
  下载，消费方裸 fetch 会失败——遇到时在 Provider 内做带鉴权下载（未实现）。

## 3. 错误体方言

- 官方包裹为 `error: { code, message }`；网关侧**顶层 `code` / `message` 写法
  常见**（new_api 系等）。两种包裹都识别，避免结构差异把可判定错误变成 BAD_RESPONSE。
- **鉴权探测语义**（空体 POST）：401 → 密钥无效；400 / 429 → 鉴权已通过
  （网关鉴权先于参数与配额校验）。
- **模型不存在返回 503 而非 404**（new_api 系实测，`model_not_found`）。
  来源：本机生图 CLI 技能排障记录（2026-09-14）。
- 错误码语义映射：401 / `InvalidApiKey` / `AuthenticationError` → `MISSING_CREDENTIAL`；
  400 / `InvalidParameter` → `INVALID_PARAMETER`；429 → `RATE_LIMITED`；
  其余非 2xx → `HTTP_ERROR`（透传状态码与错误体）。

## 4. 模型发现（GET {baseUrl}/models）

- 返回 `data[].id` 列表，含 chat 模型——**协议上没有任何字段能区分生图模型**，
  因此本仓不做生图/非生图过滤，仅作下拉建议。
- **HTML-200 陷阱（实测）**：base URL 不带 `/v1` 前缀时，`GET {base}/models`
  返回**网关前端 HTML 页面且 HTTP 200**（不是 404）。因此：
  - 模型发现必须先验响应是 JSON，非 JSON 按降级处理；
  - 适配层解析任何响应前先验内容类型，非 JSON 的 2xx 生成响应报
    `BAD_RESPONSE` 并携带响应片段。
    来源：2026-09-14 对真实网关 `curl` 探测（`GET /models` → HTML，`GET /v1/models` → JSON）。
- 同网关 `gpt-image-2` / `gpt-image-2.5-flare` / `gpt-image-2.5-sunburst` 实测可列出。

## 5. 不在最小子集内的端点

- `POST /v1/images/edits`（multipart：image + 可选 mask）不做；
- `POST /v1/images/variations`：**部分 new_api 系网关未实现**（400 Model name
  not specified），同样不做。来源：本机生图 CLI 技能排障记录（2026-09-14）。
- 生成端点带 `image` 参数的网关扩展风格（部分网关的图生图方言）不做；
  参考图（I2I）整体不在 openai-compat 能力面内，风格锚点由消费方跳过注入。

## 6. 对实现的关键结论

1. baseUrl 语义是「填到 `/v1 为止」的完整前缀，默认空、未配置给明确错误，
**不自动补 `/v1`**（补错前缀会踩 HTML-200 陷阱且难以归因）。
2. 解析任何响应体前先 `JSON.parse` 防御，失败保留前 200 字符参与错误文本。
3. `n` 原生下传但错误如实透传；429 不做内置退避（与百炼/方舟策略不同，
   私有网关的限流策略差异大，交给调用方决策）。
4. 官方 OpenAI 是可配特例（`baseUrl = https://api.openai.com/v1`），
   兼容基准以网关实测行为为准，不以官方文档为唯一事实源。
