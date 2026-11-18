import { cn } from "@/lib/cn";
import { copy } from "@/lib/copy";
import { formatKcal } from "@/lib/numbers";
import { type DayTotals, meterFill } from "@/lib/nutrition";
import { MacroBar } from "./MacroBar";
import { Meter } from "./Meter";

interface Props {
  totals: DayTotals;
  goalKcal: number;
  targets: { protein: number; carbs: number; fat: number };
}

export function SummaryCard({ totals, goalKcal, targets }: Props) {
  const eaten = Math.round(totals.kcal);
  const { fill, over, left } = meterFill(eaten, goalKcal);
  return (
    <section className="rounded-card border border-line bg-surface p-4" aria-label="Day summary">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p
            className={cn(
              "font-display text-display leading-display font-semibold tracking-display",
              over && "text-red",
            )}
          >
            {formatKcal(left)}
          </p>
          <p className="mt-2 text-meta text-ink-2">
            kcal {over ? copy.today.over : copy.today.left}
            {over ? (
              <span className="sr-only">{` of your ${formatKcal(goalKcal)} goal`}</span>
            ) : null}
          </p>
        </div>
        <dl className="mt-1 flex gap-4">
          <div className="text-right">
            <dt className="text-micro text-ink-2">{copy.today.eaten}</dt>
            <dd className="font-display text-stat leading-stat font-semibold">
              {formatKcal(eaten)}
            </dd>
          </div>
          <div className="text-right">
            <dt className="text-micro text-ink-2">{copy.today.goal}</dt>
            <dd className="font-display text-stat leading-stat font-semibold">
              {formatKcal(goalKcal)}
            </dd>
          </div>
        </dl>
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
        <div className="mt-3.5 grid grid-cols-2 gap-3 min-[421px]:grid-cols-4">
          <MacroBar label="Protein" value={totals.protein} target={targets.protein} />
          <MacroBar label="Carbs" value={totals.carbs} target={targets.carbs} />
          <MacroBar label="Fat" value={totals.fat} target={targets.fat} />
          <MacroBar label="Fibre" value={totals.fiber} target={0} />
        </div>
      ) : null}
      {totals.missing.length > 0 ? (
        <p className="mt-2.5 text-caption text-ink-2">{copy.today.missingMacros}</p>
      ) : null}
    </section>
  );
}
