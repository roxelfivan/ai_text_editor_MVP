# UX adoption — Slice B (v0.5.2) status

> Tracks the work shipped in v0.5.2 — JSON backup export + a broader empty / gated-state copy pass — and refreshes the next-open items in [`tmp/ux-enhancement-adoption.md`](ux-enhancement-adoption.md). Coexists with the original [`tmp/ux-enhancement-phases.md`](ux-enhancement-phases.md) for historical context.

---

## What v0.5.2 changed

### Item A — JSON backup export (P2.5 second half) is now done

- New `src/utils/backup.ts` exposes `buildDocumentBackup` + `serialiseDocumentBackup` + the versioned `DocumentBackup` shape (`schema: 'apeditor-document-backup'`, `version: 1`).
- `FileActionsButton.tsx` grew a third popover section (**Export full backup (JSON)**) sitting between Export `.md` and Close. Same structural template as the existing two sections.
- The Markdown export still ships unchanged — both buttons coexist in the popover.

### Item C — Empty / gated-state copy pass (P1.2) is now broader

- `FileActionsButton.tsx` adds a contextual paragraph under the language picker explaining what runs locally versus what needs an API key. The message flips between "OCR works without an API key" and "Key configured" based on live `api.apiKey` / `api.apiEndpoint`.
- `DocPicker.tsx` now distinguishes three empty states — `no-workspace` (zero docs), `only-current` (only the current doc), `no-match` (query with no matches) — surfaced via a `data-empty-reason` attribute so future analytics / tests can target them.
- `ChatPanel.tsx` adds a three-step numbered list above the Google AI Mode paste textarea spelling out the two-step flow (open new tab → copy answer → paste here with ⌘/Ctrl+Enter).

---

## Updated adoption status (post-v0.5.2)

### Done

- ✅ Phase 1 — doc drift (#17), ⌘Z toast (#17), import caps (v0.5.0), chip-layout fix (#17).
- ✅ Phase 1.2 (Slice C half) — gated-state tooltip copy broadened in v0.5.2.
- ✅ Phase 2 — selection-only send, secret redaction, outdated-comment polish (all via PR #18).
- ✅ Phase 2.5 (Markdown export side) — v0.5.0.
- ✅ Phase 2.5 (JSON backup side) — v0.5.2 (this slice).

### Still open

| ID | Item | Plan slice | Status |
|---|---|---|---|
| B | Batch-dismiss / re-select outdated comments | Slice C (v0.5.3) | Untouched. The "no longer anchored" badge copy lives in `src/components/CommentTray.tsx` + `src/utils/comments.ts`. Next ticket: add a tray footer that lists unfindable comments with Dismiss / Re-link actions. |
| D | Single 2-pane mentions picker | Slice D (v0.6.0) | Untouched. `MentionInput.tsx` still mounts `DocPicker` then `SectionPicker` separately. |
| E | In-Help keyboard / shortcut map + conflict hints (⌘B) | Slice E (v0.6.1) | Untouched. `docs/keyboard-shortcuts.md` is comprehensive; `HelpDocs.tsx` doesn't yet expose it. |
| F | Accessibility pass | Slice E (v0.6.1) | Untouched. Many surfaces already carry `role` / `aria-*`; remaining audit is on `CommentLayer`, `CommentPopover`, `ResizeHandle`. |
| G | Google AI Mode paste UX (larger clipboard target + truncated-URL warning) | Slice D (v0.6.0) | **Partial in v0.5.2** — the two-step hint was added, but the one-click clipboard paste button and truncated-URL warning are still TODO. |
| H | Phase 4 — Mobile-first layout | Slice F (v0.7.0) | Untouched. |
| I | Phase 5 — Major upgrades | Slice G (v0.8.x+) | Untouched. |

---

## Suggested next move

**Slice C** — comment lifecycle completeness. v0.5.2 widened the "no longer anchored" copy (item B in this slice's open list), but the *affordance* is still missing. Add a `CommentTray` footer that lists unfindable comments with two buttons:

- **Dismiss** — pushes a `delete` undo-stack entry (existing helper at `src/store/useStore.ts`).
- **Re-link** — opens a thin heading / paragraph picker, similar to the new section picker in `MentionInput`.

Estimated effort: ~2 days including release notes. Concrete file map:

- `src/utils/comments.ts` — new `isCommentStale(comment, content)` helper that reuses `findEditAnchor` against the round's `snippet`.
- `src/components/CommentTray.tsx` — new footer block listing stale comments, with the two buttons; reuse existing tray styles.
- `src/store/useStore.ts` — no new actions; reuse `deleteComment`.
- `RELEASE_NOTES.md` — v0.5.3 entry mirroring the v0.5.2 format.

Verification: same two gates (`tsc --noEmit` + `npm run build`) and a manual checklist in the release notes covering the three comment states (anchored, stale, re-linked).
