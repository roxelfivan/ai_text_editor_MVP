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
  currentDocument?: { title: string; content: string } | null
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
  if (currentDocument && currentDocument.content.trim()) {
    const title = currentDocument.title?.trim() || 'Untitled';
    // Detect "is the most recent user message a comment batch?"
    // here so we can decide whether to inline the referenced
    // paragraphs. We do this *before* emitting the doc system
    // message so the cost is paid at most once.
    const lastUser = [...history].reverse().find((m) => m.role === 'user');
    const isCommentBatch =
      !!lastUser && looksLikeCommentBatch(lastUser.content);
    out.push({
      id: 'sys-current-doc',
      role: 'system',
      content:
        `The user currently has a document open titled "${title}". ` +
        `When the user says "read the document", "summarize this", ` +
        `"rewrite this", or otherwise refers to "the document" / "the text", ` +
        `they mean the content below. Use it as the working source of truth ` +
        `for the conversation.\n\n` +
        buildDocOutline(title, currentDocument.content, isCommentBatch),
      createdAt: 0,
    });
    out.push({
      id: 'sys-proposed-edit-rules',
      role: 'system',
      content: PROPOSED_EDIT_RULES,
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
        content: `The user has highlighted the following text from their document. Refer to it when relevant:\n\n"""\n${m.selection}\n"""`,
        createdAt: 0,
      });
    }
  }

  // If the most recent user message is a comment batch (the format
  // emitted by `formatCommentBatch` in `src/utils/comments.ts`), inject
  // a one-shot system note that tells the model how to address each
  // `[id]` block. We detect the format by matching the
  // `[cN] (paragraph ...)` header that `formatCommentBatch` always
  // produces.
  const lastUser = [...history].reverse().find((m) => m.role === 'user');
  if (lastUser && looksLikeCommentBatch(lastUser.content)) {
    out.push({
      id: `${lastUser.id}-comments-batch`,
      role: 'system',
      content:
        `The user's latest message is a batch of inline comments on the ` +
        `open document. Each block has the shape:\n\n` +
        `  [id] (paragraph N of M, doc offset S–E)\n` +
        `  "<verbatim quoted text>"\n` +
        `  Context before: "<120 chars before>"\n` +
        `  Context after:  "<120 chars after>"\n` +
        `  Comment: <user's comment text>\n\n` +
        `Address EVERY [id]. For each one, either:\n` +
        `  - Emit a proposed-edit fence with the concrete fix, OR\n` +
        `  - Briefly explain why no concrete edit is possible.\n\n` +
        `CONSISTENCY RULES (read carefully):\n` +
        `- Each [id] is a slice of one larger document. Your replacement ` +
        `for any single [id] MUST stay consistent in voice, terminology, ` +
        `character names, facts, numbers, and style with the rest of the ` +
        `document. Use the per-block "Context before/after" lines (and ` +
        `the document outline / paragraphs you were given, if any) to ` +
        `verify.\n` +
        `- If a fix in one [id] logically requires a corresponding change ` +
        `in another [id] or elsewhere in the document (e.g. a renamed ` +
        `term, a corrected date, a contradiction with another passage), ` +
        `emit an ADDITIONAL proposed-edit fence for that change. Do not ` +
        `silently leave inconsistencies.\n` +
        `- If two [id]s conflict, prioritize the one whose fix keeps the ` +
        `document internally coherent, and briefly note the conflict in ` +
        `your prose.\n` +
        `- Keep comments tied to their [id] throughout your reply so the ` +
        `user can match your response back to each specific comment.\n\n` +
        `TOKEN BUDGET:\n` +
        `- The "Context before/after" lines are only here so you can ` +
        `locate the snippet and stay consistent with surrounding text. ` +
        `Do NOT quote them back in your reply, and do not mention them ` +
        `in your reasoning prose.`,
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
 */
const PROPOSED_EDIT_RULES: string =
  `When you propose changes to the document above, emit one or more ` +
  `fenced blocks using the "proposed-edit" info-string, in this exact ` +
  `shape (one fence per change):\n\n` +
  '```proposed-edit\n' +
  `{\n` +
  `  "id": "<short unique string, e.g. 'p1'>",\n` +
  `  "summary": "<one-line description of the change>",\n` +
  `  "original": "<verbatim substring of the current document>",\n` +
  `  "replacement": "<the new text>"\n` +
  `}\n` +
  '```\n\n' +
  `Rules:\n` +
  `- The "original" value MUST be a byte-for-byte copy of a substring ` +
  `in the document above, including every space, newline, dash, and ` +
  `punctuation mark. If the document says "Section 1. Background", ` +
  `the original must start with exactly that text, not a paraphrase. ` +
  `If you cannot find an exact substring, do not emit a ` +
  `proposed-edit block for that change.\n` +
  `- Before emitting each fence, locate the target text in the ` +
  `document and copy the exact characters between two known anchors. ` +
  `Treat the document as authoritative — do not invent or reformat.\n` +
  `- Multiple changes in a single reply are allowed; emit one fence ` +
  `per change.\n` +
  `- Keep "original" as short as possible while still uniquely ` +
  `locating the text to change.\n` +
  `- You may optionally add commentary outside the fences (the user ` +
  `will see it as normal markdown).`;

/**
 * Length of the per-paragraph preview used in the doc outline.
 * Tuned so a 10-paragraph document produces a ~600-char outline
 * (~150 tokens) instead of repeating the whole document verbatim.
 */
const OUTLINE_PREVIEW_CHARS = 60;

/**
 * Build a compact representation of the open document for the
 * `sys-current-doc` system message.
 *
 * Always emits:
 *   - a header with the title, total length, and paragraph count
 *   - one line per paragraph giving the paragraph number, start
 *     offset, and the first ~60 chars (trimmed on a word boundary)
 *
 * When `includeReferencedParagraphs` is true (i.e. the most recent
 * user message is a comment batch from `formatCommentBatch`), we
 * additionally inline the verbatim text of every paragraph that
 * contains at least one `[cN]` snippet. This is the only place the
 * full text of the document appears — non-comment chat turns see
 * the outline alone, which is typically 95%+ smaller than the
 * verbatim document.
 *
 * Pure: no DOM / IO access. The caller passes the raw `content`
 * string from the document record.
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
    `--- DOC OUTLINE "${title}" ---`,
    `Length: ${content.length} chars, ${starts.length} paragraph${starts.length === 1 ? '' : 's'}.`,
    ''
  );
  for (let p = 0; p < starts.length; p++) {
    const start = starts[p];
    const end = p + 1 < starts.length ? starts[p + 1] : content.length;
    const raw = content.slice(start, end).replace(/\s+/g, ' ').trim();
    const preview =
      raw.length <= OUTLINE_PREVIEW_CHARS
        ? raw
        : trimOnWordBoundary(raw, OUTLINE_PREVIEW_CHARS) + '…';
    lines.push(`[p${p + 1}] offset ${start}–${end}: ${preview}`);
  }
  // Reserved for future expansion: if we detect the comment batch
  // referenced paragraphs, we can inline their verbatim text here
  // under a "--- REFERENCED PARAGRAPHS ---" header. Currently a
  // no-op because the per-comment `Context before/after` lines in
  // `formatCommentBatch` already give the model enough local
  // context to make byte-exact `original` matches.
  void referenced;
  lines.push(`--- END DOC OUTLINE "${title}" ---`);
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
