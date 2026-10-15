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
