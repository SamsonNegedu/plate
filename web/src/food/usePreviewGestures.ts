import { type PointerEvent, useRef } from "react";

/** Two fingers zoom the camera (1 to 4x); handlers go on the element that wraps the video. */
export function usePinchZoom(zoomTo: (factor: number) => Promise<void>) {
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const start = useRef<{ dist: number; zoom: number } | null>(null);
  const zoom = useRef(1);
  const distance = () => {
    const [a, b] = [...pointers.current.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  };
  return {
    onPointerDown(e: PointerEvent<HTMLElement>) {
      if ((e.target as HTMLElement).closest("button")) return;
      pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      e.currentTarget.setPointerCapture(e.pointerId);
      if (pointers.current.size === 2) start.current = { dist: distance(), zoom: zoom.current };
    },
    onPointerMove(e: PointerEvent<HTMLElement>) {
      if (!pointers.current.has(e.pointerId)) return;
      pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const s = start.current;
      if (!s || pointers.current.size !== 2 || s.dist <= 0) return;
      zoom.current = Math.min(4, Math.max(1, s.zoom * (distance() / s.dist)));
      void zoomTo(zoom.current);
    },
    onPointerEnd(e: PointerEvent<HTMLElement>) {
      pointers.current.delete(e.pointerId);
      if (pointers.current.size < 2) start.current = null;
    },
  };
}
