// Provider presets for the Settings modal.
//
// Each entry bundles the per-provider defaults that the UI needs to
// show: the default endpoint, the model presets for the datalist,
// the default model, helper text, and the API-key placeholder.
//
// The two keyed providers (minimax, openai) speak the same OpenAI
// Chat Completions wire format (see src/api/chat.ts), so the request
// layer does NOT branch on `provider` for them — this config is purely
// UI / defaults metadata for that path.
//
// The third entry (google-ai-mode) does NOT use the OpenAI wire
// format and does NOT need an API key. ChatPanel.tsx branches on its
// id to open a new tab to Google's AI Mode instead of streaming a
// completion. It still appears here so it can be selected from the
// same Settings dropdown, alongside the keyed providers, with
// consistent default-endpoint / model fallback values.
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
  {
    id: 'google-ai-mode',
    label: 'Google AI Mode (no key)',
    // AI Mode is invoked as a normal Google search with the `udm=50`
    // parameter that selects the generative-AI tab. We use the search
    // homepage as the default endpoint so the Settings "API endpoint"
    // placeholder is a real, non-empty URL; the keyless ChatPanel path
    // never reads this value, it just opens a tab with the same query.
    defaultEndpoint: 'https://www.google.com/search?udm=50',
    modelPresets: [],
    // The dummy default model string satisfies the non-empty check in
    // src/api/chat.ts's `streamChatCompletion` and is rendered in the
    // chat header. The keyless code path doesn't send it anywhere.
    defaultModel: 'google-ai-mode',
    helpText: (
      <>
        Free, no API key. Clicking <strong>Send</strong> in the chat will
        open Google AI Mode in a new browser tab with your prompt
        pre-filled. Copy the answer back into the chat to insert it as
        an assistant reply (any <code>proposed-edit</code> fences inside
        the pasted answer become track-changes cards you can accept or
        reject one by one).
      </>
    ),
    apiKeyPlaceholder: '(not used — no API key required)',
  },
];

export function getProvider(id: ApiProvider | undefined | null): ProviderPreset {
  if (!id) return PROVIDERS[0];
  return PROVIDERS.find((p) => p.id === id) ?? PROVIDERS[0];
}

/**
 * Whether the given provider requires an API key in Settings. Currently
 * only `google-ai-mode` returns false; the two keyed providers keep
 * the existing behaviour. Callers that need to gate on this (the
 * Settings modal's API-key field, the chat panel's "needs a key" affordance,
 * the first-run onboarding auto-pop, the inline-completion hook) all
 * branch on this single source of truth instead of hard-coding the
 * google-ai-mode id.
 */
export function requiresApiKey(id: ApiProvider | undefined | null): boolean {
  return id !== 'google-ai-mode';
}
