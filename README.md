# ApEditor — AI Markdown Editor (MVP)

> **Based on [ai-text-editor](https://github.com/darrylschaefer/ai-text-editor) by [@darrylschaefer](https://github.com/darrylschaefer).**
> This repository is a stripped-down, re-produced MVP of the original project, keeping only the core editor + AI chat loop in a minimal number of files. See [Credits](#credits) for details.

A minimal, local-first AI markdown editor. Everything runs in the browser — no backend, no account required.

## Features

- **Documents** — sidebar with create / rename / delete / switch.
- **Markdown editor** — plain `<textarea>` (write mode), live
  `react-markdown` preview, or split view.
- **AI chat** — right-side panel with streaming responses, system prompt,
  model picker, "send selection" toggle, and ⌘/Ctrl+Enter to send.
- **Prompt library** — seed prompts plus your own.
- **Revision history** — snapshot any document, view line diffs against
  the current version, restore old revisions.
- **Photo & PDF import** — drop in images or PDFs and have the text
  recognized entirely in-browser (PaddleOCR + ONNX Runtime, zero
  network calls). Recognized text is inserted at the caret.
- **Two themes** — cyberpunk dark (default) and Muji-style light
  (warm cream, kraft panels, sumi-ink text). The full design system
  (design tokens, theme-aware component classes, logo wordmark) lives
  in `tailwind.config.cjs` and `src/index.css`.

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
│   ├── diff.ts           # Line-diff helper for revisions.
│   ├── ocr.ts            # PaddleOCR pipeline for image import.
│   ├── pdf.ts            # pdfjs-dist wrapper for PDF text / render.
│   └── proposedEdit.ts   # Proposed-edit parsing + formatting.
└── components/
    ├── Sidebar.tsx
    ├── Editor.tsx
    ├── ChatPanel.tsx
    ├── PromptLibrary.tsx
    ├── ProposedEditCard.tsx  # Track-changes card for AI diffs.
    ├── RevisionHistory.tsx
    ├── SettingsModal.tsx
    ├── PhotoImportButton.tsx # Image / PDF import picker.
    ├── EdgeAnchor.tsx        # Side / top edge-anchor toggle.
    └── ResizeHandle.tsx
```

## Track Changes — Reviewing AI Edits

When the AI proposes changes to your document (e.g., rewording a paragraph, fixing a section, or suggesting a deletion), they appear as **Proposed Edit Cards** embedded directly in the editor pane.

### How it works

1. **Trigger a proposal** — Select text in the editor and ask the AI to "rewrite this" or "shorten this" via the chat panel. The AI's proposed replacement comes back as a structured diff.
2. **Inline cards appear** — Each proposal renders as a `ProposedEditCard` showing:
   - The **original text** (red, struck through)
   - The **proposed new text** (green, highlighted)
   - A one-line **explanation** of why the AI made that change
3. **Accept or reject** — Click **Accept** to apply the change to the document, or **Reject** to discard it and keep the original.
4. **Batch review** — Multiple proposals can coexist. Accept or reject them one by one in order, or jump to the next card using the **Navigate** buttons on each card.

### Hands-on example

```
1. Open a document with some markdown content.
2. Highlight a paragraph you want the AI to improve.
3. In the Chat panel, enable "Send selection" (toggle button).
4. Type: "Make this more concise" and press ⌘+Enter.
5. The AI streams back a proposed edit.
6. Switch back to the editor — a blue-outlined card now floats
   at the position of your selection.
7. Read the diff (original → proposed), then click Accept.
   The document updates instantly.
```

### Keyboard shortcut

| Key              | Action                              |
| ---------------- | ----------------------------------- |
| ⌘ / Ctrl + y    | Accept focused proposal             |
| ⌘ / Ctrl + n    | Reject focused proposal / next card |

### Under the hood

- `utils/proposedEdit.ts` — parses the AI's diff payload into structured `ProposedEdit` objects (type defined in `types.ts`).
- `components/ProposedEditCard.tsx` — renders the accept/reject UI with diff highlighting.
- The store (`useStore.ts`) holds the active proposal queue; accepting/rejecting pops items and applies or discards the patch.

## Import photos & PDFs

The editor toolbar has an **Import photos / PDFs** button that recognizes
text from one or more dropped images or PDF files and inserts the result
at your caret. Everything runs locally — no upload, no third-party API.

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
2. Click **Import photos / PDFs** in the editor toolbar.
3. Pick the language(s), then click **Choose Import File(s)**.
4. Select one or more images / PDFs. A small progress chip
   (`reading… 2/5`) appears while the engine works.
5. When the batch finishes, the recognized text is inserted at the
   caret as a single block separated by blank lines. The file input
   resets so you can re-pick the same files without a refresh.

### Under the hood

- `src/utils/ocr.ts` — lazy-init PaddleOCR, dispatch by MIME
  (image vs PDF), strict per-call cleanup.
- `src/utils/pdf.ts` — thin wrapper around `pdfjs-dist` for
  `getTextContent` and `page.render`.
- `src/components/PhotoImportButton.tsx` — image+PDF picker, language
  checkboxes, progress UI; dispatches a `mvp:insert-text` `CustomEvent`
  that `src/components/Editor.tsx` consumes to splice the text in.

## Hotkeys

| Key               | Action                |
| ----------------- | --------------------- |
| ⌘ / Ctrl + .     | Open Settings         |
| ⌘ / Ctrl + ,     | Open Prompt library   |
| ⌘ / Ctrl + h      | Open Revision history |
| ⌘ / Ctrl + Enter | Send chat message     |

## Release notes

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
