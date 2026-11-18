export type Meal = "breakfast" | "lunch" | "dinner" | "snack";
export type Unit = "g" | "ml" | "piece" | "serving";
export type FoodSource = "off" | "bls" | "user" | "catalog";

export const MEALS: readonly Meal[] = ["breakfast", "lunch", "dinner", "snack"];

/** Per 100 g (or 100 ml). null means "not reported", never zero. */
export interface Nutrients {
  kcal: number;
  protein: number | null;
  carbs: number | null;
  fat: number | null;
  sugar: number | null;
  satfat: number | null;
  fiber: number | null;
  salt: number | null;
}

export interface Entry extends Nutrients {
  id: string;
  eatenOn: string;
  meal: Meal;
  foodId: string | null;
  name: string;
  brand: string;
  barcode: string | null;
  amount: number;
  unit: Unit;
  grams: number;
  note: string;
  createdAt: string;
  updatedAt: string;
  clientUpdatedAt: string;
  deletedAt: string | null;
  serverSeq: number;
}

export interface Food extends Nutrients {
  id: string;
  barcode: string | null;
  name: string;
  brand: string;
  quantity: string;
  servingSize: string;
  servingGrams: number | null;
  nutriscore: string | null;
  source: FoodSource;
  sourceId: string | null;
  sourceCheckedAt: string | null;
  stale: boolean;
  imagePath: string | null;
  ingredients: string;
  allergens: string;
  searchName: string;
  updatedAt: string;
  deletedAt: string | null;
  serverSeq: number;
}

export type Theme = "auto" | "light" | "dark";

export interface Settings {
  userId: string;
  goalKcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  dayStartHour: number;
  theme: Theme;
  updatedAt: string;
  serverSeq: number;
}

export interface SavedMeal {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  serverSeq: number;
}

export interface SavedMealItem extends Nutrients {
  id: string;
  savedMealId: string;
  foodId: string | null;
  name: string;
  brand: string;
  amount: number;
  unit: Unit;
  grams: number;
  position: number;
}

export interface Favorite {
  foodId: string;
  createdAt: string;
  updatedAt: string;
  serverSeq: number;
}

/** Local-only remembered portion for a food. Never synced. */
export interface FoodPref {
  foodId: string;
  unit: Unit;
  amount: number;
  updatedAt: string;
}

/** Local-only log of barcodes and searches that found nothing. Never synced. */
export interface FoodMiss {
  id?: number;
  barcode: string | null;
  query: string | null;
  note: string;
  createdAt: string;
}

export type SyncEntity = "entry" | "food" | "settings" | "saved_meal" | "favorite";
export type OutboxStatus = "pending" | "inflight" | "failed";

export interface OutboxOp {
  id?: number;
  opId: string;
  entity: SyncEntity;
  entityId: string;
  type: "upsert" | "delete";
  /** The wire body for an upsert; absent for a delete. */
  data?: unknown;
  baseSeq?: number;
  clientTs: string;
  status: OutboxStatus;
  attempts: number;
  createdAt: number;
  nextAttemptAt: number;
  error?: { code: string; detail: string };
}

export interface MetaRow {
  key: string;
  value: unknown;
}

export interface ConflictRow {
  id?: number;
  at: string;
  entity: SyncEntity;
  entityId: string;
  serverSeq: number;
}
