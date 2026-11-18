import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Button } from "@/components/Button";
import { Field } from "@/components/Field";
import { Sheet } from "@/components/Sheet";
import { useDb } from "@/db/context";
import { saveCustomFood } from "@/db/foods";
import type { Food, Meal } from "@/db/types";
import { copy } from "@/lib/copy";
import { useUi } from "@/lib/ui";
import styles from "./forms.module.css";
import { optionalNumber, requiredNumber } from "./schemas";

const schema = z.object({
  name: z.string().trim().min(1, "Enter a name.").max(200),
  brand: z.string().trim().max(200),
  barcode: z
    .string()
    .trim()
    .refine(
      (s) => s === "" || /^\d{6,14}$/.test(s.replace(/\s/g, "")),
      "A barcode has 6 to 14 digits.",
    ),
  servingGrams: optionalNumber("serving size", 0.1, 5000),
  kcal: requiredNumber("calories per 100 g", 0, 1000),
  protein: optionalNumber("protein", 0, 100),
  carbs: optionalNumber("carbs", 0, 100),
  fat: optionalNumber("fat", 0, 100),
  sugar: optionalNumber("sugars", 0, 100),
  satfat: optionalNumber("saturates", 0, 100),
  fiber: optionalNumber("fibre", 0, 100),
  salt: optionalNumber("salt", 0, 100),
});

type In = z.input<typeof schema>;
type Out = z.output<typeof schema>;

interface Props {
  meal: Meal;
  date: string;
  barcode: string | null;
  food?: Food | undefined;
  name?: string | undefined;
  notLoggable?: boolean | undefined;
}

const txt = (n: number | null | undefined) => (n === null || n === undefined ? "" : String(n));

/** A missing barcode, a correction, or a homemade staple. Calories per 100 g are required; blank nutrients stay blank. */
export function ManualFoodSheet({ meal, date, barcode, food, name, notLoggable }: Props) {
  const db = useDb();
  const ui = useUi();
  const [server, setServer] = useState<string | null>(null);
  const form = useForm<In, unknown, Out>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: food?.name ?? name ?? "",
      brand: food?.brand ?? "",
      barcode: food?.barcode ?? barcode ?? "",
      servingGrams: txt(food?.servingGrams),
      kcal: food ? String(food.kcal) : "",
      protein: txt(food?.protein),
      carbs: txt(food?.carbs),
      fat: txt(food?.fat),
      sugar: txt(food?.sugar),
      satfat: txt(food?.satfat),
      fiber: txt(food?.fiber),
      salt: txt(food?.salt),
    },
  });
  const { errors, isSubmitting } = form.formState;
  const correcting = Boolean(food);

  const submit = form.handleSubmit(async (v) => {
    setServer(null);
    try {
      const saved = await saveCustomFood(db, {
        ...(food ? { id: food.id } : {}),
        barcode: v.barcode.replace(/\s/g, "") || null,
        name: v.name,
        brand: v.brand,
        servingGrams: v.servingGrams,
        kcal: v.kcal,
        protein: v.protein,
        carbs: v.carbs,
        fat: v.fat,
        sugar: v.sugar,
        satfat: v.satfat,
        fiber: v.fiber,
        salt: v.salt,
      });
      const notice = correcting
        ? "Saved. Entries you logged before keep their old values."
        : "Saved on this device.";
      ui.replace({
        kind: "product",
        food: saved,
        meal,
        date,
        notice: correcting ? notice : `${notice} Add it to Open Food Facts so others can find it.`,
      });
    } catch {
      setServer("The food could not be saved on this device. Free some storage and try again.");
    }
  });

  return (
    <Sheet
      title={correcting ? copy.sheet.editNutrition : "Add a food"}
      description={
        notLoggable
          ? copy.sheet.notLoggable
          : "Calories per 100 g are required. Anything you leave blank stays blank."
      }
      onClose={ui.close}
      footer={
        <>
          {server ? (
            <p role="alert" className={styles.serverError}>
              {server}
            </p>
          ) : null}
          <Button type="submit" form="manual-food" variant="primary" block busy={isSubmitting}>
            {copy.common.save}
          </Button>
        </>
      }
    >
      <form id="manual-food" className={styles.form} onSubmit={submit} noValidate>
        <Field
          label="Name"
          autoFocus={!correcting}
          error={errors.name?.message}
          {...form.register("name")}
        />
        <Field label="Brand (optional)" error={errors.brand?.message} {...form.register("brand")} />
        <Field
          label="Barcode"
          inputMode="numeric"
          readOnly={correcting && Boolean(food?.barcode)}
          hint={
            correcting && food?.barcode
              ? "The barcode stays the same when you correct a food."
              : undefined
          }
          error={errors.barcode?.message}
          {...form.register("barcode")}
        />
        <Field
          label="Serving size (optional)"
          inputMode="decimal"
          suffix="g"
          hint="Adds a portion option when you log it."
          error={errors.servingGrams?.message}
          {...form.register("servingGrams")}
        />
        <h3 className={styles.group}>Per 100 g</h3>
        <Field
          label="Calories"
          inputMode="decimal"
          suffix="kcal"
          error={errors.kcal?.message}
          {...form.register("kcal")}
        />
        <Field
          label="Protein"
          inputMode="decimal"
          suffix="g"
          error={errors.protein?.message}
          {...form.register("protein")}
        />
        <Field
          label="Carbs"
          inputMode="decimal"
          suffix="g"
          error={errors.carbs?.message}
          {...form.register("carbs")}
        />
        <Field
          label="Fat"
          inputMode="decimal"
          suffix="g"
          error={errors.fat?.message}
          {...form.register("fat")}
        />
        <details className={styles.more}>
          <summary>More nutrients</summary>
          <div className={styles.moreBody}>
            <Field
              label="Sugars"
              inputMode="decimal"
              suffix="g"
              error={errors.sugar?.message}
              {...form.register("sugar")}
            />
            <Field
              label="Saturates"
              inputMode="decimal"
              suffix="g"
              error={errors.satfat?.message}
              {...form.register("satfat")}
            />
            <Field
              label="Fibre"
              inputMode="decimal"
              suffix="g"
              error={errors.fiber?.message}
              {...form.register("fiber")}
            />
            <Field
              label="Salt"
              inputMode="decimal"
              suffix="g"
              error={errors.salt?.message}
              {...form.register("salt")}
            />
          </div>
        </details>
      </form>
    </Sheet>
  );
}
