import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
import type { Theme } from './types';
import { applyThemeClass } from './utils/theme';

// Apply persisted theme before first paint. ApEditor's default theme is
// light (warm cream paper); if a user has explicitly chosen dark, honour
// that.
try {
  const raw = localStorage.getItem('ai-text-editor-mvp');
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
