# @mackwan84/dsh-image-dashscope

[中文](README.md)

Alibaba Cloud DashScope image-generation provider implementing `ImageGenerationService` from `@mackwan84/dsh-image`:

- **qwen-image 3.0 family**: asynchronous `/api/v1/services/aigc/image-generation/generation` tasks using `input.messages`; this provider supports one reference image for I2I style consistency.
- **Wan 2.7 family**: the same modern asynchronous endpoint and `input.messages` schema. Only `wan2.7-image` and `wan2.7-image-pro` are supported, with text-to-image and one-reference I2I.
- Task polling, **automatic rate-limit backoff** (`Throttling.RateQuota` → 25s × 2), and `AbortSignal` cancellation.
- Credential resolution: `ctx.credentials` seam → startup environment (`.env` / process environment) → `MISSING_CREDENTIAL`.
- Credential-bearing requests use `redirect: 'error'`; credentials never follow redirects.

## Configuration (`config` block in `cordis.yml`)

| Key                  | Default                          | Description                                      |
| -------------------- | -------------------------------- | ------------------------------------------------ |
| `apiKey`             | `DASHSCOPE_API_KEY`              | Credential reference (environment variable name) |
| `baseUrl`            | `https://dashscope.aliyuncs.com` | Mainland China gateway                           |
| `wireframeModel`     | `qwen-image-3.0`                 | Wireframe model                                  |
| `highFidelityModel`  | `qwen-image-3.0-pro`             | High-fidelity model                              |
| `pollTimeoutMs`      | `600000`                         | Total polling limit                              |
| `pollIntervalMs`     | `5000`                           | Polling interval                                 |
| `rateLimitRetries`   | `2`                              | Rate-limit retry count                           |
| `rateLimitBackoffMs` | `25000`                          | Rate-limit backoff interval                      |

## Model Experience

This package has no model-visible content. `ImageProviderError.code` distinguishes retryable, rate-limit, credential, and parameter failures. A 401 or `InvalidApiKey` during creation or polling maps to `MISSING_CREDENTIAL`; fetch transport failures map to `NETWORK_ERROR`; caller cancellation and non-transport exceptions remain unchanged.

## Wan 2.7 dimensions

- Web defaults to `2048*1152`; Mobile defaults to `1152*2048`.
- `wan2.7-image` supports 1K/2K or the official valid pixel domain, not 4K.
- `wan2.7-image-pro` permits 4K only for text-to-image; reference-image I2I is limited to 2K.
- `n` is clamped to 1–4; image grouping is disabled.
- Wan 2.2/2.6, wanx, and unknown models fail locally with `INVALID_PARAMETER`; the provider never guesses a legacy endpoint.

## Known limitations

- `edit` (instruction editing / masked inpainting) is `NOT_IMPLEMENTED`: the DashScope editing path has not been verified in this repository. Use the Volcengine provider (`@mackwan84/dsh-image-volcengine`, Seedream 5.0 Pro) for editing.
- Reference-image mode supports qwen-image and Wan 2.7. The data-URL path based on generated PNG assets is the supported regression baseline.
- A `reference` path is constrained inside `cwd` (the process working directory by default). Escapes are rejected with `INVALID_PARAMETER`.
