# @mackwan84/dsh-ui-mockup-bundle

dsh-ui-mockup 的安装层：一个声明 `dsh.bundle.patch` 的 npm 包，把
`@mackwan84/dsh-image-dashscope`（百炼图像 Provider，默认启用）、
`@mackwan84/dsh-image-volcengine`（火山方舟图像 Provider，预置但 `disabled: true`）与
`@mackwan84/dsh-tool-ui-mockup`（ui_mockup 工具）挂载进 profile 组合。

## 提供方切换

`ctx.image` 是单槽位服务，同一时刻只允许一个 Provider 生效。bundle 预置两行 Provider，
切换 = 在用户 patch 中翻转两行的 `disabled`：

```yaml
- id: image-dashscope
  disabled: true
- id: image-volcengine
  disabled: false
```

设置窗口「UI 草图 · 提供方与模型」页会如实显示当前生效方（`provider/status` 端点），
面板不提供切换写入口，组合行是唯一事实源。

## 安装

```sh
# 发布后
dsh plugin --profile web add @mackwan84/dsh-ui-mockup-bundle

# 开发期（本仓库 checkout）
dsh plugin --profile web add /path/to/dsh-ui-mockup/bundle/ui-mockup
```

`dsh plugin add` 完成后自动检测 `dsh.bundle` 声明并挂载 patch 层；重启 dsh 即生效。

## 发布注意

发布时 `dependencies` 中的 `workspace:^` 需替换为版本号范围（如 `^0.1.0-rc.0`），
并先发布 `@mackwan84/dsh-image`、`@mackwan84/dsh-image-dashscope`、
`@mackwan84/dsh-image-volcengine` 与 `@mackwan84/dsh-tool-ui-mockup`。
