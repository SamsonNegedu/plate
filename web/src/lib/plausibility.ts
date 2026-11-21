import type { Nutrients } from "@/db/types";

/**
 * The checks every nutrition label obeys, the same rules as the server's `internal/food/plausibility.go`. A missing
 * nutrient is skipped, never read as 0. An empty list means nothing contradicts itself, not that the numbers are right.
 * Codes match the server's so one set of messages serves both.
 */
export type Issue =
  | "energy_mismatch"
  | "macros_over_100"
  | "saturates_over_fat"
  | "sugars_over_carbohydrate"
  | "kj_kcal_mismatch"
  | "out_of_range";

const ENERGY_TOLERANCE = 0.15;
const ENERGY_FLOOR = 20; // kcal; small values would otherwise fail on rounding alone
const KJ_TOLERANCE = 0.05;
const KJ_PER_KCAL = 4.184;
const ROUNDING = 0.05; // labels round to 0.1 g
const MAX_KCAL = 1000; // the server's hard limit per 100 g

const inRange = (v: number | null, max: number): boolean => v === null || (v >= 0 && v <= max);

export function plausibility(n: Nutrients, kj: number | null = null): Issue[] {
  const issues: Issue[] = [];
  const grams = [n.protein, n.carbs, n.fat, n.sugar, n.satfat, n.fiber, n.salt];
  const macros = (n.protein ?? 0) + (n.carbs ?? 0) + (n.fat ?? 0);
  if (!(n.kcal >= 0 && n.kcal <= MAX_KCAL) || !grams.every((g) => inRange(g, 100)) || macros > 105)
    issues.push("out_of_range");
  if (n.protein !== null && n.carbs !== null && n.fat !== null) {
    if (n.protein + n.carbs + n.fat > 101) issues.push("macros_over_100");
    const expected = 4 * n.protein + 4 * n.carbs + 9 * n.fat + 2 * (n.fiber ?? 0);
    if (Math.abs(expected - n.kcal) > Math.max(ENERGY_TOLERANCE * n.kcal, ENERGY_FLOOR))
      issues.push("energy_mismatch");
  }
  if (n.satfat !== null && n.fat !== null && n.satfat > n.fat + ROUNDING)
    issues.push("saturates_over_fat");
  if (n.sugar !== null && n.carbs !== null && n.sugar > n.carbs + ROUNDING)
    issues.push("sugars_over_carbohydrate");
  if (kj !== null && Math.abs(kj - KJ_PER_KCAL * n.kcal) > Math.max(KJ_TOLERANCE * kj, 5))
    issues.push("kj_kcal_mismatch");
  return issues;
}

/** The calories fat, carbohydrate, protein and fibre add up to, or null when one of the three is missing. */
export function expectedKcal(n: Nutrients): number | null {
  if (n.protein === null || n.carbs === null || n.fat === null) return null;
  return 4 * n.protein + 4 * n.carbs + 9 * n.fat + 2 * (n.fiber ?? 0);
}
