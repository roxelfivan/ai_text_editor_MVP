// DocPicker — the popup that lists documents in the @-mention picker.
// Keyboard navigable, filtered by the query the user typed after `@`.
// Excludes the document the user is currently editing (the current
// doc is already passed to the AI via `sys-current-doc`).

import { useEffect, useMemo, useRef, useState } from 'react';
import type { DocumentRecord } from '@/types';

interface Props {
  documents: DocumentRecord[];
  currentDocumentId: string | null;
  query: string;
  onPick: (doc: DocumentRecord) => void;
  onClose: () => void;
  /** Pixels (in viewport coords) for the popover's top-left. */
  anchor: { left: number; top: number };
  /** Optional max-height in pixels. Defaults to 240. */
  maxHeight?: number;
}

export function DocPicker({
  documents,
  currentDocumentId,
  query,
  onPick,
  onClose,
  anchor,
  maxHeight = 240,
}: Props) {
  const candidates = useMemo(() => {
    const q = query.trim().toLowerCase();
    const others = documents.filter((d) => d.id !== currentDocumentId);
    const list = q
      ? others.filter((d) => (d.title || 'Untitled').toLowerCase().includes(q))
      : others;
    return list.slice(0, 50);
  }, [documents, currentDocumentId, query]);

  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setActive(0);
  }, [query]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActive((a) => Math.min(a + 1, Math.max(candidates.length - 1, 0)));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActive((a) => Math.max(a - 1, 0));
      } else if (e.key === 'Enter' || e.key === 'Tab') {
        if (candidates[active]) {
          e.preventDefault();
          onPick(candidates[active]);
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [candidates, active, onPick, onClose]);

  return (
    <div
      ref={listRef}
      role="listbox"
      aria-label="Documents"
      className="mention-popover"
      style={{
        position: 'fixed',
        left: anchor.left,
        top: anchor.top,
        maxHeight,
        minWidth: 240,
      }}
      // Prevent outside-tap from closing the composer / chat input.
      onPointerDown={(e) => e.preventDefault()}
      onMouseDown={(e) => e.preventDefault()}
    >
      {candidates.length === 0 ? (
        <div className="mention-popover__empty">No matching documents.</div>
      ) : (
        candidates.map((d, i) => (
          <button
            key={d.id}
            type="button"
            role="option"
            aria-selected={i === active}
            className={`mention-popover__item ${
              i === active ? 'mention-popover__item--active' : ''
            }`}
            onMouseEnter={() => setActive(i)}
            onClick={() => onPick(d)}
          >
            <span className="mention-popover__icon" aria-hidden>
              📄
            </span>
            <span className="mention-popover__title">
              {d.title || 'Untitled'}
            </span>
          </button>
        ))
      )}
    </div>
  );
}
