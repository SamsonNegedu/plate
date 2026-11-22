import type { CategoryInfo, Nutrients } from "@/db/types";

/**
 * Compares a food's values with the usual range of its category (computed from all German products of that category when the
 * catalog is built). A value is outside when it is 25% beyond the 5th or 95th percentile and by more than a small floor, so
 * rounding and tiny numbers never count. A food is unusual when two or more nutrients are outside and one is energy, fat or
 * protein: a lone odd value is a normal product, several at once is a data-entry mistake such as per-portion values stored as
 * per 100 g.
 */
type Key = "kcal" | "fat" | "protein" | "carbs" | "salt";

const FLOOR: Record<Key, number> = { kcal: 40, fat: 3, protein: 3, carbs: 5, salt: 0.3 };
const FACTOR = 1.25;
const LEADING: Key[] = ["kcal", "fat", "protein"];

interface Outlier {
  key: Key;
  direction: "above" | "below";
}

export function categoryOutliers(n: Nutrients, c: CategoryInfo): Outlier[] {
  const values: Record<Key, number | null> = {
    kcal: n.kcal,
    fat: n.fat,
    protein: n.protein,
    carbs: n.carbs,
    salt: n.salt,
  };
  const out: Outlier[] = [];
  for (const key of Object.keys(FLOOR) as Key[]) {
    const range = c.ranges[key];
    const v = values[key];
    if (!range || v === null) continue; // a missing nutrient is never compared as 0
    const [lo, , hi] = range;
    if (v > hi * FACTOR && v - hi > FLOOR[key]) out.push({ key, direction: "above" });
    else if (v < lo / FACTOR && lo - v > FLOOR[key]) out.push({ key, direction: "below" });
  }
  return out.length >= 2 && out.some((o) => LEADING.includes(o.key)) ? out : [];
}

const LABEL: Record<Key, string> = {
  kcal: "energy",
  fat: "fat",
  protein: "protein",
  carbs: "carbohydrate",
  salt: "salt",
};

const list = (xs: string[]): string =>
  xs.length > 1 ? `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}` : (xs[0] ?? "");

/** The sentence for the product sheet, or null when nothing is unusual. */
export function categoryNote(n: Nutrients, c: CategoryInfo): string | null {
  const out = categoryOutliers(n, c);
  if (out.length === 0) return null;
  const parts = (["above", "below"] as const)
    .map((d) => ({ d, keys: out.filter((o) => o.direction === d).map((o) => LABEL[o.key]) }))
    .filter((g) => g.keys.length > 0)
    .map((g) => `${list(g.keys)} ${g.d === "above" ? "above" : "below"} the usual range`);
  return `These values look unusual for ${c.name}: ${parts.join(", ")}. Check the label.`;
}
