# dsh-ui-mockup

在 DSH（DeepSeek Harness）研讨阶段生成 UI 草图 / 高保真设计稿的插件：让用户在写代码之前
确认界面方向，通过「生成 → 看图反馈 → 确认锁定 → 规格实现」闭环，避免实现完成后才发现界面不符合预期。

## 功能特性

- **内嵌展示**：生成图直接以卡片形式显示在对话中（带确认 / 选用 / 修改意见按钮），无需访问文件目录；
- **模型分层**：线框图用 `qwen-image-3.0`（快、省），高保真用 `qwen-image-3.0-pro`（质量优先）；
- **风格一致**：参考图模式（I2I）以已确认页面为基准图，多页面保持同一品牌视觉；
- **设计锁定**：用户确认后自动提炼 `design/spec.md`，未确认的页面不进入实现；
- **限流退避**：接口限流自动重试（Throttling 25s × 2）；
- **多语言**：客户端 UI 完整支持 DSH 语言切换（zh / en）；
- **设置面板**：设置窗口「UI 草图」入口下四页——概览（快速使用三步）、提供方与模型
  （凭据状态 + 测试连接 + 模型分层默认）、生成偏好（持久化到 settings 命名空间，
  cordis.yml 为组合 base 层）、生成历史（搜索/清空/缩略图回看）；
- **风格锚点**：历史页把某张生成图设为锚点后，`ui_mockup` 未显式传 reference 时
  自动引用该图走 I2I，多页面风格保持一致；清空历史会一并解除锚点。

## 安装（未发布，开发方式）

```sh
# 从本仓库本地安装（开发期）
dsh plugin --profile web add /path/to/dsh-ui-mockup/bundle/ui-mockup
```

发布后：`dsh plugin --profile web add @mackwan84/dsh-ui-mockup-bundle`

## 配置

- `.env`：`DASHSCOPE_API_KEY=sk-xxx`（阿里云百炼 API Key）；
- 或使用设置面板填写/测试连接。

## 使用

在对话中直接说「出个草图」，或由 agent 在需求研讨时主动提议：

```
给图书搜索页出一个线框图 → 看图 → 点「确认采用」或填修改意见 → agent 重新生成/锁定规格
```

## 开发

- [docs/product-guide.md](docs/product-guide.md) — 产品文档（是什么 / 怎么用 / FAQ，含 mermaid 流程图与时序图）
- [docs/implementation-plan.md](docs/implementation-plan.md) — 实施计划（架构、里程碑 M1–M4、依赖策略、关键 API 事实）

常用命令：

```sh
pnpm test          # 单元 + 组合测试（无需先构建）
pnpm typecheck     # 全仓 TypeScript 检查（根 tsconfig 统一入口）
pnpm lint          # ESLint（js/ts 推荐 + 类型感知规则）
pnpm lint:fix      # ESLint 自动修复
pnpm format        # Prettier 全仓格式化
pnpm format:check  # Prettier 格式检查
pnpm build         # 构建三个包的 lib/
pnpm run pack:all  # 打包 4 个 tarball 到 dist/
```

## License

详见 [LICENSE](LICENSE)。
