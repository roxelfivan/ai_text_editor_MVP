/**
 * Browser storage namespace for ApEditor.
 *
 * Historically keys used the `ai-text-editor-mvp` prefix. After the
 * project rename to `apeditor`, new writes use `apeditor` /
 * `apeditor:*`. `migrateLegacyStorage()` copies old keys once so
 * returning users keep documents, settings, and UI prefs.
 */

export const STORAGE_PREFIX = 'apeditor';
export const LEGACY_STORAGE_PREFIX = 'ai-text-editor-mvp';

/** Zustand persist blob (documents, chat, API config, …). */
export const STORE_STORAGE_KEY = STORAGE_PREFIX;

export const ONBOARDED_KEY = `${STORAGE_PREFIX}:onboarded`;
/** sessionStorage copy of the API key when "forget on close" is on. */
export const API_KEY_SESSION_KEY = `${STORAGE_PREFIX}:session-api-key`;
export const CHAT_MESSAGES_HEIGHT_KEY = `${STORAGE_PREFIX}:chat-messages-height`;
export const SUGGESTION_HEIGHT_KEY = `${STORAGE_PREFIX}:suggestion-height`;

export const SETTINGS_SIZE_KEYS = {
  modal: `${STORAGE_PREFIX}:settings-modal-size`,
  systemMsg: `${STORAGE_PREFIX}:settings-system-msg-size`,
  rationaleRules: `${STORAGE_PREFIX}:settings-rationale-rules-size`,
} as const;

export function peSplitKey(splitStorageKey: string): string {
  return `${STORAGE_PREFIX}:pe-split:${splitStorageKey}`;
}

export function popoverSizeKey(commentId: string): string {
  return `${STORAGE_PREFIX}:popover-size:${commentId}`;
}

// ---------------------------------------------------------------------------
// File-export helpers. ApEditor stores documents in localStorage, which can
// be wiped (browser data clear, private-mode expiry, quota eviction). The
// only durable off-tab backup a non-technical user has today is the
// browser's full-state export; that loses comments, chat, and revisions
// in a way that round-trips poorly. `downloadTextFile` is the smallest
// primitive that lets the rest of the app offer a one-click Markdown
// (and later JSON) export without each callsite re-implementing Blob +
// anchor-click plumbing.
// ---------------------------------------------------------------------------

/**
 * Sanitise a string so it is safe to use as the basename of a download.
 *
 * - Strips directory separators and reserved Windows characters.
 * - Collapses internal whitespace to a single space.
 * - Trims surrounding whitespace.
 * - Falls back to `"untitled"` if the result is empty.
 *
 * We deliberately do NOT add a timestamp suffix here — callers control
 * their filename (and may want a stable name for re-import on a future
 * slice).
 */
export function sanitizeFilename(name: string, fallback = 'untitled'): string {
  if (!name) return fallback;
  // Strip path separators and Windows-reserved characters.
  const cleaned = name
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  // Cap length so a 4 KB document title can't produce a 4 KB filename.
  const trimmed = cleaned.slice(0, 80);
  return trimmed.length > 0 ? trimmed : fallback;
}

/**
 * Trigger a browser download of `content` as a file named `filename`.
 *
 * Uses the classic `Blob` + `URL.createObjectURL` + invisible `<a>`
 * click pattern. The anchor is appended to the DOM and removed on the
 * next tick so the browser actually fires the click in some engines
 * (Firefox in particular won't honour the click on a detached element).
 * The URL is revoked after a short delay so the download has time to
 * start before the blob is detached.
 *
 * No-op outside the browser (SSR, tests). Errors are swallowed — the
 * download UX degrades silently rather than crashing the calling
 * surface (e.g. an Export button click).
 */
export function downloadTextFile(
  filename: string,
  content: string,
  mime = 'text/plain;charset=utf-8'
): void {
  if (typeof document === 'undefined' || typeof URL === 'undefined') return;
  try {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.rel = 'noopener';
    // Some browsers ignore programmatic .click() on detached anchors.
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    // Defer cleanup so the download has a chance to start.
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 0);
  } catch {
    /* ignore — download UX degrades silently */
  }
}

/**
 * One-time copy of legacy `ai-text-editor-mvp` keys → `apeditor`.
 * Safe to call on every boot: no-ops when already migrated or when
 * there is nothing to copy. Must run before the store / theme read.
 */
export function migrateLegacyStorage(): void {
  try {
    if (typeof localStorage === 'undefined') return;

    // Main zustand blob: only copy if the new key is absent.
    if (
      localStorage.getItem(STORE_STORAGE_KEY) === null &&
      localStorage.getItem(LEGACY_STORAGE_PREFIX) !== null
    ) {
      localStorage.setItem(
        STORE_STORAGE_KEY,
        localStorage.getItem(LEGACY_STORAGE_PREFIX)!
      );
    }

    // Snapshot keys first — writing during a live localStorage walk
    // can skip entries as length changes.
    const legacyColon = `${LEGACY_STORAGE_PREFIX}:`;
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key) keys.push(key);
    }

    for (const key of keys) {
      if (key === LEGACY_STORAGE_PREFIX) {
        localStorage.removeItem(key);
        continue;
      }
      if (!key.startsWith(legacyColon)) continue;

      const next = `${STORAGE_PREFIX}:${key.slice(legacyColon.length)}`;
      if (localStorage.getItem(next) === null) {
        const value = localStorage.getItem(key);
        if (value !== null) localStorage.setItem(next, value);
      }
      localStorage.removeItem(key);
    }
  } catch {
    // Quota / private mode / blocked storage — boot without migration.
  }
}

export function readSessionApiKey(): string {
  try {
    if (typeof sessionStorage === 'undefined') return '';
    return sessionStorage.getItem(API_KEY_SESSION_KEY) ?? '';
  } catch {
    return '';
  }
}

export function writeSessionApiKey(key: string): void {
  try {
    if (typeof sessionStorage === 'undefined') return;
    if (key) sessionStorage.setItem(API_KEY_SESSION_KEY, key);
    else sessionStorage.removeItem(API_KEY_SESSION_KEY);
  } catch {
    /* private mode / quota */
  }
}

export function clearSessionApiKey(): void {
  writeSessionApiKey('');
}
