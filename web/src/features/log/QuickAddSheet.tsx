import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { useNavigate } from "react-router";
import { z } from "zod";
import { Button } from "@/components/Button";
import { Field } from "@/components/Field";
import { Segmented } from "@/components/Segmented";
import { Sheet } from "@/components/Sheet";
import { useDb } from "@/db/context";
import { buildEntry, saveEntry, undoAdd } from "@/db/entries";
import { MEALS, type Meal } from "@/db/types";
import { copy } from "@/lib/copy";
import { useUi } from "@/lib/ui";
import { cls } from "./forms";
import { NutritionTable, useNutrientInputs } from "./NutritionFields";
import { optionalNumber, requiredNumber } from "./schemas";

const schema = z.object({
  name: z.string().trim().max(200),
  kcal: requiredNumber("calories", 1, 5000),
  protein: optionalNumber("protein", 0, 500),
  carbs: optionalNumber("carbs", 0, 500),
  fat: optionalNumber("fat", 0, 500),
  note: z.string().trim().max(500),
});

const QUICK_ROWS = ["kcal", "fat", "carbs", "protein"] as const;

type In = z.input<typeof schema>;
type Out = z.output<typeof schema>;

/**
 * For a meal with no label. It creates an entry with a synthetic 100 g basis, so the per-100 values equal the totals and
 * there is one nutrition code path everywhere else.
 */
export function QuickAddSheet({ meal: initialMeal, date }: { meal: Meal; date: string }) {
  const db = useDb();
  const ui = useUi();
  const navigate = useNavigate();
  const [meal, setMeal] = useState<Meal>(initialMeal);
  const form = useForm<In, unknown, Out>({
    resolver: zodResolver(schema),
    defaultValues: { name: "", kcal: "", protein: "", carbs: "", fat: "", note: "" },
  });
  const watched = useWatch({ control: form.control, name: QUICK_ROWS });
  const inputs = useNutrientInputs(
    {
      // The table only asks for the rows in QUICK_ROWS, which are all fields of this form.
      register: (f) => form.register(f as (typeof QUICK_ROWS)[number]),
      setValue: (f, v) => form.setValue(f as (typeof QUICK_ROWS)[number], v, { shouldDirty: true }),
      getValue: (f) => form.getValues(f as (typeof QUICK_ROWS)[number]),
    },
    Object.fromEntries(QUICK_ROWS.map((f, i) => [f, watched[i]])),
  );
  const { errors, isSubmitting } = form.formState;

  const submit = form.handleSubmit(async (v) => {
    const entry = buildEntry({
      eatenOn: date,
      meal,
      foodId: null,
      name: v.name || "Quick add",
      brand: "",
      barcode: null,
      amount: 1,
      unit: "serving",
      grams: 100,
      kcal: v.kcal,
      protein: v.protein,
      carbs: v.carbs,
      fat: v.fat,
      sugar: null,
      satfat: null,
      fiber: null,
      salt: null,
      note: v.note,
    });
    await saveEntry(db, entry);
    ui.closeAll();
    ui.toast({
      message: `Added to ${copy.mealsSingular[meal]}`,
      action: { label: copy.common.undo, run: () => undoAdd(db, entry.id) },
    });
    navigate("/today");
  });

  return (
    <Sheet
      title={copy.sheet.quickAdd}
      description="For a restaurant meal or a plate with no label."
      onClose={ui.close}
      footer={
        <Button type="submit" form="quick-add" variant="primary" block busy={isSubmitting}>
          {`Add to ${copy.meals[meal].toLowerCase()}`}
        </Button>
      }
    >
      <form
        id="quick-add"
        className={cls.form}
        onSubmit={submit}

        noValidate
      >
        <Segmented
          label={copy.sheet.meal}
          value={meal}
          options={MEALS.map((m) => ({ value: m, label: copy.meals[m] }))}
          onChange={setMeal}
        />
        <Field
          label="Name (optional)"
          placeholder="Lunch with colleagues"
          error={errors.name?.message}
          {...form.register("name")}
        />
        <NutritionTable
          title="For the whole plate"
          rows={QUICK_ROWS}
          inputs={inputs}
          errors={{
            kcal: errors.kcal?.message,
            fat: errors.fat?.message,
            carbs: errors.carbs?.message,
            protein: errors.protein?.message,
          }}
          autoFocusEnergy
        />
        <Field label="Note (optional)" error={errors.note?.message} {...form.register("note")} />
      </form>
    </Sheet>
  );
}
