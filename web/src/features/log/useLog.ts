import { useCallback } from "react";
import { useNavigate } from "react-router";
import { useDb } from "@/db/context";
import { buildEntry, deleteEntry, saveEntry, undoAdd, undoDelete } from "@/db/entries";
import { setPref } from "@/db/foods";
import { logRecipe } from "@/db/savedMeals";
import type { Entry, Food, Meal, Unit } from "@/db/types";
import { copy } from "@/lib/copy";
import { gramsFor } from "@/lib/nutrition";
import { useUi } from "@/lib/ui";

const buzz = (ms = 30) => {
  if ("vibrate" in navigator) navigator.vibrate(ms);
};

export interface LogOptions {
  amount: number;
  unit: Unit;
  meal: Meal;
  date: string;
  /** Navigate to Today afterwards (from Scan and the product sheet) instead of staying put. */
  goToday?: boolean;
}

/** The logging actions shared by every sheet. Each one writes locally first and offers Undo. */
export function useLog() {
  const db = useDb();
  const toast = useUi((s) => s.toast);
  const navigate = useNavigate();

  const logFood = useCallback(
    async (food: Food, o: LogOptions): Promise<Entry | null> => {
      const grams = gramsFor(o.amount, o.unit, food.servingGrams);
      if (grams === null) return null;
      const entry = buildEntry({
        eatenOn: o.date,
        meal: o.meal,
        foodId: food.id,
        name: food.name,
        brand: food.brand,
        barcode: food.barcode,
        amount: o.amount,
        unit: o.unit,
        grams,
        kcal: food.kcal,
        protein: food.protein,
        carbs: food.carbs,
        fat: food.fat,
        sugar: food.sugar,
        satfat: food.satfat,
        fiber: food.fiber,
        salt: food.salt,
      });
      await saveEntry(db, entry);
      await setPref(db, food.id, o.unit, o.amount);
      buzz();
      toast({
        message: `Added to ${copy.mealsSingular[o.meal]}`,
        action: { label: copy.common.undo, run: () => undoAdd(db, entry.id) },
      });
      if (o.goToday) navigate("/today");
      return entry;
    },
    [db, navigate, toast],
  );

  const removeEntry = useCallback(
    async (entry: Entry) => {
      await deleteEntry(db, entry.id);
      toast({
        message: "Entry deleted",
        action: {
          label: copy.common.undo,
          run: async () => {
            await undoDelete(db, entry.id);
          },
        },
      });
    },
    [db, toast],
  );

  const logPortions = useCallback(
    async (mealId: string, name: string, date: string, slot: Meal, portions: number) => {
      const id = await logRecipe(db, mealId, date, slot, portions);
      if (id === null) return false;
      buzz();
      toast({
        message: `Added ${name} to ${copy.mealsSingular[slot]}`,
        action: { label: copy.common.undo, run: () => undoAdd(db, id) },
      });
      return true;
    },
    [db, toast],
  );

  return { logFood, removeEntry, logPortions };
}
