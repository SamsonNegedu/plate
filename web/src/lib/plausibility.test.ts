import { describe, expect, test } from "vitest";
import type { Nutrients } from "@/db/types";
import { plausibility } from "./plausibility";

const n = (o: Partial<Nutrients> & { kcal: number }): Nutrients => ({
  protein: null,
  carbs: null,
  fat: null,
  sugar: null,
  satfat: null,
  fiber: null,
  salt: null,
  ...o,
});

// The same cases as TestPlausibilityRules in internal/food/facts_test.go: the two sides must agree.
describe("plausibility", () => {
  const good = n({ kcal: 192, protein: 21, carbs: 0, fat: 12, satfat: 1.9, sugar: 0 });
  test.each([
    ["the salmon label is consistent", good, 801, []],
    [
      "energy the macros cannot make",
      n({ kcal: 500, protein: 21, carbs: 0, fat: 12 }),
      null,
      ["energy_mismatch"],
    ],
    ["saturates above fat", n({ ...good, satfat: 15 }), null, ["saturates_over_fat"]],
    [
      "sugars above carbohydrate",
      n({ kcal: 100, protein: 0, carbs: 5, fat: 8, sugar: 9 }),
      null,
      ["sugars_over_carbohydrate"],
    ],
    ["kJ that disagrees with kcal", good, 2000, ["kj_kcal_mismatch"]],
    [
      "macros over 100 g",
      n({ kcal: 400, protein: 60, carbs: 30, fat: 20 }),
      null,
      ["out_of_range", "macros_over_100", "energy_mismatch"],
    ],
    ["missing nutrients are skipped, never read as 0", n({ kcal: 192 }), null, []],
    [
      "a lost decimal point",
      n({ kcal: 60, protein: 2, carbs: 10, fat: 15 }),
      null,
      ["energy_mismatch"],
    ],
  ] as const)("%s", (_name, nutrients, kj, want) => {
    expect(plausibility(nutrients, kj)).toEqual(want);
  });
});
