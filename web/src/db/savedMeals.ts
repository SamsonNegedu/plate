import { RECIPE_BRAND, recipeNutrition } from "@/lib/recipe";
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
  servings: number,
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
        servings,
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

async function mealItems(db: PlateDB, mealId: string): Promise<SavedMealItem[]> {
  return (await db.savedMealItems.where("savedMealId").equals(mealId).toArray()).sort(
    (a, b) => a.position - b.position,
  );
}

/**
 * Log a recipe as one entry named after it. The snapshot is the recipe's nutrition per 100 g of ingredients, and a portion is
 * the recipe's weight over its servings, so any number of portions (or a fraction) comes out exact. Returns the new id for Undo.
 */
export async function logRecipe(
  db: PlateDB,
  mealId: string,
  eatenOn: string,
  slot: Meal,
  portions: number,
  opts: { now?: number; note?: string } = {},
): Promise<string | null> {
  const now = opts.now ?? Date.now();
  const recipe = await db.savedMeals.get(mealId);
  if (!recipe || recipe.deletedAt) return null;
  const items = await mealItems(db, mealId);
  if (items.length === 0 || !(portions > 0)) return null;
  const n = recipeNutrition(items, recipe.servings);
  const e: Entry = buildEntry(
    {
      eatenOn,
      meal: slot,
      foodId: null,
      name: recipe.name,
      brand: RECIPE_BRAND,
      barcode: null,
      amount: portions,
      unit: "serving",
      grams: portions * n.portionGrams,
      ...(opts.note ? { note: opts.note } : {}),
      ...n.per100,
    },
    now,
  );
  await db.transaction("rw", [db.entries, db.outbox], async () => {
    await db.entries.put(e);
    await enqueue(db, { entity: "entry", entityId: e.id, type: "upsert", data: entryBody(e) }, now);
  });
  emitLocalWrite();
  return e.id;
}
