import { useState } from "react";
import { shortLabel } from "@/lib/dates";
import { formatKcal } from "@/lib/numbers";
import styles from "./BarChart.module.css";
import { type DayPoint, labelEvery, niceMax, yFor } from "./stats";

interface Props {
  days: DayPoint[];
  goal: number;
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

/**
 * One series, one y-axis, zero baseline. Bars have 4 px rounded top corners and a 2 px gap. The goal is a dashed line with a
 * surface halo. Red marks over-goal days and is always also stated in words (tooltip, table, aria-label).
 */
export function BarChart({ days, goal, today, onOpen }: Props) {
  const [active, setActive] = useState<string | null>(null);
  const max = niceMax(Math.max(goal * 1.1, ...days.map((d) => d.kcal * 1.08)));
  const slot = (W - LEFT - RIGHT) / days.length;
  const barW = Math.max(2, slot - GAP);
  const every = labelEvery(days.length);
  const ticks = [0, max / 2, max];
  const goalY = yFor(goal, max, TOP, BOTTOM);
  const activeDay = days.find((d) => d.date === active);

  return (
    <figure className={styles.figure}>
      {/* biome-ignore lint/a11y/useSemanticElements: an SVG chart is a labelled group, not a fieldset */}
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="group"
        aria-label={`Calories per day for the last ${days.length} days. Goal ${formatKcal(goal)}.`}
        className={styles.svg}
      >
        {ticks.map((t) => (
          <g key={t}>
            <line
              x1={LEFT}
              x2={W - RIGHT}
              y1={yFor(t, max, TOP, BOTTOM)}
              y2={yFor(t, max, TOP, BOTTOM)}
              className={t === 0 ? styles.base : styles.grid}
            />
            <text
              x={LEFT - 6}
              y={yFor(t, max, TOP, BOTTOM) + 4}
              textAnchor="end"
              className={styles.axis}
            >
              {formatKcal(t)}
            </text>
          </g>
        ))}

        {days.map((d, i) => {
          const x = LEFT + i * slot + GAP / 2;
          const over = d.kcal > goal;
          const y = yFor(d.kcal, max, TOP, BOTTOM);
          const h = BOTTOM - y;
          const label = `${shortLabel(d.date)}, ${formatKcal(d.kcal)} kcal, ${d.count} ${d.count === 1 ? "entry" : "entries"}${over ? ", over goal" : ""}`;
          return (
            // biome-ignore lint/a11y/useSemanticElements: an SVG bar cannot be a button element
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
              className={styles.slot}
            >
              <rect
                x={LEFT + i * slot}
                y={TOP}
                width={slot}
                height={BOTTOM - TOP}
                className={d.date === active ? styles.wash : styles.none}
              />
              {d.kcal > 0 ? (
                <path
                  d={roundedTop(x, y, barW, h, 4)}
                  className={over ? styles.over : styles.bar}
                />
              ) : null}
              {d.date === today ? (
                <text
                  x={x + barW / 2}
                  y={Math.max(y - 4, TOP - 2)}
                  textAnchor="middle"
                  className={styles.value}
                >
                  {formatKcal(d.kcal)}
                </text>
              ) : null}
            </g>
          );
        })}

        <line x1={LEFT} x2={W - RIGHT} y1={goalY} y2={goalY} className={styles.goal} />
        <text x={W - RIGHT - 2} y={goalY - 5} textAnchor="end" className={styles.goalLabel}>
          {`goal ${formatKcal(goal)}`}
        </text>

        {days.map((d, i) =>
          (days.length - 1 - i) % every === 0 ? (
            <text
              key={d.date}
              x={LEFT + i * slot + slot / 2}
              y={H - 10}
              textAnchor="middle"
              className={styles.axis}
            >
              {d.date === today ? "today" : String(Number(d.date.slice(8)))}
            </text>
          ) : null,
        )}
      </svg>
      <figcaption className={styles.tip} aria-live="polite">
        {activeDay
          ? `${shortLabel(activeDay.date)}: ${formatKcal(activeDay.kcal)} kcal, ${activeDay.count} ${activeDay.count === 1 ? "entry" : "entries"}${activeDay.kcal > goal ? ", over goal" : ""}`
          : "Tap or focus a bar for details."}
      </figcaption>
    </figure>
  );
}

/** A bar anchored to the baseline with only its top corners rounded. */
export function roundedTop(x: number, y: number, w: number, h: number, r: number): string {
  const rr = Math.min(r, w / 2, h);
  return `M${x} ${y + h}V${y + rr}Q${x} ${y} ${x + rr} ${y}H${x + w - rr}Q${x + w} ${y} ${x + w} ${y + rr}V${y + h}Z`;
}
