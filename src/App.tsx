import { useEffect, useState } from 'react';
import { useStore, useCurrentDocument } from '@/store/useStore';
import { Sidebar } from '@/components/Sidebar';
import { Editor } from '@/components/Editor';
import { ChatPanel } from '@/components/ChatPanel';
import { PromptLibrary } from '@/components/PromptLibrary';
import { RevisionHistory } from '@/components/RevisionHistory';
import { SettingsModal } from '@/components/SettingsModal';
import { EdgeAnchor } from '@/components/EdgeAnchor';
import { applyThemeClass } from '@/utils/theme';

// Inputs that are safe to treat as "the user is typing" for the purpose
// of deferring global shortcuts. Lifted to module scope so the regex
// is compiled once per app lifetime rather than once per keystroke.
const TEXT_INPUT_TYPES =
  /^(text|search|email|url|tel|password|number)$/;

// APP_VERSION is injected at build time from package.json via Vite's
// `define` config (see vite.config.ts). Keeping the source of truth in
// package.json means the topbar always matches the published version.
const APP_VERSION = import.meta.env.VITE_APP_VERSION ?? '0.0.0';

function Topbar({
  onOpenSettings,
  onOpenPrompts,
  onOpenRevisions,
}: {
  onOpenSettings: () => void;
  onOpenPrompts: () => void;
  onOpenRevisions: () => void;
}) {
  const theme = useStore((s) => s.theme);
  const toggleTheme = useStore((s) => s.toggleTheme);
  const doc = useCurrentDocument();
  const api = useStore((s) => s.api);

  return (
    <header className="h-20 px-4 flex items-center gap-3 border-b border-paper-hairline dark:border-cyber-border bg-paper-base/90 dark:bg-ape-base/90 backdrop-blur-sm">
      <img
        src="/apeditor-logo-transparent.png"
        alt="ApEditor"
        className="brand-mark"
      />
      <div className="flex flex-col leading-tight">
        <span className="display text-xl text-paper-ink dark:text-cyber-primary">
          ApEditor
        </span>
        <span className="text-[10px] text-paper-inkSoft dark:text-cyber-muted font-mono">v{APP_VERSION}</span>
      </div>
      {doc && (
        <span className="ml-3 text-sm text-paper-ink dark:text-cyber-primary truncate flex items-center gap-1">
          <span className="text-paper-inkSoft dark:text-cyber-muted">/</span>
          <span className="truncate">{doc.title}</span>
        </span>
      )}
      <div className="flex-1" />
      <button
        type="button"
        className="btn-icon-square"
        onClick={onOpenRevisions}
        title="Revision history"
        aria-label="Revision history"
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 16 16"
          className="h-4 w-4"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          {/* Clock: revision history. */}
          <circle cx="8" cy="8" r="5.5" />
          <path d="M8 5.2 V8.1 L10.3 9.6" />
        </svg>
      </button>
      <button
        type="button"
        className="btn-icon-square"
        onClick={onOpenPrompts}
        title="Prompt library"
        aria-label="Prompt library"
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 16 16"
          className="h-4 w-4"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          {/* Bookmark: saved prompts. */}
          <path d="M4 2.5 H12 V13.5 L8 11 L4 13.5 Z" />
        </svg>
      </button>
      <button
        className="btn-cyan-sm !text-[15px] !py-1.5"
        onClick={toggleTheme}
        title="Toggle theme"
      >
        {theme === 'dark' ? '☀ Light' : '☾ Dark'}
      </button>
      <button
        type="button"
        className="btn-icon-square-fire relative"
        onClick={onOpenSettings}
        title="Settings"
        aria-label={api.apiKey ? 'Settings' : 'Settings (API key missing)'}
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          className="h-4 w-4"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          {/* Gear: settings. */}
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09A1.65 1.65 0 0 0 15 4.6a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09A1.65 1.65 0 0 0 19.4 15z" />
        </svg>
        {!api.apiKey && (
          <span
            className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-amber-400"
            aria-hidden="true"
          />
        )}
      </button>
    </header>
  );
}

export default function App() {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [promptsOpen, setPromptsOpen] = useState(false);
  const [revisionsOpen, setRevisionsOpen] = useState(false);

  const theme = useStore((s) => s.theme);
  const api = useStore((s) => s.api);
  const uiFontSize = useStore((s) => s.uiFontSize);
  const sidebarCollapsed = useStore((s) => s.sidebarCollapsed);
  const setSidebarCollapsed = useStore((s) => s.setSidebarCollapsed);
  const chatCollapsed = useStore((s) => s.chatCollapsed);
  const setChatCollapsed = useStore((s) => s.setChatCollapsed);
  const setChatOpen = useStore((s) => s.setChatOpen);
  const topbarCollapsed = useStore((s) => s.topbarCollapsed);
  const setTopbarCollapsed = useStore((s) => s.setTopbarCollapsed);

  // Sync the `<html>` class whenever the theme changes.
  useEffect(() => {
    applyThemeClass(theme);
  }, [theme]);

  // Sync the `<html>` base font-size whenever the global UI font size
  // setting changes. Every `rem`-based Tailwind text utility
  // (text-xs, text-sm, text-[11px], …) resolves against this value, so
  // the entire app's UI text scales uniformly. The editor subtree
  // overrides the cascade with its own explicit `font-size`, so it is
  // unaffected.
  useEffect(() => {
    document.documentElement.style.fontSize = `${uiFontSize}px`;
  }, [uiFontSize]);

  // If there's no API key, gently prompt the user once on first load.
  useEffect(() => {
    const flagged = localStorage.getItem('ai-text-editor-mvp:onboarded');
    if (!flagged && !api.apiKey) {
      setSettingsOpen(true);
      localStorage.setItem('ai-text-editor-mvp:onboarded', '1');
    }
  }, [api.apiKey]);

  // Hotkey: ⌘/Ctrl + . opens settings; ⌘/Ctrl + , opens prompts;
  // ⌘/Ctrl + h opens history; ⌘/Ctrl + b toggles the sidebar;
  // ⌘/Ctrl + Shift + c toggles the chat panel.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      // Defer to the focused editor's own keyboard shortcuts when the
      // event originated inside an editable element. Otherwise Ctrl+B
      // would also collapse the sidebar while the user is just trying
      // to bold some text, and any future editor shortcut (Ctrl+I,
      // Ctrl+U, etc.) would be at risk of the same conflict.
      const t = e.target as HTMLElement | null;
      const editable =
        t instanceof HTMLTextAreaElement ||
        // text-ish inputs only; checkboxes / radios / buttons keep
        // the global shortcuts.
        (t instanceof HTMLInputElement && TEXT_INPUT_TYPES.test(t.type)) ||
        (t?.isContentEditable ?? false);
      if (editable) return;
      if (e.key === '.') {
        e.preventDefault();
        setSettingsOpen(true);
      } else if (e.key === ',') {
        e.preventDefault();
        setPromptsOpen(true);
      } else if (e.key.toLowerCase() === 'h') {
        e.preventDefault();
        setRevisionsOpen(true);
      } else if (e.key.toLowerCase() === 'b') {
        e.preventDefault();
        setSidebarCollapsed(!useStore.getState().sidebarCollapsed);
      } else if (e.shiftKey && e.key.toLowerCase() === 'c') {
        e.preventDefault();
        const next = !useStore.getState().chatCollapsed;
        setChatCollapsed(next);
        // When the user explicitly un-collapses via shortcut, also make
        // sure the legacy open flag is set so the panel renders.
        if (!next) setChatOpen(true);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [setChatCollapsed, setChatOpen, setSidebarCollapsed]);

  return (
    <div className="h-full flex flex-col relative">
      {!topbarCollapsed && (
        <Topbar
          onOpenSettings={() => setSettingsOpen(true)}
          onOpenPrompts={() => setPromptsOpen(true)}
          onOpenRevisions={() => setRevisionsOpen(true)}
        />
      )}
      <div className="flex-1 flex min-h-0 relative">
        <Sidebar />
        <Editor />
        <ChatPanel />
        {/* Edge-anchor toggles: a single always-visible chevron strip on
            each side acts as both the hide and the show button. The
            chevron direction reflects the current state. */}
        <EdgeAnchor
          side="left"
          collapsed={sidebarCollapsed}
          label={sidebarCollapsed ? 'Show sidebar (⌘/Ctrl + B)' : 'Hide sidebar (⌘/Ctrl + B)'}
          onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
        />
        <EdgeAnchor
          side="right"
          collapsed={chatCollapsed}
          label={chatCollapsed ? 'Show chat (⌘/Ctrl + Shift + C)' : 'Hide chat (⌘/Ctrl + Shift + C)'}
          onClick={() => {
            const next = !chatCollapsed;
            setChatCollapsed(next);
            // When un-collapsing, also make sure the legacy open flag
            // is set so the panel renders.
            if (!next) setChatOpen(true);
          }}
        />
      </div>
      {/* Top-anchor is rendered as a sibling of the Topbar (not inside the
          content row) so its `absolute top-0` resolves to the very top of
          the page — the same upper edge of the topbar — regardless of
          whether the topbar is currently visible. */}
      <EdgeAnchor
        side="top"
        collapsed={topbarCollapsed}
        label={topbarCollapsed ? 'Show topbar' : 'Hide topbar'}
        onClick={() => setTopbarCollapsed(!topbarCollapsed)}
      />

      <SettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
      />
      <PromptLibrary
        open={promptsOpen}
        onClose={() => setPromptsOpen(false)}
        onApply={(body) =>
          window.dispatchEvent(new CustomEvent('mvp:fill-chat', { detail: body }))
        }
      />
      <RevisionHistory
        open={revisionsOpen}
        onClose={() => setRevisionsOpen(false)}
      />
    </div>
  );
}
