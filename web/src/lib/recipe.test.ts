import { describe, expect, test } from "vitest";
import {
  ingredientShares,
  isRecipeEntry,
  portionLabel,
  RECIPE_BRAND,
  recipeNutrition,
} from "./recipe";

const ing = (grams: number, kcal: number, over: Partial<Record<string, number | null>> = {}) => ({
  grams,
  kcal,
  protein: null,
  carbs: null,
  fat: null,
  sugar: null,
  satfat: null,
  fiber: null,
  salt: null,
  ...over,
});

describe("recipe nutrition", () => {
  test("the total is the sum of the ingredients and a portion is the total over the portions", () => {
    // 200 g at 100 kcal/100 g is 200 kcal, 100 g at 300 kcal/100 g is 300 kcal: 500 kcal for 4 portions
    const n = recipeNutrition([ing(200, 100), ing(100, 300)], 4);
    expect(n.total.kcal).toBeCloseTo(500);
    expect(n.portion.kcal).toBeCloseTo(125);
    expect(n.portionGrams).toBeCloseTo(75);
    expect(n.per100.kcal).toBeCloseTo(500 / 3);
  });

  test("no cooked weight is needed: n portions at the portion weight add up to the whole recipe", () => {
    const n = recipeNutrition([ing(500, 200)], 5);
    expect((n.per100.kcal * n.portionGrams * 5) / 100).toBeCloseTo(n.total.kcal);
  });

  test("a nutrient no ingredient reports stays null, never zero", () => {
    const n = recipeNutrition([ing(100, 100), ing(100, 100)], 1);
    expect(n.per100.protein).toBeNull();
    expect(n.portion.protein).toBeNull();
    expect(n.partial).toEqual([]);
  });

  test("a nutrient only some ingredients report is flagged as a minimum", () => {
    const n = recipeNutrition([ing(100, 100, { protein: 20 }), ing(100, 100)], 1);
    expect(n.total.protein).toBeCloseTo(20);
    expect(n.partial).toEqual(["protein"]);
  });

  test("an empty recipe has no calories and does not divide by zero", () => {
    const n = recipeNutrition([], 4);
    expect(n.per100.kcal).toBe(0);
    expect(n.portionGrams).toBe(0);
  });

  test("shares rank ingredients by calories and add up to one", () => {
    const s = ingredientShares([ing(100, 100), ing(100, 300)]);
    expect(s[0]?.kcal).toBe(300);
    expect(s[0]?.share).toBeCloseTo(0.75);
    expect(s.reduce((t, x) => t + x.share, 0)).toBeCloseTo(1);
  });
});

describe("portion label", () => {
  test.each([
    [1, "1 portion"],
    [0.5, "½ portion"],
    [0.25, "¼ portion"],
    [1.5, "1½ portions"],
    [2, "2 portions"],
    [2.3, "2.3 portions"],
  ])("%s is %s", (n, label) => expect(portionLabel(n)).toBe(label));

  test("only entries logged from a recipe count as recipes", () => {
    expect(isRecipeEntry({ foodId: null, brand: RECIPE_BRAND, unit: "serving" })).toBe(true);
    expect(isRecipeEntry({ foodId: null, brand: "", unit: "serving" })).toBe(false); // a quick add
    expect(isRecipeEntry({ foodId: "f1", brand: RECIPE_BRAND, unit: "serving" })).toBe(false);
  });
});
