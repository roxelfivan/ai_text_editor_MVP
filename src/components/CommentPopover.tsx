import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Comment } from '@/types';
import {
  COMMENT_HARD_CAP,
  COMMENT_SOFT_CAP,
  clampCommentBody,
  clampToContainer,
} from '@/utils/comments';

/**
 * Non-modal read/edit popover for a single comment. Anchored to a
 * margin badge.
 *
 * - **Read** (default): body + `[Edit] [Delete] [×]`. Escape or
 *   outside-tap closes. Outdated comments show a warning banner.
 * - **Edit**: textarea + `[Save] [Cancel]`. `⌘/Ctrl+Enter` saves;
 *   `Escape` cancels.
 *
 * Sent comments remain editable and deletable; the `sent` flag is
 * only a visual header indicator.
 */
interface Props {
  comment: Comment;
  /** Index in the document (1-based). Used in the popover header. */
  index: number;
  /** Anchored position; supplied by the parent (margin column / etc). */
  position: { left: number; top: number } | null;
  /** Save body edits. */
  onSaveBody: (id: string, body: string) => void;
  /** Delete the comment. */
  onDelete: (id: string) => void;
  /** Close the popover. */
  onClose: () => void;
  /** Use the bottom-sheet layout on small viewports. */
  bottomSheet?: boolean;
  /**
   * Container bounds (the editor pane) in the same coordinate space
   * as `position`. The popover clamps its top-left so the entire box
   * stays inside this rect.
   */
  containerBounds?: {
    left: number;
    top: number;
    right: number;
    bottom: number;
  } | null;
}

export function CommentPopover({
  comment,
  index,
  position,
  onSaveBody,
  onDelete,
  onClose,
  bottomSheet,
  containerBounds,
}: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(comment.body);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  // Same idea as `CommentComposer`: default size so the first render
  // positions the box sensibly before measurement, then refine on
  // mount + on resize.
  const [boxSize, setBoxSize] = useState<{ width: number; height: number }>({
    width: 320,
    height: 200,
  });

  const isSent = comment.sent;

  // Measure the popover's actual rendered size after mount + on
  // resize. We use `useLayoutEffect` so the first paint already
  // shows the clamped position; without it, the box would flash at
  // the unclamped spot for one frame.
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
  }, [editing]);

  // Escape key closes / cancels depending on mode.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        if (editing) {
          setEditing(false);
          setDraft(comment.body);
        } else {
          onClose();
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [editing, comment.body, onClose]);

  // Auto-focus textarea when entering edit mode.
  useEffect(() => {
    if (!editing) return;
    const el = textareaRef.current;
    if (!el) return;
    queueMicrotask(() => {
      try {
        el.focus({ preventScroll: true });
      } catch {
        el.focus();
      }
    });
  }, [editing]);

  const trimmed = draft.trim();
  const overSoft = draft.length > COMMENT_SOFT_CAP;
  const overHard = draft.length >= COMMENT_HARD_CAP;
  const canSave = trimmed.length > 0;

  const handleSave = () => {
    if (!canSave) return;
    onSaveBody(comment.id, clampCommentBody(draft));
    setEditing(false);
  };

  const handleDelete = () => {
    onDelete(comment.id);
    onClose();
  };

  const style: React.CSSProperties | undefined = bottomSheet
    ? undefined
    : position
      ? (() => {
          // Same clamp-to-container logic as CommentComposer. The
          // popover's anchor is the margin badge's right edge; we
          // want the box's top-right at that anchor (translateX
          // -100%), so the box's top-left is at (anchor.x -
          // box.width, anchor.y).
          const c = containerBounds ?? {
            left: 0,
            top: 0,
            right: window.innerWidth,
            bottom: window.innerHeight,
          };
          const preferredTopLeft = {
            left: position.left - boxSize.width,
            top: position.top,
          };
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
          };
        })()
      : { position: 'absolute', left: '50%', top: '50%' };

  return (
    <div
      ref={wrapperRef}
      className={[
        'cm-popover',
        bottomSheet ? 'cm-popover--sheet' : '',
        comment.outdated ? 'cm-popover--outdated' : '',
        isSent ? 'cm-popover--sent' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      style={style}
      role="dialog"
      aria-label={`Comment ${index}`}
      // Prevent clicks inside the popover from being treated as
      // outside-tap by the parent.
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="cm-popover__header">
        <span className="cm-popover__index">{index}</span>
        <span className="cm-popover__title">
          {comment.outdated
            ? 'Outdated — anchor needs attention'
            : isSent
              ? 'Sent to AI'
              : 'Comment'}
        </span>
        <button
          type="button"
          className="cm-popover__close"
          onClick={onClose}
          aria-label="Close"
          onMouseDown={(e) => e.preventDefault()}
        >
          ×
        </button>
      </div>

      {comment.outdated && (
        <div className="cm-popover__banner" role="alert">
          The text you commented on moved or was deleted. Edit or
          delete this comment.
        </div>
      )}

      {editing ? (
        <>
          <textarea
            ref={textareaRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            className={[
              'cm-popover__textarea',
              overSoft ? 'cm-popover__textarea--warn' : '',
              overHard ? 'cm-popover__textarea--error' : '',
            ]
              .filter(Boolean)
              .join(' ')}
            rows={5}
            aria-label="Edit comment"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                handleSave();
              }
            }}
          />
          <div className="cm-popover__counter">
            {draft.length}/{COMMENT_SOFT_CAP}
            {overSoft ? ' — long comment' : ''}
          </div>
        </>
      ) : (
        <div className="cm-popover__body">
          {comment.body.trim() ? (
            comment.body
          ) : (
            <em className="cm-popover__empty">(empty comment)</em>
          )}
        </div>
      )}

      <div className="cm-popover__footer">
        {editing ? (
          <>
            <button
              type="button"
              className="cm-popover__btn cm-popover__btn--ghost"
              onClick={() => {
                setEditing(false);
                setDraft(comment.body);
              }}
              onMouseDown={(e) => e.preventDefault()}
            >
              Cancel
            </button>
            <button
              type="button"
              className="cm-popover__btn cm-popover__btn--primary"
              onClick={handleSave}
              disabled={!canSave}
              onMouseDown={(e) => e.preventDefault()}
            >
              Save
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              className="cm-popover__btn cm-popover__btn--ghost"
              onClick={handleDelete}
              onMouseDown={(e) => e.preventDefault()}
              aria-label="Delete comment"
            >
              Delete
            </button>
            <button
              type="button"
              className="cm-popover__btn cm-popover__btn--primary"
              onClick={() => setEditing(true)}
              onMouseDown={(e) => e.preventDefault()}
            >
              Edit
            </button>
          </>
        )}
      </div>
    </div>
  );
}