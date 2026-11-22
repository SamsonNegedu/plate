import type { ItemInput } from "@/db/savedMeals";
import type { Food, SavedMealItem, Unit } from "@/db/types";
import { gramsFor } from "@/lib/nutrition";
import { uuidv7 } from "@/lib/uuid";

/** An ingredient being edited. The key only identifies the row on screen; saving assigns real ids. */
export type DraftItem = ItemInput & { key: string };

export const draftOf = (item: ItemInput): DraftItem => ({ ...item, key: uuidv7() });

export const draftFromSaved = (items: SavedMealItem[]): DraftItem[] =>
  items.map(({ id, savedMealId: _meal, position: _pos, ...rest }) => ({ ...rest, key: id }));

export const toInput = ({ key: _key, ...item }: DraftItem): ItemInput => item;

/** Change an ingredient's amount in its own unit. Grams follow in proportion, so a portion or a piece keeps its weight. */
export function withAmount(item: DraftItem, amount: number): DraftItem {
  return { ...item, amount, grams: (item.grams / item.amount) * amount };
}

/** A food in an amount, ready to be an ingredient. Null when the amount has no weight (a serving the food has no weight for). */
export function itemFromFood(food: Food, unit: Unit, amount: number): ItemInput | null {
  const grams = gramsFor(amount, unit, food.servingGrams);
  if (grams === null) return null;
  return {
    foodId: food.id,
    name: food.name,
    brand: food.brand,
    amount,
    unit,
    grams,
    kcal: food.kcal,
    protein: food.protein,
    carbs: food.carbs,
    fat: food.fat,
    sugar: food.sugar,
    satfat: food.satfat,
    fiber: food.fiber,
    salt: food.salt,
  };
}

/** Every ingredient multiplied by `factor`, so a recipe that makes N portions makes N times factor with the same portion. Null if an amount would pass the limit. */
export function scaleItems(
  items: DraftItem[],
  factor: number,
  maxAmount = 5000,
): DraftItem[] | null {
  const scaled = items.map((i) => ({
    ...withAmount(i, Math.round(i.amount * factor * 100) / 100),
    key: uuidv7(),
  }));
  return scaled.some((i) => i.amount > maxAmount || i.amount <= 0) ? null : scaled;
}
