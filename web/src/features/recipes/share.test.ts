import { describe, expect, test } from "vitest";
import {
  MAX_SHARED_BYTES,
  parseShared,
  shareFileName,
  type SharedRecipe,
  toShareJson,
  toShareText,
} from "./share";

const recipe: SharedRecipe = {
  name: "Chicken pasta",
  servings: 2,
  items: [
    {
      foodId: "a-food-id-from-this-account",
      name: "Protein pasta",
      brand: "REWE",
      amount: 160,
      unit: "g",
      grams: 160,
      kcal: 340,
      protein: 25,
      carbs: 45,
      fat: 2.5,
      sugar: null,
      satfat: null,
      fiber: 9,
      salt: null,
    },
    {
      foodId: null,
      name: "Eggs",
      brand: "",
      amount: 4,
      unit: "piece",
      grams: 240,
      kcal: 143,
      protein: 12.6,
      carbs: null,
      fat: 9.5,
      sugar: null,
      satfat: null,
      fiber: null,
      salt: null,
    },
  ],
};

describe("sharing a recipe", () => {
  test("a recipe survives the trip, and nothing of the sender's account goes with it", () => {
    const json = toShareJson(recipe);
    expect(json).not.toContain("a-food-id-from-this-account");
    const back = parseShared(json);
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    expect(back.recipe.name).toBe("Chicken pasta");
    expect(back.recipe.servings).toBe(2);
    expect(back.recipe.items).toHaveLength(2);
    expect(back.recipe.items.every((i) => i.foodId === null)).toBe(true);
    expect(back.recipe.items[0]).toMatchObject({
      name: "Protein pasta",
      grams: 160,
      kcal: 340,
      protein: 25,
    });
  });

  test("a missing nutrient stays missing and is never turned into zero", () => {
    const back = parseShared(toShareJson(recipe));
    expect(back.ok && back.recipe.items[1]?.carbs).toBeNull();
    expect(back.ok && back.recipe.items[0]?.sugar).toBeNull();
  });

  test("the readable text lists each ingredient and a portion's nutrition", () => {
    const text = toShareText(recipe);
    expect(text).toContain("Chicken pasta, makes 2 portions");
    expect(text).toContain("- 160 g Protein pasta, REWE");
    expect(text).toContain("- 4 pieces (240 g) Eggs");
    expect(text).toMatch(/Per portion: \d+ kcal · protein .* g · carbs .* g · fat .* g/);
  });

  test.each([
    ["text that is not JSON", "my grandmother's soup"],
    ["JSON of another kind", JSON.stringify({ hello: "world" })],
    [
      "a recipe with no ingredients",
      JSON.stringify({ format: "plate-recipe", version: 1, name: "x", servings: 1, items: [] }),
    ],
    [
      "a newer format than this build reads",
      JSON.stringify({
        format: "plate-recipe",
        version: 99,
        name: "x",
        servings: 1,
        items: [{ name: "a", amount: 1, unit: "g", grams: 1, kcal: 1 }],
      }),
    ],
  ])("%s is refused with a reason", (_name, text) => {
    const r = parseShared(text);
    const reason = r.ok ? "" : r.error;
    expect(r.ok).toBe(false);
    expect(reason.length).toBeGreaterThan(10);
  });

  test("implausible numbers are refused before they can reach the server", () => {
    const bad = (patch: Record<string, unknown>) =>
      parseShared(
        JSON.stringify({
          format: "plate-recipe",
          version: 1,
          name: "x",
          servings: 1,
          items: [{ name: "a", amount: 100, unit: "g", grams: 100, kcal: 100, ...patch }],
        }),
      );
    expect(bad({}).ok).toBe(true);
    expect(bad({ kcal: 5000 }).ok).toBe(false);
    expect(bad({ protein: 400 }).ok).toBe(false);
    expect(bad({ grams: 0 }).ok).toBe(false);
    expect(bad({ unit: "cup" }).ok).toBe(false);
    expect(bad({ name: "   " }).ok).toBe(false);
  });

  test("an oversized paste is refused without parsing it", () => {
    expect(parseShared("x".repeat(MAX_SHARED_BYTES + 1)).ok).toBe(false);
  });

  test("file names are readable and safe", () => {
    expect(shareFileName("Chicken Pasta, REWE & Lidl!")).toBe(
      "chicken-pasta-rewe-lidl.plate-recipe.json",
    );
    expect(shareFileName("???")).toBe("recipe.plate-recipe.json");
    expect(shareFileName("Käsespätzle")).toBe("kasespatzle.plate-recipe.json");
  });
});
