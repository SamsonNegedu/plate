import { useState } from "react";
import { cn } from "@/lib/cn";
import { shortLabel } from "@/lib/dates";
import {
  amountText,
  type DayPoint,
  formatMetric,
  labelEvery,
  METRICS,
  type Metric,
  unitOf,
  niceMax,
  valueOf,
  monotonePath,
  yFor,
} from "./stats";

interface Props {
  days: DayPoint[];
  metric: Metric;
  /** Rolling 7-day mean, one per day; null breaks the line. */
  trend: Array<number | null>;
  /** Null when there is no goal: no line is drawn. */
  goal: number | null;
  /** Days a medication dose was taken; each gets a small mark under the axis. */
  doseDays?: ReadonlySet<string>;
  today: string;
  onOpen: (date: string) => void;
}

const W = 360;
const H = 210;
const LEFT = 34;
const RIGHT = 8;
const TOP = 14;
const BOTTOM = 178;
const GAP = 2;
/** A bar never gets wider than this, so a 7-day chart is not made of slabs. */
const MAX_BAR = 20;

/**
 * One series, one y-axis, zero baseline. Bars have 4 px rounded top corners and a 2 px gap. The goal is a dashed line with a
 * surface halo. Red marks over-goal days and is always also stated in words (tooltip, table, aria-label).
 */
export function BarChart({ days, metric, trend, goal, doseDays, today, onOpen }: Props) {
  const [active, setActive] = useState<string | null>(null);
  const limit = metric === "kcal";
  const name = METRICS.find((m) => m.key === metric)?.label ?? "";
  const values = days.map((d) => valueOf(d, metric));
  const max = niceMax(
    Math.max(
      (goal ?? 0) * 1.1,
      ...values.map((v) => (v ?? 0) * 1.08),
      ...trend.map((v) => (v ?? 0) * 1.08),
    ),
    metric,
  );
  const slot = (W - LEFT - RIGHT) / days.length;
  const barW = Math.min(MAX_BAR, Math.max(2, slot - GAP));
  const every = labelEvery(days.length);
  const ticks = [0, max / 2, max];
  const goalY = goal === null ? 0 : yFor(goal, max, TOP, BOTTOM);
  const activeDay = days.find((d) => d.date === active);
  const legend = `${goal === null ? "" : "Dashed line: your goal. "}${doseDays && doseDays.size > 0 ? "▲ marks a dose day. " : ""}${goal === null ? "The line" : "Solid line"} is the 7-day average. Tap or focus a bar for details.`;
  const trendEnd = trendSegments(trend, slot, max).at(-1)?.at(-1);

  return (
    <figure>
      <p className="mb-1 px-1 text-meta font-medium text-ink-2">
        {`${name}, ${unitOf(metric)} a day`}
      </p>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="group"
        aria-label={`${name} per day for the last ${days.length} days.${goal === null ? "" : ` Goal ${formatMetric(goal, metric)}.`}`}
        className="block h-auto w-full overflow-visible"
      >
        {ticks.map((t) => (
          <g key={t}>
            <line
              x1={LEFT}
              x2={W - RIGHT}
              y1={yFor(t, max, TOP, BOTTOM)}
              y2={yFor(t, max, TOP, BOTTOM)}
              className={t === 0 ? "stroke-ink-3 stroke-1" : "stroke-line stroke-1"}
            />
            <text
              x={LEFT - 6}
              y={yFor(t, max, TOP, BOTTOM) + 4}
              textAnchor="end"
              className="fill-ink-3 font-sans text-axis"
            >
              {formatMetric(t, metric)}
            </text>
          </g>
        ))}

        {days.map((d, i) => {
          const value = values[i] ?? null;
          const x = LEFT + i * slot + (slot - barW) / 2;
          const over = limit && goal !== null && value !== null && value > goal;
          const y = yFor(value ?? 0, max, TOP, BOTTOM);
          const h = BOTTOM - y;
          const label = describe(d, value, metric, goal, doseDays?.has(d.date) ?? false);
          return (
            <g
              key={d.date}
              role="button"
              tabIndex={0}
              aria-label={label}
              onMouseEnter={() => setActive(d.date)}
              onMouseLeave={() => setActive(null)}
              onFocus={() => setActive(d.date)}
              onBlur={() => setActive(null)}
              onClick={() => onOpen(d.date)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onOpen(d.date);
                }
              }}
              className="group cursor-pointer outline-none"
            >
              <rect
                x={LEFT + i * slot}
                y={TOP}
                width={slot}
                height={BOTTOM - TOP}
                className={
                  d.date === active
                    ? "fill-accent opacity-10"
                    : "fill-transparent group-focus-visible:fill-accent group-focus-visible:stroke-accent group-focus-visible:stroke-[1.5px] group-focus-visible:opacity-[0.22]"
                }
              />
              {value !== null && value > 0 ? (
                <path
                  d={roundedTop(x, y, barW, h, 3)}
                  className={over ? "fill-red" : "fill-accent"}
                />
              ) : null}
              {d.date === today ? (
                <text
                  x={x + barW / 2}
                  y={Math.max(y - 4, TOP - 2)}
                  textAnchor="middle"
                  className="fill-ink font-sans text-chart font-semibold"
                >
                  {value === null ? "" : formatMetric(value, metric)}
                </text>
              ) : null}
              {doseDays?.has(d.date) ? (
                <path
                  d={`M${x + barW / 2 - 4} ${BOTTOM + 11}L${x + barW / 2 + 4} ${BOTTOM + 11}L${x + barW / 2} ${BOTTOM + 4}Z`}
                  className="fill-ink"
                />
              ) : null}
            </g>
          );
        })}

        {trendSegments(trend, slot, max).map((seg) => (
          <path
            key={seg[0]?.join(",")}
            d={monotonePath(seg)}
            fill="none"
            className="stroke-ink stroke-[1.5px] [stroke-linecap:round] [stroke-linejoin:round]"
          />
        ))}
        {trendEnd ? (
          <circle
            cx={trendEnd[0]}
            cy={trendEnd[1]}
            r={3}
            className="fill-ink stroke-surface stroke-[1.5px]"
          />
        ) : null}

        {goal === null ? null : (
          <>
            <line
              x1={LEFT}
              x2={W - RIGHT}
              y1={goalY}
              y2={goalY}
              className="stroke-ink-2 stroke-1 [stroke-dasharray:4_3]"
            />
            <text
              x={LEFT - 6}
              y={goalY + 4}
              textAnchor="end"
              className="fill-ink font-sans text-axis font-semibold"
            >
              {formatMetric(goal, metric)}
            </text>
          </>
        )}

        {days.map((d, i) =>
          (days.length - 1 - i) % every === 0 ? (
            <text
              key={d.date}
              x={LEFT + i * slot + slot / 2}
              y={H - 10}
              textAnchor="middle"
              className="fill-ink-3 font-sans text-axis"
            >
              {d.date === today ? "today" : String(Number(d.date.slice(8)))}
            </text>
          ) : null,
        )}
      </svg>
      <figcaption className="mt-1.5 grid text-meta text-ink-2" aria-live="polite">
        {/* Both texts sit in one cell, so the card keeps the taller one's height and never jumps when a bar is focused. */}
        <span
          className={cn("col-start-1 row-start-1", activeDay && "invisible")}
          aria-hidden={activeDay ? true : undefined}
        >
          {legend}
        </span>
        <span
          className={cn("col-start-1 row-start-1", !activeDay && "invisible")}
          aria-hidden={activeDay ? undefined : true}
        >
          {activeDay
            ? describe(
                activeDay,
                valueOf(activeDay, metric),
                metric,
                goal,
                doseDays?.has(activeDay.date) ?? false,
              )
            : ""}
        </span>
      </figcaption>
    </figure>
  );
}

function describe(
  d: DayPoint,
  value: number | null,
  metric: Metric,
  goal: number | null,
  dose: boolean,
): string {
  const entries = `${d.count} ${d.count === 1 ? "entry" : "entries"}`;
  if (d.count === 0) return `${shortLabel(d.date)}, not logged${dose ? ", dose day" : ""}`;
  if (value === null) {
    const name = METRICS.find((m) => m.key === metric)?.label.toLowerCase();
    return `${shortLabel(d.date)}, no ${name} reported, ${entries}`;
  }
  const parts = [shortLabel(d.date), amountText(value, metric), entries];
  if (d.partial.includes(metric)) parts.push("some entries report none");
  if (goal !== null) {
    if (metric === "kcal" && value > goal) parts.push("over goal");
    if (metric !== "kcal" && value >= goal) parts.push("goal reached");
  }
  if (dose) parts.push("dose day");
  return parts.join(", ");
}

/** The 7-day average as runs of points; a day with no value ends a run, so the line breaks instead of dipping to zero. */
function trendSegments(
  trend: Array<number | null>,
  slot: number,
  max: number,
): Array<Array<[number, number]>> {
  const runs: Array<Array<[number, number]>> = [];
  let run: Array<[number, number]> = [];
  trend.forEach((v, i) => {
    if (v === null) {
      if (run.length > 0) runs.push(run);
      run = [];
      return;
    }
    run.push([LEFT + i * slot + slot / 2, yFor(v, max, TOP, BOTTOM)]);
  });
  if (run.length > 0) runs.push(run);
  return runs;
}

/** A bar anchored to the baseline with only its top corners rounded. */
export function roundedTop(x: number, y: number, w: number, h: number, r: number): string {
  const rr = Math.min(r, w / 2, h);
  return `M${x} ${y + h}V${y + rr}Q${x} ${y} ${x + rr} ${y}H${x + w - rr}Q${x + w} ${y} ${x + w} ${y + rr}V${y + h}Z`;
}
