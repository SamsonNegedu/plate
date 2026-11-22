import { useEffect, useState } from "react";

export const PULL_THRESHOLD = 90;

/** Pull down from the very top of the page. Returns how far the pull has gone (0 when idle); `onRefresh` runs on release past the threshold. */
export function usePullToRefresh(onRefresh: () => void, enabled: boolean): number {
  const [pull, setPull] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let startY: number | null = null;
    let last = 0;
    const down = (e: TouchEvent) => {
      const inScroller = (e.target as HTMLElement).closest("[data-no-pull],[role=dialog]");
      startY = window.scrollY <= 0 && !inScroller ? (e.touches[0]?.clientY ?? null) : null;
      last = 0;
    };
    const move = (e: TouchEvent) => {
      if (startY === null) return;
      const dy = (e.touches[0]?.clientY ?? startY) - startY;
      if (window.scrollY > 0 || dy <= 0) {
        last = 0;
        setPull(0);
        return;
      }
      last = Math.min(dy, PULL_THRESHOLD * 1.5);
      setPull(last);
    };
    const up = () => {
      if (startY !== null && last >= PULL_THRESHOLD) onRefresh();
      startY = null;
      last = 0;
      setPull(0);
    };
    window.addEventListener("touchstart", down, { passive: true });
    window.addEventListener("touchmove", move, { passive: true });
    window.addEventListener("touchend", up);
    window.addEventListener("touchcancel", up);
    return () => {
      window.removeEventListener("touchstart", down);
      window.removeEventListener("touchmove", move);
      window.removeEventListener("touchend", up);
      window.removeEventListener("touchcancel", up);
    };
  }, [onRefresh, enabled]);
  return pull;
}
