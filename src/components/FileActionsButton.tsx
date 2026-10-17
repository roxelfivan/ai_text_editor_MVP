import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useStore, useCurrentDocument } from '@/store/useStore';
// Type-only: keep pdfjs / PaddleOCR / OpenCV out of the initial app chunk.
// The OCR module is loaded via dynamic import() when the user picks files.
import type { OcrLang, OcrProgress } from '@/utils/ocr';
import { formatOcrAsMarkdown } from '@/utils/ocrMarkdown';
import { downloadTextFile, sanitizeFilename } from '@/utils/storage';

const VIEWPORT_PAD = 8;
const POPOVER_WIDTH = 288; // Tailwind w-72

/**
 * Pin a popover to the viewport so a left-side (or wrapped) Import
 * button cannot shove it off-screen on a narrow/vertical layout.
 * Uses `fixed` coordinates measured from the toggle button.
 */
function clampPopoverToViewport(panel: HTMLElement, anchor: HTMLElement) {
  const pad = VIEWPORT_PAD;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const maxW = Math.min(POPOVER_WIDTH, Math.max(0, vw - pad * 2));
  panel.style.width = `${maxW}px`;
  panel.style.maxWidth = `${Math.max(0, vw - pad * 2)}px`;
  panel.style.maxHeight = `${Math.max(0, vh - pad * 2)}px`;
  panel.style.overflowY = 'auto';

  const ar = anchor.getBoundingClientRect();
  // Prefer right-aligning to the button (desktop toolbar), then clamp
  // so both edges stay on screen.
  let left = ar.right - maxW;
  if (left < pad) left = pad;
  if (left + maxW > vw - pad) left = Math.max(pad, vw - pad - maxW);

  let top = ar.bottom + 4;
  const h = panel.offsetHeight;
  if (top + h > vh - pad) {
    const above = ar.top - 4 - h;
    top = above >= pad ? above : Math.max(pad, vh - pad - h);
  }

  panel.style.position = 'fixed';
  panel.style.left = `${left}px`;
  panel.style.top = `${top}px`;
  panel.style.right = 'auto';
  panel.style.marginTop = '0';
}

type Lang = OcrLang;

const LANG_OPTIONS: { code: Lang; label: string }[] = [
  { code: 'eng', label: 'English' },
  { code: 'chi_sim', label: 'Simplified Chinese' },
  { code: 'chi_tra', label: 'Traditional Chinese' },
];

interface ImportMediaButtonProps {
  /** Disabled when no document is open. */
  disabled?: boolean;
}

/**
 * Toolbar button that opens a popover with two file actions for the
 * current document:
 *   1. **Import** photos or PDFs — pick one or more files, the OCR
 *      pipeline runs locally, the extracted text is rewritten as
 *      reader-friendly Markdown by your configured chat model, then
 *      inserted into the editor via a `mvp:insert-text` event. The
 *      language picker is the three checkboxes (English, Simplified
 *      Chinese, Traditional Chinese); at least one must stay checked.
 *   2. **Export** the current document as Markdown — the only durable
 *      off-tab backup of your writing today. Filename is the document
 *      title, sanitised; defaults to `untitled.md`.
 *
 * The toolbar icon (a page with up + down arrows) intentionally reads
 * as both directions rather than picking one; the toggle's
 * `aria-label` and `title` mention Import first because that's the
 * primary identity of the button, but Export is always visible inside
 * the popover too.
 *
 * Cleanup: after every OCR batch the file input is reset to '' so the
 * same files can be re-picked without a refresh. The OCR util itself
 * handles revoking ObjectURLs, releasing canvases, and terminating the
 * worker.
 */
export function FileActionsButton({ disabled = false }: ImportMediaButtonProps) {
  const api = useStore((s) => s.api);
  const currentDoc = useCurrentDocument();
  const inputRef = useRef<HTMLInputElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const anchorRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [langs, setLangs] = useState<Set<Lang>>(() => new Set(['eng']));
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<OcrProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const panelVisible = open || busy || Boolean(error);

  // Close the popover on outside click.
  useEffect(() => {
    if (!open) return;
    const onDocPointer = (e: PointerEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      if (popoverRef.current?.contains(target)) return;
      // Also ignore clicks on the toggle button itself (which controls `open`).
      const btn = (e.target as HTMLElement | null)?.closest(
        '[data-file-actions-toggle]'
      );
      if (btn) return;
      setOpen(false);
    };
    document.addEventListener('pointerdown', onDocPointer);
    return () => document.removeEventListener('pointerdown', onDocPointer);
  }, [open]);

  // Reset error when popover opens.
  useEffect(() => {
    if (open) setError(null);
  }, [open]);

  // Keep the language / progress / error panels inside the viewport
  // after wrap (mobile) or when the window is resized / scrolled.
  useLayoutEffect(() => {
    if (!panelVisible) return;
    const panel = popoverRef.current;
    const anchor = anchorRef.current;
    if (!panel || !anchor) return;
    const apply = () => clampPopoverToViewport(panel, anchor);
    apply();
    window.addEventListener('resize', apply);
    window.addEventListener('orientationchange', apply);
    window.addEventListener('scroll', apply, true);
    return () => {
      window.removeEventListener('resize', apply);
      window.removeEventListener('orientationchange', apply);
      window.removeEventListener('scroll', apply, true);
    };
  }, [panelVisible, open, busy, error]);

  const toggleLang = (code: Lang) => {
    setLangs((prev) => {
      const next = new Set(prev);
      if (next.has(code)) {
        // Disallow clearing the last remaining language.
        if (next.size === 1) return prev;
        next.delete(code);
      } else {
        next.add(code);
      }
      return next;
    });
  };

  const onPickClick = () => {
    if (busy) return;
    if (langs.size === 0) {
      setError('Select at least one language.');
      return;
    }
    inputRef.current?.click();
  };

  /**
   * Export the current document as Markdown. Surfaces a friendly error
   * if no document is open (e.g. user reached the popover while the
   * sidebar selection was empty) — we deliberately do NOT close the
   * popover on click so the error stays visible.
   *
   * Filename is the document title, sanitised. Content is the live
   * document text — revisions / comments are intentionally out of
   * scope for this slice (see docs/UX_SLICE_1.md Item 2).
   */
  const onExportClick = () => {
    if (!currentDoc) {
      setError('Open a document first, then export.');
      return;
    }
    const base = sanitizeFilename(currentDoc.title, 'untitled');
    downloadTextFile(`${base}.md`, currentDoc.content, 'text/markdown;charset=utf-8');
  };

  const onFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    if (langs.size === 0) {
      setError('Select at least one language.');
      // Clear the input so the same files can be re-picked.
      e.target.value = '';
      return;
    }
    if (!api.apiKey || !api.apiEndpoint) {
      setError('Open Settings and add an API key so imported text can be formatted as Markdown.');
      e.target.value = '';
      return;
    }
    const langArray = Array.from(langs) as Lang[];
    const fileArray = Array.from(files);
    setBusy(true);
    setError(null);
    setProgress({ done: 0, total: fileArray.length, label: 'starting…' });
    setOpen(false);
    try {
      // Lazy-load OCR (+ pdfjs, PaddleOCR, OpenCV) only when importing.
      const { extractTextFromFiles } = await import('@/utils/ocr');
      const results = await extractTextFromFiles(
        fileArray,
        langArray,
        (p) => setProgress(p)
      );
      // Drop empty results so we don't send stray blank files to the model.
      const blocks = results
        .map((r) => r.trim())
        .filter((r) => r.length > 0);
      if (blocks.length === 0) {
        setError('No text was recognized in the selected file(s).');
        return;
      }
      setProgress({
        done: fileArray.length,
        total: fileArray.length,
        label: 'formatting as Markdown…',
      });
      const markdown = await formatOcrAsMarkdown(blocks.join('\n\n'), api);
      window.dispatchEvent(
        new CustomEvent('mvp:insert-text', { detail: { text: markdown } })
      );
    } catch (err) {
      setError((err as Error).message || 'OCR failed.');
    } finally {
      setBusy(false);
      setProgress(null);
      // CRITICAL: clear the file input so the browser releases its hold
      // on the picked File objects, and so the user can pick the same
      // files again without a refresh.
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const statusLabel = busy && progress ? progress.label : '';
  // PP-OCRv6_tiny is a unified multilingual model — it handles English
  // + Simplified Chinese + Traditional Chinese in one pass, so the
  // checkbox state is informational only (no model swap).
  const strategyLabel = `${langs.size} language${langs.size === 1 ? '' : 's'} checked (single pass; multilingual model)`;

  return (
    <div ref={anchorRef} className="relative inline-flex items-center">
      <button
        type="button"
        data-file-actions-toggle
        aria-label="Document file actions — Import photos / PDFs or Export this document as Markdown"
        className="btn-icon-square disabled:opacity-50"
        onClick={() => setOpen((v) => !v)}
        disabled={disabled || busy}
        title={
          busy
            ? 'Reading file…'
            : 'Document file actions: Import photos / PDFs (OCR) or Export this document as Markdown'
        }
      >
        {busy ? (
          // Spinner — three small dots that pulse in sequence. Pure CSS,
          // mirrors the one used in the editor's streaming indicator.
          <span className="inline-flex gap-0.5">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-current opacity-50 animate-pulse" style={{ animationDelay: '0ms' }} />
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-current opacity-50 animate-pulse" style={{ animationDelay: '150ms' }} />
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-current opacity-50 animate-pulse" style={{ animationDelay: '300ms' }} />
          </span>
        ) : (
          // Document-with-arrows icon: a page (rectangle with a folded
          // corner) flanked by an upward arrow (Export out) and a
          // downward arrow (Import in). Reads as "this button handles
          // both directions for a document" without picking one, so
          // neither label is misleading. Stroke geometry matches the
          // rest of the editor toolbar (16×16 viewBox, 1.5 stroke).
          <svg
            aria-hidden="true"
            viewBox="0 0 16 16"
            className="h-4 w-4"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            {/* Up arrow (Export) — sits left of the page. */}
            <path d="M2.5 7 L2.5 2.5" />
            <path d="M1 4 L2.5 2.5 L4 4" />
            {/* Page outline with a folded top-right corner. */}
            <path d="M6 2 L11 2 L13.5 4.5 L13.5 14 L6 14 Z" />
            <path d="M11 2 L11 4.5 L13.5 4.5" />
            {/* Down arrow (Import) — sits right of the page. */}
            <path d="M13.5 9 L13.5 13.5" />
            <path d="M12 12 L13.5 13.5 L15 12" />
          </svg>
        )}
      </button>
      {open && !busy && (
        <div
          ref={popoverRef}
          className="fixed z-40 w-72 max-w-[calc(100vw-1rem)] bg-paper-panel dark:bg-ape-panel border border-paper-hairline dark:border-cyber-border rounded shadow-ape-paper-lift dark:shadow-lg p-3 text-xs space-y-2 box-border"
        >
          {/* Section 1: Import (primary identity of the toolbar button). */}
          <div className="font-semibold text-sm text-cyber-clay dark:text-cyber-cyan uppercase tracking-wide">
            Import photos / PDFs
          </div>
          <p className="text-paper-inkSoft dark:text-cyber-muted leading-snug">
            Pick one or more images or PDF files; recognition runs in
            the browser, then the extracted text is rewritten as
            readable Markdown via your configured model and inserted
            into the editor.
          </p>
          <div className="space-y-1">
            {LANG_OPTIONS.map((opt) => {
              const checked = langs.has(opt.code);
              const lastOne = checked && langs.size === 1;
              return (
                <label
                  key={opt.code}
                  className="flex items-center gap-2 cursor-pointer select-none text-paper-ink dark:text-cyber-primary"
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleLang(opt.code)}
                    disabled={lastOne}
                    className="accent-cyber-clay dark:accent-cyber-cyan"
                  />
                  <span>{opt.label}</span>
                </label>
              );
            })}
          </div>
          <div className="text-[11px] text-paper-inkSoft dark:text-cyber-muted font-mono">
            Strategy: {strategyLabel}.
          </div>
          <div className="flex items-center justify-end pt-1">
            <button
              type="button"
              className="btn-fire-sm disabled:opacity-50 disabled:cursor-not-allowed"
              onClick={onPickClick}
              disabled={busy}
              title="Open the file picker — selected files are OCR'd, rewritten as Markdown, and inserted"
            >
              Choose Import File(s)
            </button>
          </div>
          <div className="border-t border-paper-hairline dark:border-cyber-border" />
          {/* Section 2: Export (the second action exposed by the same
              toolbar button). Same primary CTA style as the Import
              button above so the two sections feel symmetric. */}
          <div className="font-semibold text-sm text-cyber-clay dark:text-cyber-cyan uppercase tracking-wide">
            Export this document
          </div>
          <p className="text-paper-inkSoft dark:text-cyber-muted leading-snug">
            Download the current document as Markdown so you have a
            copy outside the browser; local storage can be cleared
            without warning.
          </p>
          <div className="flex items-center justify-end pt-1">
            <button
              type="button"
              className="btn-fire-sm disabled:opacity-50 disabled:cursor-not-allowed"
              onClick={onExportClick}
              disabled={!currentDoc}
              title={
                currentDoc
                  ? 'Download this document as Markdown'
                  : 'Open a document first to export it'
              }
            >
              Export .md
            </button>
          </div>
          <div className="flex items-center justify-end pt-2">
            <button
              type="button"
              className="btn-cyan-sm"
              onClick={() => setOpen(false)}
            >
              Close
            </button>
          </div>
          {error && (
            <div className="text-[11px] text-cyber-danger">
              {error}
            </div>
          )}
        </div>
      )}
      {busy && progress && (
        <div
          ref={popoverRef}
          className="fixed z-40 w-72 max-w-[calc(100vw-1rem)] bg-paper-panel dark:bg-ape-panel border border-cyber-clay/40 dark:border-cyber-cyan/60 rounded shadow-ape-paper-lift dark:shadow-lg px-3 py-2 text-xs box-border"
        >
          <div className="flex items-center gap-2">
            <span className="inline-block w-2 h-2 rounded-full bg-cyber-clay dark:bg-cyber-cyan animate-pulse" />
            <span className="flex-1 truncate text-paper-ink dark:text-cyber-primary">{statusLabel}</span>
            <span className="text-paper-inkSoft dark:text-cyber-muted font-mono">
              {progress.done}/{progress.total}
            </span>
          </div>
        </div>
      )}
      {error && !open && !busy && (
        <div
          ref={popoverRef}
          className="fixed z-40 w-72 max-w-[calc(100vw-1rem)] bg-paper-panel dark:bg-ape-panel border border-cyber-danger/40 dark:border-cyber-danger/60 rounded shadow-ape-paper-lift dark:shadow-lg px-3 py-2 text-xs text-cyber-danger box-border"
        >
          {error}
        </div>
      )}
      <input
        ref={inputRef}
        type="file"
        accept="image/*,application/pdf"
        multiple
        className="hidden"
        onChange={onFiles}
      />
    </div>
  );
}