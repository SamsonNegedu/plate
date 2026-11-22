import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useRef } from "react";
import { useForm, useWatch } from "react-hook-form";
import { z } from "zod";
import { Button } from "@/components/Button";
import { Field } from "@/components/Field";
import { useDb } from "@/db/context";
import { saveSettings } from "@/db/settings";
import type { Settings } from "@/db/types";
import { optionalNumber, requiredNumber } from "@/features/log/schemas";
import type { GoalSuggestion } from "@/lib/goals";
import { useUi } from "@/lib/ui";
import { GoalSuggest } from "./GoalSuggest";
import { MacroTargets } from "./MacroTargets";
import { cls } from "./ui";

const schema = z.object({
  goalKcal: requiredNumber("a calorie goal", 500, 9000),
  proteinG: optionalNumber("protein", 0, 500),
  carbsG: optionalNumber("carbs", 0, 500),
  fatG: optionalNumber("fat", 0, 500),
  fiberG: optionalNumber("fibre", 0, 200),
  dayStartHour: requiredNumber("an hour", 0, 23),
});

type In = z.input<typeof schema>;
type Out = z.output<typeof schema>;

const toForm = (s: Settings): In => ({
  goalKcal: String(s.goalKcal),
  proteinG: s.proteinG ? String(s.proteinG) : "",
  carbsG: s.carbsG ? String(s.carbsG) : "",
  fatG: s.fatG ? String(s.fatG) : "",
  fiberG: s.fiberG ? String(s.fiberG) : "",
  dayStartHour: String(s.dayStartHour),
});

/** Goals. Calories are the only required target; a macro left blank means "not tracked". Save is explicit. */
export function GoalsForm({ settings }: { settings: Settings }) {
  const db = useDb();
  const toast = useUi((s) => s.toast);
  const form = useForm<In, unknown, Out>({
    resolver: zodResolver(schema),
    defaultValues: toForm(settings),
  });
  const { errors, isDirty, isSubmitting } = form.formState;
  const formRef = useRef<HTMLFormElement>(null);
  const values = useWatch({ control: form.control });

  useEffect(() => {
    // A sync pull must not rewrite a field the user is about to type in; the digits would append to the reset value.
    if (isDirty || formRef.current?.contains(document.activeElement)) return;
    form.reset(toForm(settings));
  }, [settings, isDirty, form]);

  const submit = form.handleSubmit(async (v) => {
    await saveSettings(db, {
      goalKcal: v.goalKcal,
      proteinG: v.proteinG ?? 0,
      carbsG: v.carbsG ?? 0,
      fatG: v.fatG ?? 0,
      fiberG: v.fiberG ?? 0,
      dayStartHour: v.dayStartHour,
      theme: settings.theme,
    });
    form.reset(undefined, { keepValues: true });
    toast({ message: "Goals saved" });
  });

  const accept = (s: GoalSuggestion) => {
    const opts = { shouldDirty: true, shouldValidate: true } as const;
    form.setValue("goalKcal", String(s.kcal), opts);
    form.setValue("proteinG", String(s.proteinG), opts);
    form.setValue("carbsG", String(s.carbsG), opts);
    form.setValue("fatG", String(s.fatG), opts);
    form.setValue("fiberG", String(s.fiberG), opts);
  };

  return (
    <form ref={formRef} onSubmit={submit} noValidate className={cls.form}>
      <GoalSuggest onMedication={settings.medName !== null} onAccept={accept} />
      <Field
        label="Daily calories"
        inputMode="decimal"
        suffix="kcal"
        error={errors.goalKcal?.message}
        {...form.register("goalKcal")}
      />
      <MacroTargets
        values={values}
        register={(name) => form.register(name)}
        setGrams={(name, grams) => form.setValue(name, grams, { shouldDirty: true })}
        errors={{
          proteinG: errors.proteinG?.message,
          carbsG: errors.carbsG?.message,
          fatG: errors.fatG?.message,
        }}
      />
      <Field
        label="Fibre"
        inputMode="decimal"
        suffix="g"
        hint="Optional. Leave it blank to leave fibre untracked."
        error={errors.fiberG?.message}
        {...form.register("fiberG")}
      />
      <Field
        label="Day starts at"
        inputMode="numeric"
        suffix="h"
        hint="Entries logged before this hour count toward the previous day. Use 4 if you eat late."
        error={errors.dayStartHour?.message}
        {...form.register("dayStartHour")}
      />
      <div className={cls.row}>
        <Button type="submit" variant="primary" busy={isSubmitting} disabled={!isDirty}>
          Save goals
        </Button>
        {isDirty ? <span className={cls.dirty}>Unsaved changes</span> : null}
      </div>
    </form>
  );
}
