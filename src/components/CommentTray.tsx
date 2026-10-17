/**
 * Bottom-sticky bar shown whenever the document has ≥ 1 comment.
 * Displays the count and a primary "Send to AI" button.
 *
 * The button is disabled / dimmed while a chat reply is streaming
 * (`sending` prop, set by `Editor.tsx` from the `mvp:chat-streaming`
 * window event) so a double-tap can't dispatch two requests.
 *
 * Slice C: when there are outdated comments, the tray grows an
 * expandable per-comment list with **Re-link** (opens the
 * `ReanchorPicker`) and **Dismiss** (per-row) buttons. The bulk
 * **Dismiss outdated** button is kept as the fastest path for users
 * who just want to sweep the list — it's demoted to a secondary
 * "Dismiss all" row so the new affordance doesn't clash with it.
 */
import { useState } from 'react';
import type { Comment } from '@/types';

interface Props {
  /** Total number of comments on the current document. */
  count: number;
  /** Number of comments flagged as outdated (excluded from the send). */
  outdatedCount: number;
  /**
   * The outdated comments themselves, in document order. Used to
   * render the per-comment list under the tray. When omitted, only
   * the bulk `Dismiss outdated` button is rendered (preserving the
   * v0.5.0 UX for callers that don't have the slice-C wiring).
   */
  outdatedComments?: Comment[];
  /** Whether a chat send / stream is already in flight. */
  sending?: boolean;
  /** Send handler. */
  onSend: () => void;
  /**
   * Delete every outdated comment on this document. Bulk action for
   * callers that don't expose per-row Dismiss — keep it for the
   * sweep path.
   */
  onDismissOutdated?: () => void;
  /**
   * Per-row Dismiss handler (Slice C). Wired through to the store
   * `deleteComment` action.
   */
  onDismissOne?: (commentId: string) => void;
  /**
   * Per-row Re-link handler (Slice C). The parent typically opens
   * the `ReanchorPicker` modal and, on confirm, calls
   * `reattachComment(id, { start, end })` from the store.
   */
  onReanchor?: (commentId: string) => void;
}

export function CommentTray({
  count,
  outdatedCount,
  outdatedComments,
  sending,
  onSend,
  onDismissOutdated,
  onDismissOne,
  onReanchor,
}: Props) {
  const [staleOpen, setStaleOpen] = useState(false);
  if (count === 0) return null;

  const sendableCount = count - outdatedCount;
  const sendableLabel =
    sendableCount === count
      ? `${count} ${count === 1 ? 'comment' : 'comments'}`
      : `${sendableCount} of ${count} comments ready (${outdatedCount} outdated)`;

  const hasPerRowControls = !!onDismissOne && !!onReanchor && outdatedComments;
  const staleList = outdatedComments ?? [];

  return (
    <div className="cm-tray" role="region" aria-label="Comment actions">
      <div className="cm-tray__row">
        <div className="cm-tray__label">{sendableLabel}</div>
        {outdatedCount > 0 && onDismissOutdated && !hasPerRowControls && (
          <button
            type="button"
            className="cm-tray__btn"
            onClick={() => onDismissOutdated()}
            disabled={sending}
            title="Delete all outdated comments on this document. ⌘Z undoes one at a time."
          >
            Dismiss outdated
          </button>
        )}
        <button
          type="button"
          className={[
            'cm-tray__btn cm-tray__btn--primary',
            sending ? 'cm-tray__btn--sending' : '',
          ]
            .filter(Boolean)
            .join(' ')}
          onClick={() => onSend()}
          disabled={sending || sendableCount === 0}
        >
          {sending ? 'Sending…' : 'Send to AI'}
        </button>
      </div>

      {/* Slice C: per-comment stale list. Hidden until the user
          expands it so the tray stays a single-row most of the
          time. Rendered only when both per-row callbacks are
          supplied so the affordance degrades gracefully for callers
          that haven't wired Slice C yet. */}
      {hasPerRowControls && outdatedCount > 0 && (
        <div className="cm-tray__stale">
          <button
            type="button"
            className="cm-tray__stale-toggle"
            onClick={() => setStaleOpen((v) => !v)}
            aria-expanded={staleOpen}
            aria-controls="cm-stale-list"
            title="Show every outdated comment with per-row Dismiss / Re-link"
          >
            <span className="cm-tray__stale-caret" aria-hidden>
              {staleOpen ? '▾' : '▸'}
            </span>
            <span>
              {outdatedCount} stale comment
              {outdatedCount === 1 ? '' : 's'} — Re-link or Dismiss
            </span>
            {onDismissOutdated && (
              <span
                className="cm-tray__stale-bulk"
                onClick={(e) => {
                  e.stopPropagation();
                  onDismissOutdated();
                }}
                title="Delete every outdated comment on this document. ⌘Z undoes one at a time."
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    e.stopPropagation();
                    onDismissOutdated();
                  }
                }}
              >
                Dismiss all
              </span>
            )}
          </button>
          {staleOpen && (
            <ul
              id="cm-stale-list"
              className="cm-stale-list"
              role="list"
              aria-label="Stale comments"
            >
              {staleList.map((c, i) => (
                <li
                  key={c.id}
                  className="cm-stale-list__row"
                  role="listitem"
                >
                  <span className="cm-stale-list__num" aria-hidden>
                    {i + 1}
                  </span>
                  <span
                    className="cm-stale-list__snippet"
                    title={c.snippet}
                  >
                    “{c.snippet.length > 60 ? c.snippet.slice(0, 60) + '…' : c.snippet}”
                  </span>
                  <span className="cm-stale-list__actions">
                    <button
                      type="button"
                      className="cm-tray__btn cm-tray__btn--ghost"
                      onClick={() => onReanchor!(c.id)}
                      disabled={sending}
                      title="Re-anchor this comment to a new heading or paragraph"
                    >
                      Re-link
                    </button>
                    <button
                      type="button"
                      className="cm-tray__btn cm-tray__btn--ghost"
                      onClick={() => onDismissOne!(c.id)}
                      disabled={sending}
                      title="Delete this stale comment. ⌘Z restores it."
                    >
                      Dismiss
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
