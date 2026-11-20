import type {
  Entry,
  Food,
  HealthRecord,
  Meal,
  Nutrients,
  SavedMeal,
  SavedMealItem,
  Settings,
  Unit,
} from "@/db/types";

/** What the app sends to the server. No validation library here: this file is part of the first paint. */
function nutrientBody(n: Nutrients) {
  return {
    kcal: n.kcal,
    protein: n.protein,
    carbs: n.carbs,
    fat: n.fat,
    sugar: n.sugar,
    satfat: n.satfat,
    fiber: n.fiber,
    salt: n.salt,
  };
}

export function entryBody(e: Entry) {
  return {
    eaten_on: e.eatenOn,
    meal: e.meal satisfies Meal,
    food_id: e.foodId,
    name: e.name,
    brand: e.brand,
    barcode: e.barcode,
    amount: e.amount,
    unit: e.unit satisfies Unit,
    grams: e.grams,
    ...nutrientBody(e),
    note: e.note,
    client_updated_at: e.clientUpdatedAt,
  };
}

export function foodBody(f: Food) {
  return {
    barcode: f.barcode,
    name: f.name,
    brand: f.brand,
    quantity: f.quantity,
    serving_size: f.servingSize,
    serving_grams: f.servingGrams,
    ...nutrientBody(f),
    nutriscore: f.nutriscore,
  };
}

export function settingsBody(s: Settings) {
  return {
    goal_kcal: s.goalKcal,
    protein_g: s.proteinG,
    carbs_g: s.carbsG,
    fat_g: s.fatG,
    fiber_g: s.fiberG ?? 0,
    day_start_hour: s.dayStartHour,
    theme: s.theme,
    weight_goal_kg: s.weightGoalKg ?? null,
    med_name: s.medName ?? null,
    med_interval_days: s.medIntervalDays ?? null,
    med_started_on: s.medStartedOn ?? null,
    med_supply_doses: s.medSupplyDoses ?? null,
    med_supply_as_of: s.medSupplyAsOf ?? null,
  };
}

export function healthBody(h: HealthRecord) {
  return {
    kind: h.kind,
    recorded_on: h.recordedOn,
    recorded_at: h.recordedAt,
    value: h.value,
    medication: h.medication,
    site: h.site,
    note: h.note,
  };
}

export function mealBody(meal: SavedMeal, items: SavedMealItem[]) {
  return {
    name: meal.name,
    servings: meal.servings,
    items: items.map((i) => ({
      id: i.id,
      food_id: i.foodId,
      name: i.name,
      brand: i.brand,
      amount: i.amount,
      unit: i.unit,
      grams: i.grams,
      ...nutrientBody(i),
      position: i.position,
    })),
  };
}
