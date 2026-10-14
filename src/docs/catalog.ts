/**
 * Help / user-guide catalog.
 *
 * Content is loaded from the repo's `docs/*.md` files via Vite's
 * `import.meta.glob(..., { query: '?raw' })` so the in-app Help pages
 * stay in sync with the markdown user guide. Edit a file under `docs/`
 * and the Help viewer picks it up on the next build / HMR refresh.
 */

export type HelpPageId =
  | 'home'
  | 'getting-started'
  | 'workspace'
  | 'documents'
  | 'writing'
  | 'comments'
  | 'chat'
  | 'proposed-edits'
  | 'prompt-library'
  | 'revisions'
  | 'import'
  | 'reference-other-documents'
  | 'settings'
  | 'keyboard-shortcuts'
  | 'privacy'
  | 'troubleshooting';

export interface HelpPageMeta {
  id: HelpPageId;
  /** Short label for the Help sidebar. */
  title: string;
  /** Basename under /docs (e.g. `getting-started.md`). */
  file: string;
}

/** Sidebar order — mirrors docs/README.md "Start here". */
export const HELP_PAGES: HelpPageMeta[] = [
  { id: 'home', title: 'User guide', file: 'README.md' },
  { id: 'getting-started', title: 'Getting started', file: 'getting-started.md' },
  { id: 'workspace', title: 'Your workspace', file: 'workspace.md' },
  { id: 'documents', title: 'Documents', file: 'documents.md' },
  { id: 'writing', title: 'Writing', file: 'writing.md' },
  { id: 'comments', title: 'Comments', file: 'comments.md' },
  { id: 'chat', title: 'Chat', file: 'chat.md' },
  { id: 'proposed-edits', title: 'Proposed edits', file: 'proposed-edits.md' },
  { id: 'prompt-library', title: 'Prompt library', file: 'prompt-library.md' },
  { id: 'revisions', title: 'Revision history', file: 'revisions.md' },
  { id: 'import', title: 'Import photos / PDFs', file: 'import.md' },
  {
    id: 'reference-other-documents',
    title: 'Reference other documents (@)',
    file: 'reference-other-documents.md',
  },
  { id: 'settings', title: 'Settings', file: 'settings.md' },
  {
    id: 'keyboard-shortcuts',
    title: 'Keyboard shortcuts',
    file: 'keyboard-shortcuts.md',
  },
  { id: 'privacy', title: 'Privacy and your data', file: 'privacy.md' },
  { id: 'troubleshooting', title: 'Troubleshooting', file: 'troubleshooting.md' },
];

const rawByPath = import.meta.glob('../../docs/*.md', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const contentByFile = new Map<string, string>();
for (const [path, content] of Object.entries(rawByPath)) {
  const file = path.split('/').pop();
  if (file) contentByFile.set(file, content);
}

export function getHelpPageContent(id: HelpPageId): string {
  const meta = HELP_PAGES.find((p) => p.id === id);
  if (!meta) return '_Page not found._';
  return contentByFile.get(meta.file) ?? `_Missing docs/${meta.file}._`;
}

export function helpPageIdFromHref(href: string): HelpPageId | null {
  // Accept `foo.md`, `./foo.md`, `foo.md#anchor`, bare `foo`.
  const cleaned = href.replace(/^\.\//, '').split('#')[0]?.trim() ?? '';
  if (!cleaned) return null;
  const file = cleaned.endsWith('.md') ? cleaned : `${cleaned}.md`;
  const page = HELP_PAGES.find((p) => p.file === file);
  return page?.id ?? null;
}

export function isHelpPageId(value: string): value is HelpPageId {
  return HELP_PAGES.some((p) => p.id === value);
}
