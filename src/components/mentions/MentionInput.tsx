// MentionInput — an @-aware textarea replacement.
//
// The textarea is the source of truth for the user-visible plain text.
// Mention tokens are stored externally (passed back to the parent on
// every change) and re-encoded as zero-width sentinel sequences only
// when sending to the LLM. The textarea **never** displays the raw
// sentinel — the user sees the prose they typed, the chip pills in
// the row above show the meaningful caption (doc title + section
// summary), and the raw sentinel is rebuilt from the plain text +
// mention positions on `onChange`.
//
// This is intentionally simpler than a Tiptap-style in-line chip
// renderer: chips are pills above the textarea, the textarea shows
// only typed prose, and clicking a chip re-opens the section picker
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
  parseRawWithMentions,
  serializeRawWithMentions,
  plainTextDiff,
  type MentionPosition,
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
  /** Raw value carrying mention sentinels. Used to seed initial
   *  state and to receive external resets (e.g. "Send" clears it). */
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

/**
 * Re-parse the raw `value` prop into the three things the textarea
 * needs: the plain text it displays, the mention list (for the chip
 * bar), and the per-mention position map (so the raw value can be
 * re-serialised on `onChange`).
 */
function parseRaw(value: string) {
  return parseRawWithMentions(value);
}

/**
 * Reader-friendly inline caption for a mention, matching what the
 * chip pill above the textarea shows. The picker's `getSectionTitles`
 * callback resolves section titles from paragraph indexes; when
 * titles are available we render the same "§ <first> +N more"
 * string the chip uses. For whole-doc mentions the chip says "full
 * document" which reads awkwardly as prose, so we substitute the
 * document title — both readable and matches the row above.
 */
function captionForMention(
  token: MentionToken,
  sectionTitles: string[]
): string {
  const title = token.documentTitle || 'Untitled';
  if (token.kind === 'doc' || token.paragraphIndexes.length === 0) {
    return title;
  }
  if (sectionTitles.length > 0) {
    if (sectionTitles.length === 1) return `§ ${sectionTitles[0]}`;
    return `§ ${sectionTitles[0]} +${sectionTitles.length - 1} more`;
  }
  // Fallback when the section titles can't be resolved (doc deleted
  // or the resolver returned nothing).
  return `§ paragraph ${token.paragraphIndexes[0] + 1}`;
}

/**
 * Insert a leading space when the character immediately before
 * `pos` is a non-whitespace, non-start character. Keeps the inline
 * caption from running into the previous word.
 */
function needsLeadingSpace(plain: string, pos: number): boolean {
  if (pos <= 0) return false;
  const ch = plain[pos - 1];
  return !!ch && ch !== ' ' && ch !== '\n' && ch !== '\t' && ch !== '\r';
}

/**
 * `parseRawWithMentions` leaves each mention as a zero-width slot
 * (serialize strips the caption into a sentinel). Expand those slots
 * back into caption + ZWSP so the textarea shows the same mark the
 * chip bar does. Mentions that already own a non-empty range are
 * left alone.
 */
function mentionListEqual(a: MentionToken[], b: MentionToken[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    if (
      x.id !== y.id ||
      x.kind !== y.kind ||
      x.documentId !== y.documentId ||
      x.documentTitle !== y.documentTitle ||
      x.paragraphIndexes.length !== y.paragraphIndexes.length ||
      x.paragraphIndexes.some((n, j) => n !== y.paragraphIndexes[j])
    ) {
      return false;
    }
  }
  return true;
}

function positionMapEqual(
  a: Map<string, MentionPosition>,
  b: Map<string, MentionPosition>
): boolean {
  if (a === b) return true;
  if (a.size !== b.size) return false;
  for (const [id, p] of a) {
    const q = b.get(id);
    if (!q || q.plainStart !== p.plainStart || q.plainEnd !== p.plainEnd) {
      return false;
    }
  }
  return true;
}

function hydrateDisplayCaptions(
  plain: string,
  mentions: MentionToken[],
  positions: Map<string, MentionPosition>,
  resolveTitles: (docId: string, paragraphIndexes: number[]) => string[]
): { plain: string; positions: Map<string, MentionPosition> } {
  const ordered = mentions
    .map((m) => ({ m, p: positions.get(m.id) }))
    .filter(
      (x): x is { m: MentionToken; p: MentionPosition } =>
        !!x.p && x.p.plainEnd === x.p.plainStart
    )
    // Insert from the end so earlier offsets stay valid.
    .sort((a, b) => b.p.plainStart - a.p.plainStart);

  let nextPlain = plain;
  const nextPositions = new Map(positions);
  for (const { m, p } of ordered) {
    const caption = captionForMention(
      m,
      resolveTitles(m.documentId, m.paragraphIndexes)
    );
    const lead = needsLeadingSpace(nextPlain, p.plainStart) ? ' ' : '';
    const replacement = lead + caption + '\u200B';
    nextPlain =
      nextPlain.slice(0, p.plainStart) +
      replacement +
      nextPlain.slice(p.plainStart);
    nextPositions.set(m.id, {
      plainStart: p.plainStart,
      plainEnd: p.plainStart + replacement.length,
    });
  }
  return { plain: nextPlain, positions: nextPositions };
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
  // Keep a stable ref so value-sync can hydrate captions without
  // putting an unstable callback in the effect deps (getSections is
  // recreated every render → would infinite-loop setState).
  const getSectionTitlesRef = useRef(getSectionTitles);
  getSectionTitlesRef.current = getSectionTitles;

  // Same ≥2-documents rule as the in-app help copy in useStore
  // ("You need at least two documents in the sidebar.").
  const canMention = documents.length >= 2;

  // The textarea's display value is ALWAYS the plain text — never
  // the raw value with sentinels. Mention metadata + positions are
  // tracked separately and re-encoded as a raw value on `onChange`.
  const [plainText, setPlainText] = useState<string>(() =>
    parseRaw(value ?? '').plain
  );
  const [positions, setPositions] = useState<Map<string, MentionPosition>>(
    () => parseRaw(value ?? '').positions
  );
  const [mentions, setMentions] = useState<MentionToken[]>(() =>
    parseRaw(value ?? '').mentions
  );
  const [popover, setPopover] = useState<PopoverState | null>(null);

  // Pixel rects of each mention's range inside the textarea. Used
  // to position the clickable inline chip overlay. Recomputed when
  // the plain text, positions, or textarea dimensions change.
  const [chipRects, setChipRects] = useState<
    Map<string, { left: number; top: number; width: number; height: number }>
  >(new Map());

  // Resync from external `value` changes (e.g. parent resets the
  // input after Send, or hydrates a draft). Only touches the
  // textarea when the plain text actually differs, to preserve the
  // user's caret position for same-content re-renders.
  //
  // Raw values carry sentinels without the inline caption, so we
  // re-hydrate caption + ZWSP into the display plain text here —
  // otherwise the marker the user just inserted vanishes as soon
  // as the parent echoes `value` back.
  useEffect(() => {
    const parsed = parseRaw(value ?? '');
    const { plain, positions: hydratedPositions } = hydrateDisplayCaptions(
      parsed.plain,
      parsed.mentions,
      parsed.positions,
      (docId, indexes) => getSectionTitlesRef.current(docId, indexes)
    );
    setPlainText((prev) => (prev === plain ? prev : plain));
    setMentions((prev) =>
      mentionListEqual(prev, parsed.mentions) ? prev : parsed.mentions
    );
    setPositions((prev) =>
      positionMapEqual(prev, hydratedPositions) ? prev : hydratedPositions
    );
    const ta = taRef.current;
    if (ta && ta.value !== plain) ta.value = plain;
  }, [value]);

  const handleInput = useCallback(
    (nextPlain: string) => {
      const prevPlain = plainText;
      if (nextPlain === prevPlain) return;
      const { prefixLen, oldEnd, newEnd } = plainTextDiff(prevPlain, nextPlain);
      const oldRemoved = oldEnd - prefixLen;
      const newAdded = newEnd - prefixLen;
      // Shift / drop mention positions based on the diff. With the
      // range model each mention owns [plainStart, plainEnd) where
      // the ZWSP lives at plainEnd - 1. The mention is dropped
      // when the deletion reaches that ZWSP — i.e. when the
      // deletion range extends past `plainEnd - 1`. Otherwise the
      // range shifts by the net delta (insertion length minus
      // deletion length) when the diff starts before the range.
      setPositions((prev) => {
        const next = new Map<string, MentionPosition>();
        for (const [id, p] of prev.entries()) {
          const zwspAt = p.plainEnd - 1;
          if (oldEnd > zwspAt) {
            // The deletion range reached (or passed) the ZWSP
            // marker, so the mention is no longer anchored. Drop it.
            continue;
          }
          if (p.plainStart >= oldEnd) {
            // Range sits entirely in the unchanged tail — shift.
            const delta = newAdded - oldRemoved;
            next.set(id, {
              plainStart: p.plainStart + delta,
              plainEnd: p.plainEnd + delta,
            });
          } else if (oldEnd > p.plainStart) {
            // Diff started before the range but the ZWSP survived
            // (e.g. user edited the leading text of the inline
            // caption). The new start is `prefixLen`; the end shifts
            // by the net delta to preserve the post-diff length.
            const delta = newAdded - oldRemoved;
            next.set(id, {
              plainStart: prefixLen,
              plainEnd: p.plainEnd + delta,
            });
          } else {
            // Range sits entirely in the unchanged prefix — keep.
            next.set(id, p);
          }
        }
        return next;
      });
      // Drop mentions whose ZWSP was inside the deleted range from
      // the visible list too (mirror the positions update above).
      setMentions((prev) =>
        prev.filter((m) => {
          const p = positions.get(m.id);
          if (!p) return false;
          return !(oldEnd > p.plainEnd - 1);
        })
      );
      setPlainText(nextPlain);

      // @-trigger detection: did the user just type `@`?
      const caret = newEnd;
      if (canMention && caret > 0 && nextPlain[caret - 1] === '@') {
        const ta = taRef.current;
        if (ta) {
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
        }
      } else if (popover && popover.kind === 'doc') {
        // Re-derive the open query (text after the most recent `@`).
        const atIdx = findOpenAtTrigger(nextPlain, caret);
        if (atIdx < 0) {
          setPopover(null);
        } else if (nextPlain[atIdx] === '@') {
          setPopover({ ...popover, query: nextPlain.slice(atIdx + 1, caret) });
        }
      }

      // Emit the new raw value to the parent.
      const newRaw = serializeRawWithMentions(
        nextPlain,
        // We can't read the just-set `positions` here (state is
        // async), so reconstruct from the patched positions we
        // computed above. Use a closure-captured map.
        patchPositionsForSerialize(positions, prefixLen, oldEnd, newAdded - oldRemoved),
        mentions
      );
      onChange({ text: newRaw, mentions });
    },
    [canMention, mentions, onChange, plainText, popover, positions]
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
      const range = replaceRangeRef.current;
      if (!range) {
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
      // Build the inline caption (same string the chip pill shows
      // above). The picker has the section titles in hand; pass them
      // in directly to avoid a redundant re-derivation.
      const sectionTitles = getSectionTitles(doc.id, selectedIndexes);
      const caption = captionForMention(token, sectionTitles);
      const lead = needsLeadingSpace(plainText, range.start) ? ' ' : '';
      // The mention owns a range: [plainStart, plainEnd) covering
      // the inline caption + a single trailing ZWSP marker. The
      // ZWSP is the structural anchor — if the user deletes it the
      // mention is dropped. The inline caption is regular prose and
      // can be edited freely; the mention's metadata (paragraph
      // indexes, kind) is unchanged.
      const replacement = lead + caption + '\u200B';
      const before = plainText.slice(0, range.start);
      const after = plainText.slice(range.end);
      const newPlain = before + replacement + after;
      const insertAt = before.length;
      const newPositions = new Map(positions);
      newPositions.set(token.id, {
        plainStart: insertAt,
        plainEnd: insertAt + replacement.length,
      });
      const newMentions = [...mentions, token];
      setPlainText(newPlain);
      setPositions(newPositions);
      setMentions(newMentions);
      // Restore caret to just after the inserted caption + ZWSP.
      const ta = taRef.current;
      if (ta) {
        ta.value = newPlain;
        const caret = insertAt + replacement.length;
        try {
          ta.setSelectionRange(caret, caret);
        } catch {
          /* ignore */
        }
        ta.focus();
      }
      const newRaw = serializeRawWithMentions(newPlain, newPositions, newMentions);
      onChange({ text: newRaw, mentions: newMentions });
      replaceRangeRef.current = null;
      setPopover(null);
    },
    [getSectionTitles, mentions, onChange, plainText, positions]
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
      if (!id) {
        setPopover(null);
        editingTokenIdRef.current = null;
        return;
      }
      const target = mentions.find((m) => m.id === id);
      if (!target) {
        setPopover(null);
        editingTokenIdRef.current = null;
        return;
      }
      const next: MentionToken = {
        ...target,
        kind: selectedIndexes.length > 0 ? 'doc-section' : 'doc',
        paragraphIndexes: selectedIndexes,
      };
      // Refresh the inline caption so it reflects the new sections
      // (or whole-doc). The old caption lived at positions[id];
      // splice in the new caption + ZWSP at the same anchor point.
      const sectionTitles = getSectionTitles(next.documentId, selectedIndexes);
      const newCaption = captionForMention(next, sectionTitles);
      const pos = positions.get(id);
      let newPlain = plainText;
      let newPositions = new Map(positions);
      if (pos) {
        // Preserve the leading space (if any) that was inserted
        // before the previous caption — it's the first char of the
        // owned range. The new caption is placed in the same spot.
        const oldRange = plainText.slice(pos.plainStart, pos.plainEnd);
        // Strip the trailing ZWSP from the old range; the rest
        // (leading space + old caption) is what the user expects
        // to keep around.
        const oldCaption = oldRange.endsWith('\u200B')
          ? oldRange.slice(0, -1)
          : oldRange;
        const lead = oldCaption.length > 0 && oldCaption[0] === ' ' ? ' ' : '';
        const replacement = lead + newCaption + '\u200B';
        newPlain =
          plainText.slice(0, pos.plainStart) +
          replacement +
          plainText.slice(pos.plainEnd);
        newPositions = new Map(positions);
        newPositions.set(id, {
          plainStart: pos.plainStart,
          plainEnd: pos.plainStart + replacement.length,
        });
      }
      const newMentions = mentions.map((m) => (m.id === id ? next : m));
      setPlainText(newPlain);
      setPositions(newPositions);
      setMentions(newMentions);
      // Restore caret to end of new caption.
      const ta = taRef.current;
      if (ta) {
        ta.value = newPlain;
        const newPos = newPositions.get(id);
        if (newPos) {
          const caret = newPos.plainEnd;
          try {
            ta.setSelectionRange(caret, caret);
          } catch {
            /* ignore */
          }
        }
        ta.focus();
      }
      const newRaw = serializeRawWithMentions(newPlain, newPositions, newMentions);
      onChange({ text: newRaw, mentions: newMentions });
      editingTokenIdRef.current = null;
      setPopover(null);
    },
    [getSectionTitles, mentions, onChange, plainText, positions]
  );

  const deleteMention = useCallback(
    (id: string) => {
      const target = positions.get(id);
      if (!target) return;
      // Remove the whole owned range (inline caption + ZWSP).
      const newPlain =
        plainText.slice(0, target.plainStart) + plainText.slice(target.plainEnd);
      // Shift every later position left by the size of the removed
      // range.
      const removed = target.plainEnd - target.plainStart;
      const newPositions = new Map<string, MentionPosition>();
      for (const [k, p] of positions.entries()) {
        if (k === id) continue;
        if (p.plainStart >= target.plainEnd) {
          newPositions.set(k, {
            plainStart: p.plainStart - removed,
            plainEnd: p.plainEnd - removed,
          });
        } else {
          newPositions.set(k, p);
        }
      }
      const newMentions = mentions.filter((m) => m.id !== id);
      setPlainText(newPlain);
      setPositions(newPositions);
      setMentions(newMentions);
      const ta = taRef.current;
      if (ta) {
        ta.value = newPlain;
        const caret = target.plainStart;
        try {
          ta.setSelectionRange(caret, caret);
        } catch {
          /* ignore */
        }
        ta.focus();
      }
      const newRaw = serializeRawWithMentions(newPlain, newPositions, newMentions);
      onChange({ text: newRaw, mentions: newMentions });
    },
    [mentions, onChange, plainText, positions]
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

  // Recompute the chip overlay rects whenever the plain text, the
  // mention positions, or the textarea dimensions change. We use
  // `measureRange` (a hidden mirrored div) to get the pixel rect of
  // each mention's range inside the textarea; the result is in
  // textarea-relative coordinates.
  useLayoutEffect(() => {
    const ta = taRef.current;
    if (!ta) {
      setChipRects(new Map());
      return;
    }
    const next = new Map<
      string,
      { left: number; top: number; width: number; height: number }
    >();
    for (const m of mentions) {
      const pos = positions.get(m.id);
      if (!pos) continue;
      // The caption is the visible text up to (but excluding) the
      // trailing ZWSP. Measure the caption range so the chip overlay
      // lands on the right pixels; the ZWSP itself is invisible.
      const captionEnd = pos.plainEnd - 1;
      if (captionEnd <= pos.plainStart) continue;
      const rect = measureRange(ta, pos.plainStart, captionEnd);
      if (rect && rect.width > 0) next.set(m.id, rect);
    }
    setChipRects(next);
  }, [plainText, positions, mentions]);

  // Reposition the chip overlay when the window resizes or the
  // textarea itself is resized (e.g. sibling layout changes). The
  // effect above only re-runs when text/positions change, so we need
  // an explicit listener for size changes.
  useEffect(() => {
    const handler = () => {
      const ta = taRef.current;
      if (!ta) return;
      const next = new Map<
        string,
        { left: number; top: number; width: number; height: number }
      >();
      for (const m of mentions) {
        const pos = positions.get(m.id);
        if (!pos) continue;
        const captionEnd = pos.plainEnd - 1;
        if (captionEnd <= pos.plainStart) continue;
        const rect = measureRange(ta, pos.plainStart, captionEnd);
        if (rect && rect.width > 0) next.set(m.id, rect);
      }
      setChipRects(next);
    };
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, [mentions, positions]);

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
        defaultValue={plainText}
        aria-label={ariaLabel}
        placeholder={placeholder}
        disabled={disabled}
        aria-disabled={disabled}
        title={
          !canMention
            ? 'Open a second document in the sidebar to use @-references.'
            : undefined
        }
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
          if (canMention && e.key === '@' && !popover) {
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
      {/* Inline chip overlay. Paints a clickable region over each
          mention's caption in the prose, so the user can click the
          chip text in the prose to re-open the section picker (same
          effect as clicking the chip pill in the chip bar above).
          The overlay sits between the textarea (z-index 0) and the
          pickers (z-index 60), and only intercepts pointer events
          inside the chip rects — the rest of the textarea is
          untouched. */}
      {mentions.length > 0 && (
        <div className="mention-input__overlay" aria-hidden>
          {mentions.map((m) => {
            const rect = chipRects.get(m.id);
            if (!rect) return null;
            const doc = getDocById(m.documentId);
            return (
              <button
                key={m.id}
                type="button"
                className="mention-input__overlay-chip"
                style={{
                  left: rect.left,
                  top: rect.top,
                  width: rect.width,
                  height: rect.height,
                }}
                title={
                  doc
                    ? `Edit sections referenced from "${doc.title || 'Untitled'}"`
                    : 'Source document was deleted'
                }
                disabled={!doc}
                onMouseDown={(e) => e.preventDefault()}
                onClick={(e) => {
                  e.stopPropagation();
                  if (doc) onEditExistingSections(m);
                }}
              />
            );
          })}
        </div>
      )}
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

/**
 * Apply the same diff-based patch that `handleInput` uses, to a
 * fresh map. Used so we can compute the serialized raw value inside
 * the same `handleInput` invocation without waiting for the
 * `setPositions` state update to flush.
 */
function patchPositionsForSerialize(
  prev: Map<string, MentionPosition>,
  prefixLen: number,
  oldEnd: number,
  delta: number
): Map<string, MentionPosition> {
  const next = new Map<string, MentionPosition>();
  for (const [id, p] of prev.entries()) {
    const zwspAt = p.plainEnd - 1;
    if (oldEnd > zwspAt) continue; // ZWSP removed → drop the mention.
    if (p.plainStart >= oldEnd) {
      next.set(id, {
        plainStart: p.plainStart + delta,
        plainEnd: p.plainEnd + delta,
      });
    } else if (oldEnd > p.plainStart) {
      next.set(id, {
        plainStart: prefixLen,
        plainEnd: p.plainEnd + delta,
      });
    } else {
      next.set(id, p);
    }
  }
  return next;
}

function findOpenAtTrigger(text: string, caret: number): number {
  // Scan backwards from caret, skipping any sentinels we cross. A
  // sentinel is a zero-width block of form `\u200B[[mention:…]]\u200B`.
  let i = caret - 1;
  while (i >= 0) {
    // Detect sentinel close: `]]\u200B`. The `]]` lives at i-1..i.
    if (i >= 1 && text[i] === '\u200B' && text[i - 1] === ']') {
      // Find the matching open.
      const closeIdx = i; // index of trailing ZWSP
      const openStart = text.lastIndexOf('\u200B', closeIdx);
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

/**
 * Measure a character range inside the textarea and return its
 * bounding rect, in textarea-relative coordinates. Used to position
 * the inline chip overlay over the @-mention caption text.
 */
function measureRange(
  ta: HTMLTextAreaElement,
  start: number,
  end: number
): { left: number; top: number; width: number; height: number } | null {
  if (start === end) return null;
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
  // Mirror: text before the range, then a span with the range
  // content, then text after. We measure the span's rect.
  const before = ta.value.slice(0, start);
  const inside = ta.value.slice(start, end);
  const after = ta.value.slice(end);
  div.textContent = before;
  const span = document.createElement('span');
  span.textContent = inside;
  div.appendChild(span);
  div.appendChild(document.createTextNode(after));
  document.body.appendChild(div);
  const spanRect = span.getBoundingClientRect();
  const taRect = ta.getBoundingClientRect();
  // Discard the result if the span collapsed (e.g. start == end or
  // both zero-width). The `width: 0` branch is the natural one for
  // a pure-ZWSP range.
  const coords = {
    left: spanRect.left - taRect.left,
    top: spanRect.top - taRect.top,
    width: spanRect.width,
    height: spanRect.height,
  };
  document.body.removeChild(div);
  return coords;
}
