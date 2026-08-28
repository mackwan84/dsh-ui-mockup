# 火山方舟(Volcengine Ark)图像 API 事实清单

> 调研日期:2025 年(以官方文档当前版本为准)。主要事实来自官方文档原文(已抓取并解析正文),
> 少数点通过高可信镜像/国际站文档交叉验证,不确定处均标注「未确认」。

## 1. 端点与认证

- **国内站数据面 Base URL**:`https://ark.cn-beijing.volces.com/api/v3`,图像生成完整 URL:
  `POST https://ark.cn-beijing.volces.com/api/v3/images/generations`
  来源:[方舟「Base URL 及鉴权」文档](https://www.volcengine.com/docs/82379/1298459)、[「图片生成 API」文档](https://www.volcengine.com/docs/82379/1541523)(原文首行即 `POST https://ark.cn-beijing.volces.com/api/v3/images/generations`)。
- **认证**:HTTP 头 `Authorization: Bearer $ARK_API_KEY`(API Key 鉴权,在方舟控制台「API Key 管理」获取长效 Key);也支持 AK/SK 签名鉴权,但 **AK/SK 鉴权时 model 字段必须填 Endpoint ID**。
  来源:同上「Base URL 及鉴权」文档(原文:"在 HTTP 请求 header 中添加 Authorization: Bearer $ARK_API_KEY"、"通过 Access Key 鉴权,model 字段需配置为 Endpoint ID")。
- **国际站(BytePlus ModelArk)**:数据面 Base URL 为 `https://ark.ap-southeast.bytepluses.com/api/v3`,认证同样为 `Authorization: Bearer $ARK_API_KEY`。
  来源:[BytePlus ModelArk「Base URL and authentication」](https://docs.byteplus.com/en/docs/ModelArk/1298459)。
- **方舟没有独立的 `/images/edits` 端点**:图像编辑(SeedEdit)与文生图/图生图复用同一个 `POST /api/v3/images/generations`。部分第三方网关(如 cometapi)自行提供 OpenAI 风格 `/images/edits`,那不是方舟官方接口。
  来源:[Generations(SeedEdit 3.0)— 302.AI 镜像(复制自官方文档)](https://share.apifox.cn/apidoc/docs-site/4012774/ru/324771671e0)、[gptproto「official-format」SeedEdit 文档](https://docs.gptproto.com/docs/api/Doubao/seededit-3-0-i2i-250628/official-format/image-edit)(均显示 `POST /api/v3/images/generations`)。

## 2. 模型与 Model ID / Endpoint ID

- **`model` 参数既可直接填 Model ID(模型名),也可填 Endpoint ID(`ep-xxxx`)**。官方原文:
  "您需要调用的模型的 ID(Model ID)……您也可通过 Endpoint ID 来调用模型,获得限流、计费类型、运行状态查询、监控、安全等高级能力"。
  来源:[图片生成 API 文档 Body 参数 model 字段](https://www.volcengine.com/docs/82379/1541523)。
- 关键模型 ID:
  - `doubao-seedream-4-0-250828`:Seedream 4.0,文生图 + 单图/多图参考图生图 + 组图生成。
  - `doubao-seededit-3-0-i2i-250628`:SeedEdit 3.0,指令式图像编辑(i2i),按 prompt 对输入图做增删改替。
    来源:[BytePlus ModelArk SeedEdit 3.0 模型页](https://docs.byteplus.com/en/docs/ModelArk/1729477)(模型版本 `seededit-3-0-i2i-250628`,按张计费,IPM 限流 500 张/分钟)、上述 SeedEdit Generations 镜像文档。
  - 同文档还覆盖更新的 `doubao-seedream-4-5-251128`、`doubao-seedream-5-0-*`(实现时可先只支持 4.0/seededit 3.0)。
- Model ID 查询入口:[方舟「模型列表」文档](https://www.volcengine.com/docs/82379/1330310)。

## 3. 文生图请求体(Seedream 4.0)

`POST /api/v3/images/generations`,Body(JSON)字段(来源均为[图片生成 API 文档](https://www.volcengine.com/docs/82379/1541523),已逐字段从原文提取):

| 字段                                             | 类型                        | 说明                                                                                                                                                                                                                                                                                                                                 |
| ------------------------------------------------ | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `model`                                          | string,必选                 | Model ID 或 Endpoint ID                                                                                                                                                                                                                                                                                                              |
| `prompt`                                         | string,必选                 | 中英文均可;建议中文 ≤300 字、英文 ≤600 词                                                                                                                                                                                                                                                                                            |
| `image`                                          | string \| string[],可选     | 参考图(见第 4 点)                                                                                                                                                                                                                                                                                                                    |
| `size`                                           | string,可选                 | **两种方式不可混用**:① 档位 `"1K"/"2K"/"4K"`(Seedream 4.0 可选值),并在 prompt 里描述宽高比;② 显式 `"<宽>x<高>"`(如 `2048x2048`),**默认 `2048x2048`**,总像素范围 **[1280x720=921600, 4096x4096=16777216]**,宽高比范围 **[1/16, 16]**(二者需同时满足)。注意 Seedream 4.0 的 `"1024x1024"` 这类低分辨率不合法(低于 1280x720 总像素下限) |
| `response_format`                                | string,默认 `url`           | `url`(下载链接,**24 小时失效**)或 `b64_json`                                                                                                                                                                                                                                                                                         |
| `sequential_image_generation`                    | string,默认 `disabled`      | `auto`=组图模式,`disabled`=单图                                                                                                                                                                                                                                                                                                      |
| `sequential_image_generation_options.max_images` | integer,默认 15,范围 [1,15] | 组图最多生成张数;**输入参考图数 + 生成图数 ≤ 15**                                                                                                                                                                                                                                                                                    |
| `watermark`                                      | boolean,默认 `true`         | `false` 不加水印;`true` 右下角加「AI 生成」水印                                                                                                                                                                                                                                                                                      |
| `stream`                                         | boolean,默认 `false`        | Seedream 4.0/4.5 支持流式输出(SSE 事件)                                                                                                                                                                                                                                                                                              |
| `optimize_prompt_options`                        | object,可选                 | 提示词优化(`mode: standard/fast`)                                                                                                                                                                                                                                                                                                    |
| `tools`                                          | object[],可选               | 联网搜索等(4.5+ 能力)                                                                                                                                                                                                                                                                                                                |

- **`seed`、`guidance_scale` 在 Seedream 4.0/4.5/5.0 的图片生成 API 中不存在**(原文参数表无此字段);它们属于 Seedream 3.0 / SeedEdit 3.0 一代的参数。实现时不要给 seedream-4-0 传这两个字段。

## 4. 参考图生图(I2I)

- 字段:`image`,类型 **`string` 或 `string[]`**,支持两种取值(来源:[图片生成 API 文档](https://www.volcengine.com/docs/82379/1541523) image 字段原文):
  - 图片 URL(需公网可访问);
  - Base64 data URL,格式 `data:image/<图片格式>;base64,<Base64编码>`,**图片格式必须小写**(如 `data:image/png;base64,...`)。
- 张数上限(当前文档版本):**Seedream 4.0 / 4.5 / 5.0 lite 最多 14 张参考图;Seedream 5.0 pro 最多 10 张**。
  (注:早期资料中 seedream 4.0 写「最多 10 张」,现官方文档已更新为 14 张;组图场景另受「参考图 + 生成图 ≤ 15」约束。)
- 单图约束:格式 jpeg/png/webp/bmp/tiff/gif/heic/heif;宽高比 [1/16,16];宽高 >14px;≤30MB;总像素 [196, 6000×6000]。

## 5. 图像编辑(SeedEdit 3.0)与 mask 局部重绘

- **端点**:复用 `POST /api/v3/images/generations`,无独立 edits 端点(见第 1 点)。
- **请求体**(来源:[Generations(SeedEdit 3.0)官方文档镜像](https://share.apifox.cn/apidoc/docs-site/4012774/ru/324771671e0),与 [gptproto official-format](https://docs.gptproto.com/docs/api/Doubao/seededit-3-0-i2i-250628/official-format/image-edit) 一致):
  - 必选:`model`(`doubao-seededit-3-0-i2i-250628`)、`prompt`(编辑指令,如"改成爱心形状的泡泡")、`image`(**单张**待编辑图,URL 或 base64);
  - 可选:`response_format`(url/b64_json)、`size`(示例/默认 `"adaptive"`;显式像素的合法范围**未确认**,疑为总像素 [512x512, 2048x2048])、`seed`(integer,[-1, 2147483647],-1/缺省为随机)、`guidance_scale`(number,[1,10],示例 5.5,值越大越贴 prompt)、`watermark`(boolean,默认 true)。
- **mask 局部重绘:方舟 API 不支持**。Seedream 4.0–5.0 与 SeedEdit 3.0 的请求参数中均无 `mask` 字段;局部编辑只能靠指令式编辑(SeedEdit)或 Seedream 5.0 pro 的"交互编辑"(坐标/框选写在 prompt 里)。
- **「inpainting 涂抹编辑(下线中)」不是方舟 API**:该页面属于「图像生成大模型(智能视觉 CV 服务)」文档(产品 ID 86081),端点为
  `https://visual.volcengineapi.com?Action=CVSync2AsyncSubmitTask&Version=2022-08-31`(查询用 `CVSync2AsyncGetResult`),Header 固定 `Region=cn-north-1, Service=cv`,Body 用 `req_json` 包裹,是**异步任务(提交+轮询)**风格,与方舟 OpenAI 兼容 API 完全不同。
  来源:[inpainting涂抹编辑(下线中)](https://www.volcengine.com/docs/86081/1804490)(已解析原文确认上述 Action/Version/Region/Service)。
- **对实现的影响**:无需理睬该下线页面;方舟 Provider 不提供 mask inpainting,局部编辑走 SeedEdit 3.0 指令编辑即可。

## 6. 响应结构

- **同步返回**(非异步任务轮询):一次 HTTP 请求阻塞到图片生成完毕后一次性返回;Seedream 4.0+ 可选 `stream: true` 走 SSE 流式逐张返回。来源:[图片生成 API 文档](https://www.volcengine.com/docs/82379/1541523)(stream 字段、响应参数节)。
- 非流式响应 JSON(顶层):
  ```json
  {
    "model": "doubao-seedream-4-0-250828",
    "created": 1749720737,
    "data": [{ "url": "https://..." }],
    "usage": { "generated_images": 1, "output_tokens": 4096, "total_tokens": 4096 }
  }
  ```
  - `data[]` 每项:`url`(response_format=url 时,24h 失效)或 `b64_json`;Seedream 4.0+ 还含 `size`(如 `2048x2048`)、`output_format`;**组图模式下某张图失败时该项含 `error:{code,message}`,不影响其他图**(审核失败继续后续生成,500 内部错误则中止)。
  - `usage`:`generated_images`(成功张数,按成功张数计费)、`output_tokens`(= sum(长×宽)/256 取整)、`total_tokens`(当前= output_tokens)。
  - 整请求失败时顶层含 `error: { code, message }`。
    来源:[图片生成 API 文档响应参数](https://www.volcengine.com/docs/82379/1541523);SeedEdit 3.0 响应结构相同(model/created/data/usage.generated_images/error),见 [SeedEdit 镜像文档响应节](https://share.apifox.cn/apidoc/docs-site/4012774/ru/324771671e0)。
- 错误响应:HTTP 状态码 + 结构化错误体 `{"error": {"code": "...", "message": "..."}}`(方舟错误码文档按 HTTP 状态码组织,见下点)。

## 7. 限流与错误码

来源:[方舟「错误码」文档](https://www.volcengine.com/docs/82379/1299023)(已解析原文)。要点:

- **限流统一为 HTTP 429**,`error.code` 有多种,需按 code 区分语义:
  - `RateLimitExceeded.EndpointRPMExceeded` / `RateLimitExceeded.EndpointTPMExceeded`:接入点 RPM/TPM 超限;
  - `APIAccountRpmRateLimitExceeded`:账号级 API RPM 超限;
  - `ModelAccountTpmRateLimitExceeded` / **`ModelAccountIpmRateLimitExceeded`**(IPM=每分钟图片张数,图像模型关键限流维度);
  - `AccountRateLimitExceeded`;
  - `RequestBurstTooFast`:流量突增触发系统保护(应放缓增速);
  - `SetLimitExceeded`:达到「安心体验模式」推理限额,模型服务被暂停(需控制台调整)。
- 其他常见码:`401 AuthenticationError`(API Key 缺失/非法/过期)、`403 AccessDenied`、`400 MissingParameter` / `InvalidParameter`、`400 SensitiveContentDetected.*`(输入文本审核)、`400 OutputImageSensitiveContentDetected.*`(输出图审核)、`500 InternalServerError`。
- 图像模型的并发/限流默认值示例:SeedEdit 3.0 IPM=500 张/分钟(来源:[BytePlus SeedEdit 3.0 模型页](https://docs.byteplus.com/en/docs/ModelArk/1729477));具体额度以控制台接入点配置为准。
- 「FlowLimit」「AccountLimitLimitExceeded」均为**旧 CV 服务/误传**,方舟侧未见到这两个 code(**未确认其存在于方舟**,按官方错误码文档为准)。

## 8. 超时与时延

- **未确认(官方文档未给出数字)**:方舟图片生成 API 的网关同步超时上限、以及 seedream 4.0/seededit 3.0 的官方典型耗时,在本次调研的官方文档中均未找到明确数值。
- 可确认的事实:
  - 接口是**同步**的(非流式时需等服务端生成完毕才返回),Seedream 4.0+ 支持 `stream:true` 用 SSE 降低首图等待(来源:图片生成 API 文档)。
  - 文档建议对时延敏感业务用 `optimize_prompt_options.mode=fast` 或减少组图数量(原文:"如您的业务对生成时延较为敏感,推荐使用 fast 模式")。
  - 组图最多 15 张、参考图最多 14 张,意味着单请求最长耗时可能显著高于单图;**实现上客户端超时应显著大于普通 LLM 请求(建议 ≥120s,组图场景更大),这是工程建议而非官方数字**。

---

## 对 Provider 实现的关键结论

1. **单端点**:只需 `POST {base_url}/images/generations`,文生图/图生图/指令编辑全部复用;不需要 `/images/edits`,没有 mask 能力。
2. **认证**:`Authorization: Bearer <API Key>` 一个头即可;base_url 国内 `https://ark.cn-beijing.volces.com/api/v3`,国际站 `https://ark.ap-southeast.bytepluses.com/api/v3`(做成可配置项)。
3. **model 直填模型名**:`doubao-seedream-4-0-250828` / `doubao-seededit-3-0-i2i-250628` 可直接作为 model 参数,无需用户创建接入点;但也应允许填 `ep-xxxx`。
4. **size 双轨制**:seedream 4.0 支持 `"1K"/"2K"/"4K"` 档位或显式 `"WxH"`(总像素 [1280x720, 4096x4096],宽高比 [1/16,16],默认 2048x2048);**不要传 "1024x1024"**(低于下限)。seededit 3.0 用 `"adaptive"` 最稳。
5. **参数按模型分流**:`seed`/`guidance_scale` 只给 seededit 3.0 传;`sequential_image_generation(+max_images)`/`stream` 只给 seedream 4.0+ 传;`watermark`、`response_format` 通用。
6. **参考图**:`image` 字段接受 URL 或 `data:image/<fmt>;base64,...`(格式名小写),seedream 4.0 最多 14 张,seededit 仅 1 张。
7. **同步响应**:无需轮询;解析 `data[].url`/`data[].b64_json` 即可,url 24h 失效应立即下载;整请求失败看顶层 `error.code/message`,组图部分失败看 `data[].error`。
8. **错误处理**:按 HTTP 状态码 + `error.code` 分类;429 即限流(图像场景重点看 `ModelAccountIpmRateLimitExceeded` 与各 `RateLimitExceeded.*`),可指数退避重试;400 审核类(`SensitiveContentDetected.*`)不应重试,应把 message 透传给用户。
9. **超时**:官方未公布网关上限;建议可配置超时,默认 ≥120s,组图/多参考图场景建议 300s+,或启用 `stream: true`。
10. **下线页面甄别**:docs 产品 ID 86081(visual.volcengineapi.com、req_key/Action 风格)是旧「智能视觉」服务,与方舟(82379)无关,其实现与下线均不影响本 Provider。
