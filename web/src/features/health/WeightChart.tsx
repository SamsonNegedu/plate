import { monotonePath } from "@/features/history/stats";
import { addDays, shortLabel } from "@/lib/dates";
import { daysBetween, type WeightPoint } from "@/lib/health";
import { formatGrams } from "@/lib/numbers";

const W = 360;
const H = 170;
const LEFT = 38;
const RIGHT = 10;
const TOP = 12;
const BOTTOM = 140;

/** Daily weights as dots with the 7-day average as a smooth line, and the goal as a dashed line when there is one. */
export function WeightChart({
  points,
  goalKg,
  summary,
}: {
  points: WeightPoint[];
  goalKg: number | null;
  summary: string;
}) {
  const first = points[0];
  const last = points.at(-1);
  if (!first || !last) return null;
  const values = [...points.flatMap((p) => [p.kg, p.avg]), ...(goalKg === null ? [] : [goalKg])];
  const lo = Math.floor(Math.min(...values) - 1);
  const hi = Math.ceil(Math.max(...values) + 1);
  const span = Math.max(1, daysBetween(first.date, last.date));
  const x = (date: string) => LEFT + (daysBetween(first.date, date) / span) * (W - LEFT - RIGHT);
  const y = (kg: number) => BOTTOM - ((kg - lo) / (hi - lo)) * (BOTTOM - TOP);
  const line = monotonePath(points.map((p) => [x(p.date), y(p.avg)] as [number, number]));
  const ticks = [lo, (lo + hi) / 2, hi];
  const middle = addDays(first.date, Math.round(span / 2));

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={summary}
      className="block h-auto w-full overflow-visible"
    >
      {ticks.map((t) => (
        <g key={t}>
          <line
            x1={LEFT}
            x2={W - RIGHT}
            y1={y(t)}
            y2={y(t)}
            className={t === lo ? "stroke-ink-3 stroke-1" : "stroke-line stroke-1"}
          />
          {goalKg !== null && Math.abs(y(t) - y(goalKg)) < 14 ? null : (
            <text
              x={LEFT - 6}
              y={y(t) + 4}
              textAnchor="end"
              className="fill-ink-3 font-sans text-axis"
            >
              {formatGrams(t)}
            </text>
          )}
        </g>
      ))}
      {goalKg === null ? null : (
        <>
          <line
            x1={LEFT}
            x2={W - RIGHT}
            y1={y(goalKg)}
            y2={y(goalKg)}
            className="stroke-ink-2 stroke-1 [stroke-dasharray:4_3]"
          />
          <text
            x={LEFT - 6}
            y={y(goalKg) + 4}
            textAnchor="end"
            className="fill-ink font-sans text-axis font-semibold"
          >
            {formatGrams(goalKg)}
          </text>
        </>
      )}
      {points.map((p) => (
        <circle key={p.date} cx={x(p.date)} cy={y(p.kg)} r={2.5} className="fill-ink-3" />
      ))}
      {points.length > 1 ? (
        <path
          d={line}
          fill="none"
          className="stroke-ink stroke-[1.5px] [stroke-linecap:round] [stroke-linejoin:round]"
        />
      ) : null}
      <circle
        cx={x(last.date)}
        cy={y(last.avg)}
        r={3.5}
        className="fill-ink stroke-surface stroke-[1.5px]"
      />
      <text
        x={x(first.date)}
        y={H - 8}
        textAnchor="start"
        className="fill-ink-3 font-sans text-axis"
      >
        {shortLabel(first.date)}
      </text>
      {span > 14 ? (
        <text
          x={x(middle)}
          y={H - 8}
          textAnchor="middle"
          className="fill-ink-3 font-sans text-axis"
        >
          {shortLabel(middle)}
        </text>
      ) : null}
      <text x={x(last.date)} y={H - 8} textAnchor="end" className="fill-ink-3 font-sans text-axis">
        {span > 0 ? shortLabel(last.date) : ""}
      </text>
    </svg>
  );
}
