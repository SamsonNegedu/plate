import { uuidv7 } from "@/lib/uuid";
import { entryBody, mealBody } from "@/sync/bodies";
import { buildEntry } from "./entries";
import { emitLocalWrite } from "./events";
import { enqueue } from "./outbox";
import type { PlateDB } from "./schema";
import type { Entry, Meal, SavedMeal, SavedMealItem } from "./types";

export type ItemInput = Omit<SavedMealItem, "id" | "savedMealId" | "position">;

export async function saveMeal(
  db: PlateDB,
  name: string,
  items: ItemInput[],
  id?: string,
  now: number = Date.now(),
): Promise<SavedMeal> {
  const ts = new Date(now).toISOString();
  const meal = await db.transaction(
    "rw",
    [db.savedMeals, db.savedMealItems, db.outbox],
    async () => {
      const existing = id ? await db.savedMeals.get(id) : undefined;
      const meal: SavedMeal = {
        id: id ?? uuidv7(now),
        name: name.trim(),
        createdAt: existing?.createdAt ?? ts,
        updatedAt: ts,
        deletedAt: null,
        serverSeq: existing?.serverSeq ?? 0,
      };
      const rows: SavedMealItem[] = items.map((it, position) => ({
        ...it,
        id: uuidv7(now + position),
        savedMealId: meal.id,
        position,
      }));
      await db.savedMealItems.where("savedMealId").equals(meal.id).delete();
      await db.savedMeals.put(meal);
      await db.savedMealItems.bulkPut(rows);
      await enqueue(
        db,
        {
          entity: "saved_meal",
          entityId: meal.id,
          type: "upsert",
          data: mealBody(meal, rows),
          ...(meal.serverSeq ? { baseSeq: meal.serverSeq } : {}),
        },
        now,
      );
      return meal;
    },
  );
  emitLocalWrite();
  return meal;
}

export async function deleteMeal(db: PlateDB, id: string, now: number = Date.now()): Promise<void> {
  await db.transaction("rw", [db.savedMeals, db.savedMealItems, db.outbox], async () => {
    await db.savedMeals.update(id, { deletedAt: new Date(now).toISOString() });
    await db.savedMealItems.where("savedMealId").equals(id).delete();
    await enqueue(db, { entity: "saved_meal", entityId: id, type: "delete" }, now);
  });
  emitLocalWrite();
}

export async function mealItems(db: PlateDB, mealId: string): Promise<SavedMealItem[]> {
  return (await db.savedMealItems.where("savedMealId").equals(mealId).toArray()).sort(
    (a, b) => a.position - b.position,
  );
}

/** Log every item of a saved meal as its own entry. Returns the new ids so one Undo can remove them all. */
export async function logMeal(
  db: PlateDB,
  mealId: string,
  eatenOn: string,
  slot: Meal,
  now: number = Date.now(),
): Promise<string[]> {
  const items = await mealItems(db, mealId);
  const ids: string[] = [];
  await db.transaction("rw", [db.entries, db.outbox], async () => {
    for (const [i, it] of items.entries()) {
      const e: Entry = buildEntry(
        {
          eatenOn,
          meal: slot,
          foodId: it.foodId,
          name: it.name,
          brand: it.brand,
          barcode: null,
          amount: it.amount,
          unit: it.unit,
          grams: it.grams,
          kcal: it.kcal,
          protein: it.protein,
          carbs: it.carbs,
          fat: it.fat,
          sugar: it.sugar,
          satfat: it.satfat,
          fiber: it.fiber,
          salt: it.salt,
        },
        now + i,
      );
      await db.entries.put(e);
      await enqueue(
        db,
        { entity: "entry", entityId: e.id, type: "upsert", data: entryBody(e) },
        now + i,
      );
      ids.push(e.id);
    }
  });
  if (ids.length) emitLocalWrite();
  return ids;
}
