// MentionInput — an @-aware textarea replacement. The textarea is
// the source of truth for the text; mention tokens are stored as
// zero-width sentinel sequences that the textarea sees as a single
// character. Chip pills are rendered as a horizontal row that flows
// above the textarea (so the chip overlay does not need pixel-perfect
// alignment with the caret — it's a separate row that scrolls with
// the textarea content but does not try to inline within a single
// line).
//
// This is intentionally simpler than a Tiptap-style in-line chip
// renderer: chips are pills above the textarea, the textarea shows
// the typed prose, and clicking a chip re-opens the section picker
// or deletes the mention. The user still has full caret navigation
// inside the textarea, and the picker flows with the caret via
// `measureCaret`.

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from 'react';
import { v4 as uuid } from 'uuid';
import type { DocumentRecord, MentionToken } from '@/types';
import { useDocumentMentions } from '@/hooks/useDocumentMentions';
import {
  buildSentinel,
  parseMentions,
  parseMentionsWithRanges,
} from './parseMentions';
import { MentionChip } from './MentionChip';
import { DocPicker } from './DocPicker';
import { SectionPicker } from './SectionPicker';

interface PopoverState {
  kind: 'doc' | 'section';
  query: string;
  anchor: { left: number; top: number };
  pickedDoc?: DocumentRecord;
  editingTokenId?: string;
}

interface Props {
  value: string;
  ariaLabel?: string;
  placeholder?: string;
  className?: string;
  containerClassName?: string;
  containerStyle?: CSSProperties;
  onChange: (next: { text: string; mentions: MentionToken[] }) => void;
  onSubmit?: (e: KeyboardEvent<HTMLTextAreaElement>) => void;
  disabled?: boolean;
  onKeyDown?: (e: KeyboardEvent<HTMLTextAreaElement>) => void;
  /** Focus the textarea on mount and place the caret at the end. */
  autoFocus?: boolean;
}

export function MentionInput({
  value,
  ariaLabel,
  placeholder,
  className,
  containerClassName,
  containerStyle,
  onChange,
  onSubmit,
  disabled,
  onKeyDown,
  autoFocus,
}: Props) {
  const taRef = useRef<HTMLTextAreaElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const {
    documents,
    currentDocumentId,
    getDocById,
    getSections,
    getParagraphPreview,
  } = useDocumentMentions();

  const getSectionTitles = useCallback(
    (docId: string, paragraphIndexes: number[]): string[] => {
      const sections = getSections(docId);
      if (sections.length === 0 || paragraphIndexes.length === 0) return [];
      const selected = new Set(paragraphIndexes);
      return sections
        .filter(
          (s) =>
            s.paragraphIndexes.length > 0 &&
            s.paragraphIndexes.every((i) => selected.has(i))
        )
        .map((s) => s.title);
    },
    [getSections]
  );
  const [popover, setPopover] = useState<PopoverState | null>(null);
  const [mentions, setMentions] = useState<MentionToken[]>([]);

  // Resync from controlled `value` whenever the parent updates it
  // (e.g. after Send clears the input).
  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    if (ta.value !== value) {
      ta.value = value;
    }
    const { mentions: parsed } = parseMentions(value);
    setMentions(parsed);
  }, [value]);

  const handleInput = useCallback(
    (next: string) => {
      const ta = taRef.current;
      if (!ta) return;
      ta.value = next;
      const caret = ta.selectionStart ?? next.length;
      const atIdx = findOpenAtTrigger(next, caret);
      if (atIdx >= 0) {
        const coords = measureCaret(ta, atIdx + 1);
        const containerRect = containerRef.current?.getBoundingClientRect();
        setPopover({
          kind: 'doc',
          query: next.slice(atIdx + 1, caret),
          anchor: {
            left: containerRect
              ? Math.min(
                  Math.max(coords.left, containerRect.left),
                  containerRect.right - 240
                )
              : coords.left,
            top: coords.bottom,
          },
        });
      } else if (popover && popover.kind === 'doc') {
        setPopover(null);
      }
      const { mentions: parsed } = parseMentions(next);
      setMentions(parsed);
      onChange({ text: next, mentions: parsed });
    },
    [onChange, popover]
  );

  const replaceRangeRef = useRef<{ start: number; end: number } | null>(null);
  const editingTokenIdRef = useRef<string | null>(null);

  const onDocPicked = useCallback((doc: DocumentRecord) => {
    const ta = taRef.current;
    if (!ta) return;
    const caret = ta.selectionStart ?? ta.value.length;
    const atIdx = findOpenAtTrigger(ta.value, caret);
    if (atIdx < 0) {
      setPopover(null);
      return;
    }
    const range = { start: atIdx, end: caret };
    const coords = measureCaret(ta, atIdx);
    setPopover({
      kind: 'section',
      query: '',
      anchor: { left: coords.left, top: coords.bottom },
      pickedDoc: doc,
    });
    replaceRangeRef.current = range;
  }, []);

  const insertNewMention = useCallback(
    (doc: DocumentRecord, selectedIndexes: number[]) => {
      const ta = taRef.current;
      const range = replaceRangeRef.current;
      if (!ta || !range) {
        setPopover(null);
        return;
      }
      const kind = selectedIndexes.length > 0 ? 'doc-section' : 'doc';
      const token: MentionToken = {
        id: uuid(),
        kind,
        documentId: doc.id,
        documentTitle: doc.title || 'Untitled',
        paragraphIndexes: selectedIndexes,
        createdAt: Date.now(),
      };
      const sentinel = buildSentinel(token);
      const before = ta.value;
      const next =
        before.slice(0, range.start) + sentinel + before.slice(range.end);
      ta.value = next;
      const caret = range.start + sentinel.length;
      try {
        ta.setSelectionRange(caret, caret);
      } catch {
        /* ignore */
      }
      const { mentions: parsed } = parseMentions(next);
      setMentions(parsed);
      onChange({ text: next, mentions: parsed });
      replaceRangeRef.current = null;
      ta.focus();
      setPopover(null);
    },
    [onChange]
  );

  const onEditExistingSections = useCallback(
    (token: MentionToken) => {
      const doc = getDocById(token.documentId);
      if (!doc) return;
      const ta = taRef.current;
      if (!ta) return;
      const coords = measureCaret(ta, ta.selectionStart ?? 0);
      editingTokenIdRef.current = token.id;
      setPopover({
        kind: 'section',
        query: '',
        anchor: { left: coords.left, top: coords.bottom },
        pickedDoc: doc,
        editingTokenId: token.id,
      });
    },
    [getDocById]
  );

  const onSectionEditConfirm = useCallback(
    (selectedIndexes: number[]) => {
      const id = editingTokenIdRef.current;
      const ta = taRef.current;
      if (!id || !ta) {
        setPopover(null);
        editingTokenIdRef.current = null;
        return;
      }
      const currentValue = ta.value;
      const { mentions: parsed } = parseMentionsWithRanges(currentValue);
      const target = parsed.find((p) => p.token.id === id);
      if (!target) {
        setPopover(null);
        editingTokenIdRef.current = null;
        return;
      }
      const next: MentionToken = {
        ...target.token,
        kind: selectedIndexes.length > 0 ? 'doc-section' : 'doc',
        paragraphIndexes: selectedIndexes,
      };
      const nextText =
        currentValue.slice(0, target.start) +
        buildSentinel(next) +
        currentValue.slice(target.end);
      ta.value = nextText;
      const { mentions: newParsed } = parseMentions(nextText);
      setMentions(newParsed);
      onChange({ text: nextText, mentions: newParsed });
      editingTokenIdRef.current = null;
      setPopover(null);
    },
    [onChange]
  );

  const deleteMention = useCallback(
    (id: string) => {
      const ta = taRef.current;
      if (!ta) return;
      const currentValue = ta.value;
      const { mentions: parsed } = parseMentionsWithRanges(currentValue);
      const target = parsed.find((p) => p.token.id === id);
      if (!target) return;
      const next =
        currentValue.slice(0, target.start) + currentValue.slice(target.end);
      ta.value = next;
      const { mentions: newParsed } = parseMentions(next);
      setMentions(newParsed);
      onChange({ text: next, mentions: newParsed });
    },
    [onChange]
  );

  // Outside-click closes the picker.
  useEffect(() => {
    if (!popover) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest('.mention-popover')) return;
      if (containerRef.current?.contains(target)) return;
      setPopover(null);
      replaceRangeRef.current = null;
      editingTokenIdRef.current = null;
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [popover]);

  // Force re-layout when the chip list size changes so the textarea
  // height adjusts (the chips live in a row above the textarea; the
  // textarea reserves its own height and the chips wrap).
  useLayoutEffect(() => {
    // No-op for now — kept as a hook anchor for future layout work.
  }, [mentions.length]);

  return (
    <div
      ref={containerRef}
      className={`mention-input ${containerClassName ?? ''}`}
      style={{ position: 'relative', ...containerStyle }}
    >
      {mentions.length > 0 && (
        <div className="mention-input__chipbar" aria-label="Attached documents">
          {mentions.map((m) => {
            const doc = getDocById(m.documentId);
            return (
              <MentionChip
                key={m.id}
                token={m}
                isAvailable={!!doc}
                onDelete={() => deleteMention(m.id)}
                onEditSections={() => onEditExistingSections(m)}
                getParagraphPreview={getParagraphPreview}
                getSectionTitles={getSectionTitles}
              />
            );
          })}
        </div>
      )}
      <textarea
        ref={taRef}
        defaultValue={value}
        aria-label={ariaLabel}
        placeholder={placeholder}
        disabled={disabled}
        autoFocus={autoFocus}
        className={`mention-input__textarea ${className ?? ''}`}
        onChange={(e) => handleInput(e.target.value)}
        onFocus={(e) => {
          if (autoFocus) {
            // Place the caret at the end of the existing body so the
            // user doesn't have to click to continue typing.
            const len = e.target.value.length;
            try {
              e.target.setSelectionRange(len, len);
            } catch {
              /* ignore */
            }
          }
        }}
        onKeyDown={(e) => {
          if (
            onSubmit &&
            e.key === 'Enter' &&
            (e.metaKey || e.ctrlKey || !e.shiftKey)
          ) {
            e.preventDefault();
            onSubmit(e);
            return;
          }
          if (e.key === '@' && !popover) {
            queueMicrotask(() => {
              const ta = taRef.current;
              if (!ta) return;
              const caret = ta.selectionStart ?? 0;
              const coords = measureCaret(ta, caret);
              const containerRect = containerRef.current?.getBoundingClientRect();
              setPopover({
                kind: 'doc',
                query: '',
                anchor: {
                  left: containerRect
                    ? Math.min(
                        Math.max(coords.left, containerRect.left),
                        containerRect.right - 240
                      )
                    : coords.left,
                  top: coords.bottom,
                },
              });
            });
          }
          onKeyDown?.(e);
        }}
      />
      {popover?.kind === 'doc' && (
        <DocPicker
          documents={documents}
          currentDocumentId={currentDocumentId}
          query={popover.query}
          anchor={popover.anchor}
          onPick={onDocPicked}
          onClose={() => {
            setPopover(null);
            replaceRangeRef.current = null;
          }}
        />
      )}
      {popover?.kind === 'section' && popover.pickedDoc && (
        <SectionPicker
          doc={popover.pickedDoc}
          sections={getSections(popover.pickedDoc.id)}
          initialSelection={
            popover.editingTokenId
              ? mentions.find((m) => m.id === popover.editingTokenId)
                  ?.paragraphIndexes ?? []
              : []
          }
          anchor={popover.anchor}
          onConfirm={(idx) => {
            if (popover.editingTokenId) onSectionEditConfirm(idx);
            else if (popover.pickedDoc)
              insertNewMention(popover.pickedDoc, idx);
          }}
          onClose={() => {
            setPopover(null);
            replaceRangeRef.current = null;
            editingTokenIdRef.current = null;
          }}
        />
      )}
    </div>
  );
}

// ---- helpers ----

function findOpenAtTrigger(text: string, caret: number): number {
  // Scan backwards from caret, skipping any sentinels we cross. A
  // sentinel is a zero-width block of form `\u200B[[mention:…]]\u200B`.
  let i = caret - 1;
  while (i >= 0) {
    // Detect sentinel close: `]]\u200B`. The `]]` lives at i-1..i.
    if (i >= 1 && text[i] === '\u200B' && text[i - 1] === ']') {
      // Find the matching open.
      const closeIdx = i; // index of trailing ZWSP
      const openStart = text.lastIndexOf('\u200B[[mention:', closeIdx);
      if (openStart === -1) return -1;
      i = openStart - 1;
      continue;
    }
    if (text[i] === '@') return i;
    i--;
  }
  return -1;
}

function measureCaret(
  ta: HTMLTextAreaElement,
  caret: number
): { left: number; bottom: number } {
  const div = document.createElement('div');
  const style = window.getComputedStyle(ta);
  const props: (keyof CSSStyleDeclaration)[] = [
    'boxSizing',
    'width',
    'height',
    'overflowX',
    'overflowY',
    'borderTopWidth',
    'borderRightWidth',
    'borderBottomWidth',
    'borderLeftWidth',
    'paddingTop',
    'paddingRight',
    'paddingBottom',
    'paddingLeft',
    'fontStyle',
    'fontVariant',
    'fontWeight',
    'fontStretch',
    'fontSize',
    'fontSizeAdjust',
    'lineHeight',
    'fontFamily',
    'textAlign',
    'textTransform',
    'textIndent',
    'textDecoration',
    'letterSpacing',
    'wordSpacing',
    'tabSize',
  ];
  for (const p of props) {
    // @ts-expect-error - dynamic CSS property access
    div.style[p] = style[p];
  }
  div.style.position = 'absolute';
  div.style.visibility = 'hidden';
  div.style.whiteSpace = 'pre-wrap';
  div.style.wordWrap = 'break-word';
  div.style.top = '0';
  div.style.left = '0';
  const before = ta.value.slice(0, caret);
  const span = document.createElement('span');
  span.textContent = '\u200B';
  div.textContent = before;
  div.appendChild(span);
  document.body.appendChild(div);
  const spanRect = span.getBoundingClientRect();
  const coords = { left: spanRect.left, bottom: spanRect.bottom };
  document.body.removeChild(div);
  return coords;
}
