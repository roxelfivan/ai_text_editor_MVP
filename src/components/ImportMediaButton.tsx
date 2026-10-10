import { useEffect, useRef, useState } from 'react';
import { useStore } from '@/store/useStore';
import {
  extractTextFromFiles,
  type OcrLang,
  type OcrProgress,
} from '@/utils/ocr';
import { formatOcrAsMarkdown } from '@/utils/ocrMarkdown';

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
 * Import button + language picker for photos and PDFs. Click the button
 * to open a small popover with three language checkboxes (English,
 * Simplified Chinese, Traditional Chinese). At least one must stay
 * checked. The "Choose Import File(s)" button inside the popover opens
 * a multi-file picker; selected files are run through
 * `extractTextFromFiles`. On success the extracted text is sent to the
 * configured chat model and rewritten as reader-friendly Markdown, then
 * dispatched as a `mvp:insert-text` window event for the Editor. Raw
 * OCR is never pasted.
 *
 * Cleanup: after every batch the file input is reset to '' so the same
 * files can be re-picked without a refresh. The OCR util itself handles
 * revoking ObjectURLs, releasing canvases, and terminating the worker.
 */
export function ImportMediaButton({ disabled = false }: ImportMediaButtonProps) {
  const api = useStore((s) => s.api);
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
        '[data-import-media-toggle]'
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
    <div className="relative inline-block">
      <button
        type="button"
        data-import-media-toggle
        aria-label="Import text from photos or PDFs"
        className="btn-icon-square disabled:opacity-50"
        onClick={() => setOpen((v) => !v)}
        disabled={disabled || busy}
        title={
          busy
            ? 'Reading file…'
            : 'Import text from photos or PDFs (OCR, then Markdown via your model)'
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
          // Download-into-tray icon: arrow down into a tray.
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
            <path d="M8 2 L8 10" />
            <path d="M4.5 6.5 L8 10 L11.5 6.5" />
            <path d="M3 13 L13 13" />
          </svg>
        )}
      </button>
      {open && !busy && (
        <div
          ref={popoverRef}
          className="absolute right-0 top-full mt-1 z-30 w-72 bg-paper-panel dark:bg-ape-panel border border-paper-hairline dark:border-cyber-border rounded shadow-ape-paper-lift dark:shadow-lg p-3 text-xs space-y-2"
        >
          <div className="font-semibold text-sm text-cyber-clay dark:text-cyber-cyan uppercase tracking-wide">
            OCR languages
          </div>
          <p className="text-paper-inkSoft dark:text-cyber-muted leading-snug">
            Pick one or more images or PDF files. Recognition stays in
            the browser. After a successful import the extracted text
            is sent to your configured model and rewritten as readable
            Markdown before it is inserted.
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
          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              type="button"
              className="btn-cyan-sm"
              onClick={() => setOpen(false)}
            >
              Close
            </button>
            <button
              type="button"
              className="btn-fire-sm"
              onClick={onPickClick}
            >
              Choose Import File(s)
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
        <div className="absolute right-0 top-full mt-1 z-30 w-72 bg-paper-panel dark:bg-ape-panel border border-cyber-clay/40 dark:border-cyber-cyan/60 rounded shadow-ape-paper-lift dark:shadow-lg px-3 py-2 text-xs">
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
        <div className="absolute right-0 top-full mt-1 z-30 w-72 bg-paper-panel dark:bg-ape-panel border border-cyber-danger/40 dark:border-cyber-danger/60 rounded shadow-ape-paper-lift dark:shadow-lg px-3 py-2 text-xs text-cyber-danger">
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