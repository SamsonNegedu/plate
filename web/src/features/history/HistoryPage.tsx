import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { Button } from "@/components/Button";
import { Segmented } from "@/components/Segmented";
import { useEntryRange, useSettings } from "@/db/hooks";
import { cn } from "@/lib/cn";
import { addDays, logicalDate, shortLabel } from "@/lib/dates";
import { formatKcal, formatOptional } from "@/lib/numbers";
import { useNow } from "@/lib/useNow";
import { BarChart } from "./BarChart";
import { buildDays, summarize } from "./stats";

type Range = "7" | "14" | "30";
const KEY = "plate.historyRange";

function savedRange(): Range {
  try {
    const v = localStorage.getItem(KEY);
    return v === "7" || v === "14" || v === "30" ? v : "14";
  } catch {
    return "14";
  }
}

function goalStatus(count: number, kcal: number, goal: number): string {
  if (count === 0) return "Not logged";
  return kcal > goal ? "Over goal" : "Within goal";
}

const statsCls =
  "grid grid-cols-3 gap-3 [&>div]:border-t-[1.5px] [&>div]:border-ink [&>div]:pt-1.5 [&_dt]:text-meta [&_dt]:text-ink-2 [&_dd]:mt-0.5 [&_dd]:font-display [&_dd]:text-wordmark [&_dd]:leading-figure [&_dd]:font-semibold [&_dd_small]:font-sans [&_dd_small]:text-micro [&_dd_small]:font-normal [&_dd_small]:text-ink-2";

const tableCls =
  "w-full border-collapse text-meta [&_td]:border-b [&_td]:border-line [&_td]:px-1.5 [&_td]:py-2 [&_td]:text-right [&_td]:whitespace-nowrap [&_th]:border-b [&_th]:border-line [&_th]:px-1.5 [&_th]:py-2 [&_th]:text-right [&_th]:whitespace-nowrap [&_th:first-child]:text-left [&_th:first-child]:font-semibold [&_thead_th]:text-left [&_thead_th]:font-semibold";

export default function HistoryPage() {
  const settings = useSettings();
  const navigate = useNavigate();
  const [range, setRange] = useState<Range>(savedRange);
  const [table, setTable] = useState(false);
  const now = useNow();
  const today = logicalDate(now, settings?.dayStartHour ?? 0);
  const from = addDays(today, -(Number(range) - 1));
  const entries = useEntryRange(from, today);

  if (!settings || !entries) return null;
  const days = buildDays(entries, from, today);
  const stats = summarize(days, settings.goalKcal);
  const logged = stats.daysLogged;
  const open = (d: string) => navigate(d === today ? "/today" : `/today/${d}`);

  return (
    <div className="grid gap-3.5 pb-2">
      <h1 className="mt-1 text-title font-semibold">History</h1>
      <Segmented
        label="Range"
        value={range}
        options={[
          { value: "7", label: "7 days" },
          { value: "14", label: "14 days" },
          { value: "30", label: "30 days" },
        ]}
        onChange={(r) => {
          setRange(r);
          try {
            localStorage.setItem(KEY, r);
          } catch {
            // The range simply is not remembered.
          }
        }}
      />

      <section
        className="relative rounded-card border border-line bg-surface px-3 pt-3.5 pb-2"
        aria-label="Calories per day"
      >
        <BarChart days={days} goal={settings.goalKcal} today={today} onOpen={open} />
        {logged === 0 ? (
          <div className="pt-1 pb-2 text-center [&_p]:mb-3 [&_p]:text-body [&_p]:text-ink-2">
            <p>No days logged yet. Start with today.</p>
            <Button variant="primary" onClick={() => navigate("/scan")}>
              Scan a barcode
            </Button>
          </div>
        ) : null}
      </section>

      <p className="-mt-0.5 text-label text-ink-2">{`Logged ${logged} of ${days.length} days.`}</p>
      <dl className={statsCls}>
        <div>
          <dt>Daily average</dt>
          <dd>
            {stats.averageKcal === null ? "—" : formatKcal(stats.averageKcal)}
            <small> kcal</small>
          </dd>
        </div>
        <div>
          <dt>Days over goal</dt>
          <dd>{stats.daysOver}</dd>
        </div>
        <div>
          <dt>7-day average</dt>
          <dd>
            {stats.weekAverage === null ? "—" : formatKcal(stats.weekAverage)}
            <small> kcal</small>
          </dd>
        </div>
      </dl>

      <Button onClick={() => setTable((t) => !t)}>{table ? "Hide table" : "Show table"}</Button>
      {table ? (
        <div className="overflow-x-auto">
          <table className={tableCls}>
            <caption className="sr-only">Calories and macros per day</caption>
            <thead>
              <tr>
                <th scope="col">Date</th>
                <th scope="col">kcal</th>
                <th scope="col">Protein</th>
                <th scope="col">Carbs</th>
                <th scope="col">Fat</th>
                <th scope="col">Entries</th>
                <th scope="col">Goal</th>
              </tr>
            </thead>
            <tbody>
              {[...days].reverse().map((d) => (
                <tr key={d.date}>
                  <th scope="row">{shortLabel(d.date)}</th>
                  <td>{formatKcal(d.kcal)}</td>
                  <td>{formatOptional(d.protein)}</td>
                  <td>{formatOptional(d.carbs)}</td>
                  <td>{formatOptional(d.fat)}</td>
                  <td>{d.count}</td>
                  <td>{goalStatus(d.count, d.kcal, settings.goalKcal)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      <ul aria-label="Days">
        {[...days]
          .reverse()
          .filter((d) => d.count > 0)
          .map((d) => (
            <li key={d.date}>
              <Link
                to={d.date === today ? "/today" : `/today/${d.date}`}
                className="flex min-h-13 items-center gap-2.5 border-b border-line text-ink no-underline"
              >
                <span className="flex-1 text-body">{shortLabel(d.date)}</span>
                <span className="text-meta text-ink-2">{`${d.count} ${d.count === 1 ? "entry" : "entries"}`}</span>
                <span
                  className={cn(
                    "min-w-[84px] text-right text-body font-semibold",
                    d.kcal > settings.goalKcal && "text-red",
                  )}
                >
                  {formatKcal(d.kcal)} kcal
                  {d.kcal > settings.goalKcal ? <span className="sr-only"> over goal</span> : null}
                </span>
                <span className="text-glyph text-ink-3" aria-hidden="true">
                  ›
                </span>
              </Link>
            </li>
          ))}
      </ul>
    </div>
  );
}
