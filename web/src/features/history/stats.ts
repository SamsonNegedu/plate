import type { Entry } from "@/db/types";
import { dateRange } from "@/lib/dates";
import { dayTotals } from "@/lib/nutrition";

export interface DayPoint {
  date: string;
  kcal: number;
  protein: number | null;
  carbs: number | null;
  fat: number | null;
  count: number;
}

/** One point per calendar date in the range. Days with no entries are zero, not missing. */
export function buildDays(entries: Entry[], from: string, to: string): DayPoint[] {
  const byDay = new Map<string, Entry[]>();
  for (const e of entries) {
    if (e.deletedAt) continue;
    const list = byDay.get(e.eatenOn);
    if (list) list.push(e);
    else byDay.set(e.eatenOn, [e]);
  }
  return dateRange(from, to).map((date) => {
    const t = dayTotals(byDay.get(date) ?? []);
    return {
      date,
      kcal: Math.round(t.kcal),
      protein: t.protein,
      carbs: t.carbs,
      fat: t.fat,
      count: t.count,
    };
  });
}

export interface Stats {
  averageKcal: number | null;
  daysLogged: number;
  daysOver: number;
  weekAverage: number | null;
}

/** The average ignores empty days: a day you did not log is not a zero-calorie day. */
export function summarize(days: DayPoint[], goal: number): Stats {
  const logged = days.filter((d) => d.count > 0);
  const mean = (xs: DayPoint[]) =>
    xs.length === 0 ? null : Math.round(xs.reduce((s, d) => s + d.kcal, 0) / xs.length);
  return {
    averageKcal: mean(logged),
    daysLogged: logged.length,
    daysOver: logged.filter((d) => d.kcal > goal).length,
    weekAverage: mean(days.slice(-7).filter((d) => d.count > 0)),
  };
}

/** Which x labels to draw: every day for 7, every other for 14, every fourth for 30, always the last. */
export function labelEvery(range: number): number {
  return range <= 7 ? 1 : range <= 14 ? 2 : 4;
}

export function niceMax(value: number): number {
  if (value <= 0) return 1000;
  const steps = [500, 1000, 1500, 2000, 2500, 3000, 4000, 5000, 6000, 8000, 10000];
  return steps.find((s) => s >= value) ?? Math.ceil(value / 1000) * 1000;
}

/** Y position of a value, with 0 at the baseline. */
export function yFor(value: number, max: number, top: number, bottom: number): number {
  return bottom - (Math.min(value, max) / max) * (bottom - top);
}
