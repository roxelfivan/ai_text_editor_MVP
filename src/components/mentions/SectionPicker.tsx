// SectionPicker — second-stage popup after a doc is picked in the
// `@` flow. Lists every paragraph (numbered + preview) with
// checkboxes. Multi-select: user can pick one, several, or skip and
// reference the whole document. Clicking outside / pressing Escape
// keeps the current selection.

import { useEffect, useMemo, useRef, useState } from 'react';
import type { DocumentRecord } from '@/types';
import type { ParagraphInfo } from '@/hooks/useDocumentMentions';

interface Props {
  doc: DocumentRecord;
  paragraphs: ParagraphInfo[];
  /** Initial selection (0-based paragraph indexes). */
  initialSelection: number[];
  /** Pixels (in viewport coords) for the popover's top-left. */
  anchor: { left: number; top: number };
  onConfirm: (selectedIndexes: number[]) => void;
  onClose: () => void;
  /** Max height in pixels. Defaults to 320. */
  maxHeight?: number;
}

export function SectionPicker({
  doc,
  paragraphs,
  initialSelection,
  anchor,
  onConfirm,
  onClose,
  maxHeight = 320,
}: Props) {
  const [selected, setSelected] = useState<Set<number>>(
    () => new Set(initialSelection)
  );
  const [active, setActive] = useState<number>(
    () => initialSelection[0] ?? 0
  );
  const listRef = useRef<HTMLDivElement>(null);

  const all = useMemo(
    () => paragraphs.map((_, i) => i),
    [paragraphs]
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActive((a) => Math.min(a + 1, Math.max(paragraphs.length - 1, 0)));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActive((a) => Math.max(a - 1, 0));
      } else if (e.key === ' ' || e.key === 'Enter') {
        if (paragraphs[active]) {
          e.preventDefault();
          toggle(active);
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      } else if (e.key === 'a' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setSelected(new Set(all));
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paragraphs, active, all]);

  const toggle = (i: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  };

  const confirmFull = () => onConfirm([]);
  const confirmSelection = () => {
    const sorted = Array.from(selected).sort((a, b) => a - b);
    onConfirm(sorted);
  };

  return (
    <div
      ref={listRef}
      role="dialog"
      aria-label={`Select paragraphs from ${doc.title || 'Untitled'}`}
      className="mention-popover mention-popover--section"
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
          📄
        </span>
        <span className="mention-popover__title">
          {doc.title || 'Untitled'}
        </span>
        <span className="mention-popover__hint">
          pick paragraphs (Esc to skip)
        </span>
      </div>
      <div className="mention-popover__list">
        {paragraphs.length === 0 ? (
          <div className="mention-popover__empty">Empty document.</div>
        ) : (
          paragraphs.map((p, i) => {
            const isActive = i === active;
            const isChecked = selected.has(i);
            return (
              <button
                key={i}
                type="button"
                role="option"
                aria-selected={isChecked}
                className={`mention-popover__item mention-popover__item--row ${
                  isActive ? 'mention-popover__item--active' : ''
                }`}
                onMouseEnter={() => setActive(i)}
                onClick={() => toggle(i)}
              >
                <span
                  className={`mention-popover__checkbox ${
                    isChecked ? 'mention-popover__checkbox--checked' : ''
                  }`}
                  aria-hidden
                >
                  {isChecked ? '☑' : '☐'}
                </span>
                <span className="mention-popover__index">
                  {String(i + 1).padStart(2, '0')}
                </span>
                <span className="mention-popover__preview">
                  {p.preview || '(empty paragraph)'}
                </span>
              </button>
            );
          })
        )}
      </div>
      <div className="mention-popover__footer">
        <button
          type="button"
          className="mention-popover__btn"
          onClick={confirmFull}
          title="Reference the entire document (default behavior — token-efficient outline)"
        >
          Whole document
        </button>
        <div className="flex-1" />
        <span className="mention-popover__count">
          {selected.size} selected
        </span>
        <button
          type="button"
          className="mention-popover__btn mention-popover__btn--primary"
          onClick={confirmSelection}
          disabled={selected.size === 0}
        >
          Use selection
        </button>
      </div>
    </div>
  );
}
