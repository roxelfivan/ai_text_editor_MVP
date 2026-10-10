import { useEffect, useMemo, useRef, useState } from 'react';
import { v4 as uuid } from 'uuid';
import ReactMarkdown from 'react-markdown';
import { useStore } from '@/store/useStore';
import { buildRequestMessages, streamChatCompletion, ApiError } from '@/api/chat';
import type { ChatMessage, ProposedEdit } from '@/types';
import { ProposedEditCard } from '@/components/ProposedEditCard';
import { ResizeHandle } from '@/components/ResizeHandle';
import { useDragResize, clamp, MIN_CHAT_WIDTH, MAX_CHAT_WIDTH } from '@/hooks/useDragResize';
import { parseProposedEdits, formatRejectionBatch, applyAllEdits } from '@/utils/proposedEdit';
import { remarkPlugins, rehypePlugins } from '@/utils/markdown';

// Maximum fraction of the viewport width the chat panel is allowed to
// occupy. The static MAX_CHAT_WIDTH is still used as a floor so the panel
// can grow on wider displays without losing the old 720px default ceiling.
const MAX_CHAT_FRACTION = 2 / 3;
const computeMaxChatWidth = () =>
  Math.max(MAX_CHAT_WIDTH, Math.floor(window.innerWidth * MAX_CHAT_FRACTION));

// Clamp the persisted chat width on read so a stale localStorage entry
// (e.g. values written before bounds existed) cannot push the panel off-screen.
const useChatWidth = () => {
  const raw = useStore((s) => s.layout.chatWidth);
  return clamp(raw, MIN_CHAT_WIDTH, computeMaxChatWidth());
};

export function ChatPanel() {
  const chatOpen = useStore((s) => s.chatOpen);
  const setChatOpen = useStore((s) => s.setChatOpen);
  const chatCollapsed = useStore((s) => s.chatCollapsed);
  const currentDocumentId = useStore((s) => s.currentDocumentId);
  const chats = useStore((s) => s.chats);
  const appendMessage = useStore((s) => s.appendMessage);
  const updateLastAssistant = useStore((s) => s.updateLastAssistant);
  const clearChat = useStore((s) => s.clearChat);
  const api = useStore((s) => s.api);
  const includeSelection = useStore((s) => s.includeSelection);
  const setIncludeSelection = useStore((s) => s.setIncludeSelection);

  const [input, setInput] = useState('');
  const [selection, setSelection] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Per-assistant-message staged rejection comments. Keyed by the
  // assistant message id so multiple in-flight replies can each have their
  // own batch. Value entries are the (editId, comment) pairs the user has
  // queued via "Reject with feedback"; a card flips to its staged outline
  // when its entry is present.
  const [stagedRejections, setStagedRejections] = useState<
    Record<string, Array<{ editId: string; comment: string }>>
  >({});
  // After a staged-rejection batch is committed, the matching cards need
  // to disappear without a re-render flash. We flip them into a
  // "committed" set keyed by editId so the card hides itself immediately.
  const [committedRejections, setCommittedRejections] = useState<
    Record<string, Record<string, true>>
  >({});
  // Per-message "Apply All" summary, shown briefly in the message footer
  // after a bulk apply finishes. Keyed by assistant message id. The
  // `at` timestamp is used by a per-message useEffect to clear the entry
  // after a short delay so it fades out on its own.
  const [applyAllSummary, setApplyAllSummary] = useState<
    Record<string, { applied: number; total: number; at: number }>
  >({});
  const abortRef = useRef<AbortController | null>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const chatWidth = useChatWidth();
  const setLayout = useStore((s) => s.setLayout);
  const containerRef = useRef<HTMLDivElement>(null);

  const messages: ChatMessage[] = currentDocumentId
    ? chats[currentDocumentId] ?? []
    : [];

  // Listen for selection events from the editor, fill-chat from PromptLibrary,
  // and window resize to re-clamp the chat width against the 2/3 viewport cap.
  useEffect(() => {
    const onSel = (e: Event) => {
      const detail = (e as CustomEvent<{ text: string }>).detail;
      setSelection(detail?.text ?? '');
    };
    const onFill = (e: Event) => {
      const body = (e as CustomEvent<string>).detail;
      if (typeof body === 'string') {
        setInput((prev) => (prev.trim() ? `${prev}\n\n${body}` : body));
      }
    };
    const onResize = () => {
      const max = computeMaxChatWidth();
      const raw = useStore.getState().layout.chatWidth;
      if (raw > max) {
        setLayout({ chatWidth: clamp(raw, MIN_CHAT_WIDTH, max) });
      }
    };
    window.addEventListener('mvp:editor-selection', onSel);
    window.addEventListener('mvp:fill-chat', onFill);
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('mvp:editor-selection', onSel);
      window.removeEventListener('mvp:fill-chat', onFill);
      window.removeEventListener('resize', onResize);
    };
  }, [setLayout]);

  // Auto-scroll to bottom on new messages / streaming.
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages, streaming]);

  // The chat's left edge handle: dragging it rightward (toward the chat)
  // shrinks the chat; leftward widens it. The panel's right edge is
  // positioned at the mouse X (clamped to [MIN, dynamic MAX]) so the handle
  // and cursor stay aligned. The upper bound is recomputed per drag tick so
  // it tracks the current viewport (up to 2/3 of the window).
  const { start } = useDragResize({
    mode: 'axis',
    axis: 'horizontal',
    onDelta: ({ absX }) => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const next = clamp(
        rect.right - absX,
        MIN_CHAT_WIDTH,
        computeMaxChatWidth()
      );
      setLayout({ chatWidth: next });
    },
  });

  if (!chatOpen || chatCollapsed) {
    // When the panel is closed (topbar Chat toggle) or explicitly
    // collapsed (edge-anchor), render nothing. The edge-anchor button
    // rendered by App.tsx is responsible for bringing it back. We
    // deliberately do not render the old top-right "Chat" floating
    // button — it would clash with the edge-anchor strip.
    return null;
  }

  const handleSend = async () => {
    if (!currentDocumentId) return;
    const text = input.trim();
    if (!text || streaming) return;
    setError(null);
    setInput('');

    const docSnap = useStore.getState().documents.find(
      (d) => d.id === currentDocumentId
    );

    const userMsg: ChatMessage = {
      id: uuid(),
      role: 'user',
      content: text,
      selection: includeSelection ? selection || undefined : undefined,
      createdAt: Date.now(),
    };
    const assistantMsg: ChatMessage = {
      id: uuid(),
      role: 'assistant',
      content: '',
      createdAt: Date.now(),
    };
    appendMessage(currentDocumentId, userMsg);
    appendMessage(currentDocumentId, assistantMsg);

    const history = [...messages, userMsg, assistantMsg];
    setStreaming(true);
    abortRef.current = new AbortController();
    let acc = '';
    try {
      await streamChatCompletion(
        buildRequestMessages(history, api.systemMessage, docSnap ? { title: docSnap.title, content: docSnap.content } : null),
        api,
        {
          signal: abortRef.current.signal,
          onDelta: (delta) => {
            acc += delta;
            updateLastAssistant(currentDocumentId, acc);
          },
        }
      );
    } catch (e) {
      if ((e as Error).name === 'AbortError') {
        // user cancelled
      } else if (e instanceof ApiError) {
        setError(e.message);
      } else {
        setError((e as Error).message || 'Unknown error');
      }
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }
  };

  const handleStop = () => {
    abortRef.current?.abort();
  };

  const handleSendSelection = () => {
    if (!selection) return;
    setInput((prev) => (prev ? `${prev}\n\n${selection}` : selection));
  };

  // Stage a rejection-with-feedback for a given assistant message. If the
  // same (editId, comment) pair is already staged (e.g. the user double-
  // clicked the button) we keep just one entry.
  const stageReject = (
    messageId: string,
    info: { editId: string; comment: string }
  ) => {
    const trimmed = info.comment.trim();
    if (!trimmed) return;
    setStagedRejections((prev) => {
      const existing = prev[messageId] ?? [];
      const dup = existing.some(
        (e) => e.editId === info.editId && e.comment === trimmed
      );
      if (dup) return prev;
      return { ...prev, [messageId]: [...existing, { editId: info.editId, comment: trimmed }] };
    });
  };

  // Send all staged rejections for a message as a single user turn, then
  // drop the staged entries. Cards react to the cleared staged map and
  // commit themselves out of view (the parent flips their status).
  const commitStagedRejections = (messageId: string) => {
    const items = stagedRejections[messageId] ?? [];
    if (!items.length || !currentDocumentId) return;
    const body = formatRejectionBatch(items);
    if (!body) {
      setStagedRejections((prev) => {
        const next = { ...prev };
        delete next[messageId];
        return next;
      });
      return;
    }
    const userMsg: ChatMessage = {
      id: uuid(),
      role: 'user',
      content: body,
      createdAt: Date.now(),
    };
    appendMessage(currentDocumentId, userMsg);
    // Mark the affected edit ids as committed so the corresponding cards
    // hide themselves immediately (the staged map is also cleared below,
    // but a card that already flipped to `committed` returns null first
    // and avoids a one-frame "staged → present → gone" flicker).
    setCommittedRejections((prev) => {
      const existing = prev[messageId] ?? {};
      const added: Record<string, true> = {};
      for (const it of items) added[it.editId] = true;
      return { ...prev, [messageId]: { ...existing, ...added } };
    });
    setStagedRejections((prev) => {
      const next = { ...prev };
      delete next[messageId];
      return next;
    });
    // Trigger an AI response by feeding the message we just appended
    // through the existing send pipeline. The simplest path is to ask the
    // store for the updated messages and run the same flow as handleSend
    // (minus the textarea). We replicate the stream setup here rather
    // than reshare code, since handleSend is tied to the local `input`
    // state.
    void runAssistantReplyAfterCommit(userMsg);
  };

  const clearStagedRejections = (messageId: string) => {
    setStagedRejections((prev) => {
      if (!prev[messageId]) return prev;
      const next = { ...prev };
      delete next[messageId];
      return next;
    });
  };

  // Bulk-apply every anchorable ProposedEdit in an assistant message in
  // one document update. Skips edits whose `original` is not found in
  // the current document — those keep their "Potential mismatch
  // detected" banner and the user can still use Force-apply manually.
  const applyAllForMessage = (messageId: string) => {
    // Doc-switch safety: re-read the current doc id at click time so a
    // stale closure can't write to the wrong document.
    const liveDocId = useStore.getState().currentDocumentId;
    if (!liveDocId) return;
    const doc = useStore.getState().documents.find((d) => d.id === liveDocId);
    if (!doc) return;
    const msg = (useStore.getState().chats[liveDocId] ?? []).find(
      (m) => m.id === messageId && m.role === 'assistant'
    );
    if (!msg) return;
    const segments = parseProposedEdits(msg.content);
    const edits: ProposedEdit[] = [];
    for (const seg of segments) {
      if (seg.kind === 'edit') edits.push(seg.payload);
    }
    if (edits.length === 0) return;
    const { next, appliedIds } = applyAllEdits(doc.content, edits);
    if (appliedIds.length === 0) return;
    useStore.getState().updateDocumentContent(doc.id, next);
    // Mark applied ids as committed so the cards hide without flicker,
    // mirroring the existing staged-rejection commit pattern.
    setCommittedRejections((prev) => {
      const existing = prev[messageId] ?? {};
      const added: Record<string, true> = {};
      for (const id of appliedIds) added[id] = true;
      return { ...prev, [messageId]: { ...existing, ...added } };
    });
    setApplyAllSummary((prev) => ({
      ...prev,
      [messageId]: {
        applied: appliedIds.length,
        total: edits.length,
        at: Date.now(),
      },
    }));
  };

  const clearApplyAllSummary = (messageId: string) => {
    setApplyAllSummary((prev) => {
      if (!prev[messageId]) return prev;
      const next = { ...prev };
      delete next[messageId];
      return next;
    });
  };

  // Stream a follow-up assistant reply after the user has submitted their
  // batched rejection comments. Mirrors the streaming logic in handleSend
  // but is keyed off an already-appended user message instead of the
  // textarea contents. Returns when the stream ends; errors are surfaced via
  // the same `error` state.
  const runAssistantReplyAfterCommit = async (userMsg: ChatMessage) => {
    if (!currentDocumentId) return;
    const docSnap = useStore.getState().documents.find(
      (d) => d.id === currentDocumentId
    );
    const historyFromStore = useStore.getState().chats[currentDocumentId] ?? [];
    const assistantMsg: ChatMessage = {
      id: uuid(),
      role: 'assistant',
      content: '',
      createdAt: Date.now(),
    };
    appendMessage(currentDocumentId, assistantMsg);
    const history = [...historyFromStore, userMsg, assistantMsg];
    setStreaming(true);
    setError(null);
    abortRef.current = new AbortController();
    let acc = '';
    try {
      await streamChatCompletion(
        buildRequestMessages(history, api.systemMessage, docSnap ? { title: docSnap.title, content: docSnap.content } : null),
        api,
        {
          signal: abortRef.current.signal,
          onDelta: (delta) => {
            acc += delta;
            updateLastAssistant(currentDocumentId, acc);
          },
        }
      );
    } catch (e) {
      if ((e as Error).name === 'AbortError') {
        // user cancelled
      } else if (e instanceof ApiError) {
        setError(e.message);
      } else {
        setError((e as Error).message || 'Unknown error');
      }
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }
  };

  return (
    <div ref={containerRef} className="relative shrink-0" style={{ width: chatWidth }}>
      <ResizeHandle handle="left" onPointerDown={(e) => start('left', e)} />
      <aside
        className="h-full border-l border-paper-hairline dark:border-cyber-border flex flex-col bg-paper-panel dark:bg-ape-panel"
        style={{ width: '100%' }}
      >
      <div className="px-3 py-2 border-b border-paper-hairline dark:border-cyber-border flex items-center gap-2 bg-paper-elevated/50 dark:bg-ape-elevated/40">
        <span className="text-[15px] font-medium text-paper-ink dark:text-cyber-primary">
          Chat
        </span>
        <span className="text-xs text-paper-inkSoft dark:text-cyber-muted font-mono truncate">{api.model}</span>
        <div className="flex-1" />
        <button
          className="text-xs text-paper-inkSoft dark:text-cyber-muted hover:text-cyber-danger transition-colors"
          onClick={() => currentDocumentId && clearChat(currentDocumentId)}
          disabled={!messages.length}
        >
          Clear
        </button>
        <button
          className="text-paper-inkSoft dark:text-cyber-muted hover:text-cyber-clay dark:hover:text-cyber-cyan transition-colors"
          onClick={() => setChatOpen(false)}
          title="Close chat"
        >
          ×
        </button>
      </div>

      <div ref={scrollerRef} className="flex-1 overflow-y-auto p-3 space-y-3 bg-paper-base dark:bg-ape-base">
        {!messages.length && (
          <p className="text-sm text-paper-inkSoft dark:text-cyber-muted">
            Ask anything, or highlight text in the editor and send a prompt from
            the library.
          </p>
        )}
        {messages.map((m) => (
          <MessageBubble
            key={m.id}
            message={m}
            staged={stagedRejections[m.id] ?? []}
            committed={committedRejections[m.id] ?? {}}
            onStageReject={(info) => stageReject(m.id, info)}
            onCommit={() => commitStagedRejections(m.id)}
            onClearStaged={() => clearStagedRejections(m.id)}
            onApplyAll={() => applyAllForMessage(m.id)}
            applyAllSummary={applyAllSummary[m.id] ?? null}
            onClearApplyAllSummary={() => clearApplyAllSummary(m.id)}
          />
        ))}
        {error && (
          <div className="text-xs text-cyber-danger bg-cyber-danger/10 border border-cyber-danger/40 rounded p-2 whitespace-pre-wrap">
            {error}
          </div>
        )}
      </div>

      <div className="border-t border-paper-hairline dark:border-cyber-border p-3 space-y-2 bg-paper-panel dark:bg-ape-panel">
        <div className="flex items-center gap-2 text-xs text-paper-inkSoft dark:text-cyber-muted">
          <label className="flex items-center gap-1 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={includeSelection}
              onChange={(e) => setIncludeSelection(e.target.checked)}
              className="accent-cyber-clay dark:accent-cyber-cyan"
            />
            include selection
          </label>
          {selection && (
            <button
              className="px-1.5 py-0.5 rounded border border-cyber-clay/40 dark:border-cyber-cyan/40 text-cyber-clay dark:text-cyber-cyan hover:bg-cyber-clay/5 dark:hover:bg-cyber-cyan/10 transition-colors"
              onClick={handleSendSelection}
              title="Paste the selection into the input"
            >
              paste selection ({selection.length})
            </button>
          )}
        </div>
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              void handleSend();
            }
          }}
          placeholder="Ask, or ⌘/Ctrl+Enter to send…"
          className="w-full h-24 p-2 text-sm ape-field resize-none font-sans"
        />
        <div className="flex justify-end gap-2">
          {streaming ? (
            <button
              className="text-sm px-3 py-1.5 rounded bg-cyber-danger text-white font-semibold hover:bg-cyber-danger/80 transition-colors"
              onClick={handleStop}
            >
              Stop
            </button>
          ) : (
            <button
              className="btn-fire"
              onClick={handleSend}
              disabled={!input.trim() || !currentDocumentId}
            >
              Send
            </button>
          )}
        </div>
      </div>
      </aside>
    </div>
  );
}

function MessageBubble({
  message,
  staged,
  committed,
  onStageReject,
  onCommit,
  onClearStaged,
  onApplyAll,
  applyAllSummary,
  onClearApplyAllSummary,
}: {
  message: ChatMessage;
  staged: Array<{ editId: string; comment: string }>;
  committed: Record<string, true>;
  onStageReject: (info: { editId: string; comment: string }) => void;
  onCommit: () => void;
  onClearStaged: () => void;
  onApplyAll: () => void;
  applyAllSummary: { applied: number; total: number; at: number } | null;
  onClearApplyAllSummary: () => void;
}) {
  const isUser = message.role === 'user';
  const currentDocumentId = useStore((s) => s.currentDocumentId);

  // Count ProposedEdit segments in this assistant message and how many
  // of them are still unapplied (i.e. not already in the `committed`
  // map). The footer shows the "Apply N change(s)" button only when
  // there is at least one unapplied edit.
  const { totalEdits, unappliedEdits } = useMemo(() => {
    if (isUser) return { totalEdits: 0, unappliedEdits: 0 };
    const segments = parseProposedEdits(message.content);
    let total = 0;
    let unapplied = 0;
    for (const seg of segments) {
      if (seg.kind !== 'edit') continue;
      total++;
      if (!committed[seg.payload.id]) unapplied++;
    }
    return { totalEdits: total, unappliedEdits: unapplied };
  }, [isUser, message.content, committed]);

  // Auto-clear the "Applied X of Y" summary after a short delay so it
  // fades out without the user having to dismiss it. The effect is
  // keyed on `applyAllSummary?.at` so re-applying restarts the timer.
  useEffect(() => {
    if (!applyAllSummary) return;
    const t = window.setTimeout(onClearApplyAllSummary, 4000);
    return () => window.clearTimeout(t);
  }, [applyAllSummary, onClearApplyAllSummary]);

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${
          isUser
            ? 'bg-cyber-clay text-paper-base dark:bg-ape-fire dark:text-white font-medium border border-cyber-clay/40 dark:border-cyber-fire/40 dark:shadow-ape-fire-soft'
            : 'bg-paper-elevated text-paper-ink dark:bg-ape-elevated dark:text-cyber-primary border border-paper-hairline dark:border-cyber-border'
        }`}
      >
        {message.selection && isUser && (
          <div className="mb-1 text-[10px] uppercase tracking-wide text-paper-base/70 dark:text-white/80 font-mono">
            ▸ selection ({message.selection.length} chars)
          </div>
        )}
        {isUser ? (
          <div className="whitespace-pre-wrap">{message.content}</div>
        ) : (
          <>
            <AssistantContent
              content={message.content}
              docId={currentDocumentId}
              messageId={message.id}
              staged={staged}
              committed={committed}
              onStageReject={onStageReject}
            />
            {(staged.length > 0 || unappliedEdits > 0 || applyAllSummary) && (
              <div className="mt-2 -mx-1 rounded border border-paper-hairline dark:border-cyber-border bg-paper-base/50 dark:bg-ape-base/40 p-2 space-y-1.5">
                {unappliedEdits > 0 && (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-paper-inkSoft dark:text-cyber-muted flex-1">
                      {totalEdits === 1
                        ? '1 proposed change in this reply.'
                        : `${totalEdits} proposed changes in this reply.`}
                    </span>
                    <button
                      type="button"
                      className="btn-fire-sm"
                      onClick={onApplyAll}
                      title="Apply every change whose original text is found in the current document (one document update). Edits that cannot be anchored are skipped."
                    >
                      Apply {unappliedEdits}{' '}
                      {unappliedEdits === 1 ? 'change' : 'changes'}
                    </button>
                  </div>
                )}
                {staged.length > 0 && (
                  <div className="flex items-center gap-2 rounded border border-cyber-clay/40 dark:border-cyber-cyan/50 bg-cyber-clay/5 dark:bg-cyber-cyan/10 p-1.5">
                    <span className="text-xs text-cyber-clay dark:text-cyber-cyan flex-1">
                      {staged.length === 1
                        ? '1 rejection comment staged.'
                        : `${staged.length} rejection comments staged.`}
                    </span>
                    <button
                      type="button"
                      className="btn-fire-sm"
                      onClick={onCommit}
                      title="Append all staged rejection comments to the chat and ask the AI to revise"
                    >
                      Send {staged.length} rejection{' '}
                      {staged.length === 1 ? 'comment' : 'comments'}
                    </button>
                    <button
                      type="button"
                      className="btn-cyan-sm"
                      onClick={onClearStaged}
                      title="Discard all staged rejection comments"
                    >
                      Clear staged
                    </button>
                  </div>
                )}
                {applyAllSummary && (
                  <div
                    className="text-[11px] text-paper-inkSoft dark:text-cyber-muted"
                    role="status"
                    aria-live="polite"
                  >
                    {applyAllSummary.applied === applyAllSummary.total
                      ? `Applied all ${applyAllSummary.total} change${
                          applyAllSummary.total === 1 ? '' : 's'
                        }.`
                      : `Applied ${applyAllSummary.applied} of ${
                          applyAllSummary.total
                        } changes (${
                          applyAllSummary.total - applyAllSummary.applied
                        } skipped — not anchored in the current document).`}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function AssistantContent({
  content,
  docId,
  messageId,
  staged,
  committed,
  onStageReject,
}: {
  content: string;
  docId: string | null;
  messageId: string;
  staged: Array<{ editId: string; comment: string }>;
  committed: Record<string, true>;
  onStageReject: (info: { editId: string; comment: string }) => void;
}) {
  if (!content) {
    return <span className="opacity-60">thinking…</span>;
  }
  const segments = parseProposedEdits(content);
  const docIdForCard = docId ?? '';
  return (
    <div className="space-y-2">
      {segments.map((seg, i) => {
        if (seg.kind === 'text') {
          if (!seg.payload.trim()) return null;
          return (
            <div key={i} className="prose-md">
              <ReactMarkdown
                remarkPlugins={remarkPlugins}
                rehypePlugins={rehypePlugins}
              >
                {seg.payload}
              </ReactMarkdown>
            </div>
          );
        }
        return (
          <ProposedEditCard
            key={`${messageId}-${seg.payload.id}-${i}`}
            edit={seg.payload}
            docId={docIdForCard}
            messageId={messageId}
            staged={staged.some((s) => s.editId === seg.payload.id)}
            committed={!!committed[seg.payload.id]}
            onStageReject={onStageReject}
          />
        );
      })}
    </div>
  );
}
