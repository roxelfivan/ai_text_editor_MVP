import { useEffect, useRef, useState } from 'react';
import { useStore, useCurrentDocument } from '@/store/useStore';
import { Sidebar } from '@/components/Sidebar';
import { Editor } from '@/components/Editor';
import { ChatPanel } from '@/components/ChatPanel';
import { PromptLibrary } from '@/components/PromptLibrary';
import { RevisionHistory } from '@/components/RevisionHistory';
import { SettingsModal } from '@/components/SettingsModal';
import { HelpDocs } from '@/components/HelpDocs';
import { EdgeAnchor } from '@/components/EdgeAnchor';
import { applyThemeClass } from '@/utils/theme';
import { requiresApiKey } from '@/config/providers';
import { isHelpPageId, type HelpPageId } from '@/docs/catalog';
import { ONBOARDED_KEY } from '@/utils/storage';
import { NARROW_QUERY, useIsNarrow } from '@/hooks/useMediaQuery';

const isNarrowViewport = () =>
  typeof window !== 'undefined' && window.matchMedia(NARROW_QUERY).matches;

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
  onOpenHelp,
}: {
  onOpenSettings: () => void;
  onOpenPrompts: () => void;
  onOpenRevisions: () => void;
  onOpenHelp: () => void;
}) {
  const theme = useStore((s) => s.theme);
  const toggleTheme = useStore((s) => s.toggleTheme);
  const doc = useCurrentDocument();
  const api = useStore((s) => s.api);

  return (
    <header className="h-14 sm:h-20 px-3 sm:px-4 flex items-center gap-2 sm:gap-3 border-b border-paper-hairline dark:border-cyber-border bg-paper-base/90 dark:bg-ape-base/90 backdrop-blur-sm pt-[env(safe-area-inset-top)]">
      <img
        src="/apeditor-logo-transparent.png"
        alt="ApEditor"
        className="brand-mark brand-mark--topbar"
      />
      <div className="flex flex-col leading-tight min-w-0 shrink-0">
        <span className="display text-lg sm:text-xl text-paper-ink dark:text-cyber-primary">
          ApEditor
        </span>
        <span className="hidden sm:inline text-[10px] text-paper-inkSoft dark:text-cyber-muted font-mono">
          v{APP_VERSION}
        </span>
      </div>
      {doc && (
        <span className="ml-1 sm:ml-3 text-sm text-paper-ink dark:text-cyber-primary truncate flex items-center gap-1 min-w-0 max-w-[30vw] sm:max-w-none">
          <span className="text-paper-inkSoft dark:text-cyber-muted shrink-0">/</span>
          <span className="truncate">{doc.title}</span>
        </span>
      )}
      <div className="flex-1 min-w-2" />
      <button
        type="button"
        className="btn-icon-square shrink-0"
        onClick={onOpenHelp}
        title="Help — user guide"
        aria-label="Help — user guide"
      >
        <span className="text-base font-semibold leading-none" aria-hidden>
          ?
        </span>
      </button>
      <button
        type="button"
        className="btn-icon-square shrink-0"
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
        className="btn-icon-square shrink-0"
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
        type="button"
        className="btn-icon-square shrink-0"
        onClick={toggleTheme}
        title={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
        aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
      >
        <span className="text-base leading-none" aria-hidden>
          {theme === 'dark' ? '☀' : '☾'}
        </span>
      </button>
      <button
        type="button"
        className="btn-icon-square-fire relative shrink-0"
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
  const [helpOpen, setHelpOpen] = useState(false);
  const [helpPage, setHelpPage] = useState<HelpPageId>('home');

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
  const isNarrow = useIsNarrow();

  // Narrow viewports cannot host three peer columns. Collapse side
  // panels when we first land on — or transition into — a narrow
  // viewport so the editor owns the first paint; EdgeAnchors reopen
  // them as overlays. Skip re-collapsing while already narrow so a
  // user who opened a panel is not immediately closed again.
  const wasNarrowRef = useRef<boolean | null>(null);
  useEffect(() => {
    const wasNarrow = wasNarrowRef.current;
    wasNarrowRef.current = isNarrow;
    if (!isNarrow) return;
    if (wasNarrow === true) return;
    setSidebarCollapsed(true);
    setChatCollapsed(true);
  }, [isNarrow, setSidebarCollapsed, setChatCollapsed]);

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

  // If the active provider needs an API key and there isn't one, gently
  // prompt the user once on first load. The keyless `google-ai-mode`
  // provider is intentionally excluded from this auto-pop so first-time
  // users who already chose the no-key path are not interrupted with a
  // settings modal asking for a key.
  useEffect(() => {
    const flagged = localStorage.getItem(ONBOARDED_KEY);
    if (!flagged && requiresApiKey(api.provider) && !api.apiKey) {
      setSettingsOpen(true);
      localStorage.setItem(ONBOARDED_KEY, '1');
    }
  }, [api.apiKey, api.provider]);

  // Hotkey: ⌘/Ctrl + . opens settings; ⌘/Ctrl + , opens prompts;
  // ⌘/Ctrl + h opens history; ⌘/Ctrl + / opens Help; ⌘/Ctrl + b
  // toggles the sidebar; ⌘/Ctrl + Shift + c toggles the chat panel.
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
      } else if (e.key === '/' || e.key === '?') {
        // Help — `?` is Shift+/ on many layouts; accept both.
        e.preventDefault();
        setHelpPage('home');
        setHelpOpen(true);
      } else if (e.key.toLowerCase() === 'b') {
        e.preventDefault();
        const next = !useStore.getState().sidebarCollapsed;
        // On narrow screens only one overlay at a time.
        if (!next && isNarrowViewport()) {
          setChatCollapsed(true);
        }
        setSidebarCollapsed(next);
      } else if (e.shiftKey && e.key.toLowerCase() === 'c') {
        e.preventDefault();
        const next = !useStore.getState().chatCollapsed;
        setChatCollapsed(next);
        // When the user explicitly un-collapses via shortcut, also make
        // sure the legacy open flag is set so the panel renders.
        if (!next) {
          setChatOpen(true);
          if (isNarrowViewport()) setSidebarCollapsed(true);
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [setChatCollapsed, setChatOpen, setSidebarCollapsed]);

  // Deep-link into Help from other UI (e.g. `mvp:open-help`).
  useEffect(() => {
    const onOpenHelp = (e: Event) => {
      const detail = (e as CustomEvent<unknown>).detail;
      const page =
        typeof detail === 'string' && isHelpPageId(detail) ? detail : 'home';
      setHelpPage(page);
      setHelpOpen(true);
    };
    window.addEventListener('mvp:open-help', onOpenHelp);
    return () => window.removeEventListener('mvp:open-help', onOpenHelp);
  }, []);

  return (
    <div className="h-full flex flex-col relative">
      {!topbarCollapsed && (
        <Topbar
          onOpenSettings={() => setSettingsOpen(true)}
          onOpenPrompts={() => setPromptsOpen(true)}
          onOpenRevisions={() => setRevisionsOpen(true)}
          onOpenHelp={() => {
            setHelpPage('home');
            setHelpOpen(true);
          }}
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
          onClick={() => {
            const next = !sidebarCollapsed;
            if (!next && isNarrow) setChatCollapsed(true);
            setSidebarCollapsed(next);
          }}
        />
        <EdgeAnchor
          side="right"
          collapsed={chatCollapsed}
          label={chatCollapsed ? 'Show chat (⌘/Ctrl + Shift + C)' : 'Hide chat (⌘/Ctrl + Shift + C)'}
          onClick={() => {
            const next = !chatCollapsed;
            setChatCollapsed(next);
            // When un-collapsing, also make sure the legacy open flag
            // is set so the panel renders. On narrow screens only one
            // overlay is open at a time.
            if (!next) {
              setChatOpen(true);
              if (isNarrow) setSidebarCollapsed(true);
            }
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
      <HelpDocs
        open={helpOpen}
        initialPage={helpPage}
        onClose={() => setHelpOpen(false)}
      />
    </div>
  );
}
