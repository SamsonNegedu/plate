import type { Entry, Nutrients, Unit } from "@/db/types";

export type Per100 = Nutrients;

export interface Portion {
  kcal: number;
  protein: number | null;
  carbs: number | null;
  fat: number | null;
  sugar: number | null;
  satfat: number | null;
  fiber: number | null;
  salt: number | null;
}

const scale = (v: number | null, grams: number): number | null =>
  v === null ? null : (v * grams) / 100;

/** Nutrition of an eaten amount. Missing nutrients stay null. */
export function portionOf(n: Per100, grams: number): Portion {
  return {
    kcal: (n.kcal * grams) / 100,
    protein: scale(n.protein, grams),
    carbs: scale(n.carbs, grams),
    fat: scale(n.fat, grams),
    sugar: scale(n.sugar, grams),
    satfat: scale(n.satfat, grams),
    fiber: scale(n.fiber, grams),
    salt: scale(n.salt, grams),
  };
}

export interface UnitInfo {
  servingGrams: number | null;
}

/** Which units a food offers: ml only for liquids is the caller's call; portion needs a serving weight. */
export function unitsFor(info: UnitInfo, liquid: boolean): Unit[] {
  const units: Unit[] = ["g"];
  if (liquid) units.push("ml");
  if (info.servingGrams !== null && info.servingGrams > 0) units.push("serving");
  return units;
}

/** Grams for an amount. A serving or piece needs the serving weight: a missing one is an error, never "per 100 g". */
export function gramsFor(amount: number, unit: Unit, servingGrams: number | null): number | null {
  if (!(amount > 0) || !Number.isFinite(amount)) return null;
  switch (unit) {
    case "g":
    case "ml":
      return amount;
    case "serving":
    case "piece":
      return servingGrams !== null && servingGrams > 0 ? amount * servingGrams : null;
  }
}

export const MAX_GRAMS = 5000;

export interface DayTotals {
  kcal: number;
  protein: number | null;
  carbs: number | null;
  fat: number | null;
  fiber: number | null;
  count: number;
  missing: Array<"protein" | "carbs" | "fat">;
}

/** Sum unrounded entry values, then let the caller round for display. A macro is null only when no entry reported it. */
export function dayTotals(
  entries: Array<
    Pick<Entry, "kcal" | "protein" | "carbs" | "fat" | "fiber" | "grams" | "deletedAt">
  >,
): DayTotals {
  let kcal = 0;
  let fiber: number | null = null;
  const sums: Record<"protein" | "carbs" | "fat", number | null> = {
    protein: null,
    carbs: null,
    fat: null,
  };
  const missing = new Set<"protein" | "carbs" | "fat">();
  let count = 0;
  for (const e of entries) {
    if (e.deletedAt) continue;
    count++;
    kcal += (e.kcal * e.grams) / 100;
    for (const k of ["protein", "carbs", "fat"] as const) {
      const v = e[k];
      if (v === null) missing.add(k);
      else sums[k] = (sums[k] ?? 0) + (v * e.grams) / 100;
    }
    if (e.fiber !== null) fiber = (fiber ?? 0) + (e.fiber * e.grams) / 100;
  }
  return {
    kcal,
    ...sums,
    fiber,
    count,
    missing: (["protein", "carbs", "fat"] as const).filter((k) => missing.has(k)),
  };
}

/** Entry total as shown on a row. */
export function entryKcal(e: Pick<Entry, "kcal" | "grams">): number {
  return (e.kcal * e.grams) / 100;
}

/** The label of an amount: "40 g", "2 portions", "250 ml". */
export function amountLabel(amount: number, unit: Unit): string {
  const n = Number.isInteger(amount) ? String(amount) : String(Math.round(amount * 10) / 10);
  switch (unit) {
    case "g":
      return `${n} g`;
    case "ml":
      return `${n} ml`;
    case "serving":
      return amount === 1 ? "1 portion" : `${n} portions`;
    case "piece":
      return amount === 1 ? "1 piece" : `${n} pieces`;
  }
}

/** Goal progress capped at 100 percent for the meter; "over" is stated separately. */
export function meterFill(
  eaten: number,
  goal: number,
): { fill: number; over: boolean; left: number } {
  const left = goal - eaten;
  return {
    fill: goal > 0 ? Math.max(0, Math.min(1, eaten / goal)) : 0,
    over: left < 0,
    left: Math.abs(left),
  };
}

export type NutrientKey = "protein" | "carbs" | "fat" | "sugar" | "satfat" | "fiber" | "salt";
const NUTRIENT_KEYS: readonly NutrientKey[] = [
  "protein",
  "carbs",
  "fat",
  "sugar",
  "satfat",
  "fiber",
  "salt",
];

export interface NutrientTotals {
  kcal: number;
  /** Null when no entry reported it: not 0. */
  protein: number | null;
  carbs: number | null;
  fat: number | null;
  sugar: number | null;
  satfat: number | null;
  fiber: number | null;
  salt: number | null;
  count: number;
  /** Nutrients some entries report and others do not, so the total undercounts them. */
  partial: NutrientKey[];
}

/** The eaten amount of every nutrient across entries. A nutrient is null only when nothing reported it. */
export function nutrientTotals(
  entries: Array<Pick<Entry, "kcal" | "grams" | "deletedAt"> & Record<NutrientKey, number | null>>,
): NutrientTotals {
  let kcal = 0;
  let count = 0;
  const sums: Record<NutrientKey, number | null> = {
    protein: null,
    carbs: null,
    fat: null,
    sugar: null,
    satfat: null,
    fiber: null,
    salt: null,
  };
  const missing = new Set<NutrientKey>();
  for (const e of entries) {
    if (e.deletedAt) continue;
    count++;
    kcal += (e.kcal * e.grams) / 100;
    for (const k of NUTRIENT_KEYS) {
      const v = e[k];
      if (v === null) missing.add(k);
      else sums[k] = (sums[k] ?? 0) + (v * e.grams) / 100;
    }
  }
  return {
    kcal,
    ...sums,
    count,
    partial: NUTRIENT_KEYS.filter((k) => missing.has(k) && sums[k] !== null),
  };
}
