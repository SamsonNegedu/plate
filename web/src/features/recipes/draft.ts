import type { ItemInput } from "@/db/savedMeals";
import type { SavedMealItem } from "@/db/types";
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
