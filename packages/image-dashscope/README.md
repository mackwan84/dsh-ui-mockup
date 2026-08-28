# @mackwan84/dsh-image-dashscope

阿里云百炼图像生成 Provider，实现 `@mackwan84/dsh-image` 的 `ImageGenerationService`：

- **qwen-image 3.0 系列**：`/api/v1/services/aigc/image-generation/generation` 异步任务（`input.messages` 结构，支持 1-3 张参考图的 I2I 风格一致）；
- **wanx 系列**：`/api/v1/services/aigc/text2image/image-synthesis` 异步任务（纯文生图）；
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

## Known Limitations

- `edit`（指令编辑/掩码局部重绘）为 `NOT_IMPLEMENTED`：百炼编辑链路尚未在本仓实测；
  编辑模式当前请启用火山方舟 Provider（`@mackwan84/dsh-image-volcengine`，seededit 3.0）；
- 参考图模式仅支持 qwen-image 系列模型；
- `reference` 路径会被限制在 `cwd`（缺省为进程工作目录）之内，逃逸路径直接以 `INVALID_PARAMETER` 拒绝。
