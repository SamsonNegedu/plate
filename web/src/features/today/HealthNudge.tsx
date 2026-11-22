import { Link } from "react-router";
import { useHealthRecords, useSettings } from "@/db/hooks";
import { addDays, localDate } from "@/lib/dates";
import { dosesOf, nextDose, planOf, usesHealth } from "@/lib/health";
import { useNow } from "@/lib/useNow";

/**
 * One quiet line for someone who tracks medication or weight: a dose that is due, or a weight not logged for a week. It
 * stands in for push reminders, which a PWA cannot send reliably. People who never used the feature never see it.
 */
export function HealthNudge() {
  const settings = useSettings();
  const records = useHealthRecords();
  const now = useNow();
  if (!settings || !records || !usesHealth(settings, records)) return null;
  const today = localDate(now);

  const plan = planOf(settings);
  if (plan) {
    const next = nextDose(plan, dosesOf(records, plan), today);
    if (next.status !== "upcoming") {
      const late = -next.daysUntil;
      const text =
        next.status === "today"
          ? `${plan.name} dose due today`
          : `${plan.name} dose overdue by ${late} ${late === 1 ? "day" : "days"}`;
      return (
        <Nudge
          text={text}
          action="Log a dose"
          to="/health/medication?log=dose"
          attention={next.status === "overdue"}
        />
      );
    }
  }
  const weighedRecently = records.some(
    (r) => r.kind === "weight" && r.recordedOn > addDays(today, -7),
  );
  if (!weighedRecently && records.some((r) => r.kind === "weight")) {
    return (
      <Nudge text="No weight logged in a week" action="Log weight" to="/health/weight?log=weight" />
    );
  }
  return null;
}

function Nudge({
  text,
  action,
  to,
  attention = false,
}: {
  text: string;
  action: string;
  to: string;
  attention?: boolean;
}) {
  return (
    <aside
      className={`mt-3 flex min-h-12 items-center gap-3 rounded-card border bg-surface px-3.5 ${attention ? "border-amber" : "border-line"}`}
      aria-label="Health reminder"
    >
      <p className="min-w-0 flex-1 text-label">{text}</p>
      <Link
        to={to}
        className="inline-flex min-h-11 items-center text-label font-medium text-accent"
      >
        {action}
      </Link>
    </aside>
  );
}
