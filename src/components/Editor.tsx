import { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useStore, useCurrentDocument } from '@/store/useStore';
import { PhotoImportButton } from '@/components/PhotoImportButton';

/**
 * Editor: plain textarea (write) + react-markdown preview (preview),
 * with a split mode. Selection in the textarea is exposed via a global
 * window event so the ChatPanel can pick it up.
 */
export function Editor() {
  const doc = useCurrentDocument();
  const viewMode = useStore((s) => s.viewMode);
  const setViewMode = useStore((s) => s.setViewMode);
  const updateContent = useStore((s) => s.updateDocumentContent);
  const saveRevision = useStore((s) => s.saveRevision);
  const setEditorFocus = useStore((s) => s.setEditorFocus);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);

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

  // Listen for OCR-insert events from the photo import button. Inserts
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
      <div className="flex-1 flex items-center justify-center text-gray-500">
        <div className="text-center">
          <p>No document selected.</p>
          <button
            className="mt-3 text-sm px-3 py-1.5 rounded bg-blue-600 text-white"
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
    <div className="flex-1 flex flex-col min-w-0">
      <div className="flex items-center gap-2 px-4 py-2 border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-950">
        <span className="font-semibold truncate">{doc.title}</span>
        <span className="text-xs text-gray-500 ml-2">
          {lastSavedAt ? 'Saved locally' : ''}
        </span>
        <div className="flex-1" />
        <div className="inline-flex rounded border border-gray-300 dark:border-gray-700 overflow-hidden text-xs">
          {(['write', 'split', 'preview'] as const).map((m) => (
            <button
              key={m}
              onClick={() => setViewMode(m)}
              className={`px-2 py-1 ${
                viewMode === m
                  ? 'bg-blue-600 text-white'
                  : 'hover:bg-gray-100 dark:hover:bg-gray-800'
              }`}
            >
              {m[0].toUpperCase() + m.slice(1)}
            </button>
          ))}
        </div>
        <PhotoImportButton />
        <button
          className="text-xs px-2 py-1 rounded border border-gray-300 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800"
          onClick={() => saveRevision(doc.id)}
          title="Save current content as a revision"
        >
          Save revision
        </button>
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
            className={`flex-1 p-4 outline-none resize-none font-mono text-sm bg-white dark:bg-gray-950 ${
              showPreview ? 'border-r border-gray-200 dark:border-gray-800' : ''
            }`}
            placeholder="Start writing in Markdown…"
            spellCheck={false}
          />
        )}
        {showPreview && (
          <div className="flex-1 overflow-y-auto p-4 prose-md">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {doc.content || '*Nothing to preview yet.*'}
            </ReactMarkdown>
          </div>
        )}
      </div>
    </div>
  );
}
