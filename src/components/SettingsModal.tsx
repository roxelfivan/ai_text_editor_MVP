import { useState, useEffect } from 'react';
import { useStore } from '@/store/useStore';
import { PROVIDERS, getProvider } from '@/config/providers';
import type { ApiProvider } from '@/types';

// Project default for the global UI font size. Mirrored in
// `useStore.ts`'s initial state and the `onRehydrateStorage` migration;
// keep them aligned so the modal's "Reset" button restores the
// value that new users actually see on first load.
const DEFAULT_UI_FONT_SIZE = 14;

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
  const [systemMessage, setSystemMessage] = useState(api.systemMessage);
  const [temperature, setTemperature] = useState(api.temperature);
  const [showKey, setShowKey] = useState(false);
  // Local mirror of the UI font size so the slider reflects drags
  // before the user clicks Save (matches the rest of the modal's
  // local-state-first pattern).
  const [uiFontSizeDraft, setUiFontSizeDraft] = useState(uiFontSize);

  // Sync local state when the modal opens.
  useEffect(() => {
    if (open) {
      setProvider(api.provider);
      setApiKey(api.apiKey);
      setApiEndpoint(api.apiEndpoint);
      setModel(api.model);
      setSystemMessage(api.systemMessage);
      setTemperature(api.temperature);
      setUiFontSizeDraft(uiFontSize);
    }
  }, [open, api, uiFontSize]);

  if (!open) return null;

  const preset = getProvider(provider);

  const save = () => {
    setApi({ provider, apiKey, apiEndpoint, model, systemMessage, temperature });
    setUiFontSize(uiFontSizeDraft);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="w-full max-w-lg max-h-[90vh] bg-paper-panel dark:bg-ape-panel rounded-lg shadow-ape-paper-lift dark:shadow-2xl border border-paper-hairline dark:border-cyber-border flex flex-col">
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

          <div>
            <label className="block text-xs font-medium text-cyber-clay dark:text-cyber-cyan mb-1 uppercase tracking-wide">
              System message
            </label>
            <textarea
              value={systemMessage}
              onChange={(e) => setSystemMessage(e.target.value)}
              rows={3}
              className="ape-field resize-none"
            />
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
      </div>
    </div>
  );
}
