/**
 * Single-document backup export.
 *
 * `buildDocumentBackup` is the pure, UI-free primitive used by
 * `FileActionsButton.tsx` to serialise a document and its associated
 * state into a single JSON blob the user can download. The goal is
 * "durable off-tab backup of one document's working state" — comments,
 * chat history, and revisions ride along with `document.content` so a
 * user can move a writing session between profiles / devices without
 * losing context.
 *
 * Shape is intentionally versioned (`schema` + `version`) so a future
 * import path can detect / upgrade older payloads. v0.5.2 ships
 * write-only — round-trip support is intentionally deferred to a
 * follow-up slice so this slice stays low-risk.
 *
 * No React imports, no DOM imports — same pattern as
 * `src/utils/comments.ts` and `src/utils/proposedEdit.ts`.
 */

import type {
  ChatMessage,
  Comment,
  DocumentRecord,
  Revision,
} from '@/types';

export const BACKUP_SCHEMA = 'apeditor-document-backup';
export const BACKUP_VERSION = 1;

export interface DocumentBackup {
  /** Stable, grep-friendly identifier so future importers can match. */
  schema: typeof BACKUP_SCHEMA;
  /** Schema version of this payload. Bump on breaking changes. */
  version: typeof BACKUP_VERSION;
  /** Epoch milliseconds when the backup was produced. */
  exportedAt: number;
  /** App version that produced the backup (informational). */
  appVersion: string;
  document: DocumentRecord;
  comments: Comment[];
  chats: ChatMessage[];
  revisions: Revision[];
}

/**
 * Build a `DocumentBackup` from the live store slices for `documentId`.
 *
 * Empty `comments` / `chats` / `revisions` arrays are still emitted so
 * the file shape stays predictable (downstream code never has to guard
 * for `undefined`).
 *
 * Returns `null` for unknown `documentId` so the caller can surface a
 * friendly error rather than writing an orphan payload.
 */
export function buildDocumentBackup(args: {
  documentId: string;
  documents: DocumentRecord[];
  comments: Record<string, Comment[]>;
  chats: Record<string, ChatMessage[]>;
  revisions: Record<string, Revision[]>;
  appVersion?: string;
}): DocumentBackup | null {
  const document = args.documents.find((d) => d.id === args.documentId);
  if (!document) return null;
  return {
    schema: BACKUP_SCHEMA,
    version: BACKUP_VERSION,
    exportedAt: Date.now(),
    appVersion: args.appVersion ?? 'unknown',
    document,
    comments: args.comments[args.documentId] ?? [],
    chats: args.chats[args.documentId] ?? [],
    revisions: args.revisions[args.documentId] ?? [],
  };
}

/**
 * Serialise a `DocumentBackup` to a pretty-printed JSON string. The
 * caller is responsible for triggering the download via
 * `downloadTextFile` from `@/utils/storage` — kept out of this module
 * so it stays DOM-free and easy to unit-test.
 */
export function serialiseDocumentBackup(backup: DocumentBackup): string {
  return JSON.stringify(backup, null, 2);
}
