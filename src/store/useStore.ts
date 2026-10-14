import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { v4 as uuid } from 'uuid';
import type {
  ApiConfig,
  ApiProvider,
  ChatMessage,
  Comment,
  CommentOp,
  CommentRound,
  DocumentRecord,
  MentionToken,
  ProposedEditRationale,
  Prompt,
  Revision,
  Theme,
} from '@/types';
import { getProvider } from '@/config/providers';
import { applyThemeClass } from '@/utils/theme';
import { COMMENT_UNDO_STACK_LIMIT } from '@/utils/comments';
import { findEditAnchor } from '@/utils/proposedEdit';
import {
  DEFAULT_SYSTEM_MESSAGE,
  normalizeRationaleRulesOverride,
  normalizeSystemMessage,
} from '@/api/chat';
import {
  clamp,
  MIN_SIDEBAR_WIDTH,
  MAX_SIDEBAR_WIDTH,
  MIN_CHAT_WIDTH,
  MAX_CHAT_WIDTH,
  MIN_EDITOR_SPLIT_PCT,
  MAX_EDITOR_SPLIT_PCT,
  DEFAULT_EDITOR_SPLIT_PCT,
} from '@/hooks/useDragResize';

const STORAGE_KEY = 'ai-text-editor-mvp';

// Re-export so existing `import { DEFAULT_SYSTEM_MESSAGE } from
// '@/store/useStore'` call sites keep working.
export { DEFAULT_SYSTEM_MESSAGE };

// Resolve the build-time default provider, then derive endpoint/model
// defaults from the matching preset. VITE_DEFAULT_PROVIDER lets a
// hosting environment (e.g. an OpenAI-keyed production deploy) ship
// with a different default than the in-repo "minimax" default.
// `google-ai-mode` is also accepted as a build-time default — the
// settings modal will still need to be opened once so the user
// acknowledges the keyless workflow.
const initialProvider: ApiProvider =
  import.meta.env.VITE_DEFAULT_PROVIDER === 'openai'
    ? 'openai'
    : import.meta.env.VITE_DEFAULT_PROVIDER === 'google-ai-mode'
      ? 'google-ai-mode'
      : 'minimax';
const initialPreset = getProvider(initialProvider);

const defaultApiConfig: ApiConfig = {
  provider: initialProvider,
  apiKey: '',
  apiEndpoint:
    import.meta.env.VITE_DEFAULT_API_ENDPOINT || initialPreset.defaultEndpoint,
  model: import.meta.env.VITE_DEFAULT_MODEL || initialPreset.defaultModel,
  systemMessage: undefined,
  temperature: 0.7,
  // Rationale rules default to undefined so the chat pipeline falls
  // back to the hard-coded `PROPOSED_EDIT_RULES_DEFAULT` in
  // `src/api/chat.ts`. Existing persisted payloads (which never
  // wrote this field) keep the same behaviour.
  rationaleRulesOverride: undefined,
};

const seedPrompts: Prompt[] = [
  {
    id: 'p-rewrite',
    name: 'Improve writing',
    body: 'Rewrite the selected text to be clearer and more concise. Preserve the meaning and tone.',
    createdAt: Date.now(),
  },
  {
    id: 'p-summarize',
    name: 'Summarize',
    body: 'Summarize the selected text in 3-5 bullet points.',
    createdAt: Date.now(),
  },
  {
    id: 'p-eli5',
    name: 'Explain like I\'m 5',
    body: 'Explain the selected text as if speaking to a 5-year-old. Use simple words and a short example.',
    createdAt: Date.now(),
  },
  {
    id: 'p-continuation',
    name: 'Continue writing',
    body: 'Continue the document naturally from where the cursor/selection ends. Match the existing style and voice. Write 2-3 paragraphs.',
    createdAt: Date.now(),
  },
];

function makeDoc(title: string, content = ''): DocumentRecord {
  const now = Date.now();
  return { id: uuid(), title, content, createdAt: now, updatedAt: now };
}

export interface EditorFocusState {
  /** Whether the editor textarea currently has focus for this doc. */
  focused: boolean;
  /**
   * Current textarea caret / selection range for this doc. Both fields
   * are -1 until the user has clicked/typed in the editor at least once.
   */
  selectionStart: number;
  selectionEnd: number;
}

export interface StoreState {
  // Documents
  documents: DocumentRecord[];
  currentDocumentId: string | null;

  // Per-document chat histories, keyed by documentId.
  chats: Record<string, ChatMessage[]>;

  // Revisions keyed by documentId, newest last.
  revisions: Record<string, Revision[]>;

  // Saved prompts (user library).
  prompts: Prompt[];

  // Editor view mode: write (textarea) or preview (rendered markdown).
  viewMode: 'write' | 'preview' | 'split';

  // Editor font size in pixels (applies to both the textarea and the
  // prose preview). Step is 1px; range is [10, 24]. Persisted.
  editorFontSize: number;

  // Global UI font size in pixels. Applied to <html> as the base font
  // size, so every `rem`-based Tailwind text utility (text-xs, text-sm,
  // text-[11px], etc.) scales uniformly. The editor is excluded because
  // its own subtree sets an explicit font-size on its root. Step is 1px;
  // range is [12, 20]. Persisted.
  uiFontSize: number;

  // Whether the chat panel is open.
  chatOpen: boolean;

  // Whether the sidebar is collapsed (hidden but still toggleable via anchor).
  sidebarCollapsed: boolean;

  // Whether the chat panel is collapsed (hidden but still toggleable via anchor).
  // chatCollapsed is a separate flag from chatOpen so we can keep the
  // "floating reopen" behaviour distinct from the deliberate "I want to
  // hide this for the rest of the session" collapse. By default we treat
  // chatOpen === !chatCollapsed, but the user can collapse while open.
  chatCollapsed: boolean;

  // Whether the top bar is collapsed (hidden but still toggleable via anchor).
  topbarCollapsed: boolean;

  // Whether to include the current selection with each chat message.
  includeSelection: boolean;

  // Whether to show developer-style diagnostics in the UI:
  //   - the inline-completion status pill (idle / thinking / ready)
  //     in the editor toolbar, and
  //   - the inline-completion request/accept counters next to it.
  // The underlying inline-completion state machine keeps running
  // even when this flag is off, so toggling it only changes which
  // diagnostic UI is visible — it never pauses or restarts the
  // feature. Defaults to off so the toolbar stays minimal for
  // end users.
  debugMode: boolean;

  // Settings
  theme: Theme;
  api: ApiConfig;

  // Layout sizes (persisted).
  layout: {
    sidebarWidth: number;
    chatWidth: number;
    /** Write-pane width as % of the editor Split row (Preview takes the rest). */
    editorSplitPct: number;
    previewSizes: Record<string, { w: number; h: number }>;
  };

  /**
   * Per-document editor focus + caret state. Updated by `Editor.tsx` on
   * focus / blur / select / keyup so the ProposedEditCard can decide
   * whether the Force-apply path is available. Not persisted.
   */
  editorFocus: Record<string, EditorFocusState>;

  /**
   * Per-document inline comments, keyed by documentId. Each entry is a
   * list ordered by `(start, end)` position in the document — the
   * comment margin re-numbers badges by document order on every render
   * rather than by creation order, so the ordering here is canonical
   * and the comment component sorts before assigning badge numbers.
   *
   * Persisted.
   */
  comments: Record<string, Comment[]>;

  /**
   * Per-session undo stack for comment operations (add / update-body /
   * delete). Capped at `COMMENT_UNDO_STACK_LIMIT` entries —
   * older entries are dropped FIFO. Not persisted (a fresh reload
   * starts with an empty stack by design).
   */
  commentUndoStack: CommentOp[];

  // Actions
  createDocument: (title?: string) => string;
  renameDocument: (id: string, title: string) => void;
  deleteDocument: (id: string) => void;
  setCurrentDocument: (id: string | null) => void;
  updateDocumentContent: (id: string, content: string) => void;

  saveRevision: (documentId: string, label?: string) => void;
  deleteRevision: (documentId: string, revisionId: string) => void;
  restoreRevision: (documentId: string, revisionId: string) => void;

  appendMessage: (documentId: string, msg: ChatMessage) => void;
  updateLastAssistant: (documentId: string, content: string) => void;
  clearChat: (documentId: string) => void;

  addPrompt: (name: string, body: string) => void;
  updatePrompt: (id: string, patch: Partial<Omit<Prompt, 'id'>>) => void;
  deletePrompt: (id: string) => void;

  setViewMode: (mode: StoreState['viewMode']) => void;
  bumpEditorFontSize: (delta: number) => void;
  setUiFontSize: (size: number) => void;
  setChatOpen: (open: boolean) => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  setChatCollapsed: (collapsed: boolean) => void;
  setTopbarCollapsed: (collapsed: boolean) => void;
  setIncludeSelection: (v: boolean) => void;
  setDebugMode: (v: boolean) => void;
  toggleTheme: () => void;
  setApi: (patch: Partial<ApiConfig>) => void;
  setLayout: (
    patch: Partial<{
      sidebarWidth: number;
      chatWidth: number;
      editorSplitPct: number;
    }>
  ) => void;
  setPreviewSize: (
    key: string,
    patch: Partial<{ w: number; h: number }>
  ) => void;
  setEditorFocus: (
    documentId: string,
    info: { focused: boolean; selectionStart: number; selectionEnd: number }
  ) => void;

  // Comment actions. All operate on a single document and never mutate
  // the input `Comment` — each `set(...)` builds a new array so React
  // re-renders fire correctly.
  addComment: (comment: Comment) => void;
  /**
   * Update the latest round's body. Optional `mentions` replaces the
   * round's @-document references (used when the user re-edits a
   * comment via the popover's MentionInput). When omitted, existing
   * mentions on the round are preserved.
   */
  updateCommentBody: (
    id: string,
    body: string,
    mentions?: MentionToken[]
  ) => void;
  /**
   * Append a new round to an existing comment. Used when the user
   * adds a follow-up body on a revised passage (after an AI edit
   * was applied), or when the system needs to push a new round
   * for any reason. The new round is added at the end of
   * `rounds[]`; the top-level `body` / `start` / `end` / `snippet`
   * / `outdated` / `sent` convenience mirrors are updated to point
   * at the new round.
   */
  appendCommentRound: (id: string, round: Omit<CommentRound, 'id' | 'applied'>) => void;
  /**
   * Record an adopted proposed edit against the comment whose
   * current round was the one the AI was responding to. The
   * `commentId` is resolved inside the action via anchor/sent-round
   * lookup, so the caller can pass either an explicit id OR leave
   * it undefined and let the action find the matching comment
   * from the most recent batch. Returns the resolved comment id,
   * or `null` if no match was found.
   */
  recordAppliedEdit: (info: {
    documentId: string;
    /** Explicit comment id, if the caller already knows it. */
    commentId?: string;
    messageId: string;
    editId: string;
    summary: string;
    rationale: string;
    original: string;
    replacement: string;
    appliedAt: number;
    /**
     * Explicit new anchor range for the adopted edit, when the
     * caller has computed it (e.g. `applyEdit` returns the match
     * position). When omitted, the store re-anchors the comment
     * by searching the *post-apply* document content for the
     * `replacement` text. Set this from `applyAllEdits` so each
     * per-edit anchor is exact.
     */
    newAnchor?: { start: number; end: number };
  }) => string | null;
  markCommentsSent: (ids: string[]) => void;
  deleteComment: (id: string) => void;
  replaceCommentsForDocument: (documentId: string, comments: Comment[]) => void;
  undoLastCommentOp: () => CommentOp | null;
}

const initialDocs: DocumentRecord[] = [
  makeDoc(
    'Welcome',
    `# 👋 Welcome to ApEditor

A local-first AI markdown editor. Everything you write stays in your
browser.

## 1. 🔑 Connect an AI

**Open Settings (gear, top right) and paste your API key.** That's
the only setup. Or choose **Google AI Mode (no key)** in Settings if
you prefer opening Google AI Mode in a new tab instead. The chat
panel on the right can then answer questions and rewrite passages.

## 2. ❓ Open Help anytime

**Click ? in the top bar** (or press \`⌘/Ctrl + /\`) for the full
user guide. Help uses the same Light / Dark theme as the app.

## 3. ✍️ Just write

**Type in Write.** Markdown renders live in Preview. Use the editor
view dropdown to switch **Write**, **Preview**, or **Split**.

## 4. 💬 Comment on a passage

**Select text → click Comment in the editor toolbar → write your
note.** A highlight and a numbered margin badge mark the passage.
Open a badge to **Edit** or **Delete** any comment (including after
send). When ready, click **Send to AI** under the editor to send the
article plus every comment as one batch. \`⌘/Ctrl + Z\` undoes the
last comment change. Comments that can no longer be found show as
**Outdated**.

## 5. @ Reference another document

**Type @ in Chat, a comment, or rejection feedback.** Pick another
document, then **Whole document** or tick headings and **Use
selection**. A chip (and often a § caption) shows what you attached.
You need at least two documents in the sidebar.

## 6. 💾 Save a snapshot

**Click Save in the editor toolbar** when you like a draft. Open
**Revision history** (clock, top bar) later to diff and restore
(\`⌘/Ctrl + h\`).

## 7. 📚 Use a saved prompt

**Open Prompt library** (bookmark, top bar) or press \`⌘/Ctrl + ,\`.
Click any prompt to drop it into the chat input, or write your own
and ask the AI to rewrite / shorten / expand the selection. Check
**include selection** in the chat panel when you want the selected
text sent with your message.

## 8. ✅ Apply or Reject AI edits

**AI rewrites show up as cards** with a rationale. Click **Apply** or
**Reject** on each one. For several changes in one reply, use
**Apply N changes** in the chat footer. After Apply, open the comment
badge to read the rationale (multi-round history if you follow up).
If a quote no longer matches the document, click in the editor and
use **Force-apply…**.

## 9. ✨ Get sentence suggestions while writing

**Predict starts off.** Click **Predict** (or \`⌘/Ctrl + \\\`) to turn
it on and request a suggestion. Press \`Tab\` or **Accept** to insert,
\`Esc\` or **Reject** to dismiss.

## 10. 📷 Import text from photos or PDFs

**Click Import text from photos or PDFs in the editor toolbar.** Pick
an image or a PDF. Recognition stays in the browser; the extracted
text is rewritten as readable Markdown by your configured model
before it is inserted at your caret.`
  ),
  makeDoc(
    'Ideas',
    `# Ideas\n\n- A short story about a lighthouse keeper who hears the sea speak.\n- A field guide to imaginary birds.\n- An essay on why we read in the bath.\n`
  ),
];

export const useStore = create<StoreState>()(
  persist(
    (set) => ({
      documents: initialDocs,
      currentDocumentId: initialDocs[0].id,
      chats: {},
      revisions: {},
      prompts: seedPrompts,
      viewMode: 'split',
      editorFontSize: 14,
      uiFontSize: 14,
      chatOpen: true,
      sidebarCollapsed: false,
      chatCollapsed: false,
      topbarCollapsed: false,
      includeSelection: true,
      debugMode: false,
      theme: 'light',
      api: defaultApiConfig,
      layout: {
        sidebarWidth: 240,
        chatWidth: 384,
        editorSplitPct: DEFAULT_EDITOR_SPLIT_PCT,
        previewSizes: {},
      },
      editorFocus: {},
      comments: {},
      commentUndoStack: [],

      createDocument: (title) => {
        const doc = makeDoc(title?.trim() || 'Untitled');
        set((s) => ({
          documents: [doc, ...s.documents],
          currentDocumentId: doc.id,
        }));
        return doc.id;
      },
      renameDocument: (id, title) =>
        set((s) => ({
          documents: s.documents.map((d) =>
            d.id === id ? { ...d, title: title.trim() || 'Untitled' } : d
          ),
        })),
      deleteDocument: (id) =>
        set((s) => {
          const docs = s.documents.filter((d) => d.id !== id);
          const chats = { ...s.chats };
          delete chats[id];
          const revisions = { ...s.revisions };
          delete revisions[id];
          const comments = { ...s.comments };
          delete comments[id];
          return {
            documents: docs,
            chats,
            revisions,
            comments,
            currentDocumentId:
              s.currentDocumentId === id
                ? docs[0]?.id ?? null
                : s.currentDocumentId,
          };
        }),
      setCurrentDocument: (id) => set({ currentDocumentId: id }),
      updateDocumentContent: (id, content) =>
        set((s) => ({
          documents: s.documents.map((d) =>
            d.id === id ? { ...d, content, updatedAt: Date.now() } : d
          ),
        })),

      saveRevision: (documentId, label) =>
        set((s) => {
          const doc = s.documents.find((d) => d.id === documentId);
          if (!doc) return s;
          const rev: Revision = {
            id: uuid(),
            documentId,
            content: doc.content,
            createdAt: Date.now(),
            label,
          };
          const existing = s.revisions[documentId] ?? [];
          return {
            revisions: { ...s.revisions, [documentId]: [...existing, rev] },
          };
        }),
      deleteRevision: (documentId, revisionId) =>
        set((s) => {
          const existing = s.revisions[documentId] ?? [];
          return {
            revisions: {
              ...s.revisions,
              [documentId]: existing.filter((r) => r.id !== revisionId),
            },
          };
        }),
      restoreRevision: (documentId, revisionId) =>
        set((s) => {
          const rev = (s.revisions[documentId] ?? []).find(
            (r) => r.id === revisionId
          );
          if (!rev) return s;
          return {
            documents: s.documents.map((d) =>
              d.id === documentId
                ? { ...d, content: rev.content, updatedAt: Date.now() }
                : d
            ),
          };
        }),

      appendMessage: (documentId, msg) =>
        set((s) => {
          const existing = s.chats[documentId] ?? [];
          return { chats: { ...s.chats, [documentId]: [...existing, msg] } };
        }),
      updateLastAssistant: (documentId, content) =>
        set((s) => {
          const existing = s.chats[documentId] ?? [];
          if (existing.length === 0) return s;
          const updated = existing.slice();
          for (let i = updated.length - 1; i >= 0; i--) {
            if (updated[i].role === 'assistant') {
              updated[i] = { ...updated[i], content };
              break;
            }
          }
          return { chats: { ...s.chats, [documentId]: updated } };
        }),
      clearChat: (documentId) =>
        set((s) => {
          const chats = { ...s.chats };
          chats[documentId] = [];
          return { chats };
        }),

      addPrompt: (name, body) =>
        set((s) => ({
          prompts: [
            { id: uuid(), name: name.trim() || 'Untitled prompt', body, createdAt: Date.now() },
            ...s.prompts,
          ],
        })),
      updatePrompt: (id, patch) =>
        set((s) => ({
          prompts: s.prompts.map((p) => (p.id === id ? { ...p, ...patch } : p)),
        })),
      deletePrompt: (id) =>
        set((s) => ({ prompts: s.prompts.filter((p) => p.id !== id) })),

      setViewMode: (viewMode) => set({ viewMode }),
      bumpEditorFontSize: (delta) =>
        set((s) => ({
          editorFontSize: clamp(s.editorFontSize + delta, 10, 24),
        })),
      setUiFontSize: (size) => set({ uiFontSize: clamp(size, 12, 20) }),
      setChatOpen: (chatOpen) => set({ chatOpen }),
      setSidebarCollapsed: (sidebarCollapsed) => set({ sidebarCollapsed }),
      setChatCollapsed: (chatCollapsed) => set({ chatCollapsed }),
      setTopbarCollapsed: (topbarCollapsed) => set({ topbarCollapsed }),
      setIncludeSelection: (includeSelection) => set({ includeSelection }),
      setDebugMode: (debugMode) => set({ debugMode }),
      toggleTheme: () =>
        set((s) => {
          const next: Theme = s.theme === 'light' ? 'dark' : 'light';
          applyThemeClass(next);
          return { theme: next };
        }),
      setApi: (patch) => set((s) => ({ api: { ...s.api, ...patch } })),
      setLayout: (patch) =>
        set((s) => ({ layout: { ...s.layout, ...patch } })),
      setPreviewSize: (key, patch) =>
        set((s) => ({
          layout: {
            ...s.layout,
            previewSizes: {
              ...s.layout.previewSizes,
              [key]: { ...s.layout.previewSizes[key], ...patch },
            },
          },
        })),
      setEditorFocus: (documentId, info) =>
        set((s) => ({
          editorFocus: {
            ...s.editorFocus,
            [documentId]: {
              focused: info.focused,
              selectionStart: info.selectionStart,
              selectionEnd: info.selectionEnd,
            },
          },
        })),

      // ---- Comment actions ----
      //
      // Every action does the same shape: build a new `comments` slice
      // for the affected documentId, push a `CommentOp` onto the undo
      // stack (capped), and never mutate the input `Comment`. The
      // editor component handles its own re-anchor pass on doc edits
      // via `replaceCommentsForDocument` so this slice is the single
      // source of truth for the comment UI.
      addComment: (comment) =>
        set((s) => {
          const existing = s.comments[comment.documentId] ?? [];
          // Defensive: if a comment was built without a `rounds` array
          // (e.g. an older caller), seed round 1 from the flat fields.
          const seeded = ensureRoundsShape(comment);
          return {
            comments: {
              ...s.comments,
              [comment.documentId]: [...existing, seeded],
            },
            commentUndoStack: pushUndoOp(s.commentUndoStack, {
              kind: 'add',
              comment: seeded,
            }),
          };
        }),
      updateCommentBody: (id, body, mentions) =>
        set((s) => {
          const entry = findCommentEntry(s.comments, id);
          if (!entry) return s;
          const comment = ensureRoundsShape(entry.comment);
          const lastIdx = comment.rounds.length - 1;
          const lastRound = comment.rounds[lastIdx];
          const now = Date.now();
          // When the caller supplies `mentions`, use that list; when
          // omitted, preserve whatever the prior round already had
          // (older callers / body-only edits).
          const nextMentions: MentionToken[] | undefined =
            mentions !== undefined
              ? mentions.length > 0
                ? mentions
                : undefined
              : lastRound.mentions && lastRound.mentions.length > 0
                ? lastRound.mentions
                : undefined;
          const priorIds = (lastRound.mentions ?? []).map((m) => m.id).join(',');
          const nextIds = (nextMentions ?? []).map((m) => m.id).join(',');
          // If the latest round was already sent to the AI, a body
          // edit is a NEW round (follow-up), not an in-place rewrite.
          // Overwriting would erase the prior round's comment body
          // from history and leave applied rationales orphaned under
          // the wrong round — which is why the popover only showed
          // "Round 1" after a second Send.
          if (lastRound.sent) {
            if (body.trim() === lastRound.body.trim() && priorIds === nextIds) {
              return s;
            }
            const newRound: CommentRound = {
              id: uuid(),
              start: lastRound.start,
              end: lastRound.end,
              snippet: lastRound.snippet,
              body,
              createdAt: now,
              updatedAt: now,
              outdated: lastRound.outdated,
              sent: false,
              applied: [],
              ...(nextMentions ? { mentions: nextMentions } : {}),
            };
            const next: Comment = {
              ...comment,
              start: newRound.start,
              end: newRound.end,
              snippet: newRound.snippet,
              body: newRound.body,
              updatedAt: now,
              outdated: newRound.outdated,
              sent: false,
              rounds: [...comment.rounds, newRound],
            };
            return {
              comments: replaceComment(s.comments, id, next),
              commentUndoStack: pushUndoOp(s.commentUndoStack, {
                kind: 'append-round',
                before: comment,
                after: next,
              }),
            };
          }
          const updatedRound: CommentRound = {
            ...lastRound,
            body,
            updatedAt: now,
          };
          if (nextMentions) {
            updatedRound.mentions = nextMentions;
          } else {
            delete updatedRound.mentions;
          }
          const next: Comment = {
            ...comment,
            body,
            updatedAt: updatedRound.updatedAt,
            rounds: [
              ...comment.rounds.slice(0, lastIdx),
              updatedRound,
            ],
          };
          return {
            comments: replaceComment(s.comments, id, next),
            commentUndoStack: pushUndoOp(s.commentUndoStack, {
              kind: 'update-body',
              before: comment,
              after: next,
            }),
          };
        }),
      appendCommentRound: (id, round) =>
        set((s) => {
          const entry = findCommentEntry(s.comments, id);
          if (!entry) return s;
          const comment = ensureRoundsShape(entry.comment);
          const newRound: CommentRound = {
            ...round,
            id: uuid(),
            applied: [],
          };
          const next: Comment = {
            ...comment,
            start: newRound.start,
            end: newRound.end,
            snippet: newRound.snippet,
            body: newRound.body,
            createdAt: comment.rounds[0]?.createdAt ?? newRound.createdAt,
            updatedAt: newRound.updatedAt,
            outdated: newRound.outdated,
            sent: newRound.sent,
            rounds: [...comment.rounds, newRound],
          };
          return {
            comments: replaceComment(s.comments, id, next),
            commentUndoStack: pushUndoOp(s.commentUndoStack, {
              kind: 'append-round',
              before: comment,
              after: next,
            }),
          };
        }),
      recordAppliedEdit: (info) => {
        // Resolve the comment to attach this rationale to. The caller
        // can pass an explicit `commentId` (the ProposedEditCard and
        // ChatPanel Apply-All paths know which comment they're in).
        // If `commentId` is missing, we look up the matching comment
        // by walking the document's comments and finding the one
        // whose latest-sent round has a snippet that overlaps the
        // edit's `original`.
        let resolvedId: string | null = null;
        set((s) => {
          const docComments = s.comments[info.documentId] ?? [];
          let target: Comment | undefined;
          if (info.commentId) {
            target = docComments.find((c) => c.id === info.commentId);
          } else {
            target = findCommentForEdit(docComments, info);
          }
          if (!target) return s;
          resolvedId = target.id;
          const comment = ensureRoundsShape(target);
          const lastIdx = comment.rounds.length - 1;
          const lastRound = comment.rounds[lastIdx];
          // Don't double-record the same (editId, roundId) pair.
          if (lastRound.applied.some((a) => a.editId === info.editId)) {
            return s;
          }
          const rationale: ProposedEditRationale = {
            messageId: info.messageId,
            editId: info.editId,
            summary: info.summary,
            rationale: info.rationale ?? '',
            original: info.original,
            replacement: info.replacement,
            appliedAt: info.appliedAt,
          };
          // ---- Re-anchor the round to the ADOPTED text ----
          //
          // The original `original` snippet no longer exists in the
          // document after Apply. If we leave the round pointing at
          // the original's `(start, end)`, the next `reanchorAll`
          // pass uses strategy 2-4 (local search, fuzzy match,
          // first/last 30 chars) to relocate the comment — and any
          // of those can match a much LONGER span than the user
          // actually adopted, producing a highlight that swallows
          // the surrounding paragraph.
          //
          // Instead, we anchor the round to the new `replacement`
          // range inside the now-updated document. Three sources
          // of truth, in priority order:
          //
          //  1. Explicit `info.newAnchor` from the caller (the
          //     Apply-All path passes the exact anchor returned by
          //     `applyAllEdits`).
          //  2. Search the post-apply document content for the
          //     `replacement` text. The Apply path uses this.
          //  3. Fall back to the round's existing anchor unchanged
          //     (e.g. when the replacement is empty and a search
          //     would fail).
          const liveDoc = s.documents.find((d) => d.id === info.documentId);
          const liveContent = liveDoc?.content ?? '';
          let newStart: number | null = null;
          let newEnd: number | null = null;
          let newSnippet: string | null = null;
          if (info.newAnchor && info.replacement) {
            const { start, end } = info.newAnchor;
            const slice = liveContent.slice(start, end);
            if (slice === info.replacement) {
              newStart = start;
              newEnd = end;
              // Prefer the authoritative replacement string so the
              // next reanchorAll pass matches the adopted text
              // byte-for-byte (not a stale slice of the old original).
              newSnippet = info.replacement;
            } else {
              // Explicit idx drifted (e.g. concurrent apply) — rescue
              // by locating the replacement near the claimed start,
              // then anywhere in the doc.
              const near = liveContent.indexOf(
                info.replacement,
                Math.max(0, start - 200)
              );
              const idx =
                near !== -1
                  ? near
                  : liveContent.indexOf(info.replacement);
              if (idx !== -1) {
                newStart = idx;
                newEnd = idx + info.replacement.length;
                newSnippet = info.replacement;
              }
            }
          } else if (liveContent && info.replacement) {
            const rep = findEditAnchor(liveContent, info.replacement);
            if (rep) {
              newStart = rep.idx;
              newEnd = rep.idx + rep.length;
              newSnippet = info.replacement;
            }
          }
          const updatedRound: CommentRound = {
            ...lastRound,
            applied: [...lastRound.applied, rationale],
            // Re-anchor only when we found a valid replacement
            // range. Skipping the rewrite on failure preserves the
            // existing anchor so the next `reanchorAll` pass can
            // still attempt recovery.
            ...(newStart !== null && newEnd !== null && newSnippet !== null
              ? {
                  start: newStart,
                  end: newEnd,
                  snippet: newSnippet,
                }
              : {}),
          };
          // Mirror the latest round's anchor to the top-level
          // convenience fields so existing call-sites (margin
          // badges, re-anchoring on doc edits) read the new
          // position.
          const nextComment: Comment = {
            ...comment,
            start: updatedRound.start,
            end: updatedRound.end,
            snippet: updatedRound.snippet,
            updatedAt: Date.now(),
            rounds: [
              ...comment.rounds.slice(0, lastIdx),
              updatedRound,
            ],
          };
          return {
            comments: replaceComment(s.comments, target.id, nextComment),
            commentUndoStack: pushUndoOp(s.commentUndoStack, {
              kind: 'record-applied',
              before: comment,
              after: nextComment,
              roundId: lastRound.id,
              editId: info.editId,
            }),
          };
        });
        return resolvedId;
      },
      markCommentsSent: (ids) =>
        set((s) => {
          if (ids.length === 0) return s;
          const idSet = new Set(ids);
          let changed = false;
          const next: Record<string, Comment[]> = { ...s.comments };
          for (const [docId, list] of Object.entries(next)) {
            let docChanged = false;
            const updated = list.map((c) => {
              if (!idSet.has(c.id)) return c;
              const marked = markLatestRoundSent(c);
              if (marked !== c) {
                docChanged = true;
                changed = true;
              }
              return marked;
            });
            if (docChanged) next[docId] = updated;
          }
          if (!changed) return s;
          return { comments: next };
        }),
      deleteComment: (id) =>
        set((s) => {
          const entry = findCommentEntry(s.comments, id);
          if (!entry) return s;
          // Sent comments remain deletable.
          const docComments = (s.comments[entry.comment.documentId] ?? []).filter(
            (c) => c.id !== id
          );
          return {
            comments: {
              ...s.comments,
              [entry.comment.documentId]: docComments,
            },
            commentUndoStack: pushUndoOp(s.commentUndoStack, {
              kind: 'delete',
              comment: entry.comment,
            }),
          };
        }),
      replaceCommentsForDocument: (documentId, next) =>
        set((s) => ({
          comments: { ...s.comments, [documentId]: next },
        })),
      undoLastCommentOp: () => {
        // Read the current stack snapshot from inside `set` so we can
        // return the popped op to the caller without referencing
        // `useStore` directly (which is still being initialized at the
        // point this closure is defined and would cause a recursive
        // type error).
        let popped: CommentOp | null = null;
        set((s) => {
          const stack = s.commentUndoStack;
          if (stack.length === 0) return s;
          const op = stack[stack.length - 1];
          popped = op;
          const rest = stack.slice(0, -1);
          switch (op.kind) {
            case 'add': {
              // Inverse: remove the added comment.
              const docComments = (
                s.comments[op.comment.documentId] ?? []
              ).filter((c: Comment) => c.id !== op.comment.id);
              return {
                comments: {
                  ...s.comments,
                  [op.comment.documentId]: docComments,
                },
                commentUndoStack: rest,
              };
            }
            case 'delete': {
              // Inverse: re-add the deleted comment. The UI sorts by
              // document position, so appending is good enough for
              // undo to look correct.
              const docComments = s.comments[op.comment.documentId] ?? [];
              return {
                comments: {
                  ...s.comments,
                  [op.comment.documentId]: [...docComments, op.comment],
                },
                commentUndoStack: rest,
              };
            }
            case 'update-body': {
              // Inverse: restore the `before` comment.
              return {
                comments: replaceComment(s.comments, op.before.id, op.before),
                commentUndoStack: rest,
              };
            }
            case 'append-round': {
              // Inverse: restore the `before` comment (drops the
              // newly-appended round).
              return {
                comments: replaceComment(s.comments, op.before.id, op.before),
                commentUndoStack: rest,
              };
            }
            case 'record-applied': {
              // Inverse: restore the `before` comment (drops the
              // rationale entry that was appended to the round).
              return {
                comments: replaceComment(s.comments, op.before.id, op.before),
                commentUndoStack: rest,
              };
            }
          }
        });
        return popped;
      },
    }),
    {
      name: STORAGE_KEY,
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({
        documents: s.documents,
        currentDocumentId: s.currentDocumentId,
        chats: s.chats,
        revisions: s.revisions,
        prompts: s.prompts,
        viewMode: s.viewMode,
        editorFontSize: s.editorFontSize,
        uiFontSize: s.uiFontSize,
        chatOpen: s.chatOpen,
        sidebarCollapsed: s.sidebarCollapsed,
        chatCollapsed: s.chatCollapsed,
        topbarCollapsed: s.topbarCollapsed,
        includeSelection: s.includeSelection,
        debugMode: s.debugMode,
        theme: s.theme,
        api: s.api,
        layout: s.layout,
        comments: s.comments,
        // commentUndoStack is intentionally NOT persisted — see the
        // StoreState interface comment.
      }),
      onRehydrateStorage: () => (state) => {
        if (state?.theme) {
          applyThemeClass(state.theme);
        }
        // Note: the `state` argument here is the loaded snapshot
        // (already merged into the live store by zustand). Mutating
        // nested fields on it does NOT propagate to the live store,
        // so every migration below queues a `set((s) => …)` patch
        // that zustand applies after this callback returns. The
        // snapshot is left alone — we only inspect it.
        if (state) {
          const sw = state.layout?.sidebarWidth;
          const cw = state.layout?.chatWidth;
          const esp = state.layout?.editorSplitPct;
          const api0 = state.api;
          const repairs: Partial<StoreState> = {};
          const layoutPatch: Record<string, unknown> = {};
          if (typeof sw === 'number' && (sw < MIN_SIDEBAR_WIDTH || sw > MAX_SIDEBAR_WIDTH)) {
            layoutPatch.sidebarWidth = clamp(sw, MIN_SIDEBAR_WIDTH, MAX_SIDEBAR_WIDTH);
          }
          if (typeof cw === 'number' && (cw < MIN_CHAT_WIDTH || cw > MAX_CHAT_WIDTH)) {
            layoutPatch.chatWidth = clamp(cw, MIN_CHAT_WIDTH, MAX_CHAT_WIDTH);
          }
          if (typeof esp !== 'number' || Number.isNaN(esp)) {
            layoutPatch.editorSplitPct = DEFAULT_EDITOR_SPLIT_PCT;
          } else if (
            esp < MIN_EDITOR_SPLIT_PCT ||
            esp > MAX_EDITOR_SPLIT_PCT
          ) {
            layoutPatch.editorSplitPct = clamp(
              esp,
              MIN_EDITOR_SPLIT_PCT,
              MAX_EDITOR_SPLIT_PCT
            );
          }
          if (Object.keys(layoutPatch).length > 0) {
            repairs.layout = { ...state.layout, ...layoutPatch } as StoreState['layout'];
          }
          // ApiConfig migrations. Build a new `api` object when any
          // field needs to change so React subscribers see the
          // reference change and Settings re-renders.
          if (api0 && typeof api0 === 'object') {
            const apiPatch: Partial<ApiConfig> = {};
            if (!('provider' in api0)) {
              apiPatch.provider = 'minimax';
            }
            const prevRationale = api0.rationaleRulesOverride;
            const normalizedRationale = normalizeRationaleRulesOverride(prevRationale);
            if (normalizedRationale !== prevRationale) {
              apiPatch.rationaleRulesOverride = normalizedRationale;
            }
            const prevSystem = api0.systemMessage;
            const normalizedSystem = normalizeSystemMessage(prevSystem);
            if (normalizedSystem !== prevSystem) {
              apiPatch.systemMessage = normalizedSystem;
            }
            if (Object.keys(apiPatch).length > 0) {
              repairs.api = { ...api0, ...apiPatch } as ApiConfig;
            }
          }
          if (Object.keys(repairs).length > 0) {
            // Defer to a microtask so we are outside the persist
            // rehydration call stack. `set` is the zustand store
            // setter; we re-read it from the closure.
            queueMicrotask(() => {
              try {
                useStore.setState(repairs);
              } catch {
                /* store not initialized yet; subsequent renders will
                   surface the inconsistency */
              }
            });
          }
          // Migration for v0.4.0: older payloads predate the
          // `comments` slice. Default to `{}` so the editor never has
          // to special-case `undefined`. Any comment with missing
          // fields is also normalized defensively.
          //
          // Migration for v0.4.x+ (rounds / rationale revamp): older
          // comments are stored in the FLAT shape (no `rounds`
          // array). Wrap each one in a single CommentRound seeded
          // from the existing flat fields so existing users keep
          // their comment history with no visible loss.
          let commentsPatch: Record<string, Comment[]> | null = null;
          if (typeof state.comments !== 'object' || state.comments === null) {
            commentsPatch = {};
          } else {
            const base: Record<string, Comment[]> = {
              ...(state.comments as Record<string, Comment[]>),
            };
            for (const [docId, list] of Object.entries(base)) {
              if (!Array.isArray(list)) {
                delete base[docId];
                commentsPatch = base;
                continue;
              }
              let changed = false;
              const normalized = list.map((c) => {
                const wrapped = ensureRoundsShape(c as Comment);
                if (wrapped !== c) changed = true;
                return wrapped;
              });
              if (changed) {
                base[docId] = normalized;
                commentsPatch = base;
              }
            }
          }
          if (commentsPatch) repairs.comments = commentsPatch;
          // Migration for the `google-ai-mode` provider: any persisted
          // value not in the closed union (corrupted localStorage, a
          // typo from a future build, an experimental id we later
          // removed) is coerced back to the safe default. This keeps
          // the Settings dropdown and the chat panel from crashing on
          // an unknown provider id.
          if (
            state.api &&
            typeof state.api === 'object' &&
            'provider' in state.api &&
            (state.api as ApiConfig).provider !== 'minimax' &&
            (state.api as ApiConfig).provider !== 'openai' &&
            (state.api as ApiConfig).provider !== 'google-ai-mode'
          ) {
            repairs.api = {
              ...(repairs.api ?? (state.api as ApiConfig)),
              provider: 'minimax',
            };
          }
          // Migration for Debug Mode: older payloads predate the
          // `debugMode` field. Default to off so the toolbar stays
          // minimal for users upgrading from earlier versions.
          if (typeof state.debugMode !== 'boolean') {
            repairs.debugMode = false;
          }
          // Migration for UI font size: older payloads predate the
          // `uiFontSize` field. Default to 14px (the implicit body
          // size before this setting existed) and clamp any out-of-
          // range value persisted by a future build.
          if (typeof state.uiFontSize !== 'number') {
            repairs.uiFontSize = 14;
          } else if (state.uiFontSize < 12 || state.uiFontSize > 20) {
            repairs.uiFontSize = clamp(state.uiFontSize, 12, 20);
          }
        }
      },
    }
  )
);

// Helper to read the current document.
export function useCurrentDocument(): DocumentRecord | null {
  return useStore((s) =>
    s.documents.find((d) => d.id === s.currentDocumentId) ?? null
  );
}

// ---- Internal helpers for the comment actions ----

/**
 * Append a `CommentOp` to the undo stack, capping the stack at
 * `COMMENT_UNDO_STACK_LIMIT` by dropping the oldest entries first.
 */
function pushUndoOp(stack: CommentOp[], op: CommentOp): CommentOp[] {
  const next = [...stack, op];
  if (next.length <= COMMENT_UNDO_STACK_LIMIT) return next;
  return next.slice(next.length - COMMENT_UNDO_STACK_LIMIT);
}

/**
 * Locate a comment by id across all documents. Returns `{ documentId,
 * comment }` so the caller can route the change back to the right slice.
 */
function findCommentEntry(
  comments: Record<string, Comment[]>,
  id: string
): { documentId: string; comment: Comment } | null {
  for (const [documentId, list] of Object.entries(comments)) {
    const found = list.find((c) => c.id === id);
    if (found) return { documentId, comment: found };
  }
  return null;
}

/**
 * Build a new comments slice with the comment identified by `id`
 * replaced by `next`. Returns the original slice unchanged when no
 * comment with that id exists (caller is expected to have guarded).
 */
function replaceComment(
  comments: Record<string, Comment[]>,
  id: string,
  next: Comment
): Record<string, Comment[]> {
  const out: Record<string, Comment[]> = {};
  for (const [documentId, list] of Object.entries(comments)) {
    let touched = false;
    const updated = list.map((c) => {
      if (c.id !== id) return c;
      touched = true;
      return next;
    });
    out[documentId] = touched ? updated : list;
  }
  return out;
}

/**
 * Ensure a `Comment` carries a `rounds[]` array, and that the
 * top-level convenience fields mirror the latest round.
 *
 * Used as a defensive guard at every read/write boundary so a
 * partially-constructed comment (built by an older caller, or
 * migrated from an older persisted payload) is upgraded to the
 * nested shape on the fly. Returns the input unchanged when it's
 * already in shape (the common case).
 */
function ensureRoundsShape(c: Comment): Comment {
  if (Array.isArray(c.rounds) && c.rounds.length > 0) {
    return c;
  }
  // Build a single round from the flat fields. We never see a
  // comment with both `rounds` and flat fields out of sync in
  // practice, but we still copy them defensively so the
  // convenience mirrors stay accurate after the wrap.
  const fallback: CommentRound = {
    id: uuid(),
    start: typeof c.start === 'number' ? c.start : 0,
    end: typeof c.end === 'number' ? c.end : 0,
    snippet: typeof c.snippet === 'string' ? c.snippet : '',
    body: typeof c.body === 'string' ? c.body : '',
    createdAt: typeof c.createdAt === 'number' ? c.createdAt : Date.now(),
    updatedAt: typeof c.updatedAt === 'number' ? c.updatedAt : Date.now(),
    outdated: !!c.outdated,
    sent: !!c.sent,
    applied: [],
  };
  return {
    id: c.id,
    documentId: c.documentId,
    start: fallback.start,
    end: fallback.end,
    snippet: fallback.snippet,
    body: fallback.body,
    createdAt: fallback.createdAt,
    updatedAt: fallback.updatedAt,
    outdated: fallback.outdated,
    sent: fallback.sent,
    rounds: [fallback],
  };
}

/**
 * Return a new comment with its latest round's `sent` flag flipped
 * to `true`, and the top-level convenience `sent` mirror updated to
 * match. Used by `markCommentsSent` so the flag follows the most
 * recent round, not just the first one (which would be the only
 * round under the old flat shape).
 */
function markLatestRoundSent(c: Comment): Comment {
  const comment = ensureRoundsShape(c);
  const lastIdx = comment.rounds.length - 1;
  const lastRound = comment.rounds[lastIdx];
  // Only the latest round matters. Earlier rounds may already be
  // sent; a follow-up round starts with sent:false and must be
  // flippable on the next "Send to AI".
  if (lastRound.sent && comment.sent) return comment;
  const updatedRound: CommentRound = { ...lastRound, sent: true };
  return {
    ...comment,
    sent: true,
    rounds: [
      ...comment.rounds.slice(0, lastIdx),
      updatedRound,
    ],
  };
}

/**
 * Pick the comment whose current (latest) sent round most likely
 * produced the proposed edit at hand. Used by `recordAppliedEdit`
 * when the caller didn't already know which comment to attach the
 * rationale to (i.e. the bulk Apply-All path).
 *
 * Heuristic: rank candidates by the overlap between the proposed
 * edit's `original` and the round's `snippet`. A round whose snippet
 * shares at least 12 characters of overlap with the edit's
 * `original` is considered a match. We pick the candidate with the
 * largest overlap so the most specific round wins ties.
 */
function findCommentForEdit(
  comments: Comment[],
  info: {
    original: string;
    messageId: string;
    editId: string;
  }
): Comment | undefined {
  let best: { comment: Comment; score: number } | null = null;
  for (const raw of comments) {
    const c = ensureRoundsShape(raw);
    const lastRound = c.rounds[c.rounds.length - 1];
    if (!lastRound.sent) continue;
    const score = snippetOverlapScore(lastRound.snippet, info.original);
    if (score <= 0) continue;
    if (!best || score > best.score) {
      best = { comment: c, score };
    }
  }
  return best?.comment;
}

/**
 * Cheap overlap score between two strings. Returns 0 when there's
 * no meaningful overlap, otherwise the length of the longest
 * common substring (capped at 12 to keep this O(n) in practice on
 * realistic snippets).
 */
function snippetOverlapScore(a: string, b: string): number {
  if (!a || !b) return 0;
  const lo = a.length < b.length ? a : b;
  const hi = a.length < b.length ? b : a;
  // Quick rejection: if there's no shared character at all, the
  // overlap is 0.
  let best = 0;
  // Sliding window over the shorter string, checking for a match
  // in the longer one. The window size is capped at min(lo.length,
  // 24) so the inner loop is O(n * 24).
  const cap = Math.min(lo.length, 24);
  outer: for (let len = cap; len >= 12; len--) {
    for (let i = 0; i + len <= lo.length; i++) {
      if (hi.indexOf(lo.slice(i, i + len)) !== -1) {
        best = len;
        break outer;
      }
    }
  }
  return best;
}
