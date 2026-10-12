# ApEditor — AI Markdown Editor (MVP)

> **Based on [ai-text-editor](https://github.com/darrylschaefer/ai-text-editor) by [@darrylschaefer](https://github.com/darrylschaefer).**
> This repository is a stripped-down, re-produced MVP of the original project, keeping only the core editor + AI chat loop in a minimal number of files. See [Credits](#credits) for details.

A minimal, local-first AI markdown editor. Everything runs in the browser — no backend, no account required.

## Features

- **Documents** — sidebar with create / rename / delete / switch.
- **Markdown editor** — plain `<textarea>` in **Write**, live
  `react-markdown` **Preview**, or **Split**.
- **AI chat** — right-side panel with streaming responses, system prompt,
  model picker, **include selection** checkbox, and ⌘/Ctrl+Enter to send.
- **Comment (v0.4.0)** — select a passage → click **Comment** in the
  editor toolbar → write your note. The passage gets a highlight and a
  numbered margin badge. Open a badge to **Edit** or **Delete**
  (including after send). Click **Send to AI** under the editor to
  dispatch the article plus every comment as one batch; the reply
  arrives as the same proposed-edit cards used for chat rewrites.
  `⌘/Ctrl + Z` undoes the last comment change; comments re-anchor when
  the document is edited (**Outdated** when they cannot).
- **Prompt library** — seed prompts plus your own (top-bar bookmark /
  `⌘/Ctrl + ,`).
- **Revision history** — **Save** a snapshot from the editor toolbar,
  then open **Revision history** (top-bar clock / `⌘/Ctrl + h`) to
  diff and restore.
- **Import text from photos or PDFs** — in-browser OCR (PaddleOCR +
  ONNX Runtime), then Markdown rewrite via your configured model
  before insert at the caret.
- **Predict** — toolbar control that turns inline sentence suggestions
  on/off (`Tab` / **Accept**, `Esc` / **Reject**, or `⌘/Ctrl + \`).
- **Two themes** — cyberpunk dark and Muji-style light. Design tokens
  live in `tailwind.config.cjs` and `src/index.css`.

Everything (documents, chats, revisions, prompts, settings) is persisted
in `localStorage` via `zustand/middleware`. Nothing leaves your browser
except the chat API requests, which go straight to your configured
endpoint with your API key.

## AI config (carried over from the original)

The MVP ships with the same defaults as the original project so the two
stay drop-in compatible:

| Setting      | Default                          |
| ------------ | -------------------------------- |
| Model        | `MiniMax-M2.7`                  |
| API endpoint | `https://api.minimax.io/v1`      |
| Auth         | `Authorization: Bearer <API_KEY>`|

The endpoint can be a base URL — the client appends `/chat/completions`
automatically. You can swap the model to any string your provider accepts
(MiniMax ships `MiniMax-M3`, `MiniMax-M3-fast`, `MiniMax-M2.7-highspeed`
alongside the default; OpenAI models and anything else OpenAI-compatible
works too).

Open **Settings** (⚙ button, top right) and paste your key on first run.
You can also set `VITE_DEFAULT_API_ENDPOINT` / `VITE_DEFAULT_MODEL` in
`.env` to override the defaults at build time.

### Third option: Google AI Mode (no API key)

The Settings provider dropdown has a third option,
`Google AI Mode (no key)`, that does **not** require an API key and
does **not** call any external API from the editor itself. When this
provider is selected, clicking *Send* in the chat panel:

1. Builds a Google AI Mode deep-link (`https://www.google.com/search?udm=50`)
   pre-filled with your current prompt (system instructions, the open
   document, and the chat history are folded into the query).
2. Opens that URL in a new browser tab.
3. Shows a "Paste the AI Mode answer" textarea back in the chat panel.

You read the answer on the Google AI Mode page, copy it, and paste it
back into the editor. The pasted answer is appended to the chat as a
normal assistant message — any `proposed-edit` fenced blocks inside it
become the same proposed-edit cards you get with the OpenAI-compatible
providers, so **Apply** / **Reject** / **Apply N changes** all keep working.

This option exists for users who don't want to set up an API key. It
deliberately does **not** scrape or automate Google AI Mode — the user
is always the one copying the answer back. The inline sentence
completion feature in the editor toolbar is automatically disabled
when this provider is active (it has no streaming API to call).

## Quick start

```bash
cd ai_text_editor_MVP
npm install
npm run dev
```

Then open the URL Vite prints (default `http://localhost:5174`).

## Scripts

| Script            | What it does                                 |
| ----------------- | -------------------------------------------- |
| `npm run dev`     | Start Vite dev server with HMR.              |
| `npm run build`   | Type-check and build for production (`dist/`).|
| `npm run preview`  | Serve the production build locally.           |
| `npm run typecheck`| Type-check only (no emit).                  |

## File layout

```
src/
├── App.tsx               # Layout, hotkeys, modal orchestration.
├── main.tsx              # React entry, theme bootstrap.
├── index.css             # Tailwind layers + markdown + diff + theme styles.
├── types.ts              # Shared TS types.
├── api/
│   └── chat.ts           # OpenAI-compatible streaming client.
├── store/
│   └── useStore.ts       # zustand store + localStorage persistence.
├── utils/
│   ├── comments.ts       # Comment re-anchor, batch format, selection rect.
│   ├── diff.ts           # Line-diff helper for revisions.
│   ├── googleAiMode.ts   # Google AI Mode deep-link builder.
│   ├── ocr.ts            # PaddleOCR pipeline for image import.
│   ├── pdf.ts            # pdfjs-dist wrapper for PDF text / render.
│   └── proposedEdit.ts   # Proposed-edit parsing + formatting.
└── components/
    ├── Sidebar.tsx
    ├── Editor.tsx
    ├── ChatPanel.tsx
    ├── CommentLayer.tsx      # Mirror overlay (highlights under textarea).
    ├── CommentMargin.tsx     # Numbered margin badges.
    ├── CommentComposer.tsx   # Floating composer after Comment.
    ├── CommentPopover.tsx    # Edit / Delete popover on a badge.
    ├── CommentTray.tsx       # Send to AI tray under the editor.
    ├── PromptLibrary.tsx
    ├── ProposedEditCard.tsx  # Apply / Reject cards for AI diffs.
    ├── RevisionHistory.tsx
    ├── SettingsModal.tsx
    ├── ImportMediaButton.tsx # Import text from photos or PDFs.
    ├── EdgeAnchor.tsx        # Side / top edge-anchor toggle.
    └── ResizeHandle.tsx
```

## Comment — feedback on a passage

1. Select text in **Write** (or the Write side of **Split**).
2. Click **Comment** in the editor toolbar and write your note.
3. The passage is highlighted; a numbered badge appears in the margin.
4. Click a badge to **Edit** or **Delete**. **Outdated** means the
   anchored text could not be found after edits.
5. Click **Send to AI** under the editor when you want the model to
   address every comment in one chat turn.

## Reviewing AI edits

When the AI proposes changes, they appear as cards in the chat reply
(and as track-changes style diffs).

### How it works

1. **Trigger a proposal** — Select text, check **include selection** in
   the chat panel, and ask to rewrite / shorten / expand. Or use
   **Comment** + **Send to AI**.
2. **Cards appear** — each card shows the original vs proposed text.
3. **Apply or Reject** — click **Apply** to write the change into the
   document, or **Reject** to discard it. Use **Reject with feedback**
   to stage a reason for a follow-up chat turn.
4. **Several changes** — use **Apply N changes** in the chat footer to
   apply every anchored edit from that reply. If a quote is missing,
   click in the editor and use **Force-apply…**.

### Hands-on example

```
1. Open a document with some markdown content.
2. Highlight a paragraph you want the AI to improve.
3. In the chat panel, check include selection.
4. Type: "Make this more concise" and press ⌘/Ctrl+Enter.
5. The AI streams back a proposed edit.
6. Read the diff, then click Apply.
   The document updates instantly.
```

### Under the hood

- `utils/proposedEdit.ts` — parses the AI's diff payload into structured `ProposedEdit` objects (type defined in `types.ts`).
- `components/ProposedEditCard.tsx` — renders the **Apply** / **Reject** UI with diff highlighting.

## Import text from photos or PDFs

The editor toolbar has an **Import text from photos or PDFs** button that
recognizes text from one or more images or PDF files and inserts the
result at your caret. OCR runs locally — no upload for recognition.

### What it accepts

- **Images** — `image/*` (PNG, JPEG, WebP, …). Recognized via PaddleOCR
  (`PP-OCRv6_tiny`, multilingual: English + Simplified + Traditional
  Chinese in a single pass).
- **PDFs** — text-native PDFs are read directly with `pdfjs-dist`
  (no OCR); scanned / image-native PDFs are rasterized in the browser
  and then run through the same PaddleOCR pipeline.
- Mixed batches are processed in order.

### Languages

A small popover lets you check **English / Simplified Chinese /
Traditional Chinese**. At least one must stay checked. The OCR model
itself is a single multilingual model, so the checkbox state is
informational only — checking multiple doesn't trigger separate
recognitions.

### Privacy & cleanup

- **Zero network calls** for the OCR pipeline. All models, the
  `onnxruntime-web` WASM, and the `pdfjs-dist` worker are served from
  `public/ocr/`, `public/ort/`, and `public/pdfjs/` (~90 MB total, in-repo).
- ObjectURLs are revoked, `<img>`/`<canvas>` backing buffers are
  zeroed, and `pdf.destroy()` + `page.cleanup()` are called in
  `finally` blocks after every batch.
- The PaddleOCR engine is a module-level singleton — no per-call
  binary data lingers between recognitions.
- `vite.config.ts` sets the `Cross-Origin-Opener-Policy` /
  `Cross-Origin-Embedder-Policy` headers needed for
  `SharedArrayBuffer`, which is what lets the threaded ORT WASM
  backend run.

### How to use it

1. Open (or create) a document and place the caret where the imported
   text should land.
2. Click **Import text from photos or PDFs** in the editor toolbar.
3. Pick the language(s), then choose your file(s).
4. Select one or more images / PDFs. A small progress chip
   (`reading… 2/5`) appears while the engine works.
5. When recognition finishes, the extracted text is sent to your
   configured chat model and rewritten as reader-friendly Markdown.
   Only that Markdown is inserted at the caret. The file input
   resets so you can re-pick the same files without a refresh.
   An API key is required — without one, import stops before any
   text is pasted.

### Under the hood

- `src/utils/ocr.ts` — lazy-init PaddleOCR, dispatch by MIME
  (image vs PDF), strict per-call cleanup.
- `src/utils/pdf.ts` — thin wrapper around `pdfjs-dist` for
  `getTextContent` and `page.render`.
- `src/components/ImportMediaButton.tsx` — image+PDF picker, language
  checkboxes, progress UI; after OCR, calls `formatOcrAsMarkdown` then
  dispatches a `mvp:insert-text` `CustomEvent` that
  `src/components/Editor.tsx` consumes to splice the Markdown in.
- `src/utils/ocrMarkdown.ts` — streams the extracted text through the
  configured model and unwraps an accidental outer markdown fence.

## Hotkeys

| Key                      | Action                                   |
| ------------------------ | ---------------------------------------- |
| ⌘ / Ctrl + .            | Open Settings                            |
| ⌘ / Ctrl + ,            | Open Prompt library                      |
| ⌘ / Ctrl + h            | Open Revision history                    |
| ⌘ / Ctrl + Enter        | Send chat message                        |
| ⌘ / Ctrl + Z            | Undo last comment op (delete / edit)     |

## Release notes

### v0.4.1 — Comment / Send to AI: whole-document consistency, fewer tokens

- **Whole-document consistency is now explicit.** The system note
  pushed alongside a **Send to AI** comment batch no longer says
  "address each `[id]` independently" — every replacement must now
  stay consistent in voice, terminology, character names, facts,
  numbers, and style with the rest of the document, and the model
  must emit additional `proposed-edit` fences when a fix logically
  requires a corresponding change elsewhere.
- **Per-comment blocks carry local context.** Each `[cN]` in the
  user message now also carries the paragraph index, the byte
  offset, and a 120-character context window on each side of the
  verbatim snippet. The model no longer has to fuzzy-match the
  snippet back into the full document.
- **Document is delivered as a structural outline, not a verbatim
  blob.** The `sys-current-doc` system message now emits one
  `[pN] offset S–E: <first 60 chars>` line per paragraph instead
  of the entire document body. On a comment-batch turn the
  verbatim document is no longer inlined at all, which typically
  saves 70%+ of the per-turn prompt on long documents.
- **Proposed-edit fence schema is its own system message** so the
  rules stay a stable contract independent of the document and
  the user's customizable system prompt.

### v0.4.0 — Comment + Send to AI, Google AI Mode, Predict label

- **Comment** — select a passage → **Comment** → highlight + numbered
  margin badge. Badge popover: **Edit** / **Delete** (including after
  send). **Send to AI** under the editor batches the article and every
  comment. **Outdated** when re-anchoring fails. `⌘/Ctrl + Z` undoes
  the last comment change.
- **Google AI Mode (no key)** — Settings provider that opens Google AI
  Mode in a new tab; paste the answer back into chat. Proposed-edit
  cards (**Apply** / **Reject**) still work. **Predict** stays off for
  this provider (no streaming API).
- **Predict** toolbar label is title case (`Predict`, not `PREDICT`).
- **Welcome** quick start rewritten to match on-screen labels
  (**Write** / **Preview** / **Split**, **include selection**,
  **Apply N changes**, **Import text from photos or PDFs**, etc.).

### v0.3.4 — Import → Markdown, OCR works under CSP, security hardening, topbar icons

- **Import photos & PDFs → Markdown** — successful OCR / PDF text
  extraction is now rewritten as reader-friendly Markdown by the
  configured chat model before anything is inserted into the editor.
  Raw OCR output is never pasted into the document. The conversion
  request goes through the same chat client as the rest of the app,
  using only the API key configured in **Settings** — no built-in,
  Cursor, or fallback key is used. An API key is required; images
  still stay in the browser.
- **OCR & PDF import under CSP** — Photo / PDF import failed under
  the v0.3.3 page CSP because PaddleOCR pulls OpenCV.js (whose
  embind layer builds invokers with the `Function` constructor) and
  an ONNX Runtime bundle that loaded a `data:`-sourced WASM. OCR
  now initializes under the existing `script-src` policy: ONNX
  Runtime is aliased to the WASM-only extern build (so the WebGPU
  / JSEP embind path isn't loaded), and `unsafe-eval` plus
  `data:` are allowed specifically for the OCR path.
- **Topbar action icons** — the **History**, **Prompts**, and
  **Settings** buttons in the topbar are now distinct icons
  instead of text labels. History uses a clock, Prompts a
  bookmark, and Settings a gear with a missing-key badge. The
  first two share the square outline treatment used by
  **Import** / **Save**; Settings keeps its filled fire
  treatment.
- **Import popover stays in the viewport on mobile** — the OCR
  language picker used to be absolutely right-aligned to the
  Import button; on a wrapped vertical mobile toolbar that put
  the panel off-screen. It now uses fixed coordinates clamped to
  the viewport on both edges.
- **Security hygiene pass** — markdown rendered from the chat
  model is now passed through `rehype-sanitize` after `rehype-raw`
  (keeping `<u>` for the toolbar's underline button). API
  requests refuse to send the Bearer token to non-HTTPS endpoints
  (`http://localhost` is still allowed for local dev). A baseline
  CSP meta tag is added to `index.html`, and a new `SECURITY.md`
  documents findings and residual risks. No secrets were found in
  the v0.3.3 tree.
- **Docs** — the seeded Welcome document was rewritten as a 7-step
  quick start so first-time users see a guided path instead of a
  long reference page.

### v0.3.3 — Apply All, B/I/U toolbar, debug mode, global UI font size

- **Apply All** for proposed edits — each assistant message with
  proposed edits now has a single **Apply All** button that bulk-applies
  every anchorable edit in one document update and reports
  `Applied X of Y changes (Z skipped — not anchored)` in the chat
  footer. Un-anchorable edits are skipped silently, matching the
  per-card "force-apply at caret" fallback for individual edits.
- **Editor B / I / U toolbar** — three new buttons (and ⌘/Ctrl+B,
  ⌘/Ctrl+I, ⌘/Ctrl+U shortcuts) wrap the current selection in the
  matching markdown marker. Bold / Italic are toggle-aware (clicking
  on already-formatted text unwraps it); Underline uses raw
  `<u>…</u>` HTML via `rehype-raw`. The page no longer jumps to the
  top/end of the document when a toolbar button is clicked with the
  mouse — `preventDefault` on `mousedown` keeps focus on the textarea
  and the focus-restoration microtask uses
  `focus({ preventScroll: true })`.
- **Debug Mode** — a new switch in **Settings** that gates the
  inline-completion status pill (`idle` / `thinking` / `ready · tab`)
  and the request/accept counters in the editor toolbar. The
  underlying inline-completion state machine keeps running
  regardless, so toggling Debug Mode only changes which diagnostic
  UI is visible — it never pauses or restarts the feature. Defaults
  to off so the toolbar stays minimal for end users.
- **Global UI font size** — a new slider in **Settings** scales
  every UI text in the app (topbar, sidebar, chat, modals) while
  the editor's own textarea / preview / toolbar remain governed by
  their independent per-document font-size control. A `Reset` button
  restores the 14px default; the value is persisted in `localStorage`
  and clamped to `[12, 20]` px.
- **Settings modal layout** — the modal body is now scrollable
  (header / footer stay pinned at small window heights), and
  **Debug Mode** + **UI font size** sit on a single row at
  `sm:` viewports and stack below.
- **Hygiene pass** — several dead-code and unreachable-code paths
  were removed (orphaned counters, three `queueMicrotask` blocks
  consolidated into a `restoreCaret` helper, the no-op
  `.prose-md em { @apply italic; }` rule, an unused `skippedIds`
  field, `disabled={!doc}` on buttons guarded by an early return).

### v0.3.2 — Debug mode, mobile-friendly editor, manual Predict

- Initial Debug Mode hookup, mobile-friendly editor layout, and a
  manual **Predict** button as a fallback for the inline trigger.

### v0.3.1 — Inline sentence completion + roomier editor toolbar

- Tab-to-accept and ⌘/Ctrl+\\ manual trigger for the inline sentence
  completion feature; toolbar chrome made roomier for the new
  affordances.

### v0.3.0 — Editorial palette, transparent wordmark, redesigned toolbar

- ApEditor design system (cyberpunk dark + Muji light), transparent
  logo wordmark, and a redesigned editor toolbar.

## What's intentionally **not** here

This MVP is a bare-bones reproduction. The original project includes far more:

- Lexical rich-text editor (replaced here by a plain textarea).
- AI agents with function-calling tools.
- Embeddings / semantic search.
- Google Drive sync, GitHub sync, Electron desktop build.
- Token counting, cost tracking, fine-tune UI.
- Multi-language i18n.
- Mobile-specific layout.

If you outgrow the MVP, the upgrade path is to copy components from the
original [`ai-text-editor`](https://github.com/darrylschaefer/ai-text-editor)
into this project one at a time.

## Credits

### Lineage

This project is a re-produced MVP of
[**ai-text-editor**](https://github.com/darrylschaefer/ai-text-editor) by
[**@darrylschaefer**](https://github.com/darrylschaefer) (MIT licensed).
The original project is a full-featured AI word processor; this one
extracts only the core markdown editing + AI chat loop as a lightweight
starting point.

### Libraries

The app is built on top of these open-source projects. Each is bundled
or pulled at install time and retains its original license.

| Library | Version | License | Used for |
| --- | --- | --- | --- |
| [React](https://react.dev/) | 18.3.1 | MIT | UI runtime. |
| [react-dom](https://react.dev/) | 18.3.1 | MIT | DOM renderer. |
| [react-markdown](https://github.com/remarkjs/react-markdown) | 9.1.0 | MIT | Markdown → React renderer. |
| [remark-gfm](https://github.com/remarkjs/remark-gfm) | 4.0.1 | MIT | GFM (tables, task lists, autolinks). |
| [Zustand](https://github.com/pmndrs/zustand) | 4.5.7 | MIT | Store + `localStorage` persistence. |
| [diff](https://github.com/kpdecker/jsdiff) | 5.2.2 | BSD-3-Clause | Line / word diff for revisions. |
| [uuid](https://github.com/uuidjs/uuid) | 9.0.1 | MIT | Stable IDs for documents / messages. |
| [Vite](https://vitejs.dev/) | 5.4.21 | MIT | Dev server / build. |
| [TypeScript](https://www.typescriptlang.org/) | 5.x | Apache-2.0 | Type-checking. |
| [Tailwind CSS](https://tailwindcss.com/) | 3.4.19 | MIT | Utility CSS + the ApEditor design tokens. |
| [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react) | 4.3.x | MIT | Fast Refresh + JSX. |
| [postcss](https://postcss.org/) / [autoprefixer](https://github.com/postcss/autoprefixer) | latest | MIT | Tailwind pipeline. |

### In-browser OCR / PDF pipeline

The **Import photos / PDFs** button runs the following projects entirely
in the browser (no data leaves the device). Models and workers are
served from `public/ocr/`, `public/ort/`, and `public/pdfjs/`.

| Library | Version | License | Used for |
| --- | --- | --- | --- |
| [PaddleOCR (`@paddleocr/paddleocr-js`)](https://github.com/PaddlePaddle/PaddleOCR) | 0.4.2 | Apache-2.0 | Multilingual text recognition (`PP-OCRv6_tiny`). |
| [ONNX Runtime Web](https://github.com/microsoft/onnxruntime) | 1.30.0 | MIT | Runs the PaddleOCR model in-browser. |
| [PDF.js (`pdfjs-dist`)](https://github.com/mozilla/pdf.js) | 4.10.38 | Apache-2.0 | Text-native PDF extraction + page rasterization for OCR. |

### AI providers (configurable)

The chat backend is provider-agnostic — the app speaks the
OpenAI-compatible `/chat/completions` streaming protocol and ships with
presets for:

- [**MiniMax**](https://api.minimax.io/) — default preset
  (`MiniMax-M2.7` model, `https://api.minimax.io/v1` endpoint).
- [**OpenAI**](https://platform.openai.com/) — selectable from the
  Settings → Provider dropdown.

API keys are stored only in this browser's `localStorage` and sent as
`Authorization: Bearer <key>` directly to your chosen endpoint.

### Logo

The ApEditor logo shipped in `public/apeditor-logo.jpg` is original
artwork created for this project. The ApEditor wordmark and design
system in `tailwind.config.cjs` are also original to this repository.

---

*Licensed under the MIT License. See the original project's*
[*LICENSE*](https://github.com/darrylschaefer/ai-text-editor/blob/main/LICENSE)
*for details.*
