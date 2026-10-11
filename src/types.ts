// Shared types for the MVP.

export type Role = 'system' | 'user' | 'assistant';

export interface ChatMessage {
  id: string;
  role: Role;
  content: string;
  // Optional context included at send time (e.g. selected text from the editor).
  selection?: string;
  createdAt: number;
}

export interface DocumentRecord {
  id: string;
  title: string;
  content: string;
  createdAt: number;
  updatedAt: number;
}

export interface Revision {
  id: string;
  documentId: string;
  // Snapshot of the document content at this point in time.
  content: string;
  createdAt: number;
  // Optional short label (auto-generated or user-supplied).
  label?: string;
}

export interface Prompt {
  id: string;
  name: string;
  body: string;
  createdAt: number;
}

export interface ProposedEdit {
  id: string;
  summary: string;
  original: string;
  replacement: string;
}

export type Theme = 'light' | 'dark';

// AI provider identifier. Backends that need a key (minimax, openai) speak
// the OpenAI Chat Completions wire format, so the request layer does not
// branch on `provider` for them — it's a UI / defaults concern (which
// endpoint, model list, and help text to show). The third option
// (`google-ai-mode`) does NOT speak that wire format and does NOT need an
// API key; ChatPanel branches on it to open a new browser tab instead of
// calling the OpenAI-shaped endpoint.
export type ApiProvider = 'minimax' | 'openai' | 'google-ai-mode';

// Union of providers that require an API key in Settings. The
// keyless `google-ai-mode` provider is intentionally excluded so the
// first-run onboarding, inline-completion gating, and the Settings
// "no key required" affordance can branch on a single source of truth.
export type KeyedApiProvider = Exclude<ApiProvider, 'google-ai-mode'>;

export interface ApiConfig {
  provider: ApiProvider;
  apiKey: string;
  // Either a full chat-completions URL or a base URL (we will append /chat/completions).
  apiEndpoint: string;
  model: string;
  systemMessage: string;
  temperature: number;
}

/**
 * Inline comment attached to a range in a DocumentRecord. The `(start,
 * end)` offsets reference the document text at creation time; `snippet`
 * is a verbatim snapshot used to relocate the comment when the document
 * is edited and the offsets no longer line up.
 *
 * `outdated` flips to `true` when neither the offsets nor the snippet can
 * be found anywhere in the document — typically because the user deleted
 * the commented passage entirely. The popover then surfaces a warning
 * plus Edit / Delete.
 *
 * `sent: true` marks comments that were included in a batch already
 * shipped to the LLM. Sent comments stay visible (so the user can
 * correlate AI track-changes back to specific comments) and remain
 * editable / deletable.
 */
export interface Comment {
  id: string;
  documentId: string;
  /** Inclusive start offset into the document text. */
  start: number;
  /** Exclusive end offset into the document text. */
  end: number;
  /** Verbatim snapshot of the commented substring at creation time. */
  snippet: string;
  /** User-entered comment body. Plain text. Soft-capped at 2000 chars. */
  body: string;
  createdAt: number;
  /** Updated whenever body or anchor changes. */
  updatedAt: number;
  /** True when re-anchoring failed — see the JSDoc above. */
  outdated: boolean;
  /** True once the comment has been included in a batch sent to the AI. */
  sent: boolean;
}

/**
 * An operation on a Comment, used to power the per-session undo stack.
 * Stored in-memory only (not persisted) — a fresh reload starts with an
 * empty stack. Captures both `before` and `after` so undo is a clean
 * apply/reverse rather than a diff that has to be reconstructed.
 */
export type CommentOp =
  | { kind: 'add'; comment: Comment }
  | { kind: 'update-body'; before: Comment; after: Comment }
  | { kind: 'delete'; comment: Comment };
