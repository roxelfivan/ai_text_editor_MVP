// Shared types for the MVP.

export type Role = 'system' | 'user' | 'assistant';

export interface ChatMessage {
  id: string;
  role: Role;
  content: string;
  // Optional context included at send time (e.g. selected text from the editor).
  selection?: string;
  /**
   * Optional provider-specific metadata attached at request-assembly
   * time. Currently used to thread Anthropic / OpenAI prompt-
   * cache `cache_control` breakpoints through the messages array;
   * the request layer (`streamChatCompletion`) does NOT forward
   * this field on its own — it has to be deliberately read and
   * routed. Kept generic so future fields (e.g. `priority`) can
   * ride along without a type change.
   */
  metadata?: Record<string, unknown>;
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
  /**
   * AI's per-edit explanation, emitted alongside the edit in the
   * `proposed-edit` fenced block. Surfaced to the user in the
   * comment popover after the edit is applied. Optional for
   * backward compatibility with older AI replies that don't include
   * it; empty string is treated the same as missing.
   */
  rationale?: string;
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
  /**
   * Optional. Undefined / empty falls through to
   * `DEFAULT_SYSTEM_MESSAGE` from `src/api/chat.ts` so the live
   * built-in is used and Settings can show the active prompt
   * (and future updates stay in sync without a migration).
   */
  systemMessage?: string;
  temperature: number;
  /**
   * User-supplied override for the rationale rules inside the
   * proposed-edit fence schema (the rules that shape how the AI
   * writes the per-edit rationale shown in the comment popover).
   * When this string is empty or undefined, the hard-coded
   * `PROPOSED_EDIT_RULES_DEFAULT` in `src/api/chat.ts` is used
   * instead. Keeps existing persisted payloads (which never wrote
   * this field) working unchanged.
   */
  rationaleRulesOverride?: string;
}

/**
 * One adopted proposed edit that the user applied while a particular
 * `CommentRound` was the current round of the parent `Comment`.
 *
 * Captured at Apply time so the rationale is tied to the specific
 * round that produced it, not to the whole comment. The diff fields
 * (`original` / `replacement`) are kept so the popover can render a
 * one-line "+/-" preview without needing the live document.
 */
export interface ProposedEditRationale {
  /** Chat message id that emitted the proposed edit. */
  messageId: string;
  /** Matches `ProposedEdit.id`. */
  editId: string;
  /** The AI's short human-readable label for the change. */
  summary: string;
  /**
   * The AI's per-edit explanation. Emitted by the model in the
   * `proposed-edit` JSON block; surfaced verbatim in the popover.
   */
  rationale: string;
  /** Verbatim original text that the AI was targeting. */
  original: string;
  /** Verbatim replacement text that was applied. */
  replacement: string;
  /** `Date.now()` at the moment the user clicked Apply. */
  appliedAt: number;
}

/**
 * One round of a `Comment`. A round is born when the user attaches a
 * comment to a passage (or after the user applies an AI-proposed edit
 * and then re-comments on the revised passage).
 *
 * The array is ordered oldest-first; the last entry is always the
 * "current" round. Convenience mirrors on the parent `Comment`
 * (`body`, `start`, `end`, `snippet`, `createdAt`, `updatedAt`,
 * `outdated`, `sent`) are kept in sync with the latest round so
 * existing call-sites (margin badges, re-anchoring, batch format)
 * keep reading the same fields.
 */
export interface CommentRound {
  /** Round uuid. */
  id: string;
  /** Inclusive start offset into the document text for this round. */
  start: number;
  /** Exclusive end offset into the document text for this round. */
  end: number;
  /** Verbatim snapshot of the commented substring at this round. */
  snippet: string;
  /** User-entered comment body for this round. Plain text. */
  body: string;
  createdAt: number;
  /** Updated whenever the body or anchor changes for this round. */
  updatedAt: number;
  /** True when re-anchoring failed for this round — see the JSDoc above. */
  outdated: boolean;
  /** True once this round's body has been included in a batch sent to the AI. */
  sent: boolean;
  /**
   * ProposedEdit rationales adopted while this round was the
   * "current" round. Most rounds will have 0 or 1 entries; a round
   * can have multiple if the user applied more than one proposed
   * edit in response to a single batch send.
   */
  applied: ProposedEditRationale[];
  /**
   * Document mentions (`@`-references) the user attached to this
   * round's comment body. Empty / undefined for rounds created
   * before the mentions feature shipped. Persisted with the round
   * so a comment that already includes references stays intact
   * across reloads.
   */
  mentions?: MentionToken[];
}

/**
 * Inline comment attached to a range in a DocumentRecord. The `(start,
 * end)` offsets reference the document text at the current round's
 * creation time; `snippet` is a verbatim snapshot used to relocate the
 * comment when the document is edited and the offsets no longer line
 * up.
 *
 * `outdated` flips to `true` when neither the offsets nor the snippet
 * of the **latest** round can be found anywhere in the document —
 * typically because the user deleted the commented passage entirely.
 * The popover then surfaces a warning plus Edit / Delete.
 *
 * `sent: true` marks comments whose **latest round** has been included
 * in a batch already shipped to the LLM. Sent comments stay visible
 * (so the user can correlate AI track-changes back to specific
 * comments) and remain editable / deletable.
 *
 * The full edit history lives in `rounds` (oldest first). Each round
 * carries its own anchor + body, and any proposed-edit rationales the
 * user adopted while that round was the current round. The top-level
 * `body` / `start` / `end` / `snippet` / `outdated` / `sent` fields
 * mirror the latest round so existing call-sites keep working.
 */
export interface Comment {
  id: string;
  documentId: string;
  /** Inclusive start offset into the document text. Mirrors the latest round. */
  start: number;
  /** Exclusive end offset into the document text. Mirrors the latest round. */
  end: number;
  /** Verbatim snapshot of the commented substring. Mirrors the latest round. */
  snippet: string;
  /** User-entered comment body. Mirrors the latest round. */
  body: string;
  /** Created-at of the first round. */
  createdAt: number;
  /** Updated-at of the latest round. */
  updatedAt: number;
  /** Mirrors the latest round's `outdated`. */
  outdated: boolean;
  /** Mirrors the latest round's `sent`. */
  sent: boolean;
  /**
   * Ordered list of rounds (oldest first, latest = current). Always
   * contains at least one entry for a valid comment.
   */
  rounds: CommentRound[];
}

/**
 * An operation on a Comment, used to power the per-session undo stack.
 * Stored in-memory only (not persisted) — a fresh reload starts with an
 * empty stack. Captures both `before` and `after` so undo is a clean
 * apply/reverse rather than a diff that has to be reconstructed.
 *
 * `append-round` records that the user added a new round to an existing
 * comment (e.g. they typed a follow-up body on a revised passage, or
 * the system created a "round 2" anchor when the original anchor moved).
 * Undoing it restores the previous round list verbatim.
 *
 * `record-applied` records that the user adopted a proposed edit; it
 * captures the rationale entry and where it was inserted, so undo
 * removes that single entry without touching the rest of the round.
 */
export type CommentOp =
  | { kind: 'add'; comment: Comment }
  | { kind: 'update-body'; before: Comment; after: Comment }
  | { kind: 'append-round'; before: Comment; after: Comment }
  | {
      kind: 'record-applied';
      before: Comment;
      after: Comment;
      roundId: string;
      editId: string;
    }
  | { kind: 'delete'; comment: Comment };

/**
 * A user-attached reference to another document (or a section of one)
 * inside a chat message or a comment. Inserted via the `@` picker
 * and rendered as an inline chip in the input.
 *
 * The `documentTitle` is captured at insert time so a later rename of
 * the source document does not silently change the chip's visible
 * text. If the source document is deleted, callers should treat the
 * chip as "(deleted)" and drop the mention from the prompt context.
 *
 * `paragraphIndexes` is empty for `kind === 'doc'` (the whole document
 * is referenced) and contains 0-based paragraph indexes into the
 * source document's paragraph list for `kind === 'doc-section'`.
 * Paragraph boundaries match `buildDocOutline` in `src/api/chat.ts`
 * (one paragraph per `\n`).
 */
export type MentionKind = 'doc' | 'doc-section';

/**
 * Semantic reason for why a document was `@`-mentioned. Lets the
 * prompt builder emit a per-doc focus hint so the LLM can prioritize
 * the most relevant passages instead of re-reading the whole
 * referenced doc. Defaults to `'context'` when the picker does not
 * set it; existing chips therefore keep working unchanged.
 */
export type MentionReason =
  | 'context' // general background reading
  | 'style' // user wants voice / tone match
  | 'facts' // user wants to fact-check / reuse numbers / entities
  | 'terminology' // user wants consistent vocabulary / definitions
  | 'compare'; // user is asking the model to compare with this doc

export interface MentionToken {
  /** Local uuid used as the textarea sentinel id and the React key. */
  id: string;
  kind: MentionKind;
  /** Source document id (lookup key in `useStore.documents`). */
  documentId: string;
  /**
   * Source document title captured at insert time. Used as the chip
   * label so the chip stays stable across renames.
   */
  documentTitle: string;
  /**
   * 0-based paragraph indexes into the source document. Empty for
   * whole-document mentions; one or more entries for section-scoped
   * mentions.
   */
  paragraphIndexes: number[];
  createdAt: number;
  /**
   * Optional semantic intent for this mention. Defaults to
   * `'context'` when omitted. Stored and round-tripped through the
   * textarea sentinel so a chip's intent survives reload. Picker
   * can leave it unset; existing chips keep working.
   */
  reason?: MentionReason;
  /**
   * Optional id of the `Comment`/`ChatMessage` that introduced this
   * mention. Chat messages use their own id; comments use the comment
   * id. Used by `buildRequestMessages` to emit a per-comment
   * `[comment -> referenced docs]` cross-reference map so the model
   * knows WHY each referenced doc was pulled in for that comment.
   * Null for legacy mentions (the cross-reference map is silently
   * omitted in that case).
   */
  referrerId?: string | null;
}
