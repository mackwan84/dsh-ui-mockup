# Volcengine Ark Image API Facts

[中文](../../references/volcengine-ark-image-api.md)

> Initial research: 2025; migration review: 2026-08-28. Most facts come from official documentation and a small number are cross-checked through real browser calls. Uncertain points are marked as unconfirmed.
>
> Migration conclusion: SeedEdit is retired. doubao-seededit-3-0-i2i-250628 returned InvalidEndpointOrModel.NotFound in verification. Instruction editing now defaults to doubao-seedream-5-0-pro-260628; size 2K and explicit 2048x1152 generated real images, while legacy adaptive is rejected by Seedream 5.0 Pro with InvalidParameter.

## 1. Endpoint and authentication

- Mainland China data-plane base URL: https://ark.cn-beijing.volces.com/api/v3. Full image-generation endpoint: POST https://ark.cn-beijing.volces.com/api/v3/images/generations. Sources: [Ark Base URL and authentication](https://www.volcengine.com/docs/82379/1298459) and [Image Generation API](https://www.volcengine.com/docs/82379/1541523).
- Use Authorization: Bearer $ARK_API_KEY. AK/SK signing is also supported, but its model must be an Endpoint ID. See the same official documentation.
- BytePlus ModelArk uses https://ark.ap-southeast.bytepluses.com/api/v3 with the same bearer-token form. Source: [BytePlus Base URL and authentication](https://docs.byteplus.com/en/docs/ModelArk/1298459).
- Ark has no separate images/edits endpoint. Seedream generation, reference I2I, and instruction editing all reuse POST /api/v3/images/generations. Third-party OpenAI-style edits paths are not Ark official APIs. Sources: [Seedream 4.0–5.0 guide](https://www.volcengine.com/docs/82379/1824121?lang=zh) and [Image Generation API](https://www.volcengine.com/docs/82379/1666946).

## 2. Models and IDs

- model accepts either a Model ID or an Endpoint ID such as ep-xxxx. Endpoint IDs enable advanced quota, billing, runtime-status, monitoring, and security controls. Source: [model parameter documentation](https://www.volcengine.com/docs/82379/1541523).
- Relevant IDs: doubao-seedream-4-5-251128 is retained for model-tier fallback and reference I2I; doubao-seedream-5-0-pro-260628 is default high fidelity and instruction editing; doubao-seedream-4-0-250828 remains an explicit override.
- doubao-seededit-3-0-i2i-250628 is migration history only and must not become a default. Model discovery: [Ark model list](https://www.volcengine.com/docs/82379/1330310).

## 3. Seedream generation request

POST /api/v3/images/generations accepts these key JSON fields. Source: [Image Generation API](https://www.volcengine.com/docs/82379/1541523).

| Field                                          | Type                           | Meaning                                                                                                                                                            |
| ---------------------------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| model                                          | required string                | Model ID or Endpoint ID                                                                                                                                            |
| prompt                                         | required string                | Chinese and English supported; official guidance is at most 300 Chinese characters or 600 English words                                                            |
| image                                          | optional string / string array | Reference images; see §4                                                                                                                                           |
| size                                           | optional string                | Either 1K, 2K, 4K or explicit widthxheight; never mix them. Seedream 4.0 defaults to 2048x2048, with total pixels from 1280x720 to 4096x4096 and ratio 1/16 to 16. |
| response_format                                | string, default url            | url expires after 24 hours; b64_json is also supported                                                                                                             |
| sequential_image_generation                    | string, default disabled       | auto enables grouped images; disabled generates one image                                                                                                          |
| sequential_image_generation_options.max_images | integer, default 15            | Group-image maximum is 1–15; references plus generated images must not exceed 15                                                                                   |
| watermark                                      | boolean, default true          | false removes the AI watermark                                                                                                                                     |
| stream                                         | boolean, default false         | Seedream 4.0/4.5 support SSE streaming                                                                                                                             |
| optimize_prompt_options                        | optional object                | Prompt optimization, standard or fast                                                                                                                              |
| tools                                          | optional array                 | Capabilities such as web search in 4.5+                                                                                                                            |

seed and guidance_scale are absent from current Seedream 4.0/4.5/5.0 image-generation parameters and must not be sent as legacy fields.

## 4. Reference-image I2I

- image accepts a public image URL or a base64 data URL such as data:image/png;base64,...; the image format must be lowercase.
- Current official limits are up to 14 references for Seedream 4.0, 4.5, and 5.0 lite and up to 10 for Seedream 5.0 pro. Group mode is additionally constrained by references plus generated images not exceeding 15.
- A single input supports jpeg/png/webp/bmp/tiff/gif/heic/heif, ratio 1/16 to 16, each side greater than 14px, size no more than 30MB, and total pixels from 196 through 6000x6000.

## 5. Seedream 5.0 Pro editing and masks

- Reuses POST /api/v3/images/generations; there is no dedicated edits endpoint.
- Current request shape: model doubao-seedream-5-0-pro-260628, instruction in prompt, base image in the image data-URL array, size 2K by default or explicit widthxheight, response_format url, and watermark false.
- Never send retired SeedEdit adaptive. A real migration call returned HTTP 400 for the old behavior; 2K preserved the baseline aspect ratio and 2048x1152 also succeeded.
- Editing accepts explicit pixels below the observed generation lower bound: 2048x1152 succeeded despite generation’s observed 3686400-pixel lower bound. Editing therefore does not reuse generation clamping; it normalizes and passes explicit values through. Acceptance of smaller values is unconfirmed.
- Ark does not support mask inpainting. There is no mask field. Use Seedream instruction editing or describe coordinates and marked areas in the prompt.
- The retired visual.volcengineapi.com inpainting service belongs to a separate Intelligent Vision product, not Ark, and must not be called by this provider.

## 6. Responses, errors, and timeouts

- The API is synchronous: a non-streaming request returns after generation. Seedream 4.0+ optionally streams via SSE.
- A response has model, created, data with url or b64_json, and usage. A url expires after 24 hours. data entries can include per-image error code/message in group mode without invalidating other images; a request-wide failure is top-level error code/message.
- usage.generated_images bills successful images. output_tokens is the rounded sum of width times height divided by 256; total_tokens currently equals output_tokens.
- HTTP 429 represents rate limiting, including ModelAccountIpmRateLimitExceeded; 401 is AuthenticationError; 400 includes invalid/missing parameters and non-retryable SensitiveContentDetected errors; 500 is InternalServerError. Source: [Ark error codes](https://www.volcengine.com/docs/82379/1299023).
- Ark has not published a numeric synchronous gateway limit or official typical durations. Use configurable client timeouts; 120 seconds or more is an engineering minimum, and 300 seconds or more suits group or multi-reference requests. This is engineering guidance, not an official number.

## 7. Implementation conclusions

1. Use one generation endpoint, bearer authentication, Model IDs or Endpoint IDs, 1K/2K/4K or explicit WxH, no adaptive, and immediate URL download.
2. The current provider inlines one reference or base image and maps structured errors; rate limits can retry, while sensitive-content failures must not retry.
3. UI Mockup product scope is narrower than the raw provider: it guarantees Ark only for high-fidelity designs and whole-image instruction editing. Wireframe requests are refused at the tool layer before Ark is called.
