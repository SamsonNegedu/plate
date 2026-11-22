import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { Button } from "@/components/Button";
import { Icon } from "@/components/Icon";
import { Segmented } from "@/components/Segmented";
import { useEntryRange, useHealthRecords, useSettings } from "@/db/hooks";
import type { Entry } from "@/db/types";
import { addDays, logicalDate, shortLabel } from "@/lib/dates";
import { formatKcal, formatOptional } from "@/lib/numbers";
import { useNow } from "@/lib/useNow";
import { BarChart } from "./BarChart";
import { DayList } from "./DayList";
import { MetricPicker } from "./MetricPicker";
import {
  buildDays,
  formatMetric,
  goalFor,
  METRICS,
  type Metric,
  movingAverage,
  summarize,
  topFoods,
  weekdayInsight,
} from "./stats";
import { TopFoods } from "./TopFoods";

type Range = "7" | "14" | "30";
const KEY = "plate.historyRange";

const asRange = (v: string | null): Range | null =>
  v === "7" || v === "14" || v === "30" ? v : null;
const asMetric = (v: string | null): Metric | null => METRICS.find((m) => m.key === v)?.key ?? null;

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
  const [params, setParams] = useSearchParams();
  // The range and the nutrient are in the address, so a view can be linked and survives a reload; the last range is the default.
  const range = asRange(params.get("range")) ?? savedRange();
  const metric = asMetric(params.get("metric")) ?? "kcal";
  const setQuery = (key: "range" | "metric", value: string) =>
    setParams(
      (p) => {
        const next = new URLSearchParams(p);
        next.set(key, value);
        return next;
      },
      { replace: true },
    );
  const [table, setTable] = useState(false);
  const now = useNow();
  const today = logicalDate(now, settings?.dayStartHour ?? 0);
  const from = addDays(today, -(Number(range) - 1));
  const warmUp = addDays(from, -6); // the first bars' 7-day average needs the week before them
  const loaded = useEntryRange(warmUp, today);
  const doses = useHealthRecords("dose");

  if (!settings || !loaded) return null;
  const entries = loaded.filter((e) => e.eatenOn >= from);
  const entriesByDay = new Map<string, Entry[]>();
  for (const e of entries) entriesByDay.set(e.eatenOn, [...(entriesByDay.get(e.eatenOn) ?? []), e]);
  const days = buildDays(entries, from, today);
  const trend = movingAverage(buildDays(loaded, warmUp, today), metric).slice(6);
  const goal = goalFor(metric, settings);
  const name = METRICS.find((m) => m.key === metric)?.label ?? "";
  const stats = summarize(days, goal, metric);
  const insight = metric === "kcal" ? weekdayInsight(days) : null;
  const top = topFoods(entries);
  const topCoverage =
    top.totalKcal > 0 ? top.foods.reduce((s, f) => s + f.kcal, 0) / top.totalKcal : 0;
  const logged = stats.daysLogged;
  const doseDays = new Set(
    (doses ?? []).filter((d) => d.recordedOn >= from).map((d) => d.recordedOn),
  );
  const unit = metric === "kcal" ? " kcal" : " g";
  const fmt = (v: number | null) => (v === null ? "—" : formatMetric(v, metric));
  const open = (d: string) => navigate(d === today ? "/today" : `/today/${d}`);

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-3.5 pb-2">
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
          setQuery("range", r);
          try {
            localStorage.setItem(KEY, r);
          } catch {
            // The range simply is not remembered.
          }
        }}
      />

      <MetricPicker value={metric} onChange={(m) => setQuery("metric", m)} />

      <section
        className="relative rounded-card border border-line bg-surface px-3 pt-3.5 pb-2"
        aria-label={`${name} per day`}
      >
        <BarChart
          days={days}
          metric={metric}
          trend={trend}
          goal={goal}
          doseDays={doseDays}
          today={today}
          onOpen={open}
        />
        {logged === 0 ? (
          <div className="pt-1 pb-2 text-center [&_p]:mb-3 [&_p]:text-body [&_p]:text-ink-2">
            <p>No days logged yet. Start with today.</p>
            <Button variant="primary" onClick={() => navigate("/scan")}>
              Scan a barcode
            </Button>
          </div>
        ) : null}
      </section>

      {insight ? (
        <p className="rounded-card border border-line bg-surface px-3.5 py-3 text-body">
          {`You eat most on ${insight.weekdays.join(" and ")}, about ${formatKcal(insight.above)} kcal above your average.`}
        </p>
      ) : null}

      <p className="-mt-0.5 text-label text-ink-2">{`Logged ${logged} of ${days.length} days.`}</p>
      <dl className={statsCls}>
        <div>
          <dt>Daily average</dt>
          <dd>
            {fmt(stats.average)}
            <small>{unit}</small>
          </dd>
        </div>
        <div>
          {stats.daysFlagged === null ? (
            <>
              <dt>Highest day</dt>
              <dd>
                {fmt(stats.peak)}
                <small>{unit}</small>
              </dd>
            </>
          ) : (
            <>
              <dt>{metric === "kcal" ? "Days over goal" : "Days goal reached"}</dt>
              <dd>{stats.daysFlagged}</dd>
            </>
          )}
        </div>
        <div>
          <dt>7-day average</dt>
          <dd>
            {fmt(stats.weekAverage)}
            <small>{unit}</small>
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
                <th scope="col">Fibre</th>
                <th scope="col">Sugar</th>
                <th scope="col">Sat. fat</th>
                <th scope="col">Salt</th>
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
                  <td>{formatOptional(d.fiber)}</td>
                  <td>{formatOptional(d.sugar)}</td>
                  <td>{formatOptional(d.satfat)}</td>
                  <td>{formatOptional(d.salt)}</td>
                  <td>{d.count}</td>
                  <td>{goalStatus(d.count, d.kcal, settings.goalKcal)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      <TopFoods foods={top.foods} coverage={topCoverage} days={days.length} />

      <DayList days={days} entriesByDay={entriesByDay} goal={settings.goalKcal} today={today} />
      <ToTop />
    </div>
  );
}

/** Appears after a long scroll and returns to the chart at the top. */
function ToTop() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const onScroll = () => setShow(window.scrollY > 700);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  if (!show) return null;
  return (
    <button
      type="button"
      className="fixed right-4 bottom-[calc(var(--tabbar-h)+env(safe-area-inset-bottom,0px)+16px)] z-20 grid size-12 place-items-center rounded-pill border border-line bg-surface text-ink shadow-[0_6px_16px_-8px_rgba(0,0,0,0.4)]"
      onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
      aria-label="Back to the top"
    >
      <Icon name="up" />
    </button>
  );
}
