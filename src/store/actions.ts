// Store action implementations and the internal helpers they share
// (pushUndoOp, findCommentEntry, replaceComment, ensureRoundsShape,
// markLatestRoundSent, findCommentForEdit, snippetOverlapScore).
//
// Split out of `store.ts` so the wiring file stays focused on zustand
// plumbing (persist middleware, rehydration migrations, composition)
// and so each heavyweight comment action lives in a named export
// that can be unit-tested independently.
//
// Plain (one-liner) settings actions stay inline in `store.ts`;
// comment-related state mutations live here because their round /
// undo / mirror logic is the meat of the comment feature.

import { v4 as uuid } from 'uuid';
import type { Comment, CommentOp, CommentRound, ProposedEditRationale } from '@/types';
import { COMMENT_UNDO_STACK_LIMIT } from '@/utils/comments';
import { findEditAnchor } from '@/utils/proposedEdit';

// ---- Shared helpers (exported for tests; used by store actions below) ----

/**
 * Append a `CommentOp` to the undo stack, capping the stack at
 * `COMMENT_UNDO_STACK_LIMIT` by dropping the oldest entries first.
 */
export function pushUndoOp(stack: CommentOp[], op: CommentOp): CommentOp[] {
  const next = [...stack, op];
  if (next.length <= COMMENT_UNDO_STACK_LIMIT) return next;
  return next.slice(next.length - COMMENT_UNDO_STACK_LIMIT);
}

/**
 * Locate a comment by id across all documents. Returns `{ documentId,
 * comment }` so the caller can route the change back to the right slice.
 */
export function findCommentEntry(
  comments: Record<string, Comment[]>,
  id: string
): { documentId: string; comment: Comment } | null {
  for (const [documentId, list] of Object.entries(comments)) {
    const found = list.find((c) => c.id === id);
    if (found) return { documentId, comment: found };
  }
  return null;
}

/**
 * Build a new comments slice with the comment identified by `id`
 * replaced by `next`. Returns the original slice unchanged when no
 * comment with that id exists (caller is expected to have guarded).
 */
export function replaceComment(
  comments: Record<string, Comment[]>,
  id: string,
  next: Comment
): Record<string, Comment[]> {
  const out: Record<string, Comment[]> = {};
  for (const [documentId, list] of Object.entries(comments)) {
    let touched = false;
    const updated = list.map((c) => {
      if (c.id !== id) return c;
      touched = true;
      return next;
    });
    out[documentId] = touched ? updated : list;
  }
  return out;
}

/**
 * Ensure a `Comment` carries a `rounds[]` array, and that the
 * top-level convenience fields mirror the latest round.
 *
 * Used as a defensive guard at every read/write boundary so a
 * partially-constructed comment (built by an older caller, or
 * migrated from an older persisted payload) is upgraded to the
 * nested shape on the fly. Returns the input unchanged when it's
 * already in shape (the common case).
 */
export function ensureRoundsShape(c: Comment): Comment {
  if (Array.isArray(c.rounds) && c.rounds.length > 0) {
    return c;
  }
  // Build a single round from the flat fields. We never see a
  // comment with both `rounds` and flat fields out of sync in
  // practice, but we still copy them defensively so the
  // convenience mirrors stay accurate after the wrap.
  const fallback: CommentRound = {
    id: uuid(),
    start: typeof c.start === 'number' ? c.start : 0,
    end: typeof c.end === 'number' ? c.end : 0,
    snippet: typeof c.snippet === 'string' ? c.snippet : '',
    body: typeof c.body === 'string' ? c.body : '',
    createdAt: typeof c.createdAt === 'number' ? c.createdAt : Date.now(),
    updatedAt: typeof c.updatedAt === 'number' ? c.updatedAt : Date.now(),
    outdated: !!c.outdated,
    sent: !!c.sent,
    applied: [],
  };
  return {
    id: c.id,
    documentId: c.documentId,
    start: fallback.start,
    end: fallback.end,
    snippet: fallback.snippet,
    body: fallback.body,
    createdAt: fallback.createdAt,
    updatedAt: fallback.updatedAt,
    outdated: fallback.outdated,
    sent: fallback.sent,
    rounds: [fallback],
  };
}

/**
 * Return a new comment with its latest round's `sent` flag flipped
 * to `true`, and the top-level convenience `sent` mirror updated to
 * match. Used by `markCommentsSent` so the flag follows the most
 * recent round, not just the first one (which would be the only
 * round under the old flat shape).
 */
export function markLatestRoundSent(c: Comment): Comment {
  const comment = ensureRoundsShape(c);
  const lastIdx = comment.rounds.length - 1;
  const lastRound = comment.rounds[lastIdx];
  // Only the latest round matters. Earlier rounds may already be
  // sent; a follow-up round starts with sent:false and must be
  // flippable on the next "Send to AI".
  if (lastRound.sent && comment.sent) return comment;
  const updatedRound: CommentRound = { ...lastRound, sent: true };
  return {
    ...comment,
    sent: true,
    rounds: [...comment.rounds.slice(0, lastIdx), updatedRound],
  };
}

/**
 * Pick the comment whose current (latest) sent round most likely
 * produced the proposed edit at hand. Used by `recordAppliedEdit`
 * when the caller didn't already know which comment to attach the
 * rationale to (i.e. the bulk Apply-All path).
 *
 * Heuristic: rank candidates by the overlap between the proposed
 * edit's `original` and the round's `snippet`. A round whose snippet
 * shares at least 12 characters of overlap with the edit's
 * `original` is considered a match. We pick the candidate with the
 * largest overlap so the most specific round wins ties.
 */
export function findCommentForEdit(
  comments: Comment[],
  info: {
    original: string;
    messageId: string;
    editId: string;
  }
): Comment | undefined {
  let best: { comment: Comment; score: number } | null = null;
  for (const raw of comments) {
    const c = ensureRoundsShape(raw);
    const lastRound = c.rounds[c.rounds.length - 1];
    if (!lastRound.sent) continue;
    const score = snippetOverlapScore(lastRound.snippet, info.original);
    if (score <= 0) continue;
    if (!best || score > best.score) {
      best = { comment: c, score };
    }
  }
  return best?.comment;
}

/**
 * Cheap overlap score between two strings. Returns 0 when there's
 * no meaningful overlap, otherwise the length of the longest
 * common substring (capped at 12 to keep this O(n) in practice on
 * realistic snippets).
 */
export function snippetOverlapScore(a: string, b: string): number {
  if (!a || !b) return 0;
  const lo = a.length < b.length ? a : b;
  const hi = a.length < b.length ? b : a;
  // Quick rejection: if there's no shared character at all, the
  // overlap is 0.
  let best = 0;
  // Sliding window over the shorter string, checking for a match
  // in the longer one. The window size is capped at min(lo.length,
  // 24) so the inner loop is O(n * 24).
  const cap = Math.min(lo.length, 24);
  outer: for (let len = cap; len >= 12; len--) {
    for (let i = 0; i + len <= lo.length; i++) {
      if (hi.indexOf(lo.slice(i, i + len)) !== -1) {
        best = len;
        break outer;
      }
    }
  }
  return best;
}

// =====================================================================
// Comment actions.
// =====================================================================
//
// Every action takes `(get, set)` so it can read the latest state
// (especially for the deferred-result actions like `recordAppliedEdit`
// that need to RETURN a value computed from the next state). The thin
// `store.ts` wires these into the zustand `set`/`get` shape.

import type { StoreState } from './types';

type SetState = (
  partial:
    | Partial<StoreState>
    | ((s: StoreState) => Partial<StoreState> | StoreState)
) => void;
type GetState = () => StoreState;

const actionContext = { pushUndoOp, findCommentEntry, replaceComment, ensureRoundsShape };

/** Insert a new comment into its document's slice; push onto undo stack. */
export function addCommentAction(
  set: SetState,
  _get: GetState,
  comment: Comment
): void {
  const ctx = actionContext;
  set((s) => {
    const existing = s.comments[comment.documentId] ?? [];
    // Defensive: if a comment was built without a `rounds` array
    // (e.g. an older caller), seed round 1 from the flat fields.
    const seeded = ctx.ensureRoundsShape(comment);
    return {
      comments: {
        ...s.comments,
        [comment.documentId]: [...existing, seeded],
      },
      commentUndoStack: ctx.pushUndoOp(s.commentUndoStack, {
        kind: 'add',
        comment: seeded,
      }),
    };
  });
}

/**
 * Update the latest round's body (and optionally its mentions). When
 * the latest round is already `sent`, append a fresh round instead so
 * the prior reply's body isn't silently overwritten.
 */
export function updateCommentBodyAction(
  set: SetState,
  _get: GetState,
  id: string,
  body: string,
  mentions?: CommentRound['mentions']
): void {
  const ctx = actionContext;
  set((s) => {
    const entry = ctx.findCommentEntry(s.comments, id);
    if (!entry) return s;
    const comment = ctx.ensureRoundsShape(entry.comment);
    const lastIdx = comment.rounds.length - 1;
    const lastRound = comment.rounds[lastIdx];
    const now = Date.now();
    // When the caller supplies `mentions`, use that list; when
    // omitted, preserve whatever the prior round already had
    // (older callers / body-only edits).
    const nextMentions = (mentions !== undefined
      ? mentions.length > 0
        ? mentions
        : undefined
      : lastRound.mentions && lastRound.mentions.length > 0
        ? lastRound.mentions
        : undefined) as CommentRound['mentions'] | undefined;
    const priorIds = (lastRound.mentions ?? []).map((m) => m.id).join(',');
    const nextIds = (nextMentions ?? []).map((m) => m.id).join(',');
    // If the latest round was already sent to the AI, a body
    // edit is a NEW round (follow-up), not an in-place rewrite.
    // Overwriting would erase the prior round's comment body
    // from history and leave applied rationales orphaned under
    // the wrong round — which is why the popover only showed
    // "Round 1" after a second Send.
    if (lastRound.sent) {
      if (body.trim() === lastRound.body.trim() && priorIds === nextIds) {
        return s;
      }
      const newRound: CommentRound = {
        id: uuid(),
        start: lastRound.start,
        end: lastRound.end,
        snippet: lastRound.snippet,
        body,
        createdAt: now,
        updatedAt: now,
        outdated: lastRound.outdated,
        sent: false,
        applied: [],
        ...(nextMentions ? { mentions: nextMentions } : {}),
      };
      const next: Comment = {
        ...comment,
        start: newRound.start,
        end: newRound.end,
        snippet: newRound.snippet,
        body: newRound.body,
        updatedAt: now,
        outdated: newRound.outdated,
        sent: false,
        rounds: [...comment.rounds, newRound],
      };
      return {
        comments: ctx.replaceComment(s.comments, id, next),
        commentUndoStack: ctx.pushUndoOp(s.commentUndoStack, {
          kind: 'append-round',
          before: comment,
          after: next,
        }),
      };
    }
    const updatedRound: CommentRound = {
      ...lastRound,
      body,
      updatedAt: now,
    };
    if (nextMentions) {
      updatedRound.mentions = nextMentions;
    } else {
      delete updatedRound.mentions;
    }
    const next: Comment = {
      ...comment,
      body,
      updatedAt: updatedRound.updatedAt,
      rounds: [...comment.rounds.slice(0, lastIdx), updatedRound],
    };
    return {
      comments: ctx.replaceComment(s.comments, id, next),
      commentUndoStack: ctx.pushUndoOp(s.commentUndoStack, {
        kind: 'update-body',
        before: comment,
        after: next,
      }),
    };
  });
}

/** Append a brand-new round (e.g. follow-up after an apply). */
export function appendCommentRoundAction(
  set: SetState,
  _get: GetState,
  id: string,
  round: Omit<CommentRound, 'id' | 'applied'>
): void {
  const ctx = actionContext;
  set((s) => {
    const entry = ctx.findCommentEntry(s.comments, id);
    if (!entry) return s;
    const comment = ctx.ensureRoundsShape(entry.comment);
    const newRound: CommentRound = {
      ...round,
      id: uuid(),
      applied: [],
    };
    const next: Comment = {
      ...comment,
      start: newRound.start,
      end: newRound.end,
      snippet: newRound.snippet,
      body: newRound.body,
      createdAt: comment.rounds[0]?.createdAt ?? newRound.createdAt,
      updatedAt: newRound.updatedAt,
      outdated: newRound.outdated,
      sent: newRound.sent,
      rounds: [...comment.rounds, newRound],
    };
    return {
      comments: ctx.replaceComment(s.comments, id, next),
      commentUndoStack: ctx.pushUndoOp(s.commentUndoStack, {
        kind: 'append-round',
        before: comment,
        after: next,
      }),
    };
  });
}

/**
 * Record an adopted proposed edit. Resolves the comment id (explicit or
 * inferred by `findCommentForEdit`), re-anchors the round to the new
 * replacement text, and pushes the rationale onto the round's `applied`
 * list. Returns the resolved id, or `null` if no match was found.
 */
export function recordAppliedEditAction(
  set: SetState,
  info: Parameters<StoreState['recordAppliedEdit']>[0]
): string | null {
  const ctx = actionContext;
  let resolvedId: string | null = null;
  set((s) => {
    const docComments = s.comments[info.documentId] ?? [];
    let target: Comment | undefined;
    if (info.commentId) {
      target = docComments.find((c) => c.id === info.commentId);
    } else {
      target = findCommentForEdit(docComments, info);
    }
    if (!target) return s;
    resolvedId = target.id;
    const comment = ctx.ensureRoundsShape(target);
    const lastIdx = comment.rounds.length - 1;
    const lastRound = comment.rounds[lastIdx];
    // Don't double-record the same (editId, roundId) pair.
    if (lastRound.applied.some((a) => a.editId === info.editId)) {
      return s;
    }
    const rationale: ProposedEditRationale = {
      messageId: info.messageId,
      editId: info.editId,
      summary: info.summary,
      rationale: info.rationale ?? '',
      original: info.original,
      replacement: info.replacement,
      appliedAt: info.appliedAt,
    };
    // ---- Re-anchor the round to the ADOPTED text ----
    //
    // The original `original` snippet no longer exists in the
    // document after Apply. If we leave the round pointing at
    // the original's `(start, end)`, the next `reanchorAll`
    // pass uses strategy 2-4 (local search, fuzzy match,
    // first/last 30 chars) to relocate the comment — and any
    // of those can match a much LONGER span than the user
    // actually adopted, producing a highlight that swallows
    // the surrounding paragraph.
    //
    // Instead, we anchor the round to the new `replacement`
    // range inside the now-updated document. Three sources
    // of truth, in priority order:
    //
    //  1. Explicit `info.newAnchor` from the caller (the
    //     Apply-All path passes the exact anchor returned by
    //     `applyAllEdits`).
    //  2. Search the post-apply document content for the
    //     `replacement` text. The Apply path uses this.
    //  3. Fall back to the round's existing anchor unchanged
    //     (e.g. when the replacement is empty and a search
    //     would fail).
    const liveDoc = s.documents.find((d) => d.id === info.documentId);
    const liveContent = liveDoc?.content ?? '';
    let newStart: number | null = null;
    let newEnd: number | null = null;
    let newSnippet: string | null = null;
    if (info.newAnchor && info.replacement) {
      const { start, end } = info.newAnchor;
      const slice = liveContent.slice(start, end);
      if (slice === info.replacement) {
        newStart = start;
        newEnd = end;
        // Prefer the authoritative replacement string so the
        // next reanchorAll pass matches the adopted text
        // byte-for-byte (not a stale slice of the old original).
        newSnippet = info.replacement;
      } else {
        // Explicit idx drifted (e.g. concurrent apply) — rescue
        // by locating the replacement near the claimed start,
        // then anywhere in the doc.
        const near = liveContent.indexOf(
          info.replacement,
          Math.max(0, start - 200)
        );
        const idx =
          near !== -1 ? near : liveContent.indexOf(info.replacement);
        if (idx !== -1) {
          newStart = idx;
          newEnd = idx + info.replacement.length;
          newSnippet = info.replacement;
        }
      }
    } else if (liveContent && info.replacement) {
      const rep = findEditAnchor(liveContent, info.replacement);
      if (rep) {
        newStart = rep.idx;
        newEnd = rep.idx + rep.length;
        newSnippet = info.replacement;
      }
    }
    const updatedRound: CommentRound = {
      ...lastRound,
      applied: [...lastRound.applied, rationale],
      // Re-anchor only when we found a valid replacement
      // range. Skipping the rewrite on failure preserves the
      // existing anchor so the next `reanchorAll` pass can
      // still attempt recovery.
      ...(newStart !== null && newEnd !== null && newSnippet !== null
        ? {
            start: newStart,
            end: newEnd,
            snippet: newSnippet,
          }
        : {}),
    };
    // Mirror the latest round's anchor to the top-level
    // convenience fields so existing call-sites (margin
    // badges, re-anchoring on doc edits) read the new
    // position.
    const nextComment: Comment = {
      ...comment,
      start: updatedRound.start,
      end: updatedRound.end,
      snippet: updatedRound.snippet,
      updatedAt: Date.now(),
      rounds: [...comment.rounds.slice(0, lastIdx), updatedRound],
    };
    return {
      comments: ctx.replaceComment(s.comments, target.id, nextComment),
      commentUndoStack: ctx.pushUndoOp(s.commentUndoStack, {
        kind: 'record-applied',
        before: comment,
        after: nextComment,
        roundId: lastRound.id,
        editId: info.editId,
      }),
    };
  });
  return resolvedId;
}

/** Mark the latest round of each listed comment as `sent: true`. */
export function markCommentsSentAction(
  set: SetState,
  _get: GetState,
  ids: string[]
): void {
  if (ids.length === 0) return;
  set((s) => {
    const idSet = new Set(ids);
    let changed = false;
    const next: Record<string, Comment[]> = { ...s.comments };
    for (const [docId, list] of Object.entries(next)) {
      let docChanged = false;
      const updated = list.map((c) => {
        if (!idSet.has(c.id)) return c;
        const marked = markLatestRoundSent(c);
        if (marked !== c) {
          docChanged = true;
          changed = true;
        }
        return marked;
      });
      if (docChanged) next[docId] = updated;
    }
    if (!changed) return s;
    return { comments: next };
  });
}

/** Delete a comment (one undo step). Sent comments remain deletable. */
export function deleteCommentAction(
  set: SetState,
  _get: GetState,
  id: string
): void {
  const ctx = actionContext;
  set((s) => {
    const entry = ctx.findCommentEntry(s.comments, id);
    if (!entry) return s;
    const docComments = (s.comments[entry.comment.documentId] ?? []).filter(
      (c) => c.id !== id
    );
    return {
      comments: {
        ...s.comments,
        [entry.comment.documentId]: docComments,
      },
      commentUndoStack: ctx.pushUndoOp(s.commentUndoStack, {
        kind: 'delete',
        comment: entry.comment,
      }),
    };
  });
}

/**
 * Delete every outdated comment on a document (each one is its own
 * undo step). Returns the count removed.
 */
export function dismissOutdatedCommentsAction(
  set: SetState,
  _get: GetState,
  documentId: string
): number {
  const ctx = actionContext;
  let removed = 0;
  set((s) => {
    const list = s.comments[documentId] ?? [];
    const outdated = list.filter((c) => c.outdated);
    if (outdated.length === 0) return s;
    removed = outdated.length;
    let stack = s.commentUndoStack;
    for (const c of outdated) {
      stack = ctx.pushUndoOp(stack, { kind: 'delete', comment: c });
    }
    return {
      comments: {
        ...s.comments,
        [documentId]: list.filter((c) => !c.outdated),
      },
      commentUndoStack: stack,
    };
  });
  return removed;
}
