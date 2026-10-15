import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { v4 as uuid } from 'uuid';
import { useStore, useCurrentDocument } from '@/store/useStore';
import { ImportMediaButton } from '@/components/ImportMediaButton';
import { useInlineCompletion } from '@/hooks/useInlineCompletion';
import {
  useDragResize,
  clamp,
  MIN_EDITOR_SPLIT_PCT,
  MAX_EDITOR_SPLIT_PCT,
  DEFAULT_EDITOR_SPLIT_PCT,
} from '@/hooks/useDragResize';
import { remarkPlugins, rehypePlugins } from '@/utils/markdown';
import { requiresApiKey } from '@/config/providers';
import {
  getSelectionRect,
  reanchorAll,
  clampCommentBody,
} from '@/utils/comments';
import type { Comment, MentionToken } from '@/types';
import { CommentLayer } from '@/components/CommentLayer';
import { CommentMargin } from '@/components/CommentMargin';
import { CommentComposer } from '@/components/CommentComposer';
import { CommentPopover } from '@/components/CommentPopover';
import { CommentTray } from '@/components/CommentTray';
import { ResizeHandle } from '@/components/ResizeHandle';

/**
 * After any code path that updates the controlled textarea's value
 * (`updateContent`, OCR insert, accept-completion, wrapSelection…),
 * restore the caret / focus on the next microtask so React has flushed
 * the new value into the DOM.
 *
 * The microtask is needed because `updateContent` triggers a React
 * re-render; trying to focus or set the selection range synchronously
 * hits a stale element. `focus({ preventScroll: true })` keeps the
 * surrounding page from scrolling when the textarea is far down on
 * the page. `try/catch` around `setSelectionRange` defends against
 * React 18 strict mode briefly detaching the element between commit
 * and the microtask, which would otherwise throw `InvalidStateError`.
 *
 * Optional `preserveScroll` additionally restores the textarea's
 * internal `scrollTop`/`scrollLeft` after the focus/selection change
 * in case the browser tried to scroll the textarea itself.
 */
function restoreCaret(
  ta: HTMLTextAreaElement | null,
  start: number,
  end: number,
  options?: { preserveScroll?: boolean }
) {
  if (!ta) return;
  const scrollTop = options?.preserveScroll ? ta.scrollTop : 0;
  const scrollLeft = options?.preserveScroll ? ta.scrollLeft : 0;
  queueMicrotask(() => {
    try {
      ta.focus({ preventScroll: true });
    } catch {
      ta.focus();
    }
    try {
      ta.setSelectionRange(start, end);
    } catch {
      /* textarea may be temporarily detached between commit and microtask */
    }
    if (options?.preserveScroll) {
      if (ta.scrollTop !== scrollTop) ta.scrollTop = scrollTop;
      if (ta.scrollLeft !== scrollLeft) ta.scrollLeft = scrollLeft;
    }
  });
}

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
  const rawEditorSplitPct = useStore((s) => s.layout.editorSplitPct);
  const editorSplitPct = clamp(
    typeof rawEditorSplitPct === 'number'
      ? rawEditorSplitPct
      : DEFAULT_EDITOR_SPLIT_PCT,
    MIN_EDITOR_SPLIT_PCT,
    MAX_EDITOR_SPLIT_PCT
  );
  const setLayout = useStore((s) => s.setLayout);
  const bumpEditorFontSize = useStore((s) => s.bumpEditorFontSize);
  const updateContent = useStore((s) => s.updateDocumentContent);
  const saveRevision = useStore((s) => s.saveRevision);
  const setEditorFocus = useStore((s) => s.setEditorFocus);
  const api = useStore((s) => s.api);
  const debugMode = useStore((s) => s.debugMode);
  // Comments — read the per-document list and the actions. We subscribe
  // to `comments[currentDocumentId]` so re-renders fire only when the
  // current document's comments change, not when comments on another
  // document change.
  const currentComments = useStore(
    (s) => (doc ? s.comments[doc.id] ?? [] : [])
  );
  const addComment = useStore((s) => s.addComment);
  const updateCommentBody = useStore((s) => s.updateCommentBody);
  const deleteComment = useStore((s) => s.deleteComment);
  const replaceCommentsForDocument = useStore(
    (s) => s.replaceCommentsForDocument
  );
  const undoLastCommentOp = useStore((s) => s.undoLastCommentOp);
  // `commentUndoStack` is read for the Undo affordance in the tray.
  const commentUndoDepth = useStore((s) => s.commentUndoStack.length);
  // Subscribe to the current document's focus state so the toolbar
  // "Comment" button can enable/disable itself when the user
  // changes the selection. The store keeps `selectionStart` and
  // `selectionEnd` updated from the textarea's `select` / `keyup`
  // events.
  const editorFocusState = useStore(
    (s) => (doc ? s.editorFocus[doc.id] : undefined)
  );
  const hasSelection = !!(
    doc &&
    editorFocusState &&
    editorFocusState.selectionEnd > editorFocusState.selectionStart
  );
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const writePaneRef = useRef<HTMLDivElement>(null);
  const splitRowRef = useRef<HTMLDivElement>(null);
  // Mirror overlay ref — used by `getSelectionRect` to measure the
  // selection's y-offset for the floating composer + the margin badges.
  const mirrorRef = useRef<HTMLDivElement>(null);
  // UI state for the comment feature.
  const [composerOpen, setComposerOpen] = useState(false);
  const [composerPosition, setComposerPosition] = useState<{
    left: number;
    top: number;
    right: number;
    bottom: number;
  } | null>(null);
  const [pendingSelection, setPendingSelection] = useState<{
    start: number;
    end: number;
  } | null>(null);
  const [activeCommentId, setActiveCommentId] = useState<string | null>(null);
  const [popoverPosition, setPopoverPosition] = useState<{
    left: number;
    top: number;
  } | null>(null);
  // Mirrors the chat panel's `streaming` state via a window event so
  // the "Send to AI" button in `CommentTray` can dim itself while a
  // chat reply is still being generated. See `mvp:chat-streaming`
  // dispatch in `ChatPanel.tsx`.
  const [chatStreaming, setChatStreaming] = useState(false);
  useEffect(() => {
    const onStream = (e: Event) => {
      const detail = (e as CustomEvent<{ streaming: boolean }>).detail;
      setChatStreaming(Boolean(detail?.streaming));
    };
    window.addEventListener('mvp:chat-streaming', onStream);
    return () => window.removeEventListener('mvp:chat-streaming', onStream);
  }, []);
  // Unified "Format" dropdown — exposes Bold, Italic, Underline and
  // the font-size +/- controls in a single menu. Replaces the two
  // separate pill groups (font-size + inline-format) that lived in
  // this toolbar previously.
  const [formatMenuOpen, setFormatMenuOpen] = useState(false);
  const formatMenuRef = useRef<HTMLDivElement>(null);
  const [undoToast, setUndoToast] = useState<{
    message: string;
    at: number;
  } | null>(null);
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const [now, setNow] = useState<number>(() => Date.now());

  // Suggestion-panel height (px). Persisted in localStorage so the
  // user's preferred size survives reloads. Defaults to 160. Clamped
  // to a sensible range on render so a stale stored value can't
  // collapse the textarea or take over the whole viewport. The drag
  // handle at the top edge of the panel lets the user adjust this.
  const [suggestionHeight, setSuggestionHeight] = useState<number>(() => {
    try {
      const raw = localStorage.getItem('ai-text-editor-mvp:suggestion-height');
      if (!raw) return 160;
      const n = parseInt(raw, 10);
      if (!Number.isFinite(n)) return 160;
      return Math.min(600, Math.max(80, n));
    } catch {
      return 160;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(
        'ai-text-editor-mvp:suggestion-height',
        String(suggestionHeight)
      );
    } catch {
      /* ignore quota errors */
    }
  }, [suggestionHeight]);
  const dragResize = useDragResize({
    mode: 'axis',
    axis: 'vertical',
    onDelta: ({ dy }) => {
      // dy is cumulative from drag start; use a ref-tracked anchor
      // so we can convert it to an absolute height.
      anchorRef.current = anchorStartRef.current - dy;
      const next = clampSuggestionHeight(anchorRef.current);
      setSuggestionHeight(next);
    },
  });
  const anchorRef = useRef<number>(suggestionHeight);
  const anchorStartRef = useRef<number>(suggestionHeight);
  const onSuggestionHandleDown = (
    e: React.PointerEvent<HTMLDivElement>
  ) => {
    anchorStartRef.current = suggestionHeight;
    anchorRef.current = suggestionHeight;
    dragResize.start('top', e);
  };
  // Drag the Write | Preview divider in Split mode. The write pane's
  // share is stored as a percent of the row width so it survives
  // window resizes.
  const { start: beginSplitResize } = useDragResize({
    mode: 'axis',
    axis: 'horizontal',
    onDelta: ({ absX }) => {
      const row = splitRowRef.current;
      if (!row) return;
      const rect = row.getBoundingClientRect();
      if (rect.width <= 0) return;
      const pct = ((absX - rect.left) / rect.width) * 100;
      setLayout({
        editorSplitPct: clamp(pct, MIN_EDITOR_SPLIT_PCT, MAX_EDITOR_SPLIT_PCT),
      });
    },
  });
  const clampSuggestionHeight = (px: number): number => {
    const pane = writePaneRef.current;
    const max = pane ? Math.max(120, pane.clientHeight * 0.6) : 600;
    return Math.min(max, Math.max(80, px));
  };

  // Inline sentence completion. Auto-disabled when no API key is configured.
  // The keyless `google-ai-mode` provider is also treated as "not
  // configured" for inline completion because there is no streaming
  // API the hook could call — the user explicitly chose the
  // keyless path knowing it is chat-only.
  const apiConfigured =
    requiresApiKey(api.provider) && Boolean(api.apiKey && api.apiEndpoint);
  // User-controlled on/off toggle for the inline-completion feature.
  // Defaults to OFF so predictions never fire until the user
  // explicitly enables them via the Predict button.
  const [inlineOn, setInlineOn] = useState<boolean>(false);
  // Ref mirror so the click handler (and queued microtasks) can read
  // the latest value without depending on a stale closure.
  const inlineOnRef = useRef<boolean>(inlineOn);
  inlineOnRef.current = inlineOn;
  const inlineEnabled = apiConfigured && inlineOn;
  const inline = useInlineCompletion({
    textareaRef,
    value: doc?.content ?? '',
    api,
    enabled: inlineEnabled,
  });
  // When the user clicks the Predict button we toggle the inline-
  // prediction feature. Going OFF → ON also fires a single immediate
  // prediction (delightful "starter suggestion") while going ON → OFF
  // cancels any in-flight stream + drops the ghost so no suggestion
  // sticks around after the user disabled the feature.
  const toggleInlinePredict = () => {
    const wasOn = inlineOnRef.current;
    if (wasOn) {
      // ON → OFF: cancel any in-flight request before flipping the flag
      // so no ghost appears once the panel closes.
      inline.onBlur();
      setInlineOn(false);
      return;
    }
    // OFF → ON: flip first so the hook is enabled, then fire.
    setInlineOn(true);
    // Queue the trigger for next tick so the hook has re-rendered with
    // enabled=true (otherwise the gating logic returns early).
    queueMicrotask(() => {
      if (inlineOnRef.current && apiConfigured) {
        inline.triggerNow();
      }
    });
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

  // After Apply, ProposedEditCard / ChatPanel dispatch this so the
  // textarea selection rectangle matches the adopted replacement.
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ start: number; end: number }>).detail;
      if (
        !detail ||
        typeof detail.start !== 'number' ||
        typeof detail.end !== 'number'
      ) {
        return;
      }
      restoreCaret(textareaRef.current, detail.start, detail.end, {
        preserveScroll: true,
      });
    };
    window.addEventListener('mvp:select-range', handler);
    return () => window.removeEventListener('mvp:select-range', handler);
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
      restoreCaret(textareaRef.current, caret, caret);
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
      restoreCaret(textareaRef.current, caret, caret);
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

  // ---- Inline commenting ----
  // Select text → toolbar "Comment" → composer → margin badge.
  // Badge opens the popover (edit / delete). "Send to AI" batches
  // comments into the chat panel.

  // Debounced re-anchor: when the document content changes, every
  // comment is re-located via `reanchorAll`. We debounce by 150 ms so
  // fast typing doesn't thrash the store.
  const reanchorTimerRef = useRef<number | null>(null);
  useEffect(() => {
    if (!doc) return;
    if (currentComments.length === 0) return;
    if (reanchorTimerRef.current !== null) {
      window.clearTimeout(reanchorTimerRef.current);
    }
    reanchorTimerRef.current = window.setTimeout(() => {
      const { next } = reanchorAll(doc.content, currentComments);
      // Skip the store update if nothing actually changed (the common
      // case when the user types outside any comment's range).
      const same =
        next.length === currentComments.length &&
        next.every(
          (c, i) =>
            c.start === currentComments[i].start &&
            c.end === currentComments[i].end &&
            c.outdated === currentComments[i].outdated &&
            c.snippet === currentComments[i].snippet
        );
      if (!same) {
        replaceCommentsForDocument(doc.id, next);
      }
    }, 150);
    return () => {
      if (reanchorTimerRef.current !== null) {
        window.clearTimeout(reanchorTimerRef.current);
      }
    };
  }, [doc?.content, doc?.id, currentComments, replaceCommentsForDocument]);

  // Sync the mirror overlay's `scrollTop` to the textarea's so the
  // highlights track the visible text. Also keep the mirror's
  // content width equal to the textarea's *clientWidth* (the area
  // excluding the scrollbar) — otherwise the mirror wraps text
  // differently, `scrollHeight` diverges, and the selection
  // highlight drifts further down the document.
  // Re-bind when `viewMode` changes: Preview unmounts the write pane,
  // so without this dep the scroll listener stays on a detached
  // textarea and the mirror stops tracking scroll after switching back.
  useEffect(() => {
    const ta = textareaRef.current;
    const mirror = mirrorRef.current;
    if (!ta || !mirror) return;
    const syncWidth = () => {
      // Textarea's clientWidth is the content area inside its
      // scrollbar. The mirror is `position: absolute; inset: 0` so
      // by default it spans the full wrapper (including the
      // scrollbar gutter). Cap the mirror's right edge so its
      // wrap width matches the textarea's wrap width.
      const sb = Math.max(0, ta.offsetWidth - ta.clientWidth);
      mirror.style.right = `${sb}px`;
    };
    const handler = () => {
      mirror.scrollTop = ta.scrollTop;
      mirror.scrollLeft = ta.scrollLeft;
    };
    syncWidth();
    handler();
    ta.addEventListener('scroll', handler, { passive: true });
    window.addEventListener('resize', syncWidth);
    // Re-sync when the scrollbar appears/disappears (content grows).
    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(() => {
        syncWidth();
        handler();
      });
      ro.observe(ta);
    }
    return () => {
      ta.removeEventListener('scroll', handler);
      window.removeEventListener('resize', syncWidth);
      if (ro) ro.disconnect();
    };
  }, [doc?.id, viewMode]);

  // Live measurement of each comment's first-line y-offset for the
  // right-margin badges. Recomputes on content / comments / scroll.
  const [badgePositions, setBadgePositions] = useState<
    Record<string, number>
  >({});
  // Editor-pane bounds in the same pane-local coordinate space the
  // composer / popover use. Updated on mount + on window resize so
  // the floating boxes always clamp to the live container size
  // (rather than the size at the moment the box was first opened).
  const [paneBounds, setPaneBounds] = useState<{
    left: number;
    top: number;
    right: number;
    bottom: number;
  } | null>(null);
  useEffect(() => {
    const pane = writePaneRef.current;
    if (!pane) return;
    // Measure the *wrapper* (the inner div holding the textarea +
    // mirror) rather than the pane. The composer / popover are
    // `position: absolute` inside the wrapper, so they should
    // clamp to the wrapper's bounds — not the pane's, which
    // includes the right-margin column (where the badges live).
    const wrapper = pane.querySelector<HTMLElement>(
      '[data-cm-wrapper]'
    );
    if (!wrapper) return;
    const update = () => {
      const r = wrapper.getBoundingClientRect();
      // Wrapper-local coords (the wrapper is at (0, 0) of itself).
      setPaneBounds({ left: 0, top: 0, right: r.width, bottom: r.height });
    };
    update();
    const ro =
      typeof ResizeObserver !== 'undefined' ? new ResizeObserver(update) : null;
    if (ro) ro.observe(wrapper);
    window.addEventListener('resize', update);
    return () => {
      if (ro) ro.disconnect();
      window.removeEventListener('resize', update);
    };
  }, [doc?.id]);
  useEffect(() => {
    if (!doc) {
      setBadgePositions({});
      return;
    }
    const compute = () => {
      const mirror = mirrorRef.current;
      const ta = textareaRef.current;
      const pane = writePaneRef.current;
      if (!mirror || !ta || !pane) return;
      const taRect = ta.getBoundingClientRect();
      // The badge lives in the right-margin column, which is a
      // flex sibling of the wrapper, so its viewport top matches
      // the wrapper's. The badge's `top` (in margin-local coords)
      // equals `rect.top - marginTop` because the margin column
      // itself does not scroll — only the textarea inside the
      // wrapper scrolls. Adding `ta.scrollTop` (the previous
      // implementation) double-counted the scroll and made the
      // badge drift as the user scrolled.
      const margin = pane.querySelector<HTMLElement>('.cm-margin');
      const marginRect = margin?.getBoundingClientRect();
      const next: Record<string, number> = {};
      for (const c of currentComments) {
        const rect = getSelectionRect(
          doc.content,
          mirror,
          c.start,
          c.end
        );
        if (!rect) continue;
        // Translate from viewport coords to the margin column's
        // coord space. The badge is `position: absolute` inside
        // `.cm-margin`, which is a flex sibling of `data-cm-wrapper`
        // and does **not** scroll with the textarea. So the
        // badge's `top` simply equals the line's viewport y minus
        // the margin column's viewport top. Adding `ta.scrollTop`
        // (the previous formula) double-counted the scroll and
        // made the badge drift as the user scrolled.
        const marginTop = marginRect?.top ?? taRect.top;
        const top = rect.top - marginTop;
        // Clamp so the badge stays inside the pane even when scrolled
        // far above / below the comment's actual line.
        next[c.id] = Math.max(0, Math.min(top, pane.clientHeight - 32));
      }
      setBadgePositions(next);
    };
    compute();
    const ta = textareaRef.current;
    if (ta) ta.addEventListener('scroll', compute, { passive: true });
    window.addEventListener('resize', compute);
    return () => {
      if (ta) ta.removeEventListener('scroll', compute);
      window.removeEventListener('resize', compute);
    };
  }, [doc, currentComments]);

  /**
   * Translate a viewport-coords rect into the wrapper-local
   * coord system that the composer + popover use. The wrapper
   * (`data-cm-wrapper`) is the `position: relative` ancestor the
   * floating boxes resolve their `left/top` against; using pane
   * coords instead caused the popover to render far outside the
   * editor area when the margin column was visible.
   *
   * When the wrapper isn't mounted yet (e.g. the very first
   * render), we fall back to pane-local coords (subtracting
   * `paneRect.left / .top`) so the box still appears in a sensible
   * spot — the clamp will catch any small drift.
   */
  // Translate a viewport rect into wrapper-local coords. The composer
  // / popover are `position: absolute` inside the non-scrolling
  // wrapper, so `top` is the selection's viewport distance from the
  // wrapper top — never document-scroll offset.
  const toWrapperLocal = useCallback(
    (rect: { left: number; top: number; right: number; bottom: number }) => {
      const pane = writePaneRef.current;
      if (!pane) return null;
      const paneRect = pane.getBoundingClientRect();
      const wrapper = pane.querySelector<HTMLElement>('[data-cm-wrapper]');
      const wrapperRect = wrapper?.getBoundingClientRect();
      const baseLeft = wrapperRect?.left ?? paneRect.left;
      const baseTop = wrapperRect?.top ?? paneRect.top;
      return {
        left: rect.left - baseLeft,
        top: rect.top - baseTop,
        right: rect.right - baseLeft,
        bottom: rect.bottom - baseTop,
      };
    },
    []
  );

  // Global `⌘/Ctrl + Z` undo for comment ops — intercepts only when
  // the textarea is focused so we don't steal the editor's native
  // undo for plain text changes.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      if (e.shiftKey) return;
      if (e.key.toLowerCase() !== 'z') return;
      const ta = textareaRef.current;
      if (document.activeElement !== ta) return;
      const op = undoLastCommentOp();
      if (!op) return; // empty; let the textarea's native undo run
      e.preventDefault();
      setUndoToast({
        message:
          op.kind === 'add'
            ? 'Comment removed'
            : op.kind === 'delete'
              ? 'Comment restored'
              : 'Comment edit undone',
        at: Date.now(),
      });
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [undoLastCommentOp]);

  // Auto-clear the undo toast after 4 seconds.
  useEffect(() => {
    if (!undoToast) return;
    const t = window.setTimeout(() => setUndoToast(null), 4000);
    return () => window.clearTimeout(t);
  }, [undoToast]);

  // Opens the floating composer anchored to the current text
  // selection. Strict: returns without opening when the selection
  // is empty. The toolbar button reflects this by disabling itself
  // when there is no selection.
  const openComposer = useCallback(() => {
    if (!doc) return false;
    const ta = textareaRef.current;
    if (!ta) return false;
    const start = ta.selectionStart ?? 0;
    const end = ta.selectionEnd ?? 0;
    if (start === end) return false;
    const mirror = mirrorRef.current;
    if (!mirror) return false;
    const rect = getSelectionRect(doc.content, mirror, start, end);
    if (!rect) return false;
    const local = toWrapperLocal(rect);
    if (!local) return false;
    setComposerPosition(local);
    setPendingSelection({ start, end });
    setComposerOpen(true);
    ta.focus({ preventScroll: true });
    return true;
  }, [doc, toWrapperLocal]);

  // Handler: save a brand-new comment.
  const handleSaveComment = useCallback(
    (body: string, mentions: MentionToken[]) => {
      if (!doc || !pendingSelection) return;
      const text = clampCommentBody(body);
      if (!text.trim()) return;
      const snippet = doc.content.slice(
        pendingSelection.start,
        pendingSelection.end
      );
      if (!snippet) return;
      const now = Date.now();
      // Seed round 1 of the new comment. The top-level
      // convenience fields mirror the latest round so existing
      // call-sites (margin badges, re-anchoring, batch format)
      // keep working unchanged.
      const comment: Comment = {
        id: uuid(),
        documentId: doc.id,
        start: pendingSelection.start,
        end: pendingSelection.end,
        snippet,
        body: text,
        createdAt: now,
        updatedAt: now,
        outdated: false,
        sent: false,
        rounds: [
          {
            id: uuid(),
            start: pendingSelection.start,
            end: pendingSelection.end,
            snippet,
            body: text,
            createdAt: now,
            updatedAt: now,
            outdated: false,
            sent: false,
            applied: [],
            // Persist the @-document references the user attached
            // to this round. Empty / undefined means "no mentions";
            // older comments without the field still serialize
            // cleanly because `mentions` is optional.
            ...(mentions.length > 0 ? { mentions } : {}),
          },
        ],
      };
      addComment(comment);
      setComposerOpen(false);
      setComposerPosition(null);
      setPendingSelection(null);
    },
    [doc, pendingSelection, addComment]
  );

  // Handler: open a comment in the popover (from margin badge or
  // popover-from-anchor). The popover is anchored to the margin
  // badge's y-offset so it doesn't overlap the editor.
  //
  // The popover renders `position: absolute` inside the
  // `data-cm-wrapper` div (the inner wrapper around the textarea +
  // mirror), so its `left` / `top` are in **wrapper-local** coords,
  // not viewport coords. We translate the badge's right edge from
  // viewport coords to wrapper-local here so the popover anchors to
  // the correct spot — without this translation, the popover would
  // be positioned `wrapperRect.left` pixels to the right of where it
  // should be (effectively outside the editor pane).
  const handleSelectComment = useCallback(
    (commentId: string) => {
      if (!doc) return;
      setActiveCommentId(commentId);
      const y = badgePositions[commentId];
      const pane = writePaneRef.current;
      if (typeof y !== 'number' || !pane) return;
      const paneRect = pane.getBoundingClientRect();
      const wrapper = pane.querySelector<HTMLElement>('[data-cm-wrapper]');
      const wrapperRect = wrapper?.getBoundingClientRect();
      // We anchor the popover to the badge's right edge. The badge
      // lives in the margin column (sibling of the wrapper); its
      // x is approximately `paneRect.right - 12` (a few px inside
      // the pane's right edge). The popover renders in the
      // wrapper's coord space, so we subtract `wrapperRect.left` to
      // translate the anchor into wrapper-local.
      const anchorViewportX = paneRect.right - 12;
      const anchorViewportY = y + paneRect.top - 16;
      setPopoverPosition({
        left: wrapperRect
          ? anchorViewportX - wrapperRect.left
          : anchorViewportX - paneRect.left,
        top: wrapperRect
          ? anchorViewportY - wrapperRect.top
          : anchorViewportY - paneRect.top,
      });
    },
    [doc, badgePositions]
  );

  // Handler: send the comments batch to the AI.
  const handleSendToAi = useCallback(() => {
    if (!doc) return;
    // Build the message body and dispatch via a custom event the
    // ChatPanel listens for. This keeps the editor / chat coupling
    // one-way (chat listens; editor dispatches) and avoids a direct
    // import of the chat's internals.
    const sendable = currentComments.filter((c) => !c.outdated);
    if (sendable.length === 0) return;
    // Gather @-document references attached to each comment's
    // latest round. Forwarded to the chat panel so the prompt can
    // include the referenced docs alongside the comment batch.
    // Attach the comment's id as `referrerId` on each mention so the
    // prompt builder can emit a per-comment
    // `[comment -> referenced docs]` cross-reference map. Existing
    // mentions without a reason get `'context'` for the same reason.
    const mentionsByCommentId: Record<string, MentionToken[]> = {};
    for (const c of sendable) {
      const last = c.rounds[c.rounds.length - 1];
      if (!last?.mentions || last.mentions.length === 0) continue;
      mentionsByCommentId[c.id] = last.mentions.map((m) => ({
        ...m,
        referrerId: m.referrerId ?? c.id,
        reason: m.reason ?? 'context',
      }));
    }
    window.dispatchEvent(
      new CustomEvent('mvp:send-comments', {
        detail: {
          commentIds: sendable.map((c) => c.id),
          mentionsByCommentId,
        },
      })
    );
  },
    [doc, currentComments]
  );

  // Close the popover / composer when clicking outside.
  useEffect(() => {
    if (!composerOpen && !activeCommentId) return;
    const handler = (e: MouseEvent | TouchEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      if (target.closest('.cm-composer')) return;
      if (target.closest('.cm-popover')) return;
      if (target.closest('.cm-margin__badge')) return;
      // Click on the textarea is fine — that just updates the
      // selection; the pill / popover close via their own logic.
      if (target.tagName === 'TEXTAREA') return;
      setComposerOpen(false);
      setActiveCommentId(null);
      setPopoverPosition(null);
    };
    // Use pointerdown for unified mouse + touch handling.
    const pointerHandler = (e: PointerEvent) => handler(e);
    window.addEventListener('pointerdown', pointerHandler);
    return () => window.removeEventListener('pointerdown', pointerHandler);
  }, [composerOpen, activeCommentId]);

  // Close the Format dropdown when clicking anywhere outside of it.
  useEffect(() => {
    if (!formatMenuOpen) return;
    const handler = (e: PointerEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      if (target.closest('[data-format-menu]')) return;
      setFormatMenuOpen(false);
    };
    window.addEventListener('pointerdown', handler);
    return () => window.removeEventListener('pointerdown', handler);
  }, [formatMenuOpen]);

  // Listen for `mvp:mark-comments-sent` events from the chat panel so
  // the editor can flip the comments to their `sent` state.
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ ids: string[] }>).detail;
      if (detail && Array.isArray(detail.ids)) {
        // The store's `markCommentsSent` is the single source of
        // truth; the chat panel calls it directly. We just listen
        // here so we can clear the active popover if the user sends
        // the comment that's currently open.
        if (activeCommentId && detail.ids.includes(activeCommentId)) {
          setActiveCommentId(null);
          setPopoverPosition(null);
        }
      }
    };
    window.addEventListener('mvp:mark-comments-sent', handler);
    return () => window.removeEventListener('mvp:mark-comments-sent', handler);
  }, [activeCommentId]);

  // Sorted comments for the margin (document order).
  const sortedComments = useMemo(
    () => [...currentComments].sort((a, b) => a.start - b.start),
    [currentComments]
  );

  // Active comment object (or null) for the popover.
  const activeComment = useMemo(
    () => currentComments.find((c) => c.id === activeCommentId) ?? null,
    [currentComments, activeCommentId]
  );

  // Inline-format helper. Wraps the current textarea selection (or
  // inserts a pair at the caret if there is no selection) with the
  // appropriate markdown / HTML marker, and unwraps if the selection
  // is already wrapped with that exact marker. Used by the toolbar
  // B/I/U buttons and the Ctrl/Cmd+B / I / U keyboard shortcuts.
  //
  //   Bold      → **...**   (markdown; rendered as <strong>)
  //   Italic    → *...*     (markdown; rendered as <em>)
  //   Underline → <u>...</u> (raw HTML passed through react-markdown)
  //
  // The caret / selection is restored on the next microtask so React
  // has a chance to apply the new value to the controlled textarea
  // before we re-set its selection range. Same pattern the OCR
  // insert event uses a few effects above.
  type WrapKind = 'bold' | 'italic' | 'underline';
  const wrapSelection = useCallback(
    (kind: WrapKind) => {
      const ta = textareaRef.current;
      if (!ta || !doc) return;
      const start = ta.selectionStart;
      const end = ta.selectionEnd;
      const value = doc.content;
      // Clamp the live textarea selection into the document. If the
      // doc content was changed under us (e.g. by an AI reply landing
      // mid-keystroke), selectionStart/End can briefly exceed the
      // string length; coerce to the current bounds so slice() is safe.
      const safeStart = Math.max(0, Math.min(start, value.length));
      const safeEnd = Math.max(0, Math.min(end, value.length));
      const before = value.slice(0, safeStart);
      const selected = value.slice(safeStart, safeEnd);
      const after = value.slice(safeEnd);
      const hasSelection = safeStart !== safeEnd;
      const open =
        kind === 'bold' ? '**' : kind === 'italic' ? '*' : '<u>';
      const close =
        kind === 'bold' ? '**' : kind === 'italic' ? '*' : '</u>';

      let next: string;
      let caretStart: number;
      let caretEnd: number;

      if (hasSelection) {
        // Context-aware toggle. The old check only fired when the
        // selection itself started/ended with the markers, which
        // failed the common case of "select just the inner text and
        // click the format to toggle it off". Now we look at the
        // document text immediately before/after the selection.
        //
        // We also disambiguate between ** and * (bold vs italic) so
        // that `**hello**` + click I correctly ADDS italic (instead
        // of incorrectly unwrapping one of the bold markers).
        let wrappedBy = false;
        let stripBefore = 0;
        let stripAfter = 0;
        if (kind === 'underline') {
          // `<u>` and `</u>` are unambiguous; no disambiguation needed.
          const beforeMarker = value.slice(
            Math.max(0, safeStart - open.length),
            safeStart
          );
          const afterMarker = value.slice(safeEnd, safeEnd + close.length);
          wrappedBy = beforeMarker === open && afterMarker === close;
          stripBefore = open.length;
          stripAfter = close.length;
        } else if (kind === 'bold') {
          // Bold open/close is `**` (two stars). It's a clean bold
          // wrap when the two stars before/after the selection are
          // NOT part of a longer `***` triple.
          const before2 = value.slice(
            Math.max(0, safeStart - 2),
            safeStart
          );
          const after2 = value.slice(safeEnd, safeEnd + 2);
          const charBefore2 = safeStart >= 2 ? value[safeStart - 3] : '';
          const charAfter2 =
            safeEnd + 2 < value.length ? value[safeEnd + 2] : '';
          wrappedBy =
            before2 === '**' &&
            after2 === '**' &&
            charBefore2 !== '*' &&
            charAfter2 !== '*';
          stripBefore = 2;
          stripAfter = 2;
        } else {
          // Italic open/close is `*` (one star). The single `*` is
          // an italic marker only when it's NOT part of a `**` bold
          // pair or a `***` bold-italic triple on either side.
          const before1 = safeStart >= 1 ? value[safeStart - 1] : '';
          const after1 = safeEnd < value.length ? value[safeEnd] : '';
          const charBefore1 = safeStart >= 2 ? value[safeStart - 2] : '';
          const charAfter1 =
            safeEnd + 1 < value.length ? value[safeEnd + 1] : '';
          wrappedBy =
            before1 === '*' &&
            after1 === '*' &&
            charBefore1 !== '*' &&
            charAfter1 !== '*';
          stripBefore = 1;
          stripAfter = 1;
        }
        if (wrappedBy) {
          // Markers are in the document text around the selection, so
          // the inner text IS the selected text. Drop stripBefore
          // chars from the end of `before` and stripAfter chars from
          // the start of `after`.
          next =
            before.slice(0, before.length - stripBefore) +
            selected +
            after.slice(stripAfter);
          caretStart = safeStart - stripBefore;
          caretEnd = caretStart + selected.length;
        } else {
          next = before + open + selected + close + after;
          caretStart = safeStart + open.length;
          caretEnd = caretStart + selected.length;
        }
      } else {
        // No selection: insert the pair and drop the caret between
        // them so the user can keep typing.
        next = before + open + close + after;
        caretStart = safeStart + open.length;
        caretEnd = caretStart;
      }

      updateContent(doc.id, next);
      // Restore the selection on the next microtask so React has
      // flushed the new value into the controlled textarea.
      // `preserveScroll: true` keeps the surrounding page from
      // jumping to top/bottom when the user clicks a toolbar button
      // (button briefly takes focus, then we re-focus the textarea;
      // without `preventScroll` the browser may scroll the page to
      // bring the newly-focused element into view).
      restoreCaret(textareaRef.current, caretStart, caretEnd, {
        preserveScroll: true,
      });
    },
    [doc, updateContent]
  );

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

  const isSplit = showWrite && showPreview;

  return (
    <div
      className="flex-1 flex flex-col min-w-0 bg-paper-base dark:bg-ape-base"
      // The editor's textarea and preview are governed by their own
      // explicit `font-size` (in px, via `editorFontSize`). The
      // toolbar's chrome uses literal `text-[Npx]` utilities which
      // already ignore `<html>` font-size. The only descendants still
      // scaled by `<html>` font-size are a few stray `text-xs` /
      // `text-sm` helpers (e.g. the inline-completion status pill),
      // so we set a stable 14px root here to keep those readable
      // regardless of the global UI font-size setting.
      style={{ fontSize: '14px' }}
    >
      <div className="flex flex-wrap items-center gap-2 px-4 py-2 border-b border-paper-hairline dark:border-cyber-border bg-paper-base dark:bg-ape-base text-[15px] leading-none">
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
        {/* Unified "Format" dropdown. Replaces the previous font-size
            (+ / −) pill and the B/I/U inline-formatting pill. The
            trigger is the same height/shape as the neighbouring
            toolbar controls (h-9, hairline border) and reveals a
            menu with all five actions. Each menu item closes the
            menu after invoking its action; clicks outside the menu
            (see the effect near the comment composer) also close it. */}
        <div
          ref={formatMenuRef}
          data-format-menu
          className="relative inline-block text-[15px] leading-none"
        >
          <button
            type="button"
            onClick={() => setFormatMenuOpen((v) => !v)}
            aria-haspopup="menu"
            aria-expanded={formatMenuOpen}
            aria-label="Format"
            title="Format — text formatting and font size"
            className="inline-flex items-center gap-1.5 h-9 px-3 rounded border border-paper-hairline dark:border-cyber-border bg-paper-surface dark:bg-ape-panel text-paper-inkSoft dark:text-cyber-muted hover:border-cyber-clay dark:hover:border-cyber-cyan hover:text-cyber-clay dark:hover:text-cyber-cyan transition-colors"
          >
            <span>Format</span>
            <svg
              aria-hidden="true"
              viewBox="0 0 10 10"
              className={`h-2.5 w-2.5 transition-transform ${
                formatMenuOpen ? 'rotate-180' : ''
              }`}
              fill="none"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M2 4 L5 7 L8 4" />
            </svg>
          </button>
          {formatMenuOpen && (
            <div
              role="menu"
              aria-label="Format menu"
              className="absolute left-0 top-full mt-1 min-w-[180px] rounded border border-paper-hairline dark:border-cyber-border bg-paper-surface dark:bg-ape-panel shadow-lg z-50 py-1"
            >
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  wrapSelection('bold');
                  setFormatMenuOpen(false);
                }}
                onMouseDown={(e) => e.preventDefault()}
                className="w-full text-left px-3 py-1.5 text-[15px] font-bold text-paper-ink dark:text-cyber-primary hover:bg-paper-elevated dark:hover:bg-ape-elevated hover:text-cyber-clay dark:hover:text-cyber-cyan transition-colors"
                aria-label="Bold"
                title="Bold — wraps the selection in **...** (Ctrl/Cmd+B)"
              >
                Bold
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  wrapSelection('italic');
                  setFormatMenuOpen(false);
                }}
                onMouseDown={(e) => e.preventDefault()}
                className="w-full text-left px-3 py-1.5 text-[15px] font-serif italic text-paper-ink dark:text-cyber-primary hover:bg-paper-elevated dark:hover:bg-ape-elevated hover:text-cyber-clay dark:hover:text-cyber-cyan transition-colors"
                aria-label="Italic"
                title="Italic — wraps the selection in *...* (Ctrl/Cmd+I)"
              >
                Italic
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  wrapSelection('underline');
                  setFormatMenuOpen(false);
                }}
                onMouseDown={(e) => e.preventDefault()}
                className="w-full text-left px-3 py-1.5 text-[15px] underline underline-offset-2 text-paper-ink dark:text-cyber-primary hover:bg-paper-elevated dark:hover:bg-ape-elevated hover:text-cyber-clay dark:hover:text-cyber-cyan transition-colors"
                aria-label="Underline"
                title="Underline — wraps the selection in <u>...</u> (Ctrl/Cmd+U)"
              >
                Underline
              </button>
              <div
                className="my-1 border-t border-paper-hairline dark:border-cyber-border"
                aria-hidden
              />
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  bumpEditorFontSize(1);
                  setFormatMenuOpen(false);
                }}
                onMouseDown={(e) => e.preventDefault()}
                disabled={editorFontSize >= 24}
                className="w-full text-left px-3 py-1.5 text-[15px] text-paper-ink dark:text-cyber-primary hover:bg-paper-elevated dark:hover:bg-ape-elevated hover:text-cyber-clay dark:hover:text-cyber-cyan transition-colors disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-paper-ink dark:disabled:hover:text-cyber-primary"
                aria-label="Size +"
                title="Increase font size"
              >
                Size +
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  bumpEditorFontSize(-1);
                  setFormatMenuOpen(false);
                }}
                onMouseDown={(e) => e.preventDefault()}
                disabled={editorFontSize <= 10}
                className="w-full text-left px-3 py-1.5 text-[15px] text-paper-ink dark:text-cyber-primary hover:bg-paper-elevated dark:hover:bg-ape-elevated hover:text-cyber-clay dark:hover:text-cyber-cyan transition-colors disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-paper-ink dark:disabled:hover:text-cyber-primary"
                aria-label="Size −"
                title="Decrease font size"
              >
                Size −
              </button>
            </div>
          )}
        </div>
        {/* Add comment for the current text selection. Icon-only;
            onMouseDown preventDefault keeps the textarea selection
            from collapsing before the click handler reads it. */}
        <button
          type="button"
          className="w-9 h-9 inline-flex items-center justify-center rounded border border-paper-hairline dark:border-cyber-border bg-paper-surface dark:bg-ape-panel text-paper-inkSoft dark:text-cyber-muted hover:border-cyber-clay dark:hover:border-cyber-cyan hover:text-cyber-clay dark:hover:text-cyber-cyan disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:border-paper-hairline disabled:hover:text-paper-inkSoft dark:disabled:hover:border-cyber-border dark:disabled:hover:text-cyber-muted transition-colors"
          onClick={() => openComposer()}
          onMouseDown={(e) => e.preventDefault()}
          disabled={!hasSelection}
          aria-label="Comment"
          title="Comment — add a comment to the selected text"
        >
          <svg
            aria-hidden="true"
            viewBox="0 0 12 12"
            className="h-3.5 w-3.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            {/* Speech bubble glyph with a small + inside. */}
            <path d="M2 2.5 h7 a1 1 0 0 1 1 1 v4 a1 1 0 0 1 -1 1 h-3 l-2 2 v-2 h-2 a1 1 0 0 1 -1 -1 v-4 a1 1 0 0 1 1 -1 z" />
            <path d="M6 4.2 v2.4 M4.8 5.4 h2.4" />
          </svg>
        </button>
        {/* Inline-completion status pill. Gated by `debugMode`; the
            state machine that drives the pill keeps running
            regardless (see `debugMode` in useStore.ts). */}
        {debugMode && (
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
        )}
        {/* Inline-completion counters (requested / accepted). Gated
            by `debugMode`; click to reset. */}
        {debugMode && (
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
        )}
        {/* Unified Predict button — replaces the previous On/Off rocker.
            The button's COLOUR is now the state indicator:
              • GREEN (brand clay/cyan) ⇒ inline prediction ON
              • VERY LIGHT GREY ⇒ inline prediction OFF
            Click toggles. Going OFF→ON also fires a single immediate
            prediction (delightful "starter suggestion"); going ON→OFF
            cancels any in-flight stream + drops the ghost. Same
            ⌘/Ctrl + \ keyboard shortcut still works. */}
        <button
          type="button"
          onClick={() => {
            toggleInlinePredict();
          }}
          onMouseDown={(e) => e.preventDefault()}
          disabled={!apiConfigured}
          aria-pressed={inlineOn}
          aria-label={`Predict ${inlineOn ? 'on' : 'off'}. Click to ${inlineOn ? 'turn off' : 'turn on'}.`}
          title={
            !apiConfigured
              ? !requiresApiKey(api.provider)
                ? 'Inline prediction needs an API key. Use Google AI Mode for full chat replies.'
                : 'Configure an API key in Settings to enable prediction'
              : inlineOn
                ? 'Click to stop inline predictions'
                : 'Click to start inline predictions'
          }
          className={[
            // Same type scale as the Comment control (text-[15px], no
            // mono / uppercase) so Predict sits in the same visual
            // family as the rest of the editor toolbar.
            'inline-flex items-center gap-1.5 h-9 px-3 rounded border text-[15px] leading-none transition-colors select-none',
            !apiConfigured
              ? 'border-paper-hairline dark:border-cyber-border bg-paper-surface/40 dark:bg-ape-panel/40 text-paper-inkSoft/40 dark:text-cyber-muted/40 cursor-not-allowed'
              : inlineOn
                // GREEN: brand colour fills the pill. Reads as "active"
                // immediately. Matches the codebase's existing accent
                // palette, so the active Predict button visually links
                // to the cyan/clay accents elsewhere in the toolbar.
                ? 'border-cyber-clay dark:border-cyber-cyan bg-cyber-clay/85 dark:bg-cyber-cyan/85 text-paper-base dark:text-ape-base shadow-[0_0_6px_var(--cyber-clay-glow,rgba(232,93,59,0.45))] dark:shadow-[0_0_8px_var(--cyber-cyan-glow,rgba(0,229,255,0.55))] hover:bg-cyber-clay dark:hover:bg-cyber-cyan cursor-pointer'
                // VERY LIGHT GREY: pale outline + soft text. Clearly
                // inactive but still discoverable in the toolbar.
                : 'border-paper-hairline dark:border-cyber-border bg-paper-surface/30 dark:bg-ape-panel/30 text-paper-inkSoft/55 dark:text-cyber-muted/55 hover:border-cyber-clay/40 dark:hover:border-cyber-cyan/40 hover:text-cyber-clay dark:hover:text-cyber-cyan cursor-pointer',
          ].join(' ')}
        >
          <svg
            aria-hidden="true"
            viewBox="0 0 12 12"
            className="h-3.5 w-3.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            {/* Sparkle glyph: two stacked four-point stars. */}
            <path d="M6 1 L6.6 4.4 L10 5 L6.6 5.6 L6 9 L5.4 5.6 L2 5 L5.4 4.4 Z" />
            <path d="M10 8.5 L10.25 9.75 L11.5 10 L10.25 10.25 L10 11.5 L9.75 10.25 L8.5 10 L9.75 9.75 Z" />
          </svg>
          Predict
        </button>
        {/* Spacer pushes Import / Save to the trailing edge without
            forcing a full-row wrap (`basis-full` used to drop them
            onto a second line). All toolbar controls stay on one
            horizontal band when width allows. */}
        <div className="flex-1 min-w-2" aria-hidden />
        <div className="inline-flex items-center gap-2 shrink-0">
          <ImportMediaButton />
          <button
            type="button"
            aria-label="Save current content as a revision"
            className="btn-icon-square"
            onClick={() => saveRevision(doc.id)}
            title="Save current content as a revision"
          >
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
              {/* Classic floppy-disk icon. Reads as "save" across
                  platforms and keeps the toolbar compact. */}
              <path d="M3 3 L11 3 L13 5 L13 13 L3 13 Z" />
              <path d="M5 3 L5 6 L10 6 L10 3" />
              <path d="M5 9 L11 9 L11 12 L5 12 Z" />
            </svg>
          </button>
        </div>
      </div>
      <div className="px-4 pt-3 pb-1 flex flex-wrap items-baseline gap-x-3 gap-y-1 bg-paper-base dark:bg-ape-base">
        <h2 className="font-semibold text-paper-ink dark:text-cyber-primary truncate text-base min-w-0">
          {doc.title}
        </h2>
        <span
          data-saved-label
          className="text-xs text-paper-inkSoft dark:text-cyber-muted font-mono uppercase tracking-wider whitespace-nowrap"
        >
          {savedLabel}
        </span>
      </div>
      <div ref={splitRowRef} className="flex-1 flex min-h-0">
        {showWrite && (
          <div
            ref={writePaneRef}
            className={`relative min-w-0 flex flex-col ${
              isSplit
                ? 'border-r border-paper-hairline dark:border-cyber-border'
                : 'flex-1'
            }`}
            style={
              isSplit
                ? {
                    flex: `0 0 ${editorSplitPct}%`,
                    maxWidth: `${MAX_EDITOR_SPLIT_PCT}%`,
                    minWidth: `${MIN_EDITOR_SPLIT_PCT}%`,
                  }
                : undefined
            }
          >
            <div className="flex-1 flex min-h-0 relative">
              {/* Textarea + mirror overlay. The mirror sits *behind*
                  the textarea so the highlights paint under the user's
                  text. The mirror and the textarea share identical
                  font / padding / wrap settings (see `.cm-mirror` /
                  `.comment-textarea` in src/index.css). */}
              <div
                className="relative flex-1 min-w-0 flex flex-col"
                data-cm-wrapper
                style={{
                  fontSize: `${editorFontSize}px`,
                  lineHeight: 1.55,
                  // `isolation: isolate` forces this wrapper to
                  // establish its own stacking context, so the
                  // composer's / popover's `z-index: 50` paints
                  // above the mirror + textarea (and the tray
                  // below) rather than competing with z-indices
                  // set elsewhere in the editor toolbar.
                  isolation: 'isolate',
                }}
              >
                {doc && (
                  <CommentLayer
                    ref={mirrorRef}
                    content={doc.content}
                    comments={sortedComments}
                  />
                )}
                <textarea
                  ref={textareaRef}
              value={doc.content}
              onChange={(e) => {
                updateContent(doc.id, e.target.value);
                if (inlineEnabled) inline.onTextChange(e.target.value);
              }}
              onKeyDown={(e) => {
                // Ctrl/Cmd + B / I / U → inline-format the selection.
                // Checked before the inline-completion handler so the
                // shortcut wins over any ghost the model may have on
                // screen. preventDefault stops the browser from also
                // firing its own B / I / U bindings (Firefox in
                // particular maps Ctrl+U to view-source).
                if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey) {
                  const k = e.key.toLowerCase();
                  if (k === 'b') {
                    e.preventDefault();
                    wrapSelection('bold');
                    return;
                  }
                  if (k === 'i') {
                    e.preventDefault();
                    wrapSelection('italic');
                    return;
                  }
                  if (k === 'u') {
                    e.preventDefault();
                    wrapSelection('underline');
                    return;
                  }
                }
                if (inlineEnabled) inline.onKeyDown(e);
              }}
              onFocus={() => reportCaret(true)}
              onBlur={() => {
                reportCaret(false);
                if (inlineEnabled) inline.onBlur();
              }}
              onSelect={() => reportCaret(true)}
              onKeyUp={() => reportCaret(true)}
              onMouseUp={() => reportCaret(true)}
              onClick={() => reportCaret(true)}
              style={{ fontSize: `${editorFontSize}px`, lineHeight: 1.55 }}
              className="comment-textarea flex-1 outline-none resize-none bg-paper-base dark:bg-ape-base text-paper-ink dark:text-cyber-primary caret-cyber-clay dark:caret-cyber-cyan placeholder:text-paper-inkSoft/60 dark:placeholder:text-cyber-muted/60"
              placeholder="Start writing in Markdown…"
              spellCheck={false}
                />
                {/* Floating composer — anchored to the selection. */}
                {composerOpen && pendingSelection && composerPosition && (
                  <CommentComposer
                    position={composerPosition}
                    containerBounds={paneBounds}
                    onSave={handleSaveComment}
                    onCancel={() => {
                      setComposerOpen(false);
                      setComposerPosition(null);
                      setPendingSelection(null);
                    }}
                  />
                )}
                {/* Popover for the active comment. Anchored to the
                    margin column's right edge at the comment's first-
                    line y-offset. */}
                {activeComment && popoverPosition && (
                  <CommentPopover
                    comment={activeComment}
                    index={
                      sortedComments.findIndex(
                        (c) => c.id === activeComment.id
                      ) + 1
                    }
                    position={popoverPosition}
                    containerBounds={paneBounds}
                    onSaveBody={(id, body, mentions) =>
                      updateCommentBody(id, body, mentions)
                    }
                    onDelete={(id) => deleteComment(id)}
                    onClose={() => {
                      setActiveCommentId(null);
                      setPopoverPosition(null);
                    }}
                  />
                )}
              </div>
              {/* Right-margin column. Renders one numbered badge per
                  comment, positioned by `badgePositions`. On `< sm`
                  viewports the CSS switches this to a horizontal
                  chip lane. */}
              <CommentMargin
                comments={sortedComments}
                badgePositions={badgePositions}
                onSelect={handleSelectComment}
              />
            </div>
            {/* Comment tray (sticky bar). Visible only when the doc
                has ≥ 1 comment. The Send button dispatches a
                `mvp:send-comments` event the ChatPanel handles. */}
            {currentComments.length > 0 && (
              <CommentTray
                count={currentComments.length}
                outdatedCount={
                  currentComments.filter((c) => c.outdated).length
                }
                sending={chatStreaming}
                onSend={handleSendToAi}
              />
            )}
            {/* Undo toast. Auto-clears after 4s; click to manually
                dismiss. */}
            {undoToast && (
              <div
                className="cm-undo-toast"
                role="status"
                aria-live="polite"
                onClick={() => setUndoToast(null)}
              >
                <span>{undoToast.message}</span>
                {commentUndoDepth > 0 && (
                  <button
                    type="button"
                    className="cm-undo-toast__btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      const op = undoLastCommentOp();
                      if (op) {
                        setUndoToast({
                          message:
                            op.kind === 'add'
                              ? 'Comment removed'
                              : op.kind === 'delete'
                                ? 'Comment restored'
                                : 'Comment edit undone',
                          at: Date.now(),
                        });
                      }
                    }}
                  >
                    Undo
                  </button>
                )}
              </div>
            )}
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
                className="relative flex flex-col border-t border-paper-hairline dark:border-cyber-border bg-paper-elevated/60 dark:bg-ape-elevated/60"
                style={{ height: `${suggestionHeight}px`, maxHeight: '60%' }}
                data-suggestion-panel-height={suggestionHeight}
              >
                {/* Resize handle on the top edge. Drag up to enlarge,
                    drag down to shrink. Capped at 60% of the write pane
                    height so the textarea always stays usable. */}
                <div
                  role="separator"
                  aria-orientation="horizontal"
                  aria-label="Resize suggestion panel"
                  aria-valuenow={suggestionHeight}
                  aria-valuemin={80}
                  aria-valuemax={600}
                  onPointerDown={onSuggestionHandleDown}
                  className="absolute -top-1 left-0 right-0 h-2 cursor-ns-resize z-10 flex items-center justify-center group"
                  data-suggestion-handle
                >
                  <span
                    aria-hidden
                    className="block w-12 h-1 rounded-full bg-paper-hairline dark:bg-cyber-border group-hover:bg-cyber-clay/60 dark:group-hover:bg-cyber-cyan/60 transition-colors"
                  />
                </div>
                <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-4 pt-2 pb-1 text-[10px] font-mono uppercase tracking-wider text-paper-inkSoft dark:text-cyber-muted select-none">
                  <span>Suggestion · Tab to accept · Esc to dismiss</span>
                  {/* Action row: Reject + Accept sit side-by-side at the
                      end of the panel header. Both use the same
                      onMouseDown + preventDefault guard as the original
                      Accept button so the textarea does not blur before
                      the click handler runs. */}
                  <div className="inline-flex items-center gap-1.5">
                    {/* Reject button. Mirrors the keyboard Esc behavior:
                        clears the ghost + aborts any in-flight stream +
                        hides the bottom panel. Active whenever the panel
                        is on screen (i.e. there is either a streaming
                        request or a ghost ready to be accepted),
                        because dismissing while streaming is useful too
                        — the user can stop a slow request they no longer
                        want. Equivalent to pressing Esc. */}
                    <button
                      type="button"
                      onClick={inline.reject}
                      onMouseDown={(e) => e.preventDefault()}
                      aria-label="Reject inline completion"
                      title="Reject the suggestion (Esc)"
                      className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded border text-sm font-mono uppercase tracking-wider transition-colors border-paper-hairline dark:border-cyber-border bg-paper-surface/60 dark:bg-ape-panel/60 text-paper-inkSoft dark:text-cyber-muted hover:border-cyber-brick/60 dark:hover:border-cyber-brickBright/60 hover:text-cyber-brick dark:hover:text-cyber-brickBright hover:bg-cyber-brickSoft dark:hover:bg-cyber-brickSoftDark cursor-pointer"
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
                        <path d="M3 3 L9 9 M9 3 L3 9" />
                      </svg>
                      Reject
                    </button>
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
            {isSplit && (
              <ResizeHandle
                handle="right"
                onPointerDown={(e) => beginSplitResize('right', e)}
              />
            )}
          </div>
        )}
        {showPreview && (
          <div
              className="flex-1 min-w-0 overflow-y-auto p-4 prose-md bg-paper-base dark:bg-ape-base"
              style={{ fontSize: `${editorFontSize}px`, lineHeight: 1.55 }}
            >
            <ReactMarkdown
              remarkPlugins={remarkPlugins}
              rehypePlugins={rehypePlugins}
            >
              {doc.content || '*Nothing to preview yet.*'}
            </ReactMarkdown>
          </div>
        )}
      </div>
    </div>
  );
}
