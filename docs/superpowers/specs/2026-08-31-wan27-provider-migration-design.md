# DashScope Wan 2.7 Provider 迁移设计

## 1. 背景与结论

浏览器真实验收确认：

- `qwen-image-3.0`、`qwen-image-3.0-pro` 的线框图、高保真双图和锚点 I2I 均可用；
- 设置页公开的 `wan2.7-image` 被当前 Provider 错误发送到旧
  `text2image/image-synthesis` 端点，网关返回 HTTP 400 `url error`；
- 旧 `wan2.2-t2i-plus` 仅在显式传入不超过单边 1440 的尺寸后可生成，且中文文字质量明显弱于
  Qwen；
- 用户已确认废弃 Wan 2.2 等旧模型，不再维护旧端点兼容层。

本次迁移只保留当前 Wan 2.7：`wan2.7-image` 与 `wan2.7-image-pro`。删除旧 Wan
`text2image` 路径、响应结构和相关测试，改为使用 Wan 2.7 官方异步图像生成端点。

官方依据：

- [Wan 2.7 图像生成与编辑 API](https://help.aliyun.com/zh/model-studio/wan-image-generation-and-editing-api-reference)
- [百炼图片生成与编辑模型列表](https://help.aliyun.com/zh/model-studio/image-model)

## 2. 目标与非目标

### 2.1 目标

1. 支持 `wan2.7-image`、`wan2.7-image-pro` 文生图。
2. 支持两种 Wan 2.7 模型的单参考图 I2I，与现有锚点自动注入闭环兼容。
3. 为 Wan 2.7 使用独立的默认尺寸和尺寸校验，不再继承 Qwen 默认尺寸。
4. 保持现有异步任务、限流退避、取消、下载、附件、历史和多图卡片契约不变。
5. 旧 Wan 模型和未知非 Qwen/Wan 2.7 模型在请求发出前明确失败，避免猜测端点。
6. 设置页、提示文案、产品文档、单元测试、组合测试和浏览器验收口径与实际能力一致。

### 2.2 非目标

- 本次不实现 `ImageGenerationService.edit()` 的 Wan 2.7 指令编辑；DashScope 的
  `baseImage + editNote` 仍返回 `NOT_IMPLEMENTED`。该能力需要单独设计编辑语义、mask/bbox 和多图输入。
- 本次不实现 Wan 2.7 的 `bbox_list` 交互式编辑、颜色调色板或组图
  `enable_sequential=true`。
- 本次不迁移到业务空间专属域名；继续使用可配置 `baseUrl`，默认
  `https://dashscope.aliyuncs.com`。官方说明现有域名仍可使用。
- 本次不扩大 Qwen 模型范围，也不改变 Qwen 默认模型和尺寸策略。

## 3. Provider 架构

### 3.1 模型分类

在 `packages/image-dashscope/src/index.ts` 增加明确分类，不再使用“非 Qwen 即旧 Wan”的兜底：

- Qwen：`model.startsWith('qwen-image')`；
- Wan 2.7：`model === 'wan2.7-image' || model === 'wan2.7-image-pro'`；
- 其他模型：请求发出前返回 `INVALID_PARAMETER`，提示当前只支持 Qwen Image 与 Wan 2.7。

这会主动拒绝 `wan2.2-*`、`wan2.6-*`、`wanx*` 和拼写错误的模型名。

### 3.2 端点与请求结构

Qwen 保持现状。Wan 2.7 使用官方异步端点：

```text
POST {baseUrl}/api/v1/services/aigc/image-generation/generation
X-DashScope-Async: enable
```

Wan 2.7 与 Qwen 共用消息结构：

```json
{
  "model": "wan2.7-image",
  "input": {
    "messages": [
      {
        "role": "user",
        "content": [{ "image": "data:image/png;base64,..." }, { "text": "生成描述" }]
      }
    ]
  },
  "parameters": {
    "size": "2048*1152",
    "n": 1,
    "watermark": false
  }
}
```

无参考图时省略 `image` 项。响应继续解析
`output.choices[].message.content[].image`，并复用现有 task id 轮询、限流和取消逻辑。

删除：

- `/api/v1/services/aigc/text2image/image-synthesis` 路由；
- `{input:{prompt}}` 旧请求体；
- `output.results[].url` 旧响应兼容分支；
- 旧 Wan 模型测试夹具。

### 3.3 尺寸策略

Wan 2.7 不复用 Qwen 默认的 Web `2560*1440` / Mobile `1440*2560`：

- Web 缺省：`2048*1152`；
- Mobile 缺省：`1152*2048`。

两者保持 16:9 / 9:16，并落在 Wan 2.7 最大 2K 约束内。

显式尺寸规则：

- `wan2.7-image`：允许 `1K`、`2K` 或官方像素合法域，拒绝 `4K`；
- `wan2.7-image-pro`：纯文生图允许 `1K/2K/4K`；带参考图时只允许 `1K/2K`；
- 显式像素超域由本地返回 `INVALID_PARAMETER`，错误信息包含模型、输入值和允许范围；
- `n` 沿用 1～4 钳制；不启用组图模式。

### 3.4 参考图与锚点

Wan 2.7 官方支持 URL 或 Base64 图片。Consumer 的参考图能力判断改为：

```text
qwen-image-* 或 wan2.7-image(-pro) => 支持 reference
其他模型 => 不支持
```

因此：

- Wan 2.7 不再跳过风格锚点；
- `packages/tool-ui-mockup/src/index.ts` 的非 Qwen 跳过逻辑改为“非参考图能力模型”；
- 设置页删除“所有 Wan 均不支持 I2I”的警告；
- 组合测试由“Wan 2.7 跳过锚点”改为“Wan 2.7 自动注入锚点”；
- 对显式旧 Wan 自定义配置，在 Provider 层直接拒绝，不再执行锚点跳过后尝试旧端点。

本次只保证现有锚点 PNG 链路。用户自备 JPEG/WebP 的 data URL MIME 嗅探属于既有 DashScope
参考图限制，另行处理，不与本迁移捆绑。

## 4. 错误处理与安全

1. 凭据解析、`redirect: 'error'`、工作区路径防逃逸保持不变。
2. 旧/未知模型在读取参考图和发网关请求前拒绝，避免不必要的本地文件读取与传输。
3. Wan 2.7 的 HTTP/任务错误沿用现有 `HTTP_ERROR`、`TASK_FAILED`、`RATE_LIMITED`、
   `BAD_RESPONSE` 分类。
4. 不记录 Authorization、API Key 或完整 Base64 图片。
5. 输出 URL 继续立即下载到工作区资产库，不依赖供应商 24 小时临时链接。

## 5. 客户端与文档

### 5.1 设置页

保留模型候选：

- 线框：`wan2.7-image`；
- 高保真：`wan2.7-image-pro`。

删除所有“Wan 不支持参考图，因此跳过锚点”的固定提示。若用户通过配置填入未支持模型，Provider
在实际调用时返回明确错误；设置页不推测任意自定义模型能力。

### 5.2 文档

更新：

- `README.md`；
- `docs/product-guide.md`；
- `docs/implementation-plan.md`；
- `packages/image-dashscope/README.md`；
- 浏览器测试计划与验收报告中的 Wan 结论。

所有文档删除旧 Wan 端点、Wan 2.2 示例和“Wan 一律无 I2I”表述。

## 6. 测试策略

实现遵循 TDD，先观察回归测试失败，再写最小实现。

### 6.1 Provider 单元测试

- Wan 2.7 T2I 请求命中新异步端点、使用 messages/choices 结构；
- Wan 2.7 reference 以内联 Base64 进入 content；
- Web/Mobile 缺省尺寸分别为 `2048*1152` / `1152*2048`；
- `wan2.7-image` 拒绝 4K；
- `wan2.7-image-pro` 仅在纯文生图允许 4K；
- `n` 钳制 1～4；
- `wan2.2-t2i-plus` 与未知模型在零网络调用下返回 `INVALID_PARAMETER`；
- 删除 `results[].url` 和旧 text2image 路径测试。

### 6.2 组合测试

- Wan 2.7 有锚点时自动注入 reference，不再跳过；
- Provider 切换、偏好模型覆盖、历史、附件与多图卡片保持原有契约；
- 旧 Wan 自定义模型失败时不产生图片、附件或历史。

### 6.3 真实浏览器回归

- DashScope `wan2.7-image` Web 文生图；
- DashScope `wan2.7-image-pro` Mobile 高保真双图；
- Wan 2.7 锚点自动 I2I；
- 旧 Wan 模型明确失败且无网关请求；
- 最终恢复 Provider、偏好与原锚点；
- 全量执行 test、typecheck、lint、format、build。

## 7. 验收标准

1. 生产代码、公开模型候选和测试夹具不再包含 `wan2.2`、`wan2.6`、`wanx` 或旧
   text2image 端点；历史验收记录可保留旧模型名称作为缺陷证据。
2. 设置页公开的两个 Wan 2.7 候选均可通过真实 DashScope API 生成。
3. Wan 2.7 锚点 I2I 的原始工具结果明确记录自动注入参考图。
4. 默认 Web/Mobile 尺寸均能被 Wan 2.7 接受。
5. 旧 Wan/未知模型零网络失败，错误可操作。
6. Qwen 线框、高保真、多图和 I2I 回归通过。
7. 无凭据泄漏，Provider、锚点和偏好在测试后恢复。
8. ACC-008、ACC-009 复测通过并关闭；报告更新为可追溯的最终模型能力矩阵。

## 8. 风险与后续

- 官方推荐业务空间专属域名；默认公共域名虽仍可用，但后续应评估增加 Workspace ID 配置。
- Wan 2.7 支持更完整的编辑能力，但本次继续保持 DashScope `edit()` 不支持，避免混入另一套编辑需求。
- Wan 2.7 Pro 的 4K 会显著增加耗时和费用；默认仍使用平台方向明确的 2K 像素尺寸。
- 真实模型与网关可能继续演进；模型候选和 API 事实应在发布候选验收时重新核对。
