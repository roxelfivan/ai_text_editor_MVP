import { useCallback, useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { resolveChatEndpoint } from '@/api/chat';
import type { ApiConfig } from '@/types';

/**
 * Inline sentence completion for the editor textarea.
 *
 * Design goals (see plan: add_inline_sentence_completion_to_editor):
 * - Reuse the existing chat model + endpoint. No new config.
 * - Only ever generate ONE sentence. Hard cap with max_tokens + stop seqs.
 * - Trigger only on "valuable" pauses: sentence boundary OR a long idle,
 *   never mid-word, never while fast typing.
 * - Aggressively abort on any subsequent keystroke — partial completions
 *   are wasted tokens.
 *
 * The hook is fully React-local: no store changes, no persisted state.
 * It is auto-disabled when `enabled` is false (e.g. no API key).
 */

const MAX_PREFIX_CHARS = 600;        // input token saver
const DEBOUNCE_MS = 300;               // industry-standard debounce (Copilot / TabComplete / corridor.nvim)
// Generous headroom for "thinking" models: the model may emit a
// <think>...</think> block (often 200-400 tokens) before the actual
// one-sentence answer. 60 tokens was insufficient — the entire budget
// was being burned inside the think block, leaving zero tokens for the
// visible sentence (observed in post-fix-5 logs: 3/3 streams ended with
// ghostLen: 0). 500 gives ~400 for reasoning + ~100 for the answer.
const MAX_OUTPUT_TOKENS = 500;        // one sentence cap (model-side)

// Strong system prompt: explicitly forbids thinking blocks, code blocks,
// and any meta-text. Some models default to "thinking mode" and would
// otherwise burn the entire max_tokens budget inside <think> tags. The
// "do not repeat" clause targets a separate failure mode where the
// model echoes the tail of the prompt instead of continuing from where
// the user stopped (causing visible duplication on accept).
const SYSTEM_PROMPT =
  "You are an inline autocompletion engine. " +
  "The user has typed a partial sentence. Output ONLY the next single " +
  "sentence that continues from exactly where the user stopped. " +
  "CRITICAL: Do NOT repeat, echo, or restate any of the user's text. " +
  "Start the continuation immediately — the first character of your " +
  "output is the first NEW character. " +
  "NEVER output reasoning, analysis, explanations, or meta-commentary. " +
  "NEVER use <think>, </think>, <reasoning>, <tool_call>, </tool_call>, " +
  "```, code fences, bullet lists, headings, or markdown formatting. " +
  "No preamble. No quotes. No labels. " +
  "If the input is empty or non-text, output nothing.";

export interface UseInlineCompletionArgs {
  textareaRef: RefObject<HTMLTextAreaElement>;
  value: string;
  api: ApiConfig;
  enabled: boolean;
}

export interface UseInlineCompletionResult {
  /** The current ghost-text suggestion to render after the caret, or null. */
  ghost: string | null;
  /** True while a request is in flight. Used to show a loading affordance. */
  streaming: boolean;
  /** Should be called from the textarea's onChange, with the new value. */
  onTextChange: (next: string) => void;
  /** Should be called from the textarea's onKeyDown. Intercepts Tab/Esc. */
  onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  /** Should be called from the textarea's onBlur. Cancels any ghost. */
  onBlur: () => void;
  /**
   * Manual trigger that bypasses the debounce and the suppressions
   * (except enabled + ghost-shown + prefix-empty). Wire to a global
   * keyboard shortcut such as Cmd+\ / Ctrl+\.
   */
  triggerNow: () => void;
  /**
   * Accept the current ghost suggestion: splice it into the editor at
   * the caret and clear the ghost. Equivalent to pressing Tab. Safe
   * to call when no ghost is shown (no-op). Wire to an "Accept" button
   * in the bottom panel for mouse-only users.
   */
  accept: () => void;
  /**
   * Per-session counters for the inline-completion feature.
   * - requested: requests that actually went out (passed all gates)
   * - accepted:  completions the user accepted with Tab
   */
  stats: { requested: number; accepted: number };
  /** Reset the counters back to zero (e.g. when the user clicks the pill). */
  resetStats: () => void;
}

export function useInlineCompletion(
  args: UseInlineCompletionArgs
): UseInlineCompletionResult {
  const { textareaRef, value, api, enabled } = args;
  const [ghost, setGhost] = useState<string | null>(null);
  const [streaming, setStreaming] = useState(false);
  // Counters for the status pill: how many completion requests we
  // actually fired, and how many the user accepted with Tab. Both are
  // session-scoped (reset when the hook is remounted or resetStats()
  // is called). They survive between document switches because they
  // live in this hook instance, not the store.
  const [statsRequested, setStatsRequested] = useState(0);
  const [statsAccepted, setStatsAccepted] = useState(0);
  const resetStats = useCallback(() => {
    setStatsRequested(0);
    setStatsAccepted(0);
  }, []);
  const abortRef = useRef<AbortController | null>(null);
  const lastValueRef = useRef<string>(value);
  // Track the prefix we last sent so we can detect a divergent keystroke
  // and discard the streamed result if the user has moved on.
  const lastSentPrefixRef = useRef<string>('');
  const ghostRef = useRef<string | null>(null);
  ghostRef.current = ghost;
  // Mirror the streaming state in a ref so the onDelta closure (captured
  // when the request was fired) can read the CURRENT streaming value
  // without being trapped in a stale closure.
  const streamingRef = useRef<boolean>(false);
  streamingRef.current = streaming;
  // Post-processor state: we strip <think>...</think> blocks defensively in
  // case the model emits them despite the system prompt. The accumulator
  // holds the raw streamed text so we can re-emit only the visible portion.
  const accumulatorRef = useRef<string>('');
  const insideThinkRef = useRef<boolean>(false);
  // Debounce timer: every onTextChange clears and re-arms it. When the
  // timer fires, attemptFire() is called.
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Latest value to send (kept in a ref so the debounce callback can
  // read it without depending on the closure-captured `value`).
  const pendingValueRef = useRef<string>(value);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    if (debounceTimerRef.current !== null) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    setGhost(null);
    setStreaming(false);
    lastSentPrefixRef.current = '';
    accumulatorRef.current = '';
    insideThinkRef.current = false;
  }, []);

  /**
   * attemptFire: runs the suppression gates and (if they pass) starts
   * the streaming request. Called by:
   *  - the debounce timer (after the user pauses for DEBOUNCE_MS)
   *  - triggerNow() (manual trigger that bypasses the debounce and the
   *    selection / caret-suppression gates)
   */
  const attemptFire = useCallback(
    (opts: { manual: boolean }) => {
      if (!enabled) return;
      // While a ghost is on screen, we never auto-replace. Manual
      // trigger also can't fire if a ghost is already there — the user
      // should Tab or Esc first.
      if (ghostRef.current) return;

      const ta = textareaRef.current;
      if (!ta) return;
      const caret = ta.selectionStart ?? 0;
      const end = ta.selectionEnd ?? 0;

      // Industry-standard suppression: don't fire when the user has
      // selected text (they're about to do something non-typing). The
      // manual trigger bypasses this so the user can still force a
      // completion on a selection if they really want one.
      if (!opts.manual && caret !== end) return;

      // Build the prefix window.
      const full = pendingValueRef.current;
      const ctxStart = Math.max(0, caret - MAX_PREFIX_CHARS);
      const prefix = full.slice(ctxStart, caret);
      if (!prefix.trim()) return;

      // Reset post-processor state.
      accumulatorRef.current = '';
      insideThinkRef.current = false;

      // Abort any in-flight request and start a new one.
      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;
      lastSentPrefixRef.current = prefix;
      // Count this as a real request (we passed all gates and are
      // about to hit the network). This is the truthful "how many
      // completions did I ask for" metric — aborted requests still
      // count, because the user *did* ask.
      setStatsRequested((n) => n + 1);

      void streamInlineCompletion({
        prefix,
        api,
        signal: ac.signal,
        onDelta: (delta) => {
          if (lastSentPrefixRef.current !== prefix) return;
          const visible = processDelta(
            accumulatorRef,
            insideThinkRef,
            delta
          );
          if (visible !== null) {
            setGhost((g) => {
              const next = (g ?? '') + visible;
              // Strip any leading overlap with the prefix so the
              // suggestion doesn't duplicate text already in the
              // editor (e.g. user typed "qui", model replies
              // "quick brown fox", without stripping we get
              // "quiquick brown fox" on accept).
              return stripPrefixOverlap(prefix, next);
            });
            if (streamingRef.current) setStreaming(false);
          }
        },
        onStart: () => {
          setStreaming(true);
        },
        onDone: () => {
          if (ac.signal.aborted) return;
          setStreaming(false);
        },
        onError: () => {
          if (ac.signal.aborted) return;
          setStreaming(false);
          setGhost(null);
        },
      });
    },
    [api, enabled, textareaRef]
  );

  const onTextChange = useCallback(
    (next: string) => {
      const prev = lastValueRef.current;
      lastValueRef.current = next;
      pendingValueRef.current = next;

      // If a ghost is showing and the user has typed a character, the
      // ghost is dead. Don't even start a new request — just clear.
      if (ghostRef.current) {
        cancel();
        return;
      }

      // Ignore non-adding changes (paste-collapse, undo, IME composition
      // events that report the same length, etc.). They shouldn't
      // re-arm the debounce.
      if (next.length <= prev.length) return;

      // Re-arm the debounce. Every keystroke resets the 300ms timer.
      if (debounceTimerRef.current !== null) {
        clearTimeout(debounceTimerRef.current);
      }
      debounceTimerRef.current = setTimeout(() => {
        debounceTimerRef.current = null;
        attemptFire({ manual: false });
      }, DEBOUNCE_MS);
    },
    [attemptFire, cancel]
  );

  // Manual trigger: bypasses the debounce and the selection suppression.
  // Exposed on the hook return so the host can wire it to a keyboard
  // shortcut such as Cmd+\ / Ctrl+\.
  const triggerNow = useCallback(() => {
    // Cancel any pending debounce — we're firing now.
    if (debounceTimerRef.current !== null) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    attemptFire({ manual: true });
  }, [attemptFire]);

  // Accept the current ghost: splice it into the editor at the caret,
  // dispatch the same custom event the Tab handler uses, increment the
  // accepted counter, and clear the ghost. Safe to call when no ghost
  // is shown (no-op).
  const accept = useCallback(() => {
    const g = ghostRef.current;
    if (!g) return;
    const ta = textareaRef.current;
    if (!ta) return;
    const caret = ta.selectionStart;
    const next = ta.value.slice(0, caret) + g + ta.value.slice(ta.selectionEnd);
    window.dispatchEvent(
      new CustomEvent('mvp:accept-completion', {
        detail: { text: next, caret: caret + g.length },
      })
    );
    setStatsAccepted((n) => n + 1);
    cancel();
  }, [textareaRef, cancel]);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (!ghost) return;
      if (e.key === 'Tab') {
        e.preventDefault();
        accept();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        cancel();
      } else {
        // Any other key invalidates the ghost.
        cancel();
      }
    },
    [ghost, accept, cancel]
  );

  const onBlur = useCallback(() => {
    cancel();
  }, [cancel]);

  // Clean up the debounce timer on unmount.
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current !== null) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
    };
  }, []);

  return {
    ghost,
    streaming,
    onTextChange,
    onKeyDown,
    onBlur,
    triggerNow,
    accept,
    stats: { requested: statsRequested, accepted: statsAccepted },
    resetStats,
  };
}

// --------------------------------------------------------------------------
// Streaming fetch (duplicates the SSE loop from src/api/chat.ts to keep the
// MVP single-file, per the plan).
// --------------------------------------------------------------------------

interface StreamArgs {
  prefix: string;
  api: ApiConfig;
  signal: AbortSignal;
  onStart: () => void;
  onDelta: (delta: string) => void;
  onDone: () => void;
  onError: () => void;
}

async function streamInlineCompletion(args: StreamArgs): Promise<void> {
  const { prefix, api, signal, onStart, onDelta, onDone, onError } = args;
  const endpoint = resolveChatEndpoint(api.apiEndpoint);
  if (!endpoint || !api.apiKey) {
    onError();
    return;
  }
  let res: Response;
  try {
    res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${api.apiKey}`,
      },
      body: JSON.stringify({
        model: api.model,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: prefix },
        ],
        temperature: Math.min(api.temperature, 0.4),
        max_tokens: MAX_OUTPUT_TOKENS,
        // Stop sequences prevent the model from generating a second
        // sentence, a paragraph, or a code block.
        // NOTE: '<think>' is intentionally NOT in this list. The provider's
        // safety layer may prefix the first content delta with a think
        // tag, which would match a server-side stop immediately and
        // truncate the entire stream to zero bytes (observed in debug-1).
        // <think> stripping is handled client-side by processDelta() in
        // the hook's onDelta callback.
        stop: ['\n\n', '\n', '   ', ' #', ' ##', ' ```'],
        stream: true,
      }),
      signal,
    });
  } catch {
    if (signal.aborted) return;
    onError();
    return;
  }

  if (!res.ok || !res.body) {
    onError();
    return;
  }

  // Tell the caller the request is now actually streaming bytes.
  onStart();

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buffer.indexOf('\n\n')) !== -1) {
        const frame = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        const line = frame.split('\n').find((l) => l.startsWith('data:'));
        if (!line) continue;
        const payload = line.slice(5).trim();
        if (payload === '[DONE]') {
          onDone();
          return;
        }
        if (!payload) continue;
        try {
          const json = JSON.parse(payload);
          const delta: string | undefined =
            json?.choices?.[0]?.delta?.content ??
            json?.choices?.[0]?.message?.content ??
            undefined;
          if (delta) onDelta(delta);
        } catch {
          // ignore malformed frame
        }
      }
    }
    onDone();
  } catch {
    if (signal.aborted) return;
    onError();
  }
}

// --------------------------------------------------------------------------
// Post-processor: strip <think>...</think> blocks defensively.
//
// Some models emit reasoning tags even when the system prompt forbids
// them. We accumulate the raw stream, walk it once per delta, and only
// return the user-visible text. State lives in two refs that the caller
// passes in so the hook can reset them per request.
//
// Returns null if the entire delta is inside a think block (caller
// should NOT append anything to the ghost). Returns "" if the delta
// crosses a think boundary but the visible portion is empty (caller
// still should NOT append). Otherwise returns the visible substring.
// --------------------------------------------------------------------------

const THINK_OPEN = '<think>';
const THINK_CLOSE = '</think>';

// --------------------------------------------------------------------------
// Strip the leading overlap between the user's current text and the
// ghost suggestion. The model is given the full prefix as a user
// message and asked to "continue" — so on short / mid-sentence inputs
// it often echoes back the last few words of the editor before
// continuing, which would duplicate them on accept.
//
// Algorithm: find the longest n such that the last n chars of the
// prefix are approximately equal to the first n chars of the ghost.
// We allow up to 1 mismatch for n >= 4 (so a single dropped or extra
// character from the model doesn't defeat the strip). The resulting
// ghost starts with whatever the model intended as the new content.
// --------------------------------------------------------------------------
const OVERLAP_MAX = 80;
const MIN_OVERLAP = 4;

function stripPrefixOverlap(prefix: string, ghost: string): string {
  if (!ghost) return ghost;
  const maxN = Math.min(OVERLAP_MAX, prefix.length, ghost.length);
  for (let n = maxN; n >= MIN_OVERLAP; n--) {
    const suffix = prefix.slice(-n);
    const ghostStart = ghost.slice(0, n);
    let mismatches = 0;
    for (let i = 0; i < n; i++) {
      if (suffix[i] !== ghostStart[i]) {
        mismatches++;
        if (mismatches > 1) break;
      }
    }
    if (mismatches <= 1) {
      return ghost.slice(n);
    }
  }
  return ghost;
}

function processDelta(
  accumulator: React.MutableRefObject<string>,
  insideThink: React.MutableRefObject<boolean>,
  delta: string
): string | null {
  accumulator.current += delta;
  let visible = '';
  let i = 0;
  const buf = accumulator.current;
  while (i < buf.length) {
    if (insideThink.current) {
      const closeIdx = buf.indexOf(THINK_CLOSE, i);
      if (closeIdx === -1) {
        // Still inside think, no close yet — drop everything we've seen.
        return null;
      }
      // Skip past the close tag and resume visible output.
      insideThink.current = false;
      i = closeIdx + THINK_CLOSE.length;
      // Trim any leading whitespace introduced by the close tag.
      while (i < buf.length && /\s/.test(buf[i])) i++;
      continue;
    }
    const openIdx = buf.indexOf(THINK_OPEN, i);
    if (openIdx === -1) {
      // No think block in the rest of the buffer — emit it all.
      visible += buf.slice(i);
      i = buf.length;
      break;
    }
    // Emit everything up to the think block, then enter think mode.
    visible += buf.slice(i, openIdx);
    insideThink.current = true;
    i = openIdx + THINK_OPEN.length;
    // Look for the close tag immediately.
    const closeIdx = buf.indexOf(THINK_CLOSE, i);
    if (closeIdx === -1) {
      return visible.length > 0 ? visible : null;
    }
    insideThink.current = false;
    i = closeIdx + THINK_CLOSE.length;
    while (i < buf.length && /\s/.test(buf[i])) i++;
  }
  // We've consumed the entire buffer; clear it so the next delta starts
  // fresh. (Without this, the buffer would grow without bound.)
  accumulator.current = '';
  return visible.length > 0 ? visible : null;
}
