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
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-2xl bg-white dark:bg-gray-900 rounded-lg shadow-xl flex flex-col max-h-[85vh]">
        <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-800 flex items-center">
          <h2 className="font-semibold">Prompt library</h2>
          <div className="flex-1" />
          <button
            className="text-gray-500 hover:text-gray-900 dark:hover:text-gray-100"
            onClick={onClose}
            title="Close"
          >
            ×
          </button>
        </div>

        <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-800">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <input
              className="sm:col-span-1 px-2 py-1.5 text-sm border border-gray-300 dark:border-gray-700 rounded bg-white dark:bg-gray-800 outline-none focus:ring-1 focus:ring-blue-500"
              placeholder="Name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <textarea
              className="sm:col-span-2 px-2 py-1.5 text-sm border border-gray-300 dark:border-gray-700 rounded bg-white dark:bg-gray-800 outline-none focus:ring-1 focus:ring-blue-500 resize-none h-16"
              placeholder="Prompt body. Use {{selection}} to interpolate the editor selection."
              value={body}
              onChange={(e) => setBody(e.target.value)}
            />
          </div>
          <div className="mt-2 flex justify-end gap-2">
            {editingId && (
              <button
                className="text-xs px-2 py-1 rounded text-gray-600 hover:bg-gray-100 dark:hover:bg-gray-800"
                onClick={cancelEdit}
              >
                Cancel
              </button>
            )}
            <button
              className="text-xs px-2 py-1 rounded bg-blue-600 text-white hover:bg-blue-700"
              onClick={save}
              disabled={!body.trim()}
            >
              {editingId ? 'Save changes' : 'Add prompt'}
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {prompts.length === 0 && (
            <p className="text-sm text-gray-500">No prompts yet.</p>
          )}
          {prompts.map((p) => (
            <div
              key={p.id}
              className="border border-gray-200 dark:border-gray-800 rounded p-3"
            >
              <div className="flex items-center gap-2">
                <span className="font-medium text-sm">{p.name}</span>
                <div className="flex-1" />
                <button
                  className="text-xs px-2 py-0.5 rounded bg-blue-600 text-white hover:bg-blue-700"
                  onClick={() => {
                    const sel = readSelection();
                    onApply?.(resolveBody(p.body, sel));
                  }}
                >
                  Use
                </button>
                <button
                  className="text-xs px-2 py-0.5 rounded border border-gray-300 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800"
                  onClick={() => startEdit(p.id)}
                >
                  Edit
                </button>
                <button
                  className="text-xs px-2 py-0.5 rounded text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40"
                  onClick={() => {
                    if (confirm(`Delete prompt "${p.name}"?`)) deletePrompt(p.id);
                  }}
                >
                  Delete
                </button>
              </div>
              <p className="mt-1 text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap">
                {p.body}
              </p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
