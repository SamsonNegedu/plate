import { describe, expect, test } from "vitest";
import { addDays, dateRange, defaultMeal, isValidDate, localDate, logicalDate } from "./dates";
import { formatOptional, parseDecimal } from "./numbers";
import { amountLabel, dayTotals, gramsFor, meterFill, portionOf, unitsFor } from "./nutrition";

const at = (h: number, m = 0) => new Date(2026, 10, 13, h, m);

describe("default meal", () => {
  test.each([
    [[0, 0], "breakfast"],
    [[10, 29], "breakfast"],
    [[10, 30], "lunch"],
    [[14, 59], "lunch"],
    [[15, 0], "dinner"],
    [[20, 59], "dinner"],
    [[21, 0], "snack"],
    [[23, 59], "snack"],
  ] as const)("%j is %s", ([h, m], meal) => expect(defaultMeal(at(h, m))).toBe(meal));
});

describe("dates", () => {
  test("a late-night entry with day start 4 belongs to the previous date", () => {
    expect(logicalDate(at(0, 30), 4)).toBe("2026-11-12");
    expect(logicalDate(at(3, 59), 4)).toBe("2026-11-12");
    expect(logicalDate(at(4, 0), 4)).toBe("2026-11-13");
    expect(logicalDate(at(0, 30), 0)).toBe("2026-11-13");
  });
  test("the local date is not the UTC date", () => {
    expect(localDate(new Date(2026, 10, 13, 23, 59))).toBe("2026-11-13");
  });
  test("ranges survive DST changes in both directions", () => {
    for (const [from, to, n] of [
      ["2026-03-27", "2026-03-30", 4],
      ["2026-10-24", "2026-10-27", 4],
      ["2026-12-30", "2027-01-02", 4],
    ] as const) {
      const r = dateRange(from, to);
      expect(r).toHaveLength(n);
      expect(new Set(r).size).toBe(n);
    }
    expect(addDays("2026-03-28", 1)).toBe("2026-03-29");
    expect(addDays("2026-03-29", 1)).toBe("2026-03-30");
    expect(addDays("2026-02-28", 1)).toBe("2026-03-01");
  });
  test("validation rejects impossible dates", () => {
    expect(isValidDate("2026-02-30")).toBe(false);
    expect(isValidDate("2026-2-3")).toBe(false);
    expect(isValidDate("2028-02-29")).toBe(true);
  });
});

describe("numbers", () => {
  test("decimal commas are accepted", () => {
    expect(parseDecimal("1,5")).toBe(1.5);
    expect(parseDecimal(" 250 ")).toBe(250);
    expect(parseDecimal("0.75")).toBe(0.75);
    expect(parseDecimal(".5")).toBe(0.5);
    expect(parseDecimal("")).toBeNull();
    expect(parseDecimal("abc")).toBeNull();
    expect(parseDecimal("1,2,3")).toBeNull();
    expect(parseDecimal("1e5")).toBeNull();
  });
  test("a missing value shows a dash, never zero", () => {
    expect(formatOptional(null)).toBe("—");
    expect(formatOptional(0)).toBe("0");
    expect(formatOptional(3.46, " g")).toBe("3.5 g");
  });
});

describe("portion math", () => {
  const nutella = {
    kcal: 539,
    protein: 6.3,
    carbs: null,
    fat: 30.9,
    sugar: null,
    satfat: null,
    fiber: null,
    salt: null,
  };
  test("scales per-100 g values and keeps gaps as gaps", () => {
    const p = portionOf(nutella, 15);
    expect(p.kcal).toBeCloseTo(80.85);
    expect(p.protein).toBeCloseTo(0.945);
    expect(p.carbs).toBeNull();
  });
  test("units: grams, ml, servings need a weight", () => {
    expect(gramsFor(250, "ml", null)).toBe(250);
    expect(gramsFor(2, "serving", 30)).toBe(60);
    expect(gramsFor(3, "piece", 25)).toBe(75);
    expect(gramsFor(1, "serving", null)).toBeNull();
    expect(gramsFor(0, "g", null)).toBeNull();
    expect(gramsFor(-5, "g", null)).toBeNull();
    expect(gramsFor(Number.NaN, "g", null)).toBeNull();
  });
  test("a food offers portion only with a serving weight", () => {
    expect(unitsFor({ servingGrams: null }, false)).toEqual(["g"]);
    expect(unitsFor({ servingGrams: 30 }, true)).toEqual(["g", "ml", "serving"]);
  });
  test("labels", () => {
    expect(amountLabel(1, "serving")).toBe("1 portion");
    expect(amountLabel(2, "serving")).toBe("2 portions");
    expect(amountLabel(1.5, "g")).toBe("1.5 g");
  });
});

describe("day totals", () => {
  const e = (kcal: number, grams: number, p: number | null, deletedAt: string | null = null) => ({
    kcal,
    grams,
    protein: p,
    carbs: null,
    fat: null,
    fiber: null,
    deletedAt,
  });
  test("sums unrounded values, skips tombstones, and reports missing macros", () => {
    const t = dayTotals([
      e(200, 100, 10),
      e(100, 50, null),
      e(999, 100, 99, "2026-11-13T00:00:00Z"),
    ]);
    expect(t.kcal).toBe(250);
    expect(t.count).toBe(2);
    expect(t.protein).toBe(10);
    expect(t.carbs).toBeNull();
    expect(t.fiber).toBeNull();
    expect(t.missing).toEqual(["protein", "carbs", "fat"]);
  });
  test("sums fibre and keeps a missing value out of the macro warning", () => {
    const t = dayTotals([
      { kcal: 100, grams: 100, protein: 1, carbs: 1, fat: 1, fiber: 3, deletedAt: null },
      { kcal: 100, grams: 50, protein: 1, carbs: 1, fat: 1, fiber: null, deletedAt: null },
    ]);
    expect(t.fiber).toBe(3);
    expect(t.missing).toEqual([]);
  });
  test("a zero-kcal entry still counts", () => {
    const t = dayTotals([
      { kcal: 0, grams: 250, protein: 0, carbs: 0, fat: 0, fiber: 0, deletedAt: null },
    ]);
    expect(t).toMatchObject({ kcal: 0, count: 1, missing: [] });
  });
  test("rounding once beats rounding each entry", () => {
    const t = dayTotals([e(0.4, 100, null), e(0.4, 100, null), e(0.4, 100, null)]);
    expect(Math.round(t.kcal)).toBe(1);
  });
});

describe("meter", () => {
  test("caps at full and says over", () => {
    expect(meterFill(1500, 2000)).toEqual({ fill: 0.75, over: false, left: 500 });
    expect(meterFill(2400, 2000)).toEqual({ fill: 1, over: true, left: 400 });
    expect(meterFill(0, 0)).toEqual({ fill: 0, over: false, left: 0 });
  });
});
