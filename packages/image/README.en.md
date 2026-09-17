# @mackwan84/dsh-image

[中文](README.md)

Service Definition for the image-generation capability. It supplies the provider-agnostic contract used by UI Mockup generation and editing.

- `ImageGenerationService`: abstract service base class; implementations register themselves as `ctx.image` when loaded.
- `ImageGenerateSpec` / `ImageEditSpec` / `ImageGenerateResult`: request and result types.
- `ImageProviderError`: normalized errors (`MISSING_CREDENTIAL`, `RATE_LIMITED`, `TASK_FAILED`, `TIMEOUT`, `NOT_IMPLEMENTED`, `HTTP_ERROR`, `NETWORK_ERROR`, `BAD_RESPONSE`, and `INVALID_PARAMETER`).

## Semantic Contract

- A provider failure rejects with `ImageProviderError`. Transport failures such as a broken connection (reported by undici as `TypeError`) use `NETWORK_ERROR`; caller-initiated cancellation and non-transport exceptions, including programming errors, remain unchanged.
- Result URLs are time-limited. Consumers must download and persist them immediately.
- Implementations must honor `AbortSignal` for requests and polling.

## Model Experience

This package has no model-visible content. It is the contract layer between providers and consumers.
