// Shared hook for the @-mention system. Exposes the documents list
// and per-document paragraph previews. Paragraph boundaries are kept
// in sync with `buildDocOutline` in `src/api/chat.ts` so the picker
// previews and the prompt outline describe the same shape of the
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

const OUTLINE_PREVIEW_CHARS = 60;

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

export function useDocumentMentions() {
  const documents = useStore((s) => s.documents);
  const currentDocumentId = useStore((s) => s.currentDocumentId);

  // Memoized paragraph list per document id. Recomputed when the
  // document content changes.
  const paragraphsByDoc = useMemo(() => {
    const map: Record<string, ParagraphInfo[]> = {};
    for (const d of documents) {
      map[d.id] = buildParagraphs(d);
    }
    return map;
  }, [documents]);

  const getDocById = (id: string): DocumentRecord | null =>
    documents.find((d) => d.id === id) ?? null;

  const getParagraphs = (docId: string): ParagraphInfo[] =>
    paragraphsByDoc[docId] ?? [];

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
    getParagraphPreview,
    getParagraphText,
  };
}
