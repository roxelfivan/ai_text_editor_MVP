import type { PointerEvent as ReactPointerEvent } from 'react';
import type { ResizeHandle as HandleName } from '@/hooks/useDragResize';

interface Props {
  handle: HandleName;
  /** Position relative to the parent. Defaults to 'absolute' so the caller
   * just needs to make sure the parent has `position: relative`. */
  onPointerDown: (e: ReactPointerEvent<HTMLElement>) => void;
  /** Override className (e.g. for the panel dividers which use a thin
   * vertical bar with no extra position styles). */
  className?: string;
}

/**
 * Visual + interaction handle placed on one of the eight edges/corners of
 * its parent. The parent must have `position: relative` (or non-static)
 * for the absolute positioning to anchor correctly.
 *
 * Edge handles are 6px wide/tall strips; corner handles are 12x12 squares
 * for easier grabbing. Cursor matches the OS convention.
 */
export function ResizeHandle({ handle, onPointerDown, className = '' }: Props) {
  const pos = positionStyles(handle);
  return (
    <div
      role="separator"
      aria-orientation={
        handle === 'left' || handle === 'right'
          ? 'vertical'
          : handle === 'top' || handle === 'bottom'
            ? 'horizontal'
            : undefined
      }
      data-resize-handle={handle}
      onPointerDown={onPointerDown}
      className={`resize-handle resize-handle-${handle} ${className}`}
      style={{
        position: 'absolute',
        zIndex: 20,
        touchAction: 'none',
        userSelect: 'none',
        ...pos,
      }}
    />
  );
}

function positionStyles(handle: HandleName): React.CSSProperties {
  const isCorner =
    handle === 'tl' ||
    handle === 'tr' ||
    handle === 'bl' ||
    handle === 'br';
  const size = isCorner ? 12 : 6;

  switch (handle) {
    case 'right':
      return {
        top: 0,
        right: -size / 2,
        width: size,
        height: '100%',
        cursor: 'ew-resize',
      };
    case 'left':
      return {
        top: 0,
        left: -size / 2,
        width: size,
        height: '100%',
        cursor: 'ew-resize',
      };
    case 'top':
      return {
        top: -size / 2,
        left: 0,
        width: '100%',
        height: size,
        cursor: 'ns-resize',
      };
    case 'bottom':
      return {
        bottom: -size / 2,
        left: 0,
        width: '100%',
        height: size,
        cursor: 'ns-resize',
      };
    case 'tr':
      return {
        top: -size / 2,
        right: -size / 2,
        width: size,
        height: size,
        cursor: 'ne-resize',
      };
    case 'tl':
      return {
        top: -size / 2,
        left: -size / 2,
        width: size,
        height: size,
        cursor: 'nw-resize',
      };
    case 'br':
      return {
        bottom: -size / 2,
        right: -size / 2,
        width: size,
        height: size,
        cursor: 'se-resize',
      };
    case 'bl':
      return {
        bottom: -size / 2,
        left: -size / 2,
        width: size,
        height: size,
        cursor: 'sw-resize',
      };
  }
}