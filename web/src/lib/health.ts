import type { CircumferenceKind, HealthKind, HealthRecord, Settings } from "@/db/types";
import { addDays, parseDate } from "./dates";

/** Whole days from one calendar date to another. Counted by calendar day, so a DST change never shifts it. */
export function daysBetween(from: string, to: string): number {
  return Math.round((parseDate(to).getTime() - parseDate(from).getTime()) / 86_400_000);
}

export interface WeightPoint {
  date: string;
  kg: number;
  /** Mean of the weights in the 7 days up to and including this one, so a single heavy day does not read as a trend. */
  avg: number;
}

/** One point per day (the last weighing of the day), each with its 7-day average. */
export function weightSeries(records: HealthRecord[], windowDays = 7): WeightPoint[] {
  const byDay = new Map<string, number>();
  for (const r of [...records]
    .filter((x) => x.kind === "weight" && !x.deletedAt)
    .sort((a, b) => a.recordedAt.localeCompare(b.recordedAt))) {
    byDay.set(r.recordedOn, r.value);
  }
  const days = [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b));
  return days.map(([date, kg]) => {
    const from = addDays(date, -(windowDays - 1));
    const inWindow = days.filter(([d]) => d >= from && d <= date).map(([, v]) => v);
    return { date, kg, avg: inWindow.reduce((s, v) => s + v, 0) / inWindow.length };
  });
}

export interface WeightProgress {
  latest: WeightPoint;
  /** The weight the journey is measured from: the last weighing on or before the start, else the first one. */
  start: WeightPoint;
  changeKg: number;
  changePct: number;
  /** Share of the way from start to goal, 0 to 1, when there is a goal on the far side of the start weight. */
  towardGoal: number | null;
  remainingKg: number | null;
}

export function weightProgress(
  series: WeightPoint[],
  startedOn: string | null,
  goalKg: number | null,
): WeightProgress | null {
  const latest = series.at(-1);
  const first = series[0];
  if (!latest || !first) return null;
  const before = startedOn ? series.filter((p) => p.date <= startedOn).at(-1) : undefined;
  const start = before ?? first;
  const changeKg = latest.kg - start.kg;
  let towardGoal: number | null = null;
  let remainingKg: number | null = null;
  if (goalKg !== null && goalKg !== start.kg) {
    const total = start.kg - goalKg;
    towardGoal = Math.max(0, Math.min(1, (start.kg - latest.kg) / total));
    remainingKg = Math.max(0, (latest.kg - goalKg) * Math.sign(total));
  }
  return {
    latest,
    start,
    changeKg,
    changePct: (changeKg / start.kg) * 100,
    towardGoal,
    remainingKg,
  };
}

export interface Plan {
  name: string;
  intervalDays: number;
  startedOn: string;
}

/** The medication plan, if the person has set one up. */
export function planOf(
  s: Pick<Settings, "medName" | "medIntervalDays" | "medStartedOn">,
): Plan | null {
  if (!s.medName || !s.medIntervalDays || !s.medStartedOn) return null;
  return { name: s.medName, intervalDays: s.medIntervalDays, startedOn: s.medStartedOn };
}

type DoseStatus = "upcoming" | "today" | "overdue";

export interface NextDose {
  dueOn: string;
  /** Negative when overdue. */
  daysUntil: number;
  status: DoseStatus;
  lastOn: string | null;
}

const sameMed = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** The doses of the tracked medication, oldest first. */
export function dosesOf(records: HealthRecord[], plan: Plan | null): HealthRecord[] {
  return records
    .filter((r) => r.kind === "dose" && !r.deletedAt && (!plan || sameMed(r.medication, plan.name)))
    .sort((a, b) => a.recordedAt.localeCompare(b.recordedAt));
}

/** When the next dose is due: the last dose plus the interval, or the start date before any dose was logged. */
export function nextDose(plan: Plan, doses: HealthRecord[], today: string): NextDose {
  const last = doses.at(-1);
  const dueOn = last ? addDays(last.recordedOn, plan.intervalDays) : plan.startedOn;
  const daysUntil = daysBetween(today, dueOn);
  let status: DoseStatus = "overdue";
  if (daysUntil > 0) status = "upcoming";
  else if (daysUntil === 0) status = "today";
  return { dueOn, daysUntil, status, lastOn: last?.recordedOn ?? null };
}

export interface DoseChange {
  date: string;
  fromMg: number | null;
  toMg: number;
}

/** The doses where the amount differs from the one before (the first dose counts as a start). */
export function doseChanges(doses: HealthRecord[]): DoseChange[] {
  const out: DoseChange[] = [];
  let prev: number | null = null;
  for (const d of doses) {
    if (prev === null || d.value !== prev)
      out.push({ date: d.recordedOn, fromMg: prev, toMg: d.value });
    prev = d.value;
  }
  return out;
}

/** Doses left: the count when it was set, minus the doses logged since. Never below zero. */
export function supplyLeft(
  supplyDoses: number | null,
  supplyAsOf: string | null,
  doses: HealthRecord[],
): number | null {
  if (supplyDoses === null) return null;
  const since = supplyAsOf ? doses.filter((d) => d.recordedAt > supplyAsOf).length : 0;
  return Math.max(0, supplyDoses - since);
}

export const proteinPerKg = (proteinG: number, kg: number): number => proteinG / kg;

interface DayIntake {
  date: string;
  kcal: number;
  protein: number | null;
  count: number;
}

export interface CycleBucket {
  /** Days since the most recent dose: 0 is the day of the dose. */
  day: number;
  days: number;
  avgKcal: number;
  avgProtein: number | null;
}

const MIN_CYCLE_DAYS = 14;
const MIN_DOSES = 2;

/**
 * Average intake by days since the last dose, which shows how appetite moves across a dosing cycle. A day before the first
 * dose, or longer after a dose than the interval, is left out. Null until there is enough logged data to say anything.
 */
export function intakeByCycleDay(
  days: DayIntake[],
  doses: HealthRecord[],
  intervalDays: number,
): CycleBucket[] | null {
  const doseDays = [...new Set(doses.map((d) => d.recordedOn))].sort();
  const logged = days.filter((d) => d.count > 0);
  if (doseDays.length < MIN_DOSES || logged.length < MIN_CYCLE_DAYS) return null;
  const buckets = new Map<number, DayIntake[]>();
  for (const d of logged) {
    const last = doseDays.filter((x) => x <= d.date).at(-1);
    if (!last) continue;
    const since = daysBetween(last, d.date);
    if (since >= intervalDays) continue;
    buckets.set(since, [...(buckets.get(since) ?? []), d]);
  }
  const out: CycleBucket[] = [...buckets.entries()]
    .sort(([a], [b]) => a - b)
    .map(([day, ds]) => {
      const proteins = ds.flatMap((d) => (d.protein === null ? [] : [d.protein]));
      return {
        day,
        days: ds.length,
        avgKcal: ds.reduce((s, d) => s + d.kcal, 0) / ds.length,
        avgProtein:
          proteins.length === 0 ? null : proteins.reduce((s, v) => s + v, 0) / proteins.length,
      };
    });
  return out.length >= 2 ? out : null;
}

export interface BeforeAfter {
  before: { days: number; avgKcal: number; avgProtein: number | null };
  after: { days: number; avgKcal: number; avgProtein: number | null };
}

const MIN_SIDE_DAYS = 7;

/** Average intake on the logged days before the medication started against the days since. Null without a week on each side. */
export function beforeAfter(days: DayIntake[], startedOn: string): BeforeAfter | null {
  const side = (ds: DayIntake[]) => {
    const proteins = ds.flatMap((d) => (d.protein === null ? [] : [d.protein]));
    return {
      days: ds.length,
      avgKcal: ds.reduce((s, d) => s + d.kcal, 0) / ds.length,
      avgProtein:
        proteins.length === 0 ? null : proteins.reduce((s, v) => s + v, 0) / proteins.length,
    };
  };
  const logged = days.filter((d) => d.count > 0);
  const before = logged.filter((d) => d.date < startedOn);
  const after = logged.filter((d) => d.date >= startedOn);
  if (before.length < MIN_SIDE_DAYS || after.length < MIN_SIDE_DAYS) return null;
  return { before: side(before), after: side(after) };
}

/** A calendar day with a 0 to 5 rating for each of appetite and nausea; the last rating of the day wins. */
export function ratingFor(
  records: HealthRecord[],
  kind: "appetite" | "nausea",
  date: string,
): number | null {
  const found = records
    .filter((r) => r.kind === kind && r.recordedOn === date && !r.deletedAt)
    .sort((a, b) => a.recordedAt.localeCompare(b.recordedAt))
    .at(-1);
  return found ? found.value : null;
}

/** Whether the person has used any of this: a plan, or any weight or dose. It decides if Today offers a nudge. */
export function usesHealth(settings: Pick<Settings, "medName">, records: HealthRecord[]): boolean {
  return settings.medName !== null || records.some((r) => r.kind === "weight" || r.kind === "dose");
}

/** What can be measured, in the order they are offered. Weight is kg, the rest are cm. */
export const MEASURES: Array<{
  kind: Extract<HealthKind, "weight" | CircumferenceKind>;
  label: string;
  unit: "kg" | "cm";
}> = [
  { kind: "weight", label: "Weight", unit: "kg" },
  { kind: "waist", label: "Waist", unit: "cm" },
  { kind: "hips", label: "Hips", unit: "cm" },
  { kind: "chest", label: "Chest", unit: "cm" },
  { kind: "arm", label: "Upper arm", unit: "cm" },
  { kind: "thigh", label: "Thigh", unit: "cm" },
  { kind: "neck", label: "Neck", unit: "cm" },
];

const isCircumference = (k: HealthKind): k is CircumferenceKind =>
  k === "waist" || k === "hips" || k === "chest" || k === "arm" || k === "thigh" || k === "neck";

export interface MeasureSummary {
  kind: CircumferenceKind;
  latest: HealthRecord;
  /** The first measurement, so the change is from where the person began. */
  first: HealthRecord;
  /** Latest minus first, in cm. Zero when there is only one. */
  changeCm: number;
  count: number;
}

/** One summary for each body measurement the person has logged, in the usual order. Kinds never logged are left out. */
export function measureSummaries(records: HealthRecord[]): MeasureSummary[] {
  const out: MeasureSummary[] = [];
  for (const m of MEASURES) {
    if (!isCircumference(m.kind)) continue;
    const rows = records
      .filter((r) => r.kind === m.kind && !r.deletedAt)
      .sort((a, b) => a.recordedAt.localeCompare(b.recordedAt));
    const first = rows[0];
    const latest = rows.at(-1);
    if (first && latest)
      out.push({
        kind: m.kind,
        latest,
        first,
        changeCm: latest.value - first.value,
        count: rows.length,
      });
  }
  return out;
}

interface MedicationSpan {
  name: string;
  firstOn: string;
  lastOn: string;
  count: number;
}

/** Each medication that has doses, in the order it was first taken. A name is matched without regard to case. */
export function medicationsIn(doses: HealthRecord[]): MedicationSpan[] {
  const by = new Map<string, MedicationSpan>();
  for (const d of [...doses]
    .filter((x) => x.kind === "dose" && !x.deletedAt)
    .sort((a, b) => a.recordedAt.localeCompare(b.recordedAt))) {
    const key = d.medication.trim().toLowerCase();
    const have = by.get(key);
    if (have) {
      have.lastOn = d.recordedOn;
      have.count++;
      have.name = d.medication.trim(); // the spelling used most recently
    } else
      by.set(key, {
        name: d.medication.trim(),
        firstOn: d.recordedOn,
        lastOn: d.recordedOn,
        count: 1,
      });
  }
  return [...by.values()].sort((a, b) => a.firstOn.localeCompare(b.firstOn));
}

/** Days between doses of a medication: from the product when it is one, else the usual gap in the person's own doses. */
export function intervalOf(
  productDays: number | null,
  doses: HealthRecord[],
  fallbackDays: number,
): number {
  if (productDays !== null) return productDays;
  const days = [...new Set(doses.map((d) => d.recordedOn))].sort();
  const gaps = days.slice(1).map((d, i) => daysBetween(days[i] ?? d, d));
  if (gaps.length === 0) return fallbackDays;
  const sorted = [...gaps].sort((a, b) => a - b);
  return Math.max(1, sorted[Math.floor(sorted.length / 2)] ?? fallbackDays);
}

export interface MedicationPeriod {
  /** "Before" the first dose of anything, or the medication's name. */
  label: string;
  from: string | null;
  to: string | null;
  days: number;
  avgKcal: number;
  avgProtein: number | null;
}

const MIN_PERIOD_DAYS = 3;

/**
 * Average intake in each stretch: before any dose, then while on each medication (from its first dose to the day before the
 * next medication's first). A stretch with fewer than three logged days is left out. Null unless two or more remain.
 */
export function intakeByMedication(
  days: DayIntake[],
  meds: MedicationSpan[],
): MedicationPeriod[] | null {
  const first = meds[0];
  if (!first || meds.length < 2) return null;
  const logged = days.filter((d) => d.count > 0);
  const make = (label: string, from: string | null, to: string | null): MedicationPeriod | null => {
    const inside = logged.filter(
      (d) => (from === null || d.date >= from) && (to === null || d.date <= to),
    );
    if (inside.length < MIN_PERIOD_DAYS) return null;
    const proteins = inside.flatMap((d) => (d.protein === null ? [] : [d.protein]));
    return {
      label,
      from,
      to,
      days: inside.length,
      avgKcal: inside.reduce((s, d) => s + d.kcal, 0) / inside.length,
      avgProtein:
        proteins.length === 0 ? null : proteins.reduce((s, v) => s + v, 0) / proteins.length,
    };
  };
  const periods = [
    make("Before", null, addDays(first.firstOn, -1)),
    ...meds.map((m, i) =>
      make(m.name, m.firstOn, meds[i + 1] ? addDays(meds[i + 1]?.firstOn ?? m.firstOn, -1) : null),
    ),
  ].filter((p): p is MedicationPeriod => p !== null);
  return periods.length >= 2 ? periods : null;
}

type HealthTab = "weight" | "medication" | "insights";

/** Where Health opens: on whatever is overdue (a dose due, a week without weighing), else on the person's main habit. */
export function suggestedTab(o: {
  doseDue: boolean;
  weightStale: boolean;
  tracksMedication: boolean;
}): HealthTab {
  if (o.doseDue) return "medication";
  if (o.weightStale) return "weight";
  return o.tracksMedication ? "medication" : "weight";
}
