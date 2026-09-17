# 阿里云百炼（DashScope）图像编辑能力与思考模式开关事实清单

[English](../en/references/dashscope-image-edit-and-thinking-mode.md)

> 调研日期：2026-09-04（本次核对）。主要事实来自阿里云官方文档
> （help.aliyun.com / alibabacloud.com 的 Model Studio 文档，页面自身标注的
> 更新时间多为 2026-09-02），未做任何真实 API 调用；本仓已有的 2026 实测结论
> 引自 `docs/architecture/overview.md` §8，均注明「本仓实测」。
> 每条事实标注三类来源属性：**官方文档** / **推断** / **本仓实测**。
>
> **核心结论（详见文末「结论与建议」）**：
>
> 1. 「基准图 + 自然语言编辑指令 → 编辑后图像」能力**可用**：`qwen-image-3.0` /
>    `qwen-image-3.0-pro` 原生支持图生图/图像编辑（I2I），且其**异步端点与
>    请求/响应结构和本仓现用链路完全一致**，现有轮询管线可直接复用；
>    `qwen-image-edit` 系列（edit / plus / max）与 `qwen-image-2.0` 系列也提供
>    编辑能力，但走**同步**端点，不能复用轮询管线。
> 2. 思考模式开关**存在**：`qwen-image-3.0` 系列有 `enable_thinking` 参数
>    （默认 `true`），显式传 `false` 即可关闭思考；官方未提供
>    `thinking_budget` 之类的深度调节参数，也未公布具体耗时数字。
> 3. 千问系编辑模型**没有 mask 参数**；掩码局部重绘只存在于万相
>    `wanx2.1-imageedit`（`description_edit_with_mask`），属另一套端点与响应结构。

## 1. 端点与域名

- **3.0 系列异步端点（本仓现用）**：
  `POST https://{WorkspaceId}.cn-beijing.maas.aliyuncs.com/api/v1/services/aigc/image-generation/generation`
  （华北2 北京；新加坡/法兰克福/东京为对应地域域名），请求头必须带
  `X-DashScope-Async: enable`，缺少该头会报错
  「current user api does not support synchronous calls」；受理后返回
  `output.task_id`（`task_status` 通常为 `PENDING`），再轮询
  `GET https://{WorkspaceId}.cn-beijing.maas.aliyuncs.com/api/v1/tasks/{task_id}`。
  来源：[千问-图像生成与编辑3.0 API参考（中文）](https://help.aliyun.com/zh/model-studio/qwen-image-generation-and-editing-api-reference)、
  [Qwen Image Generation and Editing 3.0 API Reference（英文）](https://www.alibabacloud.com/help/en/model-studio/qwen-image-generation-and-editing-api-reference)（官方文档，2026-09-04 核对，页面更新时间 2026-09-02）。
  **本仓实测**：`qwen-image-3.0` / `qwen-image-3.0-pro` 文生图经旧域名
  `https://dashscope.aliyuncs.com` 的同路径异步链路出图成功
  （`docs/architecture/overview.md` §8）。
- **3.0 系列同步端点（官方标注「推荐」）**：
  `POST https://{WorkspaceId}.cn-beijing.maas.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation`，
  一次请求阻塞返回结果，无任务轮询。来源：同上 3.0 API 参考（官方文档）。
- **qwen-image-edit 系列 / qwen-image-2.0 系列编辑端点**：与 3.0 同步端点同路径
  `POST .../api/v1/services/aigc/multimodal-generation/generation`，**仅同步**；
  SDK 章节明确「不支持异步接口」，HTTP 章节未提供任何异步调用方式。
  来源：[千问-图像编辑API参考](https://help.aliyun.com/zh/model-studio/qwen-image-edit-api)（官方文档，2026-09-04 核对）。
- **新旧域名**：官方建议从 `https://dashscope.aliyuncs.com` 迁移至业务空间专属域名
  `https://{WorkspaceId}.cn-beijing.maas.aliyuncs.com`（新加坡为
  `https://dashscope-intl.aliyuncs.com` → `https://{WorkspaceId}.ap-southeast-1.maas.aliyuncs.com`），
  并明确「现有域名仍可正常使用」（英文原文 "The existing domain remains fully
  functional"）。北京与新加坡地域的 API Key 与请求地址相互独立，不可混用。
  来源：同上 3.0 API 参考、[图像编辑API参考](https://help.aliyun.com/zh/model-studio/qwen-image-edit-api)（官方文档）。
- **同步端点在旧域名 `dashscope.aliyuncs.com` 上是否可用**：官方文档所有示例均使用
  `{WorkspaceId}` 专属域名，只有「现有域名仍可正常使用」的概括性表述。
  **未找到公开依据**（未确认，接入时需实测）。

## 2. 具备编辑能力的模型清单

以下模型均出自官方「千问-图像编辑API参考」与「千问-图像生成与编辑3.0 API参考」
的模型概览表（官方文档，2026-09-04 核对）：

| 模型                                                                                             | 定位（官方原文摘述）                                | 输出张数 | 输出分辨率                                                                             |
| ------------------------------------------------------------------------------------------------ | --------------------------------------------------- | -------- | -------------------------------------------------------------------------------------- |
| `qwen-image-3.0-pro`                                                                             | 3.0 旗舰，T2I + I2I 均支持；编辑指南列为「推荐」    | 1–6      | 总像素 512\*512 至 2048\*2048，宽高比 1:8 至 8:1；不传 `size` 时模型自动推荐           |
| `qwen-image-3.0`                                                                                 | 3.0 标准模型，T2I + I2I，官方描述「兼顾质量与速度」 | 1–6      | 同上                                                                                   |
| `qwen-image-2.0-pro`（= `qwen-image-2.0-pro-2026-04-22`；另有快照 `-2026-06-22`、`-2026-03-03`） | 生成与编辑一体，文字渲染/真实质感/语义遵循更强      | 1–6      | 总像素 512\*512 至 2048\*2048；默认 ≈1024\*1024 且宽高比贴近输入图（多图时为最后一张） |
| `qwen-image-2.0`（= `qwen-image-2.0-2026-03-03`）                                                | 「加速版，兼顾效果与响应速度」                      | 1–6      | 同上                                                                                   |
| `qwen-image-edit-max`（= `qwen-image-edit-max-2026-01-16`）                                      | 编辑 Max 系列：工业设计、几何推理、角色一致性更强   | 1–6      | 宽、高各 [512, 2048]；默认 ≈1024\*1024 且宽高比贴近输入图                              |
| `qwen-image-edit-plus`（当前同 `-2025-10-30`；另有快照 `-2025-12-15`）                           | 编辑 Plus 系列，支持多图输出与自定义分辨率          | 1–6      | 同 edit-max                                                                            |
| `qwen-image-edit`                                                                                | 基础版：单图编辑与多图融合                          | 固定 1   | **不可指定**（按默认规则）                                                             |

- 输出格式均为 PNG；`qwen-image-edit` 系列与 2.0 系列指定 `size` 时实际宽高会被
  调整为最接近的 16 的倍数（官方示例：`1033*1032` → `1040*1024`）。
  来源：[图像编辑API参考](https://help.aliyun.com/zh/model-studio/qwen-image-edit-api)（官方文档）。
- 「图像编辑-千问」使用指南的模型推荐：**`qwen-image-3.0-pro`（推荐，旗舰）** 与
  `qwen-image-3.0`（标准，兼顾质量与速度）。
  来源：[图像编辑使用指南（英文）](https://www.alibabacloud.com/help/en/model-studio/qwen-image-edit-guide)（官方文档，2026-09-04 核对）。

## 3. qwen-image-3.0 系列 I2I 编辑（与现有管线的兼容性）

- **请求体结构与文生图完全一致**（官方原文：「异步接口与同步接口共用相同的请求
  参数结构」）：`{ model, input: { messages: [{ role: 'user', content: [...] }] },
parameters }`；I2I 时 `content` 为 **1–3 个 `{"image": "..."}` + 1 个
  `{"text": "..."}`**（T2I 仅 1 个 `text`）；`text` 有且只能有一个，官方建议
  不超过 4500 Token。来源：[3.0 API参考（中文）](https://help.aliyun.com/zh/model-studio/qwen-image-generation-and-editing-api-reference)、
  [英文版](https://www.alibabacloud.com/help/en/model-studio/qwen-image-generation-and-editing-api-reference)（官方文档）。
- **图片输入**：公网 URL（HTTP/HTTPS）或 Base64 data URL
  （`data:{MIME_type};base64,{base64_data}`）；格式 JPG/JPEG/PNG/BMP/TIFF/WEBP/GIF；
  建议宽高 384 至 2048 像素；单张 ≤10MB。来源：同上（官方文档）。
- **parameters（同步与异步共用）**：`prompt_extend`（boolean，默认 `true`）、
  `prompt_extend_mode`（`direct` 默认，`agent` 仅 T2I，I2I 传 `agent` 返回 400）、
  `enable_thinking`（见第 6 节）、`n`（1–6，默认 1）、`size`（`宽*高`）、
  `negative_prompt`、`seed`（[0, 2147483647]）、`watermark`（默认 `false`）。
  来源：同上（官方文档）。
- **异步流程与响应**：创建任务返回 `output.task_id` / `task_status: PENDING`；
  轮询 `GET .../api/v1/tasks/{task_id}`，状态机
  `PENDING → RUNNING → SUCCEEDED / FAILED`（另有 `CANCELED`、`UNKNOWN`）；
  成功后 `output.choices[].message.content[].image` 为 PNG URL（**24 小时有效**），
  另含 `rewrite_status`、`submit_time/scheduled_time/end_time`；
  `usage` 为 `output_width/output_height/input_image_count/input_image_type/
output_image_count/output_image_type`（计量档位按输出面积 ≤2,250,000 为
  `*_1k`，否则 `*_2k`）。来源：[英文版 3.0 API参考](https://www.alibabacloud.com/help/en/model-studio/qwen-image-generation-and-editing-api-reference)（官方文档）。
- **与本仓实现的兼容性（推断，基于上述官方结构对照本仓代码）**：
  - 异步端点、`X-DashScope-Async` 头、`GET /api/v1/tasks/{id}` 轮询、
    `output.choices[].message.content[].image` 解析（`extractImageUrls`）
    与现用文生图链路**完全相同**——I2I 编辑只需在 `content` 里先放基准图
    `{"image": ...}` 再放编辑指令 `{"text": ...}`，**现有轮询管线零改动可复用**；
  - 本仓 2026 实测已验证该异步链路（文生图）在旧域名 `dashscope.aliyuncs.com`
    上可用（本仓实测）；**I2I 走旧域名异步端点本次未实测**，仅有官方文档支持
    （官方文档未区分 T2I/I2I 的端点差异，二者共用同一端点）。

## 4. qwen-image-edit / 2.0 系列编辑（同步端点）

- **端点**：`POST .../api/v1/services/aigc/multimodal-generation/generation`，
  仅同步；请求头只需 `Content-Type: application/json` + `Authorization: Bearer`，
  **不带** `X-DashScope-Async`。SDK 章节原文「不支持异步接口」。
  来源：[图像编辑API参考](https://help.aliyun.com/zh/model-studio/qwen-image-edit-api)（官方文档）。
- **请求体**：`{ model, input: { messages: [{ role: 'user', content: [...] }] },
parameters }`；`content` 为 **1–3 张 `{"image": ...}` + 1 个 `{"text": ...}` 编辑指令**；
  多图按数组顺序编号（提示词可用「图一/图二」或 `[image 1]` 指代），
  **输出图宽高比以最后一张输入图为准**。来源：同上 +
  [图像编辑使用指南（英文）](https://www.alibabacloud.com/help/en/model-studio/qwen-image-edit-guide)（官方文档）。
- **图片输入**：公网 URL、OSS 临时 URL（经「上传文件获取临时 URL」）或
  Base64 data URL；格式 JPG/JPEG/PNG/BMP/TIFF/WEBP/GIF（GIF 动图只处理第一帧）；
  建议宽高 384 至 3072 像素（编辑 API 参考页口径；3.0 API 参考页对 3.0 系列写
  384 至 2048）；单张 ≤10MB。来源：同上（官方文档）。
- **parameters**：`n`（2.0 / edit-max / edit-plus 系列 1–6；`qwen-image-edit`
  固定 1）、`negative_prompt`（≤500 字符）、`size`（`qwen-image-edit` 不支持）、
  `prompt_extend`（默认 `true`；`qwen-image-edit` 不支持）、`watermark`
  （默认 `false`）、`seed`。**无 `enable_thinking`、无 `mask` 字段**。
  来源：[图像编辑API参考](https://help.aliyun.com/zh/model-studio/qwen-image-edit-api)（官方文档）。
- **响应**：同步返回 `output.choices[].message.content[].image`（PNG URL，
  24 小时有效）+ `usage: { image_count, width, height }` + `request_id`；
  失败时顶层 `code/message`（示例 `InvalidApiKey`）。
  **图像提取路径与 3.0 系列/现用解析一致**（`choices[].message.content[].image`），
  但 HTTP 流程是阻塞同步而非任务轮询。来源：同上（官方文档）。
- **对实现的影响（推断）**：接入 edit/2.0 系列需新增同步 HTTP 调用路径
  （长超时阻塞等待），不能复用 `createTask` + `waitForTask` 管线；
  `extractImageUrls` 可直接复用。

## 5. 编辑语义：局部保留还是整图重绘？

- 官方对编辑能力的表述（编辑 API 参考页首段原文）：「支持多图输入和多图输出，
  可精确修改图内文字、增删或移动物体、改变主体动作、迁移图片风格及增强画面细节」。
  来源：[图像编辑API参考](https://help.aliyun.com/zh/model-studio/qwen-image-edit-api)（官方文档）。
- 使用指南展示的编辑类型：多图融合、主体一致性、线稿/深度图/关键点生成、
  文字编辑、元素增删、视角变换、老照片修复上色等；其中「多图融合」官方示例的
  提示词写法是「使用图一的城市照片作为底图。**请勿更改**照片中的真实建筑、
  街道、车辆或人物。保持照片的真实性。」——即**未指定区域的保留靠提示词约束**。
  来源：[图像编辑使用指南（英文）](https://www.alibabacloud.com/help/en/model-studio/qwen-image-edit-guide)、
  [图像编辑API参考（中文）](https://help.aliyun.com/zh/model-studio/qwen-image-edit-api)（官方文档）。
- **官方未承诺像素级保留**：没有任何官方文档声明「未指定区域保持不变」的
  确定性语义（官方文档事实：无此承诺）。**推断**：千问系编辑属于
  「以输入图为条件的整图重绘」，保留程度由模型语义理解与提示词约束决定，
  与火山 Seedream 5.0 Pro 的指令编辑语义相近（见
  `docs/references/volcengine-ark-image-api.md` §5）。

## 6. 思考模式开关（qwen-image-3.0 系列）

- **`enable_thinking` 参数存在**（官方中文原文）：「是否开启思考模式，默认值为
  `true`。开启时，模型将增强推理能力以提升出图质量，但会增加生成耗时。
  **仅在 `prompt_extend=true` 时生效**，适用于 Direct T2I、Direct I2I 和
  Agent T2I，I2I Agent 暂不支持。」英文版表述一致（"Enables thinking mode.
  The default is true. ... It requires prompt_extend=true. Supported for Direct
  T2I, Direct I2I, and Agent T2I. Not supported for I2I Agent."）。
  同步与异步两套参数表中均有该字段。
  来源：[3.0 API参考（中文）](https://help.aliyun.com/zh/model-studio/qwen-image-generation-and-editing-api-reference)、
  [英文版](https://www.alibabacloud.com/help/en/model-studio/qwen-image-generation-and-editing-api-reference)（官方文档，2026-09-04 核对）。
- **关闭方式（官方文档事实）**：在 `parameters` 中传
  `{"prompt_extend": true, "enable_thinking": false}`。
- **生效条件的边界（推断）**：官方只说该参数「仅在 `prompt_extend=true` 时生效」；
  `prompt_extend=false` 时思考模式是否自动关闭、还是「思考照旧但开关参数无效」，
  官方未说明——**未找到公开依据**。稳妥的关思考写法是显式
  `prompt_extend: true` + `enable_thinking: false`，而不是依赖 `prompt_extend=false`。
- **`thinking_budget` 之类的思考深度调节参数**：3.0 图像模型参数表中不存在，
  **未找到公开依据**（文本类深度思考模型有 `enable_thinking`/`thinking_budget`
  体系，见[深度思考模型用法](https://help.aliyun.com/zh/model-studio/deep-thinking)，
  但该页不适用于图像模型——未找到官方将二者关联的表述）。
- **官方对耗时的说法**：仅有定性表述「（开启思考）会增加生成耗时」；
  `qwen-image-3.0-pro` 思考模式的具体耗时数字、网关同步超时上限，
  在本次检索的官方文档中**未找到公开依据**。
  本仓实测：pro 默认思考模式单张可 >5 分钟，轮询窗口需 ≥10 分钟
  （本仓实测，`docs/architecture/overview.md` §8）。
- **当前实现为何慢（推断，基于官方默认值对照本仓代码）**：本仓 Provider 未发送
  `prompt_extend` 与 `enable_thinking`，按官方默认值即
  `prompt_extend=true` + `enable_thinking=true`，思考模式处于开启状态，
  与实测的长耗时一致。

## 7. 掩码（mask）编辑能力

- **千问系（3.0 与 qwen-image-edit 系列）无 mask 参数**：两套参数表均无
  `mask` / `mask_image_url` 字段（官方文档事实）。
- **百炼存在带掩码的编辑模型，但属万相系列**：`wanx2.1-imageedit`
  （通用图像编辑-万相2.1），`function=description_edit_with_mask` 即
  「局部重绘/inpainting」：`mask_image_url` 为**必选**，白色区域
  （纯白 RGB [255,255,255]）为编辑区、黑色区域（纯黑 RGB [0,0,0]）为保留区，
  掩码分辨率必须与基准图一致；另有 `description_edit`（纯指令编辑，无掩码）、
  `stylization_all/local`、`remove_watermark`、`expand`、`super_resolution`、
  `colorization`、`doodle`、`control_cartoon_feature` 等 function。
  来源：[万相-通用图像编辑API参考（英文）](https://www.alibabacloud.com/help/en/model-studio/wanx-image-edit-api-reference)、
  [图像编辑-万相2.1 指南（中文）](https://help.aliyun.com/zh/model-studio/wanx-image-edit)（官方文档，2026-09-04 核对）。
- **万相编辑与现用链路不兼容**：端点为
  `POST .../api/v1/services/aigc/image2image/image-synthesis`（仅华北2 北京地域，
  仅异步：`X-DashScope-Async: enable` + 任务轮询），请求体是
  `{ model, input: { prompt, function, base_image_url, mask_image_url },
parameters }` 的扁平结构，轮询结果是 `output.results[].url`
  （**不是** `choices[].message.content[].image`）；限流为任务下发 2 RPS、
  并发任务 2；官方称处理约 5 至 15 秒。
  来源：同上（官方文档）。**推断**：若未来要做 mask 局部重绘，需要一条全新的
  请求/解析路径，与现有 qwen 管线无复用面（除任务轮询骨架外）。

## 8. 其他相关事实

- **提示词长度**：3.0 系列建议 ≤4500 Token；edit/2.0 系列中 2.0 系列上限
  1300 Token、其他模型 800 Token（超出截断）。
  来源：[3.0 API参考](https://help.aliyun.com/zh/model-studio/qwen-image-generation-and-editing-api-reference)、
  [图像编辑API参考](https://help.aliyun.com/zh/model-studio/qwen-image-edit-api)（官方文档）。
- **参考图下载失败错误**：输入图 URL 不可达时任务以
  `BadRequest.InputDownloadFailed`（"Reference image download failed"）失败。
  来源：[图像 API FAQ](https://www.alibabacloud.com/help/en/model-studio/image-faq)（官方文档，2026-09-04 核对）。
  **推断**：这正是本仓优先使用 base64 内联图片的原因。
- **编辑模型支持语言**：简体中文与英文效果有保证，其他语言不保证。
  来源：[图像编辑使用指南（英文）FAQ](https://www.alibabacloud.com/help/en/model-studio/qwen-image-edit-guide)（官方文档）。
- **文生图页的异步说明**：千问-文生图 API 参考页注明「仅 `qwen-image-plus` 与
  `qwen-image` 支持异步调用」——该句指旧 `qwen-image`/`plus`/`max` 家族
  （走 `ImageSynthesis` 风格端点）；3.0 系列的异步支持由其专属的
  「图像生成与编辑3.0」API 参考页独立规定（见第 1 节），两者不冲突。
  来源：[千问-文生图API参考（英文）](https://www.alibabacloud.com/help/en/model-studio/qwen-image-api)（官方文档，2026-09-04 核对）。

---

## 结论与建议

### (a) 百炼编辑能力：可用，建议立项接入

- **结论：可用**。首选路径是 **`qwen-image-3.0` 系列 I2I**：
  - 端点即本仓现用的异步端点
    `POST {base}/api/v1/services/aigc/image-generation/generation`
    （`X-DashScope-Async: enable`）+ `GET {base}/api/v1/tasks/{task_id}` 轮询；
  - 请求体仅需在现有 `input.messages[0].content` 中，于 `{text}` 编辑指令之前
    追加基准图 `{"image": "<URL 或 base64 data URL>"}`（1–3 张）；
  - 成功响应仍是 `output.choices[].message.content[].image`，
    `extractImageUrls` 与整套轮询/退避/错误映射代码可直接复用；
  - 编辑模型建议用 `qwen-image-3.0-pro`（官方编辑指南推荐档）；
    速度优先时可用 `qwen-image-3.0`。
  - 约束：输入图 ≤10MB、建议宽高 384 至 2048；输出总像素 512\*512 至 2048\*2048、
    宽高比 1:8 至 8:1；编辑语义是「整图条件重绘 + 提示词约束保留」，
    无像素级保留承诺，无 mask。
- **备选路径**：`qwen-image-edit-plus / edit-max / 2.0-pro` 系列编辑质量定位更高
  （多图输出 1–6、可指定分辨率），但走**同步**端点
  `POST .../multimodal-generation/generation`，需要新增长超时同步 HTTP 路径；
  且其在旧域名上的可用性未经文档示例确认（未确认项，见第 1 节）。
  建议作为二期选项，首期不引入。
- **mask 局部重绘**：千问系不可用；万相 `wanx2.1-imageedit`
  `description_edit_with_mask` 可用但是独立端点/结构（北京地域、2 并发），
  建议仅在确有 mask 需求时另行立项。

### (b) 思考模式开关：存在；提速路径排序

1. **显式关闭思考（首选，零模型切换）**：`parameters` 传
   `{"prompt_extend": true, "enable_thinking": false}`。官方明确思考模式
   「增加生成耗时」，关闭后耗时应当下降；官方未公布具体提速幅度
   （未找到公开依据），效果需实测。注意必须保持 `prompt_extend=true`
   才能让该参数生效。
2. **高保真档改用 `qwen-image-3.0` 标准模型**：官方定位「兼顾质量与速度」，
   与 pro 同家族同端点，切换成本仅为配置项。
3. **高保真档改用 `qwen-image-2.0-pro` 或加速版 `qwen-image-2.0`**：2.0 是
   「加速版，兼顾效果与响应速度」，但注意其**没有异步端点**（仅同步
   `multimodal-generation`），会引入第 (a) 节备选路径同款改造，优先级靠后。
4. **维持现状但明确预期**：继续用 `qwen-image-3.0-pro` + 思考模式时，
   保持 ≥10 分钟轮询窗口（本仓实测 >5 分钟/张）；官方未公布耗时上限
   （未找到公开依据）。

### 「未找到公开依据」条目清单

1. `qwen-image-3.0-pro` 是否存在 `thinking_budget` 或任何思考深度细调参数
   （仅查到布尔开关 `enable_thinking`）；
2. 官方对 `qwen-image-3.0-pro` 思考模式/非思考模式的具体耗时数字与网关
   同步超时上限（仅有定性表述「会增加生成耗时」）；
3. `prompt_extend=false` 时思考模式是否自动关闭（官方仅说明
   `enable_thinking` 在 `prompt_extend=true` 时才生效）；
4. 同步端点 `multimodal-generation/generation` 在旧域名
   `dashscope.aliyuncs.com` 上的可用性（官方示例全部使用
   `{WorkspaceId}` 专属域名，仅有「现有域名仍可正常使用」的概括表述）；
5. 千问系编辑对「未指定区域保持不变」的任何确定性承诺（官方示例依赖提示词
   约束，推断为整图条件重绘）；
6. 关闭思考后的实际提速幅度（需本仓实测补充）。
