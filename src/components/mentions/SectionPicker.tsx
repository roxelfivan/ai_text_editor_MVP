// SectionPicker — second-stage popup after a doc is picked in the
// `@` flow. Lists heading / sub-heading sections (with a blank-line
// fallback when the doc has no headings) with checkboxes. Multi-
// select: user can pick one, several, or skip and reference the whole
// document. Clicking outside / pressing Escape keeps the current
// selection.

import { useEffect, useMemo, useRef, useState } from 'react';
import type { DocumentRecord } from '@/types';
import type { HeadingSection } from '@/hooks/useDocumentMentions';
import {
  sectionsMatchingSelection,
  descendantSectionIndexes,
} from '@/hooks/useDocumentMentions';

interface Props {
  doc: DocumentRecord;
  sections: HeadingSection[];
  /** Initial selection (0-based paragraph indexes from the mention). */
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
  sections,
  initialSelection,
  anchor,
  onConfirm,
  onClose,
  maxHeight = 320,
}: Props) {
  const [selected, setSelected] = useState<Set<number>>(() =>
    new Set(sectionsMatchingSelection(sections, initialSelection))
  );
  const [active, setActive] = useState<number>(() => {
    const matched = sectionsMatchingSelection(sections, initialSelection);
    return matched[0] ?? 0;
  });
  const listRef = useRef<HTMLDivElement>(null);

  const all = useMemo(
    () => sections.map((s) => s.index),
    [sections]
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActive((a) => Math.min(a + 1, Math.max(sections.length - 1, 0)));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActive((a) => Math.max(a - 1, 0));
      } else if (e.key === ' ' || e.key === 'Enter') {
        if (sections[active]) {
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
  }, [sections, active, all]);

  const toggle = (sectionIndex: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      const wasSelected = next.has(sectionIndex);
      if (wasSelected) {
        next.delete(sectionIndex);
      } else {
        next.add(sectionIndex);
      }
      // Cascade to descendants. Ticking a parent heading selects all
      // sub-headings under it; unticking removes them too. Children
      // toggled independently never affect the parent (we only walk
      // forward, so this is a one-way cascade).
      for (const descIdx of descendantSectionIndexes(sections, sectionIndex)) {
        if (wasSelected) next.delete(descIdx);
        else next.add(descIdx);
      }
      return next;
    });
  };

  const confirmFull = () => onConfirm([]);
  const confirmSelection = () => {
    // Expand selected sections into the union of their paragraph
    // indexes (sorted) so the prompt builder / chip storage stay on
    // the existing paragraphIndexes contract.
    const para = new Set<number>();
    const sortedSections = Array.from(selected).sort((a, b) => a - b);
    for (const si of sortedSections) {
      const section = sections[si];
      if (!section) continue;
      for (const pi of section.paragraphIndexes) para.add(pi);
    }
    onConfirm(Array.from(para).sort((a, b) => a - b));
  };

  return (
    <div
      ref={listRef}
      role="dialog"
      aria-label={`Select sections from ${doc.title || 'Untitled'}`}
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
          pick sections — parent ticks cascade to children (Esc to cancel)
        </span>
      </div>
      <div className="mention-popover__list">
        {sections.length === 0 ? (
          <div className="mention-popover__empty">Empty document.</div>
        ) : (
          sections.map((s, i) => {
            const isActive = i === active;
            const isChecked = selected.has(s.index);
            const indentLevel = s.level > 0 ? s.level - 1 : 0;
            return (
              <button
                key={s.index}
                type="button"
                role="option"
                aria-selected={isChecked}
                className={`mention-popover__item mention-popover__item--row ${
                  isActive ? 'mention-popover__item--active' : ''
                }`}
                style={{ paddingLeft: 8 + indentLevel * 12 }}
                onMouseEnter={() => setActive(i)}
                onClick={() => toggle(s.index)}
              >
                <span
                  className={`mention-popover__checkbox ${
                    isChecked ? 'mention-popover__checkbox--checked' : ''
                  }`}
                  aria-hidden
                >
                  {isChecked ? '☑' : '☐'}
                </span>
                <span
                  className={`mention-popover__level ${
                    s.level === 0 ? 'mention-popover__level--preamble' : ''
                  }`}
                  aria-hidden
                >
                  {s.level === 0 ? '¶' : `H${s.level}`}
                </span>
                <span className="mention-popover__preview">
                  {s.title || '(untitled section)'}
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
          className="mention-popover__btn"
          onClick={onClose}
          title="Close without changing the reference (Esc also works)"
        >
          Cancel
        </button>
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
