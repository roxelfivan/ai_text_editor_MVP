import { useEffect, useState } from 'react';
import { useStore, useCurrentDocument } from '@/store/useStore';
import { Sidebar } from '@/components/Sidebar';
import { Editor } from '@/components/Editor';
import { ChatPanel } from '@/components/ChatPanel';
import { PromptLibrary } from '@/components/PromptLibrary';
import { RevisionHistory } from '@/components/RevisionHistory';
import { SettingsModal } from '@/components/SettingsModal';
import { EdgeAnchor } from '@/components/EdgeAnchor';

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
        src="/apeditor-logo.jpg"
        alt="ApEditor"
        className="brand-mark rounded"
      />
      <div className="flex flex-col leading-tight">
        <span className="text-xs uppercase tracking-[0.25em] font-semibold text-cyber-clay dark:text-cyber-cyan text-glow-cyan">
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
        className="btn-cyan-sm"
        onClick={onOpenRevisions}
        title="Revision history"
      >
        History
      </button>
      <button
        className="btn-cyan-sm"
        onClick={onOpenPrompts}
        title="Prompt library"
      >
        Prompts
      </button>
      <button
        className="btn-cyan-sm"
        onClick={toggleTheme}
        title="Toggle theme"
      >
        {theme === 'dark' ? '☀ Light' : '☾ Dark'}
      </button>
      <button
        className="btn-fire-sm"
        onClick={onOpenSettings}
        title="Settings"
      >
        Settings
        {!api.apiKey && <span className="ml-1 opacity-80">⚠</span>}
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
  const sidebarCollapsed = useStore((s) => s.sidebarCollapsed);
  const setSidebarCollapsed = useStore((s) => s.setSidebarCollapsed);
  const chatCollapsed = useStore((s) => s.chatCollapsed);
  const setChatCollapsed = useStore((s) => s.setChatCollapsed);
  const setChatOpen = useStore((s) => s.setChatOpen);
  const topbarCollapsed = useStore((s) => s.topbarCollapsed);
  const setTopbarCollapsed = useStore((s) => s.setTopbarCollapsed);

  // Apply theme class on first load.
  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
  }, [theme]);

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
