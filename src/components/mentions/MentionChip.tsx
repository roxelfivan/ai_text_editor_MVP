// MentionChip — the inline pill that represents a mention in the
// textarea overlay. Compound chip:
//   - top line: doc title (with a "deleted" indicator if the source
//     doc no longer exists).
//   - bottom line: section summary (`full document` or `§ preview
//     +N more`).
// Clicking the bottom line re-opens the section picker (only when
// the source doc is still around). The whole chip is deletable via
// the × button.

import type { MentionToken } from '@/types';
import { summarizeMention } from './parseMentions';

interface Props {
  token: MentionToken;
  /** Whether the source document still exists in the store. */
  isAvailable: boolean;
  onDelete: () => void;
  onEditSections: () => void;
  /** Preview resolver from useDocumentMentions. */
  getParagraphPreview: (docId: string, paragraphIndex: number) => string | null;
  /** Optional heading-section title resolver for chip summaries. */
  getSectionTitles?: (docId: string, paragraphIndexes: number[]) => string[];
}

export function MentionChip({
  token,
  isAvailable,
  onDelete,
  onEditSections,
  getParagraphPreview,
  getSectionTitles,
}: Props) {
  const summary = isAvailable
    ? summarizeMention(token, getParagraphPreview, getSectionTitles)
    : '(deleted)';
  const title = isAvailable
    ? token.documentTitle || 'Untitled'
    : `${token.documentTitle || 'Untitled'} (deleted)`;
  return (
    <span
      className={`mention-chip ${isAvailable ? '' : 'mention-chip--deleted'}`}
      contentEditable={false}
      data-mention-id={token.id}
    >
      <span className="mention-chip__top">
        <span className="mention-chip__icon" aria-hidden>
          📄
        </span>
        <span className="mention-chip__title">{title}</span>
        <button
          type="button"
          className="mention-chip__close"
          aria-label="Remove mention"
          onMouseDown={(e) => e.preventDefault()}
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
        >
          ×
        </button>
      </span>
      <button
        type="button"
        className="mention-chip__bottom"
        onMouseDown={(e) => e.preventDefault()}
        onClick={(e) => {
          e.stopPropagation();
          if (isAvailable) onEditSections();
        }}
        disabled={!isAvailable}
        title={
          isAvailable
            ? 'Click to change which sections are referenced'
            : 'Source document was deleted'
        }
      >
        {summary}
      </button>
    </span>
  );
}
