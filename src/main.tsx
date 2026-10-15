import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
void App;
import type { Theme } from './types';
import { applyThemeClass } from './utils/theme';
import {
  STORE_STORAGE_KEY,
  migrateLegacyStorage,
} from './utils/storage';

// Copy legacy `ai-text-editor-mvp` keys → `apeditor` before any read.
migrateLegacyStorage();

// Apply persisted theme before first paint. ApEditor's default theme is
// light (warm cream paper); if a user has explicitly chosen dark, honour
// that.
try {
  const raw = localStorage.getItem(STORE_STORAGE_KEY);
  let theme: Theme = 'light';
  if (raw) {
    const parsed = JSON.parse(raw);
    if (parsed?.state?.theme === 'light' || parsed?.state?.theme === 'dark') {
      theme = parsed.state.theme;
    }
  }
  applyThemeClass(theme);
} catch {
  // Fall back to light on any parse error.
  applyThemeClass('light');
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
