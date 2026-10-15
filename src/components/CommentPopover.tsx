import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import ReactMarkdown from 'react-markdown';
import type {
  Comment,
  CommentRound,
  MentionToken,
  ProposedEditRationale,
} from '@/types';
import { useStore } from '@/store/useStore';
import {
  buildEditableMentionBody,
  parseMentions,
  parseMentionsWithRanges,
} from '@/components/mentions/parseMentions';
import { MentionInput } from '@/components/mentions/MentionInput';
import {
  COMMENT_HARD_CAP,
  COMMENT_SOFT_CAP,
  clampCommentBody,
  clampToContainer,
} from '@/utils/comments';
import { lineDiff } from '@/utils/diff';
import { remarkPlugins, rehypePlugins } from '@/utils/markdown';
import { ResizeHandle } from '@/components/ResizeHandle';
import {
  useDragResize,
  applyHandle,
  clamp,
  MIN_POPOVER_WIDTH,
  MAX_POPOVER_WIDTH,
  MIN_POPOVER_HEIGHT,
  MAX_POPOVER_HEIGHT,
  type ResizeHandle as HandleName,
} from '@/hooks/useDragResize';
import { popoverSizeKey as storagePopoverSizeKey } from '@/utils/storage';

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
  /**
   * Save body edits. `mentions` is the live @-document reference list
   * from the edit-mode MentionInput (may be empty when the user
   * removed every reference).
   */
  onSaveBody: (id: string, body: string, mentions: MentionToken[]) => void;
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
  // Edit mode uses MentionInput so `@` works the same as create.
  // Rebuild the textarea value from body sentinels, or from the
  // latest round's mentions when an older edit path stripped them.
  const latestRoundMentions =
    comment.rounds[comment.rounds.length - 1]?.mentions;
  const [draft, setDraft] = useState(() =>
    buildEditableMentionBody(comment.body, latestRoundMentions)
  );
  const [draftMentions, setDraftMentions] = useState<MentionToken[]>(() => {
    const { mentions: fromBody } = parseMentions(comment.body);
    return fromBody.length > 0 ? fromBody : latestRoundMentions ?? [];
  });
  const wrapperRef = useRef<HTMLDivElement>(null);
  // Same idea as `CommentComposer`: default size so the first render
  // positions the box sensibly before measurement, then refine on
  // mount + on resize.
  const [boxSize, setBoxSize] = useState<{ width: number; height: number }>({
    width: 320,
    height: 200,
  });

  // User-resizable size. Persisted per comment id in localStorage so
  // the popover remembers the user's chosen size across opens. When
  // unset, the popover falls back to its CSS default (320px wide,
  // auto height) — the resize handles still work, but the popover
  // starts un-sized.
  const [userSize, setUserSize] = useState<{
    w: number;
    h: number;
  } | null>(() => {
    const loaded = loadPopoverSize(comment.id);
    return loaded ? { w: loaded.width, h: loaded.height } : null;
  });
  // Drag origin captured when a handle is pressed so `onDelta` can
  // compute the next size relative to the size at the start of the
  // drag (rather than relative to a 0 baseline that drifts over
  // time).
  const startSizeRef = useRef<{ w: number; h: number }>(
    userSize ?? { w: 320, h: 200 }
  );
  const activeHandleRef = useRef<HandleName | null>(null);

  // Drag wiring — free mode so all 8 handles work, then `applyHandle`
  // picks the right axes from the active handle.
  const { start: beginResize } = useDragResize({
    mode: 'free',
    onDelta: ({ dx, dy }) => {
      const handle = activeHandleRef.current;
      if (!handle) return;
      const next = applyHandle(
        handle,
        startSizeRef.current.w,
        startSizeRef.current.h,
        dx,
        dy
      );
      const w = clamp(next.w, MIN_POPOVER_WIDTH, MAX_POPOVER_WIDTH);
      const h = clamp(next.h, MIN_POPOVER_HEIGHT, MAX_POPOVER_HEIGHT);
      // Skip the setState if nothing changed so the popover doesn't
      // re-render on every idle rAF tick.
      if (
        userSize &&
        userSize.w === w &&
        userSize.h === h
      ) {
        return;
      }
      setUserSize({ w, h });
    },
  });
  const onResizePointerDown = (handle: HandleName) =>
    (e: React.PointerEvent<HTMLElement>) => {
      // Capture the size at drag start. Prefer the user's chosen
      // size; fall back to the live measured size so a first-time
      // drag from the CSS default still feels continuous.
      if (userSize) {
        startSizeRef.current = userSize;
      } else if (wrapperRef.current) {
        const r = wrapperRef.current.getBoundingClientRect();
        startSizeRef.current = { w: r.width, h: r.height };
      } else {
        startSizeRef.current = { w: 320, h: 200 };
      }
      activeHandleRef.current = handle;
      beginResize(handle, e);
    };

  const isSent = comment.sent;

  // Persist the user's size whenever it changes (debounced via the
  // setState coalescing — no rAF dedupe needed because the value
  // only changes when the drag actually crosses a pixel boundary).
  useEffect(() => {
    if (!userSize) return;
    try {
      localStorage.setItem(
        popoverSizeKey(comment.id),
        JSON.stringify({ width: userSize.w, height: userSize.h })
      );
    } catch {
      /* ignore quota / private-mode errors */
    }
  }, [userSize, comment.id]);

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
          const rebuilt = buildEditableMentionBody(
            comment.body,
            comment.rounds[comment.rounds.length - 1]?.mentions
          );
          setDraft(rebuilt);
          const { mentions: fromBody } = parseMentions(rebuilt);
          setDraftMentions(fromBody);
        } else {
          onClose();
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [editing, comment.body, onClose]);

  // Auto-focus is handled by MentionInput via `autoFocus` when editing.

  const { plain: draftPlain } = parseMentions(draft);
  const trimmed = draftPlain.trim();
  const overSoft = draftPlain.length > COMMENT_SOFT_CAP;
  const overHard = draftPlain.length >= COMMENT_HARD_CAP;
  // Allow save when there is prose OR at least one @-reference.
  const canSave = trimmed.length > 0 || draftMentions.length > 0;

  const handleSave = () => {
    if (!canSave) return;
    onSaveBody(comment.id, clampCommentBody(draft), draftMentions);
    setEditing(false);
  };

  const resetDraftFromComment = () => {
    const rebuilt = buildEditableMentionBody(
      comment.body,
      comment.rounds[comment.rounds.length - 1]?.mentions
    );
    setDraft(rebuilt);
    const { mentions: fromBody } = parseMentions(rebuilt);
    setDraftMentions(fromBody);
  };

  const handleDelete = () => {
    onDelete(comment.id);
    onClose();
  };

  // The size we use to position the popover is the user's chosen
  // size when set, otherwise the live measured size (which is the
  // CSS default before the user has dragged any handle). This keeps
  // the anchor math consistent before AND after a resize.
  const positioningSize = userSize
    ? { width: userSize.w, height: userSize.h }
    : boxSize;

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
            left: position.left - positioningSize.width,
            top: position.top,
          };
          const clamped = clampToContainer(
            { left: 0, top: 0, right: c.right - c.left, bottom: c.bottom - c.top },
            positioningSize,
            {
              left: preferredTopLeft.left - c.left,
              top: preferredTopLeft.top - c.top,
            }
          );
          // Inline width/height so the user's chosen size wins over
          // the CSS `width: 320px` default. `maxHeight` keeps the
          // popover inside the editor pane even on short viewports.
          return {
            position: 'absolute',
            left: `${clamped.left + c.left}px`,
            top: `${clamped.top + c.top}px`,
            width: userSize ? `${userSize.w}px` : undefined,
            height: userSize ? `${userSize.h}px` : undefined,
            maxHeight: userSize
              ? `${Math.min(userSize.h, c.bottom - c.top - 16)}px`
              : undefined,
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
          <MentionInput
            value={draft}
            onChange={(v) => {
              setDraft(v.text);
              setDraftMentions(v.mentions);
            }}
            onSubmit={handleSave}
            ariaLabel="Edit comment"
            placeholder="Edit comment… type @ to reference a document"
            className={[
              'cm-popover__textarea',
              overSoft ? 'cm-popover__textarea--warn' : '',
              overHard ? 'cm-popover__textarea--error' : '',
            ]
              .filter(Boolean)
              .join(' ')}
            autoFocus
          />
          <div className="cm-popover__counter">
            {draftPlain.length}/{COMMENT_SOFT_CAP}
            {overSoft ? ' — long comment' : ''}
          </div>
        </>
      ) : (
        <div className="cm-popover__body">
          {(() => {
            const { plain, mentions } = parseMentions(comment.body);
            if (plain.trim() || mentions.length > 0) {
              return (
                <CommentBodyWithChips
                  text={comment.body}
                  getDocById={(id) =>
                    useStore.getState().documents.find((d) => d.id === id) ??
                    null
                  }
                  onDocumentClick={(id) => {
                    // Switch the editor to the referenced document so
                    // the user can read the source in context.
                    useStore.getState().setCurrentDocument(id);
                    onClose();
                  }}
                />
              );
            }
            return (
              <em className="cm-popover__empty">(empty comment)</em>
            );
          })()}
        </div>
      )}

      <RationaleSection comment={comment} />

      <div className="cm-popover__footer">
        {editing ? (
          <>
            <button
              type="button"
              className="cm-popover__btn cm-popover__btn--ghost"
              onClick={() => {
                setEditing(false);
                resetDraftFromComment();
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
              onClick={() => {
                resetDraftFromComment();
                setEditing(true);
              }}
              onMouseDown={(e) => e.preventDefault()}
            >
              Edit
            </button>
          </>
        )}
      </div>

      {/* 8 resize handles. Same shape as the ProposedEditCard so the
          affordance reads consistently across the app: thin hit
          areas on every edge + corner, with a slightly thicker
          bottom-right corner for users on a trackpad. Hidden when
          the popover is in bottom-sheet mode — there's no useful
          surface to resize on mobile, and the popover is already
          full-width. */}
      {!bottomSheet && (
        <>
          <ResizeHandle handle="top" onPointerDown={onResizePointerDown('top')} />
          <ResizeHandle handle="bottom" onPointerDown={onResizePointerDown('bottom')} />
          <ResizeHandle handle="left" onPointerDown={onResizePointerDown('left')} />
          <ResizeHandle handle="right" onPointerDown={onResizePointerDown('right')} />
          <ResizeHandle handle="tl" onPointerDown={onResizePointerDown('tl')} />
          <ResizeHandle handle="tr" onPointerDown={onResizePointerDown('tr')} />
          <ResizeHandle handle="bl" onPointerDown={onResizePointerDown('bl')} />
          <ResizeHandle handle="br" onPointerDown={onResizePointerDown('br')} />
        </>
      )}
    </div>
  );
}

/**
 * Bottom section of the popover that lists EVERY round on the
 * comment (oldest → newest). Each round is independently
 * collapsible (+ / −). A round card shows the user's comment for
 * that round, the anchored snippet, and any applied-edit
 * rationales (original → replacement + AI rationale).
 *
 * The latest round starts expanded; older rounds start collapsed.
 */
function RationaleSection({ comment }: { comment: Comment }) {
  // Defensive: legacy payloads (pre-rounds) get wrapped on the fly
  // by the store; we re-normalize here so we never crash on a
  // comment that somehow slipped through.
  const rounds = useMemo<CommentRound[]>(() => {
    if (Array.isArray(comment.rounds) && comment.rounds.length > 0) {
      return comment.rounds;
    }
    return [
      {
        id: 'legacy',
        start: comment.start,
        end: comment.end,
        snippet: comment.snippet,
        body: comment.body,
        createdAt: comment.createdAt,
        updatedAt: comment.updatedAt,
        outdated: comment.outdated,
        sent: comment.sent,
        applied: [],
      },
    ];
  }, [comment]);

  const latestIdx = rounds.length - 1;

  return (
    <div className="cm-popover__rationale">
      <div className="cm-popover__rationale-header">
        Rationale
        {rounds.length > 1 ? (
          <span className="cm-popover__rationale-count">
            {rounds.length} rounds
          </span>
        ) : null}
      </div>
      {rounds.map((round, i) => (
        <RoundRationale
          key={round.id}
          round={round}
          isLatest={i === latestIdx}
          roundNumber={i + 1}
          totalRounds={rounds.length}
        />
      ))}
    </div>
  );
}

/**
 * One round card: user comment + anchored snippet + applied-edit
 * rationales. Independently expandable via + / −.
 */
function RoundRationale({
  round,
  isLatest,
  roundNumber,
  totalRounds,
}: {
  round: CommentRound;
  isLatest: boolean;
  roundNumber: number;
  totalRounds: number;
}) {
  // Latest round starts expanded; older rounds start collapsed.
  // Each card owns its own expanded state so + / − are independent.
  const [expanded, setExpanded] = useState(isLatest);
  // When a brand-new latest round appears (follow-up edit), open it.
  useEffect(() => {
    if (isLatest) setExpanded(true);
  }, [isLatest, round.id]);

  const appliedCount = round.applied.length;
  return (
    <div
      className={[
        'cm-popover__round',
        isLatest ? 'cm-popover__round--latest' : '',
        appliedCount === 0 ? 'cm-popover__round--empty' : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <button
        type="button"
        className="cm-popover__round-toggle"
        onClick={() => setExpanded((v) => !v)}
        onMouseDown={(e) => e.preventDefault()}
        aria-expanded={expanded}
        aria-label={
          expanded
            ? `Collapse round ${roundNumber}`
            : `Expand round ${roundNumber}`
        }
      >
        <span className="cm-popover__round-num">
          Round {roundNumber}
          {totalRounds > 1 ? ` / ${totalRounds}` : ''}
        </span>
        <span className="cm-popover__round-meta">
          {appliedCount === 0
            ? round.sent
              ? 'Sent · no applied edits'
              : 'Draft'
            : appliedCount === 1
              ? '1 applied edit'
              : `${appliedCount} applied edits`}
        </span>
        <span className="cm-popover__round-caret" aria-hidden>
          {expanded ? '−' : '+'}
        </span>
      </button>
      {expanded && (
        <div className="cm-popover__round-body">
          <div className="cm-popover__round-field">
            <div className="cm-popover__round-field-label">Comment</div>
            <p className="cm-popover__round-comment">
              {round.body.trim() ? (
                round.body
              ) : (
                <em>(empty comment)</em>
              )}
            </p>
          </div>
          {round.snippet.trim() ? (
            <div className="cm-popover__round-field">
              <div className="cm-popover__round-field-label">
                Anchored text
              </div>
              <pre className="cm-popover__round-snippet">{round.snippet}</pre>
            </div>
          ) : null}
          {appliedCount === 0 ? (
            <p className="cm-popover__round-placeholder">
              {round.sent
                ? 'This round was sent to the AI, but no proposed edits from the response were applied yet. Apply an edit in chat to record a rationale here.'
                : 'Edit this comment and Send to AI, then apply a proposed edit to record a rationale for this round.'}
            </p>
          ) : (
            round.applied.map((entry) => (
              <RationaleEntry key={`${round.id}-${entry.editId}-${entry.appliedAt}`} entry={entry} />
            ))
          )}
        </div>
      )}
    </div>
  );
}

/**
 * A single adopted edit's rationale: AI summary + rationale body +
 * a one-line +/- diff preview + relative timestamp.
 */
function RationaleEntry({ entry }: { entry: ProposedEditRationale }) {
  // One-line diff: render only the +/- lines, capped so a long
  // replacement doesn't push the popover off-screen. The diff
  // helper returns a list of `add` / `remove` / `context` lines;
  // we keep up to 2 of each so the preview stays informative.
  const diffLines = useMemo(() => {
    const all = lineDiff(entry.original, entry.replacement);
    const adds = all.filter((l) => l.kind === 'add').slice(0, 2);
    const removes = all.filter((l) => l.kind === 'remove').slice(0, 2);
    // Interleave: remove lines first, then add lines, so the
    // preview reads as "old → new" top-to-bottom.
    return [...removes, ...adds];
  }, [entry.original, entry.replacement]);

  const relative = useMemo(
    () => formatRelativeTime(entry.appliedAt),
    [entry.appliedAt]
  );

  return (
    <div className="cm-popover__rationale-entry">
      <div className="cm-popover__rationale-entry-header">
        <span
          className="cm-popover__rationale-summary"
          title={entry.summary}
        >
          {entry.summary || `Change ${entry.editId}`}
        </span>
        <span
          className="cm-popover__rationale-time"
          title={new Date(entry.appliedAt).toLocaleString()}
        >
          {relative}
        </span>
      </div>
      {entry.rationale ? (
        <div className="cm-popover__rationale-body prose-md">
          <ReactMarkdown
            remarkPlugins={remarkPlugins}
            rehypePlugins={rehypePlugins}
          >
            {entry.rationale}
          </ReactMarkdown>
        </div>
      ) : (
        <p className="cm-popover__rationale-body cm-popover__rationale-body--empty">
          <em>No rationale was provided for this change.</em>
        </p>
      )}
      {diffLines.length > 0 && (
        <div className="cm-popover__rationale-diff" aria-hidden>
          {diffLines.map((l, i) => (
            <div
              key={i}
              className={
                l.kind === 'add'
                  ? 'cm-popover__rationale-diff-add'
                  : l.kind === 'remove'
                    ? 'cm-popover__rationale-diff-remove'
                    : ''
              }
            >
              <span className="cm-popover__rationale-diff-marker">
                {l.kind === 'add' ? '+' : l.kind === 'remove' ? '−' : ' '}
              </span>
              <span className="cm-popover__rationale-diff-text">
                {l.text || ' '}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Compact "x minutes ago" formatter for the rationale entry
 * timestamp. Mirrors the pattern used in `Editor.tsx` for the
 * "saved Xs ago" label so the UI reads consistently.
 */
function formatRelativeTime(at: number): string {
  const diffSec = Math.max(0, Math.floor((Date.now() - at) / 1000));
  if (diffSec < 5) return 'just now';
  if (diffSec < 60) return `${diffSec}s ago`;
  const mins = Math.floor(diffSec / 60);
  if (mins < 60) return `${mins} min${mins === 1 ? '' : 's'} ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} hr${hrs === 1 ? '' : 's'} ago`;
  const days = Math.floor(hrs / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

/**
 * localStorage key for the popover's user-chosen size. Scoped to
 * the comment id so each popover remembers its own size, and
 * namespaced under the same key prefix the editor already uses.
 */
function popoverSizeKey(commentId: string): string {
  return storagePopoverSizeKey(commentId);
}

/**
 * Read the popover's persisted size from localStorage. Returns
 * `null` when the user has never resized the popover for this
 * comment, or when the stored value is malformed. Defensive against
 * JSON parse errors and out-of-range values from older payloads.
 */
function loadPopoverSize(
  commentId: string
): { width: number; height: number } | null {
  try {
    const raw = localStorage.getItem(popoverSizeKey(commentId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed.width === 'number' &&
      typeof parsed.height === 'number' &&
      parsed.width >= MIN_POPOVER_WIDTH &&
      parsed.width <= MAX_POPOVER_WIDTH &&
      parsed.height >= MIN_POPOVER_HEIGHT &&
      parsed.height <= MAX_POPOVER_HEIGHT
    ) {
      return { width: parsed.width, height: parsed.height };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Render a comment body that may contain @-mention sentinels as a
 * sequence of text nodes and inline reference pills. Used by the
 * popover's read view so the user can see the references inline
 * (rather than the raw `[[mention:…]]` sentinel text). Clicking a
 * pill switches the editor to the referenced document so the user
 * can read the source in context.
 */
function CommentBodyWithChips({
  text,
  getDocById,
  onDocumentClick,
}: {
  text: string;
  getDocById: (id: string) => { id: string; title: string } | null;
  onDocumentClick: (id: string) => void;
}) {
  // Use the ranges-aware parser so each mention comes with its
  // source-byte start/end, which we need to slice the body text
  // around the chip in source order.
  const { plain, mentions: scanned } = parseMentionsWithRanges(text);
  if (scanned.length === 0) {
    return <span style={{ whiteSpace: 'pre-wrap' }}>{plain}</span>;
  }
  // Build a flat list of (kind, payload) entries in source order.
  type Part =
    | { kind: 'text'; text: string }
    | {
        kind: 'mention';
        title: string;
        docId: string;
        available: boolean;
        sectionCount: number;
      };
  const parts: Part[] = [];
  let cursor = 0;
  for (const m of scanned) {
    // Slice raw text using known offsets; the chip lives between
    // `m.start` and `m.end` (the sentinel range).
    if (m.start > cursor) {
      parts.push({ kind: 'text', text: text.slice(cursor, m.start) });
    }
    const doc = getDocById(m.token.documentId);
    parts.push({
      kind: 'mention',
      title: m.token.documentTitle || 'Untitled',
      docId: m.token.documentId,
      available: !!doc,
      sectionCount: m.token.paragraphIndexes.length,
    });
    cursor = m.end;
  }
  if (cursor < text.length) {
    parts.push({ kind: 'text', text: text.slice(cursor) });
  }
  return (
    <span style={{ whiteSpace: 'pre-wrap' }}>
      {parts.map((p, i) => {
        if (p.kind === 'text') return <span key={i}>{p.text}</span>;
        return (
          <button
            key={i}
            type="button"
            className={`cm-popover__ref ${
              p.available ? '' : 'cm-popover__ref--deleted'
            }`}
            disabled={!p.available}
            onClick={() => p.available && onDocumentClick(p.docId)}
            title={
              p.available
                ? `Open "${p.title}" in the editor${
                    p.sectionCount > 0
                      ? ` (${p.sectionCount} section${
                          p.sectionCount === 1 ? '' : 's'
                        } referenced)`
                      : ''
                  }`
                : 'Source document was deleted'
            }
          >
            <span aria-hidden>📄</span>
            <span>
              {p.title}
              {p.sectionCount > 0 ? ` · §×${p.sectionCount}` : ''}
              {!p.available ? ' (deleted)' : ''}
            </span>
          </button>
        );
      })}
    </span>
  );
}