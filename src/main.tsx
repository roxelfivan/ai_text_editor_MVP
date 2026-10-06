import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

// Apply persisted theme before first paint. ApEditor's default theme is
// dark (cyberpunk); if a user has explicitly chosen light, honour that.
try {
  const raw = localStorage.getItem('ai-text-editor-mvp');
  let theme: 'dark' | 'light' = 'dark';
  if (raw) {
    const parsed = JSON.parse(raw);
    if (parsed?.state?.theme === 'light' || parsed?.state?.theme === 'dark') {
      theme = parsed.state.theme;
    }
  }
  document.documentElement.classList.toggle('dark', theme === 'dark');
} catch {
  // Fall back to dark on any parse error.
  document.documentElement.classList.add('dark');
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
