# @mackwan84/dsh-tool-ui-mockup

`ui_mockup` 工具 Consumer：研讨阶段生成 UI 线框图/高保真设计稿，落盘设计资产库
`$DSH_HOME/mockups/<工作区>/images/`，写入同目录 `history.jsonl` 生成历史，
并注入提示词规则引导"确认后写 `design/spec.md`、未确认不写实现代码"。

- 模型分层：按保真度取设置面板的分层默认，未配置时回落生效提供方的内置默认
  （百炼 `qwen-image-3.0` / `qwen-image-3.0-pro`，火山 `doubao-seedream-4-5-251128` / `doubao-seedream-5-0-pro-260628`；可 `model` 覆盖）；
- 方向稿（0.2.0）：`fastPreview` 仅 high-fidelity 生效，用「方向稿模型」档（`draftModel`，
  空串回落线框档）快速产出方向稿；与 `wireframe` 组合时忽略并说明；历史记 `fastPreview: true`；
- 参考图模式：`reference` 收 `design/images/…` 语义路径（宿主翻译到资产库）或工作区内自备图相对路径，图生图保持全站风格一致；
- 编辑模式：火山提供方下同时传`description`、`fidelity`、`baseImage`和`editNote`；生成图用`design/images/<文件名>`引用，不复制到项目；
- 标注反馈（0.2.0）：卡片图片点击进标注弹窗（默认“选择/移动”拖动画布并单选已有标记；矩形/画笔/箭头模式会显示切回选择工具的操作提示；选中态复用 DSH Pill/Button/图标与主题令牌，可点显式删除按钮，或在画布聚焦时用 Delete/Backspace 删除；可撤销删除/清空（栈深 50）、自动编号、适合窗口与50%/100%/150%/200%缩放），提交时编号
  归一化坐标投影 + 意见经 `inputActions` 发出；提示词规则要求按编号区域组织编辑指令、
  `baseImage` 恒传原图语义路径、多轮标注以最新为准；`execute` 编辑分支对编造的「标注图」
  `baseImage` 返回可操作错误（硬防护）；
- 生成图落盘资产库 `images/`（文件名含时间戳与随机段，并发不覆盖），下载失败的单张不阻断其余图片；
- 结果通过 attachments 存为会话图片附件（超过 `imageLimits.maxImageBytes` 的仅落盘不入附件）；
- 历史读取跳过损坏行；无换行坏尾行后的新记录仍以独立JSON行追加；历史页支持「只看方向稿」服务端过滤；历史写入失败时保留图片，并在结果卡提示本次不会进入生成历史；
- 图片卡片显示部分下载/附件超限告警，空意见不能提交；方向稿结果卡有「按这版精修」按钮
  （解析 `argsRaw` 判定可见性）；方向稿设风格锚点返回一次性提示；按钮随界面语言切换，发送给模型的确认/选版/编辑/标注消息固定中文；
- 接口限流/轮询/凭据由 Provider 处理。

## Model Experience

- **模型可见工具**：`ui_mockup`（参数与描述见 `src/index.ts` 的 defineTool 定义）；
- **提示词规则**（`systemPrompt` 注入，name: `ui-mockup-usage`）：何时主动提议草图、fidelity 选择、
  参考图一致性、标注反馈消息的解读规则（编号坐标 → 空间语言、`baseImage` 传原图、最新一轮为准）、
  确认后锁定 `design/spec.md` 的流程约束。

## Known Limitations

- 图像文字准确率与内容审核由外部模型决定；提示词使用短标签和低文字密度约束，但不承诺每张图片无乱码；
- 纯文本会话模型不能读取生成图，需要用户口述确认后再提炼规格；
- 标注弹窗的圈选绘制不支持键盘操作；标记选中后可用显式删除按钮，也可在画布聚焦后用Delete/Backspace删除（输入控件与工具条按钮持有焦点时不删）；无障碍兜底仍为意见输入框 + 提交按钮单独完成纯文字反馈。
