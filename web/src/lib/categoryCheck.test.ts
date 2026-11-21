import { describe, expect, test } from "vitest";
import type { CategoryInfo, Nutrients } from "@/db/types";
import { categoryNote, categoryOutliers } from "./categoryCheck";

// The real 5th percentile, median and 95th percentile of 227 German smoked salmons in Open Food Facts.
const salmons: CategoryInfo = {
  name: "smoked salmons",
  ranges: {
    kcal: [123, 180, 244.4],
    fat: [3.3, 11, 17.1],
    protein: [18, 21, 24],
    carbs: [0, 0.2, 2.4],
    salt: [1.4, 2.8, 3.6],
  },
};

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

describe("categoryOutliers", () => {
  test("the wrong salmon (the label's values times 2.08) is far above its category on energy, fat, protein and salt", () => {
    const wrong = n({ kcal: 399, fat: 25, protein: 43.75, carbs: 0, salt: 5.729 });
    expect(categoryOutliers(wrong, salmons)).toEqual([
      { key: "kcal", direction: "above" },
      { key: "fat", direction: "above" },
      { key: "protein", direction: "above" },
      { key: "salt", direction: "above" },
    ]);
  });

  test("the same salmon as the label prints it is unremarkable", () => {
    expect(
      categoryOutliers(n({ kcal: 192, fat: 12, protein: 21, carbs: 0, salt: 2.8 }), salmons),
    ).toEqual([]);
  });

  test("one odd value alone is a normal product, not a mistake", () => {
    expect(categoryOutliers(n({ kcal: 190, fat: 12, protein: 21, salt: 6 }), salmons)).toEqual([]);
  });

  test("two odd values that are not energy, fat or protein are not enough", () => {
    expect(
      categoryOutliers(n({ kcal: 190, fat: 12, protein: 21, carbs: 9, salt: 6 }), salmons),
    ).toEqual([]);
  });

  test("values far below the category count too", () => {
    const light = n({ kcal: 30, fat: 0.2, protein: 3 });
    expect(categoryOutliers(light, salmons).map((o) => o.direction)).toEqual([
      "below",
      "below",
      "below",
    ]);
  });

  test("a missing nutrient is skipped, never read as 0", () => {
    expect(categoryOutliers(n({ kcal: 399 }), salmons)).toEqual([]);
  });

  test("a value just above the 95th percentile is within the margin and the floor", () => {
    expect(categoryOutliers(n({ kcal: 260, fat: 18, protein: 25 }), salmons)).toEqual([]);
  });

  test("a category with no ranges for a nutrient compares nothing for it", () => {
    expect(
      categoryOutliers(n({ kcal: 399, fat: 25 }), { name: "x", ranges: { kcal: [100, 150, 200] } }),
    ).toEqual([]);
  });
});

describe("categoryNote", () => {
  test("names the category and the nutrients that are off", () => {
    expect(
      categoryNote(n({ kcal: 399, fat: 25, protein: 43.75, carbs: 0, salt: 5.729 }), salmons),
    ).toBe(
      "These values look unusual for smoked salmons: energy, fat, protein and salt above the usual range. Check the label.",
    );
  });

  test("says nothing about a normal product", () => {
    expect(categoryNote(n({ kcal: 192, fat: 12, protein: 21, salt: 2.8 }), salmons)).toBeNull();
  });
});
