# @mackwan84/dsh-image-volcengine

火山方舟（Volcengine Ark）图像生成 Provider，实现 `@mackwan84/dsh-image` 的
`ImageGenerationService`：

- **doubao-seedream 4.0 系列**：`/api/v3/images/generations` 同步调用（文生图 + 参考图
  I2I，参考图最多 14 张、本 Provider 取 1 张内联 data URL）；
- **doubao-seededit 3.0 i2i**：同端点指令编辑（基准图 + 编辑指令，默认编辑模型）；
- **同步 API**：无任务轮询；配置化请求超时（`AbortSignal.any` 组合调用方取消）；
- **限流自动退避重试**（HTTP 429，`ModelAccountIpmRateLimitExceeded` 等错误码 → 25s × 2）；
- 固定 `response_format: 'url'`、`watermark: false`（草图不加水印）；
- 凭据解析：`ctx.credentials` seam → 启动环境（`.env`/进程环境）→ `MISSING_CREDENTIAL`；
- 凭据请求 `redirect: 'error'`（凭据不跟随重定向）。

## 配置（cordis.yml `config` 块）

| 键                   | 默认                                       | 说明                               |
| -------------------- | ------------------------------------------ | ---------------------------------- |
| `apiKey`             | `ARK_API_KEY`                              | 凭据引用（环境变量名）             |
| `baseUrl`            | `https://ark.cn-beijing.volces.com/api/v3` | 网关（国内；国际站为 bytepluses）  |
| `wireframeModel`     | `doubao-seedream-4-0-250828`               | 线框图模型                         |
| `highFidelityModel`  | `doubao-seedream-4-0-250828`               | 高保真模型                         |
| `editModel`          | `doubao-seededit-3-0-i2i-250628`           | 指令编辑模型                       |
| `requestTimeoutMs`   | 300000                                     | 同步请求超时（官方未公布网关上限） |
| `rateLimitRetries`   | 2                                          | 限流重试次数                       |
| `rateLimitBackoffMs` | 25000                                      | 限流退避间隔                       |

## size 翻译

方舟与百炼的画幅体系不同，本包把插件统一 size（`"宽*高"` 或档位名）翻译为方舟格式：

- 生成（seedream）：档位 `1K/2K/4K`，或显式 `宽x高`（合法域：宽高比 [1/16, 16] 且
  总像素 ≤ 4096x4096；边长下限按 短边 ≥ 720 且长边 ≥ 1280 钳制——官方点名
  `1024x1024` 不合法）。缺省按平台给 `1920x1080`（web）/ `1080x1920`（mobile）；
- 编辑（seededit）：缺省 `adaptive`（跟随基准图比例）；显式值只做格式归一，
  交由网关校验。

## Model Experience

本包无模型可见内容；错误以 `ImageProviderError.code` 区分可重试、限流、凭据与参数问题：
401/`AuthenticationError` → `MISSING_CREDENTIAL`，429 → `RATE_LIMITED`（退避重试），
400/`InvalidParameter` → `INVALID_PARAMETER`，其余非 2xx → `HTTP_ERROR`。

## Known Limitations

- **掩码（mask）局部重绘不受支持**：方舟 API 无掩码编辑能力（老 inpainting 涂抹编辑
  属视觉技术服务且已公告下线），`ImageEditSpec.mask` 传参时返回 `NOT_IMPLEMENTED`，
  编辑以整图指令重绘进行；
- 多图请求串行拆为多次单图调用（方舟组图参数 `sequential_image_generation` 语义与
  百炼 `parameters.n` 不同，未在本仓验证）；
- `reference`/`baseImage` 路径会被限制在 `cwd`（缺省为进程工作目录）之内，
  逃逸路径直接以 `INVALID_PARAMETER` 拒绝；
- 同步长请求的网关超时上限官方未公布，`requestTimeoutMs` 默认 300s，可按需调大。
