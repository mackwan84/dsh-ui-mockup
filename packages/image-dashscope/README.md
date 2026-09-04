# @mackwan84/dsh-image-dashscope

阿里云百炼图像生成 Provider，实现 `@mackwan84/dsh-image` 的 `ImageGenerationService`：

- **qwen-image 3.0 系列**：`/api/v1/services/aigc/image-generation/generation` 异步任务（`input.messages` 结构，本 Provider 支持单张参考图的 I2I 风格一致）；
- **Wan 2.7 系列**：同一新版异步端点与 `input.messages` 结构，仅支持
  `wan2.7-image` / `wan2.7-image-pro`，支持文生图与单参考图 I2I；
- 任务轮询、**限流自动退避重试**（`Throttling.RateQuota` → 25s × 2）、`AbortSignal` 取消；
- 凭据解析：`ctx.credentials` seam → 启动环境（`.env`/进程环境）→ `MISSING_CREDENTIAL`；
- 凭据请求 `redirect: 'error'`（凭据不跟随重定向）。

## 配置（cordis.yml `config` 块）

| 键                   | 默认                             | 说明                   |
| -------------------- | -------------------------------- | ---------------------- |
| `apiKey`             | `DASHSCOPE_API_KEY`              | 凭据引用（环境变量名） |
| `baseUrl`            | `https://dashscope.aliyuncs.com` | 网关（国内）           |
| `wireframeModel`     | `qwen-image-3.0`                 | 线框图模型             |
| `highFidelityModel`  | `qwen-image-3.0-pro`             | 高保真模型             |
| `pollTimeoutMs`      | 600000                           | 轮询总时限             |
| `pollIntervalMs`     | 5000                             | 轮询间隔               |
| `rateLimitRetries`   | 2                                | 限流重试次数           |
| `rateLimitBackoffMs` | 25000                            | 限流退避间隔           |

## Model Experience

本包无模型可见内容；错误以 `ImageProviderError.code` 区分可重试、限流、凭据与参数问题。

## Wan 2.7 尺寸

- Web 缺省 `2048*1152`，Mobile 缺省 `1152*2048`；
- `wan2.7-image` 支持 1K/2K 或官方像素合法域，不支持 4K；
- `wan2.7-image-pro` 仅在纯文生图允许 4K，参考图 I2I 最高 2K；
- `n` 统一钳制为 1～4；不启用组图模式；
- Wan 2.2/2.6、wanx 与未知模型在本地返回 `INVALID_PARAMETER`，不会猜测旧端点。

## Known Limitations

- `edit`（指令编辑/掩码局部重绘）为 `NOT_IMPLEMENTED`：百炼编辑链路尚未在本仓实测；
  编辑模式当前请启用火山方舟 Provider（`@mackwan84/dsh-image-volcengine`，Seedream 5.0 Pro）；
- 参考图模式支持 qwen-image 与 Wan 2.7；当前 data URL 链路以生成资产 PNG 为正式回归基线；
- `reference` 路径会被限制在 `cwd`（缺省为进程工作目录）之内，逃逸路径直接以 `INVALID_PARAMETER` 拒绝。
