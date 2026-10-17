/**
 * Bottom-sticky bar shown whenever the document has ≥ 1 comment.
 * Displays the count and a primary "Send to AI" button.
 *
 * The button is disabled / dimmed while a chat reply is streaming
 * (`sending` prop, set by `Editor.tsx` from the `mvp:chat-streaming`
 * window event) so a double-tap can't dispatch two requests.
 */
interface Props {
  /** Total number of comments on the current document. */
  count: number;
  /** Number of comments flagged as outdated (excluded from the send). */
  outdatedCount: number;
  /** Whether a chat send / stream is already in flight. */
  sending?: boolean;
  /** Send handler. */
  onSend: () => void;
  /** Delete every outdated comment on this document. */
  onDismissOutdated?: () => void;
}

export function CommentTray({
  count,
  outdatedCount,
  sending,
  onSend,
  onDismissOutdated,
}: Props) {
  if (count === 0) return null;

  const sendableCount = count - outdatedCount;
  const sendableLabel =
    sendableCount === count
      ? `${count} ${count === 1 ? 'comment' : 'comments'}`
      : `${sendableCount} of ${count} comments ready (${outdatedCount} outdated)`;

  return (
    <div className="cm-tray" role="region" aria-label="Comment actions">
      <div className="cm-tray__row">
        <div className="cm-tray__label">{sendableLabel}</div>
        {outdatedCount > 0 && onDismissOutdated && (
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
    </div>
  );
}
