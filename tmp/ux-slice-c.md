# UX adoption — Slice C (v0.5.3) status

> Tracks the work shipped in v0.5.3 — per-comment **Re-link** + **Dismiss** affordance in the comment tray, plus an inline picker for choosing a new anchor — and refreshes the next-open items in [`tmp/ux-enhancement-adoption.md`](ux-enhancement-adoption.md). Coexists with [`tmp/ux-enhancement-phases.md`](ux-enhancement-phases.md) for historical context.

---

## What v0.5.3 changed

### Item B — Batch-dismiss / re-select outdated comments (P2.4) is now complete

- `src/components/CommentTray.tsx` grew an expandable "N stale comments — Re-link or Dismiss" section that lists every outdated comment with two per-row buttons:
  - **Re-link** opens the new `ReanchorPicker` modal (see below).
  - **Dismiss** deletes the single comment via the existing `deleteComment` action and pushes an `update-body` (or `delete`) undo op so ⌘Z still restores.
  - A small **Dismiss all** link on the row header preserves the v0.5.1 bulk path for users who want to sweep the list in one click.
- `src/components/ReanchorPicker.tsx` is a new small modal that lists the current document's heading sections (or its paragraphs when there are no headings) using the same `.mention-popover*` CSS classes as the @-section picker. Selecting a row calls the existing `reattachComment(id, { start, end })` action, so the undo stack gets an `update-body` op and ⌘Z reverts cleanly.
- `src/utils/comments.ts` ships a new `isCommentStale(comment, content): boolean` predicate. Pure, no React imports. Mirrors the same byte-exact + `findEditAnchor` strategies the re-anchor pass uses, so a UI surface can flag stale rows without mutating anything.
- `src/components/Editor.tsx` wires the picker: a small `reanchorFor` state, mounted inside the editor pane, hooked to the existing `reattachComment` action. Confirms with a one-shot undo toast *"Comment re-anchored — ⌘Z to revert"*.
- `src/index.css` adds ghost / stale-list / Relink-picker styles with light + dark theme parity.

---

## Updated adoption status (post-v0.5.3)

### Done

- ✅ **Phase 1 — all polish items** (v0.5.0 / v0.5.1): doc drift, dead hook, gated-state tooltips, ⌘Z teaching toast.
- ✅ **Phase 1.2 (Slice C half)** — broader empty / gated states (v0.5.2): OCR-vs-key paragraph, `@` picker empty states, Google AI Mode paste hint.
- ✅ **Phase 2** — selection-only send, secret redaction, outdated comments (v0.5.1).
- ✅ **Phase 2.5** — Markdown export (v0.5.0) + JSON backup (v0.5.2).
- ✅ **Phase 2.6** — session-only API key (v0.5.1).
- ✅ **Phase 2.4** — outdated-comment cleanup (v0.5.1 banner copy + bulk Dismiss; v0.5.3 per-row Re-link + Dismiss).

### Still open

| ID | Item | Plan slice | Status |
|---|---|---|---|
| D | Single 2-pane mentions picker (Option B) | Slice D (v0.6.0) | Untouched. `MentionInput.tsx` still mounts `DocPicker` then `SectionPicker` separately. |
| E | In-Help keyboard / shortcut map + conflict hints (⌘B) | Slice E (v0.6.1) | Untouched. `docs/keyboard-shortcuts.md` is comprehensive; `HelpDocs.tsx` doesn't yet expose it. |
| F | Accessibility pass | Slice E (v0.6.1) | Untouched. Many surfaces already carry `role` / `aria-*`; remaining audit is on `CommentLayer`, `CommentPopover`, `ResizeHandle`. |
| G | Google AI Mode paste UX (larger clipboard target + truncated-URL warning) | Slice D (v0.6.0) | **Partial.** v0.5.2 added the two-step hint above the paste textarea; the one-click clipboard paste button and the truncated-URL warning are still TODO. |
| H | Phase 4 — Mobile-first layout | Slice F (v0.7.0) | Untouched. |
| I | Phase 5 — Major upgrades | Slice G (v0.8.x+) | Untouched. |

---

## Suggested next move

**Slice D** — interaction redesign. Two items ship together because both touch the chat-input surface area:

### Item D — Single 2-pane mentions picker

Restructure `MentionInput.tsx` so `DocPicker` is the always-visible left rail and `SectionPicker` is the right pane. Mirrors `docs/REFACTORING.md` §4 Option B. Drops the `kind: 'doc' | 'section'` state machine in the parent. Estimated: ~3 days.

### Item G — Google AI Mode paste UX (final two pieces)

Add a one-click "Paste from Google AI Mode" button (`navigator.clipboard.readText()`) with three gated cases:

- Empty paste → "Google returned no answer — try sending the prompt again."
- URL-truncation marker (Google's `...`) in the pasted text → inline warning.
- Suspiciously tiny text → "This answer is very short. If Google was throttled, try again or pick a different prompt."

Estimated: ~1 day alongside Item D.

Plan: ship Slice D (v0.6.0) when Item D + Item G final pieces land together. The release framing can use the same four-section shape (Added / Changed / Behaviour / Internal / Verification).
