import { useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { Segmented } from "@/components/Segmented";
import { useDb } from "@/db/context";
import { addHealthRecord, undoHealthAdd, undoHealthDelete } from "@/db/health";
import { useEntryRange, useHealthRecords, useSettings } from "@/db/hooks";
import type { HealthKind, HealthRecord } from "@/db/types";
import { buildDays } from "@/features/history/stats";
import { copy } from "@/lib/copy";
import { addDays, localDate } from "@/lib/dates";
import {
  beforeAfter,
  intakeByMedication,
  intervalOf,
  medicationsIn,
  doseChanges,
  dosesOf,
  intakeByCycleDay,
  measureSummaries,
  nextDose,
  planOf,
  proteinPerKg,
  supplyLeft,
  weightProgress,
  weightSeries,
} from "@/lib/health";
import { formatGrams, formatMg } from "@/lib/numbers";
import { productNamed } from "@/lib/pens";
import { useUi } from "@/lib/ui";
import { useNow } from "@/lib/useNow";
import { FeelingCard } from "./FeelingCard";
import { InsightsCard } from "./InsightsCard";
import { MeasurementsCard } from "./MeasurementsCard";
import { MedicationCard } from "./MedicationCard";
import { DoseSheet, GoalSheet, type MeasureKind, MeasureSheet, PlanSheet } from "./sheets";
import { WeightCard } from "./WeightCard";

type Tab = "weight" | "medication" | "insights";
const isTab = (v: string | undefined): v is Tab =>
  v === "weight" || v === "medication" || v === "insights";

type Open =
  | null
  | { kind: "measure"; measure: MeasureKind; canChoose: boolean }
  | { kind: "goal" }
  | { kind: "plan" }
  | { kind: "dose"; record?: HealthRecord };

const INTAKE_DAYS = 90;

export default function HealthPage() {
  const db = useDb();
  const toast = useUi((s) => s.toast);
  const now = useNow();
  const [params, setParams] = useSearchParams();
  const settings = useSettings();
  const records = useHealthRecords();
  const today = localDate(now);
  const navigate = useNavigate();
  const { tab: tabParam } = useParams();
  const [open, setOpen] = useState<Open>(() =>
    params.get("log") === "dose" ? { kind: "dose" } : null,
  );
  const entries = useEntryRange(addDays(today, -(INTAKE_DAYS - 1)), today);
  if (!settings || !records || !entries) return null;
  // Someone tracking a medication lands on it; everyone else starts with their weight.
  // The tab is in the path, so it can be linked, reloaded and gone back to. Without one, the page picks a sensible start.
  const start: Tab = settings.medName ? "medication" : "weight";
  const view: Tab = isTab(tabParam) ? tabParam : start;

  const plan = planOf(settings);
  const doses = dosesOf(records, plan);
  const everyDose = dosesOf(records, null); // every medication, so a switch keeps the earlier doses visible
  const next = plan ? nextDose(plan, doses, today) : null;
  const series = weightSeries(records);
  const progress = weightProgress(series, settings.medStartedOn, settings.weightGoalKg);
  const days = buildDays(entries, addDays(today, -(INTAKE_DAYS - 1)), today);
  // With more than one medication in the log, the cycle chart is for the one chosen, and the comparison is by medication.
  const meds = medicationsIn(everyDose);
  const asked = params.get("med")?.toLowerCase();
  const chosen =
    meds.find((m) => m.name.toLowerCase() === asked)?.name ??
    plan?.name ??
    meds.at(-1)?.name ??
    null;
  const chosenDoses = chosen
    ? dosesOf(records, { name: chosen, intervalDays: plan?.intervalDays ?? 7, startedOn: "" })
    : [];
  const chosenInterval = chosen
    ? intervalOf(productNamed(chosen)?.intervalDays ?? null, chosenDoses, plan?.intervalDays ?? 7)
    : 7;
  const cycle = chosen ? intakeByCycleDay(days, chosenDoses, chosenInterval) : null;
  const periods = intakeByMedication(days, meds);
  const ba = plan && meds.length < 2 ? beforeAfter(days, plan.startedOn) : null;
  const lastTwoWeeks = days.slice(-14).filter((d) => d.count > 0 && d.protein !== null);
  const avgProtein =
    lastTwoWeeks.length >= 5
      ? lastTwoWeeks.reduce((s, d) => s + (d.protein ?? 0), 0) / lastTwoWeeks.length
      : null;
  const perKg =
    avgProtein !== null && progress ? proteinPerKg(avgProtein, progress.latest.kg) : null;
  const latestOf = (k: HealthKind): number | null =>
    records.filter((r) => r.kind === k).at(-1)?.value ?? null;

  const rate = async (kind: Extract<HealthKind, "appetite" | "nausea">, value: number) => {
    await addHealthRecord(db, { kind, value });
  };

  const saved = (r: HealthRecord) =>
    toast({
      message: `Logged ${r.kind === "dose" ? "dose" : r.kind} ${r.kind === "dose" ? formatMg(r.value) : formatGrams(r.value)} ${unitOf(r.kind)}`,
      action: { label: copy.common.undo, run: () => undoHealthAdd(db, r.id) },
    });

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6 pb-2">
      <h1 className="mt-1 text-title font-semibold">Body and medication</h1>

      <Segmented
        label="Health view"
        value={view}
        options={[
          { value: "weight", label: "Weight" },
          { value: "medication", label: "Medication" },
          { value: "insights", label: "Insights" },
        ]}
        onChange={(t) => void navigate(`/health/${t}`)}
      />

      {view === "weight" ? (
        <>
          <WeightCard
            series={series}
            progress={progress}
            goalKg={settings.weightGoalKg}
            today={today}
            onLog={() => setOpen({ kind: "measure", measure: "weight", canChoose: true })}
            onGoal={() => setOpen({ kind: "goal" })}
          />
          <MeasurementsCard
            summaries={measureSummaries(records)}
            onEdit={(measure) => setOpen({ kind: "measure", measure, canChoose: false })}
          />
        </>
      ) : null}

      {view === "medication" ? (
        <>
          <MedicationCard
            plan={plan}
            next={next}
            doses={everyDose}
            changes={doseChanges(doses)}
            supply={supplyLeft(settings.medSupplyDoses, settings.medSupplyAsOf, doses)}
            onLog={() => setOpen({ kind: "dose" })}
            onPlan={() => setOpen({ kind: "plan" })}
            onEdit={(record) => setOpen({ kind: "dose", record })}
          />

          <FeelingCard records={records} today={today} onRate={(k, v) => void rate(k, v)} />
        </>
      ) : null}

      {view === "insights" ? (
        <InsightsCard
          cycle={cycle}
          beforeAfter={ba}
          periods={periods}
          proteinPerKg={perKg}
          avgProtein={avgProtein}
          medication={chosen}
          medications={meds.map((m) => m.name)}
          onMedication={(m) =>
            setParams(
              (p) => {
                const next = new URLSearchParams(p);
                next.set("med", m);
                return next;
              },
              { replace: true },
            )
          }
        />
      ) : null}

      <p className="text-meta text-ink-2">
        Plate records what you log. It does not give medical advice or suggest doses. Talk to your
        prescriber about your treatment.{" "}
        <Link to="/history" className="font-medium text-accent">
          See dose days on History
        </Link>
      </p>

      {open?.kind === "measure" ? (
        <MeasureSheet
          kind={open.measure}
          canChoose={open.canChoose}
          latestOf={latestOf}
          onClose={() => setOpen(null)}
          onSaved={saved}
        />
      ) : null}
      {open?.kind === "goal" ? (
        <GoalSheet current={settings.weightGoalKg} onClose={() => setOpen(null)} />
      ) : null}
      {open?.kind === "plan" ? (
        <PlanSheet
          current={
            plan
              ? {
                  ...plan,
                  supply: supplyLeft(settings.medSupplyDoses, settings.medSupplyAsOf, doses),
                }
              : null
          }
          onClose={() => setOpen(null)}
        />
      ) : null}
      {open?.kind === "dose" && plan ? (
        <DoseSheet
          medication={plan.name}
          lastDose={doses.at(-1)}
          {...(open.record ? { record: open.record } : {})}
          onClose={() => setOpen(null)}
          onSaved={(r, isNew) => (isNew ? saved(r) : undefined)}
          onDeleted={(r) =>
            toast({
              message: "Dose deleted",
              action: { label: copy.common.undo, run: () => undoHealthDelete(db, r.id) },
            })
          }
        />
      ) : null}
      {open?.kind === "dose" && !plan ? (
        <PlanSheet current={null} onClose={() => setOpen(null)} />
      ) : null}
    </div>
  );
}

const UNITS: Record<HealthKind, string> = {
  weight: "kg",
  waist: "cm",
  hips: "cm",
  chest: "cm",
  arm: "cm",
  thigh: "cm",
  neck: "cm",
  appetite: "",
  nausea: "",
  dose: "mg",
};
const unitOf = (k: HealthKind): string => UNITS[k];
