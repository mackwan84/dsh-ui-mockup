# @mackwan84/dsh-image-volcengine

[中文](README.md)

Volcengine Ark image-generation provider implementing `ImageGenerationService` from `@mackwan84/dsh-image`:

- **doubao-seedream 4.0 family**: synchronous `/api/v3/images/generations` calls for text-to-image and reference-image I2I. The API accepts up to 14 references; this provider embeds one data URL.
- **doubao-seedream 5.0 pro**: instruction editing through the same endpoint, with a base image and edit instruction.
- **Synchronous API**: no task polling; configurable request timeout, combining caller cancellation with `AbortSignal.any`.
- **Automatic rate-limit backoff** (HTTP 429 and errors such as `ModelAccountIpmRateLimitExceeded` → 25s × 2).
- Fixed `response_format: 'url'` and `watermark: false` for mockups.
- Credential resolution: `ctx.credentials` seam → startup environment (`.env` / process environment) → `MISSING_CREDENTIAL`.
- Credential-bearing requests use `redirect: 'error'`; credentials never follow redirects.

## Configuration (`config` block in `cordis.yml`)

| Key                  | Default                                    | Description                                                                                 |
| -------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------- |
| `apiKey`             | `ARK_API_KEY`                              | Credential reference (environment variable name)                                            |
| `baseUrl`            | `https://ark.cn-beijing.volces.com/api/v3` | Mainland China gateway; BytePlus serves international deployments                           |
| `wireframeModel`     | `doubao-seedream-4-5-251128`               | Fallback for upstream draft usage; UI Mockup never sends wireframe generation to Volcengine |
| `highFidelityModel`  | `doubao-seedream-5-0-pro-260628`           | High-fidelity model                                                                         |
| `editModel`          | `doubao-seedream-5-0-pro-260628`           | Instruction-editing model                                                                   |
| `requestTimeoutMs`   | `300000`                                   | Synchronous request timeout; Ark has not published an upper gateway limit                   |
| `rateLimitRetries`   | `2`                                        | Rate-limit retry count                                                                      |
| `rateLimitBackoffMs` | `25000`                                    | Rate-limit backoff interval                                                                 |

## `size` translation

Ark and DashScope use different aspect-ratio systems. This package translates the plugin’s unified size (`"width*height"` or a tier) into Ark’s format:

- Generation (Seedream) defaults to the **2K tier**: the product decision is that every output is at least 2K, while the gateway chooses resolution and direction from the content. Accepted tiers are `1K`/`2K`/`4K`, or explicit `widthxheight`. Observed valid generation bounds are total pixels from 2560×1440 (3,686,400) through 4096×4096, and an aspect ratio in `[1/16, 16]`; values outside the bounds are proportionally scaled.
- Editing (Seedream) also defaults to **2K** and preserves the base image aspect ratio. Explicit values are only normalized and delegated to the gateway. A `2048x1152` edit has succeeded despite falling below the generation minimum, so generation clamping is intentionally not reused. Retired SeedEdit `adaptive` is rejected locally with `INVALID_PARAMETER`.

## Model Experience

This package has no model-visible content. Error semantics use `ImageProviderError.code`: 401/`AuthenticationError` → `MISSING_CREDENTIAL`, 429 → `RATE_LIMITED` with backoff, 400/`InvalidParameter` → `INVALID_PARAMETER`, other non-2xx responses → `HTTP_ERROR`, and fetch transport failures → `NETWORK_ERROR`. Caller cancellation and programming errors remain unchanged; an exhausted synchronous window is `TIMEOUT`.

## Known limitations

- **Product scope:** other consumers may call this provider’s `generate`, but UI Mockup only guarantees Volcengine for high-fidelity design images and whole-image instruction editing. A wireframe request is rejected at the tool layer with an actionable prompt to switch provider.
- **Masked inpainting is unsupported:** Ark has no mask-editing capability. Passing `ImageEditSpec.mask` returns `NOT_IMPLEMENTED`; editing is whole-image instruction regeneration.
- Multi-image requests are serialized into single-image calls. Ark’s `sequential_image_generation` differs from DashScope’s `parameters.n` and is not a verified replacement.
- `reference` and `baseImage` paths are constrained inside `cwd` (the process working directory by default); escapes are rejected with `INVALID_PARAMETER`.
- Ark has not published the gateway ceiling for long synchronous requests. `requestTimeoutMs` defaults to 300 seconds and can be increased when needed.
