import { useCallback, useRef } from 'react';

export type Axis = 'horizontal' | 'vertical';

export type ResizeHandle =
  | 'right'
  | 'left'
  | 'top'
  | 'bottom'
  | 'tl'
  | 'tr'
  | 'br'
  | 'bl';

interface BaseOptions {
  onDelta: (delta: {
    /** Current pointer X in CSS pixels. Consumers position an edge
     *  directly under the mouse. */
    absX: number;
    /** Current pointer Y in CSS pixels. */
    absY: number;
    /** Cumulative X delta from drag start. For relative sizing from the
     *  drag start position (e.g. card handles). */
    dx: number;
    /** Cumulative Y delta from drag start. */
    dy: number;
  }) => void;
}

interface AxisOptions extends BaseOptions {
  mode: 'axis';
  /** horizontal: dx widens/contracts; vertical: dy widens/contracts. */
  axis: Axis;
}

interface FreeOptions extends BaseOptions {
  mode: 'free';
}

type Options = AxisOptions | FreeOptions;

/**
 * Pointer-event based drag-to-resize hook.
 *
 * Returns a stable `start(handle, e)` callback that should be passed to a
 * handle's `onPointerDown`. The hook records the start position, attaches
 * `pointermove`/`pointerup`/`pointercancel` to `window`, and calls
 * `onDelta({absX, absY, dx, dy})` on every flush.
 *
 * `absX/absY` is the raw pointer position — the panel's edge tracks the
 * mouse 1:1 (the consumer just clamps to its bounds). `dx/dy` is the
 * cumulative delta from drag start, for free-form handles that resize
 * relative to the start size.
 *
 * `setPointerCapture` is used so the drag survives if the pointer leaves
 * the handle. `pointerup` is also bound on `window` so a release outside
 * the handle still terminates the drag.
 */
export function useDragResize(options: Options) {
  // Use a ref so the latest callback is reachable from window listeners
  // without re-binding them on every render.
  const optsRef = useRef(options);
  optsRef.current = options;

  const stateRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    active: boolean;
  } | null>(null);

  const start = useCallback(
    (_handle: ResizeHandle, e: React.PointerEvent<HTMLElement>) => {
      // Only react to the primary button / first touch / pen tip.
      if (!e.isPrimary) return;
      e.preventDefault();
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        /* not all targets support capture */
      }
      stateRef.current = {
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        active: true,
      };

      // Coalesce pointermove deltas via rAF so we call onDelta at most once
      // per animation frame, no matter how high the input device's Hz is.
      // This makes drags feel smoother and avoids hammering the store on
      // every move event.
      const dragStartX = e.clientX;
      const dragStartY = e.clientY;
      let pendingAbsX = e.clientX;
      let pendingAbsY = e.clientY;
      let rafId: number | null = null;
      const flush = () => {
        rafId = null;
        const absX = pendingAbsX;
        const absY = pendingAbsY;
        const dx = absX - dragStartX;
        const dy = absY - dragStartY;
        optsRef.current.onDelta({ absX, absY, dx, dy });
      };
      const scheduleFlush = () => {
        if (rafId !== null) return;
        rafId = requestAnimationFrame(flush);
      };

      const onMove = (ev: PointerEvent) => {
        const s = stateRef.current;
        if (!s || !s.active || ev.pointerId !== s.pointerId) return;
        pendingAbsX = ev.clientX;
        pendingAbsY = ev.clientY;
        scheduleFlush();
      };

      const onUp = (ev: PointerEvent) => {
        const s = stateRef.current;
        if (!s || ev.pointerId !== s.pointerId) return;
        s.active = false;
        stateRef.current = null;
        if (rafId !== null) {
          cancelAnimationFrame(rafId);
          rafId = null;
        }
        // Final flush so the last pending delta is committed (e.g. a tiny
        // sub-pixel move that didn't get its own rAF).
        flush();
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onUp);
      };

      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onUp);
    },
    []
  );

  return { start };
}

/**
 * Compute the next (width, height) given a starting size, the handle the
 * user is dragging, and the cumulative pointer delta since drag start.
 *
 * Edges resize one axis; corners resize both. The width/height is allowed
 * to go below zero — callers clamp if they want.
 */
export function applyHandle(
  handle: ResizeHandle,
  startW: number,
  startH: number,
  dx: number,
  dy: number
): { w: number; h: number } {
  let w = startW;
  let h = startH;
  // Horizontal axis: right edge / right corners grow width on +dx;
  // left edge / left corners grow width on -dx (we push the right edge).
  if (handle === 'right' || handle === 'tr' || handle === 'br') {
    w = startW + dx;
  } else if (handle === 'left' || handle === 'tl' || handle === 'bl') {
    w = startW - dx;
  }
  if (handle === 'bottom' || handle === 'bl' || handle === 'br') {
    h = startH + dy;
  } else if (handle === 'top' || handle === 'tl' || handle === 'tr') {
    h = startH - dy;
  }
  return { w, h };
}

// Bounds for resizable UI elements. Callers clamp their next width/height
// to these so panels and preview cards cannot collapse or escape the viewport.
export const MIN_SIDEBAR_WIDTH = 160;
export const MAX_SIDEBAR_WIDTH = 480;
export const MIN_CHAT_WIDTH = 280;
export const MAX_CHAT_WIDTH = 720;
export const MIN_CARD_WIDTH = 220;
export const MIN_CARD_HEIGHT = 140;
export const MAX_CARD_WIDTH = 800;
export const MAX_CARD_HEIGHT = 600;

export function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}