import { useState, useEffect } from 'react';
import { useStore } from '@/store/useStore';
import { PROVIDERS, getProvider } from '@/config/providers';
import type { ApiProvider } from '@/types';

interface Props {
  open: boolean;
  onClose: () => void;
}

export function SettingsModal({ open, onClose }: Props) {
  const api = useStore((s) => s.api);
  const setApi = useStore((s) => s.setApi);

  const [provider, setProvider] = useState<ApiProvider>(api.provider);
  const [apiKey, setApiKey] = useState(api.apiKey);
  const [apiEndpoint, setApiEndpoint] = useState(api.apiEndpoint);
  const [model, setModel] = useState(api.model);
  const [systemMessage, setSystemMessage] = useState(api.systemMessage);
  const [temperature, setTemperature] = useState(api.temperature);
  const [showKey, setShowKey] = useState(false);

  // Sync local state when the modal opens.
  useEffect(() => {
    if (open) {
      setProvider(api.provider);
      setApiKey(api.apiKey);
      setApiEndpoint(api.apiEndpoint);
      setModel(api.model);
      setSystemMessage(api.systemMessage);
      setTemperature(api.temperature);
    }
  }, [open, api]);

  if (!open) return null;

  const preset = getProvider(provider);

  const save = () => {
    setApi({ provider, apiKey, apiEndpoint, model, systemMessage, temperature });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="w-full max-w-lg bg-paper-panel dark:bg-ape-panel rounded-lg shadow-ape-paper-lift dark:shadow-2xl border border-paper-hairline dark:border-cyber-border flex flex-col">
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

        <div className="p-4 space-y-3 text-sm bg-paper-base dark:bg-ape-base">
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
              Stored only in this browser's localStorage. Sent as
              <code className="mx-1 px-1 rounded bg-paper-elevated dark:bg-ape-elevated text-cyber-clay dark:text-cyber-cyan font-mono text-[11px]">
                Authorization: Bearer …
              </code>
              .
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
