# Refactoring plan

> Concrete split plans for the 4 mega-files. No code changes in this document — only the move-and-shape plan. Each section is independent; tackle in any order.

**Why this matters now:** the codebase is functional, but three files exceed 1,300 lines and the editor mixes 7 distinct concerns. Future-you, future contributors, and future-features all pay the cost every time they skim. Splitting along the existing seams gets the file count up, the line count down, and the navigation trivial — without changing observable behaviour.

---

## 0. Pre-flight

Before any refactor, run the full typecheck + build so we have a known-good baseline:

```bash
npm run typecheck
npm run build
```

After each refactor, run them again. The typecheck is the cheap gate; the build catches import-graph issues that tsc misses.

---

## 1. `store/useStore.ts` (1364 LoC) — slice it

### Goal
Reduce the file to a thin composer (~120 LoC) that wires 5 slices into one store. Each slice owns its own state + actions and is independently testable.

### Target shape

```
src/store/
  useStore.ts                  # ~120 LoC: createStore + persist + rehydrate + slice composition
  slices/
    documents.ts               # docs, currentDocId, revisions, create/rename/delete/restore
    chat.ts                    # chats (per-doc), appendMessage / updateLastAssistant / clearChat
    comments.ts                # comments + undo stack (largest slice; ~500 LoC)
    view.ts                    # viewMode, font sizes, theme, debugMode, ui font size
    layout.ts                  # layout, setLayout, setPreviewSize, panel-collapsed flags
    api.ts                     # api config + setApi + toggleTheme
    editorFocus.ts             # editorFocus (per-doc) + setEditorFocus
```

### Concrete move plan

| Current location in `useStore.ts` | Moves to | Approx LoC |
|---|---|---|
| Lines 116–204 (`StoreState` interface) | `slices/<each>.ts` (each slice re-exports its own slice of the state) | — |
| Lines 437–470 (documents actions) | `slices/documents.ts` | ~40 |
| Lines 472–515 (revisions actions) | `slices/documents.ts` | ~45 |
| Lines 517–545 (chats actions) | `slices/chat.ts` | ~30 |
| Lines 600–740 (comment actions: add / updateBody) | `slices/comments.ts` | ~140 |
| Lines 741–890 (appendRound, recordAppliedEdit) | `slices/comments.ts` | ~150 |
| Lines 890–1000 (markCommentsSent / delete / undo) | `slices/comments.ts` | ~110 |
| Lines 547–568 (prompts actions) | new `slices/prompts.ts` | ~25 |
| Lines 556–568 (view-mode + font-size + theme) | `slices/view.ts` | ~25 |
| Lines 570–595 (api + layout + editorFocus) | `slices/api.ts` + `slices/layout.ts` + `slices/editorFocus.ts` | ~50 |
| Lines 600–1000 (the undo stack + helpers) | `slices/comments.ts` | — |
| Lines 1170–1364 (private helpers: `pushUndoOp`, `findCommentEntry`, `replaceComment`, `ensureRoundsShape`, `markLatestRoundSent`, `findCommentForEdit`, `snippetOverlapScore`) | `slices/comments/_internal.ts` or new `slices/comments/helpers.ts` | ~190 |
| Lines 1020–1170 (rehydrate migrations) | `store/rehydrate.ts` | ~150 |

### Slice pattern sketch

```ts
// slices/comments.ts
import type { StateCreator } from 'zustand';
import type { StoreState } from '@/store/types';
// NOTE: this sketch is for shape only — keep the existing
// signature, error handling, and `pushUndoOp` FIFO behaviour intact.

export interface CommentSlice {
  comments: Record<string, Comment[]>;
  commentUndoStack: CommentOp[];

  addComment: (c: Comment) => void;
  updateCommentBody: (id: string, body: string, mentions?: MentionToken[]) => void;
  appendCommentRound: (id: string, round: Omit<CommentRound, 'id' | 'applied'>) => void;
  recordAppliedEdit: (info: RecordAppliedEditArgs) => string | null;
  markCommentsSent: (ids: string[]) => void;
  deleteComment: (id: string) => void;
  replaceCommentsForDocument: (documentId: string, comments: Comment[]) => void;
  undoLastCommentOp: () => CommentOp | null;
}

export const createCommentSlice: StateCreator<
  StoreState,
  [['zustand/persist', unknown]],
  [],
  CommentSlice
> = (set) => ({
  comments: {},
  commentUndoStack: [],
  addComment: (comment) => set(/* same as today */),
  // ... etc
});
```

```ts
// store/useStore.ts (the new thin composer)
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { createDocumentSlice } from './slices/documents';
import { createChatSlice } from './slices/chat';
import { createCommentSlice } from './slices/comments';
// ... 4 more

export const useStore = create<StoreState>()(
  persist(
    (set, get, api) => ({
      ...createDocumentSlice(set, get, api),
      ...createChatSlice(set, get, api),
      ...createCommentSlice(set, get, api),
      ...createViewSlice(set, get, api),
      ...createLayoutSlice(set, get, api),
      ...createApiSlice(set, get, api),
      ...createEditorFocusSlice(set, get, api),
      ...createPromptsSlice(set, get, api),
    }),
    { /* persist + rehydrate, both extracted */ }
  )
);
```

### Risk notes

- **`persist`'s `partialize`** currently enumerates 19 fields. After slicing, build it by walking each slice's `partialize` so a new slice doesn't have to remember to opt in.
- **Rehydrate migrations** touch multiple slices. Extract to `store/rehydrate.ts` so the migrations are testable in isolation.
- **`useStore.getState()` access in `ChatPanel.tsx` / `Editor.tsx`** keeps working unchanged — the public surface is the same.
- **Zustand slice typing** uses `StateCreator<StoreState, …, [], SliceShape>`. Cross-slice reads (e.g. `recordAppliedEdit` reads `documents`) work via `get()`.

### Order of operations

1. Extract helpers first (`useStore.ts:1170-1364`) — they're pure and can be lifted verbatim.
2. Extract `commentUndoStack` + comment actions as one slice (largest impact, hardest part).
3. Extract the rest in any order.
4. Wire up the composer.
5. Run typecheck.

---

## 2. `components/Editor.tsx` (1801 LoC) — extract hooks + split views

### Goal
Reduce the file to a clean orchestrator (~400 LoC) that wires extracted hooks. The textarea + its mirror + the suggestion panel + the comment tray stay in `Editor.tsx`. Toolbar, hotkeys, selection reporting, comment logic, and inline-completion coordination all move out.

### Concerns currently mixed in `Editor.tsx`

1. **Textarea mechanics** — value binding, onChange, selection reporting, onMouseUp/onKeyUp/onSelect. Lines 1493-1540.
2. **Toolbar** — view-mode select, Format dropdown, Predict button, debug-mode pill, comment button, Import, Save. Lines 1100-1430.
3. **Comment system** — composer, popover, margin, tray, debounced re-anchoring, badge-position measurement. Lines 480-660 + 750-880 + 1440-1640.
4. **Inline completion** — togglePredict, `mvp:accept-completion` listener, ⌘+\\ hotkey, ghost panel UI. Lines 250-300 + 410-440 + 1640-1760.
5. **Selection utilities** — `getSelectionRect` calls, `toWrapperLocal`, `restoreCaret`, `getSelectionRect`-driven popover/composer positioning. Lines 40-80 + 660-700 + 730-840.
6. **Global hotkeys** — ⌘+Z for comment undo, ⌘+\\ for inline trigger. Lines 410-430 + 700-720.
7. **Persistence** — suggestionHeight in localStorage, "saved N min ago" labelling. Lines 180-200 + 300-320.

### Target shape

```
src/components/
  Editor.tsx                       # ~400 LoC: textarea + mirror + suggestion panel + tray; pure layout
  editor/
    EditorToolbar.tsx              # ~250 LoC: view select + Format dropdown + Predict + Comment + Import + Save
    SuggestionPanel.tsx            # ~120 LoC: the bottom panel + accept/reject buttons (was lines 1640-1760)
    UndoToast.tsx                  # ~50 LoC (was lines 1600-1640)
    DebugPill.tsx                  # ~80 LoC (the inline-completion status pill + counters)
    useEditorShortcuts.ts          # ~120 LoC: all global keybindings tied to the editor (B/I/U, ⌘+\\, ⌘+Z for comment undo, mvp:select-range, mvp:insert-text, mvp:accept-completion listeners)
    useEditorSelection.ts          # ~80 LoC: onFocus/onBlur/onSelect/onMouseUp/onKeyUp → setEditorFocus, exposes hasSelection
    useEditorCommentLayer.ts       # ~250 LoC: openComposer, handleSaveComment, handleSelectComment, handleSendToAi, debounced reanchor, badge-position measurement, popover position
    useSuggestionHeight.ts         # ~30 LoC: localStorage-persisted suggestion panel height
    useSavedLabel.ts               # ~50 LoC: the "saved N min ago" ticker
    restoreCaret.ts                # ~40 LoC: shared helper (already a top-level function in Editor.tsx:40-75)
```

### Extract sketches

```ts
// editor/useEditorCommentLayer.ts
export function useEditorCommentLayer(args: {
  doc: DocumentRecord | null;
  writePaneRef: React.RefObject<HTMLDivElement>;
}) {
  // holds: composerOpen, composerPosition, pendingSelection,
  //        activeCommentId, popoverPosition, badgePositions,
  //        paneBounds, currentComments, sortedComments,
  //        activeComment, commentUndoDepth
  // returns: { openComposer, handleSaveComment, handleSelectComment,
  //           handleSendToAi, sortedComments, activeComment,
  //           composerOpen, composerPosition, pendingSelection,
  //           popoverPosition, badgePositions, paneBounds,
  //           closeComposer, closePopover }
}
```

```ts
// editor/useEditorShortcuts.ts
export function useEditorShortcuts(args: {
  doc: DocumentRecord | null;
  inlineEnabled: boolean;
  inline: UseInlineCompletionResult;
  wrapSelection: (k: 'bold' | 'italic' | 'underline') => void;
  undoLastCommentOp: () => CommentOp | null;
  setUndoToast: (t: { message: string; at: number } | null) => void;
}) {
  // owns: all the window-event listeners
  //       (mvp:select-range, mvp:insert-text, mvp:accept-completion,
  //        mvp:mark-comments-sent, keydown for ⌘+B/I/U, ⌘+\, ⌘+Z)
}
```

### Risk notes

- **Ref forwarding across hooks** — `useEditorCommentLayer` needs `writePaneRef` from the parent. Pass via a `refs` arg, not by creating a ref inside the hook (which would break the parent's measurement).
- **The `mvp:*` event listeners** must be set up exactly once. Co-locate them in `useEditorShortcuts` to keep the listener graph in one place.
- **`restoreCaret`** is a top-level helper today. Move it to `editor/restoreCaret.ts` so the other components that might need it (no current callers, but future use) can import without pulling the editor.
- **The textarea's `onKeyDown`** currently does both B/I/U + inline Tab/Esc inline. After extraction, the textarea stays a dumb element and `useEditorShortcuts` installs the B/I/U listener on `window` — same observable behaviour, less coupling to the textarea.

### Order of operations

1. Move `restoreCaret` to `editor/restoreCaret.ts` (zero risk).
2. Extract `useEditorSelection` (independent of everything else).
3. Extract `useEditorCommentLayer` (the largest, but contained).
4. Extract `EditorToolbar` + `SuggestionPanel` + `UndoToast` + `DebugPill` (pure JSX moves).
5. Extract `useEditorShortcuts` last (touches all the others).
6. Run typecheck + manual smoke test: type, comment, send, accept inline completion, undo comment, switch view mode.

---

## 3. `api/chat.ts` (1065 LoC) — split by responsibility

### Goal
Three concerns in one file: (1) the SSE stream + `ApiError`, (2) the prompt builder + cross-reference maps, (3) the proposed-edit rules + system-message normalisation. Each is independently testable; today they're not.

### Target shape

```
src/api/
  chat.ts                          # ~120 LoC: streamChatCompletion, ApiError, resolveChatEndpoint, assertSafeChatEndpoint
  prompts/
    buildRequestMessages.ts        # ~260 LoC: the main prompt assembly (system + outline + mentions + cross-ref map)
    buildDocOutline.ts             # ~70 LoC: paragraph boundaries + outline + trimOnWordBoundary
    buildReferencedDocMessage.ts   # ~150 LoC: per-doc referenced-doc system message (whole-doc + section paths)
    buildCrossReferenceMap.ts      # ~50 LoC: per-comment [c1 -> ...] map
    proposedEditRules.ts           # ~80 LoC: PROPOSED_EDIT_SCHEMA_RULES, buildProposedEditRulesMessage
    systemMessage.ts               # ~120 LoC: DEFAULT_SYSTEM_MESSAGE, normalize*, isCurrent*, isStale*
    constants.ts                   # ~30 LoC: CACHE_CONTROL_META, REFERENCED_*_CHARS_CAP, OUTLINE_PREVIEW_CHARS
```

### Re-exports for backward compatibility

`src/api/chat.ts` re-exports the public surface so call sites (`store/useStore.ts`, `components/SettingsModal.tsx`, etc.) keep compiling:

```ts
export { DEFAULT_SYSTEM_MESSAGE, normalizeSystemMessage, isStaleDefaultSystemMessage, isCurrentDefaultSystemMessage } from './prompts/systemMessage';
export { PROPOSED_EDIT_RULES_DEFAULT, normalizeRationaleRulesOverride, isStaleRationaleRulesOverride, isCurrentRationaleRulesDefault } from './prompts/proposedEditRules';
export { buildRequestMessages } from './prompts/buildRequestMessages';
export { streamChatCompletion, ApiError, resolveChatEndpoint, assertSafeChatEndpoint } from './chat';
```

### Risk notes

- **`buildRequestMessages` calls `buildReferencedDocMessage` and `buildDocOutline` and `buildCrossReferenceMap`** — keep them in the same folder so the import graph stays simple.
- **`CACHE_CONTROL_META` is used in `buildRequestMessages` and `utils/googleAiMode.ts`** — put it in `prompts/constants.ts` so both import the same source.
- **The "keep the stale-system-message / stale-rationale detection in sync with the live built-in" pattern** is currently documented in JSDoc. After splitting, the JSDoc still lives next to the function — no change.

### Order of operations

1. Move `DEFAULT_SYSTEM_MESSAGE` + its normalisers to `prompts/systemMessage.ts`.
2. Move `PROPOSED_EDIT_*` rules + normalisers to `prompts/proposedEditRules.ts`.
3. Move `buildDocOutline` + `splitParagraphs` + `trimOnWordBoundary` to `prompts/buildDocOutline.ts`.
4. Move `buildReferencedDocMessage` + `buildCrossReferenceMap` + `ReferencedDocContext` to their files.
5. Move the constants to `prompts/constants.ts`.
6. Leave `streamChatCompletion` + `ApiError` + endpoint helpers in `api/chat.ts`.
7. Add re-exports in `api/chat.ts`.
8. Run typecheck.

---

## 4. Mention system (`components/mentions/`, 1834 LoC) — consolidate

### Goal
Right now, picking a doc is 2 popovers (DocPicker → SectionPicker), and editing an existing chip's sections re-uses the same SectionPicker via a flag. The complexity is worth it for the AI's prompt (one chip can be whole-doc OR a section, and the same picker handles both). But the file count is high and `MentionInput.tsx` alone is 1039 lines.

### Three options, pick one

#### Option A — keep the 2-stage picker, extract `useMentionState` (recommended)

- Keep the 5 files. Add a `components/mentions/useMentionState.ts` that owns `plainText`, `positions`, `mentions`, `popover`, and the `handleInput` / `onDocPicked` / `insertNewMention` / `onSectionEditConfirm` / `deleteMention` callbacks. `MentionInput.tsx` becomes pure render.
- `MentionInput.tsx` shrinks from 1039 LoC to ~250 LoC.
- `parseMentions.ts` stays as-is.
- Effort: ~3 hours. Risk: low (logic unchanged, just lifted out).

#### Option B — fold doc + section pickers into a single 2-pane popover

- `DocPicker` becomes a left rail (always visible while picker is open).
- `SectionPicker` becomes the right pane, populated when a doc is selected.
- Eliminates the "kind: 'doc' | 'section'" state machine in `MentionInput`.
- Risk: medium (a UX change; the current 2-stage flow is intentional — the user picks a doc, then sees section checkboxes for *that* doc).
- Effort: ~6 hours. Saves ~100 LoC in `MentionInput.tsx` but adds layout complexity.

#### Option C — keep 2-stage, but inline DocPicker into MentionInput

- DocPicker is small (111 LoC) and only used in one place.
- Saves a file, hurts reusability (none of the other popovers will ever need it).
- Not recommended.

### Decision criterion

Pick **A** unless we have product reason to redesign the picker UX. **A** is enough to get the file count down and the file size down; **B** is a UX change that should be its own ticket.

### Risk notes (A)

- `handleInput` reads `setMentions`, `setPositions`, `setPlainText` in a specific order with a state-batching gotcha (the `patchPositionsForSerialize` helper exists to work around `setPositions` being async). After extraction, the same pattern applies — just moved to a hook. Run a manual test: type a mention, edit prose around it, delete a character in the caption, switch docs, reload (sentinels persist), re-edit sections via the chip pill.

---

## 5. `index.css` (1893 LoC) — quick audit

### Goal
The CSS is large. Most of it is Tailwind utilities inlined as custom classes (`.btn-fire`, `.btn-cyan-sm`, etc.) and component classes for the comment layer (`.cm-mirror`, `.cm-tray`, `.cm-composer`, `.cm-popover`, `.cm-margin*`, `.cm-undo-toast*`). The codebase is consistent — every button uses the same `.btn-fire` — so the file is doing its job. The only trim is unused selectors.

### Audit steps

```bash
# Find every custom class used in the codebase
rg "className=" src/ -o --no-filename | rg -o "btn-[a-z-]+|cm-[a-z-]+|ape-[a-z-]+|mention-[a-z-]+|paper-[a-z-]+|cyber-[a-z-]+" | sort -u > /tmp/used.txt

# Find every custom class defined in index.css
rg "^\.[a-z-]+" src/index.css -o --no-filename | sort -u > /tmp/defined.txt

# Show classes that are defined but never used
comm -23 /tmp/defined.txt /tmp/used.txt
```

### Likely candidates for removal (deferred until measured)

- Any `paper-*` or `cyber-*` token not used in any class.
- Any `.btn-*-sm` variant only referenced once.
- The dark-mode `.ape-*` palette shadows if not in active use.

### Risk notes

- Tailwind's JIT compiler will tree-shake unused utilities, so the production CSS is already smaller than the source suggests. The audit is about source readability, not bundle size.
- Don't rename custom classes — it's a sprawling audit. Removing unused ones is the safe move.

---

## 6. Cross-cutting: `utils/comments.ts` + `utils/proposedEdit.ts` are already clean

These two files (~566 + ~521 LoC) are pure functions, zero React, zero DOM imports beyond the mirror-rect measurer in `comments.ts`. They are the gold standard for the rest of the codebase. Don't touch them.

`utils/ocr.ts` (323 LoC) and `utils/pdf.ts` (91 LoC) are dynamically imported (via `ImportMediaButton.tsx`), so they don't bloat the main chunk. Don't touch them either.

`utils/diff.ts` (77 LoC), `utils/markdown.ts` (23 LoC), `utils/theme.ts` (12 LoC) are tiny and focused. Don't touch them.

---

## 7. Aftermath: what to do once these are split

1. **Re-run the architecture map.** Update [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) §4 with the new file paths and re-publish the module index.
2. **Add a `npm run lint:files`** (optional) — a one-liner that fails CI if any file under `src/components/` or `src/store/` exceeds 600 LoC. Prevents drift.
3. **Add a smoke test** for the comment re-anchor logic in [`utils/comments.ts`](utils/comments.ts). It's the most stateful pure module and the easiest to write a test for (the inputs and expected outputs are clear from the JSDoc).
4. **Re-measure.** Run the same line-count script from the original skim. The 4 mega-files should be ≤ 500 LoC each, and the total source line count should drop by ~5–10 % as duplication and unused scaffolding fall out.

---

## 8. Priority + sequencing

If you only have time for one refactor, do **#2 (Editor.tsx)** — it has the largest readability win and the fewest cross-cutting concerns. If you have a half-day, do **#1 (useStore slicing)** — it makes everything else easier. **#3 (api/chat.ts)** is the lowest priority; the file is cohesive, just long.

| Order | Refactor | Effort | Risk | Readability win |
|---|---|---|---|---|
| 1 | #2 Editor split | ~6 hours | medium | highest |
| 2 | #1 useStore slice | ~4 hours | medium | high |
| 3 | #4 mention consolidate (option A) | ~3 hours | low | medium |
| 4 | #3 api/chat split | ~2 hours | low | low |
| 5 | #5 index.css audit | ~1 hour | low | low |

Total: ~16 hours of focused work to get the codebase from "1.8k-line file" to "no file > 600 LoC, every file has one concern".
