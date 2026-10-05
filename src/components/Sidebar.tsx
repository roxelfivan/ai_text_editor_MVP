import { useRef, useState } from 'react';
import { useStore } from '@/store/useStore';
import { ResizeHandle } from '@/components/ResizeHandle';
import {
  useDragResize,
  clamp,
  MIN_SIDEBAR_WIDTH,
  MAX_SIDEBAR_WIDTH,
} from '@/hooks/useDragResize';

// Clamp the persisted sidebar width on read so a stale localStorage entry
// (e.g. values written before bounds existed) cannot blow out the viewport.
const useSidebarWidth = () => {
  const raw = useStore((s) => s.layout.sidebarWidth);
  return clamp(raw, MIN_SIDEBAR_WIDTH, MAX_SIDEBAR_WIDTH);
};

export function Sidebar() {
  const documents = useStore((s) => s.documents);
  const currentId = useStore((s) => s.currentDocumentId);
  const createDocument = useStore((s) => s.createDocument);
  const renameDocument = useStore((s) => s.renameDocument);
  const deleteDocument = useStore((s) => s.deleteDocument);
  const setCurrentDocument = useStore((s) => s.setCurrentDocument);
  const width = useSidebarWidth();
  const setLayout = useStore((s) => s.setLayout);
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

  return (
    <div ref={containerRef} className="relative shrink-0" style={{ width }}>
      <aside
        className="h-full border-r border-gray-200 dark:border-gray-800 flex flex-col bg-gray-50 dark:bg-gray-900"
        style={{ width: '100%' }}
      >
        <div className="px-3 py-2 border-b border-gray-200 dark:border-gray-800 flex items-center justify-between">
          <span className="text-sm font-semibold tracking-wide uppercase text-gray-500 dark:text-gray-400">
            Documents
          </span>
          <button
            onClick={() => createDocument()}
            className="text-xs px-2 py-1 rounded bg-blue-600 text-white hover:bg-blue-700"
            title="New document"
          >
            + New
          </button>
        </div>
        <ul className="flex-1 overflow-y-auto py-1">
          {documents.length === 0 && (
            <li className="px-3 py-4 text-sm text-gray-500">No documents yet.</li>
          )}
          {documents.map((doc) => {
            const active = doc.id === currentId;
            const isEditing = editingId === doc.id;
            return (
              <li
                key={doc.id}
                className={`group flex items-center gap-1 px-2 py-1 mx-1 my-0.5 rounded cursor-pointer ${
                  active
                    ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-900 dark:text-blue-100'
                    : 'hover:bg-gray-200 dark:hover:bg-gray-800'
                }`}
                onClick={() => {
                  if (!isEditing) setCurrentDocument(doc.id);
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
                    className="flex-1 bg-white dark:bg-gray-800 border border-blue-400 rounded px-1 text-sm"
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
                <div className="opacity-0 group-hover:opacity-100 flex items-center gap-0.5">
                  <button
                    className="text-gray-500 hover:text-gray-900 dark:hover:text-gray-100 text-xs px-1"
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
                    className="text-gray-500 hover:text-red-600 text-xs px-1"
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
      <ResizeHandle handle="right" onPointerDown={(e) => start('right', e)} />
    </div>
  );
}
