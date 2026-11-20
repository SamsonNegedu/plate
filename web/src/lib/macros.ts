/** Energy per gram, the figures food labels use. */
export const KCAL_PER_G = { protein: 4, carbs: 4, fat: 9 } as const;

export type MacroKey = keyof typeof KCAL_PER_G;
export type MacroGrams = Record<MacroKey, number>;

/** Calories the three macros add up to. */
export function macroKcal(g: MacroGrams): number {
  return g.protein * KCAL_PER_G.protein + g.carbs * KCAL_PER_G.carbs + g.fat * KCAL_PER_G.fat;
}

/** Each macro's share of the calories the macros add up to, 0 to 1. All zero when none is set. */
export function macroSplit(g: MacroGrams): MacroGrams {
  const total = macroKcal(g);
  if (total <= 0) return { protein: 0, carbs: 0, fat: 0 };
  return {
    protein: (g.protein * KCAL_PER_G.protein) / total,
    carbs: (g.carbs * KCAL_PER_G.carbs) / total,
    fat: (g.fat * KCAL_PER_G.fat) / total,
  };
}

/** Grams of a macro that make up a percentage of the daily calories. */
export function gramsFromPercent(goalKcal: number, percent: number, key: MacroKey): number {
  return Math.round(((goalKcal * percent) / 100 / KCAL_PER_G[key]) * 10) / 10;
}

/** The percentage of the daily calories a macro's grams are worth. */
export function percentFromGrams(goalKcal: number, grams: number, key: MacroKey): number {
  return goalKcal > 0 ? Math.round(((grams * KCAL_PER_G[key]) / goalKcal) * 1000) / 10 : 0;
}

export interface Reconciliation {
  kcal: number;
  /** Macro calories as a share of the calorie goal, 0 to 1 and above. */
  ratio: number;
  /** Calories above (positive) or below (negative) the goal. */
  diff: number;
  matches: boolean;
}

/** How far the macros' calories are from the calorie goal. Within 5% counts as matching. */
export function reconcile(goalKcal: number, g: MacroGrams): Reconciliation {
  const kcal = macroKcal(g);
  const ratio = goalKcal > 0 ? kcal / goalKcal : 0;
  return { kcal, ratio, diff: kcal - goalKcal, matches: Math.abs(ratio - 1) <= 0.05 };
}
