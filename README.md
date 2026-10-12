# ApEditor — AI Markdown Editor (MVP)

> **A local-first AI markdown editor.** Write, comment, and revise in one
> window. Bring your own API key (or use Google AI Mode — no key
> required). Nothing leaves your browser except the chat requests you
> send.
>
> **Lineage:** re-produced from
> [`ai-text-editor`](https://github.com/darrylschaefer/ai-text-editor)
> by [@darrylschaefer](https://github.com/darrylschaefer). This MVP
> keeps the core editor + AI chat loop in a minimal number of files.
> See [Credits](#credits) for details.

[![MIT](https://img.shields.io/badge/license-MIT-blue.svg)](https://github.com/darrylschaefer/ai-text-editor/blob/main/LICENSE)
[![v0.4.1](https://img.shields.io/badge/version-0.4.1-blueviolet.svg)](https://github.com/roxelfivan/ai_text_editor_MVP/releases/tag/v0.4.1)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

---

## What's new in v0.4.1

> **Send to AI** now requires **whole-document consistency** for every
> comment-driven fix, and the per-turn prompt is typically **70%+ cheaper
> on long documents** without losing any of the byte-exact anchoring
> the proposed-edit cards depend on.

Three things changed in the comment-batch prompt:

1. **The "address each `[id]` independently" instruction is gone.** The
   system note now requires every replacement to stay consistent in
   voice, terminology, character names, facts, numbers, and style with
   the rest of the document, and tells the model to emit *additional*
   `proposed-edit` fences when a fix logically requires a corresponding
   change elsewhere.
2. **Per-comment blocks now carry local context.** Each `[cN]` in the
   user message also carries the paragraph index, the byte offset, and
   a 120-character context window on each side of the verbatim snippet.
   The model no longer has to fuzzy-match the snippet back into the
   full document.
3. **The document is delivered as a structural outline, not a verbatim
   blob.** `sys-current-doc` now emits one `[pN] offset S–E: <first 60
   chars>` line per paragraph instead of the entire document body. On
   a comment-batch turn the verbatim document is no longer inlined at
   all.

See [Comment + Send to AI](#comment--send-to-ai) for the full flow and
[RELEASE_NOTES.md](./RELEASE_NOTES.md) for the v0.4.1 changelog.

---

## At a glance

```
┌─────────────────────────────────────────────────────────────────────┐
│  ⬢ ApEditor    [Welcome.md ▾]                  📜  🔖  ⚙            │  ← Topbar
├──────────┬──────────────────────────────────────┬───────────────────┤
│          │                                      │                   │
│ ▾ My     │   # Welcome to ApEditor              │   Chat            │
│   docs   │                                      │   ┌─────────────┐ │
│  • Notes │   Pick **Write**, **Preview**, or    │   │ system:     │ │
│  • Blog  │   **Split**.                         │   │ You are...  │ │
│  + New   │                                      │   │             │ │
│          │   Select a passage → **Comment** →   │   │ [▢ include  │ │
│          │   write your note. When you're       │   │  selection] │ │
│          │   ready, click **Send to AI** to     │   │             │ │
│          │   batch every comment into one       │   │ [Type here…]│ │
│          │   chat turn.                         │   │      [Send] │ │
│          │                                      │   └─────────────┘ │
│          │   ┌─ comment ─────────────────────┐  │                   │
│          │   │ 1│ tighten this paragraph     │  │   Assistant       │
│          │   └───────────────────────────────┘  │   reply stream…   │
│          │                                      │                   │
│          │ ┌─ Send to AI tray ───────────────┐  │                   │
│          │ │ 2 comments    [Send to AI  ➤]  │  │                   │
│          │ └─────────────────────────────────┘  │                   │
└──────────┴──────────────────────────────────────┴───────────────────┘
```

ApEditor ships **two themes** — cyberpunk dark and Muji-style light.
Tokens live in `tailwind.config.cjs` and `src/index.css`; the theme
toggles in the topbar.

---

## Features

### Writing

- **Documents** — sidebar with create / rename / delete / switch.
- **Markdown editor** — plain `<textarea>` in **Write**, live
  `react-markdown` **Preview**, or side-by-side **Split**.
- **B / I / U toolbar** — toggle bold (`**…**`), italic (`*…*`),
  and underline (`<u>…</u>`); also `⌘/Ctrl + B/I/U`.
- **Per-document font size** — independent of the global UI font size.
- **Revision history** — **Save** a snapshot from the toolbar, then
  open **History** (top-bar clock / `⌘/Ctrl + H`) to diff and restore.
- **Import text from photos or PDFs** — in-browser OCR (PaddleOCR +
  ONNX Runtime), then Markdown rewrite via your configured model
  before insert at the caret. See [OCR / PDF import](#ocr--pdf-import).

### AI

- **Streaming chat** — right-side panel with system prompt, model
  picker, **include selection** checkbox, and `⌘/Ctrl + Enter` to
  send.
- **Three providers** — MiniMax (OpenAI-compatible, default), OpenAI,
  and **Google AI Mode (no key)**. Switch in **Settings** (⚙).
- **Proposed-edit cards** — when the model emits a `proposed-edit`
  fence, you get a track-changes style diff with **Apply** /
  **Reject** / **Apply N changes** (apply every anchored edit in
  one shot). See [How AI edits work](#how-ai-edits-work).
- **Predict** — inline sentence completion with `Tab` to accept,
  `Esc` to reject, or `⌘/Ctrl + \\` to trigger manually.
- **Customizable system prompt** — the assistant's writing voice is
  yours to set.

### Comment + Send to AI (v0.4.0+)

- **Comment on a passage** — select text → **Comment** in the toolbar
  → write your note. The passage gets a highlight and a numbered
  margin badge.
- **Edit / Delete anytime** — open a badge for **Edit** / **Delete**,
  including after the comment has been sent. `⌘/Ctrl + Z` undoes
  the last comment op.
- **Outdated** — when edits move or delete the anchored text and
  re-anchoring fails, the badge flips to **Outdated** so you can
  clean it up.
- **Send to AI** — the tray under the editor batches the document
  and every comment into one chat turn. The reply comes back as
  the same proposed-edit cards, one per comment. See
  [Comment + Send to AI](#comment--send-to-ai) for the full flow.

### Persistence + privacy

- **Everything in `localStorage`** — documents, chats, revisions,
  prompts, and settings. No backend, no account.
- **Privacy-respecting OCR** — recognition runs entirely in the
  browser. No upload, no telemetry.
- **Security hardening** — see [SECURITY.md](./SECURITY.md) for the
  Content-Security-Policy, HTTPS-only chat endpoint, and markdown
  sanitization.

---

## Quick start

```bash
git clone https://github.com/roxelfivan/ai_text_editor_MVP.git
cd ai_text_editor_MVP
npm install
npm run dev
```

Then open the URL Vite prints (default `http://localhost:5174`) and
click **Settings** (⚙, top right) to paste your API key.

To build for production:

```bash
npm run build      # type-check + build to dist/
npm run preview    # serve the production build locally
```

---

## Configuration

### Providers

The Settings modal's **Provider** dropdown offers three options. The
first two use the OpenAI-compatible `/chat/completions` streaming
protocol; the third is a keyless workflow that opens Google AI Mode
in a new tab.

| Provider | API key | Endpoint (default) | Model presets | Notes |
| --- | --- | --- | --- | --- |
| **MiniMax** (default) | Required | `https://api.minimax.io/v1` | `MiniMax-M3`, `MiniMax-M3-fast`, `MiniMax-M2.7`, `MiniMax-M2.7-highspeed` | Base URL is fine — the client appends `/chat/completions` automatically. |
| **OpenAI** | Required | `https://api.openai.com/v1` | `gpt-4o-mini`, `gpt-4o`, `gpt-4-turbo`, `o1-mini`, `o1`, `gpt-3.5-turbo` | Same wire format as MiniMax. |
| **Google AI Mode (no key)** | None | `https://www.google.com/search?udm=50` | — | Chat opens a new tab pre-filled with your prompt; you copy the answer back. **Predict** is disabled for this provider. |

API keys are stored only in this browser's `localStorage` and sent as
`Authorization: Bearer <key>` directly to your chosen endpoint.

### Environment overrides

You can override the default provider, endpoint, and model at build
time by setting the following variables in `.env` (see
[`.env.example`](./.env.example)):

```bash
VITE_DEFAULT_PROVIDER=minimax        # one of: minimax, openai, google-ai-mode
VITE_DEFAULT_API_ENDPOINT=https://api.minimax.io/v1
VITE_DEFAULT_MODEL=MiniMax-M2.7
```

The in-app **Settings** modal always wins — these values only set
the first-run defaults.

### System prompt

The default system message is a writing-assistant prompt
("be concise, specific, and preserve the user's voice when
revising…"). Edit it in **Settings** → **System instructions**.
Changes apply to the next chat send; the existing chat history is
unaffected.

### Temperature

The default is `0.7`. Lower for more deterministic rewrites;
higher for more creative brainstorming. Persisted in `localStorage`.

---

## Hotkeys

| Key | Action |
| --- | --- |
| `⌘ / Ctrl + Enter` | Send chat message |
| `⌘ / Ctrl + .` | Open **Settings** |
| `⌘ / Ctrl + ,` | Open **Prompt library** |
| `⌘ / Ctrl + H` | Open **Revision history** |
| `⌘ / Ctrl + B` | Toggle sidebar (deferred when inside the editor) |
| `⌘ / Ctrl + Shift + C` | Toggle chat panel |
| `⌘ / Ctrl + B / I / U` (in editor) | Bold / Italic / Underline |
| `⌘ / Ctrl + Z` (in editor, after a comment op) | Undo last comment op |
| `⌘ / Ctrl + \\` | Manual **Predict** trigger |
| `Tab` / `Esc` (Predict pill) | Accept / reject inline completion |
| `⌘ / Ctrl + Enter` (in comment composer / popover) | Save comment |
| `Esc` (in comment composer / popover) | Cancel / close |

---

## How AI edits work

The chat API expects the model to emit one or more fenced blocks
with the `proposed-edit` info-string. Each fence is a JSON object
the editor parses into a track-changes style card:

````
```proposed-edit
{
  "id": "p1",
  "summary": "Tighten the second sentence",
  "original": "<verbatim substring of the current document>",
  "replacement": "<the new text>"
}
```
````

**Rules the model follows (see `src/api/chat.ts`):**

- `original` is a byte-for-byte copy of a substring in the document.
  No paraphrasing. If the document says "Section 1. Background",
  `original` starts with exactly that text.
- Multiple fences in one reply are allowed; one per change.
- `original` should be as short as possible while still uniquely
  locating the text.
- Prose outside the fences is rendered as normal markdown.

### Per-card actions

- **Apply** — write the change into the document at the anchored
  position. Fails if `original` no longer matches (e.g. you edited
  the document since the reply was generated); the card flips to
  **Missing** and offers a **Force-apply…** action that anchors at
  the current caret instead.
- **Reject** — discard the change.
- **Reject with feedback** — stage a reason for a follow-up chat
  turn; on **Send** the staged reasons are folded into a single
  prompt so the model can address them all together.
- **Apply N changes** (chat footer) — bulk-apply every anchored
  edit in that reply. Un-anchorable edits are skipped silently
  with a footer line like `Applied 4 of 5 changes (1 skipped —
  not anchored)`.

### Example

1. Open a document and highlight a paragraph you want to improve.
2. In the chat panel, check **include selection**.
3. Type: `Make this more concise.` and press `⌘/Ctrl + Enter`.
4. The AI streams back a `proposed-edit` card.
5. Read the diff, then click **Apply**. The document updates.

---

## Comment + Send to AI

This is the headline flow introduced in v0.4.0 and tightened in
v0.4.1.

### The user-facing flow

1. **Select a passage** in **Write** (or the Write side of **Split**).
2. Click **Comment** in the editor toolbar and write your note.
3. The passage is highlighted; a numbered badge appears in the margin.
4. Open a badge to **Edit** or **Delete**. **Outdated** means the
   anchored text could not be re-found after edits — fix it from the
   popover.
5. Click **Send to AI** under the editor when you want the model to
   address every comment in one chat turn.

### How the prompt is built (v0.4.1)

The **Send to AI** tray dispatches the comment batch as the user's
chat message. `buildRequestMessages` in `src/api/chat.ts` then pushes
five system messages around the user's turn:

1. **`sys`** — the user's customizable system prompt.
2. **`sys-current-doc`** — a structural outline of the document
   (`[pN] offset S–E: <first 60 chars>` per paragraph) plus a
   length / paragraph count header. The verbatim document is
   **not** inlined on comment-batch turns.
3. **`sys-proposed-edit-rules`** — the `proposed-edit` fence schema
   and rules, kept as a stable contract independent of the document
   and the user's system prompt.
4. The **user message** — one block per comment, in document order:
   ```
   [c1] (paragraph 7/32, doc offset 1840–1920)
   "<verbatim snippet>"
   Context before: "<120 chars before>"
   Context after:  "<120 chars after>"
   Comment: <user's comment body>
   ```
5. **`*-comments-batch`** — the one-shot instruction note that
   requires whole-document consistency (voice, terminology,
   character names, facts, numbers, style) and tells the model to
   emit *additional* `proposed-edit` fences when a fix logically
   requires a corresponding change elsewhere.

The reply comes back as the same proposed-edit cards you'd get from
a normal chat rewrite — one per comment, plus any extra fences the
model emits to keep the document coherent.

### Token savings

For a 10,000-character document with 5 short comments, the v0.4.0
prompt sent roughly 3,000 tokens; v0.4.1 sends roughly 900 — about
a 70% reduction — and the consistency requirements are *stronger*
than before. See the [v0.4.1 release notes](./RELEASE_NOTES.md) for
the worked example.

---

## OCR / PDF import

The editor toolbar's **Import text from photos or PDFs** button
recognizes text from one or more images or PDF files and inserts
the result at your caret.

### Accepted formats

- **Images** — `image/*` (PNG, JPEG, WebP, …). Recognized via
  PaddleOCR (`PP-OCRv6_tiny`, multilingual).
- **PDFs** — text-native PDFs are read directly with `pdfjs-dist`
  (no OCR); scanned / image-native PDFs are rasterized in the
  browser and then run through the same PaddleOCR pipeline.
- Mixed batches are processed in order.

### How to use it

1. Open (or create) a document and place the caret where the
   imported text should land.
2. Click **Import text from photos or PDFs** in the editor toolbar.
3. Pick the language(s), then choose your file(s).
4. A small progress chip (`reading… 2/5`) appears while the
   engine works.
5. When recognition finishes, the extracted text is sent to your
   configured chat model and rewritten as reader-friendly
   Markdown. Only that Markdown is inserted at the caret. An
   API key is required.

### Privacy

- **Zero network calls** for the OCR pipeline. All models, the
  `onnxruntime-web` WASM, and the `pdfjs-dist` worker are served
  from `public/ocr/`, `public/ort/`, and `public/pdfjs/`
  (~90 MB total, in-repo).
- ObjectURLs are revoked, `<img>`/`<canvas>` backing buffers
  are zeroed, and `pdf.destroy()` + `page.cleanup()` are called
  in `finally` blocks after every batch.
- The PaddleOCR engine is a module-level singleton — no
  per-call binary data lingers between recognitions.

### Implementation pointers

- `src/utils/ocr.ts` — lazy-init PaddleOCR, dispatch by MIME
  (image vs PDF), strict per-call cleanup.
- `src/utils/pdf.ts` — thin wrapper around `pdfjs-dist` for
  `getTextContent` and `page.render`.
- `src/utils/ocrMarkdown.ts` — streams the extracted text
  through the configured model and unwraps an accidental outer
  markdown fence.
- `src/components/ImportMediaButton.tsx` — image+PDF picker,
  language checkboxes, progress UI; after OCR, dispatches an
  `mvp:insert-text` `CustomEvent` that `Editor.tsx` consumes to
  splice the Markdown in.

---

## Architecture

```
src/
├── App.tsx                  # Layout, hotkeys, modal orchestration.
├── main.tsx                 # React entry, theme bootstrap.
├── index.css                # Tailwind layers + markdown + diff + theme.
├── types.ts                 # Shared TS types.
├── api/
│   └── chat.ts              # OpenAI-compatible streaming client +
│                            # request-message builder, doc outline,
│                            # proposed-edit + comment-batch system notes.
├── config/
│   └── providers.tsx        # MiniMax / OpenAI / Google AI Mode presets.
├── store/
│   └── useStore.ts          # zustand store + localStorage persistence.
├── hooks/
│   └── useDragResize.ts     # Resizable chat / sidebar logic.
├── utils/
│   ├── comments.ts          # Comment re-anchor, batch format, selection rect.
│   ├── diff.ts              # Line-diff helper for revisions.
│   ├── googleAiMode.ts      # Google AI Mode deep-link builder.
│   ├── ocr.ts               # PaddleOCR pipeline for image import.
│   ├── pdf.ts               # pdfjs-dist wrapper.
│   ├── proposedEdit.ts      # Proposed-edit parsing + formatting.
│   └── ocrMarkdown.ts       # Chat-model Markdown reformatting of OCR output.
└── components/
    ├── Sidebar.tsx
    ├── Editor.tsx           # Textarea + mirror + comment layer + toolbar.
    ├── ChatPanel.tsx        # Streaming chat + proposed-edit cards +
    │                        # comment-batch send handler.
    ├── CommentLayer.tsx     # Mirror overlay (highlights under textarea).
    ├── CommentMargin.tsx    # Numbered margin badges.
    ├── CommentComposer.tsx  # Floating composer after **Comment**.
    ├── CommentPopover.tsx   # Edit / Delete popover on a badge.
    ├── CommentTray.tsx      # **Send to AI** tray under the editor.
    ├── PromptLibrary.tsx
    ├── ProposedEditCard.tsx # Apply / Reject cards for AI diffs.
    ├── RevisionHistory.tsx
    ├── SettingsModal.tsx
    ├── ImportMediaButton.tsx
    ├── EdgeAnchor.tsx       # Side / top edge-anchor toggles.
    ├── ResizeHandle.tsx     # Drag-to-resize between sidebar/editor/chat.
    └── Topbar.tsx           # (inlined in App.tsx — see App.tsx)
```

State lives in a single zustand store (`src/store/useStore.ts`),
persisted to `localStorage` under the `ai-text-editor-mvp` key.
Messages between components use `window` `CustomEvent`s
(`mvp:editor-selection`, `mvp:fill-chat`, `mvp:send-comments`,
`mvp:chat-streaming`, `mvp:mark-comments-sent`, `mvp:insert-text`)
to keep the editor / chat / comment layer one-way coupled.

---

## Privacy & security

ApEditor has no backend. Your documents, chats, revisions, prompts,
and settings are all in your browser's `localStorage`. The only
network calls are the chat API requests you send, and they go
directly to the endpoint you configured in **Settings**.

- **HTTPS-only chat endpoint** — the client refuses to send your
  Bearer token to a non-HTTPS endpoint. `http://localhost` is still
  allowed for local dev.
- **Markdown is sanitized** — content from the chat model is passed
  through `rehype-sanitize` after `rehype-raw` (keeping `<u>` for
  the toolbar's underline button).
- **Content-Security-Policy** — `index.html` ships a baseline CSP
  that the OCR path tightens further to allow OpenCV's `Function`
  embind invokers and the ONNX Runtime `data:` WASM fetch.
- **OCR privacy** — image recognition runs entirely in-browser.
  See [OCR / PDF import](#ocr--pdf-import).

See [SECURITY.md](./SECURITY.md) for the full threat model and
residual risks.

---

## Scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | Start Vite dev server with HMR. |
| `npm run build` | Type-check and build for production (`dist/`). |
| `npm run preview` | Serve the production build locally. |
| `npm run typecheck` | Type-check only (no emit). |

---

## Release notes

Full release notes live in [RELEASE_NOTES.md](./RELEASE_NOTES.md);
per-release notes also ship on the GitHub release pages.

| Version | Highlights |
| --- | --- |
| [v0.4.1](https://github.com/roxelfivan/ai_text_editor_MVP/releases/tag/v0.4.1) | **Send to AI** requires whole-document consistency; per-comment context windows; doc outline instead of verbatim document. |
| [v0.4.0](https://github.com/roxelfivan/ai_text_editor_MVP/releases/tag/v0.4.0) | **Comment** + **Send to AI**, **Google AI Mode (no key)**, title-case **Predict**, Welcome quick start. |
| [v0.3.4](https://github.com/roxelfivan/ai_text_editor_MVP/releases/tag/v0.3.4) | Import → Markdown, OCR works under CSP, security hardening, topbar icons. |
| [v0.3.3](https://github.com/roxelfivan/ai_text_editor_MVP/releases/tag/v0.3.3) | **Apply All** for proposed edits, B/I/U toolbar, Debug Mode, global UI font size. |
| [v0.3.2](https://github.com/roxelfivan/ai_text_editor_MVP/releases/tag/v0.3.2) | Debug mode, mobile-friendly editor, manual Predict. |
| [v0.3.1](https://github.com/roxelfivan/ai_text_editor_MVP/releases/tag/v0.3.1) | Inline sentence completion, roomier toolbar. |
| [v0.3.0](https://github.com/roxelfivan/ai_text_editor_MVP/releases/tag/v0.3.0) | ApEditor design system, transparent wordmark, redesigned toolbar. |
| [v0.2.x](https://github.com/roxelfivan/ai_text_editor_MVP/releases?q=v0.2) | Earlier UI overhauls, bug fixes. |

---

## What's intentionally **not** here

This MVP is a bare-bones reproduction. The original project includes
far more — the upgrade path is to copy components from
[`ai-text-editor`](https://github.com/darrylschaefer/ai-text-editor)
into this project one at a time.

- **Lexical rich-text editor** (the MVP uses a plain `<textarea>`).
- **AI agents with function-calling tools**.
- **Embeddings / semantic search**.
- **Google Drive sync, GitHub sync, Electron desktop build**.
- **Token counting, cost tracking, fine-tune UI**.
- **Multi-language i18n**.
- **Mobile-specific layout** (works, but is a desktop-first design).

---

## Credits

### Lineage

This project is a re-produced MVP of
[**ai-text-editor**](https://github.com/darrylschaefer/ai-text-editor)
by [**@darrylschaefer**](https://github.com/darrylschaefer) (MIT
licensed). The original project is a full-featured AI word
processor; this one extracts only the core markdown editing + AI
chat loop as a lightweight starting point.

### Libraries

The app is built on top of these open-source projects. Each is
bundled or pulled at install time and retains its original license.

| Library | Version | License | Used for |
| --- | --- | --- | --- |
| [React](https://react.dev/) | 18.3.1 | MIT | UI runtime. |
| [react-dom](https://react.dev/) | 18.3.1 | MIT | DOM renderer. |
| [react-markdown](https://github.com/remarkjs/react-markdown) | 9.x | MIT | Markdown → React renderer. |
| [remark-gfm](https://github.com/remarkjs/remark-gfm) | 4.x | MIT | GFM (tables, task lists, autolinks). |
| [rehype-raw](https://github.com/rehypejs/rehype-raw) | 7.x | MIT | Allow raw HTML (e.g. `<u>` underline). |
| [rehype-sanitize](https://github.com/rehypejs/rehype-sanitize) | 6.x | MIT | Sanitize model-supplied HTML. |
| [Zustand](https://github.com/pmndrs/zustand) | 4.5.x | MIT | Store + `localStorage` persistence. |
| [diff](https://github.com/kpdecker/jsdiff) | 5.x | BSD-3-Clause | Line / word diff for revisions. |
| [uuid](https://github.com/uuidjs/uuid) | 9.x | MIT | Stable IDs for documents / messages. |
| [Vite](https://vitejs.dev/) | 5.x | MIT | Dev server / build. |
| [TypeScript](https://www.typescriptlang.org/) | 5.x | Apache-2.0 | Type-checking. |
| [Tailwind CSS](https://tailwindcss.com/) | 3.x | MIT | Utility CSS + the ApEditor design tokens. |
| [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react) | 4.x | MIT | Fast Refresh + JSX. |
| [postcss](https://postcss.org/) / [autoprefixer](https://github.com/postcss/autoprefixer) | latest | MIT | Tailwind pipeline. |

### In-browser OCR / PDF pipeline

The **Import photos / PDFs** button runs the following projects
entirely in the browser (no data leaves the device). Models and
workers are served from `public/ocr/`, `public/ort/`, and
`public/pdfjs/`.

| Library | Version | License | Used for |
| --- | --- | --- | --- |
| [PaddleOCR (`@paddleocr/paddleocr-js`)](https://github.com/PaddlePaddle/PaddleOCR) | 0.4.2 | Apache-2.0 | Multilingual text recognition (`PP-OCRv6_tiny`). |
| [ONNX Runtime Web](https://github.com/microsoft/onnxruntime) | 1.30.0 | MIT | Runs the PaddleOCR model in-browser. |
| [PDF.js (`pdfjs-dist`)](https://github.com/mozilla/pdf.js) | 4.x | Apache-2.0 | Text-native PDF extraction + page rasterization for OCR. |

### AI providers (configurable)

The chat backend is provider-agnostic — the app speaks the
OpenAI-compatible `/chat/completions` streaming protocol. MiniMax
ships as the default preset; OpenAI and Google AI Mode are
selectable from **Settings** → **Provider**.

API keys are stored only in this browser's `localStorage` and sent
as `Authorization: Bearer <key>` directly to your chosen endpoint.

### Logo

The ApEditor logo shipped in `public/apeditor-logo.jpg` is original
artwork created for this project. The ApEditor wordmark and design
system in `tailwind.config.cjs` are also original to this
repository.

---

*Licensed under the MIT License. See the original project's
[LICENSE](https://github.com/darrylschaefer/ai-text-editor/blob/main/LICENSE)
for details.*
