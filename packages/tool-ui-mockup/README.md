# @mackwan84/dsh-tool-ui-mockup

`ui_mockup` 工具 Consumer：研讨阶段生成 UI 线框图/高保真设计稿，落盘设计资产库
`$DSH_HOME/mockups/<工作区>/images/`，写入同目录 `history.jsonl` 生成历史，
并注入提示词规则引导"确认后写 `design/spec.md`、未确认不写实现代码"。

- 模型分层：按保真度取设置面板的分层默认，未配置时回落生效提供方的内置默认
  （百炼 `qwen-image-3.0` / `qwen-image-3.0-pro`，火山 `doubao-seedream-4-5` / `5-0-pro`；可 `model` 覆盖）；
- 参考图模式：`reference` 收 `design/images/…` 语义路径（宿主翻译到资产库）或工作区内自备图相对路径，图生图保持全站风格一致；
- 生成图落盘资产库 `images/`（文件名含时间戳与随机段，并发不覆盖），下载失败的单张不阻断其余图片；
- 结果通过 attachments 存为会话图片附件（超过 `imageLimits.maxImageBytes` 的仅落盘不入附件）；
- 接口限流/轮询/凭据由 Provider 处理。

## Model Experience

- **模型可见工具**：`ui_mockup`（参数与描述见 `src/index.ts` 的 defineTool 定义）；
- **提示词规则**（`systemPrompt` 注入，name: `ui-mockup-usage`）：何时主动提议草图、fidelity 选择、
  参考图一致性、确认后锁定 `design/spec.md` 的流程约束。

## Known Limitations

- 编辑模式（`edit`）在 M4 提供。
