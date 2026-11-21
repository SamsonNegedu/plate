import Dexie, { type Table } from "dexie";
import type {
  HealthRecord,
  ConflictRow,
  Entry,
  Favorite,
  Food,
  FoodMiss,
  FoodPref,
  MetaRow,
  OutboxOp,
  PendingCorrection,
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
  healthRecords!: Table<HealthRecord, string>;
  favorites!: Table<Favorite, string>;
  foodPrefs!: Table<FoodPref, string>;
  foodMisses!: Table<FoodMiss, number>;
  outbox!: Table<OutboxOp, number>;
  meta!: Table<MetaRow, string>;
  conflicts!: Table<ConflictRow, number>;
  corrections!: Table<PendingCorrection, string>;

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
    // Weight, waist, appetite, nausea and doses, plus the optional medication plan on settings.
    this.version(3)
      .stores({ healthRecords: "id, kind, recordedOn, [kind+recordedOn], serverSeq, deletedAt" })
      .upgrade((tx) =>
        tx
          .table("settings")
          .toCollection()
          .modify((s: Record<string, unknown>) => {
            for (const k of [
              "weightGoalKg",
              "medName",
              "medIntervalDays",
              "medStartedOn",
              "medSupplyDoses",
              "medSupplyAsOf",
            ])
              s[k] ??= null;
          }),
      );
    // A fibre target beside the macro targets; 0 means not tracked.
    this.version(4)
      .stores({})
      .upgrade((tx) =>
        tx
          .table("settings")
          .toCollection()
          .modify((s: { fiberG?: number }) => {
            s.fiberG ??= 0;
          }),
      );
    // Corrections that could not reach the server yet (device-only, ADR-020).
    this.version(5).stores({ corrections: "revisionId, barcode, createdAt" });
    // Saved meals became recipes: the ones saved before make one portion.
    this.version(2)
      .stores({})
      .upgrade((tx) =>
        tx
          .table("savedMeals")
          .toCollection()
          .modify((m: { servings?: number }) => {
            m.servings ??= 1;
          }),
      );
  }
}
