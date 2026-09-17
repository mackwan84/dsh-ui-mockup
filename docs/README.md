# 项目文档

[English](README.en.md)

本目录按职责和生命周期组织。项目概览与快速开始见[根 README](../README.md)。面向 GitHub、npm 使用者与外部集成开发者的资料位于下方“对外使用、集成与发布”；浏览器验收、测试数据和实施计划仅供维护，不属于公开双语范围。

## 对外使用、集成与发布

- [产品使用指南](guides/product-guide.md)
- [架构与实现](architecture/overview.md)
- [火山方舟图片接口参考](references/volcengine-ark-image-api.md)
- [百炼图像编辑与思考模式开关事实清单](references/dashscope-image-edit-and-thinking-mode.md)
- [OpenAI 兼容生图网关事实清单](references/openai-compatible-gateways.md)
- [v0.3.0 发布记录](releases/v0.3.0.md)

英文镜像资料见 [English documentation index](README.en.md)。双语范围、同步要求与截图规则见[对外文档双语治理](architecture/bilingual-public-documentation.md)。

## 维护与验收（内部）

- [文档信息架构与治理规范](architecture/documentation-governance.md)

- [v0.3.0 浏览器验收问题修复设计](superpowers/specs/2026-09-15-v0.3.0-acceptance-repair-design.md)
- [v0.3.0 产品缺陷修复实施计划](superpowers/plans/2026-09-15-v0.3.0-product-defect-fixes.md)
- [v0.3.0 隔离验收环境与复跑实施计划](superpowers/plans/2026-09-15-v0.3.0-acceptance-environment-and-rerun.md)
- [0.1.3 浏览器测试用例](testing/v0.1.3/browser-cases.md)
- [0.1.3 CRM 测试数据](testing/v0.1.3/data/crm.json)
- [0.1.3 发布检查清单](releases/v0.1.3.md)
- [0.2.0 浏览器测试用例](testing/v0.2.0/browser-cases.md)
- [0.2.0 CRM 测试数据](testing/v0.2.0/data/crm.json)
- [0.2.0 正式发布记录](releases/v0.2.0.md)
- [0.3.0 浏览器测试用例](testing/v0.3.0/browser-cases.md)
- [0.3.0 CRM 测试数据](testing/v0.3.0/data/crm.json)

## 界面截图

- [UI 草图设置概览](assets/ui-mockup-overview.jpg)
- [标注绘图模式提示](assets/ui-mockup-annotation-drawing.jpg)
- [标记选中与删除](assets/ui-mockup-annotation-selected.jpg)

## 维护约定

产品和架构文档维护当前有效行为；测试和发布资料按版本冻结。长期图片放在 `assets/`，原始验收制品放在仓库根目录 `.artifacts/`，不提交 Git。具体规则见[文档治理规范](architecture/documentation-governance.md)。
