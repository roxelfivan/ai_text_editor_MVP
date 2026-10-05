import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

// Apply persisted theme before first paint
try {
  const raw = localStorage.getItem('ai-text-editor-mvp');
  if (raw) {
    const parsed = JSON.parse(raw);
    const theme = parsed?.state?.theme;
    if (theme === 'dark' || theme === 'light') {
      document.documentElement.classList.add(theme);
    }
  }
} catch {
  /* ignore */
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
