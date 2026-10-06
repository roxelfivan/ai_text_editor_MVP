interface Props {
  /**
   * Which edge of the viewport this anchor is pinned to.
   * - 'left'  → at the left edge, used to reveal a hidden left sidebar
   * - 'right' → at the right edge, used to reveal a hidden right panel
   * - 'top'   → at the top edge, used to reveal a hidden top bar
   */
  side: 'left' | 'right' | 'top';
  /**
   * Whether the corresponding panel is currently collapsed (hidden).
   * When true, the anchor shows a "point inward" chevron to invite the
   * user to re-open the panel.
   */
  collapsed: boolean;
  /** Accessible label for screen readers and tooltip. */
  label: string;
  /** Click handler — toggles the panel's collapsed state. */
  onClick: () => void;
}

/**
 * Slim vertical strip pinned to the left or right edge of the main content
 * area. Always rendered so a hidden panel can be brought back with one
 * click. The chevron direction hints at the action: pointing inward when
 * the panel is collapsed (click to expand it back into the viewport), and
 * pointing outward when expanded (click to collapse it again).
 *
 * Industry pattern: VS Code's "Hide Side Bar" toggle, Figma's panel
 * disclosure buttons, Notion's sidebar peek buttons.
 */
export function EdgeAnchor({ side, collapsed, label, onClick }: Props) {
  const isLeft = side === 'left';
  const isTop = side === 'top';

  // When collapsed, point inward (toward the panel) so the user knows
  // the click will expand it. When expanded, point outward so the user
  // knows the click will collapse it.
  // left side:  collapsed → chevron-right; expanded → chevron-left
  // right side: collapsed → chevron-left;  expanded → chevron-right
  // top side:   collapsed → chevron-down;  expanded → chevron-up
  const chevron = isTop
    ? collapsed
      ? '⌄'
      : '⌃'
    : isLeft
      ? collapsed
        ? '›'
        : '‹'
      : collapsed
        ? '‹'
        : '›';

  const positionClasses = isTop
    ? 'top-0 left-1/2 -translate-x-1/2 h-5 w-16 rounded-b-md border-b-0'
    : `top-1/2 -translate-y-1/2 h-16 w-5 flex items-center justify-center rounded-r-md rounded-l-md ${isLeft ? 'border-l-0 left-0' : 'border-r-0 right-0'}`;

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={`edge-anchor group absolute z-30 flex items-center justify-center bg-white/90 dark:bg-gray-900/90 border border-gray-200 dark:border-gray-800 text-gray-500 dark:text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950/40 hover:border-blue-300 dark:hover:border-blue-700 shadow-sm transition-colors ${positionClasses}`}
    >
      <span className="text-base leading-none font-semibold select-none">
        {chevron}
      </span>
    </button>
  );
}
