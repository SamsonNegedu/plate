import { type PointerEvent, useRef } from "react";

/** A clear sideways flick: -1 for left (next), 1 for right (previous), 0 for anything else. */
export function flickDirection(dx: number, dy: number): -1 | 0 | 1 {
  if (Math.abs(dx) < 90 || Math.abs(dx) < Math.abs(dy) * 2) return 0;
  return dx > 0 ? 1 : -1;
}

/** Sideways flicks on touch screens. Rows that handle their own swipes are marked data-swipe-row and skipped. */
export function useFlick(onFlick: (dir: -1 | 1) => void) {
  const start = useRef<{ x: number; y: number } | null>(null);
  return {
    onPointerDown(e: PointerEvent<HTMLElement>) {
      const t = e.target as HTMLElement;
      start.current =
        e.pointerType === "touch" && !t.closest("[data-swipe-row],input,textarea,[role=slider]")
          ? { x: e.clientX, y: e.clientY }
          : null;
    },
    onPointerUp(e: PointerEvent<HTMLElement>) {
      const s = start.current;
      start.current = null;
      if (!s) return;
      const dir = flickDirection(e.clientX - s.x, e.clientY - s.y);
      if (dir) onFlick(dir);
    },
    onPointerCancel() {
      start.current = null;
    },
  };
}
