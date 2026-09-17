# @mackwan84/dsh-ui-mockup-bundle

[中文](README.md)

The installation layer for dsh-ui-mockup. This npm package declares `dsh.bundle.patch` and mounts these components into the profile composition:

- `@mackwan84/dsh-image-dashscope` (DashScope image provider, enabled by default),
- `@mackwan84/dsh-image-volcengine` (Volcengine Ark image provider, preconfigured but `disabled: true`),
- `@mackwan84/dsh-image-openai-compat` (OpenAI-compatible image provider, preconfigured but `disabled: true`), and
- `@mackwan84/dsh-tool-ui-mockup` (the `ui_mockup` tool).

## Capabilities

- Wireframes, high-fidelity direction images, and refinement after a direction is selected.
- Generated-image cards, style anchors, generation history, and draft filtering.
- Annotation dialog with rectangle/brush/arrow, Select/Move, visible deletion, and zoom.
- DashScope, Volcengine, and OpenAI-compatible gateways, tiered defaults, credential state, and connection testing.

See the [project README](https://github.com/mackwan84/dsh-ui-mockup/blob/main/README.en.md) for full functionality, screenshots, and known limitations.

## Switching providers

`ctx.image` is a single-slot service, so only one provider can be active at a time. The bundle preconfigures three provider rows; Volcengine and the OpenAI-compatible gateway start as `disabled: true`. Switch by clicking a provider card in **Settings · UI Mockup · Providers & Models**. The plugin writes an id-targeted `disabled` patch to the DSH home user layer (`~/.dsh/cordis.patch.yml`); the launcher watches it and hot-reloads the composition. You can also edit the file manually:

```yaml
- id: image-dashscope
  disabled: true
- id: image-volcengine
  disabled: false
- id: image-openai-compat
  disabled: true
```

The **Providers & Models** page reads the active provider from the `provider/status` endpoint (the `image` slot’s `providerId`, not a panel preference). If hot reload exceeds its wait window, the panel reports that switching is still in progress and clears the previous provider’s model defaults, preventing an incompatible model ID from being sent after the later transition.

## Install

```sh
dsh plugin --profile web add @mackwan84/dsh-ui-mockup-bundle@0.3.0

# Development (this repository checkout)
dsh plugin --profile web add /path/to/dsh-ui-mockup/bundle/ui-mockup
```

After `dsh plugin add`, DSH discovers the `dsh.bundle` declaration and mounts its patch layer. Restart DSH for the installation to take effect.

## Publishing note

Run `pnpm run publish:all` from the repository root. The script first uses `pnpm pack` to translate `workspace:^` into published version ranges, then publishes `@mackwan84/dsh-image`, all three providers, `@mackwan84/dsh-tool-ui-mockup`, and this bundle in dependency order. Do not run `npm publish` directly against a source directory.
