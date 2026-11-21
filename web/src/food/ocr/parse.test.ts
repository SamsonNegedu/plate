import { describe, expect, test } from "vitest";
import salmonPhoto from "./fixtures/salmon-photo.json";
import salmon from "./fixtures/salmon.json";
import { type Line, parseLabel } from "./parse";

/** A line of text at a position, for building small labels by hand. */
const at = (text: string, x: number, y: number, w = 120): Line => ({
  text,
  score: 0.95,
  box: [
    [x, y],
    [x + w, y],
    [x + w, y + 24],
    [x, y + 24],
  ],
});

describe("parseLabel", () => {
  test("reads the REWE smoked salmon label (real OCR output) exactly", () => {
    const r = parseLabel(salmon as Line[]);
    expect(r.perServing).toBe(false);
    expect(r.values).toMatchObject({
      kcal: 192,
      fat: 12,
      satfat: 1.9,
      carbs: 0,
      sugar: 0,
      fiber: 0,
      protein: 21,
      salt: 2.8,
    });
  });

  test("the region covers the table rows and leaves out the ingredient text above it", () => {
    const r = parseLabel([
      at("Zutaten: Lachs, Meersalz, Buchenholzrauch", 10, 0, 400),
      ...(salmon as Line[]).map((l) => ({
        ...l,
        box: l.box.map(([x, y]) => [x, y + 200] as [number, number]),
      })),
    ]);
    expect(r.region).not.toBeNull();
    expect(r.region?.y0).toBeGreaterThan(150);
    expect(r.region?.y1).toBeGreaterThan(r.region?.y0 ?? 0);
  });

  test("a whole kitchen photo of the salmon pack (real browser output) reads the table, not the stray glyphs beside it", () => {
    const r = parseLabel(salmonPhoto as Line[]);
    expect(r.values).toEqual({
      kcal: 192,
      fat: 12,
      satfat: 1.9,
      carbs: 0,
      sugar: 0,
      fiber: 0,
      protein: 21,
      salt: 2.8,
    });
    expect(r.region?.y0).toBeGreaterThan(800); // the table, not the whole frame
  });

  test("a per-serving panel is never read as per 100 g", () => {
    const r = parseLabel([
      at("Nutrition Facts", 10, 10),
      at("Serving size 2 pieces (25g)", 10, 40),
      at("Calories 150", 10, 70),
      at("Total Fat 12g", 10, 100),
      at("Protein 3g", 10, 130),
    ]);
    expect(r).toEqual({ values: {}, check: [], perServing: true, region: null });
  });

  test("with two columns it takes the per 100 g one, not the portion", () => {
    const r = parseLabel([
      at("Nährwerte", 10, 10),
      at("je 100 g", 300, 10, 80),
      at("je Portion", 420, 10, 90),
      at("Energie 2252 kJ / 539 kcal", 10, 50, 260),
      at("336 kJ / 80 kcal", 420, 50, 120),
      at("Fett", 10, 90),
      at("30,9 g", 300, 90, 70),
      at("4,6 g", 420, 90, 70),
      at("Kohlenhydrate", 10, 130),
      at("57,5 g", 300, 130, 70),
      at("8,6 g", 420, 130, 70),
      at("Eiweiß", 10, 170),
      at("6,3 g", 300, 170, 70),
      at("0,9 g", 420, 170, 70),
    ]);
    expect(r.values).toMatchObject({ fat: 30.9, carbs: 57.5, protein: 6.3 });
    expect(r.values.fat).not.toBe(4.6);
  });

  test("a g misread as 9 is settled by the label's own arithmetic", () => {
    // 21 g protein, 12 g fat, 0 g carbs: 192 kcal. "219" and "129" are the unit read as a digit.
    const r = parseLabel([
      at("100g", 300, 10, 60),
      at("Energie 192 kcal", 10, 50, 200),
      at("Fett", 10, 90),
      at("129", 300, 90, 40),
      at("Kohlenhydrate", 10, 130),
      at("0g", 300, 130, 40),
      at("Eiweiß", 10, 170),
      at("219", 300, 170, 40),
    ]);
    expect(r.values).toMatchObject({ kcal: 192, fat: 12, protein: 21, carbs: 0 });
  });

  test("a lost decimal point is restored when the energy says so", () => {
    // 1,5 g fat read as "15": 4x2 + 4x10 + 9x1.5 = 61 kcal, not 143.
    const r = parseLabel([
      at("100g", 300, 10, 60),
      at("Energie 61 kcal", 10, 50, 200),
      at("Fett", 10, 90),
      at("15 g", 300, 90, 50),
      at("Kohlenhydrate", 10, 130),
      at("10 g", 300, 130, 50),
      at("Eiweiß", 10, 170),
      at("2 g", 300, 170, 50),
    ]);
    expect(r.values.fat).toBe(1.5);
  });

  test("what cannot be settled is flagged, and missing stays missing", () => {
    const r = parseLabel([
      at("100g", 300, 10, 60),
      at("Energie 192 kcal", 10, 50, 200),
      at("Salz", 10, 90),
      at("28 g", 300, 90, 50),
    ]);
    expect(r.values.salt).toBeDefined();
    expect(r.check).toContain("salt"); // 28 g or 2,8 g: nothing on the label decides it
    expect(r.values).not.toHaveProperty("protein"); // never filled with 0
    expect(r.values).not.toHaveProperty("fat");
  });

  test("kcal is derived from kJ when only kJ was read, and flagged", () => {
    const r = parseLabel([at("100g", 300, 10, 60), at("Energie 801 kJ", 10, 50, 200)]);
    expect(r.values.kcal).toBe(191);
    expect(r.check).toContain("kcal");
  });

  test("an empty or unreadable photo gives nothing, not zeros", () => {
    expect(parseLabel([])).toEqual({ values: {}, check: [], perServing: false, region: null });
    expect(parseLabel([at("Zutaten: Lachs, Salz", 10, 10)]).values).toEqual({});
  });
});
