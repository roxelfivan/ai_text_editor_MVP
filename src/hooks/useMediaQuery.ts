import { useEffect, useState } from 'react';

/**
 * Subscribe to a CSS media query. Returns the current match state and
 * updates on `change`. Safe to call during SSR / first paint: when
 * `window` is unavailable the hook returns `false`.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    const mql = window.matchMedia(query);
    const onChange = () => setMatches(mql.matches);
    onChange();
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [query]);

  return matches;
}

/** Tailwind `md` boundary: phone / small tablet portrait. */
export const NARROW_QUERY = '(max-width: 767px)';

/** Tailwind `sm` boundary: comment bottom-sheet / chip-lane breakpoint. */
export const COMMENT_SHEET_QUERY = '(max-width: 639px)';

export function useIsNarrow(): boolean {
  return useMediaQuery(NARROW_QUERY);
}

export function useIsCommentSheet(): boolean {
  return useMediaQuery(COMMENT_SHEET_QUERY);
}
