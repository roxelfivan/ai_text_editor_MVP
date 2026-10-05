import type { ProposedEdit } from '@/types';

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
  let rescued = 0;
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
        rescued++;
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
  if (rescued > 0) {
    // #region agent log
    try {
      fetch('http://127.0.0.1:7578/ingest/bd956ca3-785d-4fc6-a9b7-20b3719fbe69',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'3b8107'},body:JSON.stringify({sessionId:'3b8107',location:'proposedEdit.ts:rescueRawJsonEdits',message:'rescued raw JSON edits',data:{rescued},runId:'post-fix-6',hypothesisId:'H10',timestamp:Date.now()})}).catch(()=>{});
    } catch {}
    // #endregion
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
  // Extract the four string values with a tolerant regex, then re-build
  // a valid JSON object. Use a non-greedy match that allows nested
  // quotes so we can capture phrases like `"Higher or Equal"`.
  const id = extractJsonString(body, 'id');
  const summary = extractJsonString(body, 'summary');
  const original = extractJsonString(body, 'original');
  const replacement = extractJsonString(body, 'replacement');
  if (id && summary && original !== null && replacement !== null) {
    return {
      id,
      summary,
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
      return {
        id: obj.id,
        summary: obj.summary,
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
  | { ok: true; next: string }
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
    // #region agent log
    try {
      fetch('http://127.0.0.1:7578/ingest/bd956ca3-785d-4fc6-a9b7-20b3719fbe69',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'3b8107'},body:JSON.stringify({sessionId:'3b8107',location:'proposedEdit.ts:findEditAnchor',message:'matched',data:{variant:'exact',matchedLen:original.length,originalLen:original.length,docIdx:idx},runId:'post-fix-2',hypothesisId:'H6',timestamp:Date.now()})}).catch(()=>{});
    } catch {}
    // #endregion
    return { idx, length: original.length };
  }

  // 2) Trimmed match.
  const trimmed = original.trim();
  if (trimmed && trimmed !== original) {
    idx = content.indexOf(trimmed);
    if (idx !== -1) {
      // #region agent log
      try {
        fetch('http://127.0.0.1:7578/ingest/bd956ca3-785d-4fc6-a9b7-20b3719fbe69',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'3b8107'},body:JSON.stringify({sessionId:'3b8107',location:'proposedEdit.ts:findEditAnchor',message:'matched',data:{variant:'trim',matchedLen:trimmed.length,originalLen:original.length,docIdx:idx},runId:'post-fix-2',hypothesisId:'H6',timestamp:Date.now()})}).catch(()=>{});
      } catch {}
      // #endregion
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
      // #region agent log
      try {
        fetch('http://127.0.0.1:7578/ingest/bd956ca3-785d-4fc6-a9b7-20b3719fbe69',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'3b8107'},body:JSON.stringify({sessionId:'3b8107',location:'proposedEdit.ts:findEditAnchor',message:'matched',data:{variant:'collapsed',matchedLen:m[0].length,originalLen:original.length,docIdx:m.index},runId:'post-fix-2',hypothesisId:'H6',timestamp:Date.now()})}).catch(()=>{});
      } catch {}
      // #endregion
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
              // #region agent log
              try {
                fetch('http://127.0.0.1:7578/ingest/bd956ca3-785d-4fc6-a9b7-20b3719fbe69',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'3b8107'},body:JSON.stringify({sessionId:'3b8107',location:'proposedEdit.ts:findEditAnchor',message:'matched',data:{variant:'setext-body',matchedLen:j+bodyHead.length-i,originalLen:original.length,docIdx:i,titleOnly,bodyHead},runId:'post-fix-2',hypothesisId:'H6',timestamp:Date.now()})}).catch(()=>{});
              } catch {}
              // #endregion
              return { idx: i, length: j + bodyHead.length - i };
            }
          }
        }
        // #region agent log
        try {
          fetch('http://127.0.0.1:7578/ingest/bd956ca3-785d-4fc6-a9b7-20b3719fbe69',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'3b8107'},body:JSON.stringify({sessionId:'3b8107',location:'proposedEdit.ts:findEditAnchor',message:'matched',data:{variant:'setext-title-only',matchedLen:titleOnly.length,originalLen:original.length,docIdx:i,titleOnly},runId:'post-fix-2',hypothesisId:'H6',timestamp:Date.now()})}).catch(()=>{});
        } catch {}
        // #endregion
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
      // #region agent log
      try {
        fetch('http://127.0.0.1:7578/ingest/bd956ca3-785d-4fc6-a9b7-20b3719fbe69',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'3b8107'},body:JSON.stringify({sessionId:'3b8107',location:'proposedEdit.ts:findEditAnchor',message:'matched',data:{variant:'atx-stripped',matchedLen:stripped.length,originalLen:original.length,docIdx:idx},runId:'post-fix-2',hypothesisId:'H6',timestamp:Date.now()})}).catch(()=>{});
      } catch {}
      // #endregion
      return { idx, length: stripped.length };
    }
    const strippedTrimmed = stripped.trim();
    if (strippedTrimmed && strippedTrimmed !== stripped) {
      idx = content.indexOf(strippedTrimmed);
      if (idx !== -1) {
        // #region agent log
        try {
          fetch('http://127.0.0.1:7578/ingest/bd956ca3-785d-4fc6-a9b7-20b3719fbe69',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'3b8107'},body:JSON.stringify({sessionId:'3b8107',location:'proposedEdit.ts:findEditAnchor',message:'matched',data:{variant:'atx-stripped-trimmed',matchedLen:strippedTrimmed.length,originalLen:original.length,docIdx:idx},runId:'post-fix-2',hypothesisId:'H6',timestamp:Date.now()})}).catch(()=>{});
        } catch {}
        // #endregion
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
      // #region agent log
      try {
        fetch('http://127.0.0.1:7578/ingest/bd956ca3-785d-4fc6-a9b7-20b3719fbe69',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'3b8107'},body:JSON.stringify({sessionId:'3b8107',location:'proposedEdit.ts:findEditAnchor',message:'matched',data:{variant:'unescape-regex',matchedLen:m[0].length,originalLen:original.length,docIdx:m.index},runId:'post-fix-5',hypothesisId:'H9',timestamp:Date.now()})}).catch(()=>{});
      } catch {}
      // #endregion
      return { idx: m.index, length: m[0].length };
    }
  }

  // #region agent log
  try {
    // Locate the AI's first 60 chars (or first line) in the document to
    // see what's different. This is a focused diagnostic to find the
    // exact mismatch without dumping megabytes of content.
    const probeLength = Math.min(60, original.length);
    const probe = original.slice(0, probeLength);
    const docAt = content.indexOf(probe);
    // Also find the longest prefix match (character by character).
    let prefixMatch = 0;
    while (prefixMatch < Math.min(original.length, content.length) &&
           original[prefixMatch] === content[prefixMatch]) {
      prefixMatch++;
    }
    fetch('http://127.0.0.1:7578/ingest/bd956ca3-785d-4fc6-a9b7-20b3719fbe69',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'3b8107'},body:JSON.stringify({sessionId:'3b8107',location:'proposedEdit.ts:findEditAnchor',message:'no match found',data:{originalLen:original.length,originalHead:original.slice(0,120),originalHasSetext:/^[^\n]+\n[=-]{2,}\n/.test(original),originalHasAtx:/^#{1,6}\s/.test(original),docLen:content.length,probe,probeDocAt:docAt,prefixMatch,firstDiffOriginalChar:original[prefixMatch]||null,firstDiffDocChar:content[prefixMatch]||null,docHead:content.slice(0,200),docSnippetAt0:content.slice(0,prefixMatch+50)},runId:'post-fix-4',hypothesisId:'H8',timestamp:Date.now()})}).catch(()=>{});
  } catch {}
  // #endregion
  return null;
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
  return { ok: true, next };
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
 */
export function formatRejectionBatch(items: RejectionItem[]): string {
  const lines = items
    .map((it) => ({ editId: it.editId, comment: it.comment.trim() }))
    .filter((it) => it.comment.length > 0);

  if (lines.length === 0) return '';

  const header =
    lines.length === 1
      ? "Please revise the following rejected proposed edit. The `[id]` in brackets refers to that change's `id`."
      : "Please revise the following rejected proposed edits. Each `[id]` in brackets refers to that change's `id`; address only those.";

  const body = lines.map((l) => `[${l.editId}] ${l.comment}`).join('\n');
  return `${header}\n\n${body}\n`;
}