// Backwards-compatible barrel.
//
// Callers historically import `useStore`, `useCurrentDocument`, and
// `DEFAULT_SYSTEM_MESSAGE` from this path. The implementation now
// lives in `./store.ts` and `./types.ts`; this file re-exports the
// relevant symbols so existing `import {...} from '@/store/useStore'`
// statements continue to resolve unchanged.

export { useStore, useCurrentDocument } from './store';
export { DEFAULT_SYSTEM_MESSAGE } from '@/api/chat';
export type { EditorFocusState, StoreState } from './types';
