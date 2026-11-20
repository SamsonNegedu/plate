import { afterEach, describe, expect, test } from "vitest";
import { buildEntry, copyDay, entriesForDay, type NewEntry, saveEntry } from "./entries";
import { setFavorite } from "./favorites";
import {
  cacheFood,
  deleteCustomFood,
  findFoodByBarcode,
  getPref,
  saveCustomFood,
  setPref,
} from "./foods";
import { META, setMeta } from "./meta";
import { loadSampleData, removeSampleData } from "./sampleData";
import { logRecipe, saveMeal } from "./savedMeals";
import { PlateDB } from "./schema";
import { DEFAULT_SETTINGS, getSettings, saveSettings } from "./settings";
import type { Food } from "./types";

let n = 0;
const open: PlateDB[] = [];
const fresh = () => {
  const db = new PlateDB(`db-test-${++n}`);
  open.push(db);
  return db;
};
afterEach(async () => {
  await Promise.all(
    open.splice(0).map(async (d) => {
      d.close();
      await d.delete();
    }),
  );
});

const base: NewEntry = {
  eatenOn: "2026-11-13",
  meal: "lunch",
  foodId: null,
  name: "Oats",
  brand: "",
  barcode: null,
  amount: 40,
  unit: "g",
  grams: 40,
  kcal: 370,
  protein: 13,
  carbs: null,
  fat: null,
  sugar: null,
  satfat: null,
  fiber: null,
  salt: null,
};

const food = (over: Partial<Food> = {}): Food => ({
  id: "0190a1b2-0000-7000-8000-000000000001",
  barcode: "4000000000011",
  name: "Joghurt",
  brand: "Ehrmann",
  quantity: "500 g",
  servingSize: "",
  servingGrams: null,
  kcal: 61,
  protein: 3.5,
  carbs: null,
  fat: null,
  sugar: null,
  satfat: null,
  fiber: null,
  salt: null,
  nutriscore: null,
  source: "off",
  sourceId: null,
  sourceCheckedAt: null,
  stale: false,
  imagePath: null,
  ingredients: "",
  allergens: "",
  searchName: "joghurt ehrmann",
  updatedAt: "",
  deletedAt: null,
  serverSeq: 0,
  ...over,
});

describe("entries", () => {
  test("every entry carries a UUIDv7 made on the device and a full nutrition snapshot", async () => {
    const e = buildEntry(base, 1_800_000_000_000);
    expect(e.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(e).toMatchObject({ kcal: 370, protein: 13, carbs: null, serverSeq: 0, deletedAt: null });
  });

  test("saving writes the row and the outbox op together", async () => {
    const db = fresh();
    const e = buildEntry(base);
    await saveEntry(db, e);
    expect(await db.entries.count()).toBe(1);
    const ops = await db.outbox.toArray();
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({
      entity: "entry",
      entityId: e.id,
      type: "upsert",
      status: "pending",
    });
    expect(ops[0]?.data).toMatchObject({
      eaten_on: "2026-11-13",
      kcal: 370,
      protein: 13,
      carbs: null,
    });
  });

  test("a day lists only live entries in creation order", async () => {
    const db = fresh();
    await saveEntry(db, buildEntry({ ...base, name: "B" }, 2_000));
    await saveEntry(db, buildEntry({ ...base, name: "A" }, 1_000));
    await saveEntry(db, buildEntry({ ...base, name: "Other day", eatenOn: "2026-11-14" }));
    await saveEntry(db, {
      ...buildEntry({ ...base, name: "Gone" }),
      deletedAt: "2026-11-13T00:00:00Z",
    });
    expect((await entriesForDay(db, "2026-11-13")).map((e) => e.name)).toEqual(["A", "B"]);
  });

  test("copy yesterday clones live entries into today with new ids, meals and portions kept", async () => {
    const db = fresh();
    const a = buildEntry(
      { ...base, name: "Oats", meal: "breakfast", eatenOn: "2026-11-12" },
      1_000,
    );
    const b = buildEntry(
      { ...base, name: "Skyr", meal: "snack", eatenOn: "2026-11-12", amount: 150, grams: 150 },
      2_000,
    );
    await saveEntry(db, a);
    await saveEntry(db, b);
    await saveEntry(db, {
      ...buildEntry({ ...base, name: "Deleted", eatenOn: "2026-11-12" }),
      deletedAt: "2026-11-12T00:00:00Z",
    });
    const ids = await copyDay(db, "2026-11-12", "2026-11-13");
    expect(ids).toHaveLength(2);
    const today = await entriesForDay(db, "2026-11-13");
    expect(today.map((e) => [e.name, e.meal, e.amount])).toEqual([
      ["Oats", "breakfast", 40],
      ["Skyr", "snack", 150],
    ]);
    expect(
      today.every(
        (e) => e.id !== a.id && e.id !== b.id && e.serverSeq === 0 && e.eatenOn === "2026-11-13",
      ),
    ).toBe(true);
    expect(await db.outbox.where("status").equals("pending").count()).toBe(5); // three saves, two copies
  });
});

describe("foods", () => {
  test("a cached food is found by barcode, and a user correction is never overwritten by a later cache write", async () => {
    const db = fresh();
    await cacheFood(db, food());
    expect((await findFoodByBarcode(db, "4000000000011"))?.name).toBe("Joghurt");
    await saveCustomFood(db, {
      id: food().id,
      barcode: "4000000000011",
      name: "Mein Joghurt",
      brand: "",
      servingGrams: null,
      kcal: 70,
      protein: null,
      carbs: null,
      fat: null,
      sugar: null,
      satfat: null,
      fiber: null,
      salt: null,
    });
    await cacheFood(db, food({ name: "Joghurt again", kcal: 99 }));
    const got = await findFoodByBarcode(db, "4000000000011");
    expect(got).toMatchObject({ name: "Mein Joghurt", kcal: 70, source: "user" });
  });

  test("a correction keeps the id and queues a food op; existing entries keep their snapshot", async () => {
    const db = fresh();
    await cacheFood(db, food());
    const e = buildEntry({ ...base, foodId: food().id, kcal: 61 });
    await saveEntry(db, e);
    await saveCustomFood(db, {
      id: food().id,
      barcode: "4000000000011",
      name: "Joghurt",
      brand: "Ehrmann",
      servingGrams: null,
      kcal: 80,
      protein: null,
      carbs: null,
      fat: null,
      sugar: null,
      satfat: null,
      fiber: null,
      salt: null,
    });
    expect((await db.entries.get(e.id))?.kcal).toBe(61);
    const foodOps = await db.outbox.where("entity").equals("food").toArray();
    expect(foodOps).toHaveLength(1);
    expect(foodOps[0]?.entityId).toBe(food().id);
  });

  test("missing nutrients stay null on a custom food", async () => {
    const db = fresh();
    const f = await saveCustomFood(db, {
      barcode: null,
      name: "Wasser",
      brand: "",
      servingGrams: null,
      kcal: 0,
      protein: null,
      carbs: null,
      fat: null,
      sugar: null,
      satfat: null,
      fiber: null,
      salt: null,
    });
    expect(f.kcal).toBe(0);
    expect(f.protein).toBeNull();
    expect((await db.outbox.toArray())[0]?.data).toMatchObject({ kcal: 0, protein: null });
  });

  test("deleting a custom food leaves historical entries alone and refuses cached foods", async () => {
    const db = fresh();
    const mine = await saveCustomFood(db, {
      barcode: null,
      name: "Mine",
      brand: "",
      servingGrams: null,
      kcal: 100,
      protein: null,
      carbs: null,
      fat: null,
      sugar: null,
      satfat: null,
      fiber: null,
      salt: null,
    });
    await saveEntry(db, buildEntry({ ...base, foodId: mine.id }));
    await cacheFood(db, food());
    await deleteCustomFood(db, mine.id);
    await deleteCustomFood(db, food().id);
    expect((await db.foods.get(mine.id))?.deletedAt).not.toBeNull();
    expect((await db.foods.get(food().id))?.deletedAt).toBeNull();
    expect(await db.entries.count()).toBe(1);
  });

  test("remembered portions are local only and never reach the outbox", async () => {
    const db = fresh();
    await setPref(db, "f1", "serving", 2);
    expect(await getPref(db, "f1")).toMatchObject({ unit: "serving", amount: 2 });
    expect(await db.outbox.count()).toBe(0);
  });
});

describe("settings, favorites and saved meals", () => {
  test("settings default until saved, then queue an upsert keyed by the user id", async () => {
    const db = fresh();
    await setMeta(db, META.userId, "user-1");
    expect((await getSettings(db)).goalKcal).toBe(DEFAULT_SETTINGS.goalKcal);
    await saveSettings(db, {
      goalKcal: 2300,
      proteinG: 150,
      carbsG: 0,
      fatG: 0,
      dayStartHour: 4,
      theme: "dark",
    });
    expect(await getSettings(db)).toMatchObject({
      goalKcal: 2300,
      theme: "dark",
      userId: "user-1",
    });
    expect((await db.outbox.toArray())[0]).toMatchObject({
      entity: "settings",
      entityId: "user-1",
      type: "upsert",
    });
  });

  test("a favorite toggles with one op per change and nothing for a repeat", async () => {
    const db = fresh();
    await setFavorite(db, "f1", true);
    await setFavorite(db, "f1", true);
    await setFavorite(db, "f1", false);
    await setFavorite(db, "f1", false);
    const ops = await db.outbox.toArray();
    expect(ops.map((o) => o.type)).toEqual(["upsert", "delete"]);
    expect(await db.favorites.count()).toBe(0);
  });

  test("a saved meal logs every item as its own entry with new ids", async () => {
    const db = fresh();
    const item = (name: string) => ({
      foodId: null,
      name,
      brand: "",
      amount: 40,
      unit: "g" as const,
      grams: 40,
      kcal: 370,
      protein: null,
      carbs: null,
      fat: null,
      sugar: null,
      satfat: null,
      fiber: null,
      salt: null,
    });
    const meal = await saveMeal(db, "Breakfast", 2, [item("Oats"), item("Milk")]);
    const id = await logRecipe(db, meal.id, "2026-11-13", "breakfast", 1.5);
    expect(id).not.toBeNull();
    const [logged] = await entriesForDay(db, "2026-11-13");
    expect(logged?.name).toBe("Breakfast");
    expect(logged?.unit).toBe("serving");
    // two 40 g items at 370 kcal/100 g make 296 kcal; two portions of 148 kcal, and 1.5 of them is 222 kcal
    expect(((logged?.kcal ?? 0) * (logged?.grams ?? 0)) / 100).toBeCloseTo(222);
    const mealOps = await db.outbox.where("entity").equals("saved_meal").toArray();
    expect(mealOps).toHaveLength(1);
    expect((mealOps[0]?.data as { items: unknown[] } | undefined)?.items).toHaveLength(2);
  });
});

describe("sample data", () => {
  test("loads recipes and a month of history once, and removes only what it wrote", async () => {
    const db = fresh();
    const real = buildEntry({
      ...base,
      eatenOn: "2026-11-19",
      name: "My own lunch",
      kcal: 100,
      protein: null,
      carbs: null,
      fat: null,
      sugar: null,
      satfat: null,
      fiber: null,
      salt: null,
    });
    await saveEntry(db, real);

    const first = await loadSampleData(db, "2026-11-20");
    expect(first.recipes).toBe(6);
    expect(first.foods).toBeGreaterThan(20);
    expect(first.entries).toBeGreaterThan(40);
    expect(first.health).toBeGreaterThan(20);
    expect(await loadSampleData(db, "2026-11-20")).toEqual({
      foods: first.foods,
      recipes: 6,
      entries: 0,
      health: 0,
    });
    expect((await getSettings(db)).medName).toBe("Wegovy");
    expect((await db.savedMeals.toArray()).filter((m) => !m.deletedAt)).toHaveLength(6);

    const removed = await removeSampleData(db);
    expect(removed).toEqual({
      foods: first.foods,
      recipes: 6,
      entries: first.entries,
      health: first.health,
    });
    expect((await getSettings(db)).medName).toBeNull();
    expect(await db.healthRecords.filter((h) => !h.deletedAt).toArray()).toHaveLength(0);
    expect(await db.foods.filter((f) => !f.deletedAt).toArray()).toHaveLength(0);
    const live = await db.entries.filter((e) => !e.deletedAt).toArray();
    expect(live.map((e) => e.name)).toEqual(["My own lunch"]);
  });
});
