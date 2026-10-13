// Pure helpers for the @-mention chip system. The textarea stores a
// mention as a sentinel sequence (zero-width on screen) so the user
// can edit prose around it; the chip is painted by an absolutely-
// positioned overlay in <MentionInput>. The sentinel format is:
//
//   "\u200B[[mention:<id>|<kind>|<title>|<paragraphCSV>|<docId>|<reason>|<referrerId>]]\u200B"
//
// where the embedded fields are pipe-escaped (`|` inside a field is
// escaped as `\|` and `\` is escaped as `\\`). The two trailing
// fields (`reason`, `referrerId`) were added in v0.4.5; legacy
// sentinels with only 5 fields keep parsing, the missing fields are
// silently dropped. The outer zero-width
// spaces are defensive — they make the sentinel survive most editors'
// whitespace handling and keep the chip's bounding box from collapsing
// when nothing else lives on the line.

import type { MentionToken } from '@/types';

export const MENTION_SENTINEL_OPEN = '\u200B[[mention:';
export const MENTION_SENTINEL_CLOSE = ']]\u200B';

const PIPE_BACKSLASH = /\\/g;
const PIPE_PIPE = /\|/g;

/** Escape a string for embedding between sentinel pipes. */
function encodeField(s: string): string {
  return s.replace(PIPE_BACKSLASH, '\\\\').replace(PIPE_PIPE, '\\|');
}

/** Reverse of `encodeField`. */
function decodeField(s: string): string {
  // Two passes: backslashes first, then escaped pipes. Any other
  // backslash sequence is left as-is so forward compatibility with a
  // future field that uses a new escape is preserved.
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '\\' && i + 1 < s.length) {
      const next = s[i + 1];
      if (next === '\\' || next === '|') {
        out += next;
        i++;
        continue;
      }
    }
    out += c;
  }
  return out;
}

/** Build the sentinel string for a mention. */
export function buildSentinel(t: MentionToken): string {
  const paragraphCSV = t.paragraphIndexes.join(',');
  // Field 6 = optional `reason` (MentionReason). Empty string when not
  // set so legacy 5-field sentinels keep parsing. Field 7 = optional
  // `referrerId` (Comment/ChatMessage id). Empty string when not set.
  // Adding fields at the tail keeps existing 5-field sentinels valid
  // — `parseSentinelBody` accepts 5, 6, or 7 fields.
  const reason = t.reason ?? '';
  const referrerId = t.referrerId ?? '';
  const body =
    `${t.id}|${t.kind}|${encodeField(t.documentTitle)}|` +
    `${paragraphCSV}|${encodeField(t.documentId)}|` +
    `${encodeField(reason)}|${encodeField(referrerId)}`;
  return MENTION_SENTINEL_OPEN + body + MENTION_SENTINEL_CLOSE;
}

/**
 * Build an editable textarea value for a comment that may have
 * mentions stored as body sentinels OR only on the latest round
 * (after an older edit path stripped sentinels). Prefer the body
 * when it already carries sentinels; otherwise append round
 * mentions as sentinels so the chip bar reappears in edit mode.
 */
export function buildEditableMentionBody(
  body: string,
  roundMentions?: MentionToken[] | null
): string {
  const { plain, mentions: fromBody } = parseMentions(body);
  if (fromBody.length > 0) return body;
  const fromRound = roundMentions ?? [];
  if (fromRound.length === 0) return plain || body;
  const suffix = fromRound.map((m) => buildSentinel(m)).join('');
  return plain ? `${plain}${suffix}` : suffix;
}

/**
 * Scan `text` for mention sentinels. Returns the mentions in source
 * order along with their byte ranges, and the text with all sentinels
 * stripped (suitable for sending to the LLM as the user message).
 *
 * Malformed sentinels (wrong shape, unknown id, etc.) are dropped
 * silently — they are treated as plain text by the chip overlay and
 * disappear from the prompt.
 */
export function parseMentions(
  text: string
): { plain: string; mentions: MentionToken[] } {
  const mentions: MentionToken[] = [];
  if (!text) return { plain: '', mentions };
  let plain = '';
  let i = 0;
  while (i < text.length) {
    const open = text.indexOf(MENTION_SENTINEL_OPEN, i);
    if (open === -1) {
      plain += text.slice(i);
      break;
    }
    plain += text.slice(i, open);
    const bodyStart = open + MENTION_SENTINEL_OPEN.length;
    const close = text.indexOf(MENTION_SENTINEL_CLOSE, bodyStart);
    if (close === -1) {
      // Unterminated sentinel — keep the rest as plain text.
      plain += text.slice(open);
      break;
    }
    const body = text.slice(bodyStart, close);
    const parsed = parseSentinelBody(body);
    if (parsed) {
      mentions.push(parsed);
    } else {
      // Malformed sentinel: keep it as plain text so the user does
      // not silently lose typed content.
      plain += text.slice(open, close + MENTION_SENTINEL_CLOSE.length);
    }
    i = close + MENTION_SENTINEL_CLOSE.length;
  }
  return { plain, mentions };
}

export interface ScannedMention {
  token: MentionToken;
  /** Start index in the source string (inclusive). */
  start: number;
  /** End index in the source string (exclusive). */
  end: number;
}

/**
 * Like `parseMentions` but also returns each mention's source-byte
 * range. Used by the MentionInput for chip positioning / surgical
 * edits (e.g. deleting one mention).
 */
export function parseMentionsWithRanges(
  text: string
): { plain: string; mentions: ScannedMention[] } {
  const mentions: ScannedMention[] = [];
  if (!text) return { plain: '', mentions };
  let plain = '';
  let i = 0;
  while (i < text.length) {
    const open = text.indexOf(MENTION_SENTINEL_OPEN, i);
    if (open === -1) {
      plain += text.slice(i);
      break;
    }
    plain += text.slice(i, open);
    const bodyStart = open + MENTION_SENTINEL_OPEN.length;
    const close = text.indexOf(MENTION_SENTINEL_CLOSE, bodyStart);
    if (close === -1) {
      plain += text.slice(open);
      break;
    }
    const body = text.slice(bodyStart, close);
    const parsed = parseSentinelBody(body);
    if (parsed) {
      mentions.push({
        token: parsed,
        start: open,
        end: close + MENTION_SENTINEL_CLOSE.length,
      });
    } else {
      plain += text.slice(open, close + MENTION_SENTINEL_CLOSE.length);
    }
    i = close + MENTION_SENTINEL_CLOSE.length;
  }
  return { plain, mentions };
}

function parseSentinelBody(body: string): MentionToken | null {
  // Split into 5, 6, or 7 fields, respecting escaped pipes. The
  // original format had 5 fields; in v0.4.5 we added optional fields
  // 6 (`reason`) and 7 (`referrerId`) at the tail. Legacy 5-field
  // sentinels keep working — `reason` and `referrerId` become
  // `undefined`, which `buildReferencedDocMessage` resolves to
  // `'context'` and `null` respectively.
  const fields: string[] = [];
  let cur = '';
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (c === '\\' && i + 1 < body.length) {
      const next = body[i + 1];
      if (next === '\\' || next === '|') {
        cur += next;
        i++;
        continue;
      }
    }
    if (c === '|') {
      fields.push(cur);
      cur = '';
      continue;
    }
    cur += c;
  }
  fields.push(cur);
  if (fields.length < 5 || fields.length > 7) return null;
  const [id, kind, titleRaw, paragraphCSV, docIdRaw, reasonRaw, referrerIdRaw] =
    fields;
  if (!id) return null;
  if (kind !== 'doc' && kind !== 'doc-section') return null;
  const documentTitle = decodeField(titleRaw);
  const documentId = decodeField(docIdRaw);
  const paragraphIndexes =
    kind === 'doc' || !paragraphCSV
      ? []
      : paragraphCSV
          .split(',')
          .map((s) => Number(s))
          .filter((n) => Number.isInteger(n) && n >= 0);
  // Field 6 / 7 are optional and may be empty strings for older
  // sentinels — drop the key in that case so the chip carries only
  // the fields it actually has.
  const out: MentionToken = {
    id,
    kind,
    documentId,
    documentTitle,
    paragraphIndexes,
    createdAt: 0,
  };
  const reason = reasonRaw ? decodeField(reasonRaw) : '';
  if (
    reason === 'context' ||
    reason === 'style' ||
    reason === 'facts' ||
    reason === 'terminology' ||
    reason === 'compare'
  ) {
    out.reason = reason;
  }
  const referrerId = referrerIdRaw ? decodeField(referrerIdRaw) : '';
  if (referrerId) out.referrerId = referrerId;
  return out;
}

/**
 * Build a stable label for a mention's chip (lower line). For whole-
 * doc mentions returns the section count string ("full document");
 * for section-scoped mentions returns the first picked paragraph's
 * preview + "+N more" when more than one was picked.
 */
export function summarizeMention(
  token: MentionToken,
  getParagraphPreview: (docId: string, paragraphIndex: number) => string | null
): string {
  if (token.kind === 'doc' || token.paragraphIndexes.length === 0) {
    return 'full document';
  }
  const first = token.paragraphIndexes[0];
  const preview = getParagraphPreview(token.documentId, first) ?? `paragraph ${first + 1}`;
  if (token.paragraphIndexes.length === 1) {
    return `§ ${preview}`;
  }
  return `§ ${preview} +${token.paragraphIndexes.length - 1} more`;
}
