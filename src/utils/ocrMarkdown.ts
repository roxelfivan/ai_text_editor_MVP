// Turn raw OCR / extracted-PDF text into reader-friendly Markdown.
// The only credentials used are the API key, endpoint, and model the
// user saved in Settings — the same ApiConfig chat and inline
// completion use. There is no built-in / Cursor / fallback key.
// Images stay in-browser; only the recognized text is sent to that API.

import { streamChatCompletion } from '@/api/chat';
import type { ApiConfig, ChatMessage } from '@/types';

export const OCR_MARKDOWN_SYSTEM_PROMPT =
  `You convert OCR or extracted document text into clean, reader-friendly Markdown.\n` +
  `\n` +
  `Rules:\n` +
  `- Preserve the original meaning and every factual detail. Do not invent ` +
  `names, numbers, headings, or sections that are not in the source.\n` +
  `- Repair typical extraction artifacts: broken line wraps, hyphenation at ` +
  `line ends, missing spaces, and obvious character errors when unambiguous.\n` +
  `- Use Markdown structure when the source implies it: headings, paragraphs, ` +
  `lists, block quotes, tables, emphasis, links, and fenced code.\n` +
  `- Output ONLY the Markdown document. No preamble, no commentary, and do ` +
  `not wrap the entire document in a single markdown fence.\n` +
  `- NEVER use <think>, </think>, <reasoning>, or similar meta tags.`;

/**
 * Drop a single outer ``` / ```markdown fence if the model wrapped the
 * whole document. Inner fences (real code blocks) are left alone.
 */
export function unwrapImportedMarkdown(text: string): string {
  const trimmed = text.trim();
  const match = trimmed.match(/^```(?:markdown|md)?\r?\n([\s\S]*?)\r?\n```$/i);
  return match ? match[1].trim() : trimmed;
}

/**
 * Models sometimes emit reasoning tags even when the system prompt
 * forbids them. Strip complete blocks, then anything after an unclosed
 * opener so we never paste hidden chain-of-thought into the editor.
 */
export function stripThinkBlocks(text: string): string {
  let out = text.replace(/<think>[\s\S]*?<\/think>/gi, '');
  out = out.replace(/<reasoning>[\s\S]*?<\/reasoning>/gi, '');
  const open = out.search(/<(?:think|reasoning)>/i);
  if (open !== -1) out = out.slice(0, open);
  return out.trim();
}

export async function formatOcrAsMarkdown(
  raw: string,
  api: ApiConfig,
  options?: { signal?: AbortSignal }
): Promise<string> {
  const source = raw.trim();
  if (!source) {
    throw new Error('Nothing to format — the import produced no text.');
  }

  const messages: ChatMessage[] = [
    {
      id: 'ocr-md-sys',
      role: 'system',
      content: OCR_MARKDOWN_SYSTEM_PROMPT,
      createdAt: 0,
    },
    {
      id: 'ocr-md-user',
      role: 'user',
      content:
        `Convert the following extracted text into reader-friendly Markdown. ` +
        `Return only the Markdown.\n\n` +
        `--- BEGIN EXTRACTED TEXT ---\n` +
        `${source}\n` +
        `--- END EXTRACTED TEXT ---`,
      createdAt: Date.now(),
    },
  ];

  // Pass the Settings config through unchanged except for a lower
  // temperature. Do not substitute another key, host, or model.
  const settingsApi: ApiConfig = {
    ...api,
    temperature: Math.min(api.temperature, 0.3),
  };

  let acc = '';
  await streamChatCompletion(messages, settingsApi, {
    signal: options?.signal,
    onDelta: (delta) => {
      acc += delta;
    },
  });

  const markdown = unwrapImportedMarkdown(stripThinkBlocks(acc));
  if (!markdown) {
    throw new Error('The model returned empty Markdown. Try again or check Settings.');
  }
  return markdown;
}
