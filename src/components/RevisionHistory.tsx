import { useState } from 'react';
import { useStore, useCurrentDocument } from '@/store/useStore';
import { lineDiff } from '@/utils/diff';

interface Props {
  open: boolean;
  onClose: () => void;
}

export function RevisionHistory({ open, onClose }: Props) {
  const doc = useCurrentDocument();
  const revisions = useStore((s) =>
    doc ? s.revisions[doc.id] ?? [] : []
  );
  const saveRevision = useStore((s) => s.saveRevision);
  const deleteRevision = useStore((s) => s.deleteRevision);
  const restoreRevision = useStore((s) => s.restoreRevision);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [labelDraft, setLabelDraft] = useState('');

  if (!open || !doc) return null;

  const selected = revisions.find((r) => r.id === selectedId) ?? null;
  const diff = selected
    ? lineDiff(selected.content, doc.content)
    : null;

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-5xl h-[85vh] bg-white dark:bg-gray-900 rounded-lg shadow-xl flex flex-col">
        <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-800 flex items-center gap-2">
          <h2 className="font-semibold">Revisions — {doc.title}</h2>
          <div className="flex-1" />
          <button
            className="text-xs px-2 py-1 rounded border border-gray-300 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800"
            onClick={() => {
              setLabelDraft('');
              saveRevision(doc.id, labelDraft || undefined);
            }}
          >
            Snapshot now
          </button>
          <button
            className="text-gray-500 hover:text-gray-900 dark:hover:text-gray-100"
            onClick={onClose}
            title="Close"
          >
            ×
          </button>
        </div>

        <div className="flex-1 flex min-h-0">
          <div className="w-64 border-r border-gray-200 dark:border-gray-800 overflow-y-auto">
            {revisions.length === 0 && (
              <p className="p-4 text-sm text-gray-500">
                No revisions yet. Click <em>Snapshot now</em> or use{' '}
                <em>Save revision</em> in the toolbar.
              </p>
            )}
            <ul>
              {revisions
                .slice()
                .reverse()
                .map((r) => {
                  const active = r.id === selectedId;
                  return (
                    <li
                      key={r.id}
                      className={`px-3 py-2 cursor-pointer border-b border-gray-100 dark:border-gray-800 ${
                        active
                          ? 'bg-blue-50 dark:bg-blue-900/30'
                          : 'hover:bg-gray-50 dark:hover:bg-gray-800/50'
                      }`}
                      onClick={() => setSelectedId(r.id)}
                    >
                      <div className="text-sm font-medium truncate">
                        {r.label || 'Snapshot'}
                      </div>
                      <div className="text-xs text-gray-500">
                        {new Date(r.createdAt).toLocaleString()}
                      </div>
                      <div className="mt-1 flex gap-1">
                        <button
                          className="text-[10px] px-1.5 py-0.5 rounded border border-gray-300 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800"
                          onClick={(e) => {
                            e.stopPropagation();
                            if (
                              confirm(
                                'Restore this revision? Current content will be replaced (you can save a snapshot first to preserve it).'
                              )
                            ) {
                              restoreRevision(doc.id, r.id);
                            }
                          }}
                        >
                          Restore
                        </button>
                        <button
                          className="text-[10px] px-1.5 py-0.5 rounded text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40"
                          onClick={(e) => {
                            e.stopPropagation();
                            if (confirm('Delete this revision?'))
                              deleteRevision(doc.id, r.id);
                          }}
                        >
                          Delete
                        </button>
                      </div>
                    </li>
                  );
                })}
            </ul>
          </div>

          <div className="flex-1 overflow-y-auto p-4 font-mono text-xs">
            {!selected && (
              <p className="text-sm text-gray-500">
                Select a revision on the left to see a diff against the
                current document.
              </p>
            )}
            {selected && diff && (
              <div>
                <div className="mb-2 text-sm text-gray-700 dark:text-gray-300">
                  Diff: <em>{selected.label || 'Snapshot'}</em> →{' '}
                  <em>current</em>
                </div>
                <pre className="whitespace-pre-wrap">
                  {diff.map((line, i) => (
                    <div
                      key={i}
                      className={
                        line.kind === 'add'
                          ? 'diff-add'
                          : line.kind === 'remove'
                            ? 'diff-remove'
                            : ''
                      }
                    >
                      <span className="inline-block w-4 select-none opacity-60">
                        {line.kind === 'add'
                          ? '+'
                          : line.kind === 'remove'
                            ? '-'
                            : ' '}
                      </span>
                      {line.text || ' '}
                    </div>
                  ))}
                </pre>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
