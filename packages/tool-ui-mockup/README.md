# @mackwan84/dsh-tool-ui-mockup

`ui_mockup` 工具 Consumer：研讨阶段生成 UI 线框图/高保真设计稿，落盘设计资产库
`$DSH_HOME/mockups/<工作区>/images/`，写入同目录 `history.jsonl` 生成历史，
并注入提示词规则引导"确认后写 `design/spec.md`、未确认不写实现代码"。

- 模型分层：按保真度取设置面板的分层默认，未配置时回落生效提供方的内置默认
  （百炼 `qwen-image-3.0` / `qwen-image-3.0-pro`，火山 `doubao-seedream-4-5-251128` / `doubao-seedream-5-0-pro-260628`；可 `model` 覆盖）；
- 参考图模式：`reference` 收 `design/images/…` 语义路径（宿主翻译到资产库）或工作区内自备图相对路径，图生图保持全站风格一致；
- 编辑模式：火山提供方下同时传`description`、`fidelity`、`baseImage`和`editNote`；生成图用`design/images/<文件名>`引用，不复制到项目；
- 生成图落盘资产库 `images/`（文件名含时间戳与随机段，并发不覆盖），下载失败的单张不阻断其余图片；
- 结果通过 attachments 存为会话图片附件（超过 `imageLimits.maxImageBytes` 的仅落盘不入附件）；
- 历史读取跳过损坏行；无换行坏尾行后的新记录仍以独立JSON行追加；
- 图片卡片显示部分下载/附件超限告警，空意见不能提交；按钮随界面语言切换，发送给模型的确认/选版/编辑消息固定中文；
- 接口限流/轮询/凭据由 Provider 处理。

## Model Experience

- **模型可见工具**：`ui_mockup`（参数与描述见 `src/index.ts` 的 defineTool 定义）；
- **提示词规则**（`systemPrompt` 注入，name: `ui-mockup-usage`）：何时主动提议草图、fidelity 选择、
  参考图一致性、确认后锁定 `design/spec.md` 的流程约束。

## Known Limitations

- 图像文字准确率与内容审核由外部模型决定；提示词使用短标签和低文字密度约束，但不承诺每张图片无乱码；
- 纯文本会话模型不能读取生成图，需要用户口述确认后再提炼规格。
