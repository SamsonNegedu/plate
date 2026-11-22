import { describe, expect, it } from "vitest";
import { type DraftItem, scaleItems } from "./draft";

const item = (over: Partial<DraftItem>): DraftItem => ({
  key: "k",
  foodId: "f",
  name: "Rice",
  brand: "",
  amount: 100,
  unit: "g",
  grams: 100,
  kcal: 130,
  protein: null,
  carbs: null,
  fat: null,
  sugar: null,
  satfat: null,
  fiber: null,
  salt: null,
  ...over,
});

describe("scaleItems", () => {
  it("scales amount and grams together", () => {
    const [a, b] = scaleItems([item({}), item({ unit: "serving", amount: 1, grams: 30 })], 2) ?? [];
    expect(a).toMatchObject({ amount: 200, grams: 200 });
    expect(b).toMatchObject({ amount: 2, grams: 60 });
  });
  it("halves", () => {
    expect(scaleItems([item({})], 0.5)?.[0]).toMatchObject({ amount: 50, grams: 50 });
  });
  it("refuses to pass the limit", () => {
    expect(scaleItems([item({ amount: 4000, grams: 4000 })], 2)).toBeNull();
  });
});
