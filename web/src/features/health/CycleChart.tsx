import { roundedTop } from "@/features/history/BarChart";
import { niceMax, yFor } from "@/features/history/stats";
import type { CycleBucket } from "@/lib/health";
import { formatKcal } from "@/lib/numbers";

const W = 360;
const H = 150;
const LEFT = 36;
const RIGHT = 6;
const TOP = 16;
const BOTTOM = 118;
const MAX_BAR = 26;

const dayLabel = (d: number) => (d === 0 ? "Dose" : String(d));

/** Average calories on each day since the last dose, as columns. The dose day is the first one. */
export function CycleChart({ cycle }: { cycle: CycleBucket[] }) {
  const max = niceMax(Math.max(...cycle.map((b) => b.avgKcal)) * 1.1);
  const slot = (W - LEFT - RIGHT) / cycle.length;
  const barW = Math.min(MAX_BAR, slot - 4);
  const high = cycle.reduce((a, b) => (b.avgKcal > a.avgKcal ? b : a));
  const low = cycle.reduce((a, b) => (b.avgKcal < a.avgKcal ? b : a));
  const summary = `Average calories by days since the dose. Highest on ${dayLabel(high.day) === "Dose" ? "the dose day" : `day ${high.day}`} at ${formatKcal(high.avgKcal)} kcal, lowest on ${dayLabel(low.day) === "Dose" ? "the dose day" : `day ${low.day}`} at ${formatKcal(low.avgKcal)} kcal.`;

  return (
    <figure>
      <p className="mb-1 px-1 text-meta font-medium text-ink-2">Average kcal a day</p>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={summary}
        className="block h-auto w-full overflow-visible"
      >
        {[0, max / 2, max].map((t) => (
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
              {formatKcal(t)}
            </text>
          </g>
        ))}
        {cycle.map((b, i) => {
          const x = LEFT + i * slot + (slot - barW) / 2;
          const y = yFor(b.avgKcal, max, TOP, BOTTOM);
          const marked = b === high || b === low;
          return (
            <g key={b.day}>
              <path
                d={roundedTop(x, y, barW, BOTTOM - y, 3)}
                className={b.day === 0 ? "fill-accent" : "fill-ink-3"}
              />
              {marked ? (
                <text
                  x={x + barW / 2}
                  y={y - 4}
                  textAnchor="middle"
                  className="fill-ink font-sans text-chart font-semibold"
                >
                  {formatKcal(b.avgKcal)}
                </text>
              ) : null}
              <text
                x={x + barW / 2}
                y={H - 22}
                textAnchor="middle"
                className="fill-ink-2 font-sans text-axis"
              >
                {dayLabel(b.day)}
              </text>
            </g>
          );
        })}
        <text x={LEFT} y={H - 4} className="fill-ink-3 font-sans text-axis">
          Days since the dose
        </text>
      </svg>
      <table className="sr-only">
        <caption>Average calories by days since the dose</caption>
        <thead>
          <tr>
            <th scope="col">Day</th>
            <th scope="col">kcal</th>
            <th scope="col">Days logged</th>
          </tr>
        </thead>
        <tbody>
          {cycle.map((b) => (
            <tr key={b.day}>
              <th scope="row">{b.day === 0 ? "Dose day" : `Day ${b.day}`}</th>
              <td>{formatKcal(b.avgKcal)}</td>
              <td>{b.days}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
