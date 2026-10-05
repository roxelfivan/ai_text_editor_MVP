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
  const segments: ProposedEditSegment[] = [];
  const fenceRe = /```([^\n`]*)\n([\s\S]*?)(?:```|$)/g;
  // #region agent log
  fetch('http://127.0.0.1:7578/ingest/bd956ca3-785d-4fc6-a9b7-20b3719fbe69',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'65ca51'},body:JSON.stringify({sessionId:'65ca51',location:'proposedEdit.ts:parseProposedEdits',message:'parse start',data:{contentLen:content.length,tail:content.slice(-160),openFenceCount:(content.match(/```/g)||[]).length,endsWithFenceClose:/```\s*$/.test(content)},runId:'initial',hypothesisId:'H1',timestamp:Date.now()})}).catch(()=>{});
  // #endregion
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
  return segments;
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
 * Replace the first verbatim occurrence of `original` in `content` with
 * `replacement`. Mirrors the disabled-state check so Apply and the
 * re-evaluation logic in the card share one code path.
 */
export function applyEdit(
  content: string,
  original: string,
  replacement: string
): ApplyEditResult {
  const idx = content.indexOf(original);
  if (idx === -1) return { ok: false, reason: 'anchor-missing' };
  const next =
    content.slice(0, idx) + replacement + content.slice(idx + original.length);
  return { ok: true, next };
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