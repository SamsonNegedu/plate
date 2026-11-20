import { Select } from "@/components/Select";
import { shortLabel } from "@/lib/dates";
import type { BeforeAfter, CycleBucket, MedicationPeriod } from "@/lib/health";
import { formatGrams, formatKcal } from "@/lib/numbers";
import { CycleChart } from "./CycleChart";

function signed(n: number): string {
  if (n < 0) return `−${formatKcal(-n)}`;
  return `${n > 0 ? "+" : ""}${formatKcal(n)}`;
}
const dayName = (b: CycleBucket) => (b.day === 0 ? "the dose day" : `day ${b.day}`);

/** What the person's own logs show. Statements of fact only: no targets, no advice, no claims about the medication. */
export function InsightsCard({
  cycle,
  beforeAfter,
  periods,
  proteinPerKg,
  avgProtein,
  medication,
  medications,
  onMedication,
}: {
  cycle: CycleBucket[] | null;
  beforeAfter: BeforeAfter | null;
  /** Intake before any dose and under each medication, when more than one has been used. */
  periods: MedicationPeriod[] | null;
  proteinPerKg: number | null;
  avgProtein: number | null;
  medication: string | null;
  medications: string[];
  onMedication: (name: string) => void;
}) {
  const nothing = !cycle && !beforeAfter && !periods && proteinPerKg === null;
  const high = cycle?.reduce((a, b) => (b.avgKcal > a.avgKcal ? b : a));
  const low = cycle?.reduce((a, b) => (b.avgKcal < a.avgKcal ? b : a));
  const rows = beforeAfter
    ? [
        {
          label: "Calories",
          before: beforeAfter.before.avgKcal,
          after: beforeAfter.after.avgKcal,
          unit: "kcal",
        },
        ...(beforeAfter.before.avgProtein !== null && beforeAfter.after.avgProtein !== null
          ? [
              {
                label: "Protein",
                before: beforeAfter.before.avgProtein,
                after: beforeAfter.after.avgProtein,
                unit: "g",
              },
            ]
          : []),
      ]
    : [];

  return (
    <div className="grid gap-6">
      {nothing ? (
        <p className="text-body text-ink-2">
          Keep logging meals, weight and doses. After a couple of weeks this shows how your eating
          moves across a dosing cycle and how it compares with before you started.
        </p>
      ) : null}

      {cycle && medication && high && low ? (
        <section aria-labelledby="cycle-h" className="grid gap-2">
          <h2
            id="cycle-h"
            className="border-b-[1.5px] border-ink pb-1.5 text-section font-semibold"
          >
            Eating across a dose cycle
          </h2>
          {medications.length > 1 ? (
            <div className="grid gap-1.5">
              <label htmlFor="insight-med" className="text-meta font-medium text-ink-2">
                Medication
              </label>
              <Select
                id="insight-med"
                value={medication}
                onChange={(e) => onMedication(e.target.value)}
              >
                {medications.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </Select>
            </div>
          ) : null}
          <div className="rounded-card border border-line bg-surface px-3 pt-3 pb-2">
            <CycleChart cycle={cycle} />
          </div>
          <p className="text-body">
            {`Highest on ${dayName(high)} at ${formatKcal(high.avgKcal)} kcal, lowest on ${dayName(low)} at ${formatKcal(low.avgKcal)} kcal.`}
          </p>
          <p className="text-meta text-ink-2">
            {`Average calories by days since each ${medication} dose, from ${cycle.reduce((s, b) => s + b.days, 0)} logged days.`}
          </p>
        </section>
      ) : null}

      {periods ? (
        <section aria-labelledby="by-med-h" className="grid gap-2">
          <h2
            id="by-med-h"
            className="border-b-[1.5px] border-ink pb-1.5 text-section font-semibold"
          >
            By medication
          </h2>
          <table className="w-full border-collapse text-label [&_td]:border-b [&_td]:border-line [&_td]:py-2 [&_td]:text-right [&_td]:font-medium [&_th]:border-b [&_th]:border-line [&_th]:py-2 [&_th]:text-left [&_th]:font-normal [&_thead_th]:border-ink [&_thead_th]:pb-1.5 [&_thead_th]:text-right [&_thead_th]:font-semibold [&_thead_th:first-child]:text-left">
            <caption className="sr-only">
              Average a day before any dose and on each medication
            </caption>
            <thead>
              <tr>
                <th scope="col">Period</th>
                <th scope="col">Days</th>
                <th scope="col">kcal</th>
                <th scope="col">Protein</th>
              </tr>
            </thead>
            <tbody>
              {periods.map((p) => (
                <tr key={p.label}>
                  <th scope="row">
                    <span className="block">
                      {p.label === "Before" ? "Before any dose" : p.label}
                    </span>
                    <span className="block text-meta text-ink-3">
                      {p.from ? `${shortLabel(p.from)} on` : "Earlier days"}
                    </span>
                  </th>
                  <td>{p.days}</td>
                  <td>{formatKcal(p.avgKcal)}</td>
                  <td>{p.avgProtein === null ? "—" : `${formatKcal(p.avgProtein)} g`}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-meta text-ink-2">
            Averages a day over the days you logged. Each stretch runs from the first dose of that
            medication.
          </p>
        </section>
      ) : null}

      {beforeAfter ? (
        <section aria-labelledby="ba-h" className="grid gap-2">
          <h2 id="ba-h" className="border-b-[1.5px] border-ink pb-1.5 text-section font-semibold">
            Before and since you started
          </h2>
          <table className="w-full border-collapse text-label [&_td]:border-b [&_td]:border-line [&_td]:py-2 [&_td]:text-right [&_td]:font-medium [&_th]:border-b [&_th]:border-line [&_th]:py-2 [&_th]:text-left [&_th]:font-normal [&_thead_th]:border-ink [&_thead_th]:pb-1.5 [&_thead_th]:text-right [&_thead_th]:font-semibold [&_thead_th:first-child]:text-left">
            <caption className="sr-only">
              Average a day, before and since the medication started
            </caption>
            <thead>
              <tr>
                <th scope="col">
                  <span className="sr-only">Measure</span>
                </th>
                <th scope="col">{`Before · ${beforeAfter.before.days} d`}</th>
                <th scope="col">{`Since · ${beforeAfter.after.days} d`}</th>
                <th scope="col">Change</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.label}>
                  <th scope="row">{r.label}</th>
                  <td>{formatKcal(r.before)}</td>
                  <td>{formatKcal(r.after)}</td>
                  <td className="font-semibold">{`${signed(r.after - r.before)} ${r.unit}`}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-meta text-ink-2">Averages a day over the days you logged.</p>
        </section>
      ) : null}

      {proteinPerKg !== null && avgProtein !== null ? (
        <section aria-labelledby="pk-h" className="grid gap-1">
          <h2 id="pk-h" className="border-b-[1.5px] border-ink pb-1.5 text-section font-semibold">
            Protein for your weight
          </h2>
          <p className="flex items-baseline gap-2 pt-1">
            <span className="font-display text-stat leading-stat font-semibold">
              {formatGrams(proteinPerKg)}
              <small className="ml-1 font-sans text-label font-normal text-ink-2">g/kg</small>
            </span>
            <span className="text-meta text-ink-2">
              {`${formatKcal(avgProtein)} g a day over the last two weeks, at your current weight`}
            </span>
          </p>
        </section>
      ) : null}
    </div>
  );
}
