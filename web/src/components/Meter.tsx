import { cn } from "@/lib/cn";

/** Calories against the goal. The fill caps at 100 percent; over goal turns red and the text says "over". */
export function Meter({ fill, over, label }: { fill: number; over: boolean; label: string }) {
  return (
    <div
      className="meter-ticks relative mt-4 h-[9px] overflow-hidden rounded-pill bg-surface-2"
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(fill * 100)}
    >
      <i
        className={cn("block h-full rounded-pill", over ? "bg-red" : "bg-accent")}
        style={{ width: `${Math.round(fill * 100)}%` }}
      />
    </div>
  );
}
