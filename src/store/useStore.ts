import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { v4 as uuid } from 'uuid';
import type {
  ApiConfig,
  ApiProvider,
  ChatMessage,
  Comment,
  CommentOp,
  DocumentRecord,
  Prompt,
  Revision,
  Theme,
} from '@/types';
import { getProvider } from '@/config/providers';
import { applyThemeClass } from '@/utils/theme';
import { COMMENT_UNDO_STACK_LIMIT } from '@/utils/comments';
import {
  clamp,
  MIN_SIDEBAR_WIDTH,
  MAX_SIDEBAR_WIDTH,
  MIN_CHAT_WIDTH,
  MAX_CHAT_WIDTH,
} from '@/hooks/useDragResize';

const STORAGE_KEY = 'ai-text-editor-mvp';

const DEFAULT_SYSTEM_MESSAGE =
  "You are a helpful writing assistant. Be concise, specific, and preserve " +
  "the user's voice when revising. Unless specified, please provide your " +
  "output paragraph by paragraph using the Proposed Edit Card: emit one " +
  "proposed-edit fenced block per paragraph so the user can accept or " +
  "reject each one independently, all within a single reply message.";

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
  systemMessage: DEFAULT_SYSTEM_MESSAGE,
  temperature: 0.7,
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
  updateCommentBody: (id: string, body: string) => void;
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

## 2. ✍️ Just write

**Type in Write.** Markdown renders live in Preview. Use the editor
view dropdown to switch **Write**, **Preview**, or **Split**.

## 3. 💬 Comment on a passage

**Select text → click Comment in the editor toolbar → write your
note.** A highlight and a numbered margin badge mark the passage.
Open a badge to **Edit** or **Delete** any comment (including after
send). When ready, click **Send to AI** under the editor to send the
article plus every comment as one batch. \`⌘/Ctrl + Z\` undoes the
last comment change. Comments that can no longer be found show as
**Outdated**.

## 4. 💾 Save a snapshot

**Click Save in the editor toolbar** when you like a draft. Open
**Revision history** (clock, top bar) later to diff and restore
(\`⌘/Ctrl + h\`).

## 5. 📚 Use a saved prompt

**Open Prompt library** (bookmark, top bar) or press \`⌘/Ctrl + ,\`.
Click any prompt to drop it into the chat input, or write your own
and ask the AI to rewrite / shorten / expand the selection. Check
**include selection** in the chat panel when you want the selected
text sent with your message.

## 6. ✅ Apply or Reject AI edits

**AI rewrites show up as cards.** Click **Apply** or **Reject** on
each one. For several changes in one reply, use **Apply N changes**
in the chat footer. If a quote no longer matches the document, click
in the editor and use **Force-apply…**.

## 7. ✨ Get sentence suggestions while writing

**Press \`Tab\` or click Accept** for the suggestion under your text,
\`Esc\` or **Reject** to dismiss, or click **Predict** (or
\`⌘/Ctrl + \\\`) to turn predictions on and request one.

## 8. 📷 Import text from photos or PDFs

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
          return {
            comments: {
              ...s.comments,
              [comment.documentId]: [...existing, comment],
            },
            commentUndoStack: pushUndoOp(s.commentUndoStack, {
              kind: 'add',
              comment,
            }),
          };
        }),
      updateCommentBody: (id, body) =>
        set((s) => {
          const entry = findCommentEntry(s.comments, id);
          if (!entry) return s;
          const next = {
            ...entry.comment,
            body,
            updatedAt: Date.now(),
          };
          return {
            comments: replaceComment(s.comments, id, next),
            commentUndoStack: pushUndoOp(s.commentUndoStack, {
              kind: 'update-body',
              before: entry.comment,
              after: next,
            }),
          };
        }),
      markCommentsSent: (ids) =>
        set((s) => {
          if (ids.length === 0) return s;
          const idSet = new Set(ids);
          let changed = false;
          const next: Record<string, Comment[]> = { ...s.comments };
          for (const [docId, list] of Object.entries(next)) {
            const updated = list.map((c) => {
              if (!idSet.has(c.id) || c.sent) return c;
              changed = true;
              return { ...c, sent: true };
            });
            if (changed) next[docId] = updated;
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
        // Repair any out-of-bounds layout values persisted by older builds
        // (before bounds clamping existed) so the panels can never blow
        // out the viewport on load.
        if (state) {
          const sw = state.layout?.sidebarWidth;
          const cw = state.layout?.chatWidth;
          let repaired = false;
          if (typeof sw === 'number' && (sw < MIN_SIDEBAR_WIDTH || sw > MAX_SIDEBAR_WIDTH)) {
            state.layout.sidebarWidth = clamp(sw, MIN_SIDEBAR_WIDTH, MAX_SIDEBAR_WIDTH);
            repaired = true;
          }
          if (typeof cw === 'number' && (cw < MIN_CHAT_WIDTH || cw > MAX_CHAT_WIDTH)) {
            state.layout.chatWidth = clamp(cw, MIN_CHAT_WIDTH, MAX_CHAT_WIDTH);
            repaired = true;
          }
          // Migration for v0.2.5+: older payloads predate the `provider`
          // field on ApiConfig. Default to 'minimax' so the existing
          // endpoint/model keep working unchanged.
          if (state.api && typeof state.api === 'object' && !('provider' in state.api)) {
            (state.api as ApiConfig).provider = 'minimax';
            repaired = true;
          }
          // Migration for v0.4.0: older payloads predate the
          // `comments` slice. Default to `{}` so the editor never has
          // to special-case `undefined`. Any comment with missing
          // fields is also normalized defensively.
          if (typeof state.comments !== 'object' || state.comments === null) {
            state.comments = {};
            repaired = true;
          } else {
            for (const [docId, list] of Object.entries(state.comments)) {
              if (!Array.isArray(list)) {
                delete (state.comments as Record<string, Comment[]>)[docId];
                repaired = true;
              }
            }
          }
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
            (state.api as ApiConfig).provider = 'minimax';
            repaired = true;
          }
          // Migration for Debug Mode: older payloads predate the
          // `debugMode` field. Default to off so the toolbar stays
          // minimal for users upgrading from earlier versions.
          if (typeof state.debugMode !== 'boolean') {
            state.debugMode = false;
            repaired = true;
          }
          // Migration for UI font size: older payloads predate the
          // `uiFontSize` field. Default to 14px (the implicit body
          // size before this setting existed) and clamp any out-of-
          // range value persisted by a future build.
          if (typeof state.uiFontSize !== 'number') {
            state.uiFontSize = 14;
            repaired = true;
          } else if (state.uiFontSize < 12 || state.uiFontSize > 20) {
            state.uiFontSize = clamp(state.uiFontSize, 12, 20);
            repaired = true;
          }
          if (repaired) {
            try {
              // Persist the corrected values so we don't re-run the
              // repair on every load. Include all migrated fields
              // explicitly — a partial setState leaves stale values
              // in localStorage and forces re-repair on next boot.
              useStore.setState({
                layout: state.layout,
                api: state.api,
                debugMode: state.debugMode,
                uiFontSize: state.uiFontSize,
                comments: state.comments,
              });
            } catch {
              /* ignore */
            }
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
