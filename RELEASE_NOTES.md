## v0.4.6 — Auto-snapshot, credit-risk rationales, preview-style diffs, draggable split

Feature + UX release on top of [v0.4.5](https://github.com/roxelfivan/ai_text_editor_MVP/releases/tag/v0.4.5). Chat actions now snapshot the document before mutating it; the default Rationale Rules are rewritten as a credit-risk cover memo; the proposed-edit card's Split view and the Revision history right pane render reader-friendly markdown; the Write / Preview divider in the editor's Split mode is now draggable; and the Settings textareas stay in sync with the live built-in defaults.

### Added

- **Auto-snapshot on Chat actions.** The chat panel saves a revision before any AI send or bulk apply:
  - Chat **Send** → `Before AI send` snapshot.
  - **Apply N changes** → `Before Apply All` snapshot.
  Both reuse the existing `saveRevision` path (the same one **Snapshot now** in Revision history uses), so the prior state is restorable from the Revision history modal.
- **Credit-risk cover-memo Rationale Rules.** The default `PROPOSED_EDIT_RULES_DEFAULT` is rewritten as a credit-risk cover memo proposing amendments to bank **policy / procedure / guideline** documents. Point 3 expands into three sub-points (`3.1`–`3.3`):
  - `3.1` — Risk the Bank faced before the change.
  - `3.2` — Risk the amendment mitigates, and how the new wording reduces that exposure.
  - `3.3` — Why the document is stronger from a risk-management perspective after the change.
  Numbering is `1`, `2`, `3.1`, `3.2`, `3.3`, `4`, `5`; ≥100 words; `3.1`–`3.3` each ≥30 words.
- **Bold + underlined keywords.** The default rules now require keywords to be both bold and underlined (e.g. `**<u>credit risk</u>`**), so the rendered rationale has visible emphasis where it matters. `<u>` is already allowed through the shared sanitize schema in `src/utils/markdown.ts`.
- **ProposedEditCard Split = Editor Preview.** The card's Split view now renders Original and Proposed as Preview-style markdown columns (full-document markdown, not line-synced monospace), sharing the same `ReactMarkdown` + `prose-md` stack as the editor's Preview tab. **Inline** still shows the existing unified line diff for byte-level comparison.
- **Draggable Write / Preview divider.** The editor's Split view now has a draggable vertical divider; the write-pane share is stored as `layout.editorSplitPct` (clamped to 20–80%, persisted alongside `sidebarWidth` / `chatWidth`).
- **Revision history Preview.** The right pane of the Revision history modal defaults to a Preview-style markdown rendering of the selected snapshot, with a **Diff** toggle for the existing line diff.

### Changed

- **Settings always shows the live default.** The System Message and Rationale Rules textareas now mirror the current built-in (when no override is in effect), and Saving with the textarea matching the default stores `undefined` so future updates propagate. A rehydration migration clears any stale frozen copy of older built-ins (pre-`3.1` rationales and the original writing-assistant System Message) so the live built-in is used and the textarea always shows it.

### Internal

- `src/store/useStore.ts` — `layout.editorSplitPct` (with bounds + migration); rehydration rewritten to apply the migration via `useStore.setState` (instead of mutating the loaded snapshot) so React subscribers see the cleared value; `api.systemMessage` is now optional (undefined falls through to the built-in).
- `src/api/chat.ts` — `PROPOSED_EDIT_RULES_DEFAULT` rewritten; new `isStaleRationaleRulesOverride` / `isCurrentRationaleRulesDefault` / `normalizeRationaleRulesOverride` / `isCurrentDefaultSystemMessage` / `isStaleDefaultSystemMessage` / `normalizeSystemMessage` helpers. `DEFAULT_SYSTEM_MESSAGE` now lives in `src/api/chat.ts` (single source of truth). `buildRequestMessages` and `buildGoogleAiModeUrl` fall back to the built-in when their `systemMessage` argument is undefined / empty.
- `src/hooks/useDragResize.ts` — new `MIN_EDITOR_SPLIT_PCT` / `MAX_EDITOR_SPLIT_PCT` / `DEFAULT_EDITOR_SPLIT_PCT` constants.
- `src/components/Editor.tsx` — `useDragResize` for the Split divider; `flex: 0 0 editorSplitPct%` on the write pane; new `ResizeHandle` between the two panes (Split mode only).
- `src/components/ChatPanel.tsx` — `saveRevision` calls before `handleSend` and `applyAllForMessage`.
- `src/components/RevisionHistory.tsx` — Preview / Diff toggle; default to Preview; renders the selected snapshot with `ReactMarkdown` + `prose-md`.
- `src/components/ProposedEditCard.tsx` — Split view now uses `MarkdownSplitPreview` (Preview-style columns); Inline stays the line diff.
- `src/components/CommentPopover.tsx` — rationale body rendered with `ReactMarkdown` + `prose-md`.
- `src/index.css` — compact `prose-md` styles inside the rationale popover, the proposed-edit card's Split columns, and the revision history right pane.

### Verification

- `npm run typecheck` — clean.
- `npm run build` — clean (chunks under the new 12 MB warning limit; the lazy OCR / pdfjs / OpenCV chunks are no longer in the entry path).
