## v0.2.1 — bug fix

Patch release on top of [v0.2](https://github.com/roxelfivan/ai_text_editor_MVP/releases/tag/v0.2).
Fixes the regression where a failed anchor match in `ProposedEditCard` left the user with no recoverable action.

### Fixed

- **Anchor mismatch no longer dead-ends.** When the AI's quoted "find this" text
  doesn't match the current document, the card now keeps the diff visible
  (original vs. replacement, side by side) and shows a yellow _Potential mismatch detected_ banner instead of a static error.
- **New _Force apply_ action** lets the user apply the proposed edit at their current caret or selection when the AI's anchor is missing. Disabled until
  the editor is focused; auto-disabled if the user switches documents  mid-card.

### Changed

- `utils/proposedEdit.ts` — new `applyEditAtCaret(content, replacement, { selectionStart, selectionEnd })`
  helper that replaces the selection if present, inserts at caret otherwise,
  and returns `{ ok: false, reason: 'caret-missing' }` for out-of-range carets.
- `store/useStore.ts` — new non-persisted `editorFocus` slice (`EditorFocusState` +
  `setEditorFocus(docId, info)` action) keyed by document id.
- `components/Editor.tsx` — reports `{ focused, selectionStart, selectionEnd }`
  via `onFocus` / `onBlur` / `onSelect` / `onKeyUp` / `onClick`; clears focus  on the previous document when switching. Fixes `HTMLTextAreaElement` casing.
- `components/ProposedEditCard.tsx` — always renders the diff; adds force-apply; drops the prose error.

### Behaviour matrix

| Scenario | Apply | Force apply |
| --- | --- | --- |
| AI quote found (exact / whitespace / Setext / ATX / escapes) | replaces first match | — (not needed) |
| AI quote not found | disabled | disabled until editor focused, then replaces/inserts at caret |
| User switches documents mid-card | disabled | disabled (auto) |

### Verification

- `npm run typecheck` — clean
- `npm run build` — 333 modules, no warnings
- ReadLints — no linter errors