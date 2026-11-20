import type { Entry, Meal } from "@/db/types";
import { MEALS } from "@/db/types";
import { dateRange, parseDate } from "@/lib/dates";
import { formatGrams, formatKcal } from "@/lib/numbers";
import { dayTotals, entryKcal } from "@/lib/nutrition";

export type Metric = "kcal" | "protein" | "carbs" | "fat" | "fiber" | "sugar" | "satfat" | "salt";

export const METRICS: Array<{ key: Metric; label: string }> = [
  { key: "kcal", label: "Calories" },
  { key: "protein", label: "Protein" },
  { key: "carbs", label: "Carbs" },
  { key: "fat", label: "Fat" },
  { key: "fiber", label: "Fibre" },
  { key: "sugar", label: "Sugar" },
  { key: "satfat", label: "Sat. fat" },
  { key: "salt", label: "Salt" },
];

const NUTRIENTS = ["protein", "carbs", "fat", "fiber", "sugar", "satfat", "salt"] as const;
type Nutrient = (typeof NUTRIENTS)[number];

export interface DayPoint {
  date: string;
  kcal: number;
  protein: number | null;
  carbs: number | null;
  fat: number | null;
  fiber: number | null;
  sugar: number | null;
  satfat: number | null;
  salt: number | null;
  count: number;
  /** Nutrients that some, but not all, entries reported: the day's total undercounts them. */
  partial: Metric[];
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/** Sum of an eaten nutrient. Null when no entry reported it; `partial` when only some did. */
function sumNutrient(entries: Entry[], key: Nutrient): { value: number | null; partial: boolean } {
  let value: number | null = null;
  let missing = false;
  for (const e of entries) {
    const v = e[key];
    if (v === null) missing = true;
    else value = (value ?? 0) + (v * e.grams) / 100;
  }
  return { value: value === null ? null : round1(value), partial: missing && value !== null };
}

/** The goal for a metric, or null when the person has not set one (or set it to zero). */
export function goalFor(
  metric: Metric,
  goals: { goalKcal: number; proteinG: number; carbsG: number; fatG: number; fiberG: number },
): number | null {
  const byMetric: Partial<Record<Metric, number>> = {
    kcal: goals.goalKcal,
    protein: goals.proteinG,
    carbs: goals.carbsG,
    fat: goals.fatG,
    fiber: goals.fiberG,
  };
  const goal = byMetric[metric] ?? 0;
  return goal > 0 ? goal : null;
}

/** One point per calendar date in the range. A day with no entries has zero kcal here; `valueOf` turns it into a gap. */
export function buildDays(entries: Entry[], from: string, to: string): DayPoint[] {
  const byDay = new Map<string, Entry[]>();
  for (const e of entries) {
    if (e.deletedAt) continue;
    const list = byDay.get(e.eatenOn);
    if (list) list.push(e);
    else byDay.set(e.eatenOn, [e]);
  }
  return dateRange(from, to).map((date) => {
    const mine = byDay.get(date) ?? [];
    const sums = NUTRIENTS.map((k) => [k, sumNutrient(mine, k)] as const);
    return {
      date,
      kcal: Math.round(dayTotals(mine).kcal),
      count: mine.length,
      ...(Object.fromEntries(sums.map(([k, r]) => [k, r.value])) as Record<
        Nutrient,
        number | null
      >),
      partial: sums.filter(([, r]) => r.partial).map(([k]) => k),
    };
  });
}

/** What a charted value is counted in. */
export const unitOf = (metric: Metric): string => (metric === "kcal" ? "kcal" : "g");

/** A value as a bare number: whole kcal, grams to one decimal. */
export const formatMetric = (value: number, metric: Metric): string =>
  metric === "kcal" ? formatKcal(value) : formatGrams(value);

/** A value with its unit and name: "1,840 kcal", "23 g fibre". */
export function amountText(value: number, metric: Metric): string {
  if (metric === "kcal") return `${formatKcal(value)} kcal`;
  const name = METRICS.find((m) => m.key === metric)?.label.toLowerCase() ?? metric;
  return `${formatGrams(value)} g ${name}`;
}

/** The charted value of a day. An unlogged day, or a day where nothing reported the nutrient, is null: a gap, never zero. */
export function valueOf(d: DayPoint, metric: Metric): number | null {
  if (d.count === 0) return null;
  return metric === "kcal" ? d.kcal : d[metric];
}

export interface Stats {
  average: number | null;
  daysLogged: number;
  /** Kcal: days over the goal. Any other nutrient: days that reached it. Null when there is no goal. */
  daysFlagged: number | null;
  weekAverage: number | null;
  /** The largest charted day in the range. */
  peak: number | null;
}

/** The average ignores empty days: a day you did not log is not a zero-calorie day. */
export function summarize(days: DayPoint[], goal: number | null, metric: Metric = "kcal"): Stats {
  const present = (xs: DayPoint[]) =>
    xs.flatMap((d) => {
      const v = valueOf(d, metric);
      return v === null ? [] : [v];
    });
  const mean = (xs: number[]) =>
    xs.length === 0 ? null : round1(xs.reduce((s, v) => s + v, 0) / xs.length);
  const values = present(days);
  return {
    average: mean(values),
    daysLogged: days.filter((d) => d.count > 0).length,
    daysFlagged:
      goal === null
        ? null
        : values.filter((v) => (metric === "kcal" ? v > goal : v >= goal)).length,
    weekAverage: mean(present(days.slice(-7))),
    peak: values.length === 0 ? null : Math.max(...values),
  };
}

/**
 * Rolling mean of the logged days in the trailing window, one value per day. A day with nothing logged in its window is null,
 * so the line breaks instead of dipping to zero.
 */
export function movingAverage(days: DayPoint[], metric: Metric, window = 7): Array<number | null> {
  return days.map((_, i) => {
    const values = days.slice(Math.max(0, i - window + 1), i + 1).flatMap((d) => {
      const v = valueOf(d, metric);
      return v === null ? [] : [v];
    });
    return values.length === 0 ? null : values.reduce((s, v) => s + v, 0) / values.length;
  });
}

const WEEKDAYS = [
  "Sundays",
  "Mondays",
  "Tuesdays",
  "Wednesdays",
  "Thursdays",
  "Fridays",
  "Saturdays",
];
const MIN_LOGGED_DAYS = 10;
const MIN_PER_WEEKDAY = 2;

export interface WeekdayInsight {
  /** Up to two weekdays, in calendar order starting Monday. */
  weekdays: string[];
  /** How far their average sits above the overall average, in kcal. */
  above: number;
}

/** The weekdays you eat clearly more on than usual. Null until there is enough logged data to say so honestly. */
export function weekdayInsight(days: DayPoint[]): WeekdayInsight | null {
  const logged = days.filter((d) => d.count > 0);
  if (logged.length < MIN_LOGGED_DAYS) return null;
  const overall = logged.reduce((s, d) => s + d.kcal, 0) / logged.length;
  const byWeekday = new Map<number, number[]>();
  for (const d of logged) {
    const wd = parseDate(d.date).getDay();
    byWeekday.set(wd, [...(byWeekday.get(wd) ?? []), d.kcal]);
  }
  const threshold = Math.max(150, overall * 0.1);
  const high = [...byWeekday.entries()]
    .filter(([, xs]) => xs.length >= MIN_PER_WEEKDAY)
    .map(([wd, xs]) => ({ wd, diff: xs.reduce((s, v) => s + v, 0) / xs.length - overall }))
    .filter((w) => w.diff >= threshold)
    .sort((a, b) => b.diff - a.diff)
    .slice(0, 2);
  if (high.length === 0) return null;
  const calendar = [...high].sort((a, b) => ((a.wd + 6) % 7) - ((b.wd + 6) % 7));
  const above = high.reduce((s, w) => s + w.diff, 0) / high.length;
  return {
    weekdays: calendar.map((w) => WEEKDAYS[w.wd] ?? ""),
    above: Math.round(above / 10) * 10,
  };
}

export interface TopFood {
  key: string;
  name: string;
  brand: string;
  times: number;
  kcal: number;
  /** Share of all calories in the range, 0 to 1. */
  share: number;
}

/** The foods that supply most of the calories. Entries of the same food are grouped by food id, else by name and brand. */
export function topFoods(entries: Entry[], limit = 5): { foods: TopFood[]; totalKcal: number } {
  const groups = new Map<string, Omit<TopFood, "share">>();
  let totalKcal = 0;
  for (const e of entries) {
    if (e.deletedAt) continue;
    const kcal = entryKcal(e);
    totalKcal += kcal;
    const key = e.foodId ?? `${e.name.trim().toLowerCase()}|${e.brand.trim().toLowerCase()}`;
    const g = groups.get(key);
    if (g) {
      g.times++;
      g.kcal += kcal;
    } else groups.set(key, { key, name: e.name, brand: e.brand, times: 1, kcal });
  }
  const foods = [...groups.values()]
    .sort((a, b) => b.kcal - a.kcal)
    .slice(0, limit)
    .map((g) => ({ ...g, share: totalKcal > 0 ? g.kcal / totalKcal : 0 }));
  return { foods, totalKcal };
}

export interface DayDetail {
  meals: Array<{ meal: Meal; kcal: number; count: number }>;
  /** The three entries with the most calories, with their share of the day. */
  biggest: Array<{ id: string; name: string; kcal: number; share: number }>;
}

/** Where a day's calories came from. */
export function dayDetail(entries: Entry[]): DayDetail {
  const live = entries.filter((e) => !e.deletedAt);
  const total = live.reduce((s, e) => s + entryKcal(e), 0);
  return {
    meals: MEALS.flatMap((meal) => {
      const mine = live.filter((e) => e.meal === meal);
      return mine.length === 0
        ? []
        : [{ meal, kcal: mine.reduce((s, e) => s + entryKcal(e), 0), count: mine.length }];
    }),
    biggest: [...live]
      .sort((a, b) => entryKcal(b) - entryKcal(a))
      .slice(0, 3)
      .map((e) => ({
        id: e.id,
        name: e.name,
        kcal: entryKcal(e),
        share: total > 0 ? entryKcal(e) / total : 0,
      })),
  };
}

/** Which x labels to draw: every day for 7, every other for 14, every fourth for 30, always the last. */
export function labelEvery(range: number): number {
  if (range <= 7) return 1;
  if (range <= 14) return 2;
  return 4;
}

const KCAL_STEPS = [500, 1000, 1500, 2000, 2500, 3000, 4000, 5000, 6000, 8000, 10000];
const NICE = [1, 1.5, 2, 2.5, 3, 4, 5, 7.5, 10];

/** The next round axis maximum: fixed kcal steps, or 1 / 1.5 / 2 / 2.5 ... times a power of ten for grams. */
export function niceMax(value: number, metric: Metric = "kcal"): number {
  if (metric === "kcal") {
    if (value <= 0) return 1000;
    return KCAL_STEPS.find((s) => s >= value) ?? Math.ceil(value / 1000) * 1000;
  }
  if (value <= 0) return 10;
  const base = 10 ** Math.floor(Math.log10(value));
  return (NICE.find((n) => n * base >= value) ?? 10) * base;
}

/** Y position of a value, with 0 at the baseline. */
export function yFor(value: number, max: number, top: number, bottom: number): number {
  return bottom - (Math.min(value, max) / max) * (bottom - top);
}

/**
 * A smooth curve through the points that never overshoots them: between two points it stays between their heights, so a
 * moving average does not bulge above its own peaks. Fritsch-Carlson monotone cubic, as a Bezier path.
 */
export function monotonePath(points: Array<[number, number]>): string {
  const n = points.length;
  if (n < 2) return "";
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  const dx = xs.slice(1).map((x, i) => x - (xs[i] ?? 0));
  const slope = dx.map((d, i) => ((ys[i + 1] ?? 0) - (ys[i] ?? 0)) / d);
  const tangent = new Array<number>(n).fill(0);
  tangent[0] = slope[0] ?? 0;
  tangent[n - 1] = slope[n - 2] ?? 0;
  for (let i = 1; i < n - 1; i++) {
    const a = slope[i - 1] ?? 0;
    const b = slope[i] ?? 0;
    tangent[i] = a * b <= 0 ? 0 : (a + b) / 2;
  }
  for (let i = 0; i < n - 1; i++) {
    const m = slope[i] ?? 0;
    if (m === 0) {
      tangent[i] = 0;
      tangent[i + 1] = 0;
      continue;
    }
    const a = (tangent[i] ?? 0) / m;
    const b = (tangent[i + 1] ?? 0) / m;
    const sum = a * a + b * b;
    if (sum > 9) {
      const k = 3 / Math.sqrt(sum);
      tangent[i] = k * a * m;
      tangent[i + 1] = k * b * m;
    }
  }
  const f = (v: number) => v.toFixed(1);
  let path = `M${f(xs[0] ?? 0)} ${f(ys[0] ?? 0)}`;
  for (let i = 0; i < n - 1; i++) {
    const d = (dx[i] ?? 0) / 3;
    const [x0, y0, x1, y1] = [xs[i] ?? 0, ys[i] ?? 0, xs[i + 1] ?? 0, ys[i + 1] ?? 0];
    path += `C${f(x0 + d)} ${f(y0 + (tangent[i] ?? 0) * d)} ${f(x1 - d)} ${f(y1 - (tangent[i + 1] ?? 0) * d)} ${f(x1)} ${f(y1)}`;
  }
  return path;
}
