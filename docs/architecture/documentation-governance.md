# 文档信息架构与治理规范

> 状态：待书面确认
> 适用范围：本仓库根文档、`docs/`、各发布包 README 及文档生成的本地制品。

## 1. 目标

文档按职责和生命周期组织，使使用者能快速找到当前说明，使维护者能判断哪些内容需要长期维护、按版本归档或仅保存在本地。代码行为、配置默认值和发布结论必须与同一提交中的文档一致。

## 2. 目标结构

```text
docs/
├── README.md
├── guides/
│   └── product-guide.md
├── architecture/
│   ├── overview.md
│   └── documentation-governance.md
├── references/
│   └── volcengine-ark-image-api.md
├── testing/
│   └── v0.1.3/
│       ├── browser-cases.md
│       └── data/
│           └── crm.json
├── releases/
│   └── v0.1.3.md
└── assets/
    └── ui-mockup-overview.jpg
```

根 `README.md` 负责项目入口和最短使用路径；`docs/README.md` 负责完整文档导航、分类说明与维护规则。各包 README 只说明对应包的安装、公开接口和限制，不复制整套产品文档。

## 3. 分类与生命周期

| 分类     | 目录                 | 生命周期   | 内容要求                                                   |
| -------- | -------------------- | ---------- | ---------------------------------------------------------- |
| 使用指南 | `guides/`            | 持续更新   | 面向使用者，只描述当前有效行为                             |
| 架构     | `architecture/`      | 持续更新   | 记录当前组件边界、关键数据流和治理决策                     |
| 技术参考 | `references/`        | 持续复核   | 记录外部接口事实、来源链接和最近核对日期                   |
| 测试     | `testing/vX.Y.Z/`    | 按版本冻结 | 保存可复用用例和去敏、确定性的测试输入                     |
| 发布     | `releases/vX.Y.Z.md` | 按版本冻结 | 保存门禁结果、验收结论、阻塞项和发布后待办                 |
| 长期素材 | `assets/`            | 按引用维护 | 只保存被长期文档引用且经过压缩的图片                       |
| 本地制品 | `.artifacts/`        | 临时       | 截图、录屏、DOM 快照、日志、临时报告和候选仓库，不提交 Git |

版本冻结文档发现事实错误时允许修正，但必须在提交说明中写清原因；后续版本的新行为不得回填到旧版本用例或发布结论中。

## 4. 现有文件迁移

| 当前路径                                 | 目标路径                                      |
| ---------------------------------------- | --------------------------------------------- |
| `docs/product-guide.md`                  | `docs/guides/product-guide.md`                |
| `docs/implementation-plan.md`            | `docs/architecture/overview.md`               |
| `docs/volcengine-ark-image-api-facts.md` | `docs/references/volcengine-ark-image-api.md` |
| `docs/browser-test-cases-v0.1.3.md`      | `docs/testing/v0.1.3/browser-cases.md`        |
| `docs/test-data/v0.1.3-crm.json`         | `docs/testing/v0.1.3/data/crm.json`           |
| `docs/release-checklist-v0.1.3.md`       | `docs/releases/v0.1.3.md`                     |
| `docs/assets/ui-mockup-overview.jpg`     | 保持不变                                      |

迁移使用 Git 重命名，保留文件历史；同步更新根 README、文档内部链接和发布包 README 中受影响的路径。

## 5. 维护规则

1. 修改用户行为、配置、默认值、模型支持范围或错误语义时，同一提交更新对应使用指南或技术参考。
2. 修改组件职责、持久化位置、跨包接口或安全边界时，同一提交更新架构文档。
3. 新版本建立独立的 `testing/vX.Y.Z/` 和 `releases/vX.Y.Z.md`；测试数据必须虚构、去敏且可复用。
4. 技术参考中的外部事实必须附官方来源和最近核对日期；无法验证的内容应明确标记为观察结果。
5. 文档使用相对链接；移动或删除文件后必须执行本地链接检查。
6. `docs/assets/` 不保存一次性测试证据。长期图片应使用与真实编码一致的扩展名，并控制文件体积。
7. 原始截图、录屏、DOM、服务响应、逐秒采样、临时 Provider 桩和运行日志统一写入 `.artifacts/`。
8. 不在仓库中保留已执行完且内容已被架构文档或发布记录吸收的临时计划。

## 6. 工具规则

- `.gitignore` 忽略 `.artifacts/`，并保留 `docs/test-evidence/` 兼容旧采集路径。
- `.prettierignore` 使用相同的制品边界，避免格式化临时或原始证据。
- `AGENTS.md` 固化本规范的目录职责、同步触发条件、制品边界和验证要求。
- Markdown 和 JSON 纳入 Prettier；原始测试制品不进入格式化范围。

## 7. 验收标准

1. `docs/` 与目标结构一致，根目录不再平铺业务文档。
2. 根 README 和 `docs/README.md` 能到达所有长期维护文档。
3. 仓库内 Markdown 相对链接全部可解析。
4. `rg` 无旧文档路径残留，历史说明除外。
5. `.artifacts/` 和旧 `docs/test-evidence/` 均不会被 Git 跟踪或 Prettier 扫描。
6. `pnpm format:check`、`pnpm lint`、`pnpm typecheck` 和 `pnpm test` 通过。
7. 迁移不改变产品代码、发布包内容或 0.1.3 的验收结论。
