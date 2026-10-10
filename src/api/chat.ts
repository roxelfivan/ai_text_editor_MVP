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
  if (currentDocument && currentDocument.content.trim()) {
    const title = currentDocument.title?.trim() || 'Untitled';
    out.push({
      id: 'sys-current-doc',
      role: 'system',
      content:
        `The user currently has a document open titled "${title}". ` +
        `When the user says "read the document", "summarize this", ` +
        `"rewrite this", or otherwise refers to "the document" / "the text", ` +
        `they mean the content below. Use it as the working source of truth ` +
        `for the conversation.\n\n` +
        `--- BEGIN DOCUMENT "${title}" ---\n` +
        `${currentDocument.content}\n` +
        `--- END DOCUMENT "${title}" ---`,
      createdAt: 0,
    });
    out.push({
      id: 'sys-proposed-edit-rules',
      role: 'system',
      content:
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
        `will see it as normal markdown).`,
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
  return out;
}
