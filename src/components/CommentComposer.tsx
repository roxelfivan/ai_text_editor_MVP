import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  COMMENT_HARD_CAP,
  COMMENT_SOFT_CAP,
  clampCommentBody,
  clampToContainer,
} from '@/utils/comments';

/**
 * Inline composer for a brand-new comment. Opened from the toolbar
 * "Comment" button when the editor has a non-empty selection.
 *
 * Anchored to the selection rect via `position` (parent-supplied).
 * Soft cap `COMMENT_SOFT_CAP` (2,000) with a live counter; hard cap
 * `COMMENT_HARD_CAP` (4,000). `⌘/Ctrl+Enter` saves; `Escape` cancels.
 */
interface Props {
  /** Initial body (used when re-opening an existing draft). */
  initialBody?: string;
  /** Selection rect (already translated to editor-pane coords). */
  position: { left: number; top: number; right: number; bottom: number } | null;
  /** Save handler — receives the trimmed (but full) body. */
  onSave: (body: string) => void;
  /** Cancel / close handler. */
  onCancel: () => void;
  /** When true, the composer is positioned as a bottom sheet. */
  bottomSheet?: boolean;
  /**
   * Container bounds (the editor pane) in the same coordinate space
   * as `position`. The composer clamps its top-left so the entire
   * box stays inside this rect — without this, the
   * `transform: translate(-100%, -100%)` anchor would push the
   * composer past the editor's left edge when the selection is near
   * the left of the pane. Defaults to the full viewport when unset.
   */
  containerBounds?: {
    left: number;
    top: number;
    right: number;
    bottom: number;
  } | null;
}

export function CommentComposer({
  initialBody = '',
  position,
  onSave,
  onCancel,
  bottomSheet,
  containerBounds,
}: Props) {
  const [body, setBody] = useState(initialBody);
  const ref = useRef<HTMLTextAreaElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  // The composer's actual rendered size, captured after mount so we
  // can clamp its top-left to stay inside `containerBounds`. We
  // intentionally default to {0, 0} so the first render (before
  // measurement) still positions the box in a sensible place
  // (top-left of the preferred anchor) rather than flashing at
  // (0, 0).
  const [boxSize, setBoxSize] = useState<{ width: number; height: number }>({
    width: 320,
    height: 200,
  });

  // Measure the composer's actual rendered size after mount. We use
  // `useLayoutEffect` so the measured dimensions are available before
  // the browser paints — otherwise the user would see a one-frame
  // flash at the un-clamped position before the box jumps into the
  // clamped spot. We only re-measure when the wrapper's content
  // height changes (text grows / shrinks) — `boxSize` state holds
  // the last measured value.
  useLayoutEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      setBoxSize((prev) => {
        if (prev.width === r.width && prev.height === r.height) return prev;
        return { width: r.width, height: r.height };
      });
    };
    measure();
    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(measure);
      ro.observe(el);
      return () => ro.disconnect();
    }
  }, []);

  // Auto-focus the textarea when the composer opens so the user can
  // start typing immediately. Mobile keyboards respect the focus call
  // and bring up the soft keyboard without an extra tap.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Defer to next tick so the textarea is mounted + visible.
    queueMicrotask(() => {
      try {
        el.focus({ preventScroll: true });
      } catch {
        el.focus();
      }
      // Place the caret at the end of the existing body so the user
      // doesn't have to click to continue typing.
      const len = body.length;
      try {
        el.setSelectionRange(len, len);
      } catch {
        /* ignore */
      }
    });
  }, [body.length]);

  // Escape key cancels.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onCancel]);

  const trimmed = body.trim();
  const canSave = trimmed.length > 0;
  const overSoft = body.length > COMMENT_SOFT_CAP;
  const overHard = body.length >= COMMENT_HARD_CAP;

  const handleSave = () => {
    if (!canSave) return;
    onSave(clampCommentBody(body));
  };

  const style: React.CSSProperties | undefined = bottomSheet
    ? undefined
    : position
      ? (() => {
          // Default container = the whole viewport. The parent
          // (Editor.tsx) supplies the actual editor-pane bounds when
          // it can; falling back to the viewport keeps the composer
          // at least on-screen even if the parent forgot to pass
          // the bounds. The `position` prop and `containerBounds` are
          // expected to be in the same coordinate space — by
          // convention, both are pane-local (the parent subtracts
          // the pane's getBoundingClientRect().left / .top before
          // passing `position`). That way the math below works
          // directly in the wrapper's absolute coord system.
          const c = containerBounds ?? {
            left: 0,
            top: 0,
            right: window.innerWidth,
            bottom: window.innerHeight,
          };
          // The composer's anchor point is the selection's top-right
          // corner. We want the box's top-right corner at that point
          // (i.e. translate(-100%, -100%)), so the box's *top-left*
          // lives at (anchor - box).
          const preferredTopLeft = {
            left: position.right - boxSize.width,
            top: position.top - boxSize.height,
          };
          // Clamp into the container. The helper works in
          // container-local space (0..container.width × 0..container.height).
          const clamped = clampToContainer(
            { left: 0, top: 0, right: c.right - c.left, bottom: c.bottom - c.top },
            boxSize,
            {
              left: preferredTopLeft.left - c.left,
              top: preferredTopLeft.top - c.top,
            }
          );
          return {
            position: 'absolute',
            left: `${clamped.left + c.left}px`,
            top: `${clamped.top + c.top}px`,
            // No transform — we already positioned at the top-left.
          };
        })()
      : { position: 'absolute', left: '50%', top: '50%' };

  return (
    <div
      ref={wrapperRef}
      className={[
        'cm-composer',
        bottomSheet ? 'cm-composer--sheet' : '',
        overSoft ? 'cm-composer--warn' : '',
        overHard ? 'cm-composer--error' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      style={style}
      // Prevent clicks inside the composer from being treated as
      // outside-tap by the parent (which would close it).
      onPointerDown={(e) => e.stopPropagation()}
    >
      <textarea
        ref={ref}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="Write a comment…"
        rows={4}
        // 44 × 44 px minimum tap target is enforced via min-height on
        // the textarea in CSS, not as a literal size.
        className="cm-composer__textarea"
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            handleSave();
          }
        }}
        aria-label="Comment body"
      />
      <div className="cm-composer__footer">
        <span
          className="cm-composer__count"
          aria-live="polite"
          aria-atomic="true"
        >
          {body.length}/{COMMENT_SOFT_CAP}
          {overSoft ? ' — long comment' : ''}
        </span>
        <div className="cm-composer__actions">
          <button
            type="button"
            className="cm-composer__btn cm-composer__btn--ghost"
            onClick={onCancel}
            // onMouseDown = handler keeps the focus inside the textarea
            // so the soft keyboard stays open on mobile.
            onMouseDown={(e) => e.preventDefault()}
          >
            Cancel
          </button>
          <button
            type="button"
            className="cm-composer__btn cm-composer__btn--primary"
            onClick={handleSave}
            disabled={!canSave}
            onMouseDown={(e) => e.preventDefault()}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}