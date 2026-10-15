import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useStore } from '@/store/useStore';
import {
  DEFAULT_SYSTEM_MESSAGE,
  PROPOSED_EDIT_RULES_DEFAULT,
  isCurrentRationaleRulesDefault,
  isStaleRationaleRulesOverride,
  isCurrentDefaultSystemMessage,
  isStaleDefaultSystemMessage,
  normalizeRationaleRulesOverride,
  normalizeSystemMessage,
} from '@/api/chat';
import { PROVIDERS, getProvider, requiresApiKey } from '@/config/providers';
import type { ApiProvider } from '@/types';
import { ResizeHandle } from '@/components/ResizeHandle';
import {
  useDragResize,
  applyHandle,
  clamp,
  MIN_SETTINGS_WIDTH,
  MAX_SETTINGS_WIDTH,
  MIN_SETTINGS_HEIGHT,
  MAX_SETTINGS_HEIGHT,
  MIN_SETTINGS_TEXTAREA_HEIGHT,
  MAX_SETTINGS_TEXTAREA_HEIGHT,
  type ResizeHandle as HandleName,
} from '@/hooks/useDragResize';
import { SETTINGS_SIZE_KEYS } from '@/utils/storage';

// Project default for the global UI font size. Mirrored in
// `useStore.ts`'s initial state and the `onRehydrateStorage` migration;
// keep them aligned so the modal's "Reset" button restores the
// value that new users actually see on first load.
const DEFAULT_UI_FONT_SIZE = 14;

// Initial size of the modal card before the user has dragged any
// handle. Kept slightly above the CSS `max-w-lg` so the resize
// affordance is visible on first open.
const DEFAULT_SETTINGS_SIZE = { w: 520, h: 620 };
// Default size for the prompt textareas when no persisted size
// is found in localStorage.
const DEFAULT_SYSTEM_MSG_SIZE = { w: 480, h: 200 };
const DEFAULT_RATIONALE_RULES_SIZE = { w: 480, h: 240 };

// localStorage keys for the user-chosen sizes. Scoped to the
// Settings modal namespace so they don't collide with the
// CommentPopover / ProposedEditCard size keys.
const SIZE_KEYS = SETTINGS_SIZE_KEYS;

function loadSize(
  key: string,
  bounds: { minW: number; maxW: number; minH: number; maxH: number }
): { w: number; h: number } | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    // Accept BOTH the modern `{ w, h }` shape and the older
    // `{ width, height }` shape so a payload written by a previous
    // build still loads cleanly after the rename.
    const parsed = JSON.parse(raw);
    const w = typeof parsed?.w === 'number' ? parsed.w : parsed?.width;
    const h = typeof parsed?.h === 'number' ? parsed.h : parsed?.height;
    if (
      typeof w === 'number' &&
      typeof h === 'number' &&
      w >= bounds.minW &&
      w <= bounds.maxW &&
      h >= bounds.minH &&
      h <= bounds.maxH
    ) {
      return { w, h };
    }
    return null;
  } catch {
    return null;
  }
}

function saveSize(key: string, size: { w: number; h: number }): void {
  try {
    localStorage.setItem(key, JSON.stringify(size));
  } catch {
    /* ignore quota / private-mode errors */
  }
}

interface Props {
  open: boolean;
  onClose: () => void;
}

export function SettingsModal({ open, onClose }: Props) {
  const api = useStore((s) => s.api);
  const setApi = useStore((s) => s.setApi);
  const debugMode = useStore((s) => s.debugMode);
  const setDebugMode = useStore((s) => s.setDebugMode);
  const uiFontSize = useStore((s) => s.uiFontSize);
  const setUiFontSize = useStore((s) => s.setUiFontSize);

  const [provider, setProvider] = useState<ApiProvider>(api.provider);
  const [apiKey, setApiKey] = useState(api.apiKey);
  const [apiEndpoint, setApiEndpoint] = useState(api.apiEndpoint);
  const [model, setModel] = useState(api.model);
  // Local mirror of the System Message. Seeded with the live
  // built-in when the user has not customized it, so Settings always
  // shows the active prompt and Save can normalize empty / built-in
  // text back to "no override" (so future updates stay in sync).
  const [systemMessage, setSystemMessage] = useState(
    () => normalizeSystemMessage(api.systemMessage) ?? DEFAULT_SYSTEM_MESSAGE
  );
  // Local mirror of the rationale-rules override so the user can
  // edit it freely without committing until Save. Seeded with the
  // live built-in when no override is in effect, so Settings always
  // shows the active prompt and Save normalizes empty / built-in
  // text back to "no override" (so future updates stay in sync).
  const [rationaleRulesOverride, setRationaleRulesOverride] = useState(
    () =>
      normalizeRationaleRulesOverride(api.rationaleRulesOverride) ??
      PROPOSED_EDIT_RULES_DEFAULT
  );
  const [temperature, setTemperature] = useState(api.temperature);
  const [showKey, setShowKey] = useState(false);
  // Local mirror of the UI font size so the slider reflects drags
  // before the user clicks Save (matches the rest of the modal's
  // local-state-first pattern).
  const [uiFontSizeDraft, setUiFontSizeDraft] = useState(uiFontSize);

  // Refs to the two prompt textareas, used by the auto-measure
  // effect to compute the natural height of the prompt content
  // on first render (and after a content reset). We don't read
  // these on every render — only inside `useLayoutEffect` — so a
  // stale ref never blocks an update.
  const systemMsgTextareaRef = useRef<HTMLTextAreaElement>(null);
  const rationaleRulesTextareaRef = useRef<HTMLTextAreaElement>(null);

  // User-resizable modal size. Persisted to localStorage so the
  // user-chosen size survives reloads. Until the user has dragged
  // any handle we keep the CSS default (the inner card uses
  // `max-w-lg max-h-[90vh]`).
  const [modalSize, setModalSize] = useState<{
    w: number;
    h: number;
  } | null>(() =>
    loadSize(SIZE_KEYS.modal, {
      minW: MIN_SETTINGS_WIDTH,
      maxW: MAX_SETTINGS_WIDTH,
      minH: MIN_SETTINGS_HEIGHT,
      maxH: MAX_SETTINGS_HEIGHT,
    })
  );
  // Per-textarea heights for the two prompt fields. Width is
  // always 100% of the modal content (so a modal resize grows
  // both textareas in lockstep). Height is auto-measured to the
  // prompt's natural content on first render so the user doesn't
  // have to scroll to see the whole default prompt, and the user
  // can still drag the bottom handle to override. Persisted per-key.
  const [systemMsgHeight, setSystemMsgHeight] = useState<number | null>(
    () => {
      const loaded = loadSize(SIZE_KEYS.systemMsg, {
        minW: 1,
        maxW: 1,
        minH: MIN_SETTINGS_TEXTAREA_HEIGHT,
        maxH: MAX_SETTINGS_TEXTAREA_HEIGHT,
      });
      return loaded ? loaded.h : null;
    }
  );
  const [rationaleRulesHeight, setRationaleRulesHeight] = useState<
    number | null
  >(() => {
    const loaded = loadSize(SIZE_KEYS.rationaleRules, {
      minW: 1,
      maxW: 1,
      minH: MIN_SETTINGS_TEXTAREA_HEIGHT,
      maxH: MAX_SETTINGS_TEXTAREA_HEIGHT,
    });
    return loaded ? loaded.h : null;
  });

  // Drag origin captured when a handle is pressed so `onDelta` can
  // compute the next size relative to the size at the start of the
  // drag (rather than relative to a 0 baseline that drifts over
  // time). One ref per drag target — `null` handle means no drag
  // is in flight.
  const modalStartSizeRef = useRef<{ w: number; h: number }>(
    modalSize ?? DEFAULT_SETTINGS_SIZE
  );
  const systemMsgStartHeightRef = useRef<number>(
    systemMsgHeight ?? DEFAULT_SYSTEM_MSG_SIZE.h
  );
  const rationaleRulesStartHeightRef = useRef<number>(
    rationaleRulesHeight ?? DEFAULT_RATIONALE_RULES_SIZE.h
  );
  const modalHandleRef = useRef<HandleName | null>(null);
  const systemMsgHandleRef = useRef<HandleName | null>(null);
  const rationaleRulesHandleRef = useRef<HandleName | null>(null);

  // Drag wiring for the modal card itself.
  const { start: beginModalResize } = useDragResize({
    mode: 'free',
    onDelta: ({ dx, dy }) => {
      const handle = modalHandleRef.current;
      if (!handle) return;
      const next = applyHandle(
        handle,
        modalStartSizeRef.current.w,
        modalStartSizeRef.current.h,
        dx,
        dy
      );
      const maxW = Math.min(MAX_SETTINGS_WIDTH, window.innerWidth - 32);
      const maxH = Math.min(MAX_SETTINGS_HEIGHT, window.innerHeight - 32);
      // On small phones the historical mins can exceed the viewport;
      // never clamp above the available space.
      const w = clamp(next.w, Math.min(MIN_SETTINGS_WIDTH, maxW), maxW);
      const h = clamp(next.h, Math.min(MIN_SETTINGS_HEIGHT, maxH), maxH);
      if (modalSize && modalSize.w === w && modalSize.h === h) return;
      setModalSize({ w, h });
    },
  });
  // Drag wiring for the System message textarea. Width is fixed at
  // 100% of the modal (so a modal resize grows it in lockstep);
  // only the height is user-resizable. We re-use the
  // `useDragResize` axis mode so a single `dy` delta drives the
  // height change cleanly.
  const { start: beginSystemMsgResize } = useDragResize({
    mode: 'axis',
    axis: 'vertical',
    onDelta: ({ dy }) => {
      const handle = systemMsgHandleRef.current;
      if (!handle) return;
      // `useDragResize` axis mode gives `dy` as cumulative delta
      // from drag start, so we apply it relative to the captured
      // start height.
      const startH = systemMsgStartHeightRef.current;
      const h = clamp(
        startH + dy,
        MIN_SETTINGS_TEXTAREA_HEIGHT,
        MAX_SETTINGS_TEXTAREA_HEIGHT
      );
      if (systemMsgHeight === h) return;
      setSystemMsgHeight(h);
    },
  });
  // Drag wiring for the Rationale rules textarea. Same shape.
  const { start: beginRationaleRulesResize } = useDragResize({
    mode: 'axis',
    axis: 'vertical',
    onDelta: ({ dy }) => {
      const handle = rationaleRulesHandleRef.current;
      if (!handle) return;
      const startH = rationaleRulesStartHeightRef.current;
      const h = clamp(
        startH + dy,
        MIN_SETTINGS_TEXTAREA_HEIGHT,
        MAX_SETTINGS_TEXTAREA_HEIGHT
      );
      if (rationaleRulesHeight === h) return;
      setRationaleRulesHeight(h);
    },
  });

  // Auto-measure the natural height of each prompt textarea on
  // first render (and after the user resets to the default). We
  // only do this when the user has NOT already chosen a height
  // (`systemMsgHeight === null`), so a previously-resized box
  // keeps the user's chosen height across opens. `useLayoutEffect`
  // is used so the measured height is applied before the browser
  // paints, avoiding a one-frame flash at the default height.
  useLayoutEffect(() => {
    if (systemMsgHeight !== null) return;
    const el = systemMsgTextareaRef.current;
    if (!el) return;
    // Temporarily size the wrapper to its natural `auto` height
    // so `scrollHeight` reports the unconstrained content size;
    // the wrapper's own `height` is set from this value on the
    // next render.
    const prevHeight = el.style.height;
    el.style.height = 'auto';
    const natural = el.scrollHeight;
    el.style.height = prevHeight;
    const next = clamp(
      natural,
      MIN_SETTINGS_TEXTAREA_HEIGHT,
      MAX_SETTINGS_TEXTAREA_HEIGHT
    );
    setSystemMsgHeight(next);
  }, [systemMessage, systemMsgHeight]);
  useLayoutEffect(() => {
    if (rationaleRulesHeight !== null) return;
    const el = rationaleRulesTextareaRef.current;
    if (!el) return;
    const prevHeight = el.style.height;
    el.style.height = 'auto';
    const natural = el.scrollHeight;
    el.style.height = prevHeight;
    const next = clamp(
      natural,
      MIN_SETTINGS_TEXTAREA_HEIGHT,
      MAX_SETTINGS_TEXTAREA_HEIGHT
    );
    setRationaleRulesHeight(next);
  }, [rationaleRulesOverride, rationaleRulesHeight]);

  // Per-target `onPointerDown` factories. Each one captures the
  // drag start size, sets the active handle ref, then kicks off
  // the corresponding `useDragResize` hook.
  const onModalResizeDown = (handle: HandleName) =>
    (e: React.PointerEvent<HTMLElement>) => {
      if (modalSize) {
        modalStartSizeRef.current = modalSize;
      } else {
        const el = e.currentTarget.parentElement;
        const rect = el?.getBoundingClientRect();
        modalStartSizeRef.current = rect
          ? { w: rect.width, h: rect.height }
          : DEFAULT_SETTINGS_SIZE;
      }
      modalHandleRef.current = handle;
      beginModalResize(handle, e);
    };
  const onSystemMsgResizeDown = (handle: HandleName) =>
    (e: React.PointerEvent<HTMLElement>) => {
      if (systemMsgHeight !== null) {
        systemMsgStartHeightRef.current = systemMsgHeight;
      } else {
        const el = e.currentTarget.parentElement;
        const rect = el?.getBoundingClientRect();
        systemMsgStartHeightRef.current = rect
          ? rect.height
          : DEFAULT_SYSTEM_MSG_SIZE.h;
      }
      systemMsgHandleRef.current = handle;
      beginSystemMsgResize(handle, e);
    };
  const onRationaleRulesResizeDown = (handle: HandleName) =>
    (e: React.PointerEvent<HTMLElement>) => {
      if (rationaleRulesHeight !== null) {
        rationaleRulesStartHeightRef.current = rationaleRulesHeight;
      } else {
        const el = e.currentTarget.parentElement;
        const rect = el?.getBoundingClientRect();
        rationaleRulesStartHeightRef.current = rect
          ? rect.height
          : DEFAULT_RATIONALE_RULES_SIZE.h;
      }
      rationaleRulesHandleRef.current = handle;
      beginRationaleRulesResize(handle, e);
    };

  // Persist the user-chosen sizes when they change. Guarded so we
  // never write a default `null` value back to storage — that
  // would mask the CSS default the next time the modal opens.
  useEffect(() => {
    if (modalSize) saveSize(SIZE_KEYS.modal, modalSize);
  }, [modalSize]);
  useEffect(() => {
    if (systemMsgHeight !== null) {
      // We persist the full { w: 0, h } shape (the `loadSize`
      // helper only reads the `h` field, so the `w` is a no-op
      // legacy slot). Keeping the same shape avoids a migration
      // in `loadSize` and keeps the persistence code uniform.
      saveSize(SIZE_KEYS.systemMsg, { w: 0, h: systemMsgHeight });
    }
  }, [systemMsgHeight]);
  useEffect(() => {
    if (rationaleRulesHeight !== null) {
      saveSize(SIZE_KEYS.rationaleRules, {
        w: 0,
        h: rationaleRulesHeight,
      });
    }
  }, [rationaleRulesHeight]);

  // Sync local state when the modal opens.
  useEffect(() => {
    if (open) {
      setProvider(api.provider);
      setApiKey(api.apiKey);
      setApiEndpoint(api.apiEndpoint);
      setModel(api.model);
      setSystemMessage(
        normalizeSystemMessage(api.systemMessage) ?? DEFAULT_SYSTEM_MESSAGE
      );
      // Drop a stored copy of the OLD writing-assistant default and
      // sync the textarea with the current built-in.
      if (isStaleDefaultSystemMessage(api.systemMessage)) {
        setApi({ systemMessage: undefined });
        setSystemMessage(DEFAULT_SYSTEM_MESSAGE);
      }
      // Show a real custom override, otherwise the live built-in
      // default. Stale frozen copies of older built-ins are treated
      // as "no override" so the current structured-style default
      // appears.
      if (isStaleRationaleRulesOverride(api.rationaleRulesOverride)) {
        // Clear so chat + Settings both pick up the current built-in
        // without requiring an explicit Reset click.
        setApi({ rationaleRulesOverride: undefined });
        setRationaleRulesOverride(PROPOSED_EDIT_RULES_DEFAULT);
      } else {
        setRationaleRulesOverride(
          normalizeRationaleRulesOverride(api.rationaleRulesOverride) ??
            PROPOSED_EDIT_RULES_DEFAULT
        );
      }
      setTemperature(api.temperature);
      setUiFontSizeDraft(uiFontSize);
    }
  }, [open, api, uiFontSize, setApi]);

  if (!open) return null;

  const preset = getProvider(provider);

  const save = () => {
    setApi({
      provider,
      apiKey,
      apiEndpoint,
      model,
      // Persist undefined when the textarea still matches the live
      // built-in (or is empty) so future default updates stay in sync.
      systemMessage: normalizeSystemMessage(systemMessage),
      rationaleRulesOverride: normalizeRationaleRulesOverride(
        rationaleRulesOverride
      ),
      temperature,
    });
    setUiFontSize(uiFontSizeDraft);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4 pt-[max(1rem,env(safe-area-inset-top))] pb-[max(1rem,env(safe-area-inset-bottom))]">
      <div
        className="w-full max-w-lg max-h-[min(90vh,90dvh)] bg-paper-panel dark:bg-ape-panel rounded-lg shadow-ape-paper-lift dark:shadow-2xl border border-paper-hairline dark:border-cyber-border flex flex-col relative"
        style={
          modalSize
            ? {
                width: `${modalSize.w}px`,
                height: `${modalSize.h}px`,
                maxWidth: `min(calc(100vw - 32px), calc(100dvw - 32px))`,
                maxHeight: `min(calc(100vh - 32px), calc(100dvh - 32px))`,
              }
            : undefined
        }
      >
        <div className="px-4 py-3 border-b border-paper-hairline dark:border-cyber-border flex items-center bg-paper-elevated/50 dark:bg-ape-elevated/50">
          <h2 className="font-semibold text-cyber-clay dark:text-cyber-cyan uppercase tracking-wider text-sm">
            Settings
          </h2>
          <div className="flex-1" />
          <button
            className="text-paper-inkSoft dark:text-cyber-muted hover:text-cyber-clay dark:hover:text-cyber-cyan transition-colors text-lg leading-none"
            onClick={onClose}
          >
            ×
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-3 text-sm bg-paper-base dark:bg-ape-base">
          <div>
            <label className="block text-xs font-medium text-cyber-clay dark:text-cyber-cyan mb-1 uppercase tracking-wide">
              Provider
            </label>
            <select
              value={provider}
              onChange={(e) => {
                const next = e.target.value as ApiProvider;
                const nextPreset = getProvider(next);
                setProvider(next);
                // Smart-swap the endpoint + model to the new provider's
                // defaults so the user doesn't have to retype them.
                // The API key is intentionally NOT touched — the user
                // will type the matching key in the field below.
                setApiEndpoint(nextPreset.defaultEndpoint);
                setModel(nextPreset.defaultModel);
              }}
              className="ape-field"
            >
              {PROVIDERS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>

          {requiresApiKey(provider) ? (
            <>
              <div>
                <label className="block text-xs font-medium text-cyber-clay dark:text-cyber-cyan mb-1 uppercase tracking-wide">
                  API key
                </label>
                <div className="flex gap-2">
                  <input
                    type={showKey ? 'text' : 'password'}
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder={preset.apiKeyPlaceholder}
                    className="flex-1 ape-field font-mono"
                    autoComplete="off"
                    spellCheck={false}
                  />
                  <button
                    className="btn-cyan-sm"
                    onClick={() => setShowKey((v) => !v)}
                  >
                    {showKey ? 'Hide' : 'Show'}
                  </button>
                </div>
                <p className="mt-1 text-xs text-paper-inkSoft dark:text-cyber-muted">
                  Stored only in this browser's localStorage (never uploaded to
                  this app's servers — there are none). Sent as
                  <code className="mx-1 px-1 rounded bg-paper-elevated dark:bg-ape-elevated text-cyber-clay dark:text-cyber-cyan font-mono text-[11px]">
                    Authorization: Bearer …
                  </code>
                  to the HTTPS endpoint below. Do not use a shared computer
                  without clearing site data afterward.
                </p>
              </div>

              <div>
                <label className="block text-xs font-medium text-cyber-clay dark:text-cyber-cyan mb-1 uppercase tracking-wide">
                  API endpoint
                </label>
                <input
                  value={apiEndpoint}
                  onChange={(e) => setApiEndpoint(e.target.value)}
                  placeholder={preset.defaultEndpoint}
                  className="ape-field font-mono text-xs"
                  spellCheck={false}
                />
                <p className="mt-1 text-xs text-paper-inkSoft dark:text-cyber-muted">{preset.helpText}</p>
              </div>

              <div>
                <label className="block text-xs font-medium text-cyber-clay dark:text-cyber-cyan mb-1 uppercase tracking-wide">
                  Model
                </label>
                <div className="flex gap-2">
                  <input
                    value={model}
                    onChange={(e) => setModel(e.target.value)}
                    list="mvp-model-list"
                    className="flex-1 ape-field"
                    spellCheck={false}
                  />
                  <datalist id="mvp-model-list">
                    {preset.modelPresets.map((m) => (
                      <option key={m} value={m} />
                    ))}
                  </datalist>
                </div>
              </div>
            </>
          ) : (
            // Keyless provider (google-ai-mode): the three keyed fields
            // above are irrelevant. Show a single explanatory block
            // instead, plus a visible note that the System message
            // below will be folded into the prompt that gets sent to
            // the AI Mode tab.
            <div className="rounded border border-paper-hairline dark:border-cyber-border bg-paper-elevated/40 dark:bg-ape-elevated/40 p-3 space-y-1.5">
              <p className="text-sm text-paper-ink dark:text-cyber-primary">
                No API key needed.
              </p>
              <p className="text-xs text-paper-inkSoft dark:text-cyber-muted">
                {preset.helpText}
              </p>
            </div>
          )}

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-xs font-medium text-cyber-clay dark:text-cyber-cyan uppercase tracking-wide">
                System message
              </label>
              <button
                type="button"
                className="btn-cyan-sm"
                onClick={() => setSystemMessage(DEFAULT_SYSTEM_MESSAGE)}
                disabled={isCurrentDefaultSystemMessage(systemMessage)}
                title="Restore the built-in default system message"
              >
                Reset
              </button>
            </div>
            <div
              className="settings-textarea-wrap"
              style={
                // Width is always 100% of the modal content area so
                // a modal resize grows the textbox in lockstep with
                // the rationale rules textbox below. Height is
                // auto-measured to the prompt's natural content on
                // first render, then becomes user-resizable via the
                // bottom handle.
                {
                  width: '100%',
                  height:
                    systemMsgHeight !== null
                      ? `${systemMsgHeight}px`
                      : 'auto',
                }
              }
            >
              <textarea
                ref={systemMsgTextareaRef}
                value={systemMessage}
                onChange={(e) => setSystemMessage(e.target.value)}
                className="ape-field w-full h-full font-mono text-xs"
                spellCheck={false}
                aria-label="System message"
              />
              <ResizeHandle
                handle="bottom"
                onPointerDown={onSystemMsgResizeDown('bottom')}
              />
            </div>
            <p className="mt-1 text-[11px] text-paper-inkSoft dark:text-cyber-muted">
              Edit to customize the AI's system prompt. The rationale rules
              below are sent as a separate, always-injected block.
            </p>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-xs font-medium text-cyber-clay dark:text-cyber-cyan uppercase tracking-wide">
                Rationale rules
              </label>
              <button
                type="button"
                className="btn-cyan-sm"
                onClick={() =>
                  setRationaleRulesOverride(PROPOSED_EDIT_RULES_DEFAULT)
                }
                disabled={isCurrentRationaleRulesDefault(rationaleRulesOverride)}
                title="Restore the built-in default rationale rules"
              >
                Reset
              </button>
            </div>
            <div
              className="settings-textarea-wrap"
              style={{
                // Same layout as the system message textbox above:
                // width 100% of the modal content, height
                // auto-measured to the natural content on first
                // render, then user-resizable via the bottom
                // handle.
                width: '100%',
                height:
                  rationaleRulesHeight !== null
                    ? `${rationaleRulesHeight}px`
                    : 'auto',
              }}
            >
              <textarea
                ref={rationaleRulesTextareaRef}
                value={rationaleRulesOverride}
                onChange={(e) => setRationaleRulesOverride(e.target.value)}
                className="ape-field w-full h-full font-mono text-xs"
                spellCheck={false}
                aria-label="Rationale rules"
                placeholder="Leave empty to use the built-in default"
              />
              <ResizeHandle
                handle="bottom"
                onPointerDown={onRationaleRulesResizeDown('bottom')}
              />
            </div>
            <p className="mt-1 text-[11px] text-paper-inkSoft dark:text-cyber-muted">
              Rules the AI follows when writing the per-edit rationale
              (structured Markdown, keywords bold+underlined) shown
              in each comment popover. Leave empty to use the
              built-in default.
            </p>
          </div>

          <div>
            <label className="flex items-center justify-between text-xs font-medium text-cyber-clay dark:text-cyber-cyan mb-1 uppercase tracking-wide">
              <span>Temperature</span>
              <span className="font-mono text-cyber-clay dark:text-cyber-cyan">{temperature.toFixed(2)}</span>
            </label>
            <input
              type="range"
              min={0}
              max={2}
              step={0.05}
              value={temperature}
              onChange={(e) => setTemperature(parseFloat(e.target.value))}
              className="w-full accent-cyber-clay dark:accent-cyber-fire"
            />
          </div>

          {/* Debug Mode + UI font size on a single row. Both
              controls are self-contained (a switch + caption, and
              a slider + caption), so a 2-column grid fits them
              side-by-side at the modal's max width (≈32rem) and
              collapses to a single column on narrow viewports.
              Toggling one never affects the other. */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {/* Debug Mode — gates developer-facing diagnostics
                (currently the inline-completion status pill and
                request/accept counters in the editor toolbar).
                Persisted across reloads. Mirrors the row pattern
                of the other settings: one label row + a single
                inline switch, with helper text underneath. */}
            <div>
              <div className="flex items-center justify-between text-xs font-medium text-cyber-clay dark:text-cyber-cyan mb-1 uppercase tracking-wide">
                <span>Debug Mode</span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={debugMode}
                  onClick={() => setDebugMode(!debugMode)}
                  title={
                    debugMode
                      ? 'Debug Mode is ON — click to hide diagnostic controls'
                      : 'Debug Mode is OFF — click to reveal diagnostic controls'
                  }
                  className={[
                    'relative inline-flex h-5 w-9 rounded-full border transition-colors select-none',
                    debugMode
                      ? 'bg-cyber-clay dark:bg-cyber-cyan border-cyber-clay dark:border-cyber-cyan justify-end'
                      : 'bg-paper-surface dark:bg-ape-panel border-paper-hairline dark:border-cyber-border justify-start',
                  ].join(' ')}
                >
                  <span
                    aria-hidden
                    className={[
                      'block h-4 w-4 rounded-full m-0.5 transition-transform',
                      debugMode
                        ? 'bg-paper-base dark:bg-ape-base'
                        : 'bg-paper-inkSoft/70 dark:bg-cyber-muted/70',
                    ].join(' ')}
                  />
                </button>
              </div>
              <p className="mt-1 text-[11px] text-paper-inkSoft dark:text-cyber-muted">
                Show inline-completion status &amp; counters
              </p>
            </div>

            {/* Global UI font size. The slider is in [12, 20] to
                stay within a comfortable range (a 14px base gives
                a text-xs of ~10px; a 20px base gives ~14px which
                is already on the heavy side). The editor's own
                `editorFontSize` control is unaffected — it remains
                the authoritative size for the textarea and preview. */}
            <div>
              <label className="flex items-center justify-between text-xs font-medium text-cyber-clay dark:text-cyber-cyan mb-1 uppercase tracking-wide">
                <span>UI font size</span>
                <span className="font-mono text-cyber-clay dark:text-cyber-cyan">
                  {uiFontSizeDraft}px
                </span>
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="range"
                  min={12}
                  max={20}
                  step={1}
                  value={uiFontSizeDraft}
                  onChange={(e) => setUiFontSizeDraft(parseInt(e.target.value, 10))}
                  className="flex-1 accent-cyber-clay dark:accent-cyber-fire"
                  aria-label="Global UI font size in pixels"
                  title="Scales every UI text in the app except the editor's textarea and preview"
                />
                <button
                  type="button"
                  className="btn-cyan-sm"
                  onClick={() => setUiFontSizeDraft(DEFAULT_UI_FONT_SIZE)}
                  disabled={uiFontSizeDraft === DEFAULT_UI_FONT_SIZE}
                  title={`Reset to default (${DEFAULT_UI_FONT_SIZE}px)`}
                >
                  Reset
                </button>
              </div>
              <p className="mt-1 text-[11px] text-paper-inkSoft dark:text-cyber-muted">
                Scales UI text. Editor text size is set on its toolbar.
              </p>
            </div>
          </div>
        </div>

        <div className="px-4 py-3 border-t border-paper-hairline dark:border-cyber-border flex justify-end gap-2 bg-paper-elevated/40 dark:bg-ape-elevated/30">
          <button
            className="btn-ghost"
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            className="btn-fire"
            onClick={save}
          >
            Save
          </button>
        </div>

        {/* 8 resize handles on the modal card so the user can grow
            the Settings dialog to fit a long prompt. Same shape as
            the ProposedEditCard and CommentPopover. */}
        <ResizeHandle handle="top" onPointerDown={onModalResizeDown('top')} />
        <ResizeHandle handle="bottom" onPointerDown={onModalResizeDown('bottom')} />
        <ResizeHandle handle="left" onPointerDown={onModalResizeDown('left')} />
        <ResizeHandle handle="right" onPointerDown={onModalResizeDown('right')} />
        <ResizeHandle handle="tl" onPointerDown={onModalResizeDown('tl')} />
        <ResizeHandle handle="tr" onPointerDown={onModalResizeDown('tr')} />
        <ResizeHandle handle="bl" onPointerDown={onModalResizeDown('bl')} />
        <ResizeHandle handle="br" onPointerDown={onModalResizeDown('br')} />
      </div>
    </div>
  );
}
