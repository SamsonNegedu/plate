import type { HealthRecord } from "@/db/types";
import { cn } from "@/lib/cn";
import { shortLabel } from "@/lib/dates";
import { type DoseChange, type NextDose, type Plan } from "@/lib/health";
import { formatMg } from "@/lib/numbers";
import { productNamed } from "@/lib/pens";

function dueText(next: NextDose): string {
  if (next.status === "today") return "Due today";
  if (next.status === "overdue") {
    const d = -next.daysUntil;
    return `Overdue by ${d} ${d === 1 ? "day" : "days"}`;
  }
  return next.daysUntil === 1 ? "Tomorrow" : `In ${next.daysUntil} days`;
}

/** The plan, when the next dose is due, the doses so far and what is left in the pen supply. */
export function MedicationCard({
  plan,
  next,
  doses,
  changes,
  supply,
  onPlan,
  onEdit,
}: {
  plan: Plan | null;
  next: NextDose | null;
  doses: HealthRecord[];
  changes: DoseChange[];
  supply: number | null;
  onPlan: () => void;
  onEdit: (record: HealthRecord) => void;
}) {
  if (!plan || !next) {
    return (
      <section aria-labelledby="med-h" className="grid gap-3">
        <h2 id="med-h" className="border-b-[1.5px] border-ink pb-1.5 text-section font-semibold">
          Medication
        </h2>
        <p className="text-body text-ink-2">
          Track a weekly medication such as a GLP-1: log each dose, see when the next one is due and
          how your eating and weight move alongside it.
        </p>
      </section>
    );
  }
  const changeOn = new Map(changes.map((c) => [c.date, c]));
  // The amount the plan is on now: the last dose where the amount changed, so it is what the next one is expected to be.
  const current = changes.at(-1);
  const recent = [...doses].reverse().slice(0, 8);
  return (
    <section aria-labelledby="med-h" className="grid gap-3">
      <div className="flex items-center gap-2 border-b-[1.5px] border-ink pb-1.5">
        <h2 id="med-h" className="flex items-baseline gap-2 text-section font-semibold">
          {plan.name}
          {productNamed(plan.name) ? (
            <span className="text-meta font-normal text-ink-2">
              {productNamed(plan.name)?.generic}
            </span>
          ) : null}
        </h2>
      </div>

      <div>
        <p className="text-meta text-ink-2">
          Next dose
          {current ? (
            <>
              {" · "}
              <span className="font-semibold text-ink">{`${formatMg(current.toMg)} mg`}</span>
            </>
          ) : null}
        </p>
        <p className="font-display text-display leading-display font-semibold tracking-display">
          {shortLabel(next.dueOn)}
        </p>
        <p
          className={cn(
            "mt-1 text-label font-medium",
            next.status === "overdue" ? "text-red" : "text-ink-2",
          )}
        >
          {dueText(next)}
        </p>
      </div>

      <dl className="grid grid-cols-3 gap-3 [&_dd]:mt-0.5 [&_dd]:font-display [&_dd]:text-stat [&_dd]:leading-stat [&_dd]:font-semibold [&_dd_small]:font-sans [&_dd_small]:text-micro [&_dd_small]:font-normal [&_dd_small]:text-ink-2 [&_dt]:text-meta [&_dt]:text-ink-2 [&>div]:border-t-[1.5px] [&>div]:border-ink [&>div]:pt-1.5">
        <div>
          <dt>Schedule</dt>
          <dd>
            {plan.intervalDays === 1 ? "Daily" : `Every ${plan.intervalDays}`}
            {plan.intervalDays === 1 ? null : <small> days</small>}
          </dd>
        </div>
        <div>
          <dt>Last dose</dt>
          <dd>{next.lastOn ? shortLabel(next.lastOn) : "None yet"}</dd>
        </div>
        {supply === null ? null : (
          <div>
            <dt>Doses left</dt>
            <dd className={supply <= 1 ? "text-amber" : undefined}>{supply}</dd>
          </div>
        )}
      </dl>
      {supply !== null && supply <= 1 ? (
        <p className="-mt-1 text-meta font-medium text-amber">
          {supply === 0 ? "No doses left. Time to refill." : "One dose left. Time to refill."}
        </p>
      ) : null}
      <button
        type="button"
        className="-my-1 min-h-11 justify-self-start bg-transparent p-0 text-label font-medium text-accent underline"
        onClick={onPlan}
      >
        Change medication
      </button>
      {recent.length > 0 ? (
        <>
          <p className="-mb-1 text-meta text-ink-2">
            Recent doses. Tap one to change or delete it.
          </p>
          <ul aria-label="Recent doses">
            {recent.map((d) => {
              const change = changeOn.get(d.recordedOn);
              return (
                <li key={d.id} className="border-b border-line">
                  <button
                    type="button"
                    className="flex min-h-14 w-full items-center gap-2.5 bg-transparent text-left text-ink"
                    onClick={() => onEdit(d)}
                  >
                    <span className="grid min-w-0 flex-1 gap-px">
                      <strong className="text-body font-medium">{shortLabel(d.recordedOn)}</strong>
                      <span className="truncate text-meta text-ink-2">
                        {[
                          d.medication.toLowerCase() === plan.name.toLowerCase()
                            ? ""
                            : d.medication,
                          d.site,
                          change && change.fromMg !== null
                            ? `${change.toMg > change.fromMg ? "Up" : "Down"} from ${formatMg(change.fromMg)} mg`
                            : "",
                          d.note,
                        ]
                          .filter(Boolean)
                          .join(" · ") || "No site noted"}
                      </span>
                    </span>
                    <span className="text-body font-semibold whitespace-nowrap">
                      {formatMg(d.value)}
                      <small className="text-micro font-normal text-ink-2"> mg</small>
                    </span>
                    <span className="text-glyph text-ink-3" aria-hidden="true">
                      ›
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      ) : null}
    </section>
  );
}
