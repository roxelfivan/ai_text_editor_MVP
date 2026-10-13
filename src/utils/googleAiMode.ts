// Build a Google AI Mode deep-link from a chat request payload.
//
// We do NOT automate access to AI Mode. Instead we open a new browser
// tab to a normal Google search URL with the `udm=50` flag that selects
// the AI-Mode results. The user reads the answer on that page and
// manually pastes it back into the chat. This avoids any anti-bot /
// ToS issues around scraping the search product, while still giving
// users a friction-free way to use Google's AI without an API key.
//
// This module is the single source of truth for the URL shape so the
// search params can be updated in one place if Google changes the
// public AI Mode deep-link in the future.
import type { ChatMessage, DocumentRecord, MentionToken } from '@/types';
import { buildReferencedDocMessage, DEFAULT_SYSTEM_MESSAGE } from '@/api/chat';

// Base URL for Google's AI Mode deep-link. `udm=50` selects the
// generative-AI tab on google.com/search. The query string is appended
// separately by `buildGoogleAiModeUrl`. Update here if Google ever
// changes the public AI Mode entry point.
export const GOOGLE_AI_MODE_URL = 'https://www.google.com/search?udm=50';

// Maximum length of the final encoded URL. Some browsers and search
// engines cap GET URLs around 8KB; staying under 6KB is a safe headroom
// that still fits realistic chat prompts (the editor document is
// usually much shorter than this). When the URL would exceed the cap
// we truncate the prompt with an ellipsis and a note so the user can
// shorten the request manually.
const MAX_URL_LENGTH = 6000;

// AI Mode hard cap on the size of the "current document" preview we
// attach to the prompt. Stays under the 6 KB URL headroom even on
// multi-megabyte docs. Wrapped in a `[Context — document ...]`
// bracket so the AI Mode web UI parses it correctly.
const MAX_CURRENT_DOC_PREVIEW_CHARS = 1500;

/**
 * Build a Google AI Mode search URL that pre-fills the prompt.
 *
 * The payload is reduced to a single user-style message because the
 * web UI does not understand the multi-message Chat Completions shape
 * (no system role, no selection markers, no proposed-edit fences).
 * Selection / system-message context are folded into the prompt as
 * short bracketed notes so the user-facing tab still has them.
 *
 * Referenced docs reuse the shared `buildReferencedDocMessage` from
 * `src/api/chat.ts` so the same outline / sectioned-verbatim logic
 * applies here. We then re-frame the result with a `[Context —
 * referenced document "<title>"]` envelope so the AI Mode page can
 * still surface the reference cleanly.
 */
export function buildGoogleAiModeUrl(
  messages: ChatMessage[],
  systemMessage: string | undefined,
  currentDocument: { title: string; content: string } | null | undefined,
  /**
   * Optional @-document references. Each resolved doc reuses the
   * shared outline-vs-sectioned builder in `src/api/chat.ts` (the
   * same one the OpenAI path uses). The output is wrapped in
   * `[Context — referenced document "<title>"]` brackets so the
   * AI Mode page still parses it. Section-scoped mentions still get
   * verbatim text (capped via the same per-doc + per-turn caps the
   * OpenAI path applies), so the user-facing tab benefits from the
   * same prompt-engineering work — even on the keyless path.
   */
  referencedDocuments?: MentionToken[],
  documentLookup?: (id: string) => DocumentRecord | null
): string {
  const effectiveSystem =
    (systemMessage && systemMessage.trim()) || DEFAULT_SYSTEM_MESSAGE;
  const parts: string[] = [];

  // Current doc first (parallel to `sys-current-doc` in the OpenAI
  // path). The AI Mode tab does not have a doc-outline view, so we
  // emit a short truncated preview bracketed by `[Context — …]`.
  if (currentDocument && currentDocument.content.trim()) {
    const title = currentDocument.title?.trim() || 'Untitled';
    const preview =
      currentDocument.content.length > MAX_CURRENT_DOC_PREVIEW_CHARS
        ? currentDocument.content.slice(0, MAX_CURRENT_DOC_PREVIEW_CHARS) +
          '\n[…truncated…]'
        : currentDocument.content;
    parts.push(
      `[Context — document "${title}"]\n` +
        `${preview}\n` +
        `[End context]\n\n`
    );
  }

  // Append @-referenced docs by reusing the shared builder so the
  // same outline-vs-sectioned logic applies. We bracket the result
  // with `[Context — referenced document "<title>"]` so the
  // single-message AI Mode payload stays parseable. Turn-wide cap is
  // halved vs the OpenAI path because we have a 6 KB URL ceiling
  // instead of a multi-MB request body, and the preview is the
  // dominant cost on this path.
  if (referencedDocuments && referencedDocuments.length > 0 && documentLookup) {
    // Same composite dedupe key as `buildRequestMessages` so the
    // section-kept-on-collision behaviour is consistent across paths.
    const seen = new Map<string, MentionToken>();
    const ordered: { token: MentionToken; doc: DocumentRecord }[] = [];
    for (const token of referencedDocuments) {
      const paragraphs = [...token.paragraphIndexes].sort((a, b) => a - b);
      const key = `${token.documentId}::${token.kind}::${paragraphs.join(',')}`;
      if (seen.has(key)) continue;
      const doc = documentLookup(token.documentId);
      if (!doc || !doc.content.trim()) continue;
      seen.set(key, token);
      ordered.push({ token, doc });
    }

    let totalConsumed = 0;
    // ~2 KB cap — leaves ~4 KB for the rest of the URL (system
    // prompt + chat history + URL encoding). Slightly tighter than
    // the OpenAI path's 8 KB budget because the URL ceiling is
    // hard here.
    const urlCap = 2000;
    for (const { token, doc } of ordered) {
      const rendered = buildReferencedDocMessage(token, doc, {
        totalConsumed,
        totalCap: urlCap,
      });
      // Wrap the shared builder output in AI Mode's
      // `[Context — referenced document "<title>"]` envelope so
      // the single-message web payload stays parseable.
      const wrappedTitle = (doc.title || token.documentTitle || 'Untitled').trim();
      const framed =
        `[Context — referenced document "${wrappedTitle}"]\n` +
        rendered +
        `\n[End context]\n`;
      parts.push(framed);
      totalConsumed += framed.length;
      if (totalConsumed >= urlCap) break;
    }
  }

  if (effectiveSystem.trim()) {
    parts.push(`[System instructions]\n${effectiveSystem.trim()}\n[End]\n\n`);
  }

  // Walk the chat history and concatenate the visible user/assistant
  // turns. The very last entry is usually the user's most recent turn;
  // we keep it as the final sentence so AI Mode's first reply sees the
  // exact question the user wants answered. Earlier turns provide
  // conversational context.
  for (const m of messages) {
    if (m.role === 'system') continue;
    if (!m.content.trim()) continue;
    const role = m.role === 'user' ? 'User' : 'Assistant';
    parts.push(`${role}: ${m.content.trim()}\n\n`);
  }

  let prompt = parts.join('').trim();

  // Trim the trailing "Assistant:" that appears when the chat history
  // ends on a user turn — we don't want the page to interpret the URL
  // as an open-ended completion of an assistant half-sentence.
  prompt = prompt.replace(/\n+Assistant:\s*$/i, '');

  if (prompt.length === 0) {
    prompt = '(empty prompt)';
  }

  // Enforce the URL length cap by truncating with a visible marker so
  // the user knows the prompt was shortened.
  if (prompt.length > MAX_URL_LENGTH) {
    prompt =
      prompt.slice(0, MAX_URL_LENGTH) +
      '\n\n[…prompt truncated to fit URL length limit…]';
  }

  const url = new URL(GOOGLE_AI_MODE_URL);
  url.searchParams.set('q', prompt);
  return url.toString();
}
