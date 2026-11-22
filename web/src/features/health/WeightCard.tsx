import { useState } from "react";
import { Segmented } from "@/components/Segmented";
import { addDays, shortLabel } from "@/lib/dates";
import { type WeightPoint, type WeightProgress } from "@/lib/health";
import { formatGrams } from "@/lib/numbers";
import { WeightChart } from "./WeightChart";

type Range = "30" | "90" | "all";

function signed(n: number): string {
  const sign = n > 0 ? "+" : "";
  return n < 0 ? `−${formatGrams(-n)}` : `${sign}${formatGrams(n)}`;
}

/** The latest weight, how far it has moved, and a trend chart. */
export function WeightCard({
  series,
  progress,
  goalKg,
  today,
  onGoal,
}: {
  series: WeightPoint[];
  progress: WeightProgress | null;
  goalKg: number | null;
  today: string;
  onGoal: () => void;
}) {
  const [range, setRange] = useState<Range>("90");
  const from = range === "all" ? "" : addDays(today, -Number(range));
  const shown = series.filter((p) => p.date >= from);
  const latest = progress?.latest;
  const summary = progress
    ? `Weight, ${formatGrams(progress.latest.kg)} kg on ${shortLabel(progress.latest.date)}, ${signed(progress.changeKg)} kg since ${shortLabel(progress.start.date)}.`
    : "No weight logged yet.";

  return (
    <section aria-labelledby="weight-h" className="grid gap-3">
      <h2 id="weight-h" className="sr-only">
        Weight
      </h2>
      {latest && progress ? (
        <>
          <div>
            <p className="font-display text-display leading-display font-semibold tracking-display">
              {formatGrams(latest.kg)}
              <small className="ml-1 font-sans text-label font-normal text-ink-2">kg</small>
            </p>
            <p className="mt-1 text-meta text-ink-2">{`Latest weighing, ${shortLabel(latest.date)}`}</p>
          </div>
          <dl className="grid grid-cols-3 gap-3 [&_dd]:mt-0.5 [&_dd]:font-display [&_dd]:text-stat [&_dd]:leading-stat [&_dd]:font-semibold [&_dd_small]:font-sans [&_dd_small]:text-micro [&_dd_small]:font-normal [&_dd_small]:text-ink-2 [&_dt]:text-meta [&_dt]:text-ink-2 [&>div]:border-t-[1.5px] [&>div]:border-ink [&>div]:pt-1.5">
            <div>
              <dt>{`Started ${shortLabel(progress.start.date)}`}</dt>
              <dd>
                {formatGrams(progress.start.kg)}
                <small> kg</small>
              </dd>
            </div>
            <div>
              <dt>Change</dt>
              <dd>
                {signed(progress.changeKg)}
                <small> kg</small>
              </dd>
            </div>
            <div>
              <dt>
                {goalKg !== null && progress.remainingKg !== null
                  ? `Goal · ${progress.remainingKg === 0 ? "reached" : `${formatGrams(progress.remainingKg)} to go`}`
                  : "Goal"}
              </dt>
              <dd>
                {goalKg === null ? (
                  <button
                    type="button"
                    className="-my-3 bg-transparent py-3 font-sans text-label font-medium text-accent underline"
                    onClick={onGoal}
                  >
                    Set a goal
                  </button>
                ) : (
                  <button
                    type="button"
                    className="-my-3 bg-transparent py-3 text-left font-display text-stat leading-stat font-semibold"
                    onClick={onGoal}
                    aria-label={`Goal ${formatGrams(goalKg)} kg. Change it`}
                  >
                    {formatGrams(goalKg)}
                    <small className="ml-1 font-sans text-micro font-normal text-ink-2">kg ›</small>
                  </button>
                )}
              </dd>
            </div>
          </dl>
          {progress.towardGoal !== null && goalKg !== null ? (
            <div className="grid gap-1">
              <span
                className="block h-[6px] overflow-hidden rounded-pill bg-surface-2"
                role="img"
                aria-label={`${Math.round(progress.towardGoal * 100)}% of the way from ${formatGrams(progress.start.kg)} kg to ${formatGrams(goalKg)} kg`}
              >
                <i
                  className="block h-full bg-accent"
                  style={{ width: `${Math.round(progress.towardGoal * 100)}%` }}
                />
              </span>
            </div>
          ) : null}
          <Segmented
            label="Weight range"
            value={range}
            options={[
              { value: "30", label: "30 days" },
              { value: "90", label: "90 days" },
              { value: "all", label: "All" },
            ]}
            onChange={setRange}
          />
          <div className="rounded-card border border-line bg-surface px-3 pt-3 pb-1">
            <p className="mb-1 px-1 text-meta font-medium text-ink-2">
              Weight in kg. Dots are weighings, the line is the 7-day average.
            </p>
            <WeightChart
              points={shown.length > 0 ? shown : series.slice(-1)}
              goalKg={goalKg}
              summary={summary}
            />
            <details className="group mt-1 border-t border-line text-meta">
              <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between text-label font-medium text-ink">
                <span>{`Readings (${series.length})`}</span>
                <span
                  className="text-glyph font-normal text-ink-3 group-open:rotate-90"
                  aria-hidden="true"
                >
                  ›
                </span>
              </summary>
              <table className="w-full border-collapse [&_td]:border-b [&_td]:border-line [&_td]:py-1.5 [&_td]:text-right [&_th]:border-b [&_th]:border-line [&_th]:py-1.5 [&_th]:text-left [&_th]:font-normal [&_thead_th]:font-semibold [&_thead_th:not(:first-child)]:text-right">
                <caption className="sr-only">Daily weights and their 7-day average</caption>
                <thead>
                  <tr>
                    <th scope="col">Date</th>
                    <th scope="col">kg</th>
                    <th scope="col">7-day average</th>
                  </tr>
                </thead>
                <tbody>
                  {[...series]
                    .reverse()
                    .slice(0, 30)
                    .map((p) => (
                      <tr key={p.date}>
                        <th scope="row">{shortLabel(p.date)}</th>
                        <td>{formatGrams(p.kg)}</td>
                        <td>{formatGrams(p.avg)}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </details>
          </div>
        </>
      ) : (
        <p className="text-body text-ink-2">
          Log your weight to see the trend. One weighing a few times a week is enough.
        </p>
      )}
      {latest && progress ? null : (
        <button
          type="button"
          className="min-h-11 justify-self-start bg-transparent p-0 text-label font-medium text-accent underline"
          onClick={onGoal}
        >
          Set a goal
        </button>
      )}
    </section>
  );
}
