// Thin wrapper around pdfjs-dist for the two paths the OCR pipeline
// needs: (1) extracting selectable text from a text-native PDF page and
// (2) rasterizing a page to an off-screen canvas for OCR. All resources
// are released in finally blocks so no PDF bytes survive past the call.
//
// The pdf.js worker is served as a same-origin script from /pdfjs/ —
// see vite.config.ts (COOP/COEP) and public/pdfjs/ for the static asset.

import * as pdfjsLib from 'pdfjs-dist';

// pdf.js worker is served as a same-origin static asset from
// public/pdfjs/pdf.worker.min.mjs. Vite's `new URL(..., import.meta.url)`
// pattern resolves to the served URL at build time (in production) or
// at request time (in dev). Same-origin is required for cross-origin
// isolation under our COOP/COEP headers.
const pdfWorkerUrl = new URL(
  '/pdfjs/pdf.worker.min.mjs',
  typeof window !== 'undefined' ? window.location.origin : 'http://localhost'
).href;

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

export type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';

/**
 * Load a PDF from an in-memory byte buffer. The returned document must
 * be destroyed by calling `pdf.destroy()` when no longer needed.
 */
export async function loadPdfFromBytes(
  bytes: ArrayBuffer
): Promise<pdfjsLib.PDFDocumentProxy> {
  // `disableAutoFetch: true` keeps us from pulling in remote resources
  // (fonts, images, etc.) — we only want what's already in the buffer.
  // `disableStream: true` matches that intent: we don't open a fetch
  // stream against the network for any missing references.
  const loadingTask = pdfjsLib.getDocument({
    data: bytes,
    disableAutoFetch: true,
    disableStream: true,
    isEvalSupported: false,
  });
  return loadingTask.promise;
}

/**
 * Heuristic: does this page have real selectable text, or is it image-
 * only (scanned)? We check both that the items array is non-empty AND
 * that the joined string is non-trivial (not just header/footer
 * artifacts). Pages with very few items are treated as image-only.
 */
export async function pageHasNativeText(
  page: pdfjsLib.PDFPageProxy
): Promise<boolean> {
  const tc = await page.getTextContent();
  const joined = tc.items
    .map((it) => ('str' in it ? it.str : ''))
    .join(' ')
    .trim();
  return joined.length >= 2;
}

/**
 * Concatenate the selectable text items on a page in reading order with
 * single spaces. This is what text-native PDFs give us for free.
 */
export async function pageNativeText(
  page: pdfjsLib.PDFPageProxy
): Promise<string> {
  const tc = await page.getTextContent();
  return tc.items
    .map((it) => ('str' in it ? it.str : ''))
    .filter((s) => s.length > 0)
    .join(' ')
    .trim();
}

/**
 * Render a page onto an existing canvas at the given viewport scale.
 * The canvas is mutated in-place (its width/height are reset to match
 * the viewport). Callers should release the canvas after by setting
  `canvas.width = 0; canvas.height = 0;`.
 */
export async function renderPageToCanvas(
  page: pdfjsLib.PDFPageProxy,
  scale: number,
  canvas: HTMLCanvasElement
): Promise<void> {
  const viewport = page.getViewport({ scale });
  canvas.width = Math.max(1, Math.floor(viewport.width));
  canvas.height = Math.max(1, Math.floor(viewport.height));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context unavailable.');
  await page.render({ canvasContext: ctx, viewport }).promise;
}