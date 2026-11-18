import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { Button } from "@/components/Button";
import { Segmented } from "@/components/Segmented";
import { useEntryRange, useSettings } from "@/db/hooks";
import { addDays, logicalDate, shortLabel } from "@/lib/dates";
import { formatKcal, formatOptional } from "@/lib/numbers";
import { BarChart } from "./BarChart";
import styles from "./HistoryPage.module.css";
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

export default function HistoryPage() {
  const settings = useSettings();
  const navigate = useNavigate();
  const [range, setRange] = useState<Range>(savedRange);
  const [table, setTable] = useState(false);
  const today = logicalDate(new Date(), settings?.dayStartHour ?? 0);
  const from = addDays(today, -(Number(range) - 1));
  const entries = useEntryRange(from, today);

  if (!settings || !entries) return null;
  const days = buildDays(entries, from, today);
  const stats = summarize(days, settings.goalKcal);
  const logged = stats.daysLogged;
  const open = (d: string) => navigate(d === today ? "/today" : `/today/${d}`);

  return (
    <div className={styles.page}>
      <h1 className={styles.title}>History</h1>
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

      <section className={styles.card} aria-label="Calories per day">
        <BarChart days={days} goal={settings.goalKcal} today={today} onOpen={open} />
        {logged === 0 ? (
          <div className={styles.empty}>
            <p>No days logged yet. Start with today.</p>
            <Button variant="primary" onClick={() => navigate("/scan")}>
              Scan a barcode
            </Button>
          </div>
        ) : null}
      </section>

      <p className={styles.summary}>{`Logged ${logged} of ${days.length} days.`}</p>
      <dl className={styles.stats}>
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
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <caption className="srOnly">Calories and macros per day</caption>
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
                  <td>
                    {d.count === 0
                      ? "Not logged"
                      : d.kcal > settings.goalKcal
                        ? "Over goal"
                        : "Within goal"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      <ul className={styles.list} aria-label="Days">
        {[...days]
          .reverse()
          .filter((d) => d.count > 0)
          .map((d) => (
            <li key={d.date}>
              <Link to={d.date === today ? "/today" : `/today/${d.date}`} className={styles.row}>
                <span className={styles.d}>{shortLabel(d.date)}</span>
                <span
                  className={styles.c}
                >{`${d.count} ${d.count === 1 ? "entry" : "entries"}`}</span>
                <span className={`${styles.k} ${d.kcal > settings.goalKcal ? styles.over : ""}`}>
                  {formatKcal(d.kcal)} kcal
                  {d.kcal > settings.goalKcal ? <span className="srOnly"> over goal</span> : null}
                </span>
                <span className={styles.chev} aria-hidden="true">
                  ›
                </span>
              </Link>
            </li>
          ))}
      </ul>
    </div>
  );
}
