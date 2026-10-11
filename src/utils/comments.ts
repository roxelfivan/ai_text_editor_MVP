// Pure helpers for the inline-comment feature.
//
// The module deliberately has zero React / DOM dependencies beyond what
// `proposedEdit.ts` already exports, so the helpers can be unit-tested
// in isolation and shared between the editor (re-anchoring, batch
// serialization) and the chat panel (the formatted batch is what we
// hand the LLM).

import { findEditAnchor } from '@/utils/proposedEdit';
import type { Comment } from '@/types';

/** Soft cap on a single comment body; the composer shows a counter. */
export const COMMENT_SOFT_CAP = 2000;
/** Hard cap to keep one comment from breaking the LLM prompt format. */
export const COMMENT_HARD_CAP = 4000;
/** Maximum number of ops retained in the per-session undo stack. */
export const COMMENT_UNDO_STACK_LIMIT = 20;

/**
 * Re-locate a comment's anchor after the document has been edited.
 *
 * Tries four strategies in order; only the last one is allowed to
 * declare the comment `outdated`. Each strategy is independent of the
 * comment's current offsets so an aggressive edit anywhere in the doc
 * still has a chance of recovering the anchor:
 *
 *   1. Offset-preserving check — the substring at `(start, end)` still
 *      matches `snippet` byte-for-byte.
 *   2. Local search — scan ±200 chars around the original offset for
 *      the snippet. Catches nearby insertions / deletions cheaply.
 *   3. Full-document fuzzy match via `findEditAnchor` — handles
 *      whitespace collapse, Setext/ATX heading drift, and markdown-
 *      escape normalization.
 *   4. Substring fallback — match the first 30 and last 30 chars of
 *      the snippet independently. If both anchors are found in order,
 *      reconstruct the range. Rescues "user deleted a few words inside
 *      the comment".
 *
 * Returns the comment unchanged when no relocation is needed; returns
 * a new comment with updated `(start, end)` when relocation succeeds;
 * returns a comment with `outdated: true` otherwise. The original
 * comment is never mutated.
 */
export function reanchorComment(doc: string, comment: Comment): Comment {
  if (comment.outdated) {
    // Once outdated, skip auto-recovery — keep the flag until the
    // user edits or deletes the comment from the popover.
    return comment;
  }

  // 1) Offset-preserving check.
  const safeStart = Math.max(0, Math.min(comment.start, doc.length));
  const safeEnd = Math.max(safeStart, Math.min(comment.end, doc.length));
  if (
    safeEnd > safeStart &&
    doc.slice(safeStart, safeEnd) === comment.snippet
  ) {
    return comment;
  }

  // Empty snippet (a degenerate comment from older data) → nothing to
  // search for. Mark outdated so the user can clean it up.
  if (!comment.snippet) {
    return { ...comment, outdated: true };
  }

  // 2) Local search — ±200 chars around the original position.
  const localWindow = 200;
  const localStart = Math.max(0, comment.start - localWindow);
  const localEnd = Math.min(doc.length, comment.end + localWindow);
  const localHay = doc.slice(localStart, localEnd);
  const localIdx = localHay.indexOf(comment.snippet);
  if (localIdx !== -1) {
    const newStart = localStart + localIdx;
    const newEnd = newStart + comment.snippet.length;
    return {
      ...comment,
      start: newStart,
      end: newEnd,
      updatedAt: Date.now(),
    };
  }

  // 3) Full-document fuzzy match via the existing helper.
  const anchor = findEditAnchor(doc, comment.snippet);
  if (anchor) {
    return {
      ...comment,
      start: anchor.idx,
      end: anchor.idx + anchor.length,
      updatedAt: Date.now(),
    };
  }

  // 4) Substring fallback — first/last 30 chars anchored independently.
  const head = comment.snippet.slice(0, 30);
  const tail = comment.snippet.slice(-30);
  if (head && tail && head !== tail) {
    const headIdx = doc.indexOf(head);
    if (headIdx !== -1) {
      const tailIdx = doc.indexOf(tail, headIdx + head.length);
      if (tailIdx !== -1) {
        const newEnd = tailIdx + tail.length;
        if (newEnd > headIdx) {
          // Rebuild the snippet from the new range so subsequent
          // re-anchors use the relocated text.
          return {
            ...comment,
            start: headIdx,
            end: newEnd,
            snippet: doc.slice(headIdx, newEnd),
            updatedAt: Date.now(),
          };
        }
      }
    }
  }

  return { ...comment, outdated: true };
}

/**
 * Apply `reanchorComment` to a list of comments. Pure: never mutates
 * the input. Returns a new array containing only comments whose anchor
 * data changed (or whose `outdated` flag flipped) — the caller can use
 * this delta to decide which comments need a redraw.
 */
export function reanchorAll(doc: string, comments: Comment[]): {
  next: Comment[];
  changed: Comment[];
} {
  const next: Comment[] = [];
  const changed: Comment[] = [];
  for (const c of comments) {
    const r = reanchorComment(doc, c);
    next.push(r);
    if (r !== c) changed.push(r);
  }
  return { next, changed };
}

/**
 * Build the user-message body sent to the LLM when the user clicks
 * "Send to AI" in the comment tray.
 *
 * The format pairs each comment's verbatim `[id]` block with the user's
 * body text; the AI is told (via a one-shot system note in
 * `buildRequestMessages`) to emit one `proposed-edit` fence per `[id]`
 * so the resulting track-changes cards can be matched back to the
 * comments.
 *
 */
export function formatCommentBatch(
  doc: string,
  comments: Comment[]
): string {
  // Sort by document position so the user (and the AI) can read the
  // batch top-to-bottom in the same order the passages appear.
  const sorted = [...comments].sort((a, b) => a.start - b.start);
  const lines: string[] = [];
  lines.push(
    'I have comments on specific passages of the open document. Please ' +
      'revise accordingly. Each [id] block below identifies one passage; ' +
      'address every one of them.',
    ''
  );
  sorted.forEach((c, i) => {
    // Use a short, model-friendly id (c1, c2, ...) so the AI doesn't
    // get confused by full UUIDs in its reply. The numeric index is
    // already document-order thanks to the sort above.
    const id = `c${i + 1}`;
    lines.push(`[${id}] "${c.snippet}"`, `Comment: ${c.body}`, '');
  });
  // Reference `doc` is intentionally unused in the body — the AI
  // already receives the full document via the `sys-current-doc` system
  // message injected by `buildRequestMessages`. Including it here
  // would double the token cost.
  void doc;
  return lines.join('\n').trimEnd() + '\n';
}

/**
 * Compute a `DOMRect` (or its nearest equivalent) for a textarea
 * selection by measuring the mirror div the editor renders behind the
 * textarea. Used by the floating composer to anchor to the
 * selection's top-right corner.
 *
 * Returns `null` when the selection is empty, the mirror isn't
 * mounted, or the range can't be located (e.g. comment offsets that
 * drifted past the document length).
 *
 * The caller is responsible for translating the returned rect into the
 * editor pane's coordinate space (typically by subtracting the
 * container's `getBoundingClientRect()`).
 */
export function getSelectionRect(
  doc: string,
  mirrorEl: HTMLElement | null,
  start: number,
  end: number
): { left: number; top: number; right: number; bottom: number; height: number } | null {
  if (!mirrorEl) return null;
  if (start === end) return null;
  if (start < 0 || end > doc.length) return null;

  // We can't use a real DOM `Range` against a textarea, so we build
  // a hidden text-node Range by reconstructing a DOM string that ends
  // at the comment's `end` and measuring from a Range that ends at
  // `start`. The bounding rect of the difference is the selection's
  // visual rect.
  const safeEnd = Math.min(end, doc.length);
  const safeStart = Math.max(0, Math.min(start, safeEnd));

  // Strategy: build a Range from `start` to `end` by walking the
  // mirror's text node. The mirror renders each character in document
  // order, so the text-node offset of character `i` is `i` minus the
  // number of `<mark>` wrapping characters that come *before* it.
  // We compute the offset by reconstructing the visible text from the
  // mirror's DOM and walking it linearly.
  const textNode = findFirstTextNode(mirrorEl);
  if (!textNode) return null;
  const visibleText = collectVisibleText(mirrorEl);
  // The mirror's visible text equals `doc` byte-for-byte, so the
  // character index in the visible text is the same as the document
  // offset.
  const range = document.createRange();
  try {
    // Clamp into the visible text length so a stale offset can't throw.
    const startIdx = Math.max(0, Math.min(safeStart, visibleText.length));
    const endIdx = Math.max(startIdx, Math.min(safeEnd, visibleText.length));
    // Walk through text-node boundaries to set the range endpoints.
    setRangeEndpoints(mirrorEl, textNode, visibleText, startIdx, endIdx, range);
    const rect = range.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return null;
    return {
      left: rect.left,
      top: rect.top,
      right: rect.right,
      bottom: rect.bottom,
      height: rect.height,
    };
  } catch {
    return null;
  } finally {
    range.detach?.();
  }
}

/**
 * Find the first text-node descendant of `el`. The mirror overlay
 * renders each character as a sequence of text nodes separated by
 * `<mark>` spans; the first text node is the start of the document.
 */
function findFirstTextNode(el: HTMLElement): Text | null {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  return walker.nextNode() as Text | null;
}

/**
 * Concatenate the text content of every descendant of `el`. Used to
 * map document offsets back to text-node offsets inside the mirror.
 * `<mark>` spans contribute their inner text just like the surrounding
 * text, so the resulting string equals `doc` byte-for-byte.
 */
function collectVisibleText(el: HTMLElement): string {
  let s = '';
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  while (node) {
    s += (node as Text).nodeValue ?? '';
    node = walker.nextNode();
  }
  return s;
}

/**
 * Position `range` so it spans characters `[startIdx, endIdx)` of the
 * mirror's visible text. Walks text nodes until the cumulative offset
 * reaches the desired boundaries.
 */
function setRangeEndpoints(
  mirrorEl: HTMLElement,
  startNode: Text,
  visibleText: string,
  startIdx: number,
  endIdx: number,
  range: Range
): void {
  // Walk **all** text nodes inside the mirror, not just those
  // inside the first text node's parent. The previous version
  // scoped the walker to `startNode.parentNode` (the first `<span>`),
  // which meant only the first text node was ever visited. With
  // multiple comments in the same document, the commented text
  // spans across sibling `<span>` and `<mark>` elements, so the
  // walker has to traverse the entire mirror subtree.
  const walker = document.createTreeWalker(
    mirrorEl,
    NodeFilter.SHOW_TEXT
  );
  let cumulative = 0;
  let node = walker.nextNode() as Text | null;
  let startSet = false;
  while (node) {
    const len = (node.nodeValue ?? '').length;
    const nodeStart = cumulative;
    const nodeEnd = cumulative + len;
    if (!startSet && startIdx <= nodeEnd) {
      // Boundary fix: if `startIdx` is exactly at the end of this
      // node (i.e. `startIdx === nodeEnd`), placing the range start
      // at offset `len` of this node collapses the range to zero
      // width because there's no character at that position — the
      // next character lives in the *next* text node. Detecting
      // this case and advancing to the next node with offset 0
      // keeps the range non-empty so `getBoundingClientRect` can
      // return a real rect.
      if (startIdx === nodeEnd && len > 0) {
        cumulative = nodeEnd;
        node = walker.nextNode() as Text | null;
        continue;
      }
      const offsetInNode = Math.max(0, startIdx - nodeStart);
      range.setStart(node, offsetInNode);
      startSet = true;
    }
    if (startSet && endIdx <= nodeEnd) {
      const offsetInNode = Math.max(0, endIdx - nodeStart);
      range.setEnd(node, offsetInNode);
      return;
    }
    cumulative = nodeEnd;
    node = walker.nextNode() as Text | null;
  }
  // If we ran off the end without setting both endpoints (e.g. the
  // offsets are past the last text node), clamp to the last node.
  if (range.startContainer === null || range.endContainer === null) {
    const lastNode = mirrorEl.lastChild as Text | null;
    if (lastNode) {
      if (!startSet) range.setStart(lastNode, 0);
      range.setEnd(lastNode, (lastNode.nodeValue ?? '').length);
    }
  }
  // Reference `visibleText` and `startNode` are reserved for
  // future per-segment fast paths; the current implementation
  // walks text nodes directly from the mirror.
  void visibleText;
  void startNode;
}

/**
 * Truncate a comment body to the hard cap. Pure. Used by the composer
 * when pasting large content so a single comment can't blow up the
 * LLM prompt.
 */
export function clampCommentBody(body: string): string {
  if (body.length <= COMMENT_HARD_CAP) return body;
  return body.slice(0, COMMENT_HARD_CAP);
}

/**
 * Clamp a box's top-left corner so the entire box stays inside a
 * container rectangle, with a configurable `padding` margin. Used by
 * the composer and popover so the floating dialog never escapes the
 * editor pane — even when the selection is near the pane's left edge
 * (which would otherwise push the `transform: translate(-100%)` box
 * past the pane's left boundary).
 *
 * Pure: no DOM access, all coordinates in the same space (typically
 * pane-local). The caller is expected to have translated
 * `getBoundingClientRect()` results into pane-local coordinates
 * before calling.
 *
 * @param container The container's content rectangle.
 * @param box The box's measured width / height.
 * @param preferred Where the box would prefer to anchor (e.g. the
 *   selection's top-right corner). The function pulls the box back
 *   into the container if `preferred.left + box.width` overflows
 *   `container.right`, etc.
 * @param padding Minimum distance from the container's edges.
 */
export function clampToContainer(
  container: { left: number; top: number; right: number; bottom: number },
  box: { width: number; height: number },
  preferred: { left: number; top: number },
  padding = 8
): { left: number; top: number } {
  const minLeft = container.left + padding;
  const minTop = container.top + padding;
  const maxRight = container.right - padding;
  const maxBottom = container.bottom - padding;
  // Hard ceiling so the box never leaves the container, even when
  // the preferred anchor is far outside (e.g. a stale scroll-offset
  // position). Without this, a preferred.top of 1300+ would survive
  // the "flip above" heuristic and paint the composer off-screen.
  const maxLeft = Math.max(minLeft, maxRight - box.width);
  const maxTop = Math.max(minTop, maxBottom - box.height);
  let left = preferred.left;
  let top = preferred.top;
  if (left > maxLeft) left = maxLeft;
  if (left < minLeft) left = minLeft;
  if (top > maxTop) top = maxTop;
  if (top < minTop) top = minTop;
  return { left, top };
}