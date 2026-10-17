# UX slice 1 — Import caps, Export Markdown, Apply-failure clarity

> Concrete implementation plan for the first three items from the
> [`ux-enhancement-plan-fba2`](https://github.com/roxelfivan/apeditor/blob/cursor/ux-enhancement-plan-fba2/tmp/ux-enhancement-phases.md)
> roadmap. Branched from `main` on the
> `feat/ux-slice-export-import-apply` branch. Deliberately keeps the
> existing textarea architecture so the wins ship before any Lexical
> rewrite.

## Scope

| Item | Roadmap phase | Status in code | What changes |
|---|---|---|---|
| Import size / page caps | Phase 1 polish | `extractTextFromFiles` reads entire PDF / image into memory | Add pre-flight size + page-count checks with friendly errors |
| Export Markdown | Phase 2 friction | **Not implemented anywhere** | Add download utility + an "Export" button in the Import popover |
| Apply-failure clarity | Phase 2 friction | **90% already done** (6-strategy `findEditAnchor`, "Potential mismatch" UI, Force-apply button, Apply-All skip summary) | One-click promotion from disabled Apply to a soft "best-match" path; per-skipped-edit "apply individually" link in Apply-All summary |

## Items from the roadmap explicitly NOT in this slice

- **Doc-drift fix (font size lives in Format, not toolbar −/+).** Already fixed. Both `docs/workspace.md:58` and `docs/writing.md:33` say Format, and `Editor.tsx:1246/1261` confirms the Size ± buttons live inside the Format dropdown. No code change needed.
- **Mentions chip-layout hook (claimed as a no-op at ~line 630).** Needs live verification before touching. Line numbers drift, and "no-op" can mean "intentionally inert for now."
- **Soft secret redaction.** Skipping in favour of session-only-key (a separate, also-roadmap-listed item) or Web Crypto storage (Phase 5). Regex on free text gives a false sense of security.

---

## Item 1 — Import size / page caps

### Files

- `src/utils/ocr.ts` — pre-flight size check in `extractTextFromFiles`
- `src/utils/pdf.ts` — page-count cap in `loadPdfFromBytes`
- `src/components/FileActionsButton.tsx` — surface the new errors via existing `setError` path (already wired in the popover)

### Limits (defaults; future-flag-configurable)

| Limit | Value | Rationale |
|---|---|---|
| Max file size per file | 50 MB | Current code reads the whole PDF into memory as `ArrayBuffer`. 50 MB is conservative. |
| Max PDF page count | 500 | OCR path rasterizes each page to a canvas at 2× scale. 500 pages × ~5 MB canvas ≈ 2.5 GB transient — kills the tab. |
| Max total batch size | 200 MB | Prevents 50 × 50 MB PDFs from passing per-file checks. |

### Error copy

```
"<name> is <size> MB — limit is 50 MB. Compress it or split it before re-importing."
"<name> has <N> pages — limit is 500. Try splitting it or selecting a section."
```

Both already fit the existing inline-error UI (`border-cyber-danger/40` panel in the popover).

### Out of scope

- Configurable limits in Settings (can ship later as a single store field).
- Streaming PDF readers (would require swapping pdfjs-dist to a streaming loader).

---

## Item 2 — Export Markdown

### Files

- `src/utils/storage.ts` — add `downloadTextFile(filename, content, mime)` and `sanitizeFilename(name)` helpers
- `src/components/FileActionsButton.tsx` — add an "Export" button in the popover (alongside "Choose Import File(s)")
- `src/store/useStore.ts` — no changes; `useCurrentDocument` already exists (line 1180)

### Behavior

- One Markdown file per current document, named `<safe-title>.md`. Sanitisation strips path separators and reserved characters.
- Filename defaults to `untitled.md` if the title is empty.
- The download is a `Blob` + `URL.createObjectURL` + invisible `<a download>` click — the same pattern that already exists for other UI chips.
- The button is disabled when no document is open (same `disabled` prop the Import button takes).

### UI

The popover already has a flex-wrap action row. "Export" is added as a `btn-ghost-sm` (not a fire button — it's not the primary action). Tooltip: "Download this document as Markdown."

### Out of scope (future slice)

- JSON export including comments, chat history, and revisions (the "full backup" story).
- Bulk export of all documents.

---

## Item 3 — Apply-failure clarity (refined)

### What's already in the code

- `src/utils/proposedEdit.ts:220–345` — six progressively looser anchor strategies: exact / trimmed / whitespace-collapsed / Setext heading normalisation / ATX-prefix stripping / markdown-escape normalisation.
- `src/components/ProposedEditCard.tsx:469` — "Potential mismatch detected" warning UI when `!anchorInfo.found`.
- `src/components/ProposedEditCard.tsx:550` — Force-apply button gated on caret position.
- `src/components/ChatPanel.tsx:678–744` — Apply All already reports `"Applied x of y changes (z skipped — not anchored)"`.

### What's missing

**One-click promotion from a disabled Apply to a soft "best-match" path on the single-card case.** Today the user clicks Apply, sees it do nothing because the anchor is missing, has to read the warning, and then either click Force-apply (gated on caret) or give up.

### Concrete change

- `src/components/ProposedEditCard.tsx` — `handleApply` (line 268): instead of returning silently when `applyEdit` returns `{ ok: false, reason: 'anchor-missing' }`, attempt a "best-match" pass. Concretely:
  1. Try the existing `findEditAnchor` (six strategies). If it matches, use it (current behavior).
  2. If it doesn't, run a new `findBestEffortAnchor(content, original)` that uses an even-toleranter Levenshtein-bounded regex (`/\s*/` between every token, plus allow-N-edit-distance per token). Cap effort: refuse if the document is > 100 KB or the match is < 30 chars or the result has > 30% of tokens different.
  3. If the best-effort pass finds something, show an inline confirmation prompt inline on the card (not a modal): "Apply anyway? Match is approximate — show diff." with the diff already rendered in the existing Split view. If the user confirms, perform the replace and record `appliedAt` plus a new `appliedVia: 'best-effort'` field on the recorded edit (for future audit).
  4. If the best-effort pass finds nothing, fall through to the current behavior (warning + Force-apply).
- `src/components/ProposedEditCard.tsx` — add a small `bestEffortAnchor` state, an inline confirmation row when it resolves, and the `appliedVia` plumbing.
- `src/components/ChatPanel.tsx` — `applyAllForMessage`: when there are skipped edits, the existing summary line already says "(z skipped — not anchored)". Add, per skipped edit, a small inline "Apply individually" button that scrolls to that card and promotes it to the same confirmation flow. The skipped list is derivable from `edits` minus `appliedIds`.

### Explicitly NOT changing

- `findEditAnchor` itself. Six strategies is enough; the gap is UX.
- The Force-apply flow. It's already the right escape hatch when there's no anchor at all.

### Out of scope

- "Smart" Apply that mutates the document to make the quote re-appear. That's a different product.

---

## Verification

- Manual: import a 60 MB PDF → see friendly error. Import a 600-page PDF → see friendly error. Export a document → file downloads, opens correctly. Apply a known-mismatched card → see confirmation prompt → confirm → diff applied.
- No new tests in this slice (matches the roadmap's "no tests in Phase 1–2" stance).
- Build still passes via `npm run build`.

## PR plan

- One PR per item, in the order above. Items 1 and 2 are independent; Item 3 builds on Item 2 only cosmetically (the new "Export" button is in the same popover; otherwise fully separate).
- Each PR description links back to the corresponding roadmap item.