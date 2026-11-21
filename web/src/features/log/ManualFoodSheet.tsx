import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { z } from "zod";
import { Button } from "@/components/Button";
import { Field } from "@/components/Field";
import { Sheet } from "@/components/Sheet";
import { useDb } from "@/db/context";
import { saveCustomFood } from "@/db/foods";
import type { Food, Meal } from "@/db/types";
import { type CorrectionOutcome, submitCorrection } from "@/food/corrections";
import type { ScanResult } from "@/food/ocr/scan";
import { copy, labelCopy } from "@/lib/copy";
import { useUi } from "@/lib/ui";
import { cls } from "./forms";
import { LabelScan } from "./LabelScan";
import { NUTRIENT_FIELDS, NutritionTable, useNutrientInputs } from "./NutritionFields";
import { PhotoShare } from "./PhotoShare";
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
  /** A label already read (from the not-found sheet), to fill the form with. */
  scan?: ScanResult | undefined;
}

const txt = (n: number | null | undefined) => (n === null || n === undefined ? "" : String(n));

const fromScan = (
  scan: ScanResult | undefined,
  field: (typeof NUTRIENT_FIELDS)[number],
): string => {
  const v = scan?.values[field];
  return v === undefined ? "" : String(v);
};

function scanNote(r: ScanResult): string {
  if (r.perServing) return labelCopy.perServing;
  return r.found === 0 ? labelCopy.nothing : labelCopy.filled;
}

function correctionNotice(out: CorrectionOutcome): string {
  if (out.kind === "shared") return copy.corrections.shared;
  if (out.kind === "queued") return copy.corrections.queued;
  return [
    copy.corrections.privateTitle,
    ...out.issues.map((i) => copy.corrections.issues[i] ?? i),
    copy.corrections.checkLabel,
  ].join(" ");
}

function describe(notLoggable: boolean | undefined, shared: boolean): string {
  if (notLoggable) return copy.sheet.notLoggable;
  if (shared)
    return "Everyone who scans this barcode sees these values. Energy per 100 g is required; blank stays blank.";
  return "Calories per 100 g are required. Anything you leave blank stays blank.";
}

/** A missing barcode, a correction, or a homemade staple. Calories per 100 g are required; blank nutrients stay blank. */
export function ManualFoodSheet({ meal, date, barcode, food, name, notLoggable, scan }: Props) {
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
      kcal: food ? String(food.kcal) : fromScan(scan, "kcal"),
      protein: food ? txt(food.protein) : fromScan(scan, "protein"),
      carbs: food ? txt(food.carbs) : fromScan(scan, "carbs"),
      fat: food ? txt(food.fat) : fromScan(scan, "fat"),
      sugar: food ? txt(food.sugar) : fromScan(scan, "sugar"),
      satfat: food ? txt(food.satfat) : fromScan(scan, "satfat"),
      fiber: food ? txt(food.fiber) : fromScan(scan, "fiber"),
      salt: food ? txt(food.salt) : fromScan(scan, "salt"),
    },
  });
  const [read, setRead] = useState<ScanResult | null>(scan ?? null);
  const [shareLabel, setShareLabel] = useState(true);
  const [frontPhoto, setFrontPhoto] = useState<string | null>(null);
  const watched = useWatch({ control: form.control, name: NUTRIENT_FIELDS });
  const inputs = useNutrientInputs(
    {
      register: (f) => form.register(f),
      setValue: (f, v) => form.setValue(f, v, { shouldDirty: true }),
      getValue: (f) => form.getValues(f),
    },
    Object.fromEntries(NUTRIENT_FIELDS.map((f, i) => [f, watched[i]])),
    scan?.check,
  );
  const onScan = (r: ScanResult) => {
    setRead(r);
    inputs.fill(r);
  };
  const { errors, isSubmitting } = form.formState;
  const correcting = Boolean(food);
  const hasBarcode = Boolean(food?.barcode ?? barcode);
  const shared = hasBarcode;
  let title = "Add a food";
  if (hasBarcode) title = correcting ? copy.sheet.correctProduct : copy.sheet.addProduct;
  else if (correcting) title = copy.sheet.editNutrition;

  const submit = form.handleSubmit(async (v) => {
    setServer(null);
    const base = {
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
    };
    try {
      if (base.barcode) {
        const out = await submitCorrection(
          db,
          {
            ...base,
            barcode: base.barcode,
            source: read && read.found > 0 ? "ocr" : "manual",
            labelImage: shareLabel ? (read?.labelPhoto ?? null) : null,
            frontImage: frontPhoto,
          },
          { existingFoodId: food?.id },
        );
        const notice = correctionNotice(out);
        ui.replace({ kind: "product", food: out.food, meal, date, notice });
        return;
      }
      const saved = await saveCustomFood(db, base);
      ui.replace({
        kind: "product",
        food: saved,
        meal,
        date,
        notice: correcting
          ? "Saved. Entries you logged before keep their old values."
          : "Saved on this device.",
      });
    } catch {
      setServer("The food could not be saved on this device. Free some storage and try again.");
    }
  });

  return (
    <Sheet
      title={title}
      description={describe(notLoggable, shared)}
      onClose={ui.close}
      footer={
        <>
          {server ? (
            <p role="alert" className={cls.serverError}>
              {server}
            </p>
          ) : null}
          <Button type="submit" form="manual-food" variant="primary" block busy={isSubmitting}>
            {copy.common.save}
          </Button>
        </>
      }
    >
      <form
        id="manual-food"
        className={cls.form}
        onSubmit={submit}

        noValidate
      >
        <div className="grid gap-2">
          <LabelScan
            primary={!read}
            onResult={onScan}
            label={read ? labelCopy.scanAgain : undefined}
          />
          {read ? (
            <div className="flex items-start gap-3">
              <img
                src={read.thumb}
                alt="The nutrition label you scanned"
                className="h-20 w-20 shrink-0 rounded-ctl border border-line object-cover"
              />
              <p className="text-meta text-ink-2" role="status">
                {scanNote(read)}
              </p>
            </div>
          ) : null}
        </div>
        <Field label="Name" error={errors.name?.message} {...form.register("name")} />
        <NutritionTable
          title="Per 100 g"
          rows={NUTRIENT_FIELDS}
          inputs={inputs}
          errors={{
            kcal: errors.kcal?.message,
            fat: errors.fat?.message,
            satfat: errors.satfat?.message,
            carbs: errors.carbs?.message,
            sugar: errors.sugar?.message,
            fiber: errors.fiber?.message,
            protein: errors.protein?.message,
            salt: errors.salt?.message,
          }}
        />
        <section className="grid gap-3" aria-label="Details">
          <Field
            label="Brand (optional)"
            error={errors.brand?.message}
            {...form.register("brand")}
          />
          <div className="grid grid-cols-2 items-start gap-3">
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
              error={errors.servingGrams?.message}
              {...form.register("servingGrams")}
            />
          </div>
        </section>
        {shared ? (
          <PhotoShare
            labelPhoto={read?.labelPhoto ?? null}
            shareLabel={shareLabel}
            onShareLabel={setShareLabel}
            frontPhoto={frontPhoto}
            onFrontPhoto={setFrontPhoto}
          />
        ) : null}
      </form>
    </Sheet>
  );
}
