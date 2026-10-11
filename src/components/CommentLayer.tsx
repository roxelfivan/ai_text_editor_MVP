import { forwardRef, memo, useMemo } from 'react';
import type { Comment } from '@/types';

/**
 * Mirror overlay that renders the document text with `<mark>` spans at
 * each comment's `(start, end)` range, then sits behind the editor's
 * textarea so the highlights are visible without modifying the textarea
 * itself.
 *
 * The textarea is made `color: transparent` so its text is invisible;
 * the only thing the user sees in the editor's writing area is the
 * mirror's text. The caret is the only visible glyph drawn by the
 * textarea (via `caret-color`), so cursor / selection rectangles /
 * inline-completion ghost text all keep painting above the highlight.
 *
 * The mirror and the textarea share identical font / padding / wrap
 * settings via the `.cm-mirror` and `.comment-textarea` CSS classes
 * declared in `src/index.css`. The parent `<Editor>` is responsible
 * for keeping `scrollTop` synchronized between the two.
 *
 * The overlay is `pointer-events: none` and `aria-hidden` so it never
 * interferes with typing or selection. It also forwards a ref so the
 * parent can call `getSelectionRect(mirrorEl, start, end)` from
 * `src/utils/comments.ts` to position the floating composer.
 */
interface Props {
  /** Full document text. */
  content: string;
  /** Comments to highlight. Sorted by `(start, end)` by the parent. */
  comments: Comment[];
  /** Optional className appended to `.cm-mirror`. */
  className?: string;
}

export const CommentLayer = memo(
  forwardRef<HTMLDivElement, Props>(function CommentLayer(
    { content, comments, className },
    ref
  ) {
    // Pre-sort + merge so we can render the highlights in one pass.
    // Two `<mark>` spans that touch or overlap share the same color
    // token — overlapping highlights are an additive effect handled by
    // the CSS class via `rgba(..., 0.22)` background + transparent
    // text. (See `.cm-highlight` in `src/index.css`.)
    const segments = useMemo(
      () => buildSegments(content, comments),
      [content, comments]
    );

    return (
      <div
        ref={ref}
        aria-hidden
        className={['cm-mirror', className].filter(Boolean).join(' ')}
      >
        {segments.map((seg, i) =>
          seg.kind === 'text' ? (
            // Plain text segment. React handles `\n` via the
            // `white-space: pre-wrap` rule on `.cm-mirror`, so each
            // newline in `content` produces a real line break.
            <span key={i}>{seg.value}</span>
          ) : (
            <mark
              key={i}
              className={[
                'cm-highlight',
                seg.outdated ? 'cm-highlight--outdated' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              data-comment-id={seg.commentId}
              // `pointer-events` on the mark is overridden by the
              // parent's `pointer-events: none`, so the editor's
              // textarea remains the only click target.
              aria-hidden
            >
              {seg.value}
            </mark>
          )
        )}
      </div>
    );
  })
);

interface Segment {
  kind: 'text' | 'mark';
  value: string;
  commentId?: string;
  outdated?: boolean;
}

/**
 * Slice `content` into alternating text / mark segments based on the
 * active comments. Sort comments by `(start, end)` first so document
 * order is preserved; overlapping ranges render as nested `<mark>`
 * spans (React + the browser handle this naturally — the inner mark
 * inherits the outer mark's class for stacked tints).
 *
 * Defensive against malformed offsets: any comment whose `(start, end)`
 * is out of bounds or inverted is dropped from the highlight but left
 * in the comments list so the popover can still surface it.
 */
function buildSegments(content: string, comments: Comment[]): Segment[] {
  if (comments.length === 0) {
    return [{ kind: 'text', value: content }];
  }

  // Build an event timeline: at each boundary, a comment starts or ends.
  type Event = { at: number; type: 'start' | 'end'; comment: Comment };
  const events: Event[] = [];
  for (const c of comments) {
    const start = Math.max(0, Math.min(c.start, content.length));
    const end = Math.max(start, Math.min(c.end, content.length));
    if (start === end) continue;
    events.push({ at: start, type: 'start', comment: c });
    events.push({ at: end, type: 'end', comment: c });
  }
  events.sort((a, b) => a.at - b.at || (a.type === 'end' ? -1 : 1));

  const segments: Segment[] = [];
  let cursor = 0;
  const openStack: Comment[] = [];
  for (const ev of events) {
    if (ev.at > cursor) {
      segments.push({ kind: 'text', value: content.slice(cursor, ev.at) });
      cursor = ev.at;
    }
    if (ev.type === 'start') {
      openStack.push(ev.comment);
    } else {
      const idx = openStack.findIndex((c) => c.id === ev.comment.id);
      if (idx !== -1) openStack.splice(idx, 1);
    }
    if (openStack.length > 0) {
      // Find the next event position (or end of content) to know how
      // much text to consume for this mark segment.
      const nextAt =
        events.find((e) => e.at > ev.at)?.at ?? content.length;
      if (nextAt > cursor) {
        segments.push({
          kind: 'mark',
          value: content.slice(cursor, nextAt),
          commentId: openStack[0]?.id,
          outdated: openStack.some((c) => c.outdated),
        });
        cursor = nextAt;
      }
    }
  }
  if (cursor < content.length) {
    segments.push({ kind: 'text', value: content.slice(cursor) });
  }
  return segments;
}
