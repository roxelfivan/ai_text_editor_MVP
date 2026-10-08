import type { Theme } from '@/types';

/**
 * Apply the `.dark` class to `<html>` so the CSS variable theme tokens
 * resolve to the dark palette. Safe to run on the server (no-op when
 * `document` is undefined) and idempotent — repeatedly calling with the
 * same value is a no-op. Single source of truth for theme switching,
 * shared by `main.tsx` (pre-paint) and `useStore` (toggle / rehydrate).
 */
export function applyThemeClass(theme: Theme): void {
  if (typeof document === 'undefined') return;
  document.documentElement.classList.toggle('dark', theme === 'dark');
}