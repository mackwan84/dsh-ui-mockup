# @mackwan84/dsh-ui-mockup-bundle

dsh-ui-mockup 的安装层：一个声明 `dsh.bundle.patch` 的 npm 包，把
`@mackwan84/dsh-image-dashscope`（百炼图像 Provider）与
`@mackwan84/dsh-tool-ui-mockup`（ui_mockup 工具）挂载进 profile 组合。

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
并先发布 `@mackwan84/dsh-image` 与 `@mackwan84/dsh-image-dashscope`、`@mackwan84/dsh-tool-ui-mockup`。
