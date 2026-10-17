import type { MentionToken, ProposedEdit } from '@/types';
import { parseMentions as parseMentionsFromSentinels } from '@/components/mentions/parseMentions';

export type ProposedEditSegment =
  | { kind: 'text'; payload: string }
  | { kind: 'edit'; payload: ProposedEdit };

/**
 * Split an assistant reply into segments. Fenced code blocks whose
 * info-string is exactly `proposed-edit` and whose body parses as a valid
 * `ProposedEdit` JSON object become `kind: 'edit'` segments. Everything
 * else (regular prose, malformed fences, normal code fences) becomes
 * `kind: 'text'` so it falls through to the markdown renderer.
 *
 * The regex matches the smallest possible opening fence so a fence inside
 * another fence isn't accidentally consumed.
 */
export function parseProposedEdits(content: string): ProposedEditSegment[] {
  let segments: ProposedEditSegment[] = [];
  const fenceRe = /```([^\n`]*)\n([\s\S]*?)(?:```|$)/g;
  let lastIndex = 0;
  let m: RegExpExecArray | null;

  while ((m = fenceRe.exec(content)) !== null) {
    const [full, infoString, body] = m;
    const start = m.index;
    if (start > lastIndex) {
      segments.push({ kind: 'text', payload: content.slice(lastIndex, start) });
    }

    if (infoString.trim() === 'proposed-edit') {
      const edit = tryParseEdit(body);
      if (edit) {
        segments.push({ kind: 'edit', payload: edit });
      } else {
        segments.push({ kind: 'text', payload: full });
      }
    } else {
      segments.push({ kind: 'text', payload: full });
    }
    lastIndex = start + full.length;
  }

  if (lastIndex < content.length) {
    segments.push({ kind: 'text', payload: content.slice(lastIndex) });
  }

  // Rescue pass: if no edit segments were produced (or even if some
  // were), scan the text segments for raw JSON objects that look like
  // `ProposedEdit` and split them out. The AI sometimes emits the JSON
  // without the `proposed-edit` fence, and we want to show a card
  // anyway rather than dumping the raw JSON to the user.
  segments = rescueRawJsonEdits(segments);
  return segments;
}

/**
 * Walk every `text` segment looking for JSON objects with the four
 * `ProposedEdit` fields (`id`, `summary`, `original`, `replacement`).
 * Each match is split out into its own `edit` segment, with the JSON
 * itself replaced by a placeholder note so the user knows the AI
 * skipped the fence.
 */
function rescueRawJsonEdits(
  segments: ProposedEditSegment[]
): ProposedEditSegment[] {
  const out: ProposedEditSegment[] = [];
  // The JSON object regex matches a top-level `{` followed by
  // `"id"` / `"summary"` / `"original"` / `"replacement"` string
  // properties, then balanced braces. We allow unescaped `"` inside the
  // string values so we can rescue AI output that contains
  // double-quoted phrases like `"Higher or Equal"`. `tryParseEdit` will
  // still reject anything that doesn't actually parse.
  const jsonRe = /\{\s*"id"\s*:\s*"[^"]+"\s*,\s*"summary"\s*:\s*"[\s\S]*?"\s*,\s*"original"\s*:\s*"[\s\S]*?"\s*,\s*"replacement"\s*:\s*"[\s\S]*?"\s*\}/g;
  for (const seg of segments) {
    if (seg.kind !== 'text') {
      out.push(seg);
      continue;
    }
    const text = seg.payload;
    let cursor = 0;
    let mm: RegExpExecArray | null;
    jsonRe.lastIndex = 0;
    while ((mm = jsonRe.exec(text)) !== null) {
      const start = mm.index;
      const end = start + mm[0].length;
      if (start > cursor) {
        out.push({ kind: 'text', payload: text.slice(cursor, start) });
      }
      const edit = tryParseEditLenient(mm[0]);
      if (edit) {
        out.push({ kind: 'edit', payload: edit });
      } else {
        out.push({ kind: 'text', payload: mm[0] });
      }
      cursor = end;
    }
    if (cursor < text.length) {
      out.push({ kind: 'text', payload: text.slice(cursor) });
    }
  }
  return out;
}

/**
 * Try `tryParseEdit` first; on failure, attempt a tolerant repair by
 * escaping unescaped `"` characters that appear inside the AI's string
 * values. The AI frequently emits strings containing literal double
 * quotes (e.g. `"Higher or Equal"`) without escaping them, which makes
 * the surrounding JSON invalid.
 */
function tryParseEditLenient(body: string): ProposedEdit | null {
  const direct = tryParseEdit(body);
  if (direct) return direct;
  // Extract the string values with a tolerant regex, then re-build
  // a valid JSON object. Use a non-greedy match that allows nested
  // quotes so we can capture phrases like `"Higher or Equal"`. The
  // `rationale` field is optional for backward compatibility with
  // older AI replies; we default to an empty string when missing.
  const id = extractJsonString(body, 'id');
  const summary = extractJsonString(body, 'summary');
  const original = extractJsonString(body, 'original');
  const replacement = extractJsonString(body, 'replacement');
  if (id && summary && original !== null && replacement !== null) {
    const rationale = extractJsonString(body, 'rationale') ?? '';
    return {
      id,
      summary,
      rationale,
      original,
      replacement,
    };
  }
  return null;
}

function extractJsonString(body: string, key: string): string | null {
  // Find `"key":` then capture everything up to the next `,` or `}`
  // that is followed by a known field, or to the closing `}`. We
  // require the match to start with `"` so the AI's value is quoted.
  const keyRe = new RegExp(`"${key}"\\s*:\\s*"`, 'g');
  const m = keyRe.exec(body);
  if (!m) return null;
  const start = m.index + m[0].length;
  // Walk forward, tracking backslash escapes. Stop at the first `"` that
  // is followed by `,` or `}` or end-of-string — this heuristic gives
  // us a tolerant end-of-string detection.
  let i = start;
  while (i < body.length) {
    const c = body[i];
    if (c === '\\' && i + 1 < body.length) {
      i += 2;
      continue;
    }
    if (c === '"') {
      // Look ahead for a `,` or `}` (with optional whitespace) — if
      // present, treat this as the closing quote.
      let j = i + 1;
      while (j < body.length && /\s/.test(body[j])) j++;
      if (j >= body.length || body[j] === ',' || body[j] === '}') {
        return body.slice(start, i);
      }
    }
    i++;
  }
  return null;
}

function tryParseEdit(body: string): ProposedEdit | null {
  try {
    const obj = JSON.parse(body);
    if (
      obj &&
      typeof obj.id === 'string' &&
      typeof obj.summary === 'string' &&
      typeof obj.original === 'string' &&
      typeof obj.replacement === 'string'
    ) {
      // `rationale` is optional; older replies may not include it.
      // Empty string is treated the same as missing by the UI.
      const rationale =
        typeof obj.rationale === 'string' ? obj.rationale : '';
      return {
        id: obj.id,
        summary: obj.summary,
        rationale,
        original: obj.original,
        replacement: obj.replacement,
      };
    }
  } catch {
    // fall through
  }
  return null;
}

export type ApplyEditResult =
  | {
      ok: true;
      next: string;
      /**
       * The byte range that was replaced in the source `content`.
       * `idx` is the position of the matched original, and
       * `end = idx + length` is the end of the inserted
       * replacement in `next`. Useful for re-anchoring comments
       * to the adopted text.
       */
      anchor: { idx: number; length: number };
    }
  | { ok: false; reason: 'anchor-missing' };

/**
 * Locate the substring of `content` that should be replaced for a
 * `proposed-edit` block. The AI is told to emit a verbatim substring, but
 * in practice it often emits text that differs from the document by
 * leading/trailing whitespace, line endings, or a single collapsed
 * whitespace run (e.g. when the user re-flowed the paragraph). We try a
 * sequence of progressively looser searches so Apply still works on
 * these near-matches. Returns the index and the actual span that matched
 * (so the caller can slice with the matched length, not the AI's
 * `original` length).
 */
export function findEditAnchor(
  content: string,
  original: string
): { idx: number; length: number } | null {
  if (!content) return null;
  // An empty `original` would `indexOf` to 0 in every string, so the
  // card would always render as "found". Reject that explicitly so the
  // disabled-state message still appears.
  if (!original) return null;

  // 1) Exact match.
  let idx = content.indexOf(original);
  if (idx !== -1) {
    return { idx, length: original.length };
  }

  // 2) Trimmed match.
  const trimmed = original.trim();
  if (trimmed && trimmed !== original) {
    idx = content.indexOf(trimmed);
    if (idx !== -1) {
      return { idx, length: trimmed.length };
    }
  }

  // 3) Whitespace-collapsed regex match. Any run of whitespace in the
  // AI's text matches any run of whitespace in the document.
  const collapsed = original.replace(/\s+/g, ' ').trim();
  if (collapsed && collapsed !== original) {
    const escaped = collapsed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(escaped.replace(/ /g, '\\s+'));
    const m = re.exec(content);
    if (m) {
      return { idx: m.index, length: m[0].length };
    }
  }

  // 4) Setext heading normalisation. The AI sometimes writes
  //    `Title\n-------\n` (Setext h2) or `Title\n=======\n` (Setext h1)
  //    where the document uses ATX (`## Title`). We strip the underline
  //    and search for the body of the heading instead, so the rest of
  //    the `original` text can be located by following the heading.
  const setext = original.match(/^([^\n]+)\n[=-]{2,}\n/);
  if (setext) {
    const titleOnly = setext[1].trim();
    if (titleOnly) {
      const i = content.indexOf(titleOnly);
      if (i !== -1) {
        // The body of the original is everything after the underline.
        // Try to extend the match to include the body in the document.
        const bodyStart = setext[0].length;
        const body = original.slice(bodyStart);
        if (body) {
          // Look for the first non-empty line of the body shortly after
          // the heading, ignoring any markdown decoration on the
          // heading line itself.
          const bodyHead = body.replace(/^\s+/, '').split('\n')[0].trim();
          if (bodyHead) {
            const searchFrom = i + titleOnly.length;
            const j = content.indexOf(bodyHead, searchFrom);
            if (j !== -1) {
              return { idx: i, length: j + bodyHead.length - i };
            }
          }
        }
        return { idx: i, length: titleOnly.length };
      }
    }
  }

  // 5) ATX heading prefix stripping. The AI sometimes prepends `## ` /
  //    `### ` etc. to the `original` when the document doesn't have
  //    that prefix. Strip any leading `#` characters and search again.
  const atx = original.match(/^#{1,6}\s+/);
  if (atx) {
    const stripped = original.slice(atx[0].length);
    idx = content.indexOf(stripped);
    if (idx !== -1) {
      return { idx, length: stripped.length };
    }
    const strippedTrimmed = stripped.trim();
    if (strippedTrimmed && strippedTrimmed !== stripped) {
      idx = content.indexOf(strippedTrimmed);
      if (idx !== -1) {
        return { idx, length: strippedTrimmed.length };
      }
    }
  }

  // 6) Markdown escape normalisation. The document may use backslash
  //    escapes (`\.`, `\_`, `\*`, ...) to display Markdown-significant
  //    characters literally. The AI typically strips these when quoting
  //    a substring, so an exact-match search fails. We build a regex
  //    where every Markdown-significant character in the AI's text
  //    optionally allows a leading backslash in the document, then
  //    match the regex to find the right span.
  const mdPattern = /[\\`*_{}\[\]()#+\-.!|>~]/;
  if (mdPattern.test(original)) {
    // Escape regex special chars in `original` (besides the MD chars
    // we're going to wrap). Each MD-significant char becomes `\\?X`
    // so the document can have an optional preceding backslash.
    const specialRe = /[.*+?^${}()|[\]\\]/g;
    const reSource = original
      .split('')
      .map((c) => {
        if (/[\\`*_{}\[\]()#+\-.!|>~]/.test(c)) {
          return '\\\\?' + c.replace(specialRe, '\\$&');
        }
        return c.replace(specialRe, '\\$&');
      })
      .join('');
    const re = new RegExp(reSource, 's');
    const m = re.exec(content);
    if (m) {
      return { idx: m.index, length: m[0].length };
    }
  }

  return null;
}

/**
 * Best-effort anchor for a proposed edit whose `original` quote cannot
 * be matched by `findEditAnchor` (six existing strategies failed). The
 * intent is to recover from "near misses" — the user re-flowed a
 * paragraph, swapped a few words, or the model paraphrased instead of
 * quoting — without ever silently rewriting text. The function returns
 * a confidence score alongside the anchor so the UI can decide whether
 * to surface an inline confirmation prompt or to fall back to the
 * existing Force-apply / skip path.
 *
 * Strategy:
 *   1. Tokenise `original` on whitespace + markdown-significant
 *      boundaries. Reject if fewer than 3 tokens or total length
 *      under 30 chars — too little signal to safely approximate.
 *   2. Tokenise `content` the same way.
 *   3. Slide a window of N tokens across the content tokens, scoring
 *      each window by how many of its tokens appear in the original
 *      in order (allowing one-character substitutions and one-char
 *      Levenshtein distance per token).
 *   4. Require ≥ 60% token overlap AND the window length within
 *      ±50% of the original token count.
 *   5. Refuse if `content` is over `MAX_BEST_EFFORT_DOC_BYTES` —
 *      the O(N·W) scan would block the tab.
 *
 * Returns `null` for ambiguous or low-confidence matches. The caller
 * decides whether to show a confirm prompt; we don't make that UX call
 * here.
 */
export interface BestEffortAnchor {
  idx: number;
  length: number;
  /** 0..1, fraction of the original tokens found in the matched window in order. */
  confidence: number;
}

const MAX_BEST_EFFORT_DOC_BYTES = 100 * 1024;

/**
 * Cheap word-tokeniser that splits on whitespace + common markdown
 * boundaries so a heading marker or list bullet doesn't fuse into
 * the adjacent word. Punctuation stays attached to the token — the
 * match pass treats `word` and `word.` as different tokens on
 * purpose, since the AI usually preserves trailing punctuation.
 */
function tokenizeForBestEffort(s: string): string[] {
  if (!s) return [];
  // Split on runs of whitespace, line breaks, or markdown block
  // boundaries. Inline emphasis markers (`` ` ``, `*`, `_`) stay
  // attached to their containing word; we don't try to strip them.
  return s.split(/\s+/).filter((t) => t.length > 0);
}

/**
 * 1-edit-distance check between two short tokens (≤ 8 chars). We
 * approximate Levenshtein with a length-difference check plus a
 * set-equality fallback: if both tokens are ≤ 8 chars and differ by
 * 0–1 character via substitution, treat them as a near-match. The
 * cap on length is the safety belt — a longer token with 1 substitution
 * is usually a real word change, not a typo.
 */
function isNearToken(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  const len = Math.max(a.length, b.length);
  if (len > 8) return false;
  let diffs = 0;
  for (let i = 0; i < len; i++) {
    if (a[i] !== b[i]) {
      diffs++;
      if (diffs > 1) return false;
    }
  }
  return diffs <= 1;
}

export function findBestEffortAnchor(
  content: string,
  original: string
): BestEffortAnchor | null {
  if (!content || !original) return null;
  if (content.length > MAX_BEST_EFFORT_DOC_BYTES) return null;
  if (original.length < 30) return null;

  const origTokens = tokenizeForBestEffort(original);
  if (origTokens.length < 3) return null;

  // Build content tokens AND keep their (start, end) byte offsets so
  // we can convert a window of tokens back into a {idx, length}.
  const contentTokens: { token: string; start: number; end: number }[] = [];
  {
    const re = /\S+/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(content)) !== null) {
      contentTokens.push({ token: m[0], start: m.index, end: m.index + m[0].length });
    }
  }
  if (contentTokens.length < origTokens.length) return null;

  const n = origTokens.length;
  // Skip budget: how many content tokens may be absorbed without
  // matching any original token. With `n` original tokens, allow
  // up to half that many extra content tokens. Confidence is the
  // real bound on how loose the match can be — this only caps the
  // WIDTH of the matched span in tokens.
  const maxSkip = Math.max(2, Math.floor(n * 0.5));
  // Lookahead window for matching a content token against original
  // tokens. A lookahead of 5 lets us recover from "the first N
  // original tokens were reworded out of the document" — the first
  // surviving original token gets matched even if it sits up to 5
  // positions deep in `origTokens`. Larger values catch more paraphrase
  // cases but increase the chance of accidental matches between common
  // words; the confidence threshold + skip budget cap the downside.
  const LOOKAHEAD = Math.max(5, Math.floor(n * 0.5));
  // Cap on the matched content span in tokens. Prevents one early
  // match from absorbing a whole document.
  const maxMatchedTokens = Math.ceil(n * 1.5);

  let best: BestEffortAnchor | null = null;

  // For each possible starting position in contentTokens, scan forward
  // trying to match all `n` original tokens in order. At each content
  // token we try to match it against original[oi..oi+LOOKAHEAD] and
  // advance `oi` to the matched index + 1 (so the match is always in-
  // order, but gaps in the original are absorbed silently rather than
  // forcing consecutive alignment). Confidence = matchedCount / n;
  // a candidate is rejected if its matched content length exceeds
  // `maxMatchedTokens`.
  for (let start = 0; start < contentTokens.length; start++) {
    let oi = 0;
    let skips = 0;
    let firstMatch = -1;
    let lastMatch = -1;
    let matchedCount = 0;
    for (let ci = start; ci < contentTokens.length; ci++) {
      const ct = contentTokens[ci];
      if (oi >= n) break;
      // Try the current original token first, then look ahead a few
      // positions to absorb leading rewordings in the document.
      let matchedAt = -1;
      const limit = Math.min(n, oi + LOOKAHEAD + 1);
      for (let k = oi; k < limit; k++) {
        if (isNearToken(ct.token, origTokens[k])) {
          matchedAt = k;
          break;
        }
      }
      if (matchedAt !== -1) {
        if (firstMatch === -1) firstMatch = ci;
        lastMatch = ci;
        oi = matchedAt + 1;
        matchedCount++;
      } else {
        skips++;
        if (skips > maxSkip) break;
      }
      // Bail early if the match is already much wider than the
      // original token count.
      if (lastMatch !== -1 && ci - start + 1 > maxMatchedTokens) break;
    }
    if (matchedCount === 0) continue;
    const matchedTokenCount = lastMatch - firstMatch + 1;
    if (matchedTokenCount > maxMatchedTokens) continue;
    const confidence = matchedCount / n;
    if (confidence < 0.6) continue;
    if (best === null || confidence > best.confidence) {
      best = {
        idx: contentTokens[firstMatch].start,
        length:
          contentTokens[lastMatch].end - contentTokens[firstMatch].start,
        confidence,
      };
      // Early exit: 100% match is as good as it gets; any other
      // starting position would be a worse match by definition.
      if (confidence >= 1.0) return best;
    }
  }

  return best;
}

/**
 * Replace the first verbatim occurrence of `original` in `content` with
 * `replacement`. Mirrors the disabled-state check so Apply and the
 * re-evaluation logic in the card share one code path.
 */
export function applyEdit(
  content: string,
  original: string,
  replacement: string
): ApplyEditResult {
  const anchor = findEditAnchor(content, original);
  if (!anchor) return { ok: false, reason: 'anchor-missing' };
  const next =
    content.slice(0, anchor.idx) +
    replacement +
    content.slice(anchor.idx + anchor.length);
  return { ok: true, next, anchor };
}

/**
 * Apply a batch of `ProposedEdit`s in order against a running string
 * accumulator. Each edit's `original` is looked up against the *current*
 * accumulator (which already reflects any prior edits in the batch), so
 * two overlapping edits compose correctly: the second `applyEdit` runs
 * against text that has the first edit applied.
 *
 * Edits whose `original` is not found in the current accumulator are
 * skipped silently — no error is raised. The caller derives the skip
 * count from `edits.length - appliedIds.length` for any user-visible
 * summary, matching the per-message "Apply All" action's footer
 * (`"Applied X of Y changes (Z skipped — not anchored)"`).
 */
export function applyAllEdits(
  content: string,
  edits: ProposedEdit[]
): {
  next: string;
  appliedIds: string[];
  /**
   * Per-edit anchor info for the edits that were applied. Each
   * entry's `idx` is the position of the original substring in
   * the running accumulator, and `replacement` is the new text
   * the caller should use to re-anchor the producing comment.
   * One entry per applied id; the order matches `appliedIds`.
   */
  appliedAnchors: Array<{ id: string; idx: number; replacement: string }>;
} {
  let acc = content;
  const appliedIds: string[] = [];
  const appliedAnchors: Array<{
    id: string;
    idx: number;
    replacement: string;
  }> = [];
  for (const edit of edits) {
    const anchor = findEditAnchor(acc, edit.original);
    if (!anchor) continue;
    acc =
      acc.slice(0, anchor.idx) +
      edit.replacement +
      acc.slice(anchor.idx + anchor.length);
    appliedIds.push(edit.id);
    appliedAnchors.push({
      id: edit.id,
      idx: anchor.idx,
      replacement: edit.replacement,
    });
  }
  return { next: acc, appliedIds, appliedAnchors };
}

/**
 * Insert / replace at a known caret or selection in `content`. Used by
 * the Force-apply path on a ProposedEditCard when the AI's `original`
 * couldn't be anchored in the current document. The user is responsible
 * for choosing the location; this helper does no anchor lookup.
 *
 * - If `selectionStart !== selectionEnd`, the selected range is replaced
 *   with `replacement`.
 * - Otherwise, `replacement` is inserted at the caret.
 *
 * Returns `{ ok: false, reason: 'caret-missing' }` if the caret position
 * is outside the document, missing, or otherwise unusable; the caller
 * should bail without mutating state.
 */
export function applyEditAtCaret(
  content: string,
  replacement: string,
  caret: { selectionStart: number; selectionEnd: number }
):
  | { ok: true; next: string; replaced: boolean }
  | { ok: false; reason: 'caret-missing' } {
  const { selectionStart, selectionEnd } = caret;
  if (
    typeof selectionStart !== 'number' ||
    typeof selectionEnd !== 'number' ||
    Number.isNaN(selectionStart) ||
    Number.isNaN(selectionEnd) ||
    selectionStart < 0 ||
    selectionEnd < 0 ||
    selectionStart > content.length ||
    selectionEnd > content.length ||
    selectionStart > selectionEnd
  ) {
    return { ok: false, reason: 'caret-missing' };
  }
  const replaced = selectionStart !== selectionEnd;
  const next =
    content.slice(0, selectionStart) +
    replacement +
    content.slice(selectionEnd);
  return { ok: true, next, replaced };
}

export interface RejectionItem {
  /** The id of the rejected ProposedEdit. */
  editId: string;
  /** The user's free-text comment. Trimmed before formatting. */
  comment: string;
  /**
   * @-document references the user attached to the rejection comment.
   * Empty / undefined for cards where the user did not use `@`.
   * When the staged rejections are committed, the merged mention
   * list is forwarded to the prompt builder so the model sees the
   * referenced doc(s) alongside the rejection batch.
   */
  mentions?: MentionToken[];
}

/**
 * Build the body of the user message that gets appended to the chat when
 * the user commits one or more staged "Reject with feedback" actions.
 *
 * Format 1 from the plan: a short header followed by one `[id]` line per
 * rejected change. The `[id]` prefix is an unambiguous anchor that the
 * model can match against the `id` field of the `proposed-edit` JSON it
 * emits, so each comment is kept distinct from the others.
 *
 * Items with empty/whitespace-only comments are skipped — those should
 * have used the plain "Reject" button instead.
 *
 * The `comment` strings passed in may contain @-mention sentinel
 * sequences (e.g. `\u200B[[mention:…]]\u200B`). We strip those here
 * via `cleanCommentForPrompt` before formatting so the user-visible
 * chat message is plain prose — the referenced docs are conveyed
 * separately through the prompt builder's `referencedDocuments`
 * argument.
 */
export function formatRejectionBatch(items: RejectionItem[]): string {
  const lines = items
    .map((it) => ({
      editId: it.editId,
      comment: cleanCommentForPrompt(it.comment).trim(),
    }))
    .filter((it) => it.comment.length > 0);

  if (lines.length === 0) return '';

  const header =
    lines.length === 1
      ? "Please revise the following rejected proposed edit. The `[id]` in brackets refers to that change's `id`."
      : "Please revise the following rejected proposed edits. Each `[id]` in brackets refers to that change's `id`; address only those.";

  const body = lines.map((l) => `[${l.editId}] ${l.comment}`).join('\n');
  return `${header}\n\n${body}\n`;
}

/**
 * Strip @-mention sentinels from a comment string. Thin wrapper
 * around the canonical parser in `components/mentions/parseMentions.ts`
 * so there is a single source of truth for the sentinel format.
 * The `components/mentions/parseMentions.ts` module is pure (no
 * React / DOM imports), so the `utils/` layer can depend on it
 * without dragging in UI tree-shake weight.
 */
export function cleanCommentForPrompt(text: string): string {
  if (!text) return '';
  return parseMentionsFromSentinels(text).plain;
}