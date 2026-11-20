import { useLiveQuery } from "dexie-react-hooks";
import { useMemo } from "react";
import { type DayTotals, dayTotals } from "@/lib/nutrition";
import { useDb } from "./context";
import { entriesForDay } from "./entries";
import { userFoods } from "./foods";
import { getSettings } from "./settings";
import type {
  Entry,
  Food,
  FoodPref,
  HealthKind,
  HealthRecord,
  SavedMeal,
  SavedMealItem,
  Settings,
} from "./types";

/** Live entries for one date; undefined until the first read finishes. */
export function useDay(date: string): { entries: Entry[]; totals: DayTotals } | undefined {
  const db = useDb();
  const entries = useLiveQuery(() => entriesForDay(db, date), [db, date]);
  return useMemo(() => (entries ? { entries, totals: dayTotals(entries) } : undefined), [entries]);
}

export function useSettings(): Settings | undefined {
  const db = useDb();
  return useLiveQuery(() => getSettings(db), [db]);
}

export interface RecentFood {
  food: Food;
  pref: FoodPref | undefined;
}

/** The last distinct foods logged, newest first. Quick-add entries have no food and are skipped. */
export function useRecentFoods(limit: number): RecentFood[] | undefined {
  const db = useDb();
  return useLiveQuery(async () => {
    const recent = await db.entries
      .orderBy("updatedAt")
      .reverse()
      .filter((e) => e.deletedAt === null && e.foodId !== null)
      .limit(400)
      .toArray();
    const ids: string[] = [];
    for (const e of recent) if (e.foodId && !ids.includes(e.foodId)) ids.push(e.foodId);
    const out: RecentFood[] = [];
    for (const id of ids) {
      const food = await db.foods.get(id);
      if (food && !food.deletedAt) out.push({ food, pref: await db.foodPrefs.get(id) });
      if (out.length === limit) break;
    }
    return out;
  }, [db, limit]);
}

export function useFavoriteFoods(): RecentFood[] | undefined {
  const db = useDb();
  return useLiveQuery(async () => {
    const favs = await db.favorites.toArray();
    const out: RecentFood[] = [];
    for (const f of favs) {
      const food = await db.foods.get(f.foodId);
      if (food && !food.deletedAt) out.push({ food, pref: await db.foodPrefs.get(f.foodId) });
    }
    return out.sort((a, b) => a.food.name.localeCompare(b.food.name));
  }, [db]);
}

export function useFavoriteIds(): Set<string> {
  const db = useDb();
  const ids = useLiveQuery(async () => (await db.favorites.toArray()).map((f) => f.foodId), [db]);
  return useMemo(() => new Set(ids ?? []), [ids]);
}

export interface MealSummary {
  meal: SavedMeal;
  items: SavedMealItem[];
  count: number;
  /** Calories in the whole recipe. */
  kcal: number;
  /** Calories in one portion. */
  portionKcal: number;
}

export function useSavedMeals(): MealSummary[] | undefined {
  const db = useDb();
  return useLiveQuery(async () => {
    const meals = (await db.savedMeals.toArray()).filter((m) => !m.deletedAt);
    const out: MealSummary[] = [];
    for (const meal of meals) {
      const items = (await db.savedMealItems.where("savedMealId").equals(meal.id).toArray()).sort(
        (a, b) => a.position - b.position,
      );
      const kcal = items.reduce((s, i) => s + (i.kcal * i.grams) / 100, 0);
      out.push({ meal, items, count: items.length, kcal, portionKcal: kcal / meal.servings });
    }
    return out.sort((a, b) => a.meal.name.localeCompare(b.meal.name));
  }, [db]);
}

/** One recipe with its ingredients. Undefined while loading, null when it does not exist or was deleted. */
export function useRecipe(id: string): MealSummary | null | undefined {
  const all = useSavedMeals();
  if (!all) return undefined;
  return all.find((m) => m.meal.id === id) ?? null;
}

export function useCustomFoods(): Food[] | undefined {
  const db = useDb();
  return useLiveQuery(() => userFoods(db), [db]);
}

export function useAllFoods(): Food[] | undefined {
  const db = useDb();
  return useLiveQuery(() => db.foods.filter((f) => !f.deletedAt).toArray(), [db]);
}

/** Cached image paths for the foods behind a day's entries. Quick adds have no food and no image. */
export function useFoodImages(foodIds: string[]): Map<string, string | null> {
  const db = useDb();
  const key = foodIds.join(",");
  const images = useLiveQuery(async () => {
    const out = new Map<string, string | null>();
    for (const food of await db.foods.bulkGet(foodIds)) {
      if (food) out.set(food.id, food.imagePath);
    }
    return out;
  }, [db, key]);
  return images ?? new Map();
}

export function useEntryRange(from: string, to: string): Entry[] | undefined {
  const db = useDb();
  return useLiveQuery(
    () =>
      db.entries
        .where("eatenOn")
        .between(from, to, true, true)
        .filter((e) => e.deletedAt === null)
        .toArray(),
    [db, from, to],
  );
}

/** Live health records of one kind (or all), oldest first. Deleted ones are left out. */
export function useHealthRecords(kind?: HealthKind): HealthRecord[] | undefined {
  const db = useDb();
  return useLiveQuery(async () => {
    const rows = await (kind
      ? db.healthRecords.where("kind").equals(kind).toArray()
      : db.healthRecords.toArray());
    return rows
      .filter((r) => r.deletedAt === null)
      .sort((a, b) => a.recordedAt.localeCompare(b.recordedAt) || a.id.localeCompare(b.id));
  }, [db, kind]);
}
