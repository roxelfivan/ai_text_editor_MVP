/**
 * ReanchorPicker — modal that lets the user pick a new anchor
 * location for a stale comment.
 *
 * Renders the current document's heading structure (or paragraph
 * list as a fallback when there are no headings). Selecting a row
 * emits the byte `(start, end)` of that slice in the document
 * content, and the caller wires that through `reattachComment` in
 * the store (already implemented).
 *
 * The component itself is purely presentational: it knows nothing
 * about `useStore` or the comment lifecycle, so it can be
 * unit-tested and reused if Slice D / E need similar re-link UX.
 *
 * Visual style mirrors `SectionPicker.tsx` so the two pickers
 * read as the same family — same `.mention-popover*` classes, same
 * per-row layout (level icon + title + check affordance), same
 * footer buttons.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import type { HeadingSection } from '@/hooks/useDocumentMentions';

export interface ReanchorPick {
  /** Inclusive start offset of the chosen passage in document text. */
  start: number;
  /** Exclusive end offset of the chosen passage in document text. */
  end: number;
  /** Plain-text label for the chosen row (heading title or paragraph preview). */
  label: string;
}

interface Props {
  /** The current document content; used for paragraph preview rendering. */
  docContent: string;
  /** Heading sections precomputed via the shared `useDocumentMentions` hook. */
  sections: HeadingSection[];
  /** Pixels (in viewport coords) for the modal's top-left corner. */
  anchor: { left: number; top: number };
  /** Maximum height in pixels. Defaults to 360. */
  maxHeight?: number;
  onConfirm: (pick: ReanchorPick) => void;
  onClose: () => void;
}

interface Row {
  /** Unique row id for the keyboard cursor. */
  key: string;
  /** 0-based paragraph index in the source document. */
  paragraphIndex: number;
  /** Inclusive start offset. */
  start: number;
  /** Exclusive end offset. */
  end: number;
  /** Indent level used by the row (0 = preamble/paragraph). */
  level: number;
  /** Plain-text label for the row. */
  title: string;
  /** Optional preview body the row shows below its title. */
  preview?: string;
}

/**
 * Derive a flat row list from the heading sections. Each heading
 * becomes one row; if there are no headings, every paragraph
 * becomes a row (SectionPicker's fallback behaviour). Both shapes
 * share `paragraphIndex` so the caller can route the pick the same
 * way regardless.
 */
function buildRows(
  sections: HeadingSection[],
  docContent: string
): Row[] {
  if (sections.length > 0) {
    return sections.map((s, i) => ({
      key: `h-${i}-${s.start}`,
      paragraphIndex: s.index,
      start: s.start,
      end: s.end,
      level: s.level,
      title: s.title || '(untitled heading)',
      preview: docContent.slice(s.start, s.end).slice(0, 120),
    }));
  }
  // Blank-line paragraph fallback so the picker never appears empty.
  const starts = [0];
  for (let i = 0; i < docContent.length; i++) {
    if (docContent.charCodeAt(i) === 10 /* \n */) {
      const next = i + 1;
      if (next < docContent.length && starts[starts.length - 1] !== next) {
        starts.push(next);
      }
    }
  }
  return starts.map((p, i) => {
    const nextStart = starts[i + 1] ?? docContent.length;
    const start = p;
    const end = nextStart;
    const body = docContent.slice(start, end).trim();
    return {
      key: `p-${i}`,
      paragraphIndex: i,
      start,
      end,
      level: 0,
      title: `Paragraph ${i + 1}`,
      preview: body.slice(0, 120),
    };
  });
}

export function ReanchorPicker({
  docContent,
  sections,
  anchor,
  maxHeight = 360,
  onConfirm,
  onClose,
}: Props) {
  const rows = useMemo(
    () => buildRows(sections, docContent),
    [sections, docContent]
  );
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  // Reset cursor on row-list change (e.g. document was edited).
  useEffect(() => {
    setActive((a) => Math.min(a, Math.max(rows.length - 1, 0)));
  }, [rows.length]);

  // Keep keyboard navigation on the window so the picker still
  // works when the surrounding buttons aren't focused.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActive((a) => Math.min(a + 1, Math.max(rows.length - 1, 0)));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActive((a) => Math.max(a - 1, 0));
      } else if (e.key === 'Enter') {
        const r = rows[active];
        if (r) {
          e.preventDefault();
          onConfirm({ start: r.start, end: r.end, label: r.title });
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [rows, active, onConfirm, onClose]);

  return (
    <div
      ref={listRef}
      role="dialog"
      aria-label="Pick a new anchor for this comment"
      className="mention-popover mention-popover--section relink-picker"
      style={{
        position: 'fixed',
        left: anchor.left,
        top: anchor.top,
        maxHeight,
        minWidth: 320,
      }}
      onPointerDown={(e) => e.preventDefault()}
      onMouseDown={(e) => e.preventDefault()}
    >
      <div className="mention-popover__header">
        <span className="mention-popover__icon" aria-hidden>
          🔗
        </span>
        <span className="mention-popover__title">Re-anchor comment</span>
        <span className="mention-popover__hint">
          pick a heading or paragraph — Enter confirms, Esc cancels
        </span>
      </div>
      <div className="mention-popover__list">
        {rows.length === 0 ? (
          <div className="mention-popover__empty">
            Document is empty — nothing to anchor to.
          </div>
        ) : (
          rows.map((r, i) => {
            const isActive = i === active;
            const indent = r.level > 0 ? (r.level - 1) * 12 : 0;
            return (
              <button
                key={r.key}
                type="button"
                role="option"
                aria-selected={isActive}
                className={`mention-popover__item mention-popover__item--row ${
                  isActive ? 'mention-popover__item--active' : ''
                }`}
                style={{ paddingLeft: 8 + indent }}
                onMouseEnter={() => setActive(i)}
                onClick={() =>
                  onConfirm({ start: r.start, end: r.end, label: r.title })
                }
              >
                <span
                  className={`mention-popover__level ${
                    r.level === 0 ? 'mention-popover__level--preamble' : ''
                  }`}
                  aria-hidden
                >
                  {r.level === 0 ? '¶' : `H${r.level}`}
                </span>
                <span className="mention-popover__preview">
                  {r.title}
                </span>
                {r.preview && r.preview.trim() && r.title !== r.preview.trim() ? (
                  <span className="mention-popover__row-preview">
                    {r.preview.replace(/\s+/g, ' ').slice(0, 80)}…
                  </span>
                ) : null}
              </button>
            );
          })
        )}
      </div>
      <div className="mention-popover__footer">
        <div className="flex-1" />
        <button
          type="button"
          className="mention-popover__btn"
          onClick={onClose}
          title="Close without changing the anchor (Esc also works)"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
