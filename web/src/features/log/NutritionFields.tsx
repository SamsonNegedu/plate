import { type ChangeEvent, useState } from "react";
import type { UseFormRegisterReturn } from "react-hook-form";
import { NutrientRow, NutrientTable } from "@/components/NutrientRow";
import type { Field, ScanResult } from "@/food/ocr/scan";
import { copy } from "@/lib/copy";
import { parseDecimal, round } from "@/lib/numbers";
import { expectedKcal, plausibility } from "@/lib/plausibility";

/**
 * The nutrition table every capture sheet shares (a food per 100 g, a quick add for a whole plate): a printed label's order,
 * units fixed, energy in kcal or kJ, values read from a photo marked in words, and a hint while typing when the numbers
 * contradict each other. One component so the sheets cannot drift apart.
 */
export const NUTRIENT_FIELDS = [
  "kcal",
  "fat",
  "satfat",
  "carbs",
  "sugar",
  "fiber",
  "protein",
  "salt",
] as const;
export type NutrientField = (typeof NUTRIENT_FIELDS)[number];

const KJ_PER_KCAL = 4.184;

const META: Record<NutrientField, { label: string; unit: string; sub?: boolean }> = {
  kcal: { label: "Energy", unit: "kcal" },
  fat: { label: "Fat", unit: "g" },
  satfat: { label: "of which saturates", unit: "g", sub: true },
  carbs: { label: "Carbohydrate", unit: "g" },
  sugar: { label: "of which sugars", unit: "g", sub: true },
  fiber: { label: "Fibre", unit: "g" },
  protein: { label: "Protein", unit: "g" },
  salt: { label: "Salt", unit: "g" },
};

/** What the sheet's form offers the table. The sheet owns the form; the table only reads and writes these fields. */
export interface FormApi {
  register(field: NutrientField): UseFormRegisterReturn;
  setValue(field: NutrientField, value: string): void;
  getValue(field: NutrientField): string;
}

type Unit = "kcal" | "kj";

/** A hint that the numbers contradict each other. Quiet until enough is filled in to tell. */
function liveNote(values: Partial<Record<NutrientField, string>>): string | null {
  const num = (f: NutrientField) => parseDecimal(values[f] ?? "");
  const kcal = num("kcal");
  if (kcal === null) return null;
  const n = {
    kcal,
    fat: num("fat"),
    satfat: num("satfat"),
    carbs: num("carbs"),
    sugar: num("sugar"),
    fiber: num("fiber"),
    protein: num("protein"),
    salt: num("salt"),
  };
  const issues = plausibility(n);
  if (issues.length === 0) return null;
  const expected = expectedKcal(n);
  return issues
    .map((i) =>
      i === "energy_mismatch" && expected !== null
        ? `${copy.corrections.issues[i]} They come to about ${round(expected)} kcal.`
        : (copy.corrections.issues[i] ?? i),
    )
    .join(" ");
}

export function useNutrientInputs(
  api: FormApi,
  watched: Partial<Record<NutrientField, string>>,
  initialChecks: readonly Field[] = [],
) {
  const [unit, setUnit] = useState<Unit>("kcal");
  const [kjText, setKjText] = useState("");
  const [checks, setChecks] = useState<Set<Field>>(() => new Set(initialChecks));

  const changeUnit = (u: Unit) => {
    if (u === "kj") {
      const kcal = parseDecimal(api.getValue("kcal"));
      setKjText(kcal === null ? "" : String(round(kcal * KJ_PER_KCAL)));
    }
    setUnit(u);
  };
  const typeKj = (text: string) => {
    setKjText(text);
    const kj = parseDecimal(text);
    // The form always holds kcal; a kJ value is converted as it is typed.
    api.setValue("kcal", kj === null ? text : String(round(kj / KJ_PER_KCAL, 1)));
  };
  /** Props for one row: the form's own, plus clearing the "check" mark once the person has touched the value. */
  const field = (name: NutrientField) => {
    const r = api.register(name);
    return {
      ...r,
      check: checks.has(name),
      onChange: (e: ChangeEvent<HTMLInputElement>) => {
        setChecks((prev) => {
          const next = new Set(prev);
          next.delete(name);
          return next;
        });
        return r.onChange(e);
      },
    };
  };
  /** Fill the table from a photo and mark what the reader was unsure of. */
  const fill = (r: ScanResult) => {
    setChecks(new Set(r.check));
    for (const k of NUTRIENT_FIELDS) {
      const v = r.values[k];
      if (v !== undefined) api.setValue(k, String(v));
    }
  };
  return { unit, kjText, changeUnit, typeKj, field, fill, live: liveNote(watched) };
}

export type NutrientInputs = ReturnType<typeof useNutrientInputs>;

/** kcal or kJ for the energy row: small, beside the table heading, because it only matters for one row. */
function UnitToggle({ value, onChange }: { value: Unit; onChange: (u: Unit) => void }) {
  return (
    <fieldset className="m-0 flex min-w-0 gap-0.5 rounded-ctl border border-line bg-surface-2 p-0.5">
      <legend className="sr-only">Energy unit</legend>
      {(["kcal", "kj"] as const).map((u) => (
        <button
          key={u}
          type="button"
          aria-pressed={value === u}
          className="min-h-11 min-w-12 rounded-lg border border-transparent bg-transparent px-2 text-meta font-medium text-ink-2 aria-pressed:border-ink aria-pressed:bg-surface aria-pressed:text-ink"
          onClick={() => onChange(u)}
        >
          {u === "kj" ? "kJ" : "kcal"}
        </button>
      ))}
    </fieldset>
  );
}

interface TableProps {
  title: string;
  rows: readonly NutrientField[];
  inputs: NutrientInputs;
  errors: Partial<Record<NutrientField, string | undefined>>;
  /** Focus energy on open (a quick add is typed straight away; a food starts with the scan choice instead). */
  autoFocusEnergy?: boolean;
}

export function NutritionTable({ title, rows, inputs, errors, autoFocusEnergy }: TableProps) {
  const shown = NUTRIENT_FIELDS.filter((f) => rows.includes(f));
  return (
    <>
      <NutrientTable
        title={title}
        action={<UnitToggle value={inputs.unit} onChange={inputs.changeUnit} />}
      >
        {shown.map((f) => {
          const m = META[f];
          if (f === "kcal" && inputs.unit === "kj")
            return (
              <NutrientRow
                key={f}
                label={m.label}
                unit="kJ"
                value={inputs.kjText}
                error={errors.kcal}
                onChange={(e) => inputs.typeKj(e.target.value)}
                {...(autoFocusEnergy ? { autoFocus: true } : {})}
              />
            );
          return (
            <NutrientRow
              key={f}
              label={m.label}
              unit={m.unit}
              {...(m.sub ? { sub: true } : {})}
              error={errors[f]}
              {...inputs.field(f)}
              {...(autoFocusEnergy && f === "kcal" ? { autoFocus: true } : {})}
            />
          );
        })}
      </NutrientTable>
      {inputs.live ? (
        <p className="text-meta text-ink-2" role="status">
          {`${inputs.live} Check the label.`}
        </p>
      ) : null}
    </>
  );
}
