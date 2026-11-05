# dsh-visual-picker

A [DeepSeek Harness](https://github.com/deepseek-ai) desktop plugin: pick, annotate, comment on and screenshot elements of a **real Chrome / Edge page**, then hand the element locator + comment + screenshot to the agent — so the agent can make visual front-end fixes against what you actually see.

Think "ChatGPT / Codex built-in browser, but driven by your own browser and wired into the DSH GUI composer".

## Features

- **Element picker overlay** — hover highlight, click to pick; the overlay is injected into the live page (shadow DOM, no page pollution).
- **Per-element capture** — unique CSS selector, page URL, viewport position & size, text excerpt and an element screenshot.
- **Comments** — attach a comment to every pick; everything is bundled into a structured reference.
- **Reference chips** — inserts a real composer chip (`标注 #pN`) into the DSH GUI composer; on submit it expands into the full locator block (selector · URL · coordinates · comment · screenshot path). Falls back to plain-text insertion if the chip pipeline is unavailable.
- **Browser adoption** — launches Chrome/Edge with a dedicated profile, or **adopts an already-running instance** on the same profile; same-window tab navigation (no duplicate windows); live tab list with switching in the panel.
- **Screenshot pipeline** — per-element shots stored locally and attached as real composer image attachments.

## Install

Copy (or clone) this folder into your DSH workspace as `dsh-visual-picker/`, then register the loader in your `cordis.patch.yml` (see `cordis.patch.yml` in this repo). Restart DSH desktop; the panel appears in the right sidebar. The panel auto-refreshes when the host revision changes.

## Usage

1. Open the **Visual Picker** panel in the DSH GUI sidebar.
2. Enter a URL and click **在 Chrome 中调试** (Debug in Chrome) — a real Chrome window opens (or the existing one is adopted).
3. Toggle **拾取模式** (pick mode), hover to highlight, click an element to capture it.
4. Type a comment for the element, then **插入引用** (insert reference) — a chip plus element screenshot land in the composer.
5. Submit; the agent receives the structured locator and can edit the front-end code accordingly. The agent-side tool is `visual_picker_read`.

## Requirements

- Node.js >= 22
- DSH desktop (web client platform)
- Chrome or Edge installed locally

## License

MIT
