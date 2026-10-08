import { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useStore, useCurrentDocument } from '@/store/useStore';
import { ImportMediaButton } from '@/components/ImportMediaButton';
import { useInlineCompletion } from '@/hooks/useInlineCompletion';

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
  const api = useStore((s) => s.api);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const [now, setNow] = useState<number>(() => Date.now());

  // Inline sentence completion. Auto-disabled when no API key is configured.
  const apiConfigured = Boolean(api.apiKey && api.apiEndpoint);
  // User-controlled on/off toggle for the inline-completion feature.
  // Defaults to ON when the API is configured; the user can flip it
  // off with the appliance-style toggle next to the counter pill.
  const [inlineOn, setInlineOn] = useState<boolean>(true);
  const inlineEnabled = apiConfigured && inlineOn;
  const inline = useInlineCompletion({
    textareaRef,
    value: doc?.content ?? '',
    api,
    enabled: inlineEnabled,
  });
  // When the user flips the toggle off, immediately cancel any in-flight
  // request and drop the ghost so it doesn't linger on screen.
  const toggleInline = () => {
    if (inlineOn) {
      inline.onBlur();
    }
    setInlineOn((v) => !v);
  };

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

  // Listen for "accept inline completion" events from the
  // useInlineCompletion hook (triggered by Tab in the textarea). The hook
  // computes the spliced text + new caret position and we apply it through
  // the same path as the OCR-insert handler above.
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ text: string; caret: number }>).detail;
      const text = detail?.text;
      const caret = detail?.caret;
      if (typeof text !== 'string' || typeof caret !== 'number') return;
      if (!doc) return;
      updateContent(doc.id, text);
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
    window.addEventListener('mvp:accept-completion', handler);
    return () => window.removeEventListener('mvp:accept-completion', handler);
  }, [doc, updateContent]);

  // Manual inline-completion trigger. ⌘/Ctrl + \ fires immediately,
  // bypassing the 300ms debounce and the selection suppression. This
  // mirrors the convention used by VS Code Copilot, Cursor Tab, and
  // TabComplete (Alt+\ / Cmd+\).
  useEffect(() => {
    if (!inlineEnabled) return;
    const handler = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      if (e.key !== '\\') return;
      e.preventDefault();
      const ta = textareaRef.current;
      if (ta && document.activeElement !== ta) {
        ta.focus();
      }
      inline.triggerNow();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [inline, inlineEnabled]);

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
            className="appearance-none cursor-pointer pl-2 pr-6 h-9 text-[15px] leading-none rounded border border-paper-hairline dark:border-cyber-border bg-paper-surface dark:bg-ape-panel text-paper-ink dark:text-cyber-primary hover:border-cyber-clay dark:hover:border-cyber-cyan focus:outline-none focus:border-cyber-clay dark:focus:border-cyber-cyan transition-colors"
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
            className="w-9 h-9 flex items-center justify-center text-[15px] text-paper-inkSoft dark:text-cyber-muted hover:bg-paper-elevated dark:hover:bg-ape-elevated hover:text-cyber-clay dark:hover:text-cyber-cyan transition-colors disabled:opacity-50 disabled:cursor-not-allowed border-r border-paper-hairline dark:border-cyber-border"
            onClick={() => bumpEditorFontSize(-1)}
            disabled={editorFontSize <= 10}
            aria-label="Decrease font size"
            title="Decrease font size"
          >
            −
          </button>
          <button
            type="button"
            className="w-9 h-9 flex items-center justify-center text-[15px] text-paper-inkSoft dark:text-cyber-muted hover:bg-paper-elevated dark:hover:bg-ape-elevated hover:text-cyber-clay dark:hover:text-cyber-cyan transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            onClick={() => bumpEditorFontSize(1)}
            disabled={editorFontSize >= 24}
            aria-label="Increase font size"
            title="Increase font size"
          >
            +
          </button>
        </div>
        {/* Inline-completion status pill. Three states: idle (no dot),
            thinking (pulsing dot + "thinking…"), generated (solid dot +
            "ready"). The "generated" state means a ghost is on screen
            waiting to be accepted with Tab. */}
        <div
          className="inline-flex items-center gap-1.5 h-9 px-2.5 rounded border border-paper-hairline dark:border-cyber-border bg-paper-surface dark:bg-ape-panel text-[15px] font-mono uppercase tracking-wider select-none"
          aria-live="polite"
          aria-label="Inline completion status"
          title="Inline sentence completion status"
        >
          {inline.streaming ? (
            <>
              <span className="inline-block w-2.5 h-2.5 rounded-full bg-cyber-clay dark:bg-cyber-cyan animate-pulse" />
              <span className="text-cyber-clay dark:text-cyber-cyan">thinking</span>
            </>
          ) : inline.ghost ? (
            <>
              <span className="inline-block w-2.5 h-2.5 rounded-full bg-cyber-clay dark:bg-cyber-cyan" />
              <span className="text-cyber-clay dark:text-cyber-cyan">ready · tab</span>
            </>
          ) : (
            <>
              <span className="inline-block w-2.5 h-2.5 rounded-full bg-paper-inkSoft/40 dark:bg-cyber-muted/40" />
              <span className="text-paper-inkSoft dark:text-cyber-muted">idle</span>
            </>
          )}
        </div>
        {/* Inline-completion counters: requests fired / completions
            accepted this session. Click to reset. */}
        <button
          type="button"
          onClick={inline.resetStats}
          className="inline-flex items-center gap-1.5 h-9 px-2.5 rounded border border-paper-hairline dark:border-cyber-border bg-paper-surface dark:bg-ape-panel text-[15px] font-mono uppercase tracking-wider text-paper-inkSoft dark:text-cyber-muted hover:border-cyber-clay/60 dark:hover:border-cyber-cyan/60 hover:text-cyber-clay dark:hover:text-cyber-cyan transition-colors"
          aria-label={`Inline completion counters: ${inline.stats.requested} requested, ${inline.stats.accepted} accepted. Click to reset.`}
          title="Click to reset the counters"
        >
          <span className="text-paper-ink dark:text-cyber-primary normal-case tracking-normal font-mono">
            {inline.stats.requested}
          </span>
          <span className="opacity-60">/</span>
          <span className="text-cyber-clay dark:text-cyber-cyan normal-case tracking-normal font-mono">
            {inline.stats.accepted}
          </span>
        </button>
        {/* Inline-completion on/off toggle. Styled like an electronic
            appliance rocker: a recessed track with a sliding knob, a
            glowing dot inside the knob when on, and an I/O symbol on
            the right. Click to flip state. Disabled (but visible) when
            no API key is configured, so the user can still see the
            feature exists. */}
        <button
          type="button"
          onClick={toggleInline}
          disabled={!apiConfigured}
          aria-pressed={inlineOn}
          aria-label={`Inline completion ${inlineOn ? 'on' : 'off'}. Click to toggle.`}
          title={
            apiConfigured
              ? `Inline completion is ${inlineOn ? 'ON' : 'OFF'} — click to toggle`
              : 'Inline completion unavailable: configure an API key first'
          }
          className={[
            'group inline-flex items-center h-9 rounded-full border transition-colors select-none',
            'pl-1.5 pr-2.5 gap-2',
            apiConfigured
              ? inlineOn
                ? 'border-cyber-clay/60 dark:border-cyber-cyan/60 bg-cyber-clay/10 dark:bg-cyber-cyan/10'
                : 'border-paper-hairline dark:border-cyber-border bg-paper-surface dark:bg-ape-panel hover:border-cyber-clay/40 dark:hover:border-cyber-cyan/40'
              : 'border-paper-hairline dark:border-cyber-border bg-paper-surface/50 dark:bg-ape-panel/50 opacity-50 cursor-not-allowed',
          ].join(' ')}
        >
          {/* Fixed-width track. The knob slides inside this 36px
              channel; the channel itself does not move, so the
              label position stays put. */}
          <span
            className="relative inline-block h-6 w-9 overflow-hidden"
            aria-hidden
          >
            <span
              className={[
                'absolute top-0 left-0 inline-flex items-center justify-center h-6 w-6 rounded-full border transition-all duration-200 ease-out',
                inlineOn
                  ? 'translate-x-[8px] border-cyber-clay dark:border-cyber-cyan bg-cyber-clay dark:bg-cyber-cyan shadow-[0_0_6px_var(--cyber-clay-glow,rgba(232,93,59,0.55))] dark:shadow-[0_0_6px_var(--cyber-cyan-glow,rgba(0,229,255,0.55))]'
                  : 'translate-x-0 border-paper-inkSoft/50 dark:border-cyber-muted/50 bg-paper-base dark:bg-ape-base',
              ].join(' ')}
            >
              {/* I/O glyph inside the knob. "I" (vertical bar) when on,
                  "O" (ring) when off. Centered. */}
              {inlineOn ? (
                <span className="block w-[3px] h-3 rounded-sm bg-paper-base dark:bg-ape-base" />
              ) : (
                <span className="block w-2.5 h-2.5 rounded-full border-[1.5px] border-paper-inkSoft/70 dark:border-cyber-muted/70" />
              )}
            </span>
          </span>
          {/* Label, in monospace small caps like the other pills.
              Sits in a fixed slot to the right of the track. */}
          <span
            className={[
              'text-[15px] font-mono uppercase tracking-wider',
              inlineOn
                ? 'text-cyber-clay dark:text-cyber-cyan'
                : 'text-paper-inkSoft dark:text-cyber-muted',
            ].join(' ')}
          >
            {inlineOn ? 'On' : 'Off'}
          </span>
        </button>
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
          <div className={`relative flex-1 min-w-0 flex flex-col ${showPreview ? 'border-r border-paper-hairline dark:border-cyber-border' : ''}`}>
            <textarea
              ref={textareaRef}
              value={doc.content}
              onChange={(e) => {
                updateContent(doc.id, e.target.value);
                if (inlineEnabled) inline.onTextChange(e.target.value);
              }}
              onKeyDown={(e) => {
                if (inlineEnabled) inline.onKeyDown(e);
              }}
              onFocus={() => reportCaret(true)}
              onBlur={() => {
                reportCaret(false);
                if (inlineEnabled) inline.onBlur();
              }}
              onSelect={() => reportCaret(true)}
              onKeyUp={() => reportCaret(true)}
              onClick={() => reportCaret(true)}
              style={{ fontSize: `${editorFontSize}px`, lineHeight: 1.55 }}
              className="flex-1 p-4 outline-none resize-none font-mono bg-paper-base dark:bg-ape-base text-paper-ink dark:text-cyber-primary caret-cyber-clay dark:caret-cyber-cyan placeholder:text-paper-inkSoft/60 dark:placeholder:text-cyber-muted/60"
              placeholder="Start writing in Markdown…"
              spellCheck={false}
            />
            {/* Bottom suggestion panel. Renders only when a ghost is
                shown or a request is streaming. Its height grows
                automatically with the number of lines in the
                suggestion, capped at ~40% of the editor so a very
                long completion never takes over the whole viewport.
                The textarea (flex-1) shrinks to make room. */}
            {(inline.ghost || inline.streaming) && (
              <div
                aria-live="polite"
                aria-label="Inline completion suggestion"
                className="flex flex-col border-t border-paper-hairline dark:border-cyber-border bg-paper-elevated/60 dark:bg-ape-elevated/60"
                style={{ maxHeight: '40%' }}
              >
                <div className="flex items-center justify-between gap-3 px-4 pt-2 pb-1 text-[10px] font-mono uppercase tracking-wider text-paper-inkSoft dark:text-cyber-muted select-none">
                  <span>Suggestion · Tab to accept · Esc to dismiss</span>
                  {/* Accept button. Sits in the panel header so it's
                      always visible regardless of suggestion length.
                      Dim (disabled visual) when no ghost is on screen
                      yet (i.e. still streaming), and active when a
                      ghost is ready to be inserted. Equivalent to
                      pressing Tab. */}
                  <button
                    type="button"
                    onClick={inline.accept}
                    // onMouseDown + preventDefault stops the textarea
                    // from blurring when the button is clicked. Without
                    // this, blur fires before click and the hook's
                    // onBlur handler cancels the ghost before accept()
                    // can read it.
                    onMouseDown={(e) => e.preventDefault()}
                    disabled={!inline.ghost}
                    aria-label="Accept inline completion"
                    title={
                      inline.ghost
                        ? 'Accept the suggestion (Tab)'
                        : 'Waiting for a suggestion…'
                    }
                    className={[
                      'inline-flex items-center gap-1.5 h-7 px-2.5 rounded border text-sm font-mono uppercase tracking-wider transition-colors',
                      inline.ghost
                        ? 'border-cyber-clay dark:border-cyber-cyan bg-cyber-clay/15 dark:bg-cyber-cyan/15 text-cyber-clay dark:text-cyber-cyan hover:bg-cyber-clay/25 dark:hover:bg-cyber-cyan/25 cursor-pointer'
                        : 'border-paper-hairline dark:border-cyber-border bg-paper-surface/60 dark:bg-ape-panel/60 text-paper-inkSoft/50 dark:text-cyber-muted/50 cursor-not-allowed',
                    ].join(' ')}
                  >
                    <svg
                      aria-hidden="true"
                      viewBox="0 0 12 12"
                      className="h-3 w-3"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.6"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M2 6.5 L5 9 L10 3.5" />
                    </svg>
                    Accept
                  </button>
                </div>
                <div
                  className="px-4 pb-3 font-mono whitespace-pre-wrap break-words overflow-y-auto"
                  style={{
                    fontSize: `${editorFontSize}px`,
                    lineHeight: 1.55,
                    color: 'var(--ghost-color, rgba(156, 163, 175, 0.85))',
                  }}
                >
                  {inline.ghost ? (
                    inline.ghost
                  ) : (
                    // Animated hourglass-ish indicator: 3 dots that pulse
                    // in sequence. Pure CSS, no extra deps.
                    <span className="inline-flex gap-1 align-baseline">
                      <span className="inline-block w-1.5 h-1.5 rounded-full bg-current opacity-40 animate-pulse" style={{ animationDelay: '0ms' }} />
                      <span className="inline-block w-1.5 h-1.5 rounded-full bg-current opacity-40 animate-pulse" style={{ animationDelay: '150ms' }} />
                      <span className="inline-block w-1.5 h-1.5 rounded-full bg-current opacity-40 animate-pulse" style={{ animationDelay: '300ms' }} />
                    </span>
                  )}
                </div>
              </div>
            )}
          </div>
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
