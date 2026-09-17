# dsh-ui-mockup · Architecture and Implementation

[中文](../../architecture/overview.md)

> Current implementation version: 0.3.0. This document records repository structure, capability boundaries, and verified implementation facts.

## 1. Product goal

Package the loop **generate a UI mockup during discovery → user confirms → lock a design specification** as an installable DSH plugin. It lets individuals and small teams confirm an interface direction before writing code, preventing expensive late discovery that the built UI is not what they intended.

## 2. Repository architecture

The repository is a pnpm monorepo published as an npm bundle:

```text
dsh-ui-mockup/
├── package.json                         # private root and workspaces
├── pnpm-workspace.yaml
├── packages/
│   ├── image/                           # @mackwan84/dsh-image: image generate/edit contract
│   ├── image-dashscope/                 # DashScope provider: text-to-image + reference I2I
│   ├── image-volcengine/                # Volcengine Ark: synchronous API + instruction editing
│   ├── image-openai-compat/             # OpenAI-compatible gateway: minimal subset
│   └── tool-ui-mockup/                  # ui_mockup consumer, prompt rules, cards, Settings, i18n
├── bundle/
│   └── ui-mockup/                       # dsh.bundle.patch; DashScope enabled, other providers disabled
└── docs/
    ├── guides/                          # current product behavior
    ├── architecture/                    # component boundaries and governance
    ├── references/                      # sourced external facts
    ├── testing/vX.Y.Z/                  # frozen test cases and data
    ├── releases/                        # frozen release conclusions
    └── assets/                          # long-lived documentation media
```

- **Capability seam:** Service Definition / Provider / Consumer, following DSH repository conventions.
- **Provider selection:** configuration id → availability check → explicit error code; no implicit provider default.
- **Mount plane:** service and providers are profile-bundle capabilities; the tool and prompt rules are session contributions mounted by the same bundle patch.

## 3. Installation

```sh
# Product installation
dsh plugin --profile web add @mackwan84/dsh-ui-mockup-bundle@0.3.0

# Development installation
dsh plugin --profile web add /path/to/dsh-ui-mockup/bundle/ui-mockup
dsh plugin --profile web add github:mackwan84/dsh-ui-mockup#main # requires the prepare build script
```

Configure credentials for the active provider once: `DASHSCOPE_API_KEY`, `ARK_API_KEY`, or `OPENAI_COMPAT_API_KEY` plus the gateway URL. Credentials can also be entered through Settings.

## 4. Dependency policy

- Package `peerDependencies`: `@deepseek-ai/cordis` 4.0.1 and required `@deepseek-ai/dsh-*` release candidates; development versions align with the local DSH installation.
- Client half: tsdown client bundle plus a `dsh.client` manifest. An external bundle patch declares the `dsh.client` line, and `pnpm --filter <pkg> bundle` emits `lib/client.js`.
- The bundle package depends on the service package, three provider packages, and the tool package; development uses `workspace:*`, while published packages use version ranges.

## 5. Delivered milestones

| Milestone | Deliverable                                                                                                         | Acceptance                                                                       |
| --------- | ------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| M1        | Skeleton, image Service, DashScope provider, and host tool                                                          | Local `dsh plugin add` to a web profile can generate an image in a conversation. |
| M2        | Tool card, image routing, and bilingual UI dictionary                                                               | Cards render and language switches apply immediately.                            |
| M3        | Four Settings pages, asset-library history, and style-anchor linkage                                                | Panel behavior closes the confirmed wireframe flow.                              |
| M4        | Volcengine provider, I2I / instruction editing, and provider switching                                              | Providers switch correctly.                                                      |
| M5        | Annotation dialog, geometric feedback, `fastPreview`, draft-model tier, refinement action, and draft history/filter | Annotation geometry and `fastPreview` composition regressions pass.              |

Every milestone carries unit tests, real loader composition tests, README/invariants, and package/release checks.

## 6. Plugin design

### 6.1 Image Service Definition

- `generate(spec)`: prompt, `fidelity` (`wireframe` / `high-fidelity`), `platform` (`web` / `mobile`), style, size, `n` (1–4), model, and optional reference image for I2I.
- `edit(spec)`: base image, edit note, and optional mask; implementations either support masked editing or reject it explicitly.
- Results: image URL list plus metadata such as dimensions and media type.
- Errors: provider failures use `ImageProviderError`; transport failures use `NETWORK_ERROR`, provider time limits use `TIMEOUT`, and caller cancellation or programming errors are preserved unchanged.

### 6.2 DashScope provider

- Credentials default to `DASHSCOPE_API_KEY`; defaults are `qwen-image-3.0` for wireframes and `qwen-image-3.0-pro` for high fidelity.
- Uses Node fetch and rejects redirects for credential-bearing requests.
- Endpoint and model facts are in the [DashScope reference](../references/dashscope-image-edit-and-thinking-mode.md).

### 6.3 Volcengine Ark provider

- Credentials default to `ARK_API_KEY`; high fidelity and editing default to `doubao-seedream-5-0-pro-260628`. `requestTimeoutMs` defaults to 300 seconds because the synchronous API has no polling.
- Sends synchronous `POST /api/v3/images/generations` calls with `response_format: 'url'` and `watermark: false`; tier and explicit-size translation is documented in the package README.
- Editing uses the same Seedream endpoint with image and prompt. Masked editing is unavailable and returns `NOT_IMPLEMENTED`; multiple images are serialized.
- **Product boundary:** when Volcengine is active, UI Mockup rejects `fidelity='wireframe'` before it calls Ark or consumes quota. The actionable message directs the user to DashScope or an OpenAI-compatible gateway. A retained `wireframeModel` is only an existing `fastPreview` fallback and never a public wireframe-quality promise.
- HTTP 429 image errors use 25-second backoff twice. Provider switching is a mutually exclusive, three-row bundle configuration; Volcengine and OpenAI-compatible providers default to `disabled: true`.
- `provider/status` reports the active `providerId`. `test-connection` probes the active gateway; an unset OpenAI-compatible `baseUrl` produces an actionable configuration reason rather than a false network error.

### 6.4 OpenAI-compatible provider

- Targets private aggregation gateways such as one-api / new-api and configurable official OpenAI through synchronous `POST {baseUrl}/images/generations`. `baseUrl` is the complete prefix through `/v1`, defaults to empty, and is never completed automatically.
- The minimal contract is only `model + prompt + n + size`. `n` passes through natively, and `W*H` normalizes to `WxH` without local presets or aspect-ratio rewriting.
- `data[].b64_json` becomes a data URL; `data[].url` is passed through so the consumer downloads it immediately. Both `error.{code,message}` and top-level `code/message` envelopes are accepted.
- Reference I2I and instruction editing are explicit `NOT_IMPLEMENTED`. The consumer’s `supportsReference` metadata gate skips style-anchor injection and explains it in the result.
- Credentials use `OPENAI_COMPAT_API_KEY`; the bundle defaults are `gpt-image-2` for wireframes and `gpt-image-2.5-flare` for high fidelity. There is no built-in rate-limit backoff: 429 becomes `RATE_LIMITED`.
- See [OpenAI-compatible gateway facts](../references/openai-compatible-gateways.md) for the observed dialects and sources.

### 6.5 `ui_mockup` consumer

- The tool takes `description`, `fidelity`, and optional platform, style, count, model, size, reference, and `fastPreview`. Editing requires paired `baseImage` and `editNote`; credentials are never tool parameters.
- `fastPreview` only applies to high-fidelity generation. Resolution is explicit `model` → user `draftModel` preference → `wireframeModel` preference → active provider `wireframeModel` → `undefined`. It is ignored for wireframes with an explanatory result.
- Wireframes use brand-free low-fidelity sketch prompts and short Chinese labels; high-fidelity prompts use style terms, single-state components, and low text density. A reference appends baseline-consistency constraints.
- Images persist under `$DSH_HOME/mockups/<workspace>/images/`, then enter `attachments.saveImage`; models see only `design/images/<filename>` semantic references. History is line-delimited JSON and survives damaged rows or a malformed unterminated tail; image persistence survives a history-write failure.
- Annotation feedback expresses numbered normalized regions and text. Prompt rules require spatial `editNote`/description, always use the original semantic `baseImage`, and use only the latest annotation round. An invented annotation-image base path gets an actionable error.
- Shared provider metadata is the single source for display keys, credential names, model hints, connection probes, patch ids, and reference capability. The client and host share it without importing client code into the host build.
- Every `/api/ui-mockup/*` failure has `error.{code,message,details}` so client feedback does not degrade into an opaque server-response failure.

### 6.6 Client UI

- Tool cards show images inline, open the annotation dialog on click, and use one primary **Confirm and adopt** action. **Refine this version** and **Submit revision feedback** are outlined secondary actions; anchoring and multi-image selection are neutral state actions. User-visible UI strings follow the interface locale; model-visible messages remain fixed Chinese.
- The annotation dialog uses an `<img>` base with a same-size transparent canvas for geometry. Select/Move pans and selects marks by rectangle interior or an 8px stroke tolerance; selected marks get a dashed outline. A fixed 44px status bar changes copy without changing dialog height. Create/delete/clear are undoable to depth 50, marks are renumbered, and submission is disabled until intrinsic image dimensions are ready. Escape closes the focus-trapped dialog; keyboard drawing is not promised.
- `/ui-mockup/images` serves trusted asset-library images through the web server.
- Settings has Overview, Providers & Models, Generation Preferences, and History. In 0.3.0, model tiers are editable input-plus-DSH-Menu comboboxes, combining static hints with best-effort OpenAI-compatible gateway discovery. The input always permits an arbitrary model name; failed discovery, unset URL, and HTML-200 all silently fall back. The gateway URL is written through `provider/baseurl/set` to the user-layer patch and hot-reloads. Visuals use DSH theme tokens and primitives.

### 6.7 Localization

- All client-visible tool-card and Settings text has Chinese and English dictionaries; wireframe labels remain Chinese placeholders.
- `LocaleId` is `'zh' | 'en'`, with fallback `current namespace locale → namespace en → common → raw key`.
- Components receive framework-injected `t`; they neither access `ctx` nor self-subscribe.
- Model-visible tool descriptions and prompt rules remain Chinese by design.

## 7. Configuration surfaces

1. Credentials use the DSH credential capability and `.env` (`DASHSCOPE_API_KEY`, `ARK_API_KEY`, `OPENAI_COMPAT_API_KEY`) and never enter conversation logs.
2. `cordis.yml` config validates default fidelity, platform, count, models, size, polling timeout, and other tunables; DSH manages history and image-output locations.
3. The Settings slot is the UI entry; the settings service is the source of user preferences and YAML supplies initial values.

## 8. Verified facts and constraints

- DashScope qwen-image 3.0 and Wan 2.7 use the asynchronous generation endpoint and task polling. Only Wan 2.7 is supported; old Wan 2.2/2.6 and `/text2image/image-synthesis` are not.
- `qwen-image-3.0-pro` enables thinking mode by default and can take more than five minutes; polling must allow at least ten minutes.
- `Throttling.RateQuota` uses 25-second backoff twice.
- A mainland DashScope key does not work with `dashscope-us.aliyuncs.com`; Volcengine uses `ARK_API_KEY`.
- The tool-schema DSL does not support numeric minimum/maximum; object values must declare `additionalProperties` and all item fields explicitly.
- Specification extraction is done by the conversation agent. A multimodal agent can inspect images; a text-only agent must obtain a user description and mark the specification as not image-verified.

Detailed provider facts and sources are maintained in the [Volcengine Ark](../references/volcengine-ark-image-api.md), [DashScope](../references/dashscope-image-edit-and-thinking-mode.md), and [OpenAI-compatible gateway](../references/openai-compatible-gateways.md) references.

## 9. Gates and deliverables

- Package unit tests plus real loader composition tests; mocks are limited to external services.
- Per-package README with Model Experience format and invariants.
- Runnable-example snapshots for tool schema and model-visible text.
- Typecheck, lint, build, coverage, package, and release gates must all be green before publication.
