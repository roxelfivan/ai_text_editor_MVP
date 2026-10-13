## v0.4.7 — @-document references in chat, comments, and rejection feedback

Feature release on top of [v0.4.6](https://github.com/roxelfivan/ai_text_editor_MVP/releases/tag/v0.4.6). The chat input, comment composer, comment popover (edit mode), and Proposed Edit card's **Comment (optional)** all support an `@`-trigger that lets the user attach another document (or a specific paragraph of one) to the outgoing turn. The referenced document(s) are folded into the system prompt alongside the current document, so the model sees exactly what the user pointed at.

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
