## v0.5.0 — Export Markdown, import size caps, best-effort Apply, file-actions alignment

Feature release on top of [v0.4.9](https://github.com/roxelfivan/apeditor/releases/tag/v0.4.9). Three user-visible wins from the UX roadmap ([ux-enhancement-plan-fba2](https://github.com/roxelfivan/apeditor/blob/cursor/ux-enhancement-plan-fba2/tmp/ux-enhancement-phases.md)) — Export Markdown, import size / page caps with friendly errors, and a one-click best-effort Apply for mismatched AI quotes — plus a follow-up alignment pass on the new Import / Export popover and a rename of the toolbar component from `ImportMediaButton` to `FileActionsButton`. One new doc (`docs/UX_SLICE_1.md`) captures the slice design rationale.

### Added

- **Export Markdown.** A new **Export .md** button at the top of the Import popover (in the editor toolbar) downloads the current document as a Markdown file. Filename is the document title, sanitised; defaults to `untitled.md`. This is the only durable off-tab backup of your writing today — `localStorage` can be wiped by browser data clearing, private-mode expiry, or quota eviction, with no warning. The download helper (`downloadTextFile` + `sanitizeFilename` in `src/utils/storage.ts`) is the foundation for a future JSON backup that includes comments, chat history, and revisions.
- **Inline confirmation prompt for best-effort Apply.** When the AI's `original` quote can't be matched in the current document by any of the six existing strategies (exact / trimmed / whitespace-collapsed / Setext heading / ATX-prefix / markdown-escape), Apply no longer silently fails. A new `findBestEffortAnchor` utility in `src/utils/proposedEdit.ts` runs a token-overlap match with an adaptive lookahead, a skip budget, and a 100 KB content cap. If it finds a candidate, the card shows an inline alert with the matched passage and a confidence percentage; the user confirms or cancels before any text changes. The Apply button stays enabled whenever EITHER a strict OR a best-effort match is available, with the tooltip reflecting which path will run.

### Changed

- **Import size and page caps.** Imports now refuse with a friendly inline error before doing any heavy work if any file is over 50 MB, the batch is over 200 MB total, or a PDF has more than 500 pages. Previously the OCR pipeline read the entire PDF into memory and rasterised every page, which could freeze or evict the tab on a multi-hundred-page scan.
- **File-actions popover alignment.** The Export and Import sections inside the popover now share the same structural template (section header → two-sentence description → primary-CTA action button row aligned right). The Export button was upgraded from `btn-ghost-sm` (tertiary, muted) to `btn-fire-sm` (primary CTA) so both sections have visually identical primary actions. Popover reorder: Import first (the toolbar button's primary semantic identity), Export second.
- **Toolbar icon reframed.** The down-arrow-into-tray glyph (which read as "Import only") is replaced by a page-with-arrows glyph: a small page outline flanked by an up arrow (Export) on the left and a down arrow (Import) on the right. Direction-neutral — reads as "this button handles files in and out for a document." The toggle's `aria-label` and `title` were updated in lockstep.

### Renamed

- **`ImportMediaButton` → `FileActionsButton`** (component + file). The old name stopped being accurate when the popover gained a second action; the rename is purely a name correction, no behaviour change. `git mv` preserves blame history (78 % similarity). All doc references in `README.md`, `RELEASE_NOTES.md`, `docs/ARCHITECTURE.md`, `docs/REFACTORING.md`, `docs/UX_SLICE_1.md` are updated to the new name with `(formerly ImportMediaButton)` breadcrumbs so the old name stays grep-fable.

### Behaviour that did NOT change

- The six existing `findEditAnchor` strategies (preserved verbatim).
- The Force-apply path — still the right escape hatch when no anchor of any kind is available.
- Apply All in `ChatPanel` — still reports `"Applied x of y changes (z skipped — not anchored)"` for batches. Per-skipped "Apply individually" link is queued for the next slice.
- The **Potential mismatch detected** warning UI on `ProposedEditCard` — kept; only the inline message copy is now conditional on whether a best-effort is available.
- All prompt, store, and LLM-facing contracts.
- All other toolbar buttons.

### Internal

- `src/utils/storage.ts` — added `downloadTextFile` + `sanitizeFilename`.
- `src/utils/ocr.ts` — added `validateOcrBatch`, `formatOcrSize`, and three limit constants; pre-flight checks in `extractTextFromFiles` and `extractFromPdfFile`.
- `src/utils/proposedEdit.ts` — added `findBestEffortAnchor` + `BestEffortAnchor` type.
- `src/components/FileActionsButton.tsx` (formerly `src/components/ImportMediaButton.tsx`) — added `useCurrentDocument()`, `onExportClick`, an Export section in the popover, and the alignment pass (both sections now use `btn-fire-sm` for their primary CTA; both descriptions follow the same two-sentence template; the toolbar SVG was redrawn as a page-with-arrows glyph). The component was renamed because the toolbar button now exposes both Import and Export actions, not just Import; `aria-label`, `title`, and the `data-file-actions-toggle` selector were updated in lockstep.
- `src/components/ProposedEditCard.tsx` — added `bestEffortAnchor` memo, `pendingBestEffort` state + stale-span effect, `performReplace` helper, confirmation handlers, and the inline prompt JSX. `handleApply` routes between strict and best-effort paths.
- `docs/UX_SLICE_1.md` — new document capturing the full slice design.

### Verification

- `npx tsc --noEmit -p tsconfig.app.json` — clean.
- `npm run build` — clean.
- `findBestEffortAnchor` smoke tests — 10 / 10 pass.

---

## v0.4.9 — Unified Format dropdown + draggable Chat / ProposedEditCard splits

UI-focused release on top of [v0.4.8](https://github.com/roxelfivan/apeditor/releases/tag/v0.4.8). The editor toolbar consolidates the two small pill groups (B/I/U and font size +/−) into a single **Format** dropdown, the Chat panel gains a draggable boundary between its messages and input areas, and every **ProposedEditCard** in Split view now has a draggable divider between the **Original** and **Proposed** columns. No prompt, store, or LLM-facing changes.

### Added

- **Unified Format dropdown** on the editor toolbar. A single button labelled **Format** replaces the previous two pill groups (B / I / U and + / −). Click it to open a menu with five items:
  - **Bold** — wraps the current selection in `**...**`.
  - **Italic** — wraps in `*...*`.
  - **Underline** — wraps in `<u>...</u>`.
  - **Size +** — `bumpEditorFontSize(+1)`. Disabled when the editor is at the 24 px ceiling.
  - **Size −** — `bumpEditorFontSize(-1)`. Disabled at the 10 px floor.
  The menu closes after any action and when the user clicks outside it. The existing `Ctrl/Cmd+B / I / U` keyboard shortcuts are unchanged; the `wrapSelection` and `bumpEditorFontSize` functions are reused as-is.
- **Draggable Chat panel split.** A drag handle now lives between the messages area and the input area in the right-hand Chat panel. Drag up to give the messages more room, down to give the input more room. The split is persisted in `localStorage` under `apeditor:chat-messages-height` and is clamped 120–1,200 px (and never eats the input area). When no value is stored, the panel falls back to the previous flex layout.
- **Draggable Original / Proposed split on every ProposedEditCard.** In Split view, the vertical line between the two markdown columns is a drag handle. Drag it to resize the columns; the split is persisted per card (keyed by `${messageId}:${edit.id}:split`) in `localStorage` and clamped 20–80 % so neither column can collapse. The header row ("Original" / "Proposed") re-flows with the columns so the labels stay centred over their content. The unified (Inline) diff view and the 8 outer card resize handles are unchanged.

### Changed

- **Editor toolbar layout.** Two pill groups are gone; the toolbar now has one button (`Format`) where they used to be. The Predict / Comment / Save / Import controls are unchanged, and the toolbar still wraps cleanly on narrow widths.
- **ProposedEditCard layout** (Split view only). The previous `grid-cols-2` is now a two-row flex (header row + content row + draggable divider). Behaviour and classes for the columns themselves (`.pe-md-split--original` / `.pe-md-split--proposed`) are preserved.

### Keyboard

- `Ctrl/Cmd+B`, `Ctrl/Cmd+I`, `Ctrl/Cmd+U` — bold, italic, underline (unchanged; still work while the editor is focused even with the Format menu closed).

### Internal

- `src/components/Editor.tsx` — `formatMenuOpen` state + `formatMenuRef`; outside-click effect targeting `[data-format-menu]`; single dropdown container replaces the two pill groups. `wrapSelection` and `bumpEditorFontSize` are unchanged.
- `src/components/ChatPanel.tsx` — `messagesHeight` state with `localStorage` persistence, vertical `useDragResize` handle, `clampMessagesHeight` live-clamp against the live panel size, draggable divider between the scroller and the input panel. Keyboard shortcuts, streaming, and the `ResizeHandle` left-edge drag are unchanged.
- `src/components/ProposedEditCard.tsx` — `splitPct` state with `localStorage` persistence, horizontal `useDragResize` for the column split, `MarkdownSplitPreview` refactored to a flex layout (header row + content row + 6 px draggable divider). The 8 outer resize handles, the view-mode toggle, and the unified diff view are unchanged.

### Verification

- `npm run typecheck` — clean.
- `npm run build` — clean.
- Manual:
  - Editor: click **Format** → pick **Bold / Italic / Underline**; selection wraps; click the same item again to unwrap. Pick **Size + / Size −**; the editor text grows / shrinks. The `Ctrl/Cmd+B/I/U` shortcuts still work. The dropdown closes on outside click and after each action.
  - Chat panel: drag the divider between the messages area and the input area; reload — the split is preserved. The Send / Stop / include-selection controls and the streaming bubble all render correctly at the new size.
  - ProposedEditCard (Split view): drag the column divider; both columns resize live. Reload — the same card's split is preserved. Switch a card to Inline view and back — split is preserved. Drag a sibling card's divider — independent splits.

---

## v0.4.8 — Heading-grouped @-mention sections + inline § captions

Feature release on top of [v0.4.7](https://github.com/roxelfivan/apeditor/releases/tag/v0.4.7). The `@` section picker groups a referenced document by its Markdown headings (instead of every paragraph line), and the selected scope appears as a readable `§…` caption both on the chip bar and inside the textarea. Selecting a parent heading cascades to its descendant sections; Cancel aborts without attaching a mention. Prompt scoping is unchanged: section picks still send only the picked paragraphs (capped), not the whole document.

### Added

- **Heading-grouped section picker.** After picking a document with `@`, the second stage lists Markdown heading sections (ATX `#`…`######` and Setext underlines). Each row is a heading title; ticking it selects that heading's paragraph indexes. Documents without headings fall back to the previous blank-line / paragraph list.
- **Parent → child cascade.** Ticking a parent heading selects (or deselects) all descendant heading sections under it. Child ticks do not force the parent on.
- **Cancel** on the section picker closes without creating or updating a mention (the typed `@` query text is left as-is).
- **Inline `§…` captions in the textarea.** When you confirm a section pick, a reader-friendly caption (e.g. `§ 4.1 Title +3 more`) is inserted in the prose at the caret, matching the chip summary. A trailing zero-width space anchors the mention for delete/edit. Captions are stripped when serializing to sentinels for the LLM; they are re-hydrated when the parent re-feeds the raw value so the marker stays visible.
- **Clickable inline overlay.** Clicking the in-textarea caption re-opens the section picker (same as clicking the chip's section line).
- **`npm run test:heading-sections`** — harness for heading detection edge cases (ATX indent, trailing `#`, setext-after-ATX, cascade indexes).

### Changed

- **Section summary on chips** prefers heading titles when a section resolver is available (`§ <first title> +N more`), falling back to paragraph previews when the doc has no headings.
- **Mention ranges** in the textarea are caption + ZWSP (`[plainStart, plainEnd)`), not zero-width sentinel slots. `serializeRawWithMentions` replaces that range with the sentinel; `parseRawWithMentions` + display hydrate restore the caption for editing.
- **Section picker UX** — Cancel + Confirm; cascade toggle; clearer empty / no-headings states.

### Token / prompt behavior (unchanged contract)

- Whole-doc mention → compact outline only.
- Section-scoped mention → verbatim text of **picked paragraph indexes only** (≤ 4,000 chars per doc, ≤ 8,000 chars turn-wide across referenced docs). Not the full document.
- Picking a high-level heading can still pull in many descendant paragraphs — that is intentional cascade scope.

### Keyboard

- `↑` / `↓` — move through the heading (or paragraph) list
- `Enter` / `Tab` — confirm the highlighted row / Confirm selection
- `Space` — toggle the current section (with cascade)
- `Esc` — Cancel / close the picker

### Internal

- `src/hooks/useDocumentMentions.ts` — heading section detection (`HeadingSection`), `descendantSectionIndexes`, ATX indent / trailing-hash / setext-after-ATX guards.
- `src/components/mentions/SectionPicker.tsx` — heading rows, cascade toggle, Cancel.
- `src/components/mentions/MentionInput.tsx` — plain-text display with caption + ZWSP, hydrate-on-value-sync, overlay chip rects, equality guards to avoid resync loops.
- `src/components/mentions/parseMentions.ts` — range-aware serialize/parse; caption strip on serialize.
- `src/components/mentions/MentionChip.tsx` — section-title-aware summary.
- `src/types.ts` — heading-section related typing as needed by the picker.
- `src/index.css` — inline mention overlay styles.
- `scripts/test-heading-sections.mjs` — Node harness for heading logic.

### Verification

- `npm run test:heading-sections` — harness cases pass.
- `npm run typecheck` / `npm run build` — clean.
- Manual: `@` → pick doc → tick heading (parent cascades) → Confirm → `§…` visible in textarea and chip bar; Cancel leaves no mention; Send still scopes referenced content to picked sections only.

---

## v0.4.7 — @-document references in chat, comments, and rejection feedback

Feature release on top of [v0.4.6](https://github.com/roxelfivan/apeditor/releases/tag/v0.4.6). The chat input, comment composer, comment popover (edit mode), and Proposed Edit card's **Comment (optional)** all support an `@`-trigger that lets the user attach another document (or a specific paragraph of one) to the outgoing turn. The referenced document(s) are folded into the system prompt alongside the current document, so the model sees exactly what the user pointed at.

### Added

- **`@-document references` in chat and comments.** Type `@` in the chat input or in any comment composer / edit box to open a doc picker. Pick a document, optionally narrow it to one or more paragraphs, and the reference appears as a deletable compound chip above the input. On **Send** (chat) / **Send to AI** (comments) / **Send N rejection comments** (proposed edits), every reference is folded into the prompt as a separate `sys-referenced-doc-N` system message.
  - **Whole-doc mention** — uses the same compact outline (`≤60 chars / paragraph`) the current doc uses, so it's token-cheap.
  - **Section-scoped mention** — inlines the verbatim paragraph text of the picked sections (≤ 4,000 chars total across all picked sections; falls back to outline + truncation note if exceeded). The same outline format the AI already uses, so picking paragraphs from a referenced doc gives the model byte-exact text to quote / propose edits against.
  - **Compound chip** — two lines: doc title on top, section summary on the bottom (`full document` or `§ preview +N more`). Click the bottom line to re-open the section picker; `×` removes the reference. The chip survives the staged → committed lifecycle for rejections and comment rounds, so a card never silently loses its references between re-renders.
  - **Deleted-doc handling** — if a referenced doc is deleted, the chip flips to `(deleted)` and the mention is dropped from the prompt (round mentions are stored by id + captured title so renames don't break the chip).
  - **Persisted on comment rounds.** `CommentRound.mentions?: MentionToken[]` is the source of truth for a comment's references; the comment body is the same `parseMentions`-aware string the textarea stores. Reloads keep the references intact.
  - **Sentinel encoding** — `\u200B[[mention:<id>|<kind>|<escaped-title>|<paragraphCSV>|<escaped-docId>]]\u200B`. Survives textarea editing without showing as visible text; `parseMentions` extracts them and `buildSentinel` round-trips.
  - **Keyless Google AI Mode path** — `buildGoogleAiModeUrl` also receives the references and wraps them in `[Context — referenced document "<title>"]` blocks so the AI Mode tab sees the same context the OpenAI path does.
- **`@-references` in ProposedEditCard's Comment (optional) box.** Typing `@` in the rejection-comment textarea now opens the same picker, so a "Reject with feedback" note can point at another document (e.g. *"see the policy in `<Other Doc>` § Risk Owners"*) and the model gets that context when the batch is sent.
- **`@-references` in the comment popover's edit mode.** The plain-text edit textarea was replaced with `MentionInput`, so re-editing a comment supports the same `@` flow as creating one. Existing references are restored from the round's `mentions` (or from the body sentinels) so the user can add / remove / re-pick references without leaving edit mode.

### Changed

- **Rejection / comment-batch user messages strip mention sentinels.** `formatRejectionBatch` (and the existing `formatCommentBatch` flow) now strip mention sentinel sequences from the user-visible body so the chat history stays readable. References are conveyed through the prompt builder's new `referencedDocuments` argument, not as raw sentinel text in the user message.
- **The `RejectionItem` shape now carries `mentions`.** `RejectionItem.mentions?: MentionToken[]`; `ChatPanel.commitStagedRejections` dedups and merges the per-card mentions and forwards them to `runAssistantReplyAfterCommit(userMsg, extraMentions)`, so all three send paths (chat, comment batch, rejection batch) share the same merge / dedup / dedup-by-docId logic.
- **`updateCommentBody` accepts an optional `mentions` argument.** When omitted, existing round mentions are preserved; when supplied, they replace the round's list. In-place edits keep the existing round; sent-round edits create a new round and copy the prior round's mentions (so a follow-up body never silently loses references).
- **Dark-mode contrast for the rejection-comment `MentionInput`.** Explicit light/dark colors on `.pe-comment__input .mention-input__textarea` (light: white-on-#171614, dark: cream-on-#12100e) so the textarea is readable in both themes. The composer / popover dark theme tokens were tightened in the same pass.

### Keyboard

- `↑` / `↓` — move through the picker (doc or section list)
- `Enter` / `Tab` — confirm the highlighted row
- `Space` — toggle the current paragraph in the section picker
- `Esc` — close the picker (does not consume the `@` you typed)

### Internal

- `src/components/mentions/` — new module with `MentionInput.tsx`, `MentionChip.tsx`, `DocPicker.tsx`, `SectionPicker.tsx`, `parseMentions.ts`. Backed by a real `<textarea>` so the user keeps full caret / IME / keyboard support.
- `src/hooks/useDocumentMentions.ts` — shared hook. Paragraph splitter mirrors `buildDocOutline` so picker previews and the prompt outline describe the same shape.
- `src/types.ts` — `MentionToken`, `MentionKind`, `CommentRound.mentions?`.
- `src/api/chat.ts` — `buildRequestMessages` accepts `referencedDocuments?` and a `documentLookup?`; emits one `sys-referenced-doc-N` per dedup'd referenced doc (4,000-char cap on section-scoped inlines). `buildReferencedDocMessage` / `splitParagraphs` helpers.
- `src/utils/proposedEdit.ts` — `RejectionItem.mentions`; `formatRejectionBatch` strips sentinels via a pure `cleanCommentForPrompt` (no UI imports).
- `src/utils/googleAiMode.ts` — `buildGoogleAiModeUrl` accepts the same `referencedDocuments` + `documentLookup` and wraps each in a `[Context — referenced document "<title>"]` block.
- `src/store/useStore.ts` — `updateCommentBody(id, body, mentions?)`. `addComment` already carries `rounds[]`, so the comment composer sets the round's `mentions` directly. `ensureRoundsShape` migration is unchanged (the new field is optional).
- `src/components/ChatPanel.tsx` — `mentions` state, `stageReject` / `commitStagedRejections` / `runAssistantReplyAfterCommit` extended to carry / forward rejection mentions alongside the chat-input mentions.
- `src/components/CommentComposer.tsx` — `<textarea>` swapped for `MentionInput`; `onSave(body, mentions)`.
- `src/components/CommentPopover.tsx` — edit mode now uses `MentionInput`; `buildEditableMentionBody` rebuilds the editable text from sentinels or round mentions; `CommentBodyWithChips` renders the read view with inline reference pills (clicking a pill switches to the referenced doc).
- `src/components/ProposedEditCard.tsx` — `<textarea>` swapped for `MentionInput`; `mentions` lifted to the card so the chip bar persists through the staged → committed lifecycle.
- `src/components/Editor.tsx` — `handleSaveComment` writes `rounds[0].mentions` on creation; `mvp:send-comments` event now also carries `mentionsByCommentId`.
- `src/index.css` — `.mention-input`, `.mention-chip`, `.mention-popover`, `.cm-popover__ref` styles with light + dark theme parity.

### Verification

- `npm run typecheck` — clean.
- `npm run build` — clean (entry chunk still under the 12 MB warning limit; new mentions module is < 5 KB gzipped).
- Manual end-to-end on each surface:
  - Chat: type `@`, pick a doc, optionally pick a section, Send → AI reply references the picked doc by title.
  - New comment: type `@`, pick a doc, save → chip in the popover read view; click the chip → editor switches to the referenced doc.
  - Re-edit comment: open a comment that has a reference, click Edit → chip reappears in the edit bar, type more text, add / remove references, Save → popover reflects the new state.
  - Reject with feedback: type `@`, pick a doc, Reject with feedback → Send N rejection comments → reply addresses the referenced doc.
