import { useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { useStore } from '@/store/useStore';
import type { ProposedEdit } from '@/types';
import { lineDiff, splitDiff } from '@/utils/diff';
import { applyEdit, applyEditAtCaret, findEditAnchor } from '@/utils/proposedEdit';
import { ResizeHandle } from '@/components/ResizeHandle';
import {
  useDragResize,
  applyHandle,
  clamp,
  MIN_CARD_WIDTH,
  MAX_CARD_WIDTH,
  MIN_CARD_HEIGHT,
  MAX_CARD_HEIGHT,
  type ResizeHandle as HandleName,
} from '@/hooks/useDragResize';

interface Props {
  edit: ProposedEdit;
  docId: string;
  messageId: string;
  /**
   * Whether this card's rejection comment is currently staged for sending.
   * When `true`, the card renders a "staged" outline and skips the
   * "Reject with feedback" affordance — the comment has already been
   * queued by the parent and only the plain Reject button remains so the
   * user can still drop the card without sending.
   */
  staged?: boolean;
  /**
   * Whether this card has been committed (the user clicked "Send N
   * rejection comments" in the assistant message footer). When `true`,
   * the card hides itself immediately rather than waiting for an explicit
   * plain-Reject click.
   */
  committed?: boolean;
  /**
   * Notify the parent that the user wants to stage this card's comment for
   * a batched send. Called with the trimmed comment text. If the comment is
   * empty, the parent should treat the call as a plain rejection instead.
   */
  onStageReject?: (info: { editId: string; comment: string }) => void;
}

type CardStatus =
  | { kind: 'idle' }
  | { kind: 'applied' }
  | { kind: 'rejected' }
  | { kind: 'committed' };

/** Which way the diff preview is rendered. */
type ViewMode = 'split' | 'unified';

const DEFAULT_WIDTH = 320;
const DEFAULT_HEIGHT = 220;

/**
 * Inline track-changes preview for a single AI-proposed edit.
 *
 * Reads the current document content from the store on every render so it
 * picks up user changes (and any sibling applies) live. Apply performs a
 * single-substring replace; if the `original` anchor is no longer present,
 * Apply is disabled with an inline explanation.
 *
 * The card is resizable from all 8 edges + corners via `useDragResize`
 * (`free` mode). Per-card size is keyed by `${messageId}:${edit.id}` and
 * persisted via the `layout.previewSizes` slice of the store.
 */
export function ProposedEditCard({ edit, docId, messageId, staged, committed, onStageReject }: Props) {
  // Subscribe to documents so re-renders fire on store updates.
  const documents = useStore((s) => s.documents);
  const doc = documents.find((d) => d.id === docId);
  const content = doc?.content ?? '';

  const sizeKey = `${messageId}:${edit.id}`;
  const storedSize = useStore((s) => s.layout.previewSizes[sizeKey]);
  const setPreviewSize = useStore((s) => s.setPreviewSize);
  // Editor focus + caret state for the doc this card is anchored against.
  // Used to decide whether Force-apply can run (requires focus + a known
  // caret). Subscribing to a per-doc record keeps re-renders scoped to
  // the doc in question, not every keystroke in any doc.
  const editorState = useStore((s) => s.editorFocus[docId]);

  const [status, setStatus] = useState<CardStatus>({ kind: 'idle' });
  // When the parent marks this card as committed (the user clicked "Send
  // N rejection comments"), flip our local status so the card hides
  // itself immediately. Done in an effect rather than at the call site so
  // any in-flight local state changes (typing in the textarea, etc.)
  // don't race the parent.
  useEffect(() => {
    if (committed && status.kind !== 'committed') {
      setStatus({ kind: 'committed' });
    }
  }, [committed, status.kind]);
  // Per-card diff view mode. Default to side-by-side split.
  const [viewMode, setViewMode] = useState<ViewMode>('split');
  // Free-text comment the user typed to explain a reject. Held locally
  // until they click "Reject with feedback", at which point we hand it up
  // to ChatPanel so it can batch with sibling rejections.
  const [comment, setComment] = useState('');
  // Ref to the card's root element, used to read its actual rendered size
  // when a drag starts (so a card that auto-sizes to its parent resizes
  // smoothly from its real on-screen dimensions rather than from the
  // DEFAULT_WIDTH constant).
  const cardRef = useRef<HTMLDivElement>(null);
  // Remember the size at the start of a drag so we can apply deltas.
  const startSizeRef = useRef<{ w: number; h: number }>(
    storedSize ?? { w: DEFAULT_WIDTH, h: DEFAULT_HEIGHT }
  );

  // Anchor lookup + multiple-match detection. We use a shared helper that
  // also drives `applyEdit` so the disabled-state and Apply click are
  // always looking for the same span.
  const anchorInfo = useMemo(() => {
    if (!content) return { found: false, idx: -1, multiple: false };
    const anchor = findEditAnchor(content, edit.original);
    if (!anchor) return { found: false, idx: -1, multiple: false };

    // To detect multiple matches cheaply, run the same lookup starting
    // one character past the first hit and see if anything else surfaces.
    const second = findEditAnchor(
      content.slice(anchor.idx + anchor.length),
      edit.original
    );
    return {
      found: true,
      idx: anchor.idx,
      multiple: second !== null,
    };
  }, [content, edit.original]);

  // Diff lines between anchor and replacement, for the preview. Context
  // lines are kept so the split view can render surrounding text on both
  // sides; the unified view still hides them. We always compute the diff
  // (even when the anchor is missing) so the card can still render the
  // AI's original vs replacement as a standalone red/green comparison.
  const flatDiff = useMemo(
    () => lineDiff(edit.original, edit.replacement),
    [edit.original, edit.replacement]
  );
  const unifiedLines = useMemo(
    () => flatDiff.filter((l) => l.kind !== 'context'),
    [flatDiff]
  );
  const splitRows = useMemo(() => splitDiff(flatDiff), [flatDiff]);

  // Resize wiring. The hook only gives us the pointer delta; we apply it
  // to the start size using the dragged handle to compute the new rect.
  const { start: beginResize } = useDragResize({
    mode: 'free',
    onDelta: ({ dx, dy }) => {
      const next = applyHandle(
        activeHandleRef.current!,
        startSizeRef.current.w,
        startSizeRef.current.h,
        dx,
        dy
      );
      const w = clamp(next.w, MIN_CARD_WIDTH, MAX_CARD_WIDTH);
      const h = clamp(next.h, MIN_CARD_HEIGHT, MAX_CARD_HEIGHT);
      const current = storedSize ?? { w: DEFAULT_WIDTH, h: DEFAULT_HEIGHT };
      if (w !== current.w || h !== current.h) {
        setPreviewSize(sizeKey, { w, h });
      }
    },
  });
  const activeHandleRef = useRef<HandleName | null>(null);
  const onResizePointerDown = (handle: HandleName) =>
    (e: ReactPointerEvent<HTMLElement>) => {
      // Anchor the start size to the card's actual rendered dimensions
      // when it has no explicit stored size. This makes the drag feel
      // continuous regardless of whether the card is in its default
      // "fill-parent" mode or in a previously resized pixel mode.
      if (storedSize) {
        startSizeRef.current = storedSize;
      } else if (cardRef.current) {
        const rect = cardRef.current.getBoundingClientRect();
        startSizeRef.current = { w: rect.width, h: rect.height };
      } else {
        startSizeRef.current = { w: DEFAULT_WIDTH, h: DEFAULT_HEIGHT };
      }
      activeHandleRef.current = handle;
      beginResize(handle, e);
    };

  if (status.kind === 'rejected' || status.kind === 'committed') return null;

  const handleApply = () => {
    if (!doc) return;
    const r = applyEdit(doc.content, edit.original, edit.replacement);
    if (!r.ok) return;
    useStore.getState().updateDocumentContent(doc.id, r.next);
    setStatus({ kind: 'applied' });
  };

  // Force-apply: drop the AI's `replacement` at the user's caret, or
  // replace the user's selection if a range is selected. Used when the
  // AI's `original` quote can't be matched in the current document.
  // The user is responsible for choosing the location.
  const handleForceApply = () => {
    if (!doc) return;
    // NOTE: the focused gate was removed. Clicking this button blurs
    // the textarea (the button lives in the chat panel, not the editor),
    // which would cause the button to be disabled before its own `click`
    // handler can fire. The caret indices stay valid across the blur
    // because `Editor.reportCaret` reads them from the live DOM before
    // writing `focused: false`.
    // Bail if the user has switched documents since this card mounted.
    const liveDocId = useStore.getState().currentDocumentId;
    if (liveDocId !== docId) return;
    const r = applyEditAtCaret(
      doc.content,
      edit.replacement,
      {
        selectionStart: editorState.selectionStart,
        selectionEnd: editorState.selectionEnd,
      }
    );
    if (!r.ok) return;
    useStore.getState().updateDocumentContent(doc.id, r.next);
    setStatus({ kind: 'applied' });
  };

  const handleReject = () => {
    // Plain Reject — hide right now, no chat message.
    setStatus({ kind: 'rejected' });
  };

  const handleRejectWithFeedback = () => {
    const trimmed = comment.trim();
    if (!trimmed) {
      // No comment typed: fall back to a plain reject so the user isn't
      // stuck with a button that does nothing.
      setStatus({ kind: 'rejected' });
      return;
    }
    if (onStageReject) {
      onStageReject({ editId: edit.id, comment: trimmed });
      // Keep `comment` populated so the user can still see what they
      // typed. The textarea flips to read-only when `staged` is true, so
      // the card visually settles into a "waiting to send" state without
      // erasing the user's text.
    } else {
      // No parent wiring: behave like a plain reject so the card doesn't
      // get stuck open forever.
      setStatus({ kind: 'rejected' });
    }
  };

  const disabled = !anchorInfo.found || status.kind === 'applied';

  // Force-apply is the only path that can succeed when the AI quote is
  // not anchored in the document. It is gated on:
  //   1. The anchor missing (otherwise normal Apply should be used).
  //   2. The card not already applied.
  //   3. A known caret position (selectionStart >= 0).
  // The doc-switch guard is checked inside `handleForceApply` (it reads
  // `currentDocumentId` from the store at click time) so we don't have
  // to subscribe here.
  // Note: we deliberately do NOT gate on `editorState.focused`. The act
  // of clicking this button blurs the textarea (the button is rendered
  // in the chat panel, not the editor), which would disable the button
  // via React re-render before its `click` handler can fire. The caret
  // indices in the store stay valid across the blur because
  // `Editor.reportCaret` reads them from the live DOM before writing
  // `focused: false`.
  const canForceApply =
    !anchorInfo.found &&
    status.kind !== 'applied' &&
    typeof editorState?.selectionStart === 'number' &&
    (editorState?.selectionStart ?? -1) >= 0;

  const size = storedSize ?? { w: DEFAULT_WIDTH, h: DEFAULT_HEIGHT };
  const isSized = !!storedSize;

  return (
    <div
      ref={cardRef}
      className={`proposed-edit-card ${isSized ? 'pe-card-sized' : ''} flex flex-col w-full`}
      style={
        isSized
          ? { width: size.w, height: size.h }
          : undefined
      }
    >
      <div className="pe-header shrink-0">
        <span className="pe-id" title={`Change id: ${edit.id}`}>
          {edit.id}
        </span>
        <span className="pe-summary" title={edit.summary}>
          {edit.summary || 'Proposed edit'}
        </span>
        {/* View-mode toggle: side-by-side vs inline. */}
        <div
          className="ml-auto inline-flex rounded border border-gray-300 dark:border-gray-700 overflow-hidden text-[10px] font-mono"
          role="tablist"
          aria-label="Diff view mode"
        >
          <button
            type="button"
            role="tab"
            aria-selected={viewMode === 'split'}
            className={`px-1.5 py-0.5 ${
              viewMode === 'split'
                ? 'bg-blue-600 text-white'
                : 'bg-white dark:bg-gray-900 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800'
            }`}
            onClick={() => setViewMode('split')}
            title="Side-by-side: original on the left, proposed on the right"
          >
            Split
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={viewMode === 'unified'}
            className={`px-1.5 py-0.5 border-l border-gray-300 dark:border-gray-700 ${
              viewMode === 'unified'
                ? 'bg-blue-600 text-white'
                : 'bg-white dark:bg-gray-900 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800'
            }`}
            onClick={() => setViewMode('unified')}
            title="Inline unified diff"
          >
            Inline
          </button>
        </div>
      </div>

      <div className="pe-diff flex-1 min-h-0">
        {!anchorInfo.found && (
          <div
            className="mb-2 py-1.5 px-2 rounded border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/40 text-[11px] leading-snug text-amber-800 dark:text-amber-200"
            role="status"
          >
            <div className="font-semibold mb-0.5">
              Potential mismatch detected
            </div>
            <div>
              The AI&rsquo;s original quote doesn&rsquo;t appear in the
              current document &mdash; it may have been edited since this
              reply was generated, or the AI quoted a different wording.
              Normal Apply is unavailable; click in the editor, then use
              <span className="font-semibold"> Force-apply</span>.
            </div>
          </div>
        )}
        {flatDiff.length === 0 || (viewMode === 'unified' && unifiedLines.length === 0) ? (
          <div className="text-xs text-gray-500 dark:text-gray-400 italic">
            (no textual change)
          </div>
        ) : viewMode === 'split' ? (
          renderSplit(splitRows)
        ) : (
          <div className="pe-diff-unified">
            {unifiedLines.map((line, i) => (
              <div
                key={i}
                className={
                  line.kind === 'add'
                    ? 'diff-add'
                    : line.kind === 'remove'
                      ? 'diff-remove'
                      : ''
                }
              >
                <span className="inline-block w-4 select-none opacity-60">
                  {line.kind === 'add' ? '+' : line.kind === 'remove' ? '-' : ' '}
                </span>
                {line.text || ' '}
              </div>
            ))}
          </div>
        )}
        {!anchorInfo.found && (
          <div className="mt-1 text-[10px] text-gray-500 dark:text-gray-400 italic">
            Not anchored to current text &mdash; applying uses Force-apply.
          </div>
        )}
      </div>

      <div className="pe-actions shrink-0">
        <button
          type="button"
          className="text-xs px-2 py-1 rounded text-gray-600 dark:text-gray-300 border border-gray-300 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-50"
          onClick={handleReject}
          disabled={status.kind === 'applied'}
          title="Dismiss this proposed change"
        >
          Reject
        </button>
        <button
          type="button"
          className="text-xs px-2 py-1 rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          onClick={handleApply}
          disabled={disabled}
          title={
            anchorInfo.found
              ? anchorInfo.multiple
                ? 'Multiple matches; the first will be replaced'
                : 'Apply this change to the document'
              : 'Original text not found in current document'
          }
        >
          Apply
        </button>
        <button
          type="button"
          className="text-xs px-2 py-1 rounded border border-amber-500 text-amber-700 dark:text-amber-300 hover:bg-amber-50 dark:hover:bg-amber-950/40 disabled:opacity-50 disabled:cursor-not-allowed"
          onClick={handleForceApply}
          disabled={!canForceApply}
          title={
            canForceApply
              ? 'Insert the proposed text at your caret (or replace your selection)'
              : 'Click in the document to enable Force-apply'
          }
        >
          Force-apply&hellip;
        </button>
      </div>

      {/* Comment box for "Reject with feedback". The user types a reason
          here and clicks the button below; the card then waits for the
          parent to commit the batched rejections before it disappears.
          When the card is staged we keep the typed text visible but flip
          the textarea to read-only so the user can review what they sent
          without being able to edit a comment that has already been
          queued for the next chat turn. */}
      <div className="pe-comment shrink-0">
        <label
          htmlFor={`pe-comment-${messageId}-${edit.id}`}
          className="block text-[10px] uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-1"
        >
          Comment (optional)
        </label>
        <textarea
          id={`pe-comment-${messageId}-${edit.id}`}
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          disabled={status.kind === 'applied'}
          readOnly={!!staged}
          placeholder="Why reject? (sent to the AI as revision feedback)"
          rows={2}
          className={`w-full p-1.5 border rounded bg-white dark:bg-gray-900 text-xs outline-none focus:ring-1 focus:ring-blue-500 resize-none ${
            staged
              ? 'border-blue-400 dark:border-blue-500 bg-blue-50/50 dark:bg-blue-950/30 cursor-default'
              : 'border-gray-300 dark:border-gray-700'
          }`}
        />
        <div className="mt-1.5 flex items-center justify-between gap-2">
          <span className="text-[10px] text-gray-500 dark:text-gray-400">
            {staged
              ? 'Staged. Click "Send rejection comments" in the message footer to send.'
              : 'Tip — leave empty to use plain Reject.'}
          </span>
          <button
            type="button"
            className="text-xs px-2 py-1 rounded border border-blue-500 text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950/40 disabled:opacity-50 disabled:cursor-not-allowed"
            onClick={handleRejectWithFeedback}
            disabled={status.kind === 'applied' || !comment.trim() || staged}
            title={
              staged
                ? 'Already staged'
                : 'Stage this rejection with the typed comment'
            }
          >
            Reject with feedback
          </button>
        </div>
      </div>

      {status.kind === 'applied' && (
        <div className="pe-status applied">Applied to document.</div>
      )}
      {!anchorInfo.found && edit.original && (
        <details className="pe-status text-[11px] opacity-90 mt-1">
          <summary className="cursor-pointer select-none">
            Show what the AI was looking for
          </summary>
          <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap rounded bg-black/10 p-2 text-[11px] leading-snug dark:bg-white/10">
            {edit.original.length > 800
              ? edit.original.slice(0, 800) + '\n…(truncated)'
              : edit.original}
          </pre>
        </details>
      )}

      {/* 8 resize handles */}
      <ResizeHandle handle="top" onPointerDown={onResizePointerDown('top')} />
      <ResizeHandle handle="bottom" onPointerDown={onResizePointerDown('bottom')} />
      <ResizeHandle handle="left" onPointerDown={onResizePointerDown('left')} />
      <ResizeHandle handle="right" onPointerDown={onResizePointerDown('right')} />
      <ResizeHandle handle="tl" onPointerDown={onResizePointerDown('tl')} />
      <ResizeHandle handle="tr" onPointerDown={onResizePointerDown('tr')} />
      <ResizeHandle handle="bl" onPointerDown={onResizePointerDown('bl')} />
      <ResizeHandle handle="br" onPointerDown={onResizePointerDown('br')} />
    </div>
  );
}

/**
 * Render the side-by-side diff: original on the left, proposed on the
 * right. Rows line up vertically — a removed line on the left aligns with
 * an added line on the right at the same row index. When one side has no
 * counterpart for a row, that cell renders as an empty placeholder so the
 * rows stay aligned.
 */
function renderSplit(rows: ReturnType<typeof splitDiff>) {
  return (
    <div className="grid grid-cols-2 font-mono text-xs">
      {/* Column headers */}
      <div className="px-2 py-1 text-[10px] uppercase tracking-wide text-gray-500 dark:text-gray-400 border-b border-r border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/50">
        Original
      </div>
      <div className="px-2 py-1 text-[10px] uppercase tracking-wide text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/50">
        Proposed
      </div>
      {/* Diff rows */}
      {rows.map((row, i) => (
        <SplitRowView key={i} row={row} />
      ))}
    </div>
  );
}

/**
 * One row of the side-by-side diff: left half (original) + right half
 * (proposed). Each half renders the line text, an empty placeholder, or a
 * "+/-" gutter marker; the cell's background colour reflects the diff kind.
 */
function SplitRowView({
  row,
}: {
  row: ReturnType<typeof splitDiff>[number];
}) {
  const leftKind = row.left?.kind ?? null;
  const rightKind = row.right?.kind ?? null;
  const leftBg =
    leftKind === 'remove'
      ? 'bg-red-50 dark:bg-red-900/30'
      : leftKind === 'context'
        ? 'bg-white dark:bg-gray-900'
        : 'bg-gray-50 dark:bg-gray-800/40';
  const rightBg =
    rightKind === 'add'
      ? 'bg-green-50 dark:bg-green-900/30'
      : rightKind === 'context'
        ? 'bg-white dark:bg-gray-900'
        : 'bg-gray-50 dark:bg-gray-800/40';
  const leftText =
    leftKind === 'remove'
      ? 'line-through opacity-80'
      : leftKind === 'context'
        ? 'opacity-90'
        : '';
  const rightText =
    rightKind === 'add'
      ? 'opacity-90'
      : rightKind === 'context'
        ? 'opacity-90'
        : '';
  const leftMarker = leftKind === 'remove' ? '-' : leftKind === 'context' ? ' ' : '';
  const rightMarker = rightKind === 'add' ? '+' : rightKind === 'context' ? ' ' : '';
  return (
    <>
      <div
        className={`flex items-start gap-2 px-2 py-0.5 border-r border-gray-200 dark:border-gray-800 ${leftBg}`}
      >
        <span className="inline-block w-3 shrink-0 select-none opacity-60">
          {leftMarker}
        </span>
        <span className={`whitespace-pre-wrap break-words flex-1 ${leftText}`}>
          {row.left?.text || (row.left ? '' : '\u00a0')}
        </span>
      </div>
      <div className={`flex items-start gap-2 px-2 py-0.5 ${rightBg}`}>
        <span className="inline-block w-3 shrink-0 select-none opacity-60">
          {rightMarker}
        </span>
        <span className={`whitespace-pre-wrap break-words flex-1 ${rightText}`}>
          {row.right?.text || (row.right ? '' : '\u00a0')}
        </span>
      </div>
    </>
  );
}