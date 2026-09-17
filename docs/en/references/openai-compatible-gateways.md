# OpenAI-Compatible Image Gateway Facts

[中文](../../references/openai-compatible-gateways.md)

> First checked: 2026-09-14. Facts combine live validation against private one_api and new_api-family gateways during v0.3.0 preparation with the [official OpenAI Images API documentation](https://platform.openai.com/docs/api-reference/images). Uncertain items are marked as unconfirmed. This page is the basis for the openai-compat provider and its stated limitations.

## 1. Protocol and minimal common subset

- Image endpoint: POST {baseUrl}/images/generations, with Authorization: Bearer $KEY and a JSON body. This is the compatibility surface shared by aggregation gateways and the OpenAI Images API.
- Repository contract: only model, prompt, n, and size. Gateway dialects differ for quality, style, background, response_format, and watermark, so the provider never sends them. A gateway decides its default response format.
- Multiple images: official OpenAI supports n, but some new_api-family gateways reject n greater than one with HTTP 400. It becomes INVALID_PARAMETER; users can call repeatedly with n=1.
- Size: official OpenAI uses preset values such as 1024x1024, 1024x1536, and 1536x1024; non-official models proxied through a gateway may accept arbitrary WxH. The provider normalizes W*H to WxH, preserves ratio, and lets the gateway validate it.

## 2. Responses and normalization

- A data entry is a temporary url or b64_json; official gpt-image models return b64_json. See the [OpenAI Images API documentation](https://platform.openai.com/docs/api-reference/images).
- The provider turns b64_json into a data URL and passes url through for immediate consumer download to the asset library. URLs are never persisted.
- Known limitation: if a gateway URL requires authorization headers to download, the consumer’s unauthenticated fetch fails. Authenticated provider download is not implemented.

## 3. Error dialects

- Official errors use an error object with code and message; gateway top-level code/message wrappers are also common. The provider accepts both forms rather than turning a recognizable error into BAD_RESPONSE.
- An empty-body POST is used for credential probing: 401 means invalid key; 400 or 429 proves authentication completed before parameter or quota validation.
- A missing model can return 503 rather than 404, identified as model_not_found, on a verified new_api-family gateway.
- Error mapping: 401, InvalidApiKey, or AuthenticationError becomes MISSING_CREDENTIAL; 400 or InvalidParameter becomes INVALID_PARAMETER; 429 becomes RATE_LIMITED; other non-2xx responses become HTTP_ERROR with status and body preserved.

## 4. Model discovery

- GET {baseUrl}/models returns data ids including chat models. The protocol has no reliable image-model marker, so discovery supplies suggestions only.
- HTML-200 trap, verified: omitting /v1 can make a gateway return its frontend HTML page with HTTP 200, not 404. Discovery validates JSON. A non-JSON successful generation response becomes BAD_RESPONSE and includes a short response excerpt.
- The verified gateway listed gpt-image-2, gpt-image-2.5-flare, and gpt-image-2.5-sunburst.

## 5. Unsupported endpoints

- POST /v1/images/edits, multipart with image and optional mask, is unsupported.
- POST /v1/images/variations is unsupported; some new_api gateways report Model name not specified for it.
- Gateway-specific generation fields that accept an image are unsupported. Reference-image I2I is outside the openai-compat capability and the consumer skips style-anchor injection.

## 6. Implementation conclusions

1. baseUrl is the complete prefix through /v1, defaults to empty, and must not append /v1 automatically. Auto-completion can create the HTML-200 trap and obscure the cause.
2. Parse every response defensively. On parse failure, preserve its first 200 characters in the error text.
3. Pass n through and surface its errors. Do not perform built-in retry for 429; private-gateway rate-limit policies vary and the caller decides.
4. Official OpenAI is configurable through https://api.openai.com/v1, but compatibility behavior is grounded in live gateway evidence rather than official documentation alone.
