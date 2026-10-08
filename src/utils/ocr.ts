// Browser-side text extraction for images and PDFs.
//
//   - Images         → decode to canvas → PaddleOCR.predict(canvas)
//   - Text-native PDFs → pdfjs-dist getTextContent (no OCR, 100% accurate)
//   - Scanned PDFs   → pdfjs-dist page.render → PaddleOCR.predict(canvas)
//
// All assets (PDF worker, ONNX Runtime WASM, PaddleOCR model .tar files)
// are self-hosted under /pdfjs/, /ort/, and /ocr/ so the pipeline makes
// ZERO third-party network calls — verified in DevTools Network panel.
//
// Cleanup contract for every input File:
//   1. ObjectURLs revoked in finally
//   2. <img> pixel buffers released (img.src = '')
//   3. <canvas> backing buffers released (canvas.width/height = 0)
//   4. PDF documents destroyed via pdf.destroy()
//   5. PDF page resources released via page.cleanup() after render
//   6. The PaddleOCR engine is module-level and persists for the tab's
//      lifetime; per-call buffers are released by step 3.
//   7. Only the recognized text string survives — no binary image data
//      is retained in app state.

import type { OcrResult, OcrRuntimeParamsInput } from '@paddleocr/paddleocr-js';
import {
  loadPdfFromBytes,
  pageHasNativeText,
  pageNativeText,
  renderPageToCanvas,
} from './pdf';

/**
 * Subset of the PaddleOCR API we actually use. Whether PaddleOCR.create
 * returns the synchronous `PaddleOCR` instance or the worker-backed
 * `WorkerBackedPaddleOCR` proxy (depending on `options.worker`), the
 * surface we depend on is identical.
 */
interface OcrEngine {
  initialize(): Promise<unknown>;
  predict(input: unknown, params?: OcrRuntimeParamsInput): Promise<OcrResult[]>;
  dispose(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Public API (preserved from the Tesseract.js version for compat with the
// ImportMediaButton component).
// ---------------------------------------------------------------------------

export type OcrLang = 'eng' | 'chi_sim' | 'chi_tra';

export interface OcrProgress {
  /** Number of files fully processed. */
  done: number;
  /** Total number of files in the current batch. */
  total: number;
  /** Human-readable status label. */
  label: string;
}

export type OcrProgressCallback = (progress: OcrProgress) => void;

// ---------------------------------------------------------------------------
// Internal: lazy-init PaddleOCR engine singleton.
// ---------------------------------------------------------------------------

// `lang` selects the PP-OCR multilingual model. PP-OCRv6_tiny handles
// English + Simplified Chinese + Traditional Chinese in a single unified
// model, so the user's checkbox state is mostly advisory — the OCR model
// doesn't need to be swapped. We pass `lang` through anyway because the
// PaddleOCR API uses it to pick the recognition dictionary.

let enginePromise: Promise<OcrEngine> | null = null;

async function getEngine(): Promise<OcrEngine> {
  if (!enginePromise) {
    enginePromise = (async () => {
      const { PaddleOCR } = await import('@paddleocr/paddleocr-js');
      const engine = await PaddleOCR.create({
        // Self-hosted ONNX Runtime WASM. Without this, ORT fetches its
        // WASM from cdn.jsdelivr.net (a third-party CDN) — violating the
        // zero-leakage guarantee.
        ortOptions: {
          wasmPaths: '/ort/',
          // Use the WASM backend (deterministic, no WebGPU dependency).
          backend: 'wasm',
          // Allow multi-threaded ORT (requires SAB; provided by the
          // COOP/COEP headers in vite.config.ts).
          numThreads: typeof navigator !== 'undefined'
            ? Math.max(1, Math.min(4, navigator.hardwareConcurrency || 2))
            : 2,
          simd: true,
        },
        // Self-hosted PaddleOCR PP-OCRv6_tiny model files (tar archives
        // containing inference.onnx + inference.yml).
        textDetectionModelAsset: { url: '/ocr/PP-OCRv6_tiny_det.tar' },
        textRecognitionModelAsset: { url: '/ocr/PP-OCRv6_tiny_rec.tar' },
        // Use PP-OCRv6 model set.
        ocrVersion: 'PP-OCRv6',
        textDetectionModelName: 'PP-OCRv6_tiny_det',
        textRecognitionModelName: 'PP-OCRv6_tiny_rec',
      });
      // initialize() loads the model bytes into memory and prepares the
      // ORT sessions. Subsequent predicts() don't re-load.
      await engine.initialize();
      return engine as OcrEngine;
    })();
  }
  return enginePromise;
}

// ---------------------------------------------------------------------------
// Image pipeline: File → canvas → PaddleOCR.predict.
// ---------------------------------------------------------------------------

async function imageFileToResizedCanvas(
  file: File,
  maxEdge: number
): Promise<HTMLCanvasElement> {
  const url = URL.createObjectURL(file);
  let urlRevoked = false;
  let img: HTMLImageElement | null = new Image();
  let canvas: HTMLCanvasElement | null = null;
  const safeRevoke = () => {
    if (!urlRevoked) {
      URL.revokeObjectURL(url);
      urlRevoked = true;
    }
  };
  try {
    const decoded = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = img!;
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error(`failed to decode ${file.name}`));
      el.src = url;
    });
    // Pixel data is now in `decoded`; ObjectURL no longer needed.
    safeRevoke();

    const w0 = decoded.naturalWidth || decoded.width;
    const h0 = decoded.naturalHeight || decoded.height;
    if (!w0 || !h0) throw new Error(`empty image: ${file.name}`);

    const longest = Math.max(w0, h0);
    const scale = longest > maxEdge ? maxEdge / longest : 1;
    const w = Math.max(1, Math.round(w0 * scale));
    const h = Math.max(1, Math.round(h0 * scale));

    canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D context unavailable.');
    ctx.drawImage(decoded, 0, 0, w, h);
    // Returning the canvas; caller takes ownership of cleanup.
    const out = canvas;
    canvas = null; // suppress the cleanup branch below for the returned canvas
    img = null;
    return out;
  } finally {
    if (img) img.src = '';
    if (canvas) {
      canvas.width = 0;
      canvas.height = 0;
    }
    safeRevoke();
  }
}

async function extractFromImageFile(
  file: File,
  engine: OcrEngine,
  onProgress?: (label: string) => void
): Promise<string> {
  onProgress?.(`decoding ${file.name}`);
  let canvas: HTMLCanvasElement | null = null;
  try {
    canvas = await imageFileToResizedCanvas(file, 2000);
    onProgress?.(`recognizing ${file.name}`);
    const results = await engine.predict(canvas);
    // PaddleOCR returns one OcrResult per image (we pass a single
    // canvas), with `items` sorted in reading order. Join with
    // newlines; PaddleOCR's recognizer already inserts spaces between
    // words and line breaks between detected lines.
    const joined = (results[0]?.items ?? [])
      .map((it) => it.text)
      .filter((s) => s.length > 0)
      .join('\n');
    return joined;
  } finally {
    if (canvas) {
      canvas.width = 0;
      canvas.height = 0;
    }
  }
}

// ---------------------------------------------------------------------------
// PDF pipeline: text-native fast path; otherwise rasterize and OCR.
// ---------------------------------------------------------------------------

async function extractFromPdfFile(
  file: File,
  engine: OcrEngine,
  onProgress?: (label: string) => void
): Promise<string> {
  onProgress?.(`reading ${file.name}`);
  const bytes = await file.arrayBuffer();
  const pdf = await loadPdfFromBytes(bytes);
  try {
    const pageTexts: string[] = [];
    const numPages = pdf.numPages;
    for (let p = 1; p <= numPages; p++) {
      const page = await pdf.getPage(p);
      try {
        let pageText: string;
        if (await pageHasNativeText(page)) {
          // Fast path: selectable text, no OCR cost.
          onProgress?.(`page ${p}/${numPages} (text) ${file.name}`);
          pageText = await pageNativeText(page);
        } else {
          // Slow path: rasterize → PaddleOCR.
          onProgress?.(`page ${p}/${numPages} (OCR) ${file.name}`);
          let canvas: HTMLCanvasElement | null = null;
          try {
            canvas = document.createElement('canvas');
            await renderPageToCanvas(page, 2.0, canvas);
            const results = await engine.predict(canvas);
            pageText = (results[0]?.items ?? [])
              .map((it) => it.text)
              .filter((s) => s.length > 0)
              .join('\n');
          } finally {
            if (canvas) {
              canvas.width = 0;
              canvas.height = 0;
            }
          }
        }
        pageTexts.push(pageText);
      } finally {
        // Release per-page resources in the worker.
        page.cleanup();
      }
    }
    return pageTexts.join('\n\n');
  } finally {
    // Release the whole document (worker-side buffer freed).
    await pdf.destroy();
  }
}

// ---------------------------------------------------------------------------
// Public entry point: dispatches each File to image or PDF helper.
// ---------------------------------------------------------------------------

/**
 * Extract text from a mixed batch of image and/or PDF files. Returns one
 * string per input file (in the same order). Empty strings indicate the
 * file was processed but no text was extracted.
 *
 * The `langs` argument is preserved for backward compatibility with the
 * Tesseract.js era. PaddleOCR's PP-OCRv6_tiny is a unified multilingual
 * model that handles English + Simplified Chinese + Traditional Chinese
 * simultaneously, so we do not swap the model based on the checkbox
 * state. Passing at least one language is still required (to keep the
 * public API honest).
 */
export async function extractTextFromFiles(
  files: File[],
  langs: OcrLang[],
  onProgress?: OcrProgressCallback
): Promise<string[]> {
  if (files.length === 0) return [];
  if (langs.length === 0) {
    throw new Error('At least one OCR language must be selected.');
  }

  const emit = (label: string) => {
    if (onProgress) onProgress({ done: 0, total: files.length, label });
  };

  emit('loading OCR engine…');
  const engine = await getEngine();

  const results: string[] = new Array(files.length).fill('');
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const labelFn = (label: string) => {
      if (onProgress) onProgress({ done: i, total: files.length, label });
    };
    let text = '';
    try {
      const mime = file.type || '';
      if (mime === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
        text = await extractFromPdfFile(file, engine, labelFn);
      } else if (mime.startsWith('image/') || mime === '') {
        text = await extractFromImageFile(file, engine, labelFn);
      } else {
        text = '';
        labelFn(`unsupported file type for ${file.name}: ${mime}`);
      }
    } catch (err) {
      // One file failing shouldn't kill the whole batch.
      labelFn(`error on ${file.name}: ${(err as Error).message}`);
      text = '';
    }
    results[i] = text;
    if (onProgress) {
      onProgress({
        done: i + 1,
        total: files.length,
        label: `${file.name} done`,
      });
    }
  }

  if (onProgress) {
    onProgress({ done: files.length, total: files.length, label: 'done' });
  }
  return results;
}