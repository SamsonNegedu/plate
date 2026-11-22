import { describe, expect, test } from "vitest";
import type { Entry } from "@/db/types";
import { addDays } from "@/lib/dates";
import {
  buildDays,
  dayDetail,
  goalFor,
  labelEvery,
  monotonePath,
  niceMax,
  movingAverage,
  summarize,
  topFoods,
  valueOf,
  weekdayInsight,
} from "./stats";

let n = 0;
function entry(over: Partial<Entry>): Entry {
  n++;
  return {
    id: `e${n}`,
    eatenOn: "2026-11-02",
    meal: "lunch",
    foodId: null,
    name: "Food",
    brand: "",
    barcode: null,
    amount: 100,
    unit: "g",
    grams: 100,
    note: "",
    kcal: 100,
    protein: 10,
    carbs: 10,
    fat: 5,
    sugar: null,
    satfat: null,
    fiber: null,
    salt: null,
    createdAt: "",
    updatedAt: "",
    clientUpdatedAt: "",
    deletedAt: null,
    serverSeq: 0,
    ...over,
  };
}

// 2026-11-02 is a Monday.
const START = "2026-11-02";

describe("gaps are not zeros", () => {
  test("an unlogged day has no value", () => {
    const [d] = buildDays([], START, START);
    expect(d && valueOf(d, "kcal")).toBeNull();
  });

  test("a day where no entry reports protein has no protein value", () => {
    const [d] = buildDays([entry({ protein: null })], START, START);
    expect(d && valueOf(d, "protein")).toBeNull();
    expect(d && valueOf(d, "kcal")).toBe(100);
  });

  test("a partly reported protein day is flagged", () => {
    const [d] = buildDays([entry({}), entry({ protein: null })], START, START);
    expect(d?.partial).toContain("protein");
    expect(d?.protein).toBe(10);
  });

  test("the average skips unlogged days", () => {
    const days = buildDays([entry({ kcal: 2000 })], START, addDays(START, 3));
    expect(summarize(days, 1800).average).toBe(2000);
  });

  test("protein counts days that reach the goal, kcal counts days over it", () => {
    const days = buildDays(
      [entry({ kcal: 2000, protein: 150 }), entry({ eatenOn: addDays(START, 1), protein: 40 })],
      START,
      addDays(START, 1),
    );
    expect(summarize(days, 1800, "kcal").daysFlagged).toBe(1);
    expect(summarize(days, 100, "protein").daysFlagged).toBe(1);
  });
});

describe("moving average", () => {
  test("averages only logged days in the window and breaks where nothing was logged", () => {
    const entries = [
      entry({ eatenOn: START, kcal: 1000 }),
      entry({ eatenOn: addDays(START, 2), kcal: 2000 }),
    ];
    const days = buildDays(entries, START, addDays(START, 10));
    const avg = movingAverage(days, "kcal", 3);
    expect(avg[0]).toBe(1000);
    expect(avg[1]).toBe(1000);
    expect(avg[2]).toBe(1500);
    expect(avg[3]).toBe(2000);
    expect(avg[5]).toBeNull();
  });
});

describe("weekday insight", () => {
  const month = (heavy: (date: string, weekday: number) => number) => {
    const dates = Array.from({ length: 28 }, (_, i) => addDays(START, i));
    return buildDays(
      dates.map((date, i) => entry({ eatenOn: date, kcal: heavy(date, i % 7) })),
      START,
      addDays(START, 27),
    );
  };

  test("names the weekdays that run clearly above average", () => {
    // i % 7 === 4 and 5 are Friday and Saturday
    const days = month((_, wd) => (wd === 4 || wd === 5 ? 2600 : 1800));
    const insight = weekdayInsight(days);
    expect(insight?.weekdays).toEqual(["Fridays", "Saturdays"]);
    expect(insight?.above).toBeGreaterThan(400);
  });

  test("says nothing when every day looks alike", () => {
    expect(weekdayInsight(month(() => 2000))).toBeNull();
  });

  test("says nothing without enough logged days", () => {
    const days = buildDays(
      [entry({ eatenOn: START, kcal: 5000 }), entry({ eatenOn: addDays(START, 1) })],
      START,
      addDays(START, 13),
    );
    expect(weekdayInsight(days)).toBeNull();
  });
});

describe("top foods", () => {
  test("groups repeats and ranks by calories with shares of the total", () => {
    const { foods, totalKcal } = topFoods([
      entry({ foodId: "a", name: "Muesli", kcal: 400 }),
      entry({ foodId: "a", name: "Muesli", kcal: 400 }),
      entry({ foodId: "b", name: "Apple", kcal: 100 }),
      entry({ foodId: "c", name: "Gone", kcal: 9000, deletedAt: "x" }),
    ]);
    expect(totalKcal).toBe(900);
    expect(foods.map((f) => [f.name, f.times])).toEqual([
      ["Muesli", 2],
      ["Apple", 1],
    ]);
    expect(foods[0]?.share).toBeCloseTo(800 / 900);
  });

  test("an entry without a food id groups by name and brand", () => {
    const { foods } = topFoods([
      entry({ name: "Toast", brand: "A" }),
      entry({ name: "toast", brand: "a" }),
    ]);
    expect(foods).toHaveLength(1);
    expect(foods[0]?.times).toBe(2);
  });
});

describe("day detail", () => {
  test("splits by meal in order and lists the three biggest entries", () => {
    const d = dayDetail([
      entry({ meal: "dinner", name: "Pasta", kcal: 600 }),
      entry({ meal: "breakfast", name: "Egg", kcal: 100 }),
      entry({ meal: "dinner", name: "Wine", kcal: 200 }),
      entry({ meal: "snack", name: "Nuts", kcal: 150 }),
    ]);
    expect(d.meals.map((m) => m.meal)).toEqual(["breakfast", "dinner", "snack"]);
    expect(d.biggest.map((b) => b.name)).toEqual(["Pasta", "Wine", "Nuts"]);
    expect(d.biggest[0]?.share).toBeCloseTo(600 / 1050);
  });
});

describe("every nutrient", () => {
  test("fibre sums eaten grams and stays a gap when nothing reports it", () => {
    const [withFibre] = buildDays([entry({ fiber: 4, grams: 200 })], START, START);
    const [without] = buildDays([entry({})], START, START);
    expect(withFibre?.fiber).toBe(8);
    expect(without && valueOf(without, "fiber")).toBeNull();
  });

  test("a nutrient without a goal has no goal and no flagged-days count", () => {
    const goals = { goalKcal: 2000, proteinG: 100, carbsG: 0, fatG: 70, fiberG: 30 };
    expect(goalFor("fiber", goals)).toBe(30);
    expect(goalFor("fiber", { ...goals, fiberG: 0 })).toBeNull();
    expect(goalFor("sugar", goals)).toBeNull();
    expect(goalFor("carbs", goals)).toBeNull();
    expect(goalFor("fat", goals)).toBe(70);
    const days = buildDays([entry({ fiber: 3 })], START, START);
    const stats = summarize(days, null, "fiber");
    expect(stats.daysFlagged).toBeNull();
    expect(stats.peak).toBe(3);
  });

  test("gram axes scale to small values", () => {
    expect(niceMax(2.1, "salt")).toBe(2.5);
    expect(niceMax(23, "fiber")).toBe(25);
    expect(niceMax(0, "sugar")).toBe(10);
  });
});

describe("monotone path", () => {
  test("needs two points", () => {
    expect(monotonePath([])).toBe("");
    expect(monotonePath([[0, 0]])).toBe("");
  });

  test("passes through every point and never overshoots a flat stretch", () => {
    const path = monotonePath([
      [0, 100],
      [10, 40],
      [20, 40],
      [30, 90],
    ]);
    expect(path.startsWith("M0.0 100.0")).toBe(true);
    expect(path.endsWith("30.0 90.0")).toBe(true);
    // the flat middle segment keeps both control points at y 40, so the curve cannot dip below it
    expect(path).toContain("C13.3 40.0 16.7 40.0 20.0 40.0");
  });
});

describe("axis labels", () => {
  test("get sparser as the range grows", () => {
    expect([7, 14, 30, 90].map(labelEvery)).toEqual([1, 2, 4, 14]);
  });
});
