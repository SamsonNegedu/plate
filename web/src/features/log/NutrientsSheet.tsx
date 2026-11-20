import { useState } from "react";
import { Segmented } from "@/components/Segmented";
import { Sheet } from "@/components/Sheet";
import { useDay, useSettings } from "@/db/hooks";
import { MEALS, type Meal } from "@/db/types";
import { copy } from "@/lib/copy";
import { formatKcal, formatOptional } from "@/lib/numbers";
import { type NutrientKey, nutrientTotals, type NutrientTotals } from "@/lib/nutrition";
import { NUTRIENT_NAME } from "@/lib/recipe";
import { useUi } from "@/lib/ui";

type Scope = Meal | "day";

interface Row {
  label: string;
  key: "kcal" | NutrientKey;
  sub?: boolean;
}

const ROWS: Row[] = [
  { label: "Energy", key: "kcal" },
  { label: "Fat", key: "fat" },
  { label: "of which saturates", key: "satfat", sub: true },
  { label: "Carbohydrate", key: "carbs" },
  { label: "of which sugars", key: "sugar", sub: true },
  { label: "Fibre", key: "fiber" },
  { label: "Protein", key: "protein" },
  { label: "Salt", key: "salt" },
];

const percent = (part: number, whole: number) => `${Math.round((part / whole) * 100)}%`;

/** Every nutrient for the day or one meal, as a label-style table. Meals show their share of the day, the day shows the goals. */
export function NutrientsSheet({ date, scope: initial }: { date: string; scope: Scope }) {
  const ui = useUi();
  const day = useDay(date);
  const settings = useSettings();
  const [scope, setScope] = useState<Scope>(initial);
  if (!day || !settings) return null;

  const total = nutrientTotals(day.entries);
  const shown =
    scope === "day" ? total : nutrientTotals(day.entries.filter((e) => e.meal === scope));
  const goals: Partial<Record<Row["key"], number>> = {
    kcal: settings.goalKcal,
    protein: settings.proteinG,
    carbs: settings.carbsG,
    fat: settings.fatG,
    fiber: settings.fiberG,
  };
  const title = scope === "day" ? "Whole day" : copy.meals[scope];
  const cell = (t: NutrientTotals, key: Row["key"]): number | null =>
    key === "kcal" ? t.kcal : t[key];
  const fmt = (v: number | null, key: Row["key"]) =>
    key === "kcal" ? `${formatKcal(v ?? 0)} kcal` : formatOptional(v, " g");

  return (
    <Sheet title="Nutrition" description={title} onClose={ui.close}>
      <div className="grid gap-3.5">
        <Segmented
          label="Show"
          value={scope}
          options={[
            { value: "day", label: "Day" },
            ...MEALS.map((m) => ({ value: m, label: copy.meals[m] })),
          ]}
          onChange={setScope}
        />
        {shown.count === 0 ? (
          <p className="text-body text-ink-2">{`Nothing logged for ${title.toLowerCase()}.`}</p>
        ) : (
          <>
            <table className="w-full border-collapse text-label [&_td]:border-b [&_td]:border-line [&_td]:py-1.75 [&_td]:text-right [&_td]:font-medium [&_th]:border-b [&_th]:border-line [&_th]:py-1.75 [&_th]:text-left [&_th]:font-normal [&_thead_th]:border-ink [&_thead_th]:pb-1.5 [&_thead_th]:text-right [&_thead_th]:font-semibold [&_thead_th:first-child]:text-left">
              <caption className="sr-only">{`Nutrition for ${title.toLowerCase()}`}</caption>
              <thead>
                <tr>
                  <th scope="col">
                    <span className="sr-only">Nutrient</span>
                  </th>
                  <th scope="col">Amount</th>
                  <th scope="col">{scope === "day" ? "Goal" : "Of the day"}</th>
                </tr>
              </thead>
              <tbody>
                {ROWS.map((r) => {
                  const value = cell(shown, r.key);
                  const whole = cell(total, r.key);
                  const goal = goals[r.key];
                  let third = "";
                  if (scope === "day") third = goal && goal > 0 ? fmt(goal, r.key) : "";
                  else if (value !== null && whole !== null && whole > 0)
                    third = percent(value, whole);
                  return (
                    <tr
                      key={r.key}
                      className={r.sub ? "[&_th]:pl-3.5 [&_th]:text-ink-2" : undefined}
                    >
                      <th scope="row">{r.label}</th>
                      <td>{fmt(value, r.key)}</td>
                      <td className="text-ink-2">{third || "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {shown.partial.length > 0 ? (
              <p className="text-meta text-ink-2" role="status">
                {`Some foods do not report ${shown.partial.map((k) => NUTRIENT_NAME[k]).join(", ")}, so those are a minimum.`}
              </p>
            ) : null}
          </>
        )}
      </div>
    </Sheet>
  );
}
