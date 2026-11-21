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
  /** The nutrition is a community correction shared by every account (ADR-020). */
  community?: boolean | undefined;
  /** The category this food is compared with and its usual ranges, from the last lookup. Never synced. */
  category?: CategoryInfo | undefined;
}

/** A category's ranges per 100 g: for each nutrient the 5th percentile, the median and the 95th percentile. */
export interface CategoryInfo {
  name: string;
  ranges: Partial<Record<"kcal" | "fat" | "protein" | "carbs" | "salt", [number, number, number]>>;
}

export type Theme = "auto" | "light" | "dark";

export interface Settings {
  userId: string;
  goalKcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  /** Fibre target in grams. 0 means not tracked, like the macro targets. */
  fiberG: number;
  dayStartHour: number;
  theme: Theme;
  /** Optional: the weight to work towards, and the medication being tracked. Null means not set. */
  weightGoalKg: number | null;
  medName: string | null;
  /** Days between doses. */
  medIntervalDays: number | null;
  medStartedOn: string | null;
  /** Doses on hand as of `medSupplyAsOf`. */
  medSupplyDoses: number | null;
  medSupplyAsOf: string | null;
  updatedAt: string;
  serverSeq: number;
}

export type HealthKind =
  | "weight"
  | "waist"
  | "hips"
  | "chest"
  | "arm"
  | "thigh"
  | "neck"
  | "appetite"
  | "nausea"
  | "dose";

/** The kinds that are a length in cm around the body. */
export type CircumferenceKind = "waist" | "hips" | "chest" | "arm" | "thigh" | "neck";

/** One dated number the person logs: kg, cm, a 0 to 5 rating, or a dose in mg. Medication and site are for doses. */
export interface HealthRecord {
  id: string;
  kind: HealthKind;
  /** The local calendar day, assigned once by the client like an entry's eatenOn. */
  recordedOn: string;
  /** When it happened, as an ISO time. */
  recordedAt: string;
  value: number;
  medication: string;
  site: string;
  note: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  serverSeq: number;
}

/** A recipe (stored as a saved meal): ingredients plus the portions it makes. */
export interface SavedMeal {
  id: string;
  name: string;
  servings: number;
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

export type SyncEntity =
  | "entry"
  | "food"
  | "settings"
  | "saved_meal"
  | "favorite"
  | "health_record";
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

/** A correction waiting for the server because the device was offline. Local only, never synced. */
export interface PendingCorrection {
  revisionId: string;
  barcode: string;
  body: Record<string, unknown>;
  createdAt: string;
}
