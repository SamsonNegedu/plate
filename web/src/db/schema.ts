import Dexie, { type Table } from "dexie";
import type {
  ConflictRow,
  Entry,
  Favorite,
  Food,
  FoodMiss,
  FoodPref,
  MetaRow,
  OutboxOp,
  SavedMeal,
  SavedMealItem,
  Settings,
} from "./types";

export class PlateDB extends Dexie {
  entries!: Table<Entry, string>;
  foods!: Table<Food, string>;
  settings!: Table<Settings, string>;
  savedMeals!: Table<SavedMeal, string>;
  savedMealItems!: Table<SavedMealItem, string>;
  favorites!: Table<Favorite, string>;
  foodPrefs!: Table<FoodPref, string>;
  foodMisses!: Table<FoodMiss, number>;
  outbox!: Table<OutboxOp, number>;
  meta!: Table<MetaRow, string>;
  conflicts!: Table<ConflictRow, number>;

  constructor(name = "plate") {
    super(name);
    this.version(1).stores({
      entries: "id, eatenOn, meal, [eatenOn+meal], foodId, serverSeq, updatedAt, deletedAt",
      foods: "id, &barcode, searchName, source, serverSeq, deletedAt",
      settings: "userId",
      savedMeals: "id, serverSeq, deletedAt",
      savedMealItems: "id, savedMealId, foodId",
      favorites: "foodId",
      foodPrefs: "foodId",
      foodMisses: "++id, barcode, createdAt",
      outbox: "++id, opId, entity, entityId, status, nextAttemptAt",
      meta: "key",
      conflicts: "++id, at, entity, entityId, serverSeq",
    });
  }
}
