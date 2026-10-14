// Shared hook for the @-mention system. Exposes the documents list,
// per-document paragraph previews, and heading-grouped sections for
// the section picker. Paragraph boundaries stay in sync with
// `buildDocOutline` in `src/api/chat.ts` so picker previews / section
// ranges and the prompt outline describe the same shape of the
// document.

import { useMemo } from 'react';
import { useStore } from '@/store/useStore';
import type { DocumentRecord } from '@/types';

export interface ParagraphInfo {
  /** 0-based paragraph index. */
  index: number;
  /** Start offset into the document text. */
  start: number;
  /** End offset (exclusive) into the document text. */
  end: number;
  /** First ~60 chars, trimmed, with word-boundary cutoff. Same rule
   *  as the prompt outline so the picker matches what the AI sees. */
  preview: string;
}

/**
 * A selectable unit in the section picker. Prefer markdown headings
 * (and sub-headings); fall back to blank-line blocks when a document
 * has no headings. Each section maps to one or more paragraph indexes
 * so existing `MentionToken.paragraphIndexes` storage stays valid.
 */
export interface HeadingSection {
  /** 0-based index into the sections list for this document. */
  index: number;
  /**
   * Heading level 1–6 for ATX/Setext headings. `0` for preamble
   * (content before the first heading) or blank-line fallback blocks.
   */
  level: number;
  /** Display title (heading text, or a short preview for preamble). */
  title: string;
  /** Start offset into the document text. */
  start: number;
  /** End offset (exclusive) into the document text. */
  end: number;
  /** 0-based paragraph indexes covered by this section. */
  paragraphIndexes: number[];
}

const OUTLINE_PREVIEW_CHARS = 60;

// ATX headings require `#` to start at the line's first column
// (CommonMark §4.2). An indented `#` is a quoted / code-block line,
// not a heading. The title must contain at least one non-space
// character so a lone `#` is not promoted. The closing `#+` run is
// stripped at match time so the captured title is clean. Leading
// whitespace is checked separately against the *un*trimmed line
// because `paragraphRawText` strips it before we get here.
const ATX_HEADING_RE = /^(#{1,6})\s+(.+?)\s*#*\s*$/;
const SETEXT_H1_RE = /^=+\s*$/;
const SETEXT_H2_RE = /^-{2,}\s*$/;

function trimOnWordBoundary(s: string, max: number): string {
  if (s.length <= max) return s;
  const sliced = s.slice(0, max);
  const sp = sliced.lastIndexOf(' ');
  if (sp > max / 2) return sliced.slice(0, sp);
  return sliced;
}

/** Compute paragraph boundaries for a document, matching buildDocOutline. */
export function splitParagraphs(content: string): number[] {
  const starts: number[] = [0];
  for (let i = 0; i < content.length; i++) {
    if (content.charCodeAt(i) === 10) {
      const next = i + 1;
      if (next < content.length && starts[starts.length - 1] !== next) {
        starts.push(next);
      }
    }
  }
  return starts;
}

/** Build a list of paragraph info objects for a document. */
export function buildParagraphs(doc: DocumentRecord): ParagraphInfo[] {
  const starts = splitParagraphs(doc.content);
  return starts.map((start, i) => {
    const end = i + 1 < starts.length ? starts[i + 1] : doc.content.length;
    const raw = doc.content.slice(start, end).replace(/\s+/g, ' ').trim();
    const preview =
      raw.length <= OUTLINE_PREVIEW_CHARS
        ? raw
        : trimOnWordBoundary(raw, OUTLINE_PREVIEW_CHARS) + '…';
    return { index: i, start, end, preview };
  });
}

function paragraphRawText(doc: DocumentRecord, p: ParagraphInfo): string {
  return doc.content.slice(p.start, p.end).replace(/\s+/g, ' ').trim();
}

interface HeadingMark {
  /** Paragraph index of the heading title line. */
  paraIndex: number;
  level: number;
  title: string;
  /**
   * For Setext headings the underline is a separate paragraph; skip
   * it when scanning for the next heading.
   */
  underlineParaIndex?: number;
}

function detectHeadingAt(
  doc: DocumentRecord,
  paragraphs: ParagraphInfo[],
  i: number
): HeadingMark | null {
  const raw = paragraphRawText(doc, paragraphs[i]);
  if (!raw) return null;

  // Reject paragraphs whose un-trimmed content starts with a space
  // or tab — those are quoted / indented code-block lines, not
  // headings (CommonMark §4.2).
  const originalSlice = doc.content.slice(paragraphs[i].start, paragraphs[i].end);
  if (/^[ \t]/.test(originalSlice)) return null;

  const atx = raw.match(ATX_HEADING_RE);
  if (atx) {
    // Strip the optional closing `#+` run from the lazy title capture
    // (e.g. `## Title ##` → "Title").
    const rawTitle = atx[2].replace(/\s+#+\s*$/, '').trim();
    return {
      paraIndex: i,
      level: atx[1].length,
      title: rawTitle,
    };
  }

  // Setext: title on this line, === / --- on the next non-empty line.
  if (i + 1 < paragraphs.length) {
    const nextRaw = paragraphRawText(doc, paragraphs[i + 1]);
    // Don't promote when the line *above* this one is already a heading
    // (ATX or setext). CommonMark's setext rule treats the underline
    // as turning the *previous paragraph* into a heading — but if that
    // previous paragraph is itself a heading, a second promotion would
    // silently steal the body line (e.g. `# Title\nSub-line\n===` would
    // otherwise make "Sub-line" an L1 heading and strip "Title" of
    // its body). Setext-under-an-ATX-heading should fall back to
    // treating the second line as the setext title and the ATX line
    // above as a separate heading; but only if the ATX line is the
    // IMMEDIATE previous paragraph (i.e. blank-line-free).
    const prevIsHeading =
      i > 0 && paragraphRawText(doc, paragraphs[i - 1]).match(ATX_HEADING_RE) !== null;
    if (!prevIsHeading) {
      if (SETEXT_H1_RE.test(nextRaw)) {
        return {
          paraIndex: i,
          level: 1,
          title: raw,
          underlineParaIndex: i + 1,
        };
      }
      if (SETEXT_H2_RE.test(nextRaw)) {
        return {
          paraIndex: i,
          level: 2,
          title: raw,
          underlineParaIndex: i + 1,
        };
      }
    }
  }
  return null;
}

function indexesInRange(
  paragraphs: ParagraphInfo[],
  startPara: number,
  endParaExclusive: number
): number[] {
  const out: number[] = [];
  for (let i = startPara; i < endParaExclusive; i++) {
    out.push(paragraphs[i].index);
  }
  return out;
}

/**
 * Group a document into selectable heading / sub-heading sections.
 *
 * Each markdown heading becomes one option spanning from that heading
 * through the content that follows it, up to (but not including) the
 * next heading of any level. Content before the first heading is
 * exposed as a preamble section when non-empty.
 *
 * Documents with no headings fall back to blank-line-separated blocks
 * so the picker still offers coarse chunks instead of every `\n`.
 */
export function buildHeadingSections(
  doc: DocumentRecord,
  paragraphs: ParagraphInfo[] = buildParagraphs(doc)
): HeadingSection[] {
  if (paragraphs.length === 0) return [];
  if (doc.content.length === 0) return [];

  const headings: HeadingMark[] = [];
  for (let i = 0; i < paragraphs.length; i++) {
    const mark = detectHeadingAt(doc, paragraphs, i);
    if (!mark) continue;
    headings.push(mark);
    if (mark.underlineParaIndex !== undefined) {
      // Skip the underline paragraph on the next loop iteration.
      i = mark.underlineParaIndex;
    }
  }

  if (headings.length === 0) {
    return buildBlankLineSections(doc, paragraphs);
  }

  const sections: HeadingSection[] = [];
  const firstHeadingPara = headings[0].paraIndex;

  // Preamble: any non-whitespace content before the first heading.
  if (firstHeadingPara > 0) {
    const preStart = paragraphs[0].start;
    const preEnd = paragraphs[firstHeadingPara].start;
    const preText = doc.content.slice(preStart, preEnd).replace(/\s+/g, ' ').trim();
    if (preText) {
      const preview =
        preText.length <= OUTLINE_PREVIEW_CHARS
          ? preText
          : trimOnWordBoundary(preText, OUTLINE_PREVIEW_CHARS) + '…';
      sections.push({
        index: sections.length,
        level: 0,
        title: preview,
        start: preStart,
        end: preEnd,
        paragraphIndexes: indexesInRange(paragraphs, 0, firstHeadingPara),
      });
    }
  }

  for (let h = 0; h < headings.length; h++) {
    const mark = headings[h];
    const startPara = mark.paraIndex;
    const nextHeadingPara =
      h + 1 < headings.length
        ? headings[h + 1].paraIndex
        : paragraphs.length;
    const start = paragraphs[startPara].start;
    const end =
      nextHeadingPara < paragraphs.length
        ? paragraphs[nextHeadingPara].start
        : doc.content.length;
    sections.push({
      index: sections.length,
      level: mark.level,
      title: mark.title,
      start,
      end,
      paragraphIndexes: indexesInRange(paragraphs, startPara, nextHeadingPara),
    });
  }

  return sections;
}

/**
 * Fallback when a document has no markdown headings: group on blank
 * lines (one or more empty paragraphs) so soft-wrapped body lines
 * stay together.
 */
function buildBlankLineSections(
  doc: DocumentRecord,
  paragraphs: ParagraphInfo[]
): HeadingSection[] {
  const sections: HeadingSection[] = [];
  let blockStart = 0;

  const flush = (endExclusive: number) => {
    // Skip leading empty paragraphs inside the prospective block.
    let start = blockStart;
    while (
      start < endExclusive &&
      !paragraphRawText(doc, paragraphs[start])
    ) {
      start++;
    }
    if (start >= endExclusive) {
      blockStart = endExclusive;
      return;
    }
    // Trim trailing empties from the block range for the title, but
    // keep them in paragraphIndexes so offsets stay contiguous.
    const startOffset = paragraphs[start].start;
    const endOffset =
      endExclusive < paragraphs.length
        ? paragraphs[endExclusive].start
        : doc.content.length;
    const raw = doc.content
      .slice(startOffset, endOffset)
      .replace(/\s+/g, ' ')
      .trim();
    if (!raw) {
      blockStart = endExclusive;
      return;
    }
    const preview =
      raw.length <= OUTLINE_PREVIEW_CHARS
        ? raw
        : trimOnWordBoundary(raw, OUTLINE_PREVIEW_CHARS) + '…';
    sections.push({
      index: sections.length,
      level: 0,
      title: preview,
      start: startOffset,
      end: endOffset,
      paragraphIndexes: indexesInRange(paragraphs, start, endExclusive),
    });
    blockStart = endExclusive;
  };

  for (let i = 0; i < paragraphs.length; i++) {
    if (!paragraphRawText(doc, paragraphs[i])) {
      // Blank line closes the current block (if any content preceded it).
      if (i > blockStart) flush(i);
      blockStart = i + 1;
    }
  }
  if (blockStart < paragraphs.length) flush(paragraphs.length);

  // Degenerate: document is only whitespace → single empty-ish section
  // so the picker is not blank.
  if (sections.length === 0 && paragraphs.length > 0) {
    sections.push({
      index: 0,
      level: 0,
      title: '(empty)',
      start: 0,
      end: doc.content.length,
      paragraphIndexes: paragraphs.map((p) => p.index),
    });
  }

  return sections;
}

/**
 * Given a set of selected paragraph indexes, return the section
 * indexes that should appear checked when re-editing a mention.
 * Prefers fully covered sections; if none match (legacy paragraph-
 * level picks), falls back to sections that overlap the selection.
 */
export function sectionsMatchingSelection(
  sections: HeadingSection[],
  selectedParagraphIndexes: number[]
): number[] {
  if (selectedParagraphIndexes.length === 0) return [];
  const selected = new Set(selectedParagraphIndexes);
  const full: number[] = [];
  const partial: number[] = [];
  for (const s of sections) {
    if (s.paragraphIndexes.length === 0) continue;
    const hits = s.paragraphIndexes.filter((i) => selected.has(i)).length;
    if (hits === 0) continue;
    if (hits === s.paragraphIndexes.length) full.push(s.index);
    else partial.push(s.index);
  }
  return full.length > 0 ? full : partial;
}

/**
 * Return the indexes of every heading section that is a descendant
 * of `sections[ancestorIndex]` — i.e. subsequent sections whose
 * level is strictly deeper, walking forward until the next section
 * with level <= ancestor. Falls back to an empty set for level-0
 * (preamble / blank-line fallback) sections, which have no
 * descendants.
 *
 * Used by the section picker's "tick a parent → cascade to
 * children" behaviour. Toggling a parent heading adds (or removes)
 * its descendants in lock-step; toggling a child heading never
 * affects the parent.
 */
export function descendantSectionIndexes(
  sections: HeadingSection[],
  ancestorIndex: number
): number[] {
  const target = sections[ancestorIndex];
  if (!target || target.level === 0) return [];
  const out: number[] = [];
  for (let i = ancestorIndex + 1; i < sections.length; i++) {
    if (sections[i].level <= target.level) break;
    out.push(sections[i].index);
  }
  return out;
}

export function useDocumentMentions() {
  const documents = useStore((s) => s.documents);
  const currentDocumentId = useStore((s) => s.currentDocumentId);

  // Memoized paragraph + section lists per document id. Recomputed
  // when the document content changes.
  const { paragraphsByDoc, sectionsByDoc } = useMemo(() => {
    const paragraphsMap: Record<string, ParagraphInfo[]> = {};
    const sectionsMap: Record<string, HeadingSection[]> = {};
    for (const d of documents) {
      const paras = buildParagraphs(d);
      paragraphsMap[d.id] = paras;
      sectionsMap[d.id] = buildHeadingSections(d, paras);
    }
    return { paragraphsByDoc: paragraphsMap, sectionsByDoc: sectionsMap };
  }, [documents]);

  const getDocById = (id: string): DocumentRecord | null =>
    documents.find((d) => d.id === id) ?? null;

  const getParagraphs = (docId: string): ParagraphInfo[] =>
    paragraphsByDoc[docId] ?? [];

  const getSections = (docId: string): HeadingSection[] =>
    sectionsByDoc[docId] ?? [];

  const getParagraphPreview = (
    docId: string,
    paragraphIndex: number
  ): string | null => {
    const list = paragraphsByDoc[docId];
    if (!list) return null;
    const p = list[paragraphIndex];
    return p?.preview ?? null;
  };

  /** Pick the full text of a single paragraph by docId + index. */
  const getParagraphText = (
    docId: string,
    paragraphIndex: number
  ): string | null => {
    const doc = getDocById(docId);
    if (!doc) return null;
    const list = paragraphsByDoc[docId] ?? [];
    const p = list[paragraphIndex];
    if (!p) return null;
    return doc.content.slice(p.start, p.end);
  };

  return {
    documents,
    currentDocumentId,
    getDocById,
    getParagraphs,
    getSections,
    getParagraphPreview,
    getParagraphText,
  };
}
