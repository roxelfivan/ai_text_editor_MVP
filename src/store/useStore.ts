import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { v4 as uuid } from 'uuid';
import type {
  ApiConfig,
  ChatMessage,
  DocumentRecord,
  Prompt,
  Revision,
  Theme,
} from '@/types';
import {
  clamp,
  MIN_SIDEBAR_WIDTH,
  MAX_SIDEBAR_WIDTH,
  MIN_CHAT_WIDTH,
  MAX_CHAT_WIDTH,
} from '@/hooks/useDragResize';

const STORAGE_KEY = 'ai-text-editor-mvp';

const DEFAULT_SYSTEM_MESSAGE =
  'You are a helpful writing assistant. Be concise, specific, and preserve the user\'s voice when revising.';

const defaultApiConfig: ApiConfig = {
  apiKey: '',
  apiEndpoint: import.meta.env.VITE_DEFAULT_API_ENDPOINT || 'https://api.minimax.io/v1',
  model: import.meta.env.VITE_DEFAULT_MODEL || 'MiniMax-M2.7',
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
  setChatOpen: (open: boolean) => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  setChatCollapsed: (collapsed: boolean) => void;
  setTopbarCollapsed: (collapsed: boolean) => void;
  setIncludeSelection: (v: boolean) => void;
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
}

const initialDocs: DocumentRecord[] = [
  makeDoc(
    'Welcome',
    `# Welcome to AI Text Editor (MVP)

This is a minimal local-first markdown editor with an AI chat sidebar.

## Features

- **Documents** — create, rename, delete, switch from the sidebar.
- **Markdown** — write in the textarea, toggle to preview (or split).
- **AI chat** — open the chat panel, ask anything, or send the selected text.
- **Prompt library** — save reusable prompts and run them with one click.
- **Revisions** — every save creates a snapshot. View diffs and restore.

## Get started

1. Open **Settings** (top right) and paste your MiniMax API key.
2. Select some text in this document, then ask the AI to "rewrite" it.
3. Press the **Save revision** button in the toolbar to snapshot this version.

Happy writing!`
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
      chatOpen: true,
      sidebarCollapsed: false,
      chatCollapsed: false,
      topbarCollapsed: false,
      includeSelection: true,
      theme: 'light',
      api: defaultApiConfig,
      layout: {
        sidebarWidth: 240,
        chatWidth: 384,
        previewSizes: {},
      },
      editorFocus: {},

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
          return {
            documents: docs,
            chats,
            revisions,
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
      setChatOpen: (chatOpen) => set({ chatOpen }),
      setSidebarCollapsed: (sidebarCollapsed) => set({ sidebarCollapsed }),
      setChatCollapsed: (chatCollapsed) => set({ chatCollapsed }),
      setTopbarCollapsed: (topbarCollapsed) => set({ topbarCollapsed }),
      setIncludeSelection: (includeSelection) => set({ includeSelection }),
      toggleTheme: () =>
        set((s) => {
          const next: Theme = s.theme === 'light' ? 'dark' : 'light';
          if (typeof document !== 'undefined') {
            document.documentElement.classList.toggle('dark', next === 'dark');
          }
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
        chatOpen: s.chatOpen,
        sidebarCollapsed: s.sidebarCollapsed,
        chatCollapsed: s.chatCollapsed,
        topbarCollapsed: s.topbarCollapsed,
        includeSelection: s.includeSelection,
        theme: s.theme,
        api: s.api,
        layout: s.layout,
      }),
      onRehydrateStorage: () => (state) => {
        if (state?.theme === 'dark' && typeof document !== 'undefined') {
          document.documentElement.classList.add('dark');
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
          if (repaired) {
            try {
              // Persist the corrected values so we don't re-run the repair on every load.
              useStore.setState({ layout: state.layout });
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
