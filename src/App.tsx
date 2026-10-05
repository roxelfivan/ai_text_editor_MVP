import { useEffect, useState } from 'react';
import { useStore, useCurrentDocument } from '@/store/useStore';
import { Sidebar } from '@/components/Sidebar';
import { Editor } from '@/components/Editor';
import { ChatPanel } from '@/components/ChatPanel';
import { PromptLibrary } from '@/components/PromptLibrary';
import { RevisionHistory } from '@/components/RevisionHistory';
import { SettingsModal } from '@/components/SettingsModal';
import { EdgeAnchor } from '@/components/EdgeAnchor';

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
    <header className="h-12 px-3 flex items-center gap-2 border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-950">
      <span className="font-semibold text-sm">📝 AI Text Editor</span>
      <span className="text-xs text-gray-500">MVP</span>
      {doc && (
        <span className="ml-2 text-sm text-gray-700 dark:text-gray-300 truncate">
          · {doc.title}
        </span>
      )}
      <div className="flex-1" />
      <button
        className="text-xs px-2 py-1 rounded border border-gray-300 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800"
        onClick={onOpenRevisions}
        title="Revision history"
      >
        History
      </button>
      <button
        className="text-xs px-2 py-1 rounded border border-gray-300 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800"
        onClick={onOpenPrompts}
        title="Prompt library"
      >
        Prompts
      </button>
      <button
        className="text-xs px-2 py-1 rounded border border-gray-300 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800"
        onClick={toggleTheme}
        title="Toggle theme"
      >
        {theme === 'dark' ? '☀' : '☾'}
      </button>
      <button
        className="text-xs px-2 py-1 rounded bg-blue-600 text-white hover:bg-blue-700"
        onClick={onOpenSettings}
        title="Settings"
      >
        Settings
        {!api.apiKey && <span className="ml-1">⚠</span>}
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
    <div className="h-full flex flex-col">
      <Topbar
        onOpenSettings={() => setSettingsOpen(true)}
        onOpenPrompts={() => setPromptsOpen(true)}
        onOpenRevisions={() => setRevisionsOpen(true)}
      />
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
