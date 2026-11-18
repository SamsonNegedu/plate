import { searchName } from "@/lib/searchName";
import { uuidv7 } from "@/lib/uuid";
import { foodBody } from "@/sync/bodies";
import { emitLocalWrite } from "./events";
import { enqueue } from "./outbox";
import type { PlateDB } from "./schema";
import type { Food, FoodPref, Nutrients, Unit } from "./types";

/** Cache a food from the server's lookup. Another cached row with the same barcode is replaced; a user row is never overwritten. */
export async function cacheFood(db: PlateDB, food: Food): Promise<Food> {
  return db.transaction("rw", db.foods, async () => {
    const existing = await db.foods.get(food.id);
    if (existing?.source === "user" && food.source !== "user") return existing;
    if (food.barcode)
      await db.foods
        .where("barcode")
        .equals(food.barcode)
        .filter((f) => f.id !== food.id && f.source !== "user")
        .delete();
    await db.foods.put(food);
    return food;
  });
}

export async function findFoodByBarcode(db: PlateDB, barcode: string): Promise<Food | undefined> {
  const f = await db.foods.where("barcode").equals(barcode).first();
  return f && !f.deletedAt ? f : undefined;
}

export async function getFood(db: PlateDB, id: string): Promise<Food | undefined> {
  const f = await db.foods.get(id);
  return f && !f.deletedAt ? f : undefined;
}

export interface FoodInput extends Nutrients {
  id?: string;
  barcode: string | null;
  name: string;
  brand: string;
  quantity?: string;
  servingSize?: string;
  servingGrams: number | null;
  nutriscore?: string | null;
}

/**
 * Create or correct a user food. It is written locally first and queued; entries already logged keep their snapshots.
 * A correction keeps the id and the source id of the row it replaces.
 */
export async function saveCustomFood(
  db: PlateDB,
  input: FoodInput,
  now: number = Date.now(),
): Promise<Food> {
  const ts = new Date(now).toISOString();
  const food = await db.transaction("rw", [db.foods, db.outbox], async () => {
    const existing = input.id ? await db.foods.get(input.id) : undefined;
    const food: Food = {
      id: input.id ?? uuidv7(now),
      barcode: input.barcode,
      name: input.name.trim(),
      brand: input.brand.trim(),
      quantity: input.quantity ?? existing?.quantity ?? "",
      servingSize: input.servingSize ?? existing?.servingSize ?? "",
      servingGrams: input.servingGrams,
      kcal: input.kcal,
      protein: input.protein,
      carbs: input.carbs,
      fat: input.fat,
      sugar: input.sugar,
      satfat: input.satfat,
      fiber: input.fiber,
      salt: input.salt,
      nutriscore: input.nutriscore ?? existing?.nutriscore ?? null,
      source: "user",
      sourceId: existing?.sourceId ?? null,
      sourceCheckedAt: existing?.sourceCheckedAt ?? null,
      stale: false,
      imagePath: existing?.imagePath ?? null,
      ingredients: existing?.ingredients ?? "",
      allergens: existing?.allergens ?? "",
      searchName: searchName(`${input.name} ${input.brand}`),
      updatedAt: ts,
      deletedAt: null,
      serverSeq: existing?.serverSeq ?? 0,
    };
    if (food.barcode)
      await db.foods
        .where("barcode")
        .equals(food.barcode)
        .filter((f) => f.id !== food.id && f.source !== "user")
        .delete();
    await db.foods.put(food);
    await enqueue(
      db,
      {
        entity: "food",
        entityId: food.id,
        type: "upsert",
        data: foodBody(food),
        ...(food.serverSeq ? { baseSeq: food.serverSeq } : {}),
      },
      now,
    );
    return food;
  });
  emitLocalWrite();
  return food;
}

/** Delete a custom food. Entries that used it keep their snapshots. Cached foods are server-managed and cannot be deleted. */
export async function deleteCustomFood(
  db: PlateDB,
  id: string,
  now: number = Date.now(),
): Promise<void> {
  await db.transaction("rw", [db.foods, db.outbox, db.favorites], async () => {
    const f = await db.foods.get(id);
    if (f?.source !== "user") return;
    await db.foods.update(id, { deletedAt: new Date(now).toISOString(), barcode: null });
    await db.favorites.delete(id);
    await enqueue(db, { entity: "food", entityId: id, type: "delete" }, now);
  });
  emitLocalWrite();
}

export async function userFoods(db: PlateDB): Promise<Food[]> {
  return (await db.foods.where("source").equals("user").toArray())
    .filter((f) => !f.deletedAt)
    .sort((a, b) => a.name.localeCompare(b.name));
}

// ---- remembered portions and coverage misses (local only, never synced) ----

export async function getPref(db: PlateDB, foodId: string): Promise<FoodPref | undefined> {
  return db.foodPrefs.get(foodId);
}

export async function setPref(
  db: PlateDB,
  foodId: string,
  unit: Unit,
  amount: number,
  now: number = Date.now(),
): Promise<void> {
  await db.foodPrefs.put({ foodId, unit, amount, updatedAt: new Date(now).toISOString() });
}

export async function logMiss(
  db: PlateDB,
  miss: { barcode: string | null; query: string | null; note?: string },
  now: number = Date.now(),
): Promise<void> {
  await db.foodMisses.add({
    barcode: miss.barcode,
    query: miss.query,
    note: miss.note ?? "",
    createdAt: new Date(now).toISOString(),
  });
}
