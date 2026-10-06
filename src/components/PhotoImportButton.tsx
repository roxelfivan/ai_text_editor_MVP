import { useEffect, useRef, useState } from 'react';
import {
  extractTextFromImages,
  type OcrLang,
  type OcrProgress,
} from '@/utils/ocr';

type Lang = OcrLang;

const LANG_OPTIONS: { code: Lang; label: string }[] = [
  { code: 'eng', label: 'English' },
  { code: 'chi_sim', label: 'Simplified Chinese' },
  { code: 'chi_tra', label: 'Traditional Chinese' },
];

interface PhotoImportButtonProps {
  /** Disabled when no document is open. */
  disabled?: boolean;
}

/**
 * Photo import button + language picker. Click the button to open a small
 * popover with three language checkboxes (English, Simplified Chinese,
 * Traditional Chinese). At least one must stay checked. The
 * "Choose photos" button inside the popover opens a multi-file picker;
 * selected files are run through `extractTextFromImages` and the
 * concatenated text is dispatched as a `mvp:insert-text` window event
 * for the Editor to consume.
 *
 * Cleanup: after every batch the file input is reset to '' so the same
 * files can be re-picked without a refresh. The OCR util itself handles
 * revoking ObjectURLs, releasing canvases, and terminating the worker.
 */
export function PhotoImportButton({ disabled = false }: PhotoImportButtonProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [langs, setLangs] = useState<Set<Lang>>(() => new Set(['eng']));
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<OcrProgress | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Close the popover on outside click.
  useEffect(() => {
    if (!open) return;
    const onDocPointer = (e: PointerEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      if (popoverRef.current?.contains(target)) return;
      // Also ignore clicks on the toggle button itself (which controls `open`).
      const btn = (e.target as HTMLElement | null)?.closest(
        '[data-photo-import-toggle]'
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

  const onFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    if (langs.size === 0) {
      setError('Select at least one language.');
      // Clear the input so the same files can be re-picked.
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
      const results = await extractTextFromImages(
        fileArray,
        langArray,
        (p) => setProgress(p)
      );
      // Drop empty results so we don't insert stray blank lines.
      const blocks = results
        .map((r) => r.trim())
        .filter((r) => r.length > 0);
      if (blocks.length > 0) {
        const payload = blocks.join('\n\n');
        window.dispatchEvent(
          new CustomEvent('mvp:insert-text', { detail: { text: payload } })
        );
      }
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
    <div className="relative inline-block">
      <button
        type="button"
        data-photo-import-toggle
        className="text-xs px-2 py-1 rounded border border-gray-300 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-50"
        onClick={() => setOpen((v) => !v)}
        disabled={disabled || busy}
        title="Import text from photos (in-browser OCR)"
      >
        {busy ? 'Reading…' : 'Import photos / PDFs'}
      </button>
      {open && !busy && (
        <div
          ref={popoverRef}
          className="absolute right-0 top-full mt-1 z-30 w-72 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded shadow-lg p-3 text-xs space-y-2"
        >
          <div className="font-semibold text-sm">OCR languages</div>
          <p className="text-gray-500 dark:text-gray-400 leading-snug">
            Pick one or more images or PDF files. PDFs with selectable
            text are read directly (no OCR); scanned PDFs and photos are
            recognized entirely in the browser — nothing is uploaded.
          </p>
          <div className="space-y-1">
            {LANG_OPTIONS.map((opt) => {
              const checked = langs.has(opt.code);
              const lastOne = checked && langs.size === 1;
              return (
                <label
                  key={opt.code}
                  className="flex items-center gap-2 cursor-pointer select-none"
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleLang(opt.code)}
                    disabled={lastOne}
                  />
                  <span>{opt.label}</span>
                </label>
              );
            })}
          </div>
          <div className="text-[11px] text-gray-500 dark:text-gray-400">
            Strategy: {strategyLabel}.
          </div>
          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              type="button"
              className="text-xs px-2 py-1 rounded border border-gray-300 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800"
              onClick={() => setOpen(false)}
            >
              Close
            </button>
            <button
              type="button"
              className="text-xs px-2 py-1 rounded bg-blue-600 text-white hover:bg-blue-700"
              onClick={onPickClick}
            >
              Choose photos…
            </button>
          </div>
          {error && (
            <div className="text-[11px] text-red-600 dark:text-red-400">
              {error}
            </div>
          )}
        </div>
      )}
      {busy && progress && (
        <div className="absolute right-0 top-full mt-1 z-30 w-72 bg-white dark:bg-gray-900 border border-blue-300 dark:border-blue-700 rounded shadow-lg px-3 py-2 text-xs">
          <div className="flex items-center gap-2">
            <span className="inline-block w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
            <span className="flex-1 truncate">{statusLabel}</span>
            <span className="text-gray-500">
              {progress.done}/{progress.total}
            </span>
          </div>
        </div>
      )}
      {error && !open && !busy && (
        <div className="absolute right-0 top-full mt-1 z-30 w-72 bg-white dark:bg-gray-900 border border-red-300 dark:border-red-700 rounded shadow-lg px-3 py-2 text-xs text-red-600 dark:text-red-400">
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
