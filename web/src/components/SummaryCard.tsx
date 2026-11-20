import { cn } from "@/lib/cn";
import { copy } from "@/lib/copy";
import { formatKcal } from "@/lib/numbers";
import { type DayTotals, meterFill } from "@/lib/nutrition";
import { MacroBar } from "./MacroBar";
import { Meter } from "./Meter";

interface Props {
  totals: DayTotals;
  goalKcal: number;
  targets: { protein: number; carbs: number; fat: number; fiber: number };
  /** Opens the full nutrient table for the day. */
  onDetails: () => void;
}

/** The big number is what was eaten. What is left, or how far over, is one line under it and the meter shows the same. */
export function SummaryCard({ totals, goalKcal, targets, onDetails }: Props) {
  const eaten = Math.round(totals.kcal);
  const { fill, over, left } = meterFill(eaten, goalKcal);
  return (
    <section className="rounded-card border border-line bg-surface p-4" aria-label="Day summary">
      <div className="flex items-end gap-x-4 gap-y-1">
        <p className="font-display text-display leading-display font-semibold tracking-display">
          {formatKcal(eaten)}
        </p>
        <div className="grid min-w-0 gap-0.5 pb-1">
          <p className="text-meta text-ink-2">kcal eaten</p>
          <p className={cn("text-body", over ? "font-semibold text-red" : "text-ink")}>
            {over
              ? `${formatKcal(left)} over ${formatKcal(goalKcal)}`
              : `${formatKcal(left)} left of ${formatKcal(goalKcal)}`}
          </p>
        </div>
      </div>
      <Meter
        fill={fill}
        over={over}
        label={
          over
            ? `Over goal by ${formatKcal(left)} kcal`
            : `${formatKcal(left)} kcal left of ${formatKcal(goalKcal)}`
        }
      />
      {totals.count > 0 ? (
        <div className="mt-3.5 grid grid-cols-4 gap-2.5">
          <MacroBar label="Protein" value={totals.protein} target={targets.protein} />
          <MacroBar label="Carbs" value={totals.carbs} target={targets.carbs} />
          <MacroBar label="Fat" value={totals.fat} target={targets.fat} />
          <MacroBar label="Fibre" value={totals.fiber} target={targets.fiber} />
        </div>
      ) : null}
      {totals.missing.length > 0 ? (
        <p className="mt-2.5 text-caption text-ink-2">{copy.today.missingMacros}</p>
      ) : null}
      {totals.count > 0 ? (
        <button
          type="button"
          className="mt-1 -mb-2 inline-flex min-h-11 items-center bg-transparent p-0 text-label font-medium text-accent"
          onClick={onDetails}
        >
          All nutrients
        </button>
      ) : null}
    </section>
  );
}
