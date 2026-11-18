import type { Food, Unit } from "@/db/types";
import { parseDecimal } from "@/lib/numbers";

/** Liquids offer ml. Open Food Facts rarely says so directly, so read the package and serving text. */
export function isLiquid(food: Pick<Food, "quantity" | "servingSize">): boolean {
  return /\d\s*(ml|cl|l)\b/i.test(food.quantity) || /\d\s*(ml|cl)\b/i.test(food.servingSize);
}

/** A numeric package size in g or ml, for the "whole pack" preset. */
export function packSize(
  food: Pick<Food, "quantity">,
): { amount: number; unit: "g" | "ml" } | null {
  const m = /^\s*(\d+(?:[.,]\d+)?)\s*(kg|g|l|ml|cl)\b/i.exec(food.quantity);
  if (!m) return null;
  const n = parseDecimal(m[1] ?? "");
  if (n === null || n <= 0) return null;
  switch ((m[2] ?? "").toLowerCase()) {
    case "kg":
      return { amount: n * 1000, unit: "g" };
    case "g":
      return { amount: n, unit: "g" };
    case "l":
      return { amount: n * 1000, unit: "ml" };
    case "cl":
      return { amount: n * 10, unit: "ml" };
    default:
      return { amount: n, unit: "ml" };
  }
}

export function stepFor(unit: Unit, amount: number): number {
  if (unit === "serving" || unit === "piece") return 0.5;
  return amount < 50 ? 5 : 10;
}

export function startingPortion(
  food: Food,
  pref?: { unit: Unit; amount: number },
): { unit: Unit; amount: number } {
  if (pref && (pref.unit === "g" || pref.unit === "ml" || food.servingGrams !== null))
    return { unit: pref.unit, amount: pref.amount };
  if (food.servingGrams !== null) return { unit: "serving", amount: 1 };
  return { unit: isLiquid(food) ? "ml" : "g", amount: 100 };
}
