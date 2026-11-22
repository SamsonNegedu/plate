import { z } from "zod";
import type {
  Entry,
  Favorite,
  Food,
  HealthRecord,
  SavedMeal,
  SavedMealItem,
  Settings,
} from "@/db/types";
import { searchName } from "@/lib/searchName";

/** The server's JSON is snake_case and untrusted. Everything is validated here and mapped to local rows. */
const num = z.number().finite();
const nullableNum = z
  .number()
  .finite()
  .nullable()
  .optional()
  .transform((v) => v ?? null);
const nullableText = z
  .string()
  .nullable()
  .optional()
  .transform((v) => v ?? null);
const text = z
  .string()
  .optional()
  .transform((v) => v ?? "");

const meal = z.enum(["breakfast", "lunch", "dinner", "snack"]);
const unit = z.enum(["g", "ml", "piece", "serving"]);

const nutrients = {
  kcal: num,
  protein: nullableNum,
  carbs: nullableNum,
  fat: nullableNum,
  sugar: nullableNum,
  satfat: nullableNum,
  fiber: nullableNum,
  salt: nullableNum,
};

export const entryDoc = z.object({
  id: z.string(),
  eaten_on: z.string(),
  meal,
  food_id: nullableText,
  name: z.string(),
  brand: text,
  barcode: nullableText,
  amount: num,
  unit,
  grams: num,
  ...nutrients,
  note: text,
  client_updated_at: text,
  created_at: z.string(),
  updated_at: z.string(),
  deleted_at: nullableText,
  server_seq: num,
});

export const foodDoc = z.object({
  id: z.string(),
  barcode: nullableText,
  name: z.string(),
  brand: text,
  quantity: text,
  serving_size: text,
  serving_grams: nullableNum,
  ...nutrients,
  nutriscore: nullableText,
  source: z.enum(["off", "bls", "user", "catalog"]),
  community_rev: nullableText,
  image_key: nullableText,
  source_id: nullableText,
  source_checked_at: nullableText,
  ingredients: text,
  allergens: text,
  updated_at: z.string(),
  deleted_at: nullableText,
  server_seq: num,
});

export const settingsDoc = z.object({
  goal_kcal: num,
  protein_g: num,
  carbs_g: num,
  fat_g: num,
  fiber_g: num.optional().default(0),
  day_start_hour: num,
  theme: z.enum(["auto", "light", "dark"]),
  weight_goal_kg: nullableNum,
  med_name: nullableText,
  med_interval_days: nullableNum,
  med_started_on: nullableText,
  med_supply_doses: nullableNum,
  med_supply_as_of: nullableText,
  updated_at: z.string(),
  server_seq: num,
});

export const healthDoc = z.object({
  id: z.string(),
  kind: z.enum([
    "weight",
    "waist",
    "hips",
    "chest",
    "arm",
    "thigh",
    "neck",
    "appetite",
    "nausea",
    "dose",
  ]),
  recorded_on: z.string(),
  recorded_at: z.string(),
  value: num,
  medication: text,
  site: text,
  note: text,
  created_at: z.string(),
  updated_at: z.string(),
  deleted_at: nullableText,
  server_seq: num,
});

const mealItemDoc = z.object({
  id: z.string(),
  food_id: nullableText,
  name: z.string(),
  brand: text,
  amount: num,
  unit,
  grams: num,
  ...nutrients,
  position: num,
});

export const savedMealDoc = z.object({
  id: z.string(),
  name: z.string(),
  servings: num.optional().default(1),
  items: z.array(mealItemDoc),
  created_at: z.string(),
  updated_at: z.string(),
  deleted_at: nullableText,
  server_seq: num,
});

export const favoriteDoc = z.object({
  food_id: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
  deleted_at: nullableText,
  server_seq: num,
});

export const deletedDoc = z.object({ deleted_at: z.string().nullable() });

export function toEntry(d: z.infer<typeof entryDoc>): Entry {
  return {
    id: d.id,
    eatenOn: d.eaten_on,
    meal: d.meal,
    foodId: d.food_id,
    name: d.name,
    brand: d.brand,
    barcode: d.barcode,
    amount: d.amount,
    unit: d.unit,
    grams: d.grams,
    kcal: d.kcal,
    protein: d.protein,
    carbs: d.carbs,
    fat: d.fat,
    sugar: d.sugar,
    satfat: d.satfat,
    fiber: d.fiber,
    salt: d.salt,
    note: d.note,
    createdAt: d.created_at,
    updatedAt: d.updated_at,
    clientUpdatedAt: d.client_updated_at,
    deletedAt: d.deleted_at,
    serverSeq: d.server_seq,
  };
}

/** Where a shared front photo is served: named by the revision, so it never changes. It may not exist, and the screens fall back to the icon. */
const factPhotoPath = (revision: string): string => `/api/v1/images/fact/${revision}/front`;

/**
 * The picture a food row ends up with when the server's version arrives. A picture this device already has stays. A shared photo
 * is named by its revision and goes with it, so the incoming path wins over an old shared one and never over a real picture.
 */
export function mergeImagePath(
  existing: string | null | undefined,
  incoming: string | null,
): string | null {
  const kept = existing && !existing.includes("/images/fact/") ? existing : null;
  return kept ?? incoming;
}

export function toFood(d: z.infer<typeof foodDoc>): Food {
  return {
    id: d.id,
    barcode: d.deleted_at ? null : d.barcode,
    name: d.name,
    brand: d.brand,
    quantity: d.quantity,
    servingSize: d.serving_size,
    servingGrams: d.serving_grams,
    kcal: d.kcal,
    protein: d.protein,
    carbs: d.carbs,
    fat: d.fat,
    sugar: d.sugar,
    satfat: d.satfat,
    fiber: d.fiber,
    salt: d.salt,
    nutriscore: d.nutriscore,
    source: d.source,
    sourceId: d.source_id,
    sourceCheckedAt: d.source_checked_at,
    stale: false,
    // A community food with no picture of its own shows the front photo shared with it, if there is one.
    imagePath: d.community_rev && !d.image_key ? factPhotoPath(d.community_rev) : null,
    ingredients: d.ingredients,
    allergens: d.allergens,
    searchName: searchName(`${d.name} ${d.brand}`),
    updatedAt: d.updated_at,
    deletedAt: d.deleted_at,
    serverSeq: d.server_seq,
    community: d.community_rev !== null,
  };
}

export function toSettings(userId: string, d: z.infer<typeof settingsDoc>): Settings {
  return {
    userId,
    goalKcal: d.goal_kcal,
    proteinG: d.protein_g,
    carbsG: d.carbs_g,
    fatG: d.fat_g,
    fiberG: d.fiber_g,
    dayStartHour: d.day_start_hour,
    theme: d.theme,
    weightGoalKg: d.weight_goal_kg,
    medName: d.med_name,
    medIntervalDays: d.med_interval_days,
    medStartedOn: d.med_started_on,
    medSupplyDoses: d.med_supply_doses,
    medSupplyAsOf: d.med_supply_as_of,
    updatedAt: d.updated_at,
    serverSeq: d.server_seq,
  };
}

export function toHealth(d: z.infer<typeof healthDoc>): HealthRecord {
  return {
    id: d.id,
    kind: d.kind,
    recordedOn: d.recorded_on,
    recordedAt: d.recorded_at,
    value: d.value,
    medication: d.medication,
    site: d.site,
    note: d.note,
    createdAt: d.created_at,
    updatedAt: d.updated_at,
    deletedAt: d.deleted_at,
    serverSeq: d.server_seq,
  };
}

export function toMeal(d: z.infer<typeof savedMealDoc>): {
  meal: SavedMeal;
  items: SavedMealItem[];
} {
  return {
    meal: {
      id: d.id,
      name: d.name,
      servings: d.servings,
      createdAt: d.created_at,
      updatedAt: d.updated_at,
      deletedAt: d.deleted_at,
      serverSeq: d.server_seq,
    },
    items: d.items.map((i) => ({
      id: i.id,
      savedMealId: d.id,
      foodId: i.food_id,
      name: i.name,
      brand: i.brand,
      amount: i.amount,
      unit: i.unit,
      grams: i.grams,
      kcal: i.kcal,
      protein: i.protein,
      carbs: i.carbs,
      fat: i.fat,
      sugar: i.sugar,
      satfat: i.satfat,
      fiber: i.fiber,
      salt: i.salt,
      position: i.position,
    })),
  };
}

export function toFavorite(d: z.infer<typeof favoriteDoc>): Favorite {
  return {
    foodId: d.food_id,
    createdAt: d.created_at,
    updatedAt: d.updated_at,
    serverSeq: d.server_seq,
  };
}
