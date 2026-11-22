import { describe, expect, it } from "vitest";
import { buildEntry } from "./entries";
import { usualFoodIds } from "./hooks";

const e = (foodId: string | null, meal: "breakfast" | "lunch", eatenOn: string) =>
  buildEntry({
    eatenOn,
    meal,
    foodId,
    name: "x",
    brand: "",
    barcode: null,
    amount: 1,
    unit: "g",
    grams: 1,
    kcal: 1,
    protein: null,
    carbs: null,
    fat: null,
    sugar: null,
    satfat: null,
    fiber: null,
    salt: null,
  });

describe("usualFoodIds", () => {
  it("needs two logs in the same meal and ranks by count", () => {
    const rows = [
      e("a", "breakfast", "2026-11-01"),
      e("a", "breakfast", "2026-11-02"),
      e("b", "breakfast", "2026-11-01"),
      e("c", "breakfast", "2026-11-01"),
      e("c", "breakfast", "2026-11-02"),
      e("c", "breakfast", "2026-11-03"),
      e("d", "lunch", "2026-11-01"),
      e("d", "lunch", "2026-11-02"),
      e(null, "breakfast", "2026-11-01"),
      e(null, "breakfast", "2026-11-02"),
    ];
    expect(usualFoodIds(rows, "breakfast", 5)).toEqual(["c", "a"]);
  });
});
