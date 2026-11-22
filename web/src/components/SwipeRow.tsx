import { type PointerEvent, type ReactNode, useRef, useState } from "react";
import { useHand } from "@/db/prefs";
import { cn } from "@/lib/cn";
import { Icon } from "./Icon";
import { resolveSwipe, type SwipeAction } from "./swipe";

const MAX_PULL = 120;

/** A row that deletes on a pull toward the thumb and repeats on a pull away from it. Taps pass through untouched. */
export function SwipeRow({
  children,
  onAction,
  labels,
}: {
  children: ReactNode;
  onAction: (a: SwipeAction) => void;
  labels: Record<SwipeAction, string>;
}) {
  const hand = useHand();
  const [dx, setDx] = useState(0);
  const start = useRef<{ x: number; y: number; locked: boolean } | null>(null);
  const moved = useRef(false);

  const down = (e: PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === "mouse") return;
    start.current = { x: e.clientX, y: e.clientY, locked: false };
    moved.current = false;
  };
  const move = (e: PointerEvent<HTMLDivElement>) => {
    const s = start.current;
    if (!s) return;
    const mx = e.clientX - s.x;
    const my = e.clientY - s.y;
    if (!s.locked) {
      if (Math.abs(my) > 10 && Math.abs(my) > Math.abs(mx)) {
        start.current = null;
        return;
      }
      if (Math.abs(mx) < 10) return;
      s.locked = true;
      e.currentTarget.setPointerCapture(e.pointerId);
    }
    moved.current = true;
    setDx(Math.max(-MAX_PULL, Math.min(MAX_PULL, mx)));
  };
  const end = () => {
    const s = start.current;
    start.current = null;
    if (!s?.locked) return;
    const action = resolveSwipe(dx, hand);
    setDx(0);
    if (action) onAction(action);
  };

  const committed = resolveSwipe(dx, hand) !== null;
  const deleteSide = hand === "right" ? dx < 0 : dx > 0;
  let hint: SwipeAction | null = null;
  if (dx !== 0) hint = deleteSide ? "delete" : "repeat";
  const towardStart = dx > 0;

  return (
    <div className="relative overflow-hidden" data-swipe-row>
      {hint ? (
        <div
          className={cn(
            "absolute inset-0 flex items-center px-4 text-label font-semibold text-on-accent",
            towardStart ? "justify-start" : "justify-end",
            hint === "delete" ? "bg-red" : "bg-accent",
            committed ? "opacity-100" : "opacity-60",
          )}
          aria-hidden="true"
        >
          <Icon name={hint === "delete" ? "close" : "copy"} size={18} />
          <span className="mx-2">{labels[hint]}</span>
        </div>
      ) : null}
      <div
        className="relative touch-pan-y bg-bg"
        style={{
          transform: dx ? `translateX(${dx}px)` : undefined,
          transition: dx ? "none" : "transform 160ms ease-out",
        }}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
        onClickCapture={(e) => {
          if (moved.current) {
            e.stopPropagation();
            e.preventDefault();
            moved.current = false;
          }
        }}
      >
        {children}
      </div>
    </div>
  );
}
