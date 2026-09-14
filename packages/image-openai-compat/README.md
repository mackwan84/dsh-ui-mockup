# @mackwan84/dsh-image-openai-compat

OpenAI 兼容网关图像生成 Provider，实现 `@mackwan84/dsh-image` 的
`ImageGenerationService`。面向 one-api / new-api 等私有聚合网关（官方 OpenAI
是可配特例），锚定 `POST {baseUrl}/images/generations` 同步协议：

- **最小公共子集**：`model + prompt + n + size` 四参数，不发送
  `response_format` / `watermark` 等任何 Provider 专属参数；
- **n 原生下传**：多图一次请求携带 `n`（与方舟 Provider 的串行拆单策略不同）；
- **双返回格式归一**：`data[].b64_json` → data URL；`data[].url` 原样透传，
  由消费方现有下载链路立即转存（url 永不持久化）；
- **尺寸透传**：`"1280*720"` 归一为 `"1280x720"` 后透传，本地不设预设白名单、
  不改比例，由网关自行校验（拒绝时错误透传）；
- **能力边界**：参考图（I2I）与指令编辑（`/v1/images/edits`，multipart）不在
  最小子集内，显式 `NOT_IMPLEMENTED`；
- **无内置退避重试**：429 直接按 `RATE_LIMITED` 上报，由调用方决策；
- 凭据解析：`ctx.credentials` seam → 启动环境（`.env`/进程环境）→ `MISSING_CREDENTIAL`；
- 请求 `redirect: 'error'`（凭据不跟随重定向）。

## 配置（cordis.yml `config` 块）

| 键                  | 默认                    | 说明                                                                               |
| ------------------- | ----------------------- | ---------------------------------------------------------------------------------- |
| `apiKey`            | `OPENAI_COMPAT_API_KEY` | 凭据引用（环境变量名）                                                             |
| `baseUrl`           | （空）                  | 网关地址，填到 `/v1 为止（通常以 /v1 结尾）；空=未配置报明确错误，**不自动补 /v1** |
| `wireframeModel`    | （空）                  | 线框图分层默认模型（部署期预置；空=生成时报可操作错误）                            |
| `highFidelityModel` | （空）                  | 高保真分层默认模型（同上）                                                         |
| `requestTimeoutMs`  | 300000                  | 同步请求超时（生图网关常见 30~120s）                                               |

## 错误语义

| 响应                                          | 错误码                                                                          |
| --------------------------------------------- | ------------------------------------------------------------------------------- |
| 401 / `InvalidApiKey` / `AuthenticationError` | `MISSING_CREDENTIAL`                                                            |
| 400 / `InvalidParameter`                      | `INVALID_PARAMETER`                                                             |
| 429                                           | `RATE_LIMITED`                                                                  |
| 其余非 2xx                                    | `HTTP_ERROR`（透传状态码与 `error.code/message`，兼容顶层 `code/message` 包裹） |
| 响应体非 JSON（如网关前端 HTML 页）           | `{ message: 前 200 字符 }` 参与错误文本                                         |
| 响应缺少图片结果                              | `BAD_RESPONSE`                                                                  |
| 超时 / 连接失败                               | `TIMEOUT` / `NETWORK_ERROR`                                                     |

## 已知网关方言（实测，进 docs/references）

- base URL 不带 `/v1` 时，部分网关 `GET /models` 返回**前端 HTML 页且 HTTP 200**（非 404）；
- new_api 系部分网关拒绝 `n > 1`（400）；模型不存在返回 **503** 而非 404。
