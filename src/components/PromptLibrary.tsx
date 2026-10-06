import { useState } from 'react';
import { useStore } from '@/store/useStore';

/**
 * Ask the editor to publish its current selection via the custom event
 * defined in Editor.tsx. We don't have a store for selection, so this is a
 * tiny synchronous round-trip.
 */
function readSelection(): string {
  let text = '';
  const handler = (e: Event) => {
    text = (e as CustomEvent<{ text: string }>).detail?.text ?? '';
  };
  window.addEventListener('mvp:editor-selection', handler);
  window.dispatchEvent(new Event('mvp:get-selection'));
  // The event handler runs synchronously because dispatchEvent is sync.
  window.removeEventListener('mvp:editor-selection', handler);
  return text;
}

interface Props {
  // Optional: when a prompt is "applied", put its body into the chat input.
  onApply?: (body: string) => void;
  open: boolean;
  onClose: () => void;
}

/**
 * Resolve a prompt body against the current editor selection.
 * Supports a single placeholder: {{selection}}.
 */
function resolveBody(body: string, selection: string): string {
  if (body.includes('{{selection}}')) {
    return body.replaceAll('{{selection}}', selection || '');
  }
  if (selection) {
    return `${body}\n\n"""\n${selection}\n"""`;
  }
  return body;
}

export function PromptLibrary({ onApply, open, onClose }: Props) {
  const prompts = useStore((s) => s.prompts);
  const addPrompt = useStore((s) => s.addPrompt);
  const updatePrompt = useStore((s) => s.updatePrompt);
  const deletePrompt = useStore((s) => s.deletePrompt);

  const [name, setName] = useState('');
  const [body, setBody] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);

  if (!open) return null;

  const startEdit = (id: string) => {
    const p = prompts.find((x) => x.id === id);
    if (!p) return;
    setEditingId(id);
    setName(p.name);
    setBody(p.body);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setName('');
    setBody('');
  };

  const save = () => {
    if (!body.trim()) return;
    if (editingId) {
      updatePrompt(editingId, { name: name.trim() || 'Untitled prompt', body });
    } else {
      addPrompt(name.trim() || 'Untitled prompt', body);
    }
    cancelEdit();
  };

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="w-full max-w-2xl bg-paper-panel dark:bg-ape-panel rounded-lg shadow-ape-paper-lift dark:shadow-2xl border border-paper-hairline dark:border-cyber-border flex flex-col max-h-[85vh]">
        <div className="px-4 py-3 border-b border-paper-hairline dark:border-cyber-border flex items-center bg-paper-elevated/50 dark:bg-ape-elevated/50">
          <h2 className="font-semibold text-cyber-clay dark:text-cyber-cyan uppercase tracking-wider text-sm">
            Prompt library
          </h2>
          <div className="flex-1" />
          <button
            className="text-paper-inkSoft dark:text-cyber-muted hover:text-cyber-clay dark:hover:text-cyber-cyan transition-colors text-lg leading-none"
            onClick={onClose}
            title="Close"
          >
            ×
          </button>
        </div>

        <div className="px-4 py-3 border-b border-paper-hairline dark:border-cyber-border bg-paper-base dark:bg-ape-base">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <input
              className="sm:col-span-1 ape-field"
              placeholder="Name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <textarea
              className="sm:col-span-2 ape-field resize-none h-16"
              placeholder="Prompt body. Use {{selection}} to interpolate the editor selection."
              value={body}
              onChange={(e) => setBody(e.target.value)}
            />
          </div>
          <div className="mt-2 flex justify-end gap-2">
            {editingId && (
              <button
                className="btn-ghost-sm"
                onClick={cancelEdit}
              >
                Cancel
              </button>
            )}
            <button
              className="btn-fire-sm"
              onClick={save}
              disabled={!body.trim()}
            >
              {editingId ? 'Save changes' : 'Add prompt'}
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-3 space-y-2 bg-paper-base dark:bg-ape-base">
          {prompts.length === 0 && (
            <p className="text-sm text-paper-inkSoft dark:text-cyber-muted">No prompts yet.</p>
          )}
          {prompts.map((p) => (
            <div
              key={p.id}
              className="border border-paper-hairline dark:border-cyber-border rounded p-3 bg-paper-panel dark:bg-ape-panel hover:border-cyber-clay/40 dark:hover:border-cyber-cyan/50 transition-colors"
            >
              <div className="flex items-center gap-2">
                <span className="font-medium text-sm text-paper-ink dark:text-cyber-primary">{p.name}</span>
                <div className="flex-1" />
                <button
                  className="btn-fire-sm"
                  onClick={() => {
                    const sel = readSelection();
                    onApply?.(resolveBody(p.body, sel));
                  }}
                >
                  Use
                </button>
                <button
                  className="btn-cyan-sm"
                  onClick={() => startEdit(p.id)}
                >
                  Edit
                </button>
                <button
                  className="btn-danger-sm"
                  onClick={() => {
                    if (confirm(`Delete prompt "${p.name}"?`)) deletePrompt(p.id);
                  }}
                >
                  Delete
                </button>
              </div>
              <p className="mt-1 text-sm text-paper-inkSoft dark:text-cyber-muted whitespace-pre-wrap">
                {p.body}
              </p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
