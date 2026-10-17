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
[![v0.5.0](https://img.shields.io/badge/version-0.5.0-blueviolet.svg)](https://github.com/roxelfivan/apeditor/releases/tag/v0.5.0)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

**Using the app?** Start with the [user guide](./docs/README.md), or click **?** in the top bar (in-app Help renders the same pages and follows Light / Dark mode).

---

## What's new in v0.5.0

> A UX-focused release on top of v0.4.9: you can now **Export**
> the current document as Markdown (the only durable off-tab
> backup of your writing today), importing a multi-hundred-page
> PDF or a 50+ MB file refuses with a friendly error instead of
> freezing the tab, and clicking **Apply** on a proposed edit
> whose original quote is gone now offers an inline approximate-
> match prompt instead of silently failing. The toolbar button
> that handles both Import and Export was renamed from
> `ImportMediaButton` to `FileActionsButton` and its icon was
> redrawn so it reads as both directions instead of just one.

Highlights:

1. **Export Markdown.** A new **Export .md** button in the
   file-actions popover downloads the current document as a
   Markdown file. Filename is the document title (sanitised);
   defaults to `untitled.md`. `localStorage` can be wiped by the
   browser at any time without warning, so this is the only
   reliable way to keep a copy of your writing off-tab. A
   future slice will add a JSON backup that includes comments,
   chat, and revisions.
2. **Import size and page caps.** Imports now refuse with a
   friendly inline error before doing any work if any file is
   over 50 MB, the batch is over 200 MB total, or a PDF has more
   than 500 pages. The existing OCR pipeline read the entire PDF
   into memory and rasterised every page; the cap protects the
   tab on large scans.
3. **Inline confirmation for best-effort Apply.** When the AI's
   quote can't be matched in the current document (you edited
   the paragraph, the model paraphrased, a sibling edit shifted
   the wording, …), Apply now offers an inline confirmation
   prompt with the matched passage and a confidence percentage
   instead of silently doing nothing. You confirm or cancel
   before any text changes. The Force-apply escape hatch is
   preserved for when there's truly no anchor at all.
4. **File-actions popover alignment.** The Export and Import
   sections inside the popover now share the same visual
   rhythm: section header → two-sentence description → primary
   CTA button (both `btn-fire-sm`) aligned right. Popover is
   reordered so Import sits on top (the button's primary
   identity) and Export sits below the divider. The toolbar
   icon is redrawn as a page with up + down arrows instead of
   the old down-arrow-into-tray glyph, so it doesn't suggest
   one direction over the other.
5. **Renamed `ImportMediaButton` → `FileActionsButton`.** The
   component and file were renamed because the toolbar button
   now exposes both directions, not just Import. Pure name
   correction — no behaviour change. All docs are updated;
   the old name stays grep-fable via
   `(formerly ImportMediaButton)` breadcrumbs.

See [RELEASE_NOTES.md](./RELEASE_NOTES.md) for the full v0.5.0
changelog and the v0.4.9 entry below for prior Format-dropdown
work.

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
- **Revision history** — **Save** a snapshot from the toolbar, or
  let Chat **Send** / **Apply N changes** auto-snapshot
  (`Before AI send` / `Before Apply All`). Open **History** (top-bar
  clock / `⌘/Ctrl + H`) to diff and restore.
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
  fence (with `summary`, `rationale`, `original`, `replacement`),
  you get **Split** (Original / Proposed as Editor Preview–style
  markdown) or **Inline** (line diff), plus **Apply** / **Reject** /
  **Apply N changes**. See [How AI edits work](#how-ai-edits-work).
- **Predict** — inline sentence completion (**off by default**).
  Click **Predict** or press `⌘/Ctrl + \\` to turn it on and
  request a suggestion; `Tab` accepts, `Esc` rejects.
- **Customizable System Message + Rationale Rules** — set the
  assistant voice and the per-edit rationale format in **Settings**
  (each has **Reset** to the built-in default).

### Comment + Send to AI (v0.4.0+)

- **Comment on a passage** — select text → **Comment** in the toolbar
  → write your note. The passage gets a highlight and a numbered
  margin badge.
- **Edit / Delete anytime** — open a badge for **Edit** / **Delete**,
  including after the comment has been sent. `⌘/Ctrl + Z` undoes
  the last comment op. Editing the body after a send starts a
  **new round** (history is preserved).
- **Rationale history** — after you **Apply** a proposed edit, open
  the badge to read the AI's rationale under **Rationale**, with
  one collapsible card per round.
- **Outdated** — when edits move or delete the anchored text and
  re-anchoring fails, the badge flips to **Outdated** so you can
  clean it up.
- **Send to AI** — the tray under the editor batches the document
  and every comment into one chat turn. The reply comes back as
  the same proposed-edit cards, one per comment. See
  [Comment + Send to AI](#comment--send-to-ai) for the full flow.
- **`@`-document references (v0.4.7+ / v0.4.8 headings)** — type
  `@` while writing a comment to attach another document, then
  narrow by heading section (or whole doc). See
  [@-document references](#-document-references-chat--comments) for
  the full flow, including the popover's re-edit mode.

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
git clone https://github.com/roxelfivan/apeditor.git
cd apeditor
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

### System Message

The default is a short writing-assistant prompt (concise, preserve
voice, one `proposed-edit` fence per paragraph, `rationale` per
Rationale Rules). Edit it in **Settings** → **System Message**.
**Reset** restores the built-in default. Changes apply to the next
chat send; existing chat history is unaffected.

### Rationale Rules

Controls how the model fills the `rationale` field on each
`proposed-edit` fence (shown in the comment popover after Apply).
The fence JSON schema is always sent separately and is not
overridden here.

Default rules: a structured rationale format with GitHub-flavored
Markdown, a fixed minimum word count, a numbered point list with
sub-points, and **bold + underlined keywords** rendered as
`**<u>keyword</u>**`. Edit or **Reset** in **Settings** →
**Rationale Rules** to match your own writing style — voice,
length, structure, and emphasis are all yours to define.

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
| `⌘ / Ctrl + /` (or `?`) | Open **Help** (user guide) |
| `⌘ / Ctrl + B` | Toggle sidebar (deferred when inside the editor) |
| `⌘ / Ctrl + Shift + C` | Toggle chat panel |
| `⌘ / Ctrl + B / I / U` (in editor) | Bold / Italic / Underline |
| `⌘ / Ctrl + Z` (in editor, after a comment op) | Undo last comment op |
| `⌘ / Ctrl + \\` | Toggle **Predict** on and request a suggestion |
| `Tab` / `Esc` (when Predict is on) | Accept / reject inline completion |
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
  "rationale": "1. … **<u>keyword</u>** …\\n2. …\\n3.1 …",
  "original": "<verbatim substring of the current document>",
  "replacement": "<the new text>"
}
```
````

**Rules the model follows (see `src/api/chat.ts`):**

- `original` is a byte-for-byte copy of a substring in the document.
  No paraphrasing. If no exact match exists, that change is skipped.
- `rationale` is required Markdown following the format defined in
  **Settings → Rationale Rules** (default: a structured numbered
  list with sub-points, a minimum word count, and keywords rendered
  as `**<u>…</u>**` — see above). Edit the default to match your
  own writing style. Rendered as markdown in the comment popover
  after Apply.
- Multiple fences in one reply are allowed; one per change.
- `original` should be as short as possible while still uniquely
  locating the text.
- Prose outside the fences is rendered as normal markdown.

### Per-card actions

- **Split / Inline** — **Split** shows Original and Proposed as
  Preview-style markdown; **Inline** keeps a unified line diff.
- **Apply** — write the change into the document at the anchored
  position, re-anchor the related comment highlight (and selection)
  to the **replacement** text, and record the rationale on the
  comment's current round. Fails if `original` no longer matches;
  the card flips to **Missing** and offers **Force-apply…** at the
  current caret.
- **Reject** — discard the change.
- **Reject with feedback** — stage a reason for a follow-up chat
  turn; on **Send** the staged reasons are folded into a single
  prompt so the model can address them all together.
- **Apply N changes** (chat footer) — auto-snapshots the document
  (`Before Apply All`), then bulk-applies every anchored edit in
  that reply. Un-anchorable edits are skipped silently with a
  footer line like `Applied 4 of 5 changes (1 skipped — not
  anchored)`.

Chat **Send** also auto-saves a `Before AI send` revision before
the turn starts.

### Example

1. Open a document and highlight a paragraph you want to improve.
2. In the chat panel, check **include selection**.
3. Type: `Make this more concise.` and press `⌘/Ctrl + Enter`.
4. The AI streams back a `proposed-edit` card.
5. Read Original / Proposed in **Split**, then click **Apply**. The
   document updates; open the related comment badge to read the
   markdown rationale.

---

## Comment + Send to AI

Headline flow from v0.4.0, prompt efficiency from v0.4.1, and
**rounds + rationales** from v0.4.5.

### The user-facing flow

1. **Select a passage** in **Write** (or the Write side of **Split**).
2. Click **Comment** in the editor toolbar and write your note.
3. The passage is highlighted; a numbered badge appears in the margin.
4. Open a badge to **Edit** or **Delete**. **Outdated** means the
   anchored text could not be re-found after edits — fix it from the
   popover.
5. Click **Send to AI** under the editor when you want the model to
   address every comment in one chat turn.
6. **Apply** a proposed-edit card. Open the badge again: **Rationale**
   shows Round 1 with the AI explanation and a short diff preview.
7. For a follow-up, **Edit** the comment body (this starts Round 2),
   **Send to AI** again, and Apply. Expand each round with `+` / `−`.

### How the prompt is built (v0.4.5)

The **Send to AI** tray dispatches the comment batch as the user's
chat message. `buildRequestMessages` in `src/api/chat.ts` then pushes
system messages around the user's turn:

1. **`sys`** — the user's customizable System Message.
2. **`sys-current-doc`** — a structural outline of the document
   (`[pN]@offset: <first 60 chars>` per paragraph). The verbatim
   document is **not** inlined on comment-batch turns.
3. **`sys-proposed-edit-rules`** — fence schema (always) + Rationale
   Rules (default or your Settings override).
4. The **user message** — one block per comment, in document order:
   ```
   [c1] (paragraph 7/32, doc offset 1840–1920)
   "<verbatim snippet>"
   Before: "<120 chars before>"
   After: "<120 chars after>"
   Comment: <user's comment body>
   ```
5. **`*-comments-batch`** — address every `[id]`, keep whole-document
   consistency, emit extra fences when a fix implies another change,
   and do not quote Before/After back.

The reply comes back as proposed-edit cards — one per comment, plus
any extra fences for coherence. Applied rationales are stored on the
comment's current round in `localStorage` with the rest of the app
state.

### Token savings

v0.4.1 cut long-document comment-batch prompts by ~70% vs v0.4.0
(outline instead of full doc + per-comment context). v0.4.5 further
shortens the fixed instruction blocks (~50% fewer characters) while
keeping the same contracts. See [RELEASE_NOTES.md](./RELEASE_NOTES.md).

---

## @-document references (chat + comments)

Type `@` in any of these surfaces to attach another document (or a
specific paragraph of one) to the outgoing turn:

- the **chat input** (right-hand panel)
- a **new comment** (select text → toolbar **Comment**)
- a **comment popover** in edit mode (open a comment badge → **Edit**)
- a **Proposed Edit card's Comment (optional)** (rejection feedback)

### How it works

1. The picker auto-opens when you type `@` and stays open as you
   filter by title.
2. After picking a doc, a second picker lists **heading sections**
   when the Markdown has ATX / Setext headings (v0.4.8). Tick one
   or more sections to scope the reference; ticking a parent
   cascades to its descendants. Documents without headings fall
   back to the paragraph list. Or choose **Whole document** for
   the default token-cheap outline.
3. A compound chip appears above the input (title + `§…` summary),
   and the same `§…` caption is inserted in the textarea at the
   caret (v0.4.8). Click the chip's section line or the inline
   caption to re-open the picker; `×` removes the reference.
   **Cancel** on the section picker aborts without attaching.
4. On **Send** (chat) / **Send to AI** (comments) / **Send N
   rejection comments** (proposed edits), each reference is folded
   into the prompt as a separate system message that names the doc
   and inlines either the compact outline (default) or the verbatim
   text of **only the picked paragraphs** (section-scoped, capped
   at 4,000 chars per doc / 8,000 turn-wide — not the full document).
5. References are persisted with each comment round, so reloading
   the app keeps them. A reference whose source doc was deleted
   shows as `(deleted)` in the chip and is dropped from the prompt.
6. **In a comment popover's read view**, the reference renders as
   an inline clickable pill — clicking it switches the editor to
   the referenced document so you can read the source in context.

### Keyboard

- `↑` / `↓` — move through the picker
- `Enter` / `Tab` — confirm the highlighted row / Confirm
- `Space` (section picker) — toggle the current section (cascade)
- `Esc` — Cancel / close the picker (does not consume the `@`)

### Where it lives

- `src/components/mentions/MentionInput.tsx` — shared @-aware
  input: plain caption + ZWSP in the textarea, chips above,
  serialize/hydrate against sentinels for the LLM.
- `src/components/mentions/DocPicker.tsx` — first-stage doc list.
- `src/components/mentions/SectionPicker.tsx` — heading-grouped
  (or paragraph) multi-select with cascade + Cancel.
- `src/hooks/useDocumentMentions.ts` — heading section detection
  and descendant cascade indexes.
- `src/api/chat.ts` `buildRequestMessages` — appends
  `sys-referenced-doc-N` messages per reference.

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
- `src/components/FileActionsButton.tsx` (formerly `ImportMediaButton.tsx`) — image+PDF picker, language checkboxes, progress UI, plus a one-click Markdown export; after OCR, dispatches an
  `mvp:insert-text` `CustomEvent` that `Editor.tsx` consumes to
  splice the Markdown in.

---

## User guide

A longer, task-oriented walkthrough of every screen lives under
[`docs/`](docs/). In the running app, click **?** in the top bar (or
`⌘/Ctrl + /`) to open the same pages as a themed Help site — Light /
Dark matches the editor. Start at the [table of contents](docs/README.md):

- [Getting started](docs/getting-started.md) — first launch, connect AI, first document
- [Your workspace](docs/workspace.md) — layout, theme, panels, Help
- [Documents](docs/documents.md) — create, rename, switch, delete
- [Writing](docs/writing.md) — editor, formatting, Predict
- [Comments](docs/comments.md) — highlights, badges, Send to AI
- [Chat](docs/chat.md) — messages, selection, Google AI Mode
- [Proposed edits](docs/proposed-edits.md) — Apply, Reject, Force-apply
- [Reference other documents (`@`)](docs/reference-other-documents.md) — attach a doc or heading sections *(v0.4.7 / v0.4.8)*
- [Prompt library](docs/prompt-library.md) — saved prompts
- [Revision history](docs/revisions.md) — snapshots and restore
- [Import from photos or PDFs](docs/import.md)
- [Settings](docs/settings.md)
- [Keyboard shortcuts](docs/keyboard-shortcuts.md)
- [Privacy and your data](docs/privacy.md)
- [Troubleshooting](docs/troubleshooting.md)

---

## Architecture

```
src/
├── App.tsx                  # Layout, hotkeys, modal orchestration.
├── main.tsx                 # React entry, theme bootstrap.
├── index.css                # Tailwind layers + markdown + diff + theme.
├── types.ts                 # Shared TS types.
├── api/
│   └── chat.ts              # Streaming client + request builder,
│                            # doc outline, proposed-edit schema +
│                            # rationale rules, comment-batch notes.
├── config/
│   └── providers.tsx        # MiniMax / OpenAI / Google AI Mode presets.
├── docs/
│   └── catalog.ts           # Loads `docs/*.md` for in-app Help (synced).
├── store/
│   └── useStore.ts          # zustand store + localStorage persistence
│                            # (documents, chats, comments/rounds, API).
├── hooks/
│   ├── useDragResize.ts     # Resizable chat / sidebar / Settings /
│   │                        # popover / prompt textareas.
│   └── useInlineCompletion.ts
├── utils/
│   ├── comments.ts          # Re-anchor, batch format, selection rect.
│   ├── diff.ts              # Line-diff helper for revisions / rationales.
│   ├── googleAiMode.ts      # Google AI Mode deep-link builder.
│   ├── ocr.ts               # PaddleOCR pipeline for image import.
│   ├── pdf.ts               # pdfjs-dist wrapper.
│   ├── proposedEdit.ts      # Parse / apply proposed-edit fences.
│   └── ocrMarkdown.ts       # Chat-model Markdown reformatting of OCR output.
└── components/
    ├── Sidebar.tsx
    ├── Editor.tsx           # Textarea + mirror + comment layer + toolbar
    │                        # (Predict defaults off).
    ├── ChatPanel.tsx        # Streaming chat + proposed-edit cards +
    │                        # comment-batch send / Apply All.
    ├── CommentLayer.tsx     # Mirror overlay (highlights under textarea).
    ├── CommentMargin.tsx    # Numbered badges (+ rationale indicator).
    ├── CommentComposer.tsx  # Floating composer after **Comment**.
    ├── CommentPopover.tsx   # Edit / Delete + multi-round Rationale UI.
    ├── CommentTray.tsx      # **Send to AI** tray under the editor.
    ├── HelpDocs.tsx         # Themed Help overlay (renders docs/*.md).
    ├── PromptLibrary.tsx
    ├── ProposedEditCard.tsx # Apply / Reject cards for AI diffs.
    ├── RevisionHistory.tsx
    ├── SettingsModal.tsx    # Provider, System Message, Rationale Rules.
    ├── ImportMediaButton.tsx  → FileActionsButton.tsx (v0.5.0+)
    ├── EdgeAnchor.tsx       # Side / top edge-anchor toggles.
    ├── ResizeHandle.tsx     # Drag-to-resize between sidebar/editor/chat.
    └── Topbar.tsx           # (inlined in App.tsx — see App.tsx)
```

State lives in a single zustand store (`src/store/useStore.ts`),
persisted to `localStorage` under the `apeditor` key
(including comment `rounds` and applied rationales). Messages between
components use `window` `CustomEvent`s (`mvp:editor-selection`,
`mvp:fill-chat`, `mvp:send-comments`, `mvp:chat-streaming`,
`mvp:mark-comments-sent`, `mvp:insert-text`, `mvp:select-range`,
`mvp:open-help`)
to keep the editor / chat / comment layer loosely coupled.

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
| [v0.5.0](https://github.com/roxelfivan/apeditor/releases/tag/v0.5.0) | **Export Markdown** from the file-actions popover, import size and page caps with friendly errors, inline confirmation prompt for best-effort Apply when the AI quote is gone. **Popover alignment pass** + component rename `ImportMediaButton` → `FileActionsButton`. |
| [v0.4.9](https://github.com/roxelfivan/apeditor/releases/tag/v0.4.9) | Unified **Format** dropdown (B/I/U + font size), draggable Chat panel messages/input split, draggable Original / Proposed columns in every **ProposedEditCard**. |
| [v0.4.8](https://github.com/roxelfivan/apeditor/releases/tag/v0.4.8) | Heading-grouped `@` section picker, parent→child cascade, Cancel, inline `§…` captions in the textarea. Section sends stay scoped to picked paragraphs only. |
| [v0.4.7](https://github.com/roxelfivan/apeditor/releases/tag/v0.4.7) | `@`-document references in chat, comments (new + re-edit), and rejection feedback. Whole-doc or section-scoped. Persisted on comment rounds. Dark-mode contrast for the rejection textarea. |
| [v0.4.6](https://github.com/roxelfivan/apeditor/releases/tag/v0.4.6) | Auto-snapshot on Send / Apply All, structured Rationale Rules with bold+underlined keywords, ProposedEditCard Split as Preview-style markdown, draggable Write / Preview divider, Revision history Preview pane, live-default Settings sync. |
| [v0.4.5](https://github.com/roxelfivan/apeditor/releases/tag/v0.4.5) | Comment **rounds** + **rationales**, Settings Rationale Rules, Apply re-anchors to replacement, leaner prompts, **Predict** off by default. |
| [v0.4.1](https://github.com/roxelfivan/apeditor/releases/tag/v0.4.1) | **Send to AI** whole-document consistency; per-comment context; doc outline instead of verbatim document. |
| [v0.4.0](https://github.com/roxelfivan/apeditor/releases/tag/v0.4.0) | **Comment** + **Send to AI**, **Google AI Mode (no key)**, title-case **Predict**, Welcome quick start. |
| [v0.3.4](https://github.com/roxelfivan/apeditor/releases/tag/v0.3.4) | Import → Markdown, OCR works under CSP, security hardening, topbar icons. |
| [v0.3.3](https://github.com/roxelfivan/apeditor/releases/tag/v0.3.3) | **Apply All** for proposed edits, B/I/U toolbar, Debug Mode, global UI font size. |
| [v0.3.2](https://github.com/roxelfivan/apeditor/releases/tag/v0.3.2) | Debug mode, mobile-friendly editor, manual Predict. |
| [v0.3.1](https://github.com/roxelfivan/apeditor/releases/tag/v0.3.1) | Inline sentence completion, roomier toolbar. |
| [v0.3.0](https://github.com/roxelfivan/apeditor/releases/tag/v0.3.0) | ApEditor design system, transparent wordmark, redesigned toolbar. |
| [v0.2.x](https://github.com/roxelfivan/apeditor/releases?q=v0.2) | Earlier UI overhauls, bug fixes. |

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
