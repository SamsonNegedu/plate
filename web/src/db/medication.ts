import type { PlateDB } from "./schema";
import { saveSettings } from "./settings";

interface PlanInput {
  name: string;
  intervalDays: number;
  startedOn: string;
  /** Doses on hand right now, if the person wants a refill reminder. */
  supplyDoses: number | null;
}

/** Start or change the medication being tracked. Doses already logged stay as they are. */
export async function savePlan(
  db: PlateDB,
  plan: PlanInput,
  now: number = Date.now(),
): Promise<void> {
  await saveSettings(
    db,
    {
      medName: plan.name.trim(),
      medIntervalDays: plan.intervalDays,
      medStartedOn: plan.startedOn,
      medSupplyDoses: plan.supplyDoses,
      medSupplyAsOf: plan.supplyDoses === null ? null : new Date(now).toISOString(),
    },
    now,
  );
}

/** Stop tracking. The dose history is kept; only the plan and the supply count go. */
export async function stopPlan(db: PlateDB, now: number = Date.now()): Promise<void> {
  await saveSettings(
    db,
    {
      medName: null,
      medIntervalDays: null,
      medStartedOn: null,
      medSupplyDoses: null,
      medSupplyAsOf: null,
    },
    now,
  );
}

/** Set how many doses are on hand now. Doses logged after this moment count down from it. */
export async function setSupply(
  db: PlateDB,
  doses: number | null,
  now: number = Date.now(),
): Promise<void> {
  await saveSettings(
    db,
    {
      medSupplyDoses: doses,
      medSupplyAsOf: doses === null ? null : new Date(now).toISOString(),
    },
    now,
  );
}

export async function setWeightGoal(
  db: PlateDB,
  kg: number | null,
  now: number = Date.now(),
): Promise<void> {
  await saveSettings(db, { weightGoalKg: kg }, now);
}
