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
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="w-full max-w-5xl h-[85vh] bg-paper-panel dark:bg-ape-panel rounded-lg shadow-ape-paper-lift dark:shadow-2xl border border-paper-hairline dark:border-cyber-border flex flex-col">
        <div className="px-4 py-3 border-b border-paper-hairline dark:border-cyber-border flex items-center gap-2 bg-paper-elevated/50 dark:bg-ape-elevated/50">
          <h2 className="font-semibold text-cyber-clay dark:text-cyber-cyan uppercase tracking-wider text-sm">
            Revisions — <span className="text-paper-ink dark:text-cyber-primary normal-case tracking-normal">{doc.title}</span>
          </h2>
          <div className="flex-1" />
          <button
            className="btn-fire-sm"
            onClick={() => {
              setLabelDraft('');
              saveRevision(doc.id, labelDraft || undefined);
            }}
          >
            Snapshot now
          </button>
          <button
            className="text-paper-inkSoft dark:text-cyber-muted hover:text-cyber-clay dark:hover:text-cyber-cyan transition-colors text-lg leading-none"
            onClick={onClose}
            title="Close"
          >
            ×
          </button>
        </div>

        <div className="flex-1 flex min-h-0">
          <div className="w-64 border-r border-paper-hairline dark:border-cyber-border overflow-y-auto bg-paper-base dark:bg-ape-base">
            {revisions.length === 0 && (
              <p className="p-4 text-sm text-paper-inkSoft dark:text-cyber-muted">
                No revisions yet. Click <em className="text-cyber-clay dark:text-cyber-cyan not-italic font-semibold">Snapshot now</em> or use{' '}
                <em className="text-cyber-clay dark:text-cyber-cyan not-italic font-semibold">Save revision</em> in the toolbar.
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
                      className={`px-3 py-2 cursor-pointer border-b border-paper-hairline dark:border-cyber-border border-l-2 transition-colors ${
                        active
                          ? 'bg-paper-elevated dark:bg-ape-elevated border-l-cyber-clay dark:border-l-cyber-cyan'
                          : 'border-l-transparent hover:bg-paper-elevated/60 dark:hover:bg-ape-elevated/60'
                      }`}
                      onClick={() => setSelectedId(r.id)}
                    >
                      <div className="text-sm font-medium truncate text-paper-ink dark:text-cyber-primary">
                        {r.label || 'Snapshot'}
                      </div>
                      <div className="text-xs text-paper-inkSoft dark:text-cyber-muted font-mono">
                        {new Date(r.createdAt).toLocaleString()}
                      </div>
                      <div className="mt-1 flex gap-1">
                        <button
                          className="btn-cyan-sm text-[10px] px-1.5 py-0.5"
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
                          className="btn-danger-sm text-[10px] px-1.5 py-0.5"
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

          <div className="flex-1 overflow-y-auto p-4 font-mono text-xs bg-paper-base dark:bg-ape-base">
            {!selected && (
              <p className="text-sm text-paper-inkSoft dark:text-cyber-muted">
                Select a revision on the left to see a diff against the
                current document.
              </p>
            )}
            {selected && diff && (
              <div>
                <div className="mb-2 text-sm text-paper-inkSoft dark:text-cyber-muted">
                  Diff: <em className="text-paper-ink dark:text-cyber-primary not-italic font-semibold">{selected.label || 'Snapshot'}</em> →{' '}
                  <em className="text-cyber-clay dark:text-cyber-cyan not-italic font-semibold">current</em>
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
