/**
 * In-app Help — a documentation website overlay that renders the same
 * markdown files under `docs/`. Theme follows the app Light / Dark mode
 * (paper vs ape tokens via `html.dark`).
 */
import { useEffect, useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import type { Components } from 'react-markdown';
import { remarkPlugins, rehypePlugins } from '@/utils/markdown';
import {
  HELP_PAGES,
  getHelpPageContent,
  helpPageIdFromHref,
  isHelpPageId,
  type HelpPageId,
} from '@/docs/catalog';

interface Props {
  open: boolean;
  onClose: () => void;
  /** Optional deep-link when opening Help (defaults to home). */
  initialPage?: HelpPageId;
}

const APP_VERSION = import.meta.env.VITE_APP_VERSION ?? '0.0.0';

export function HelpDocs({ open, onClose, initialPage = 'home' }: Props) {
  const [pageId, setPageId] = useState<HelpPageId>(initialPage);

  // Reset to the requested page whenever Help is (re)opened.
  useEffect(() => {
    if (open) setPageId(initialPage);
  }, [open, initialPage]);

  // Escape closes Help (same as other overlays).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const content = useMemo(() => getHelpPageContent(pageId), [pageId]);
  const meta = HELP_PAGES.find((p) => p.id === pageId) ?? HELP_PAGES[0];

  const markdownComponents = useMemo<Components>(
    () => ({
      a: ({ href, children, ...rest }) => {
        if (href && helpPageIdFromHref(href)) {
          const target = helpPageIdFromHref(href)!;
          return (
            <a
              {...rest}
              href={href}
              onClick={(e) => {
                e.preventDefault();
                setPageId(target);
              }}
            >
              {children}
            </a>
          );
        }
        if (href?.startsWith('#')) {
          return (
            <a {...rest} href={href}>
              {children}
            </a>
          );
        }
        return (
          <a
            {...rest}
            href={href}
            target="_blank"
            rel="noopener noreferrer"
          >
            {children}
          </a>
        );
      },
    }),
    []
  );

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-40 flex flex-col bg-paper-base dark:bg-ape-base"
      role="dialog"
      aria-modal="true"
      aria-label="ApEditor help"
    >
      <header className="h-16 px-4 flex items-center gap-3 border-b border-paper-hairline dark:border-cyber-border bg-paper-surface/95 dark:bg-ape-panel/95 backdrop-blur-sm shrink-0">
        <img
          src="/apeditor-logo-transparent.png"
          alt=""
          className="brand-mark h-9 w-9 object-contain"
        />
        <div className="flex flex-col leading-tight min-w-0">
          <span className="display text-lg text-paper-ink dark:text-cyber-primary truncate">
            ApEditor Help
          </span>
          <span className="text-[10px] text-paper-inkSoft dark:text-cyber-muted font-mono">
            User guide · v{APP_VERSION}
          </span>
        </div>
        <div className="flex-1" />
        <p className="hidden sm:block text-xs text-paper-inkSoft dark:text-cyber-muted max-w-xs text-right">
          Matches the app Light / Dark theme. Same pages as{' '}
          <code className="font-mono text-[11px]">docs/</code>.
        </p>
        <button
          type="button"
          className="btn-icon-square"
          onClick={onClose}
          title="Close help (Esc)"
          aria-label="Close help"
        >
          <span className="text-lg leading-none" aria-hidden>
            ×
          </span>
        </button>
      </header>

      <div className="flex-1 flex min-h-0">
        <nav
          className="w-60 shrink-0 border-r border-paper-hairline dark:border-cyber-border overflow-y-auto bg-paper-elevated/40 dark:bg-ape-elevated/40"
          aria-label="Help topics"
        >
          <ul className="py-2">
            {HELP_PAGES.map((page) => {
              const active = page.id === pageId;
              return (
                <li key={page.id}>
                  <button
                    type="button"
                    className={`w-full text-left px-4 py-2 text-sm border-l-2 transition-colors ${
                      active
                        ? 'border-l-cyber-clay dark:border-l-cyber-cyan bg-paper-surface dark:bg-ape-panel text-cyber-clay dark:text-cyber-cyan font-semibold'
                        : 'border-l-transparent text-paper-ink dark:text-cyber-primary hover:bg-paper-elevated/80 dark:hover:bg-ape-elevated/80'
                    }`}
                    aria-current={active ? 'page' : undefined}
                    onClick={() => setPageId(page.id)}
                  >
                    {page.title}
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>

        <main className="flex-1 overflow-y-auto">
          <article className="max-w-3xl mx-auto px-6 py-8 prose-md help-docs-article">
            <p className="text-[11px] uppercase tracking-wider font-semibold text-cyber-clay dark:text-cyber-cyan mb-3 !mt-0">
              {meta.title}
            </p>
            <ReactMarkdown
              remarkPlugins={remarkPlugins}
              rehypePlugins={rehypePlugins}
              components={markdownComponents}
            >
              {content}
            </ReactMarkdown>
          </article>
        </main>
      </div>
    </div>
  );
}

/** Open Help from outside React (optional deep-link by page id). */
export function openHelpDocs(page?: HelpPageId): void {
  const detail = page && isHelpPageId(page) ? page : 'home';
  window.dispatchEvent(
    new CustomEvent('mvp:open-help', { detail })
  );
}
