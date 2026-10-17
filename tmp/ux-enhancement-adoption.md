# ApEditor UX roadmap — adoption plan (post-v0.5.1)

> Adoption plan for the remaining unadopted work in [`tmp/ux-enhancement-phases.md`](ux-enhancement-phases.md), refreshed against the live `main` branch on 2026-10-17. Phases 1.1 (doc drift / dead hook) and 1.3 (⌘Z toast) shipped in v0.5.0; Phase 1 polish + the gated-state tooltips + Phase 2 (selection-only send, secret redaction, outdated comments, session-only API key) shipped in v0.5.1 via PRs [#17](https://github.com/roxelfivan/apeditor/pull/17) and [#18](https://github.com/roxelfivan/apeditor/pull/18). This plan covers what is *still* open.

---

## What shipped (do NOT redo)

### Phase 1 polish — v0.5.1 — PR [#17](https://github.com/roxelfivan/apeditor/pull/17)

- Doc drift cleanup (`docs/workspace.md` ↔ `docs/writing.md` font-size copy).
- The `MentionInput` no-op `useLayoutEffect` became a real chip-row measurement that nudges the textarea when chips wrap.
- Empty / gated-state tooltip copy added to several surfaces.

### Phase 2 friction reducers — v0.5.1 — PR [#18](https://github.com/roxelfivan/apeditor/pull/18)

- Chat "send selection only" + clearer delimiters.
- Soft secret redaction before send (`src/utils/secrets.ts`).
- Outdated-comment cleanup polish (`src/utils/comments.ts` + `CommentPopover` "no longer anchored" copy).
- **Session-only API key** toggle in Settings — the key now lives in `sessionStorage` (not persisted in the zustand blob).

### Markdown export — v0.5.0

- Already ships the `${title}.md` download inside `FileActionsButton`.

---

## What's still open

| ID | Item | Phase | Why it's still open | First source |
|---|---|---|---|---|
| A | JSON backup export (comments + chat + revisions) | P2.5 | Markdown ships today; the JSON side of the same export was deferred. `downloadTextFile` helpers are now in `src/utils/storage.ts` so the primitive is ready. | `src/components/FileActionsButton.tsx`, `src/utils/storage.ts` |
| B | Batch-dismiss / re-select outdated comments | P2.4 | v0.5.1 added the "no longer anchored" badge and helpful copy, but the `CommentTray` footer "X comments no longer anchored — Dismiss / Re-link" affordance isn't wired yet. | `src/components/CommentTray.tsx`, `src/utils/comments.ts` |
| C | Clearer empty / gated states (broader pass) | P1.2 | PR #17 added tooltips; full empty-state coverage (empty `@` picker with < 2 docs, OCR keyless-but-rewrite-needs-key copy in plain prose) is still partial. | `src/components/mentions/{DocPicker,SectionPicker}.tsx`, `src/components/FileActionsButton.tsx`, `src/components/SettingsModal.tsx` |
| D | Mentions: single 2-pane picker (Option B) | P3.1 | `MentionInput.tsx` still mounts `DocPicker` then `SectionPicker` separately — see `src/components/mentions/MentionInput.tsx` and `docs/REFACTORING.md` §4 Option B. | `src/components/mentions/MentionInput.tsx`, `docs/REFACTORING.md` |
| E | In-Help keyboard / shortcut map + conflict hints (⌘B) | P3.3 | `docs/keyboard-shortcuts.md` is comprehensive; `src/components/HelpDocs.tsx` does not yet expose it as a tab. | `src/components/HelpDocs.tsx`, `docs/keyboard-shortcuts.md` |
| F | Accessibility pass (resize handles, overlays, comment-layer SR labels) | P3.4 | Many `role` / `aria-*` values already exist on diff cards and `ResizeHandle`; comment layer + popovers still need an audit. | `src/components/CommentLayer.tsx`, `src/components/CommentPopover.tsx`, `src/components/ResizeHandle.tsx` |
| G | Google AI Mode paste UX (larger clipboard target + truncated-URL warning) | P3.5 | `src/utils/googleAiMode.ts` builds the URL but the paste UX in `src/components/ChatPanel.tsx` (paste-answer textarea) is unchanged. | `src/components/ChatPanel.tsx`, `src/utils/googleAiMode.ts` |
| H | Phase 4 — Mobile-first layout | P4 | No dedicated mobile layout; narrow-viewport overlay work in v0.4.9 was survival mode. | `src/App.tsx`, `src/components/CommentPopover.tsx` |
| I | Phase 5 — Major product upgrades | P5 | Not started. Lexical, embeddings, sync, agents, i18n, hardened key storage — one ticket each. | `README.md` (intentionally-not list), `SECURITY.md` |

---

## Slice ordering (least-risk first)

Each slice is designed to ship behind a single v0.5.x release and run the two verification gates from the v0.5.0 release notes (`npx tsc --noEmit -p tsconfig.app.json` and `npm run build`).

### Slice B — Backup completeness (≈ 1 day, low risk)

**Items A + C.**

- **JSON backup export** (Item A): new `src/utils/backup.ts` module + a third section inside `FileActionsButton`'s popover (sibling to the existing Export `.md`). Uses the existing `downloadTextFile` helpers. Shape is `DocumentBackup = { schema, version, exportedAt, document, comments, chats, revisions }` — versioned so a future importer can detect/upgrade.
- **Clearer empty / gated states** (Item C): three discrete copy additions — (1) `@` picker shows an actionable hint when the workspace has fewer than two docs; (2) `FileActionsButton` surfaces "Markdown rewrite needs an API key; import without one is allowed" as a paragraph under the language picker; (3) `ChatPanel` rewrite of its placeholder when the provider is `google-ai-mode` to spell out the two-step paste flow.

Ship as **v0.5.2**.

### Slice C — Comment lifecycle completeness (≈ 2 days, medium risk)

**Item B.**

- Bottom-of-tray `CommentTray` footer listing comments whose latest round's anchor is unfindable, with two actions: **Dismiss** (creates a `delete` undo-stack entry) and **Re-link** (opens a thin picker with the document's current headings and paragraphs, similar to the new section picker).
- New "stale" helper in `src/utils/comments.ts` that reuses `findEditAnchor` against the round's `snippet` (already used by the existing re-anchor pass).

Ship as **v0.5.3**.

### Slice D — Interaction redesign (≈ 3 days, medium risk)

**Items D + G.**

- **Single 2-pane mentions picker** (Item D): restructure `MentionInput.tsx` so `DocPicker` is the always-visible left rail and `SectionPicker` becomes the right pane. Mirrors `docs/REFACTORING.md` §4 Option B. Drops the `kind: 'doc' | 'section'` state machine in the parent.
- **Google AI Mode paste UX** (Item G): add a one-click "Paste from Google AI Mode" button (`navigator.clipboard.readText()`) with an inline warning when the pasted text is empty, when the URL the prompt came from is truncated (Google's "…" marker), and when the text length is suspiciously tiny for the source prompt.

Ship as **v0.6.0** because D is a UX redesign.

### Slice E — Help discoverability + accessibility (≈ 2 days, low risk)

**Items E + F.**

- **In-Help keyboard / shortcut map** (Item E): new `KeyboardShortcutsTab` component rendered from a single shared `KEYBOARD_SHORTCUTS` table also consumed by `docs/keyboard-shortcuts.md` (lift to `src/docs/keyboardShortcuts.ts`). Inline paragraph under the row that mentions ⌘B's dual role (sidebar toggle when editor is unfocused, bold when focused) — eliminates the doc-drift class of bug.
- **Accessibility pass** (Item F): audit `CommentLayer`, `CommentPopover`, `CommentTray`, `ResizeHandle`. Add `role="button"` + `aria-label` on margin badges (today they may inherit div semantics), `role="dialog"` + focus trap on the popover, and screen-reader-only summaries on the diff card's Proposed/Original columns. No behaviour changes.

Ship as **v0.6.1**.

### Slice F — Phase 4 mobile (≥ 1 week)

**Item H.**

- Mobile-first layout (editor-first; chat / comments / settings as bottom sheets). Touch-friendly composer. Settings / import popovers sized for thumbs (build on existing clamps).
- Standalone release line — recommend **v0.7.0**.

### Slice G — Phase 5 (each its own proposal)

**Item I.**

- One ticket per feature, in the order upstream copy lists them in `README.md`: **Lexical** (unblocks inline formatting + real undo), then **hardened key storage** (passphrase Web Crypto or local proxy), then **embeddings / semantic search**, then **sync (Drive / GitHub / Electron)**, then **agents with tools**, then **i18n**, then **token counting / cost tracking UI**.

Each ships as its own `v0.8.x` (or beyond). Each requires its own design review against `docs/ARCHITECTURE.md` and `docs/REFACTORING.md`.

---

## Cross-cutting rules

- **No protocol / prompt / LLM-facing contract changes** in Slices B–E. Phase 5 obviously breaks this; new features get a fresh prompt template + schema bump.
- **No new runtime dependencies** in Slices B–E. Phase 5 (Lexical, embeddings, sync) may — each gets an explicit dependency-review at proposal time.
- **Verification gate** every slice: `npx tsc --noEmit -p tsconfig.app.json` clean, `npm run build` clean, manual checklist mirrored from the v0.5.0 release notes.
- **Undo coverage** every slice that introduces user-facing state changes: each new action pushes a `CommentOp` onto `commentUndoStack` (or its own dedicated undo stack).

---

## Suggested first implementation slice

If the question is "what do I ship next?", the answer is **Slice B** — JSON backup + empty-state copy. Both are additive UI, both consume helpers already in `src/utils/storage.ts`, neither touches prompts or models. Estimate ~1 day including release notes.
