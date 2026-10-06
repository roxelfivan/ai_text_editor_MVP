// Provider presets for the Settings modal.
//
// Each entry bundles the per-provider defaults that the UI needs to
// show: the default endpoint, the model presets for the datalist,
// the default model, helper text, and the API-key placeholder.
//
// Both providers speak the same OpenAI Chat Completions wire format
// (see src/api/chat.ts), so the request layer does NOT branch on
// `provider` — this config is purely UI / defaults metadata.

import type { ApiProvider } from '@/types';

export interface ProviderPreset {
  id: ApiProvider;
  label: string;
  defaultEndpoint: string;
  modelPresets: string[];
  defaultModel: string;
  helpText: React.ReactNode;
  apiKeyPlaceholder: string;
}

export const PROVIDERS: ProviderPreset[] = [
  {
    id: 'minimax',
    label: 'Minimax',
    defaultEndpoint: 'https://api.minimax.io/v1',
    modelPresets: [
      'MiniMax-M3',
      'MiniMax-M3-fast',
      'MiniMax-M2.7',
      'MiniMax-M2.7-highspeed',
    ],
    defaultModel: 'MiniMax-M2.7',
    helpText: (
      <>
        OpenAI-compatible. A base URL like{' '}
        <code>https://api.minimax.io/v1</code> is fine —{' '}
        <code>/chat/completions</code> is appended automatically.
      </>
    ),
    apiKeyPlaceholder: 'Paste your Minimax API key…',
  },
  {
    id: 'openai',
    label: 'OpenAI',
    defaultEndpoint: 'https://api.openai.com/v1',
    modelPresets: [
      'gpt-4o-mini',
      'gpt-4o',
      'gpt-4-turbo',
      'o1-mini',
      'o1',
      'gpt-3.5-turbo',
    ],
    defaultModel: 'gpt-4o-mini',
    helpText: (
      <>
        Standard OpenAI endpoint. A base URL like{' '}
        <code>https://api.openai.com/v1</code> is fine —{' '}
        <code>/chat/completions</code> is appended automatically.
      </>
    ),
    apiKeyPlaceholder: 'sk-…',
  },
];

export function getProvider(id: ApiProvider | undefined | null): ProviderPreset {
  if (!id) return PROVIDERS[0];
  return PROVIDERS.find((p) => p.id === id) ?? PROVIDERS[0];
}
