# @mackwan84/dsh-ui-mockup-bundle

dsh-ui-mockup 的安装层：一个声明 `dsh.bundle.patch` 的 npm 包，把
`@mackwan84/dsh-image-dashscope`（百炼图像 Provider，默认启用）、
`@mackwan84/dsh-image-volcengine`（火山方舟图像 Provider，预置但 `disabled: true`）与
`@mackwan84/dsh-tool-ui-mockup`（ui_mockup 工具）挂载进 profile 组合。

## 提供方切换

`ctx.image` 是单槽位服务，同一时刻只允许一个 Provider 生效。bundle 预置两行 Provider，
火山方舟行默认 `disabled: true`。切换走设置面板「提供方与模型」页**点卡片**：插件把
id 定向的 `disabled` 翻转写入 DSH home 用户层（`~/.dsh/cordis.patch.yml`，launcher
实时 watch 并热重载组合），也可以手工编辑该文件：

```yaml
- id: image-dashscope
  disabled: true
- id: image-volcengine
  disabled: false
```

设置窗口「UI 草图 · 提供方与模型」页经 `provider/status` 端点如实显示当前生效方
（端点读 image 槽位的 providerId，不从面板偏好推断）。

## 安装

```sh
dsh plugin --profile web add @mackwan84/dsh-ui-mockup-bundle@0.1.2

# 开发期（本仓库 checkout）
dsh plugin --profile web add /path/to/dsh-ui-mockup/bundle/ui-mockup
```

`dsh plugin add` 完成后自动检测 `dsh.bundle` 声明并挂载 patch 层；重启 dsh 即生效。

## 发布注意

运行根目录的 `pnpm run publish:all`：脚本先用 `pnpm pack` 将 `workspace:^` 转换为正式版本范围，
再按依赖顺序发布 `@mackwan84/dsh-image`、两个 Provider、`@mackwan84/dsh-tool-ui-mockup`
与本 bundle。不要直接对源码目录运行 `npm publish`。
