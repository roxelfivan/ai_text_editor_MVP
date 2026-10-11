/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_DEFAULT_API_ENDPOINT?: string;
  readonly VITE_DEFAULT_MODEL?: string;
  // Default provider at build time. The `google-ai-mode` option is
  // accepted but is unusual to ship as the build default — the
  // settings modal still has to be opened once to acknowledge the
  // keyless flow the first time a user lands in the app.
  readonly VITE_DEFAULT_PROVIDER?: 'minimax' | 'openai' | 'google-ai-mode';
  readonly VITE_APP_VERSION?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
