# @mackwan84/dsh-image

[English](README.en.md)

图像生成 capability 的 Service Definition：为 UI 草图生成/编辑提供跨提供方的统一抽象契约。

- `ImageGenerationService`：抽象服务基类，实现类加载即注册为 `ctx.image`；
- `ImageGenerateSpec` / `ImageEditSpec` / `ImageGenerateResult`：请求与结果类型；
- `ImageProviderError`：统一错误（`MISSING_CREDENTIAL` / `RATE_LIMITED` / `TASK_FAILED` / `TIMEOUT` / `NOT_IMPLEMENTED` / `HTTP_ERROR` / `NETWORK_ERROR` / `BAD_RESPONSE` / `INVALID_PARAMETER`）。

## 语义约定

- Provider 失败统一以 `ImageProviderError` reject；连接中断等传输失败（undici 统一抛 `TypeError`）使用 `NETWORK_ERROR`，调用方主动取消仍原样上抛，非传输类异常（如编程错误）也原样上抛；
- 结果 URL 有有效期，Consumer 须立即下载保存；
- 实现必须尊重 `AbortSignal`（中断请求与轮询）。

## Model Experience

本包无模型可见内容；它是 Provider 与 Consumer 之间的契约层。
