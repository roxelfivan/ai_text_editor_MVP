import { useRef, useState } from 'react';
import { useStore } from '@/store/useStore';
import { ResizeHandle } from '@/components/ResizeHandle';
import {
  useDragResize,
  clamp,
  MIN_SIDEBAR_WIDTH,
  MAX_SIDEBAR_WIDTH,
} from '@/hooks/useDragResize';
import { useIsNarrow } from '@/hooks/useMediaQuery';

// Clamp the persisted sidebar width on read so a stale localStorage entry
// (e.g. values written before bounds existed) cannot blow out the viewport.
const useSidebarWidth = () => {
  const raw = useStore((s) => s.layout.sidebarWidth);
  return clamp(raw, MIN_SIDEBAR_WIDTH, MAX_SIDEBAR_WIDTH);
};

export function Sidebar() {
  // IMPORTANT: all hooks (useState, useRef, useDragResize, useStore
  // selectors) must be called before any conditional return so React's
  // Rules of Hooks are satisfied on every render. The early-return
  // below intentionally lives AFTER every hook.
  const documents = useStore((s) => s.documents);
  const currentId = useStore((s) => s.currentDocumentId);
  const createDocument = useStore((s) => s.createDocument);
  const renameDocument = useStore((s) => s.renameDocument);
  const deleteDocument = useStore((s) => s.deleteDocument);
  const setCurrentDocument = useStore((s) => s.setCurrentDocument);
  const sidebarCollapsed = useStore((s) => s.sidebarCollapsed);
  const setSidebarCollapsed = useStore((s) => s.setSidebarCollapsed);
  const width = useSidebarWidth();
  const setLayout = useStore((s) => s.setLayout);
  const isNarrow = useIsNarrow();
  const containerRef = useRef<HTMLDivElement>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const { start } = useDragResize({
    mode: 'axis',
    axis: 'horizontal',
    onDelta: ({ absX }) => {
      // Sidebar's right edge follows the mouse X directly (clamped to
      // [MIN, MAX]).
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const next = clamp(absX - rect.left, MIN_SIDEBAR_WIDTH, MAX_SIDEBAR_WIDTH);
      setLayout({ sidebarWidth: next });
    },
  });

  // When the sidebar is collapsed, render nothing so the editor and
  // chat panels can take the full width. The edge-anchor toggle (rendered
  // by App.tsx) is responsible for bringing it back. This return is
  // intentionally AFTER every hook above.
  if (sidebarCollapsed) return null;

  const aside = (
    <aside
      className="h-full border-r border-paper-hairline dark:border-cyber-border flex flex-col bg-paper-panel dark:bg-ape-panel"
      style={{ width: '100%' }}
    >
      <div className="px-3 py-2 border-b border-paper-hairline dark:border-cyber-border flex items-center justify-between bg-paper-elevated/50 dark:bg-ape-elevated/40">
        <span className="text-[15px] font-medium text-paper-ink dark:text-cyber-primary">
          Documents
        </span>
        <button
          onClick={() => createDocument()}
          className="btn-fire-sm !text-[15px] !py-1.5"
          title="New document"
        >
          + New
        </button>
      </div>
      <ul className="flex-1 overflow-y-auto py-1">
        {documents.length === 0 && (
          <li className="px-3 py-4 text-sm text-paper-inkSoft dark:text-cyber-muted">
            No documents yet.
          </li>
        )}
        {documents.map((doc) => {
          const active = doc.id === currentId;
          const isEditing = editingId === doc.id;
          return (
            <li
              key={doc.id}
              className={`group flex items-center gap-1 px-2 py-1 mx-1 my-0.5 rounded cursor-pointer border-l-2 transition-colors ${
                active
                  ? 'bg-paper-elevated text-cyber-clay dark:bg-ape-elevated dark:text-cyber-cyan border-cyber-clay dark:border-cyber-cyan'
                  : 'border-transparent text-paper-ink dark:text-cyber-primary hover:bg-paper-elevated dark:hover:bg-ape-elevated hover:border-paper-hairline dark:hover:border-cyber-border'
              }`}
              onClick={() => {
                if (!isEditing) {
                  setCurrentDocument(doc.id);
                  // Overlay mode: picking a doc returns to the editor.
                  if (isNarrow) setSidebarCollapsed(true);
                }
              }}
            >
              {isEditing ? (
                <input
                  autoFocus
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onBlur={() => {
                    renameDocument(doc.id, draft || doc.title);
                    setEditingId(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      renameDocument(doc.id, draft || doc.title);
                      setEditingId(null);
                    } else if (e.key === 'Escape') {
                      setEditingId(null);
                    }
                  }}
                  className="flex-1 bg-white dark:bg-ape-base border border-cyber-clay dark:border-cyber-cyan text-paper-ink dark:text-cyber-primary rounded px-1 text-sm outline-none focus:border-cyber-clay dark:focus:shadow-ape-glow-soft"
                  onClick={(e) => e.stopPropagation()}
                />
              ) : (
                <span
                  className="flex-1 truncate text-sm"
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    setEditingId(doc.id);
                    setDraft(doc.title);
                  }}
                >
                  {doc.title || 'Untitled'}
                </span>
              )}
              {/* Always visible on touch / narrow; hover-reveal on desktop. */}
              <div className="opacity-100 sm:opacity-0 sm:group-hover:opacity-100 flex items-center gap-0.5">
                <button
                  className="text-paper-inkSoft dark:text-cyber-muted hover:text-cyber-clay dark:hover:text-cyber-cyan text-xs px-1"
                  title="Rename"
                  onClick={(e) => {
                    e.stopPropagation();
                    setEditingId(doc.id);
                    setDraft(doc.title);
                  }}
                >
                  ✎
                </button>
                <button
                  className="text-paper-inkSoft dark:text-cyber-muted hover:text-cyber-danger text-xs px-1"
                  title="Delete"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (confirm(`Delete "${doc.title}"?`)) {
                      deleteDocument(doc.id);
                    }
                  }}
                >
                  ×
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </aside>
  );

  // Narrow: full-screen drawer over the editor (not a peer column).
  if (isNarrow) {
    return (
      <div className="fixed inset-0 z-40 flex">
        <button
          type="button"
          className="absolute inset-0 bg-black/40 backdrop-blur-sm"
          aria-label="Close documents sidebar"
          onClick={() => setSidebarCollapsed(true)}
        />
        <div
          ref={containerRef}
          className="relative z-10 h-full w-[min(100%,20rem)] max-w-[85vw] shadow-ape-paper-lift dark:shadow-2xl pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]"
          role="dialog"
          aria-modal="true"
          aria-label="Documents"
        >
          {aside}
        </div>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="relative shrink-0" style={{ width }}>
      {aside}
      <ResizeHandle handle="right" onPointerDown={(e) => start('right', e)} />
    </div>
  );
}
