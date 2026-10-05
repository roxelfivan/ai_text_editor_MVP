# AI Text Editor — MVP

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
- **Light / dark** theme, persisted.

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
├── index.css             # Tailwind layers + markdown + diff styles.
├── types.ts              # Shared TS types.
├── api/
│   └── chat.ts           # OpenAI-compatible streaming client.
├── store/
│   └── useStore.ts       # zustand store + localStorage persistence.
├── utils/
│   ├── diff.ts           # Line-diff helper for revisions.
│   └── proposedEdit.ts   # Proposed-edit parsing + formatting.
└── components/
    ├── Sidebar.tsx
    ├── Editor.tsx
    ├── ChatPanel.tsx
    ├── PromptLibrary.tsx
    ├── ProposedEditCard.tsx  # Track-changes card for AI diffs.
    ├── RevisionHistory.tsx
    └── SettingsModal.tsx
```

## Hotkeys

| Key               | Action                |
| ----------------- | --------------------- |
| ⌘ / Ctrl + .     | Open Settings         |
| ⌘ / Ctrl + ,     | Open Prompt library   |
| ⌘ / Ctrl + h      | Open Revision history |
| ⌘ / Ctrl + Enter | Send chat message     |

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

This project is a re-produced MVP of
[**ai-text-editor**](https://github.com/darrylschaefer/ai-text-editor) by
[**@darrylschaefer**](https://github.com/darrylschaefer) (MIT licensed).  
The original project is a full-featured AI word processor; this one
extracts only the core markdown editing + AI chat loop as a lightweight
starting point.

---

*Licensed under the MIT License. See the original project's*
[*LICENSE*](https://github.com/darrylschaefer/ai-text-editor/blob/main/LICENSE)
*for details.*
