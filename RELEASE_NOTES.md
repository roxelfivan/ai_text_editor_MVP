## v0.4.5 — Comment rounds, edit rationales, leaner prompts

Feature release on top of [v0.4.1](https://github.com/roxelfivan/ai_text_editor_MVP/releases/tag/v0.4.1). Comments keep multi-round history with AI rationales after Apply; Settings can edit rationale format; Apply re-anchors the highlight to the adopted text; prompts are shorter; **Predict** starts off.

### Added

- **Comment rounds.** Each comment stores an ordered `rounds[]` (oldest first). Editing the body after **Send to AI** appends a new round instead of overwriting the previous one. Top-level `body` / `start` / `end` / `snippet` / `sent` still mirror the latest round for existing UI.
- **Applied-edit rationales.** Every `proposed-edit` fence includes a `rationale` field. On **Apply**, that text (plus summary / original / replacement) is stored on the current round and shown in the comment popover under **Rationale**.
- **Multi-round Rationale UI.** The popover lists every round; each card is independently expandable (`+` / `−`) and shows that round's comment, anchored text, and applied diffs. Margin badges show a small indicator when any round has an applied rationale.
- **Settings → Rationale Rules.** Edit the format rules independently of the fence schema. **Reset** restores the built-in default. System Message and Rationale Rules textareas resize with the Settings modal (width 100%, height drag + auto-measure).

### Changed

- **Default Rationale Rules** require ≥7 numbered points (`1`, `2`, `3a`, `3b`, `3c`, `4`, `5`), ≥100 words total, with `3a`–`3c` each ≥30 words covering why / paragraph / document. Custom overrides remain authoritative for the `rationale` field only.
- **Apply / Apply All** re-anchor the comment (and select the range) to the replacement text so the highlight fits the adopted wording.
- **Prompt wording** for system message, proposed-edit schema, rationale rules, doc preamble, and comment-batch instructions is condensed (~50% fewer characters of fixed overhead) without changing the contracts.
- **Predict** defaults to **off**. Click **Predict** or `⌘/Ctrl + \\` to enable and request a suggestion.

### Internal

- `src/types.ts` — `CommentRound`, `ProposedEditRationale`, `ProposedEdit.rationale`, `ApiConfig.rationaleRulesOverride`; comment undo ops for `append-round` / `record-applied`.
- `src/store/useStore.ts` — round migration on rehydrate; `updateCommentBody` appends a round when the latest was already sent; `recordAppliedEdit` + re-anchor to `newAnchor` / replacement.
- `src/api/chat.ts` — split `PROPOSED_EDIT_SCHEMA_RULES` + `PROPOSED_EDIT_RULES_DEFAULT`; override wrapper; leaner batch / outline copy.
- `src/components/CommentPopover.tsx`, `CommentMargin.tsx`, `SettingsModal.tsx`, `ProposedEditCard.tsx`, `ChatPanel.tsx`, `Editor.tsx`, `utils/comments.ts`, `utils/proposedEdit.ts`, `index.css`.

### Verification

- `npm run typecheck` — clean.

## v0.4.1 — Comment / Send to AI: whole-document consistency, fewer tokens

Patch release on top of [v0.4.0](https://github.com/roxelfivan/ai_text_editor_MVP/releases/tag/v0.4.0). Tightens the prompt that runs when the user clicks **Send to AI** on a document with inline comments: every fix must now stay consistent with the rest of the document, and the per-turn prompt is materially cheaper on long documents.

### Changed

- **Whole-document consistency is now explicit.** The system note pushed alongside a comment batch no longer says "address each `[id]` independently" — it now requires every replacement to stay consistent in voice, terminology, character names, facts, numbers, and style with the rest of the document. If a fix in one `[id]` logically requires a corresponding change elsewhere, the model must emit an *additional* `proposed-edit` fence for it. If two `[id]`s conflict, the model prioritizes the one that keeps the document internally coherent and notes the conflict in its prose.
- **Per-comment blocks carry local context.** `formatCommentBatch` now emits, per `[id]`, the paragraph index (`paragraph P of M`) and the byte-offset range (`doc offset S–E`), plus a 120-character context window trimmed at word boundaries on each side of the verbatim snippet. This anchors the fix in the document without forcing the model to fuzzy-match the snippet back into the full text.
- **Document is delivered as a structural outline, not a verbatim blob.** The `sys-current-doc` system message used to contain the full document body inside `--- BEGIN/END DOCUMENT ---` fences (O(document size) on every chat turn). It now emits a compact paragraph-by-paragraph outline (one `[pN] offset S–E: <first 60 chars>` line per paragraph, plus a length / paragraph count header). On a comment-batch turn, the verbatim document is no longer inlined at all — the per-comment context windows already carry the local content the model needs to make byte-exact `original` matches.
- **Proposed-edit fence schema is its own system message.** The rules block used to be appended to the same system message as the document. It is now a `sys-proposed-edit-rules` message, kept as a stable contract independent of the document and the user's customizable system prompt.
- **Token-budget discipline.** The comments-batch system note ends with an explicit "do not quote or mention the context windows in your reply" instruction, so the model doesn't pay the new context back out as added response tokens.

### Internal

- `src/utils/comments.ts` — `formatCommentBatch` rewritten to emit per-comment paragraph index, byte offsets, and 120-char context windows. New `contextBefore` / `contextAfter` helpers trim to the nearest word boundary.
- `src/api/chat.ts` — `buildRequestMessages` now pushes the proposed-edit rules and the doc outline as separate system messages. New `buildDocOutline(title, content, isCommentBatch)` helper emits the structural outline instead of the verbatim document. `looksLikeCommentBatch` regex updated to match the new `[cN] (paragraph …)` header. `PROPOSED_EDIT_RULES` extracted to a module-level constant.

### Verification

- `npm run typecheck` — clean.
- A 3-paragraph / 211-char fixture with 2 comments now produces 4,956 chars across the new `sys` + `sys-current-doc` + `sys-proposed-edit-rules` + `user` + `comments-batch` blocks, vs. the previous structure which carried the full verbatim document inside `sys-current-doc`. The new outline scales as O(paragraphs × ~60 chars) instead of O(document size).

## v0.4.0 — Comment + Send to AI, Google AI Mode, Predict label

Major feature release on top of [v0.3.4](https://github.com/roxelfivan/ai_text_editor_MVP/releases/tag/v0.3.4).

### Added

- **Comment in the editor.** Select any passage in **Write** (or the Write side of **Split**) → click **Comment** in the editor toolbar → write your note. Saving paints a soft highlight behind the text and adds a numbered badge in the margin (document order).
- **Edit / Delete anytime.** Open a margin badge for **Edit** / **Delete** / **Save** / **Cancel** — including after the comment has been sent. Body edits and deletes push onto a 20-deep in-memory undo stack; `⌘/Ctrl + Z` reverses the last comment change (toast: Comment removed / restored / edit undone).
- **Re-anchoring + Outdated.** When you edit the document, comments stay attached via a multi-strategy re-anchor pass. Only when all strategies fail does a comment flip to **Outdated** (still **Edit** / **Delete** from the badge).
- **Send to AI.** A tray under the editor appears whenever the document has ≥ 1 comment. **Send to AI** (or **Sending…** while streaming) dispatches the article plus every sendable comment as one chat turn. Outdated comments are excluded from the count. The chat API injects a system note so the model emits one `proposed-edit` fence per comment.
- **Google AI Mode (no key).** New Settings provider **Google AI Mode (no key)**. Chat opens Google AI Mode in a new tab with the prompt pre-filled; paste the answer back into the chat panel. Proposed-edit cards (**Apply** / **Reject** / **Apply N changes**) still work. **Predict** is unavailable for this provider (no streaming API).
- **Composer safeguards.** Soft cap of 2,000 chars with a live counter; hard cap of 4,000. `⌘/Ctrl + Enter` saves; `Escape` cancels.
- **Persistence.** Comments survive reload via `localStorage` under the existing `ai-text-editor-mvp` key.

### Changed

- **Predict** toolbar label is title case (`Predict`), not all-caps via CSS `uppercase`.
- **Welcome** seed document rewritten as an 8-step quick start using the same labels users see in the UI (**Write** / **Preview** / **Split**, **Comment**, **Send to AI**, **Outdated**, **Revision history**, **Prompt library**, **include selection**, **Apply** / **Reject** / **Apply N changes** / **Force-apply…**, **Predict**, **Import text from photos or PDFs**, **Google AI Mode (no key)**).
- Mirror scroll sync rebinds when the editor view mode changes so **Write** / **Split** keep text scrolling with the textarea after leaving **Preview**.

### Internal

- New `src/utils/comments.ts` — re-anchoring, batch serialization, selection-rect measurement.
- New `src/utils/googleAiMode.ts` — Google AI Mode deep-link builder.
- New components: `CommentLayer`, `CommentMargin`, `CommentComposer`, `CommentPopover`, `CommentTray`.
- `src/store/useStore.ts` — `comments` slice (persisted) + `commentUndoStack` (session-local); v0.4.0 rehydration migration.
- `src/api/chat.ts` — comment-batch system note for `[id] "..." Comment:` payloads.
- `src/components/ChatPanel.tsx` — `mvp:send-comments` / `mvp:chat-streaming` events; Google AI Mode paste flow.
- `src/index.css` — `.cm-*` styles for highlights, margin, composer, popover, tray, undo toast.

### Verification

- `npm run build` — clean.

## v0.3.2 — Debug Mode, mobile-friendly editor, manual Predict

Polish + UX release on top of [v0.3.1](https://github.com/roxelfivan/ai_text_editor_MVP/releases/tag/v0.3.1).

### Added

- **Debug Mode toggle in Settings.** A new switch at the bottom of the Settings modal gates developer-style diagnostics. Off by default.
  - When **off** (default), the inline-completion counter pill (`requested / accepted`) in the editor toolbar stays hidden — the toolbar stays minimal for end users.
  - When **on**, the counter pill appears between the status pill and the Predict button. Clicking it resets both counters back to `0 / 0`.
  - The setting is persisted across reloads via the `debugMode` field in `useStore.ts`, and older persisted state is migrated to `false` on rehydration.
- **Mobile-friendly editor toolbar.** The editor toolbar now `flex-wraps` instead of clipping on narrow viewports, so every control (view-mode select, font size, status pill, counter pill, Predict button, Import, Save) stays reachable on phone-sized viewports. The `flex-1` spacer uses `basis-full sm:basis-auto` to push the action cluster (Import + Save) onto its own row when needed. The doc-title row also wraps the "saved … ago" label cleanly below the title on narrow screens.
- **Adjustable suggestion panel.** The bottom suggestion panel now has a hairline drag handle on its top edge. Drag it up or down to resize. Height is persisted in `localStorage` under `ai-text-editor-mvp:suggestion-height` so your preferred size survives reloads. The panel is clamped to `[80 px, 60 % of the write-pane height]` so the textarea never collapses or gets pushed off-screen.
- **Manual Predict button next to the on/off toggle.** A new sparkle-labelled **Predict** button next to the appliance rocker lets you request a single inline completion on demand, bypassing the 300 ms debounce and the selection suppression. It is greyed out while a ghost is already on screen and when no API key is configured. Keyboard equivalent: ⌘/Ctrl + \ (unchanged).
- **Reject button in the suggestion panel.** Next to Accept. Same observable effect as pressing Esc — clears the ghost, aborts any in-flight stream, and hides the panel.
- **Square Import + Save icons in the toolbar.** The cyan pill buttons for Import and Save are replaced by square 36×36 icon-only buttons sharing the same brand outline. The new `.btn-icon-square` utility class is shared via `src/index.css` so they stay consistent in both themes. Tooltips and keyboard equivalents are unchanged.
- **Darker ghost-text colour in light mode.** A new theme-aware CSS variable `--ghost-color` (`rgba(60, 50, 40, 0.85)` in light, soft warm-grey in dark) replaces the previous rgba fallback that washed out on cream paper. The bottom suggestion text now reads clearly in both themes while still being visibly "draft" versus the surrounding ink.

### Changed

- **`src/components/Editor.tsx`** — toolbar wraps, resize handle, drag-resize hook usage, square Save icon, doc-title row layout.
- **`src/components/ImportMediaButton.tsx`** — square icon toggle instead of cyan pill; OCR popover logic unchanged.
- **`src/components/SettingsModal.tsx`** — Debug Mode row with rocker + helper line.
- **`src/hooks/useInlineCompletion.ts`** — exposes `reject` (same as Esc) and a simplified `cancel`. Public API unchanged.
- **`src/store/useStore.ts`** — adds `debugMode` boolean + `setDebugMode` action, persisted, with rehydration migration.
- **`src/index.css`** — adds `--ghost-color` custom property (theme-aware) and the `.btn-icon-square` helper class.
- **`package.json`** — version bumped to `0.3.2`.

### Notes

- The Predict button is the new state indicator: green (brand clay in light, cyan in dark) means inline prediction is ON, very-light-grey means OFF. Click toggles and, on the OFF→ON transition, also fires a single immediate prediction. The keyboard shortcut ⌘/Ctrl + \ still triggers a one-off prediction regardless of state.
- Suggestion panel height is the only UI affordance persisted outside the main store (kept in `localStorage` directly, not in the zustand persist config, because it is session-shaped display state and doesn't need to migrate through store version bumps).

### Verification

- `npm run typecheck` — clean.
- `npm run build` — clean.

## v0.3.1 — Inline sentence completion + roomier editor toolbar

Feature + polish release on top of [v0.3.0](https://github.com/roxelfivan/ai_text_editor_MVP/releases/tag/v0.3.0).

### Added

- **Inline sentence completion in the editor (new `src/hooks/useInlineCompletion.ts`).** While you write, the editor suggests the next single sentence using the chat model and endpoint you already set up in Settings. You don't need to configure anything new.
  - **Triggering:** a request is sent after a 300 ms pause in typing. No request is sent while you have text selected, after a deletion or undo, or while a suggestion is already showing.
  - **Manual trigger:** `⌘ / Ctrl + \` requests a suggestion immediately. It skips the 300 ms wait and also works when text is selected.
  - **Accept or dismiss:** press `Tab` to accept the suggestion and `Esc` to dismiss it. Typing any other key also discards it.
  - **Suggestion panel:** suggestions appear in a panel at the bottom of the editor, sized to the suggestion and capped at 40% of the editor's height. While a request is in progress it shows a pulsing "…" indicator. The panel also has an **Accept** button for mouse users.
  - **Token-saving limits:** at most 600 characters before the cursor are sent as context. Output is capped at `max_tokens: 500` and stops at the first line break, so you get at most one sentence. Temperature is capped at 0.4. Any earlier request still in flight is cancelled as soon as you keep typing.
  - **Output cleanup:** `<think>…</think>` reasoning blocks are removed while the reply streams in. If the model repeats the last words you typed, the repeated part is removed so accepting a suggestion doesn't duplicate text.
- **Three new controls in the editor toolbar:**
  - **Status pill.** Shows `idle`, `thinking` (pulsing dot) or `ready · tab`.
  - **Counter pill.** Shows how many suggestions were requested and how many were accepted in this session (`requested / accepted`). Click it to reset both counts.
  - **On/Off toggle.** A switch with an I/O knob that turns inline completion on or off. It is greyed out until an API key and endpoint are configured. Turning it off cancels any request in progress and clears the current suggestion.

### Changed

- **Editor toolbar controls are a bit taller (28 px → 36 px, `h-7` → `h-9`).** This affects the View dropdown, the font-size `−` / `+` buttons (now `w-9 h-9`) and the three new controls. The text stays at **15 px**, the same as the topbar buttons. Import and Save keep the topbar button style (`btn-cyan-sm !text-[15px] !py-1.5`).
- **`src/components/Editor.tsx`** — the textarea is now wrapped in a column that also holds the suggestion panel. Two new window events were added: `mvp:accept-completion` (applies an accepted suggestion and puts the cursor at its end) and a global `⌘ / Ctrl + \` key handler.
- **`package.json`** — version bumped to `0.3.1`.

### Notes

- Inline completion is turned off automatically when no API key or endpoint is configured. Store and persisted state are unchanged. The on/off setting and the counters reset when the page reloads.
- Each suggestion is a separate API request to your configured provider, so it uses tokens. Use the On/Off toggle to turn the feature off.

### Verification

- `npm run build` — clean (TypeScript + Vite production build).

## v0.2.5 — ApEditor cyberpunk UI + Muji light theme

UI overhaul on top of [v0.2.4](https://github.com/roxelfivan/ai_text_editor_MVP/releases/tag/v0.2.4).
The app now ships with two coherent themes and a real brand identity extracted from the
ApEditor logo (black + neon cyan + neon green + crimson-purple gradient).

### Added

- **ApEditor brand mark.** The full logo is now rendered in the topbar (h-14 / 56px) alongside a tracked-out "ApEditor" wordmark. A matching inline-SVG favicon ships in `index.html`, and the file `public/apeditor-logo.jpg` is bundled with the build.
- **Two-coherent-theme system.** The `.dark` class on `<html>` drives both themes via a single set of utility classes:
  - **Dark (default)**: pure black, neon cyan, neon green, crimson-purple gradient on primary CTAs, neon halos on focus / hover.
  - **Light (Muji)**: warm cream paper, kraft panels, sumi ink text, deep-espresso outlined pills, no glow, no gradient — comfortable for long focus sessions.
- **New design tokens** in `tailwind.config.cjs`:
  - `ape.*` — dark surfaces (`base`, `panel`, `elevated`, `hairline`).
  - `paper.*` — Muji surfaces (`base`, `panel`, `elevated`, `hairline`, `ink`, `inkSoft`).
  - `cyber.*` — shared brand accents (cyan, green, status) plus the new `clay` espresso and crimson-purple `fire` / `fireMid` / `fireTo`.
  - New shadows: `ape-glow`, `ape-glow-green`, `ape-fire`, `ape-paper`, `ape-paper-lift`.
  - New background image: `ape-fire` crimson-purple gradient (replaces the old red→orange→yellow flame).
- **New component classes** (auto-themed via CSS in `src/index.css`):
  - `.btn-fire` — primary CTA (plum gradient in dark, clay pill in light).
  - `.btn-cyan` — secondary CTA (cyan outline in dark, hairline outline in light).
  - `.btn-ghost`, `.btn-danger`, `.ape-field`, `.text-glow-cyan` / `text-glow-green` (dark-only).
- **Default theme is now dark** for new installs (`useStore.ts` default `theme: 'dark'`; `main.tsx` applies the class on first paint). Existing users with a persisted `light` preference are still respected.

### Changed

- `index.html` — title → "ApEditor — AI Markdown Editor"; inline-SVG favicon (cyan ape-eye on black); theme color `#000000`.
- `tailwind.config.cjs` — full design-system token extension; new shadows; new `ape-fire` gradient.
- `src/index.css` — rewritten around two themes: prose, diff, proposed-edit card, scrollbar, resize handle, edge anchor and the shared button classes all carry `html.dark` and `html:not(.dark)` blocks so components stay class-name-agnostic.
- `src/main.tsx` — applies `.dark` on first paint from the persisted store (defaults to dark if no preference).
- `src/store/useStore.ts` — default `theme: 'dark'`.
- All surface components (`App.tsx`, `Sidebar`, `Editor`, `ChatPanel`, `SettingsModal`, `PromptLibrary`, `RevisionHistory`, `ProposedEditCard`, `PhotoImportButton`, `EdgeAnchor`) — every Tailwind utility that maps to a brand token now carries a `dark:` variant, so flipping the theme toggle swaps the whole UI without remount.

### Notes

- No backend, store API, or component logic was changed. The default-theme flip and the `useStore` flip are the only behavioural changes; everything else is visual.
- `npm run build` and `npm run dev` both pass clean.

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
