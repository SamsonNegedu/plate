import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useRef } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Button } from "@/components/Button";
import { Field } from "@/components/Field";
import { useDb } from "@/db/context";
import { saveSettings } from "@/db/settings";
import type { Settings } from "@/db/types";
import { optionalNumber, requiredNumber } from "@/features/log/schemas";
import { useUi } from "@/lib/ui";
import { cls } from "./ui";

const schema = z.object({
  goalKcal: requiredNumber("a calorie goal", 500, 9000),
  proteinG: optionalNumber("protein", 0, 500),
  carbsG: optionalNumber("carbs", 0, 500),
  fatG: optionalNumber("fat", 0, 500),
  dayStartHour: requiredNumber("an hour", 0, 23),
});

type In = z.input<typeof schema>;
type Out = z.output<typeof schema>;

const toForm = (s: Settings): In => ({
  goalKcal: String(s.goalKcal),
  proteinG: s.proteinG ? String(s.proteinG) : "",
  carbsG: s.carbsG ? String(s.carbsG) : "",
  fatG: s.fatG ? String(s.fatG) : "",
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
      dayStartHour: v.dayStartHour,
      theme: settings.theme,
    });
    form.reset(undefined, { keepValues: true });
    toast({ message: "Goals saved" });
  });

  return (
    <form ref={formRef} onSubmit={submit} noValidate className={cls.form}>
      <Field
        label="Daily calories"
        inputMode="decimal"
        suffix="kcal"
        error={errors.goalKcal?.message}
        {...form.register("goalKcal")}
      />
      <p className={cls.hint}>
        Calories are the only required target. Leave a macro blank to leave it untracked.
      </p>
      <div className={cls.three}>
        <Field
          label="Protein"
          inputMode="decimal"
          suffix="g"
          error={errors.proteinG?.message}
          {...form.register("proteinG")}
        />
        <Field
          label="Carbs"
          inputMode="decimal"
          suffix="g"
          error={errors.carbsG?.message}
          {...form.register("carbsG")}
        />
        <Field
          label="Fat"
          inputMode="decimal"
          suffix="g"
          error={errors.fatG?.message}
          {...form.register("fatG")}
        />
      </div>
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
