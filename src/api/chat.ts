// Minimal OpenAI-compatible chat client. Works with MiniMax by default.
// The user supplies apiKey + apiEndpoint (and optionally model/systemMessage).
import type { ApiConfig, ChatMessage, DocumentRecord, MentionToken } from '@/types';

/**
 * Built-in default system message. Single source of truth for the
 * "no override" path — chat, Settings, and persistence all import
 * this. Users can replace it via Settings (the empty value is
 * normalized back to this on save so future updates stay in sync).
 */
export const DEFAULT_SYSTEM_MESSAGE =
  "You are a writing assistant. Be concise, preserve the user's voice, " +
    "and emit one proposed-edit fence per paragraph so edits can be " +
    "accepted independently. Include `rationale` per RATIONALE RULES; " +
    "do not discuss those rules inside the rationale. Escape JSON " +
    'double-quotes as \\".';

/**
 * Build the final chat-completions URL. If the user provided a base URL
 * (no /chat/completions suffix), append it. Otherwise return as-is.
 */
export function resolveChatEndpoint(endpoint: string): string {
  const trimmed = endpoint.trim().replace(/\/+$/, '');
  if (!trimmed) return trimmed;
  if (/\/chat\/completions$/.test(trimmed)) return trimmed;
  if (/\/completions$/.test(trimmed)) return trimmed;
  if (/\/responses$/.test(trimmed)) return trimmed;
  return `${trimmed}/chat/completions`;
}

/**
 * Reject cleartext / non-http(s) endpoints before attaching a Bearer token.
 * Localhost over http is allowed for local proxy / self-hosted models.
 */
export function assertSafeChatEndpoint(endpoint: string): void {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    throw new ApiError(
      'API endpoint must be an absolute URL (e.g. https://api.example.com/v1).'
    );
  }
  const host = url.hostname.toLowerCase();
  const isLocal =
    host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '::1';
  if (url.protocol === 'https:') return;
  if (url.protocol === 'http:' && isLocal) return;
  throw new ApiError(
    `Refusing to send your API key to a non-HTTPS endpoint (${url.protocol}//${url.host}). Use https:// or a localhost http:// URL.`
  );
}

export class ApiError extends Error {
  status?: number;
  body?: string;
  constructor(message: string, status?: number, body?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

interface SendOptions {
  signal?: AbortSignal;
  onDelta: (delta: string) => void;
}

/**
 * Send a chat completion request and stream deltas via onDelta.
 * Resolves when the stream ends. Throws ApiError on failure.
 */
export async function streamChatCompletion(
  messages: ChatMessage[],
  config: ApiConfig,
  options: SendOptions
): Promise<void> {
  const endpoint = resolveChatEndpoint(config.apiEndpoint);
  if (!endpoint) {
    throw new ApiError('No API endpoint configured. Open Settings to set one.');
  }
  if (!config.apiKey) {
    throw new ApiError('No API key configured. Open Settings to set one.');
  }
  assertSafeChatEndpoint(endpoint);

  const body = {
    model: config.model,
    messages: messages.map((m) => ({
      role: m.role,
      content: m.content,
    })),
    temperature: config.temperature,
    stream: true,
  };
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify(body),
    signal: options.signal,
  });

  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => '');
    throw new ApiError(
      `API request failed (${res.status}): ${text || res.statusText}`,
      res.status,
      text
    );
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    // SSE frames are separated by \n\n
    let idx: number;
    while ((idx = buffer.indexOf('\n\n')) !== -1) {
      const frame = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      const line = frame.split('\n').find((l) => l.startsWith('data:'));
      if (!line) continue;
      const payload = line.slice(5).trim();
      if (payload === '[DONE]') return;
      if (!payload) continue;
      try {
        const json = JSON.parse(payload);
        const delta: string | undefined =
          json?.choices?.[0]?.delta?.content ??
          json?.choices?.[0]?.message?.content ??
          undefined;
        if (delta) options.onDelta(delta);
      } catch {
        // ignore malformed frame
      }
    }
  }
}

/**
 * Build the message array that gets sent to the API: system + history + current.
 * If a `selection` is present on the most recent user message, append a system
 * note telling the model what the highlighted text is.
 *
 * `referencedDocuments` are the @-mention tokens attached to the
 * user message (or to a comment batch that's about to be sent). For
 * each token we resolve the source document by id from
 * `documentLookup` (when provided) and append a separate
 * `sys-referenced-doc-N` system message with either the compact
 * outline (whole-doc mentions) or the verbatim paragraph text
 * (section-scoped mentions). Tokens whose source document is
 * missing from the lookup are dropped silently.
 */
export function buildRequestMessages(
  history: ChatMessage[],
  systemMessage: string | undefined,
  currentDocument?: { title: string; content: string } | null,
  /**
   * Optional override for the rationale rules block. When the user
   * has customized `api.rationaleRulesOverride` in Settings, the
   * chat pipeline passes that string here. When undefined or empty,
   * the hard-coded `PROPOSED_EDIT_RULES_DEFAULT` is used so the
   * prompt stays sensible for callers that don't know about the
   * override (tests, other entry points).
   */
  rationaleRulesOverride?: string,
  /**
   * @-document references attached to the outgoing turn. Each token
   * resolves to a separate system message appended after
   * `sys-current-doc`. Pass `documentLookup` when the tokens point
   * at documents the caller does not already have in `currentDocument`
   * (i.e. always for chat; tests may skip it).
   */
  referencedDocuments?: MentionToken[],
  documentLookup?: (id: string) => DocumentRecord | null
): ChatMessage[] {
  const effectiveSystem =
    (systemMessage && systemMessage.trim()) || DEFAULT_SYSTEM_MESSAGE;
  const out: ChatMessage[] = [];
  if (effectiveSystem.trim()) {
    out.push({
      id: 'sys',
      role: 'system',
      content: effectiveSystem,
      createdAt: 0,
    });
  }
  // Attach the currently-open document so the model can see it when the
  // user asks things like "read the document", "summarize this", etc.
  //
  // We push three separate system messages (rather than one giant
  // blob) so each role is independently inspectable / cacheable by
  // the provider and so the user's custom `systemMessage` stays
  // orthogonal to the edit schema:
  //   1. `sys-current-doc` — a short structural outline of the doc
  //      (paragraph starts + first 60 chars each) plus, only when
  //      the most recent user message is a comment batch, the
  //      verbatim text of the paragraphs that contain commented
  //      snippets. This keeps the prompt O(outline + referenced
  //      paragraphs) instead of O(full document) on every turn.
  //   2. `sys-proposed-edit-rules` — the proposed-edit fence schema
  //      and rules. Lifted out of the per-turn doc block so it
  //      reads as a stable contract, and so the user can keep their
  //      own `systemMessage` focused on tone / style.
  // Detect comment-batch once — used for the doc outline signal and
  // the per-batch instruction note below.
  const lastUser = [...history].reverse().find((m) => m.role === 'user');
  const isCommentBatch =
    !!lastUser && looksLikeCommentBatch(lastUser.content);

  if (currentDocument && currentDocument.content.trim()) {
    const title = currentDocument.title?.trim() || 'Untitled';
    out.push({
      id: 'sys-current-doc',
      role: 'system',
      content:
        `Open document "${title}". Treat the outline below as the ` +
        `working text when the user refers to "the document" / ` +
        `"this text".\n\n` +
        buildDocOutline(title, currentDocument.content, isCommentBatch),
      createdAt: 0,
    });
    out.push({
      id: 'sys-proposed-edit-rules',
      role: 'system',
      content: buildProposedEditRulesMessage(rationaleRulesOverride),
      createdAt: 0,
    });
  }

  // Append @-referenced documents as separate system messages so the
  // model can address them by title in the reply. Each token is one
  // message, numbered sequentially. We dedupe by documentId (the
  // first-seen mention wins) and drop tokens whose source document
  // is no longer available in the lookup.
  if (referencedDocuments && referencedDocuments.length > 0) {
    const seen = new Set<string>();
    let counter = 0;
    for (const token of referencedDocuments) {
      if (seen.has(token.documentId)) continue;
      const doc = documentLookup?.(token.documentId);
      if (!doc || !doc.content.trim()) continue;
      seen.add(token.documentId);
      counter++;
      out.push({
        id: `sys-referenced-doc-${counter}`,
        role: 'system',
        content: buildReferencedDocMessage(token, doc),
        createdAt: 0,
      });
    }
  }
  for (const m of history) {
    if (m.role === 'system') continue;
    out.push(m);
    if (m.role === 'user' && m.selection && m.selection.trim()) {
      out.push({
        id: `${m.id}-sel`,
        role: 'system',
        content:
          `Highlighted selection from the document:\n\n"""\n` +
          `${m.selection}\n"""`,
        createdAt: 0,
      });
    }
  }

  // Comment-batch instruction: how to address each `[id]` block.
  // Keep labels in sync with `formatCommentBatch`.
  if (lastUser && isCommentBatch) {
    out.push({
      id: `${lastUser.id}-comments-batch`,
      role: 'system',
      content:
        `Latest user message is an inline-comment batch. Each block:\n` +
        `  [id] (paragraph N/M, doc offset S–E)\n` +
        `  "<verbatim snippet>"\n` +
        `  Before: "…"\n` +
        `  After: "…"\n` +
        `  Comment: <text>\n\n` +
        `Address every [id]: emit a proposed-edit fence, or briefly ` +
        `say why no edit is possible.\n` +
        `Consistency:\n` +
        `- Replacements must match the document's voice, terms, ` +
        `names, facts, numbers, style. Use Before/After and the ` +
        `doc outline.\n` +
        `- If one fix implies another change elsewhere, emit an ` +
        `extra proposed-edit; do not leave inconsistencies.\n` +
        `- On conflicting [id]s, prefer document coherence; note ` +
        `the conflict briefly.\n` +
        `- Tie replies to [id]s. Do not quote Before/After back.`,
      createdAt: 0,
    });
  }

  return out;
}

/**
 * Detect the comment-batch format emitted by `formatCommentBatch` in
 * `src/utils/comments.ts`. We require at least one `[id]` block
 * (the new shape is `[cN] (paragraph …)`) followed eventually by a
 * `Comment:` line. Matches `c1`, `c2`, … which is what the
 * serializer uses.
 */
function looksLikeCommentBatch(content: string): boolean {
  if (!content) return false;
  // At least one `[cN] (paragraph ...)` header followed by a
  // `Comment:` line somewhere later in the block.
  return /\[c\d+\] \(paragraph\b[\s\S]*?Comment:/.test(content);
}

/**
 * Proposed-edit fence schema + rules. Extracted from the per-turn
 * doc block so the rules are a stable contract: the user's
 * `systemMessage` is now free to focus on tone / style without
 * needing to mention the schema, and the rules themselves are
 * pushed as their own system message (separately inspectable /
 * cacheable) rather than being inlined into a giant doc block.
 *
 * Split into two parts so the user can override ONLY the
 * rationale-format rules without losing the JSON schema reminder
 * for the proposed-edit fence:
 *
 *   - `PROPOSED_EDIT_SCHEMA_RULES` — JSON shape, original /
 *     replacement byte-exact rules. Always sent.
 *   - `PROPOSED_EDIT_RULES_DEFAULT` — the rationale-format rules
 *     that follow. Replaced by `api.rationaleRulesOverride` when
 *     the user has customized them in Settings.
 *
 * The Settings modal's "Reset" button restores
 * `PROPOSED_EDIT_RULES_DEFAULT` exactly.
 */
const PROPOSED_EDIT_SCHEMA_RULES: string =
  `To propose document edits, emit one fence per change ` +
  `(info-string exactly "proposed-edit"):\n\n` +
  '```proposed-edit\n' +
  `{\n` +
  `  "id": "<short id, e.g. p1>",\n` +
  `  "summary": "<one-line change description>",\n` +
  `  "rationale": "<REQUIRED: credit-risk cover-memo Markdown, ≥7 numbered points, ≥100 words, keywords bold+underlined — see RATIONALE RULES>",\n` +
  `  "original": "<verbatim substring from the document>",\n` +
  `  "replacement": "<new text>"\n` +
  `}\n` +
  '```\n\n' +
  `Rules:\n` +
  `- "original" MUST match the document byte-for-byte (spaces, ` +
  `newlines, punctuation). No paraphrase. If no exact match, skip ` +
  `that change.\n` +
  `- Copy "original" from the document; keep it short but unique. ` +
  `Document is authoritative.\n` +
  `- Multiple fences per reply OK. Optional prose outside fences ` +
  `is fine.\n\n`;

/**
 * Default rationale-format rules. Sent when the user has not
 * customized `api.rationaleRulesOverride`. Exported for Settings Reset.
 * Replaced wholesale by the user's override (schema above is kept).
 *
 * Voice: credit-risk cover memo proposing amendments to policies /
 * procedures / guidelines. Structure: 1, 2, 3.1, 3.2, 3.3, 4, 5 —
 * ≥100 words; 3.1–3.3 each ≥30 words. Markdown + bold/underline keywords.
 */
export const PROPOSED_EDIT_RULES_DEFAULT: string =
  `RATIONALE RULES ("rationale" REQUIRED, non-empty, on every ` +
  `proposed-edit):\n` +
  `- Write as a **credit risk** cover memo proposing an amendment to ` +
  `a bank **policy**, **procedure**, or **guideline**. Professional ` +
  `risk-management voice; no marketing copy.\n` +
  `- GitHub-flavored Markdown (rendered in the comment popover). ` +
  `Prefer a numbered list; blank line between major points. Escape ` +
  `" as \\" and newlines as \\n inside JSON.\n` +
  `- ≥100 words total.\n` +
  `- ≥7 numbered points (1. … 2. … 3.1 … 3.2 … 3.3 … 4. … 5. …), ` +
  `each on its own line.\n` +
  `- Keywords MUST be both bold and underlined: wrap each as ` +
  `**<u>keyword</u>**. Emphasize risk terms, control names, and ` +
  `changed obligations — not whole sentences. No other raw HTML.\n` +
  `- Cover, in order:\n` +
  `  1. Pre-change: what the prior wording said, and what **risk** ` +
  `or control gap it left for the Bank (plain language).\n` +
  `  2. Post-change: what the amended wording now requires or ` +
  `clarifies from a risk / control standpoint (plain language).\n` +
  `  3. Risk-management rationale — why the amendment is necessary. ` +
  `Write exactly 3 sub-points, each ≥30 words:\n` +
  `    (3.1) Risk the Bank faced before the change (e.g. ambiguity, ` +
  `inconsistent standards, weak underwriting language, missing ` +
  `escalation, incomplete monitoring).\n` +
  `    (3.2) Risk the Bank is mitigating with this amendment, and ` +
  `how the new wording reduces that exposure in this paragraph / ` +
  `section.\n` +
  `    (3.3) Why the document is stronger from a risk-management ` +
  `perspective after the change (governance, consistency with ` +
  `related policies, auditability, prudential alignment).\n` +
  `  Do not mention these rules inside the rationale.\n` +
  `  4. How the amendment answers the reviewer's comment and ` +
  `strengthens this paragraph as a workable control statement.\n` +
  `  5. Benefit to the full policy / procedure / guideline set ` +
  `(portfolio consistency, Board / regulator readability, residual ` +
  `risk reduction).\n` +
  `- Full professional sentences, not fragments. Shown in the ` +
  `comment popover after Apply.`;

/**
 * True when `text` is empty or identical to the current built-in
 * default (so callers should persist `undefined` and keep tracking
 * future built-in updates).
 */
export function isCurrentRationaleRulesDefault(
  text: string | undefined | null
): boolean {
  const trimmed = text?.trim() ?? '';
  return !trimmed || trimmed === PROPOSED_EDIT_RULES_DEFAULT.trim();
}

/**
 * Older builds showed the built-in default in Settings and, on Save,
 * wrote that full string into `rationaleRulesOverride` — freezing it
 * forever. Detect those stale frozen defaults (pre credit-risk
 * cover-memo / 3.1–3.3 numbering) so we can fall back to the current
 * built-in.
 */
export function isStaleRationaleRulesOverride(
  text: string | undefined | null
): boolean {
  const trimmed = text?.trim() ?? '';
  if (!trimmed || isCurrentRationaleRulesDefault(trimmed)) return false;
  // Credit-risk / 3.1 era rule
  const isCreditRisk = /credit risk/i.test(trimmed) || /\(3\.1\)/.test(trimmed);
  if (isCreditRisk) return false;
  // Pre-3a era default (fence-shape doc) and 3a-era default
  // (Logical reason). Either shape, with no credit-risk markers,
  // is a frozen built-in.
  const looksLikeVeryOldBuiltin =
    /When you propose changes to the document above/i.test(trimmed) &&
    /one fence per change/i.test(trimmed);
  const looksLikeThreeAEraBuiltin =
    /\b3a\./i.test(trimmed) && /Logical reason/i.test(trimmed);
  return looksLikeVeryOldBuiltin || looksLikeThreeAEraBuiltin;
}

/**
 * Resolve the effective override for persistence / Settings display:
 * empty, current built-in, or a stale frozen built-in → `undefined`.
 */
export function normalizeRationaleRulesOverride(
  text: string | undefined | null
): string | undefined {
  const trimmed = text?.trim() ?? '';
  if (!trimmed) return undefined;
  if (isCurrentRationaleRulesDefault(trimmed)) return undefined;
  if (isStaleRationaleRulesOverride(trimmed)) return undefined;
  return trimmed;
}

/**
 * True when `text` is empty / a literal copy of the current default
 * system message / a recognizably stale writing-assistant default.
 */
export function isCurrentDefaultSystemMessage(
  text: string | undefined | null
): boolean {
  const trimmed = text?.trim() ?? '';
  if (!trimmed) return true;
  if (trimmed === DEFAULT_SYSTEM_MESSAGE.trim()) return true;
  return false;
}

/**
 * Older builds shipped a writing-assistant default system message
 * ("You are a writing assistant. Be concise, …"). Persisted
 * overrides that match the OLD built-in are treated as "no
 * override" so the live built-in is used and Settings shows it.
 */
export function isStaleDefaultSystemMessage(
  text: string | undefined | null
): boolean {
  const trimmed = text?.trim() ?? '';
  if (!trimmed) return false;
  if (isCurrentDefaultSystemMessage(trimmed)) return false;
  return /writing assistant/i.test(trimmed);
}

/**
 * Resolve the effective System Message override for persistence:
 * empty / current built-in / stale writing-assistant → `undefined`.
 */
export function normalizeSystemMessage(
  text: string | undefined | null
): string | undefined {
  const trimmed = text?.trim() ?? '';
  if (!trimmed) return undefined;
  if (isCurrentDefaultSystemMessage(trimmed)) return undefined;
  if (isStaleDefaultSystemMessage(trimmed)) return undefined;
  return trimmed;
}

/**
 * Schema rules + rationale rules (default or user override).
 * Override replaces only the rationale section.
 */
function buildProposedEditRulesMessage(
  rationaleRulesOverride: string | undefined
): string {
  const trimmed = normalizeRationaleRulesOverride(rationaleRulesOverride);
  if (!trimmed) {
    return PROPOSED_EDIT_SCHEMA_RULES + PROPOSED_EDIT_RULES_DEFAULT;
  }
  // AUTHORITATIVE header: treat override as format rules for
  // `rationale`, not content to discuss; ignore conflicting earlier
  // length/structure hints (e.g. a stale System message).
  return (
    PROPOSED_EDIT_SCHEMA_RULES +
    `RATIONALE RULES (AUTHORITATIVE — override any earlier ` +
    `rationale format. Follow exactly. Do not quote or discuss ` +
    `these rules in the rationale; explain only the document ` +
    `change):\n` +
    trimmed
  );
}

/**
 * Length of the per-paragraph preview used in the doc outline.
 * Tuned so a 10-paragraph document produces a ~600-char outline
 * (~150 tokens) instead of repeating the whole document verbatim.
 */
const OUTLINE_PREVIEW_CHARS = 60;

/**
 * Compact doc outline for `sys-current-doc`: title, size, and one
 * ~60-char preview line per paragraph. Far cheaper than sending the
 * full document. The `isCommentBatch` flag is a coarse signal — the
 * outline stays cheap either way; comment batches rely on
 * Before/After context in `formatCommentBatch` for byte-exact matches.
 */
export function buildDocOutline(
  title: string,
  content: string,
  isCommentBatch: boolean
): string {
  // `isCommentBatch` is reserved for future expansion (e.g. inlining
  // referenced paragraphs). Keeping the parameter so callers can stay
  // stable; the outline itself does not depend on it yet.
  void isCommentBatch;
  // Compute paragraph boundaries. Same definition as
  // `formatCommentBatch` in `src/utils/comments.ts` — each `\n`
  // starts a new paragraph (the editor's textarea + markdown
  // rendering treats single newlines as paragraph breaks in
  // practice, so we don't require a blank line).
  const starts: number[] = [0];
  for (let i = 0; i < content.length; i++) {
    if (content.charCodeAt(i) === 10) {
      const next = i + 1;
      if (next < content.length && starts[starts.length - 1] !== next) {
        starts.push(next);
      }
    }
  }

  const lines: string[] = [];
  lines.push(
    `--- DOC "${title}" (${content.length} chars, ${starts.length} paras) ---`
  );
  for (let p = 0; p < starts.length; p++) {
    const start = starts[p];
    const end = p + 1 < starts.length ? starts[p + 1] : content.length;
    const raw = content.slice(start, end).replace(/\s+/g, ' ').trim();
    const preview =
      raw.length <= OUTLINE_PREVIEW_CHARS
        ? raw
        : trimOnWordBoundary(raw, OUTLINE_PREVIEW_CHARS) + '…';
    lines.push(`[p${p + 1}]@${start}: ${preview}`);
  }
  lines.push('--- END DOC ---');
  return lines.join('\n');
}

/**
 * Trim `s` so the returned string is at most `max` characters
 * long, ending at a whitespace boundary when possible. Used to
 * keep the per-paragraph preview in `buildDocOutline` from cutting
 * a word in half.
 */
function trimOnWordBoundary(s: string, max: number): string {
  if (s.length <= max) return s;
  const sliced = s.slice(0, max);
  const sp = sliced.lastIndexOf(' ');
  if (sp > max / 2) return sliced.slice(0, sp);
  return sliced;
}

/**
 * Hard cap on the total characters inlined from section-scoped
 * referenced documents. When the picked paragraphs exceed this we
 * fall back to a compact outline and append a truncation note so
 * the model still has orientation but the prompt stays bounded.
 */
const REFERENCED_SECTION_CHARS_CAP = 4000;

/**
 * Build the system message for a single @-referenced document.
 * Whole-doc mentions get the same compact outline used for the
 * current document (token-cheap, lets the model address the doc
 * by title without seeing the full text). Section-scoped mentions
 * get the verbatim paragraph text for the picked indexes (capped),
 * so the model can quote / propose edits against the exact passage.
 */
function buildReferencedDocMessage(
  token: MentionToken,
  doc: DocumentRecord
): string {
  const title = (doc.title || token.documentTitle || 'Untitled').trim();
  if (token.kind === 'doc' || token.paragraphIndexes.length === 0) {
    return (
      `Referenced document: "${title}". ` +
      `Treat the outline below as the working text when the user ` +
      `refers to it by name.\n\n` +
      buildDocOutline(title, doc.content, false)
    );
  }
  const starts = splitParagraphs(doc.content);
  const picked: number[] = [];
  for (const idx of token.paragraphIndexes) {
    if (idx >= 0 && idx < starts.length) picked.push(idx);
  }
  if (picked.length === 0) {
    return (
      `Referenced document: "${title}". ` +
      `The user picked sections, but none could be located; falling ` +
      `back to the outline.\n\n` +
      buildDocOutline(title, doc.content, false)
    );
  }
  // Build the verbatim text and bail to outline + note if the total
  // would blow the cap. Most sections will be far under the cap
  // (a typical 200-word paragraph is ~1,200 chars).
  const sections: string[] = [];
  let used = 0;
  for (const idx of picked) {
    const start = starts[idx];
    const end = idx + 1 < starts.length ? starts[idx + 1] : doc.content.length;
    const slice = doc.content.slice(start, end);
    if (used + slice.length > REFERENCED_SECTION_CHARS_CAP) {
      return (
        `Referenced document: "${title}". ` +
        `Sections picked (truncated to fit the prompt budget; ` +
        `outline below for orientation).\n\n` +
        sections.join('') +
        `\n…(remaining sections omitted)…\n\n` +
        buildDocOutline(title, doc.content, false)
      );
    }
    sections.push(`[p${idx + 1}]\n${slice}`);
    used += slice.length;
  }
  return (
    `Referenced document: "${title}". ` +
    `Sections picked by the user (verbatim — quote / propose edits ` +
    `against this exact text):\n\n` +
    sections.join('')
  );
}

/**
 * Compute paragraph start offsets for `content`. Mirrors the logic
 * in `buildDocOutline` so the section-text builder sees the same
 * paragraph boundaries as the outline.
 */
function splitParagraphs(content: string): number[] {
  const starts: number[] = [0];
  for (let i = 0; i < content.length; i++) {
    if (content.charCodeAt(i) === 10) {
      const next = i + 1;
      if (next < content.length && starts[starts.length - 1] !== next) {
        starts.push(next);
      }
    }
  }
  return starts;
}
