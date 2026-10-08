import { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useStore, useCurrentDocument } from '@/store/useStore';
import { ImportMediaButton } from '@/components/ImportMediaButton';

/**
 * Editor: plain textarea (write) + react-markdown preview (preview),
 * with a split mode. Selection in the textarea is exposed via a global
 * window event so the ChatPanel can pick it up.
 */
export function Editor() {
  const doc = useCurrentDocument();
  const viewMode = useStore((s) => s.viewMode);
  const setViewMode = useStore((s) => s.setViewMode);
  const editorFontSize = useStore((s) => s.editorFontSize);
  const bumpEditorFontSize = useStore((s) => s.bumpEditorFontSize);
  const updateContent = useStore((s) => s.updateDocumentContent);
  const saveRevision = useStore((s) => s.saveRevision);
  const setEditorFocus = useStore((s) => s.setEditorFocus);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const [now, setNow] = useState<number>(() => Date.now());

  // Tick `now` once a minute so the relative "X mins ago" label stays
  // current without re-rendering the editor text.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  const savedLabel = (() => {
    if (!lastSavedAt) return '';
    const diffSec = Math.max(0, Math.floor((now - lastSavedAt) / 1000));
    if (diffSec < 5) return '· saved just now';
    if (diffSec < 60) return `· saved ${diffSec}s ago`;
    const mins = Math.floor(diffSec / 60);
    if (mins < 60) return `· saved ${mins} ${mins === 1 ? 'min' : 'mins'} ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `· saved ${hrs} ${hrs === 1 ? 'hr' : 'hrs'} ago`;
    const days = Math.floor(hrs / 24);
    return `· saved ${days} ${days === 1 ? 'day' : 'days'} ago`;
  })();

  // Debounced auto-save: a quick local save. Persistence is handled by zustand.
  useEffect(() => {
    if (!doc) return;
    const t = setTimeout(() => setLastSavedAt(Date.now()), 400);
    return () => clearTimeout(t);
  }, [doc?.content]);

  // Expose a "send selection to chat" helper via a custom event.
  useEffect(() => {
    const handler = () => {
      const ta = textareaRef.current;
      if (!ta) return;
      const start = ta.selectionStart;
      const end = ta.selectionEnd;
      const text = ta.value.slice(start, end);
      window.dispatchEvent(
        new CustomEvent('mvp:editor-selection', { detail: { text } })
      );
    };
    window.addEventListener('mvp:get-selection', handler);
    return () => window.removeEventListener('mvp:get-selection', handler);
  }, []);

  // Listen for OCR-insert events from the import media button. Inserts
  // the text at the current caret position if the textarea has been
  // interacted with; otherwise appends to the end of the document. The
  // caret is moved to the end of the inserted text so the user can keep
  // typing or run AI ops on the imported content.
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ text: string }>).detail;
      const text = detail?.text;
      if (typeof text !== 'string' || text.length === 0) return;
      if (!doc) return;
      const ta = textareaRef.current;
      const current = doc.content;
      let newValue: string;
      let caret: number;
      const start = ta?.selectionStart ?? -1;
      const end = ta?.selectionEnd ?? -1;
      if (start >= 0 && end >= 0) {
        // Splice at the current caret / selection. If the user has a
        // selection, replace it with the inserted text.
        newValue = current.slice(0, start) + text + current.slice(end);
        caret = start + text.length;
      } else {
        // No caret info — append to the end. If the doc doesn't end with
        // a newline, prepend one so the inserted text starts on a new
        // line.
        const sep = current.length > 0 && !current.endsWith('\n') ? '\n' : '';
        newValue = current + sep + text;
        caret = newValue.length;
      }
      updateContent(doc.id, newValue);
      // Restore the caret to the end of the inserted text on the next
      // tick so React has applied the new value to the textarea first.
      queueMicrotask(() => {
        const el = textareaRef.current;
        if (!el) return;
        el.focus();
        try {
          el.setSelectionRange(caret, caret);
        } catch {
          /* some browsers throw if the element is not visible */
        }
      });
    };
    window.addEventListener('mvp:insert-text', handler);
    return () => window.removeEventListener('mvp:insert-text', handler);
  }, [doc, updateContent]);

  // When the document changes (or the editor unmounts), report blur for
  // the previous doc so cards don't think Force-apply is still enabled
  // when the user has switched documents.
  useEffect(() => {
    const prevDocId = doc?.id;
    return () => {
      if (prevDocId) {
        setEditorFocus(prevDocId, {
          focused: false,
          selectionStart: -1,
          selectionEnd: -1,
        });
      }
    };
  }, [doc?.id, setEditorFocus]);

  // Push focus + caret state to the store whenever the textarea fires
  // any of the relevant DOM events. Cards subscribe to `editorFocus` and
  // re-render with the latest values.
  const reportCaret = (focused: boolean) => {
    if (!doc) return;
    const ta = textareaRef.current;
    if (!ta) {
      setEditorFocus(doc.id, {
        focused,
        selectionStart: -1,
        selectionEnd: -1,
      });
      return;
    }
    const start = ta.selectionStart ?? -1;
    const end = ta.selectionEnd ?? -1;
    setEditorFocus(doc.id, {
      focused,
      selectionStart: start,
      selectionEnd: end,
    });
  };

  if (!doc) {
    return (
      <div className="flex-1 flex items-center justify-center bg-paper-base dark:bg-ape-base">
        <div className="text-center">
          <p className="text-paper-inkSoft dark:text-cyber-muted text-sm">No document selected.</p>
          <button
            className="btn-fire mt-3"
            onClick={() => useStore.getState().createDocument()}
          >
            Create one
          </button>
        </div>
      </div>
    );
  }

  const showWrite = viewMode === 'write' || viewMode === 'split';
  const showPreview = viewMode === 'preview' || viewMode === 'split';

  return (
    <div className="flex-1 flex flex-col min-w-0 bg-paper-base dark:bg-ape-base">
      <div className="flex items-center gap-2 px-4 py-2 border-b border-paper-hairline dark:border-cyber-border bg-paper-base dark:bg-ape-base text-[15px] leading-none">
        <div className="relative inline-block">
          <select
            value={viewMode}
            onChange={(e) => setViewMode(e.target.value as 'write' | 'preview' | 'split')}
            aria-label="Editor view mode"
            className="appearance-none cursor-pointer pl-2 pr-6 h-7 text-[15px] leading-none rounded border border-paper-hairline dark:border-cyber-border bg-paper-surface dark:bg-ape-panel text-paper-ink dark:text-cyber-primary hover:border-cyber-clay dark:hover:border-cyber-cyan focus:outline-none focus:border-cyber-clay dark:focus:border-cyber-cyan transition-colors"
          >
            <option value="write">Write</option>
            <option value="preview">Preview</option>
            <option value="split">Split</option>
          </select>
          <svg
            aria-hidden="true"
            className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 h-2.5 w-2.5 text-paper-inkSoft dark:text-cyber-muted"
            viewBox="0 0 10 10"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M2 4 L5 7 L8 4" />
          </svg>
        </div>
        <div
          className="inline-flex rounded border border-paper-hairline dark:border-cyber-border overflow-hidden text-[15px] leading-none"
          role="group"
          aria-label="Editor font size"
        >
          <button
            type="button"
            className="w-7 h-7 flex items-center justify-center text-paper-inkSoft dark:text-cyber-muted hover:bg-paper-elevated dark:hover:bg-ape-elevated hover:text-cyber-clay dark:hover:text-cyber-cyan transition-colors disabled:opacity-50 disabled:cursor-not-allowed border-r border-paper-hairline dark:border-cyber-border"
            onClick={() => bumpEditorFontSize(-1)}
            disabled={editorFontSize <= 10}
            aria-label="Decrease font size"
            title="Decrease font size"
          >
            −
          </button>
          <button
            type="button"
            className="w-7 h-7 flex items-center justify-center text-paper-inkSoft dark:text-cyber-muted hover:bg-paper-elevated dark:hover:bg-ape-elevated hover:text-cyber-clay dark:hover:text-cyber-cyan transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            onClick={() => bumpEditorFontSize(1)}
            disabled={editorFontSize >= 24}
            aria-label="Increase font size"
            title="Increase font size"
          >
            +
          </button>
        </div>
        <div className="flex-1" />
        <ImportMediaButton />
        <button
          className="btn-cyan-sm !text-[15px] !py-1.5"
          onClick={() => saveRevision(doc.id)}
          title="Save current content as a revision"
        >
          Save
        </button>
      </div>
      <div className="px-4 pt-3 pb-1 flex items-baseline gap-3 bg-paper-base dark:bg-ape-base">
        <h2 className="font-semibold text-paper-ink dark:text-cyber-primary truncate text-base">
          {doc.title}
        </h2>
        <span
          data-saved-label
          className="text-xs text-paper-inkSoft dark:text-cyber-muted font-mono uppercase tracking-wider"
        >
          {savedLabel}
        </span>
      </div>
      <div className="flex-1 flex min-h-0">
        {showWrite && (
          <textarea
            ref={textareaRef}
            value={doc.content}
            onChange={(e) => updateContent(doc.id, e.target.value)}
            onFocus={() => reportCaret(true)}
            onBlur={() => reportCaret(false)}
            onSelect={() => reportCaret(true)}
            onKeyUp={() => reportCaret(true)}
            onClick={() => reportCaret(true)}
            style={{ fontSize: `${editorFontSize}px`, lineHeight: 1.55 }}
            className={`flex-1 p-4 outline-none resize-none font-mono bg-paper-base dark:bg-ape-base text-paper-ink dark:text-cyber-primary caret-cyber-clay dark:caret-cyber-cyan placeholder:text-paper-inkSoft/60 dark:placeholder:text-cyber-muted/60 ${
              showPreview ? 'border-r border-paper-hairline dark:border-cyber-border' : ''
            }`}
            placeholder="Start writing in Markdown…"
            spellCheck={false}
          />
        )}
        {showPreview && (
          <div
              className="flex-1 overflow-y-auto p-4 prose-md bg-paper-base dark:bg-ape-base"
              style={{ fontSize: `${editorFontSize}px`, lineHeight: 1.55 }}
            >
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {doc.content || '*Nothing to preview yet.*'}
            </ReactMarkdown>
          </div>
        )}
      </div>
    </div>
  );
}
