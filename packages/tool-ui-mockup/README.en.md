# @mackwan84/dsh-tool-ui-mockup

[中文](README.md)

Consumer for the `ui_mockup` tool. During product discovery it generates UI wireframes and high-fidelity design images, stores assets under `$DSH_HOME/mockups/<workspace>/images/`, writes generation history to the sibling `history.jsonl`, and injects prompt rules: write `design/spec.md` only after confirmation; do not write implementation code for unconfirmed designs.

- **Model tiers:** selects the Settings panel default for the requested fidelity, then falls back to the active provider default. DashScope defaults are `qwen-image-3.0` / `qwen-image-3.0-pro`; Volcengine is only supported for high-fidelity (`doubao-seedream-5-0-pro-260628`) and whole-image editing; `model` can override the default.
- **Draft direction (0.2.0):** `fastPreview` only affects high-fidelity requests. It uses the “draft model” tier (`draftModel`, falling back to the wireframe tier when empty) for a fast direction image. It is ignored, with an explanation, for `wireframe`; history records `fastPreview: true`.
- **Reference images:** `reference` accepts the semantic path `design/images/…` (translated by the host to the asset library) or a workspace-relative image, preserving style across screens.
- **Editing:** on Volcengine, send `description`, `fidelity`, `baseImage`, and `editNote`; generated images use `design/images/<filename>` and are not copied into the project.
- **Annotation feedback (0.2.0):** clicking a result image opens the annotation dialog. Select/Move pans the canvas and selects one existing mark; rectangle/brush/arrow modes explain how to return to Select. A selected mark can be deleted with the visible button or Delete/Backspace when the canvas has focus. Delete/clear are undoable (depth 50), marks are auto-numbered, and fit/50%/100%/150%/200% zoom is available. Submission sends normalized numbered coordinates and feedback through `inputActions`.
- Generated images use timestamp-and-random filenames, so concurrent calls never overwrite. A failed download does not block other images.
- Results are stored as session attachments. Images beyond `imageLimits.maxImageBytes` remain on disk but are omitted from attachments.
- History ignores damaged rows and can append after an unterminated damaged tail. The history page filters “drafts only”; if history persistence fails, images remain and the result card explains that this run is not in history.
- Result cards show partial-download and attachment-size warnings; empty feedback cannot be submitted. A draft card offers “Refine this version.” Setting a style anchor returns a one-time notice. Buttons follow the UI language, while confirmation/selection/edit/annotation messages sent to the model remain Chinese.
- Rate limiting, polling, and credentials are handled by the provider.

## Model Experience

- **Model-visible tool:** `ui_mockup`; parameters and description are defined with `defineTool` in `src/index.ts`.
- **Prompt rules:** `systemPrompt` injects the `ui-mockup-usage` rule set: when to suggest a mockup, choosing fidelity, reference-image consistency, interpreting numbered annotation feedback, passing the original semantic `baseImage`, honoring the most recent annotation pass, and locking `design/spec.md` only after confirmation.

## Known limitations

- Image text accuracy and content moderation are determined by external models. Prompts prefer short labels and low text density, but no image is guaranteed free of garbled text.
- A text-only conversation model cannot inspect generated images; the user must describe confirmation before a specification is extracted.
- Drawing annotations cannot be operated by keyboard. After selecting a mark, use the visible deletion button or Delete/Backspace with canvas focus; focused inputs and toolbar buttons do not delete. The accessible fallback is still a feedback input and submit button for text-only feedback.
