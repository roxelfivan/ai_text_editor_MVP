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
/**
 * Mirror top-level `(start, end, snippet, outdated)` onto the
 * comment's latest round so CommentLayer / margin badges (which
 * read the top-level fields) and round history stay in sync.
 */
function withLatestRoundAnchor(
  comment: Comment,
  patch: {
    start: number;
    end: number;
    snippet: string;
    outdated?: boolean;
  }
): Comment {
  const next: Comment = {
    ...comment,
    start: patch.start,
    end: patch.end,
    snippet: patch.snippet,
    outdated: patch.outdated ?? comment.outdated,
    updatedAt: Date.now(),
  };
  if (Array.isArray(comment.rounds) && comment.rounds.length > 0) {
    const lastIdx = comment.rounds.length - 1;
    const last = comment.rounds[lastIdx];
    next.rounds = [
      ...comment.rounds.slice(0, lastIdx),
      {
        ...last,
        start: patch.start,
        end: patch.end,
        snippet: patch.snippet,
        outdated: patch.outdated ?? last.outdated,
        updatedAt: Date.now(),
      },
    ];
  }
  return next;
}

/**
 * Manually re-attach an outdated comment to a new editor range.
 * Clears `outdated` on the comment and its latest round.
 */
export function reattachCommentToRange(
  content: string,
  comment: Comment,
  start: number,
  end: number
): Comment | null {
  if (
    start < 0 ||
    end <= start ||
    end > content.length ||
    start > content.length
  ) {
    return null;
  }
  const snippet = content.slice(start, end);
  if (!snippet) return null;
  return withLatestRoundAnchor(comment, {
    start,
    end,
    snippet,
    outdated: false,
  });
}

export function reanchorComment(doc: string, comment: Comment): Comment {
  if (comment.outdated) {
    // Once outdated, skip auto-recovery — keep the flag until the
    // user edits or deletes the comment from the popover.
    return comment;
  }

  // After Apply, the highlight must cover the ADOPTED replacement,
  // not the pre-change original (which is gone) and not a wider
  // fuzzy reconstruction. Prefer the latest applied replacement
  // as the search target whenever one exists.
  const lastApplied =
    Array.isArray(comment.rounds) && comment.rounds.length > 0
      ? comment.rounds[comment.rounds.length - 1].applied[
          comment.rounds[comment.rounds.length - 1].applied.length - 1
        ]
      : undefined;
  const targetSnippet =
    lastApplied?.replacement && lastApplied.replacement.length > 0
      ? lastApplied.replacement
      : comment.snippet;

  // 1) Offset-preserving check.
  const safeStart = Math.max(0, Math.min(comment.start, doc.length));
  const safeEnd = Math.max(safeStart, Math.min(comment.end, doc.length));
  if (
    safeEnd > safeStart &&
    doc.slice(safeStart, safeEnd) === targetSnippet
  ) {
    // Offsets already cover the adopted text. Sync snippet if a
    // prior pass left it pointing at the pre-change original.
    if (comment.snippet === targetSnippet) return comment;
    return withLatestRoundAnchor(comment, {
      start: safeStart,
      end: safeEnd,
      snippet: targetSnippet,
    });
  }

  // Empty snippet (a degenerate comment from older data) → nothing to
  // search for. Mark outdated so the user can clean it up.
  if (!targetSnippet) {
    return { ...comment, outdated: true };
  }

  // 2) Local search — ±200 chars around the original position.
  const localWindow = 200;
  const localStart = Math.max(0, comment.start - localWindow);
  const localEnd = Math.min(doc.length, comment.end + localWindow);
  const localHay = doc.slice(localStart, localEnd);
  const localIdx = localHay.indexOf(targetSnippet);
  if (localIdx !== -1) {
    const newStart = localStart + localIdx;
    const newEnd = newStart + targetSnippet.length;
    return withLatestRoundAnchor(comment, {
      start: newStart,
      end: newEnd,
      snippet: targetSnippet,
    });
  }

  // 3) Full-document fuzzy match via the existing helper.
  const anchor = findEditAnchor(doc, targetSnippet);
  if (anchor) {
    return withLatestRoundAnchor(comment, {
      start: anchor.idx,
      end: anchor.idx + anchor.length,
      // Keep the authoritative target (esp. applied replacement)
      // rather than a fuzzy-expanded doc slice.
      snippet: targetSnippet,
    });
  }

  // 4) Substring fallback — first/last 30 chars anchored independently.
  // Skip this for applied-replacement anchors: expanding via head/tail
  // is what produced oversized highlights that no longer fit the
  // Proposed text. Only use it for never-applied comment snippets.
  if (!lastApplied?.replacement) {
    const head = targetSnippet.slice(0, 30);
    const tail = targetSnippet.slice(-30);
    if (head && tail && head !== tail) {
      const headIdx = doc.indexOf(head);
      if (headIdx !== -1) {
        const tailIdx = doc.indexOf(tail, headIdx + head.length);
        if (tailIdx !== -1) {
          const newEnd = tailIdx + tail.length;
          if (newEnd > headIdx) {
            return withLatestRoundAnchor(comment, {
              start: headIdx,
              end: newEnd,
              snippet: doc.slice(headIdx, newEnd),
            });
          }
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
 * Number of characters of surrounding context included on each side
 * of a commented passage in the user message. Tuned to be small
 * enough to keep the per-comment cost low (~30 tokens) but large
 * enough that the model can resolve the snippet's position in the
 * document without re-reading the whole thing. Trimmed to the
 * nearest paragraph / sentence boundary when feasible so we never
 * cut a word in half.
 */
const CONTEXT_WINDOW_CHARS = 120;

/**
 * Build the user-message body sent to the LLM when the user clicks
 * "Send to AI" in the comment tray.
 *
 * Each comment emits a self-contained block carrying:
 *   - a short model-friendly id (`c1`, `c2`, …) in document order,
 *   - the paragraph index inside the document (so the model can
 *     place the snippet without re-locating it via fuzzy match),
 *   - the byte-offset range,
 *   - the verbatim snippet (kept byte-exact — `proposed-edit.original`
 *     matches against this),
 *   - a small context window before/after the snippet, and
 *   - the user's comment body.
 *
 * The full document is *not* inlined here; `buildRequestMessages`
 * emits it as a system message (outline + only the referenced
 * paragraphs) so the per-turn prompt is cheap even on long docs.
 * `looksLikeCommentBatch` in `src/api/chat.ts` matches the block
 * shape produced here — keep the two in sync.
 */
export function formatCommentBatch(
  doc: string,
  comments: Comment[]
): string {
  // Sort by document position so the user (and the AI) can read the
  // batch top-to-bottom in the same order the passages appear.
  const sorted = [...comments].sort((a, b) => a.start - b.start);

  // Pre-compute paragraph boundaries once. `paragraphs[i]` is the
  // start offset of the i-th paragraph (0-based), and the document
  // length acts as the implicit end of the last paragraph. We treat
  // both `\n\n` and single `\n` as paragraph breaks because the
  // editor accepts hard-wrapped single newlines as paragraph
  // separators in practice (textarea + markdown rendering).
  const paragraphStarts: number[] = [0];
  for (let i = 0; i < doc.length; i++) {
    if (doc.charCodeAt(i) === 10 /* \n */) {
      const next = i + 1;
      if (next < doc.length && paragraphStarts[paragraphStarts.length - 1] !== next) {
        paragraphStarts.push(next);
      }
    }
  }
  const totalParagraphs = paragraphStarts.length;

  const lines: string[] = [];

  sorted.forEach((c, i) => {
    const id = `c${i + 1}`;
    const paraIndex = paragraphIndexFor(paragraphStarts, c.start);
    const before = contextBefore(doc, c.start, CONTEXT_WINDOW_CHARS);
    const after = contextAfter(doc, c.end, CONTEXT_WINDOW_CHARS);
    // Raw triple-quote block for Before/After — was previously
    // JSON.stringify-wrapped, which added ~12 chars per side per
    // comment for no semantic gain (the model never needs valid
    // JSON here, just the prose). Trimmed for ~5-10 % saving on
    // long comment batches. The `[id] -> docs` cross-reference map
    // (added in chat.ts) instructs the model NOT to quote Before/
    // After back, so the raw form is the right read affordance.
    lines.push(
      `[${id}] (paragraph ${paraIndex + 1}/${totalParagraphs}, doc offset ${c.start}–${c.end})`,
      `"${c.snippet}"`,
      `Before: """${before}"""`,
      `After: """${after}"""`,
      `Comment: ${c.body}`,
      ''
    );
  });

  return lines.join('\n').trimEnd() + '\n';
}

/**
 * Find which paragraph (0-based) contains the given document offset.
 * `paragraphStarts` is the precomputed array of paragraph start
 * offsets, sorted ascending. Returns the largest index whose start
 * is `<= offset`.
 */
function paragraphIndexFor(paragraphStarts: number[], offset: number): number {
  // Linear scan is fine — paragraph counts are O(doc/avg-paragraph)
  // which is at most a few hundred for any realistic document, and
  // we do this once per comment.
  let idx = 0;
  for (let i = 0; i < paragraphStarts.length; i++) {
    if (paragraphStarts[i] <= offset) idx = i;
    else break;
  }
  return idx;
}

/**
 * Up to `max` characters of context immediately preceding `start` in
 * `doc`, trimmed to the nearest word/paragraph boundary when
 * possible so the slice doesn't begin mid-word.
 */
function contextBefore(doc: string, start: number, max: number): string {
  if (start <= 0) return '';
  const lo = Math.max(0, start - max);
  let slice = doc.slice(lo, start);
  // If we didn't capture from the very start of a paragraph, push
  // the slice forward to the first whitespace so we don't begin
  // mid-word.
  if (lo > 0) {
    const sp = slice.indexOf(' ');
    if (sp !== -1 && sp < slice.length - 1) {
      slice = slice.slice(sp + 1);
    }
  }
  return slice;
}

/**
 * Up to `max` characters of context immediately following `end` in
 * `doc`, trimmed to the nearest word/paragraph boundary when
 * possible so the slice doesn't end mid-word.
 */
function contextAfter(doc: string, end: number, max: number): string {
  if (end >= doc.length) return '';
  const hi = Math.min(doc.length, end + max);
  let slice = doc.slice(end, hi);
  // If we didn't capture to the end of the document / paragraph,
  // pull the slice back to the last whitespace so we don't end
  // mid-word.
  if (hi < doc.length) {
    const sp = slice.lastIndexOf(' ');
    if (sp > 0) slice = slice.slice(0, sp);
  }
  return slice;
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
 * Predicate: is this comment's latest-round anchor no longer findable
 * in `content`? Mirrors the strategies used by `reanchorComment` so
 * a UI surface (e.g. `CommentTray`) can flag stale rows without
 * mutating anything.
 *
 * Returns `false` for comments that are already `outdated: true`
 * (the same answer they would get from running the re-anchor pass),
 * so callers can rely on the predicate without first checking the
 * flag.
 *
 * Pure. No React / DOM imports.
 */
export function isCommentStale(comment: Comment, content: string): boolean {
  // Already-flagged comments stay stale; the re-anchor pass skips
  // them entirely so the predicate has to short-circuit too.
  if (comment.outdated) return true;

  const snippet = comment.snippet;
  if (!snippet) return true;

  // Strategy 1: byte-exact match at the current offsets.
  if (
    comment.start >= 0 &&
    comment.end <= content.length &&
    comment.end > comment.start &&
    content.slice(comment.start, comment.end) === snippet
  ) {
    return false;
  }
  // Strategy 2: full-document fuzzy match via the same helper the
  // re-anchor pass uses (`findEditAnchor` handles whitespace /
  // Setext / ATX / escape drift).
  return findEditAnchor(content, snippet) === null;
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