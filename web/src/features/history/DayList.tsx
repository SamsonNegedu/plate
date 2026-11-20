import { useState } from "react";
import { Link } from "react-router";
import type { Entry } from "@/db/types";
import { cn } from "@/lib/cn";
import { shortLabel } from "@/lib/dates";
import { formatKcal } from "@/lib/numbers";
import { type DayPoint, dayDetail } from "./stats";

interface Props {
  days: DayPoint[];
  entriesByDay: Map<string, Entry[]>;
  goal: number;
  today: string;
}

/** A week of days at first. A month of daily use would otherwise bury everything under the list. */
const FIRST = 7;
const STEP = 14;

const percent = (share: number) => `${Math.round(share * 100)}%`;
const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Logged days, newest first. A row opens in place to show where that day's calories came from. */
export function DayList({ days, entriesByDay, goal, today }: Props) {
  const [openDate, setOpenDate] = useState<string | null>(null);
  const [shown, setShown] = useState(FIRST);
  const logged = [...days].reverse().filter((d) => d.count > 0);
  const more = logged.length - shown;
  return (
    <section aria-labelledby="days-h" className="grid grid-cols-[minmax(0,1fr)]">
      <h2 id="days-h" className="border-b-[1.5px] border-ink pb-1 text-section font-semibold">
        Days
      </h2>
      <ul aria-label="Days">
        {logged.slice(0, shown).map((d) => {
          const isOpen = openDate === d.date;
          const over = d.kcal > goal;
          return (
            <li key={d.date} className="border-b border-line">
              <button
                type="button"
                aria-expanded={isOpen}
                aria-controls={`day-${d.date}`}
                onClick={() => setOpenDate(isOpen ? null : d.date)}
                className="flex min-h-13 w-full items-center gap-2.5 bg-transparent text-left text-ink"
              >
                <span className="flex-1 text-body">{shortLabel(d.date)}</span>
                <span className="text-meta text-ink-2">{`${d.count} ${d.count === 1 ? "entry" : "entries"}`}</span>
                <span
                  className={cn(
                    "min-w-[84px] text-right text-body font-semibold",
                    over && "text-red",
                  )}
                >
                  {formatKcal(d.kcal)} kcal
                  {over ? <span className="sr-only"> over goal</span> : null}
                </span>
                <span
                  className={cn("text-glyph text-ink-3", isOpen && "rotate-90")}
                  aria-hidden="true"
                >
                  ›
                </span>
              </button>
              {isOpen ? (
                <DayBreakdown
                  id={`day-${d.date}`}
                  date={d.date}
                  entries={entriesByDay.get(d.date) ?? []}
                  to={d.date === today ? "/today" : `/today/${d.date}`}
                />
              ) : null}
            </li>
          );
        })}
      </ul>
      {more > 0 ? (
        <button
          type="button"
          className="mt-1 inline-flex min-h-11 items-center justify-self-start bg-transparent p-0 text-label font-medium text-accent"
          onClick={() => setShown((n) => n + STEP)}
        >
          {`Show ${Math.min(STEP, more)} more days (${more} not shown)`}
        </button>
      ) : null}
    </section>
  );
}

function DayBreakdown({
  id,
  date,
  entries,
  to,
}: {
  id: string;
  date: string;
  entries: Entry[];
  to: string;
}) {
  const detail = dayDetail(entries);
  return (
    <div id={id} className="grid gap-2.5 pb-3.5 text-meta">
      <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1">
        {detail.meals.map((m) => (
          <div key={m.meal} className="col-span-2 grid grid-cols-subgrid">
            <dt className="text-ink-2">{capital(m.meal)}</dt>
            <dd className="text-right font-semibold">{formatKcal(m.kcal)} kcal</dd>
          </div>
        ))}
      </dl>
      <div>
        <p className="mb-1 text-ink-2">Biggest contributors</p>
        <ol>
          {detail.biggest.map((b) => (
            <li key={b.id} className="flex gap-2 py-0.5">
              <span className="min-w-0 flex-1 truncate">{b.name}</span>
              <span className="text-ink-2">{percent(b.share)}</span>
              <span className="min-w-[72px] text-right font-semibold">
                {formatKcal(b.kcal)} kcal
              </span>
            </li>
          ))}
        </ol>
      </div>
      <Link to={to} className="inline-flex min-h-11 items-center font-medium text-accent">
        {`Open ${shortLabel(date)}`}
      </Link>
    </div>
  );
}
