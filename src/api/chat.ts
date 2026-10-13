// Minimal OpenAI-compatible chat client. Works with MiniMax by default.
// The user supplies apiKey + apiEndpoint (and optionally model/systemMessage).
import type { ChatMessage, ApiConfig } from '@/types';

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
 */
export function buildRequestMessages(
  history: ChatMessage[],
  systemMessage: string,
  currentDocument?: { title: string; content: string } | null,
  /**
   * Optional override for the rationale rules block. When the user
   * has customized `api.rationaleRulesOverride` in Settings, the
   * chat pipeline passes that string here. When undefined or empty,
   * the hard-coded `PROPOSED_EDIT_RULES_DEFAULT` is used so the
   * prompt stays sensible for callers that don't know about the
   * override (tests, other entry points).
   */
  rationaleRulesOverride?: string
): ChatMessage[] {
  const out: ChatMessage[] = [];
  if (systemMessage.trim()) {
    out.push({ id: 'sys', role: 'system', content: systemMessage, createdAt: 0 });
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
  `  "rationale": "<REQUIRED: ≥7 numbered points, ≥100 words — see RATIONALE RULES>",\n` +
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
 * Structure: 7 numbered points — 1, 2, 3a, 3b, 3c, 4, 5 — totaling
 * ≥100 words. Point 3 expands into three ≥30-word sub-points.
 */
export const PROPOSED_EDIT_RULES_DEFAULT: string =
  `RATIONALE RULES ("rationale" REQUIRED, non-empty, on every ` +
  `proposed-edit):\n` +
  `- ≥100 words total.\n` +
  `- ≥7 numbered points (1. … 2. … 3a. … 3b. … 3c. … 4. … 5. …), ` +
  `each on its own line (\\n inside the JSON string). Escape " as ` +
  `\\\".\n` +
  `- Cover, in order:\n` +
  `  1. Pre-change: what the original wording said (plain language).\n` +
  `  2. Post-change: what the replacement now says (plain language).\n` +
  `  3. Logical reason: why the change was necessary (ambiguity, ` +
  `redundancy, weak verb, inconsistency, missing context, etc.). ` +
  `Write exactly 3 sub-points, each ≥30 words: (3a) why the change, ` +
  `(3b) how it helps the paragraph, (3c) how it helps the document. ` +
  `Do not mention these rules.\n` +
  `  4. Benefit to the user's comment and the paragraph (clarity / ` +
  `flow / tone).\n` +
  `  5. Benefit to the whole document (voice, purpose, audience).\n` +
  `- Full professional sentences, not fragments. Shown in the ` +
  `comment popover after Apply.`;

/**
 * Schema rules + rationale rules (default or user override).
 * Override replaces only the rationale section.
 */
function buildProposedEditRulesMessage(
  rationaleRulesOverride: string | undefined
): string {
  const trimmed = rationaleRulesOverride?.trim();
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
 * full document. `includeReferencedParagraphs` is reserved (currently
 * unused — comment batches rely on Before/After context instead).
 */
export function buildDocOutline(
  title: string,
  content: string,
  includeReferencedParagraphs: boolean
): string {
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

  // Which paragraphs (1-based indices) are referenced by a comment
  // batch? Parse the [cN] (paragraph P/M, ...) header lines from
  // the most recent user message. We deliberately do a lightweight
  // parse here rather than calling back into `formatCommentBatch`
  // because the comment batch lives in `history` and the doc
  // outline is built from `content` — keeping the two decoupled
  // means either helper can change shape without breaking the
  // other.
  const referenced: Set<number> = new Set();
  // (We don't have the last user message here — the caller
  // pre-computed `includeReferencedParagraphs` as a coarse signal.
  // When false, we skip the inlining entirely. When true, we
  // rely on the caller to have already established that this is
  // a comment batch; the outline itself stays cheap.)
  void includeReferencedParagraphs;

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
  // Reserved: could inline referenced paragraphs when
  // `includeReferencedParagraphs` is true. Currently unused —
  // Before/After in `formatCommentBatch` is enough for byte-exact
  // `original` matches.
  void referenced;
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
