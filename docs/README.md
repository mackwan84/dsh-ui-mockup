# 项目文档

本目录按职责和生命周期组织。项目概览与快速开始见[根 README](../README.md)。

## 使用与架构

- [产品使用指南](guides/product-guide.md)
- [架构与实现](architecture/overview.md)
- [文档信息架构与治理规范](architecture/documentation-governance.md)
- [火山方舟图片接口参考](references/volcengine-ark-image-api.md)

## 测试与发布

- [0.1.3 浏览器测试用例](testing/v0.1.3/browser-cases.md)
- [0.1.3 CRM 测试数据](testing/v0.1.3/data/crm.json)
- [0.1.3 发布检查清单](releases/v0.1.3.md)

## 维护约定

产品和架构文档维护当前有效行为；测试和发布资料按版本冻结。长期图片放在 `assets/`，原始验收制品放在仓库根目录 `.artifacts/`，不提交 Git。具体规则见[文档治理规范](architecture/documentation-governance.md)。
