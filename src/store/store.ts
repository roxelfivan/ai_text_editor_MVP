// The zustand store itself: creation, persistence, rehydration
// migrations, and the lightweight settings/document actions. The
// heavyweight comment actions live in `./actions.ts` so this file
// stays focused on wiring.
//
// Selection was deliberate: `create<StoreState>()(persist(...))` is the
// only piece that touches the global store, so all of `applyThemeClass`
// / clamp migrations / `partialize` shape live next to it. If you are
// looking for the comment round / undo logic, see `./actions.ts`.

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { v4 as uuid } from 'uuid';
import type {
  ApiConfig,
  Comment,
  DocumentRecord,
  Revision,
  Theme,
} from '@/types';
import { applyThemeClass } from '@/utils/theme';
import { reattachCommentToRange } from '@/utils/comments';
import {
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
import {
  STORE_STORAGE_KEY,
  clearSessionApiKey,
  readSessionApiKey,
  writeSessionApiKey,
} from '@/utils/storage';
import {
  defaultApiConfig,
  initialDocs,
  makeDoc,
  seedPrompts,
} from './defaults';
import type { StoreState } from './types';
import {
  addCommentAction,
  appendCommentRoundAction,
  deleteCommentAction,
  dismissOutdatedCommentsAction,
  ensureRoundsShape,
  findCommentEntry,
  markCommentsSentAction,
  pushUndoOp,
  recordAppliedEditAction,
  replaceComment,
  updateCommentBodyAction,
} from './actions';

const STORAGE_KEY = STORE_STORAGE_KEY;

export const useStore = create<StoreState>()(
  persist(
    (set, get) => ({
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
      sendSelectionOnly: false,
      persistApiKey: true,
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
            {
              id: uuid(),
              name: name.trim() || 'Untitled prompt',
              body,
              createdAt: Date.now(),
            },
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
      setSendSelectionOnly: (sendSelectionOnly) =>
        set((s) => ({
          sendSelectionOnly,
          // Selection-only implies sending the highlight.
          includeSelection: sendSelectionOnly ? true : s.includeSelection,
        })),
      setPersistApiKey: (persistApiKey) =>
        set((s) => {
          if (persistApiKey) clearSessionApiKey();
          else writeSessionApiKey(s.api.apiKey);
          return { persistApiKey };
        }),
      setDebugMode: (debugMode) => set({ debugMode }),
      toggleTheme: () =>
        set((s) => {
          const next: Theme = s.theme === 'light' ? 'dark' : 'light';
          applyThemeClass(next);
          return { theme: next };
        }),
      setApi: (patch) =>
        set((s) => {
          const api = { ...s.api, ...patch };
          if (s.persistApiKey) clearSessionApiKey();
          else writeSessionApiKey(api.apiKey);
          return { api };
        }),
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

      // ---- Comment actions: delegated to ./actions.ts ----
      addComment: (comment) => addCommentAction(set, get, comment),
      updateCommentBody: (id, body, mentions) =>
        updateCommentBodyAction(set, get, id, body, mentions),
      appendCommentRound: (id, round) =>
        appendCommentRoundAction(set, get, id, round),
      recordAppliedEdit: (info) => recordAppliedEditAction(set, info),
      markCommentsSent: (ids) => markCommentsSentAction(set, get, ids),
      deleteComment: (id) => deleteCommentAction(set, get, id),
      dismissOutdatedComments: (documentId) =>
        dismissOutdatedCommentsAction(set, get, documentId),
      reattachComment: (id, range) => {
        let ok = false;
        set((s) => {
          const entry = findCommentEntry(s.comments, id);
          if (!entry) return s;
          const doc = s.documents.find((d) => d.id === entry.comment.documentId);
          if (!doc) return s;
          const next = reattachCommentToRange(
            doc.content,
            ensureRoundsShape(entry.comment),
            range.start,
            range.end
          );
          if (!next) return s;
          ok = true;
          const list = s.comments[entry.comment.documentId] ?? [];
          return {
            comments: {
              ...s.comments,
              [entry.comment.documentId]: list.map((c) =>
                c.id === id ? next : c
              ),
            },
            commentUndoStack: pushUndoOp(s.commentUndoStack, {
              kind: 'update-body',
              before: entry.comment,
              after: next,
            }),
          };
        });
        return ok;
      },
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
        let popped: StoreState['commentUndoStack'][number] | null = null;
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
        sendSelectionOnly: s.sendSelectionOnly,
        persistApiKey: s.persistApiKey,
        debugMode: s.debugMode,
        theme: s.theme,
        api: s.persistApiKey ? s.api : { ...s.api, apiKey: '' },
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
          if (typeof state.persistApiKey !== 'boolean') {
            repairs.persistApiKey = true;
          }
          if (typeof state.sendSelectionOnly !== 'boolean') {
            repairs.sendSelectionOnly = false;
          }
          if (state.persistApiKey === false) {
            const sessionKey = readSessionApiKey();
            if (sessionKey) {
              const liveApi = (repairs.api ?? state.api) as ApiConfig;
              repairs.api = { ...liveApi, apiKey: sessionKey };
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
