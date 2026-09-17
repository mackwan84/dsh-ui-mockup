# DashScope Image Editing and Thinking-Mode Facts

[中文](../../references/dashscope-image-edit-and-thinking-mode.md)

> Reviewed 2026-09-04. Primary facts are from official Alibaba Cloud Model Studio documentation updated around 2026-09-02. This review made no new live API calls; repository live observations are explicitly labeled. Each statement is identified as official documentation, inference, or repository observation where relevant.

> Core conclusions:
>
> 1. Base image plus natural-language instruction editing is available in qwen-image-3.0 and qwen-image-3.0-pro using the same asynchronous endpoint and request/response structure as the existing generation path, so its polling pipeline can be reused.
> 2. qwen-image-3.0 has enable_thinking, defaulting to true; send false to disable it. No thinking_budget-style depth control or numerical duration is published.
> 3. Qwen image models have no mask parameter. Masked local inpainting belongs to a distinct Wanx wanx2.1-imageedit endpoint and schema.

## 1. Endpoint and domains

- The 3.0 asynchronous endpoint is POST https://{WorkspaceId}.cn-beijing.maas.aliyuncs.com/api/v1/services/aigc/image-generation/generation, with required X-DashScope-Async: enable. It returns output.task_id, then uses GET /api/v1/tasks/{task_id}. Sources: [Chinese API reference](https://help.aliyun.com/zh/model-studio/qwen-image-generation-and-editing-api-reference) and [English API reference](https://www.alibabacloud.com/help/en/model-studio/qwen-image-generation-and-editing-api-reference).
- Repository observation: text-to-image through the legacy https://dashscope.aliyuncs.com domain works for qwen-image-3.0 and qwen-image-3.0-pro. Whether the same legacy domain supports 3.0 I2I is unconfirmed; official examples use workspace-specific domains.

## 2. Models with editing capability

Official documentation lists qwen-image-3.0-pro as flagship T2I/I2I and recommends it for editing; qwen-image-3.0 as the standard quality/speed balance; qwen-image-2.0-pro; qwen-image-2.0; qwen-image-edit-max; qwen-image-edit-plus; and qwen-image-edit. Most support 1–6 outputs, while qwen-image-edit generates one. 3.0 output pixels range from 512x512 through 2048x2048 with ratios 1:8–8:1. The edit/2.0 family adjusts explicit size to a nearby multiple of 16; qwen-image-edit has no selectable size.

The official editing guide recommends qwen-image-3.0-pro and qwen-image-3.0. Sources: [Image Edit API](https://help.aliyun.com/zh/model-studio/qwen-image-edit-api) and [English editing guide](https://www.alibabacloud.com/help/en/model-studio/qwen-image-edit-guide).

## 3. 3.0 I2I editing and existing-pipeline compatibility

- The request structure matches text-to-image: model, input.messages, and parameters. I2I has one to three image items and exactly one text instruction; T2I has only the text item. The official recommendation is no more than 4500 tokens for text.
- Inputs may be public HTTP(S) URLs or data URLs, in JPG/JPEG/PNG/BMP/TIFF/WEBP/GIF. Recommended dimensions are 384–2048px and one file is no more than 10MB.
- Shared parameters include prompt_extend, prompt_extend_mode, enable_thinking, n from 1 to 6, size as width*height, negative_prompt, seed, and watermark. prompt_extend_mode agent is T2I-only; using it for I2I produces 400.
- The task state machine is PENDING to RUNNING to SUCCEEDED or FAILED, with CANCELED and UNKNOWN states. On success, output.choices message content image is a 24-hour PNG URL. Usage reports output size and input/output image counts and types.
- Implementation inference: the asynchronous endpoint, async header, task polling, and image extraction match this repository’s existing generation path. I2I editing can prepend the baseline image before the edit instruction without changing polling, retry, or image extraction. The legacy-domain I2I path itself is not yet live-verified.

## 4. Edit and 2.0 synchronous family

- qwen-image-edit and 2.0 use synchronous POST /api/v1/services/aigc/multimodal-generation/generation, without X-DashScope-Async. Official SDK documentation says it does not support asynchronous calls.
- Inputs are one to three images plus one edit instruction. The output aspect ratio follows the last input image. Inputs accept public URLs, temporary OSS URLs, or data URLs; GIF uses only its first frame.
- Parameters include n, negative_prompt, size where applicable, prompt_extend where applicable, watermark, and seed. There is no enable_thinking and no mask.
- The synchronous result still uses output.choices message content image, but integration requires a new long-timeout synchronous HTTP path. Existing image extraction can be reused.

## 5. Editing semantics

Official documentation promises operations such as text changes, adding/removing/moving objects, action changes, style transfer, and detail enhancement. Its examples preserve unedited content through prompt constraints such as do not change named buildings or people. It does not promise deterministic pixel-level preservation of unspecified regions. The safe interpretation is whole-image conditional redraw guided by the input and prompt, similar to Volcengine Seedream instruction editing.

## 6. Thinking mode

- enable_thinking exists for qwen-image-3.0. It defaults to true; enabling it improves reasoning/image quality but increases generation time. It requires prompt_extend=true, supports Direct T2I, Direct I2I, and Agent T2I, and does not support Agent I2I. Source: the [3.0 API reference](https://www.alibabacloud.com/help/en/model-studio/qwen-image-generation-and-editing-api-reference).
- To disable it, send prompt_extend true and enable_thinking false in parameters.
- The docs do not say whether prompt_extend=false automatically disables thinking. The robust off configuration sets prompt_extend true and enable_thinking false explicitly.
- No image-model thinking_budget, numerical thought duration, or gateway timeout ceiling was found in official documentation.
- Repository observation: one default-thinking pro image can take more than five minutes; allow a polling window of at least ten minutes. The current provider sends neither field, so official defaults imply thinking remains on.

## 7. Masked editing

- Qwen 3.0 and qwen-image-edit parameter tables contain no mask or mask_image_url.
- DashScope offers masked editing through Wanx wanx2.1-imageedit with function description_edit_with_mask. Its white RGB 255,255,255 mask region is edited and black RGB 0,0,0 is retained; the mask must match base-image dimensions. It is a distinct endpoint and schema: POST /api/v1/services/aigc/image2image/image-synthesis, asynchronous task polling, and output.results url rather than Qwen choices message content image. Source: [Wanx image edit API](https://www.alibabacloud.com/help/en/model-studio/wanx-image-edit-api-reference).
- Therefore mask support is a separate future project, not a reuse of the Qwen 3.0 path.

## 8. Other facts and recommendations

- 3.0 prompts are recommended at no more than 4500 tokens. For edit/2.0, 2.0 allows 1300 tokens and other edit models 800 before truncation.
- An unreachable input image URL fails with BadRequest.InputDownloadFailed; this supports the repository preference for inlined base64 images.
- Officially supported editing languages are Simplified Chinese and English; other languages are not guaranteed.
- Recommended integration: use qwen-image-3.0 I2I first because it reuses the asynchronous pipeline. Prefer qwen-image-3.0-pro for quality and qwen-image-3.0 for speed. Inputs are no more than 10MB and 384–2048px; editing remains a whole-image conditional redraw with no mask or pixel-preservation guarantee.
- A synchronous edit/2.0 integration remains a later option because it needs its own long-timeout HTTP path. Wanx masked editing should be proposed only when a true mask requirement exists.
