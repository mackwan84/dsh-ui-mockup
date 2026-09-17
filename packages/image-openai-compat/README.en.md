# @mackwan84/dsh-image-openai-compat

[中文](README.md)

OpenAI-compatible image-generation provider implementing `ImageGenerationService` from `@mackwan84/dsh-image`. It targets private aggregation gateways such as one-api / new-api; official OpenAI is a configurable special case. The provider is anchored to the synchronous `POST {baseUrl}/images/generations` protocol:

- **Minimal common subset:** only `model + prompt + n + size`; it never sends provider-specific fields such as `response_format` or `watermark`.
- **Native `n` pass-through:** multiple images are requested in one call, unlike the serialized Ark strategy.
- **Normalized response formats:** `data[].b64_json` becomes a data URL; `data[].url` is passed through so the consumer can download it immediately. URLs are never persisted.
- **Dimension pass-through:** `"1280*720"` is normalized to `"1280x720"`; no preset whitelist or aspect-ratio rewrite is applied. The gateway performs validation and its rejection is surfaced.
- **Capability boundary:** reference-image I2I and instruction editing (`/v1/images/edits`, multipart) are outside this minimal subset and return `NOT_IMPLEMENTED`.
- **No built-in rate-limit retry:** HTTP 429 becomes `RATE_LIMITED`; the caller decides whether to retry.
- Credential resolution: `ctx.credentials` seam → startup environment (`.env` / process environment) → `MISSING_CREDENTIAL`; requests use `redirect: 'error'`.

## Configuration (`config` block in `cordis.yml`)

| Key                 | Default                 | Description                                                                                                                                  |
| ------------------- | ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `apiKey`            | `OPENAI_COMPAT_API_KEY` | Credential reference (environment variable name)                                                                                             |
| `baseUrl`           | empty                   | Gateway URL through `/v1` (usually ending with `/v1`); empty reports a clear configuration error and **does not append `/v1` automatically** |
| `wireframeModel`    | empty                   | Deployment-time default for the wireframe tier; empty produces an actionable generation error                                                |
| `highFidelityModel` | empty                   | Deployment-time default for the high-fidelity tier                                                                                           |
| `requestTimeoutMs`  | `300000`                | Synchronous request timeout; image gateways commonly take 30–120 seconds                                                                     |

## Error semantics

| Response                                            | Error code                                                                                                  |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| 401 / `InvalidApiKey` / `AuthenticationError`       | `MISSING_CREDENTIAL`                                                                                        |
| 400 / `InvalidParameter`                            | `INVALID_PARAMETER`                                                                                         |
| 429                                                 | `RATE_LIMITED`                                                                                              |
| Other non-2xx                                       | `HTTP_ERROR`, preserving the status and `error.code/message` (including a top-level `code/message` wrapper) |
| Non-JSON response body, such as a gateway HTML page | The first 200 characters participate in the error message                                                   |
| No image result                                     | `BAD_RESPONSE`                                                                                              |
| Timeout / connection failure                        | `TIMEOUT` / `NETWORK_ERROR`                                                                                 |

## Observed gateway dialects

- With a base URL missing `/v1`, some gateways return a frontend HTML page with HTTP 200 from `GET /models`, rather than a 404.
- Some new_api gateways reject `n > 1` with 400; a missing model can return 503 rather than 404.

See the repository’s [gateway facts reference](../../docs/en/references/openai-compatible-gateways.md) for sources and verification context.
