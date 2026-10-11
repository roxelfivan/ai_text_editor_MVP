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
import type { ChatMessage } from '@/types';

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

// Cap on the size of the "current document" preview we attach to the
// prompt. AI Mode does not need the whole multi-megabyte document to
// answer a question; a short summary + the first chunk is plenty and
// keeps the resulting URL well within the limit.
const MAX_DOC_PREVIEW_CHARS = 2000;

/**
 * Build a Google AI Mode search URL that pre-fills the prompt.
 *
 * The payload is reduced to a single user-style message because the
 * web UI does not understand the multi-message Chat Completions shape
 * (no system role, no selection markers, no proposed-edit fences).
 * Selection / system-message context are folded into the prompt as
 * short bracketed notes so the user-facing tab still has them.
 */
export function buildGoogleAiModeUrl(
  messages: ChatMessage[],
  systemMessage: string,
  currentDocument: { title: string; content: string } | null | undefined
): string {
  const parts: string[] = [];

  // Selection / document context goes first so it is the first thing
  // the model sees on the AI Mode page. This mirrors the wrapping the
  // OpenAI path does in `buildRequestMessages`.
  if (currentDocument && currentDocument.content.trim()) {
    const title = currentDocument.title?.trim() || 'Untitled';
    const preview =
      currentDocument.content.length > MAX_DOC_PREVIEW_CHARS
        ? currentDocument.content.slice(0, MAX_DOC_PREVIEW_CHARS) +
          '\n[…truncated…]'
        : currentDocument.content;
    parts.push(
      `[Context — document "${title}"]\n` +
        `${preview}\n` +
        `[End context]\n\n`
    );
  }

  if (systemMessage.trim()) {
    parts.push(`[System instructions]\n${systemMessage.trim()}\n[End]\n\n`);
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
