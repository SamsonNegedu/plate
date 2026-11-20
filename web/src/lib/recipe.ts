import type { Entry, Nutrients, SavedMealItem } from "@/db/types";
import { portionOf, type Portion } from "./nutrition";

type Ingredient = Pick<
  SavedMealItem,
  "grams" | "kcal" | "protein" | "carbs" | "fat" | "sugar" | "satfat" | "fiber" | "salt"
>;

const KEYS = ["protein", "carbs", "fat", "sugar", "satfat", "fiber", "salt"] as const;
type Key = (typeof KEYS)[number];

export const NUTRIENT_NAME: Record<Key, string> = {
  protein: "protein",
  carbs: "carbs",
  fat: "fat",
  sugar: "sugar",
  satfat: "saturated fat",
  fiber: "fibre",
  salt: "salt",
};

export interface RecipeNutrition {
  /** Combined weight of the ingredients as entered. Nutrition per 100 g is measured against this, so no cooked weight is needed. */
  totalGrams: number;
  /** One portion's weight: the total divided by the portions the recipe makes. */
  portionGrams: number;
  /** Per 100 g of ingredients. A nutrient is null only when no ingredient reports it. */
  per100: Nutrients;
  /** What the whole recipe adds up to. */
  total: Portion;
  /** What one portion adds up to. */
  portion: Portion;
  /** Nutrients that only some ingredients report, so the totals undercount them. */
  partial: Key[];
}

const eaten = (per100: number | null, grams: number): number | null =>
  per100 === null ? null : (per100 * grams) / 100;

/**
 * Ingredient grams, not cooked weight, are the reference: calories do not change when food cooks, so the recipe total is the
 * sum of its ingredients and a portion is that total over the portions made.
 */
export function recipeNutrition(items: Ingredient[], servings: number): RecipeNutrition {
  const totalGrams = items.reduce((s, i) => s + i.grams, 0);
  let kcal = 0;
  const sums: Record<Key, number | null> = {
    protein: null,
    carbs: null,
    fat: null,
    sugar: null,
    satfat: null,
    fiber: null,
    salt: null,
  };
  const missing = new Set<Key>();
  for (const i of items) {
    kcal += (i.kcal * i.grams) / 100;
    for (const k of KEYS) {
      const v = eaten(i[k], i.grams);
      if (v === null) missing.add(k);
      else sums[k] = (sums[k] ?? 0) + v;
    }
  }
  const safe = servings > 0 ? servings : 1;
  const per100 = (v: number) => (totalGrams > 0 ? (v / totalGrams) * 100 : 0);
  const per100Nutrients: Nutrients = {
    kcal: per100(kcal),
    protein: sums.protein === null ? null : per100(sums.protein),
    carbs: sums.carbs === null ? null : per100(sums.carbs),
    fat: sums.fat === null ? null : per100(sums.fat),
    sugar: sums.sugar === null ? null : per100(sums.sugar),
    satfat: sums.satfat === null ? null : per100(sums.satfat),
    fiber: sums.fiber === null ? null : per100(sums.fiber),
    salt: sums.salt === null ? null : per100(sums.salt),
  };
  const total = portionOf(per100Nutrients, totalGrams);
  return {
    totalGrams,
    portionGrams: totalGrams / safe,
    per100: per100Nutrients,
    total,
    portion: portionOf(per100Nutrients, totalGrams / safe),
    partial: KEYS.filter((k) => missing.has(k) && sums[k] !== null),
  };
}

/** Each ingredient's share of the recipe's calories, largest first. */
export function ingredientShares<T extends Ingredient>(
  items: T[],
): Array<{ item: T; kcal: number; share: number }> {
  const kcals = items.map((item) => ({ item, kcal: (item.kcal * item.grams) / 100 }));
  const total = kcals.reduce((s, k) => s + k.kcal, 0);
  return kcals
    .map((k) => ({ ...k, share: total > 0 ? k.kcal / total : 0 }))
    .sort((a, b) => b.kcal - a.kcal);
}

/** Entries logged from a recipe carry this brand, so a day can show them as recipes. */
export const RECIPE_BRAND = "Recipe";

export const isRecipeEntry = (e: Pick<Entry, "foodId" | "brand" | "unit">): boolean =>
  e.foodId === null && e.brand === RECIPE_BRAND && e.unit === "serving";

const FRACTIONS: Array<[number, string]> = [
  [0.25, "¼"],
  [0.5, "½"],
  [0.75, "¾"],
];

/** "1 portion", "½ portion", "1½ portions", "2.3 portions". */
export function portionLabel(portions: number): string {
  const whole = Math.floor(portions + 0.01);
  const rest = portions - whole;
  const frac = rest < 0.01 ? "" : (FRACTIONS.find(([v]) => Math.abs(v - rest) < 0.01)?.[1] ?? null);
  if (frac === null) return `${Math.round(portions * 100) / 100} portions`;
  const text = `${whole > 0 ? whole : ""}${frac}`;
  return portions === 1 ? "1 portion" : `${text} ${portions < 1 ? "portion" : "portions"}`;
}
