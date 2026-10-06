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
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-lg bg-white dark:bg-gray-900 rounded-lg shadow-xl flex flex-col">
        <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-800 flex items-center">
          <h2 className="font-semibold">Settings</h2>
          <div className="flex-1" />
          <button
            className="text-gray-500 hover:text-gray-900 dark:hover:text-gray-100"
            onClick={onClose}
          >
            ×
          </button>
        </div>

        <div className="p-4 space-y-3 text-sm">
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
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
              className="w-full px-2 py-1.5 border border-gray-300 dark:border-gray-700 rounded bg-white dark:bg-gray-800 outline-none focus:ring-1 focus:ring-blue-500"
            >
              {PROVIDERS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
              API key
            </label>
            <div className="flex gap-2">
              <input
                type={showKey ? 'text' : 'password'}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={preset.apiKeyPlaceholder}
                className="flex-1 px-2 py-1.5 border border-gray-300 dark:border-gray-700 rounded bg-white dark:bg-gray-800 outline-none focus:ring-1 focus:ring-blue-500"
                autoComplete="off"
                spellCheck={false}
              />
              <button
                className="text-xs px-2 py-1 border border-gray-300 dark:border-gray-700 rounded"
                onClick={() => setShowKey((v) => !v)}
              >
                {showKey ? 'Hide' : 'Show'}
              </button>
            </div>
            <p className="mt-1 text-xs text-gray-500">
              Stored only in this browser's localStorage. Sent as
              <code className="mx-1 px-1 rounded bg-gray-100 dark:bg-gray-800">
                Authorization: Bearer …
              </code>
              .
            </p>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
              API endpoint
            </label>
            <input
              value={apiEndpoint}
              onChange={(e) => setApiEndpoint(e.target.value)}
              placeholder={preset.defaultEndpoint}
              className="w-full px-2 py-1.5 border border-gray-300 dark:border-gray-700 rounded bg-white dark:bg-gray-800 outline-none focus:ring-1 focus:ring-blue-500 font-mono text-xs"
              spellCheck={false}
            />
            <p className="mt-1 text-xs text-gray-500">{preset.helpText}</p>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
              Model
            </label>
            <div className="flex gap-2">
              <input
                value={model}
                onChange={(e) => setModel(e.target.value)}
                list="mvp-model-list"
                className="flex-1 px-2 py-1.5 border border-gray-300 dark:border-gray-700 rounded bg-white dark:bg-gray-800 outline-none focus:ring-1 focus:ring-blue-500"
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
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
              System message
            </label>
            <textarea
              value={systemMessage}
              onChange={(e) => setSystemMessage(e.target.value)}
              rows={3}
              className="w-full px-2 py-1.5 border border-gray-300 dark:border-gray-700 rounded bg-white dark:bg-gray-800 outline-none focus:ring-1 focus:ring-blue-500 resize-none"
            />
          </div>

          <div>
            <label className="flex items-center justify-between text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
              <span>Temperature</span>
              <span className="font-mono">{temperature.toFixed(2)}</span>
            </label>
            <input
              type="range"
              min={0}
              max={2}
              step={0.05}
              value={temperature}
              onChange={(e) => setTemperature(parseFloat(e.target.value))}
              className="w-full"
            />
          </div>
        </div>

        <div className="px-4 py-3 border-t border-gray-200 dark:border-gray-800 flex justify-end gap-2">
          <button
            className="text-sm px-3 py-1.5 rounded text-gray-600 hover:bg-gray-100 dark:hover:bg-gray-800"
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            className="text-sm px-3 py-1.5 rounded bg-blue-600 text-white hover:bg-blue-700"
            onClick={save}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
