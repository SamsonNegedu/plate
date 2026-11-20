import { useState } from "react";
import type { UseFormRegisterReturn } from "react-hook-form";
import { Field } from "@/components/Field";
import { Segmented } from "@/components/Segmented";
import {
  gramsFromPercent,
  type MacroGrams,
  type MacroKey,
  percentFromGrams,
  reconcile,
} from "@/lib/macros";
import { formatKcal, parseDecimal } from "@/lib/numbers";
import { cls } from "./ui";

type MacroField = "proteinG" | "carbsG" | "fatG";

export interface MacroTargetsProps {
  /** The form's current text for the calorie goal and each macro, in grams. */
  values: { goalKcal?: string | undefined } & Partial<Record<MacroField, string | undefined>>;
  register: (name: MacroField) => UseFormRegisterReturn;
  /** Writes grams into the form and marks it changed. */
  setGrams: (name: MacroField, grams: string) => void;
  errors: Partial<Record<MacroField, string | undefined>>;
}

type Mode = "grams" | "percent";

const MACROS: Array<{
  key: MacroKey;
  field: MacroField;
  label: string;
  bar: string;
}> = [
  { key: "protein", field: "proteinG", label: "Protein", bar: "bg-accent" },
  { key: "carbs", field: "carbsG", label: "Carbs", bar: "bg-ink-3" },
  { key: "fat", field: "fatG", label: "Fat", bar: "bg-line" },
];

const num = (s: string | undefined): number => {
  const n = parseDecimal(s ?? "");
  return n !== null && n > 0 ? n : 0;
};

/**
 * Macro targets, entered as grams or as a share of the calories, always stored as grams. Beside the fields it shows how the
 * three split the calories and whether they add up to the calorie goal, so the numbers can be checked against each other.
 */
export function MacroTargets({ values, register, setGrams, errors }: MacroTargetsProps) {
  const [mode, setMode] = useState<Mode>("grams");
  const [pct, setPct] = useState<Record<MacroKey, string>>({ protein: "", carbs: "", fat: "" });
  const goal = num(values.goalKcal);
  const grams: MacroGrams = {
    protein: num(values.proteinG),
    carbs: num(values.carbsG),
    fat: num(values.fatG),
  };
  const set = MACROS.filter((m) => grams[m.key] > 0).length;
  const check = reconcile(goal, grams);
  // Each macro as a share of the calorie goal, so the bar fills to how much of the goal the macros cover.
  const share = (key: MacroKey) => (goal > 0 ? percentFromGrams(goal, grams[key], key) : 0);
  const scale = Math.max(
    100,
    MACROS.reduce((t, m) => t + share(m.key), 0),
  );

  const toPercent = (): Record<MacroKey, string> => {
    const out = { protein: "", carbs: "", fat: "" };
    for (const m of MACROS)
      if (grams[m.key] > 0) out[m.key] = String(percentFromGrams(goal, grams[m.key], m.key));
    return out;
  };
  const changeMode = (next: Mode) => {
    if (next === "percent") setPct(toPercent());
    setMode(next);
  };
  const editPercent = (m: (typeof MACROS)[number], text: string) => {
    setPct((p) => ({ ...p, [m.key]: text }));
    if (text.trim() === "") return setGrams(m.field, "");
    const n = parseDecimal(text);
    if (n !== null && goal > 0) setGrams(m.field, String(gramsFromPercent(goal, n, m.key)));
  };
  const pctTotal = MACROS.reduce((s, m) => s + num(pct[m.key]), 0);

  return (
    <fieldset className="m-0 grid min-w-0 gap-3 border-0 p-0">
      <legend className="mb-1 text-body font-semibold">Macro targets</legend>
      <Segmented
        label="Enter macros as"
        value={mode}
        options={[
          { value: "grams", label: "Grams" },
          { value: "percent", label: "% of calories" },
        ]}
        onChange={changeMode}
      />
      <div className={cls.three}>
        {MACROS.map((m) =>
          mode === "grams" ? (
            <Field
              key={m.key}
              label={m.label}
              inputMode="decimal"
              suffix="g"
              hint={
                goal > 0 && grams[m.key] > 0
                  ? `${percentFromGrams(goal, grams[m.key], m.key)}%`
                  : undefined
              }
              error={errors[m.field]}
              {...register(m.field)}
            />
          ) : (
            <Field
              key={m.key}
              label={m.label}
              inputMode="decimal"
              suffix="%"
              value={pct[m.key]}
              hint={grams[m.key] > 0 ? `${grams[m.key]} g` : undefined}
              onChange={(e) => editPercent(m, e.target.value)}
            />
          ),
        )}
      </div>

      {mode === "percent" && goal <= 0 ? (
        <p className={cls.hint}>
          Enter your daily calories first, so the percentages can become grams.
        </p>
      ) : null}

      {set === 0 ? (
        <p className={cls.hint}>Leave a macro blank to leave it untracked.</p>
      ) : (
        <div className="grid gap-1.5" aria-live="polite">
          <div
            className="flex h-2.5 overflow-hidden rounded-pill bg-surface-2"
            role="img"
            aria-label={`${MACROS.map((m) => `${m.label} ${Math.round(share(m.key))}%`).join(", ")} of your calories`}
          >
            {MACROS.map((m) => (
              <i
                key={m.key}
                className={`block h-full ${m.bar}`}
                style={{ width: `${(share(m.key) / scale) * 100}%` }}
              />
            ))}
          </div>
          <p className="text-meta text-ink-2">
            {`${MACROS.map((m) => `${m.label} ${Math.round(share(m.key))}%`).join(" · ")} of your calories`}
          </p>
          {set < 3 ? (
            <p className={cls.hint}>Fill in all three to see how they add up to your calories.</p>
          ) : (
            <p className={check.matches ? "text-label text-ink" : "text-label text-ink-2"}>
              {check.matches
                ? `Adds up to ${formatKcal(check.kcal)} kcal, which matches your goal.`
                : `Adds up to ${formatKcal(check.kcal)} kcal, ${formatKcal(Math.abs(check.diff))} ${check.diff < 0 ? "under" : "over"} your calorie goal.`}
            </p>
          )}
          {mode === "percent" ? (
            <p className="text-meta text-ink-2">{`The percentages add up to ${Math.round(pctTotal * 10) / 10}%.`}</p>
          ) : null}
        </div>
      )}
    </fieldset>
  );
}
