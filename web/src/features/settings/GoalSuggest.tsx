import { type ReactNode, useId, useState } from "react";
import { Button } from "@/components/Button";
import { Field } from "@/components/Field";
import { Segmented } from "@/components/Segmented";
import { Select } from "@/components/Select";
import { Sheet } from "@/components/Sheet";
import { useDb } from "@/db/context";
import { useHealthRecords } from "@/db/hooks";
import { type BodyProfile, setBodyProfile, useBodyProfile } from "@/db/prefs";
import {
  ageFromBirthYear,
  type Activity,
  type GoalSuggestion,
  type Pace,
  suggestGoals,
} from "@/lib/goals";
import { formatKcal, parseDecimal } from "@/lib/numbers";
import { cls } from "./ui";

const ACTIVITY: Array<{ value: Activity; label: string; hint: string }> = [
  { value: "sedentary", label: "Low", hint: "Mostly sitting, little exercise" },
  { value: "light", label: "Light", hint: "Exercise 1 to 3 days a week" },
  { value: "moderate", label: "Medium", hint: "Exercise 3 to 5 days a week" },
  { value: "very", label: "High", hint: "Hard exercise most days" },
];

const PACE: Array<{ value: Pace; label: string }> = [
  { value: "-0.5", label: "−0.5" },
  { value: "-0.25", label: "−0.25" },
  { value: "0", label: "Keep" },
  { value: "0.25", label: "+0.25" },
];

const MIN_AGE = 18;
const signed = (n: number) => `${n > 0 ? "+" : "−"}${formatKcal(Math.abs(n))}`;

interface Props {
  /** True when a medication plan is set; the helper then only offers keeping weight. */
  onMedication: boolean;
  onAccept: (s: GoalSuggestion) => void;
}

/** A calorie and macro starting point, in a sheet of its own so the goals form stays short. Nothing applies until accepted. */
export function GoalSuggest({ onMedication, onAccept }: Props) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className="flex min-h-12 w-full items-center justify-between rounded-ctl border border-line bg-surface px-3 text-left text-label font-medium text-accent"
        onClick={() => setOpen(true)}
      >
        Not sure? Get a suggestion
        <span aria-hidden="true">›</span>
      </button>
      {open ? (
        <Loaded
          onMedication={onMedication}
          onClose={() => setOpen(false)}
          onAccept={(s) => {
            onAccept(s);
            setOpen(false);
          }}
        />
      ) : null}
    </>
  );
}

function Loaded(props: Props & { onClose: () => void }) {
  const saved = useBodyProfile();
  if (!saved) return null;
  return <Body saved={saved} {...props} />;
}

/** Adults only, newest first; a native picker gives a wheel on a phone. */
function YearPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const id = useId();
  const [years] = useState(() => {
    const newest = new Date().getFullYear() - MIN_AGE;
    return Array.from({ length: 83 }, (_, i) => newest - i);
  });
  return (
    <div className="grid grid-cols-1 gap-1.5">
      <label htmlFor={id} className="text-meta font-medium text-ink-2">
        Born
      </label>
      <Select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Year</option>
        {years.map((y) => (
          <option key={y} value={y}>
            {y}
          </option>
        ))}
      </Select>
    </div>
  );
}

function Labeled({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <span className="text-meta font-medium text-ink-2">{label}</span>
      {children}
    </div>
  );
}

function Body({
  saved,
  onMedication,
  onAccept,
  onClose,
}: Props & { saved: BodyProfile; onClose: () => void }) {
  const db = useDb();
  const weights = useHealthRecords("weight");
  const latest = weights?.at(-1)?.value;
  const [profile, setProfile] = useState(saved);
  const [birthYear, setBirthYear] = useState(saved.birthYear ? String(saved.birthYear) : "");
  const [height, setHeight] = useState(saved.heightCm ? String(saved.heightCm) : "");
  const [weight, setWeight] = useState(latest ? String(latest) : "");
  const [result, setResult] = useState<GoalSuggestion | null>(null);
  const [error, setError] = useState("");

  const pace: Pace = onMedication ? "0" : profile.pace;
  const set = (patch: Partial<BodyProfile>) => setProfile((p) => ({ ...p, ...patch }));

  const calculate = () => {
    const year = parseDecimal(birthYear);
    const cm = parseDecimal(height);
    const kg = parseDecimal(weight);
    const now = new Date().getFullYear();
    if (year === null || year < now - 110 || year > now)
      return setError("Pick your year of birth.");
    if (ageFromBirthYear(year) < MIN_AGE)
      return setError("This is for adults. Ask a doctor or dietitian for a goal.");
    if (cm === null || cm < 100 || cm > 230) return setError("Enter your height in cm.");
    if (kg === null || kg < 30 || kg > 300) return setError("Enter your weight in kg.");
    setError("");
    void setBodyProfile(db, { ...profile, pace, birthYear: year, heightCm: cm });
    setResult(
      suggestGoals({
        sex: profile.sex,
        ageYears: ageFromBirthYear(year),
        heightCm: cm,
        weightKg: kg,
        activity: profile.activity,
        pace,
      }),
    );
  };

  if (result)
    return (
      <Sheet
        title="Your suggestion"
        onClose={onClose}
        footer={
          <div className="grid grid-cols-2 gap-2">
            <Button onClick={() => setResult(null)}>Back</Button>
            <Button variant="primary" onClick={() => onAccept(result)}>
              Use these
            </Button>
          </div>
        }
      >
        <Result r={result} />
      </Sheet>
    );

  return (
    <Sheet
      title="Suggest my goals"
      description="An estimate for adults. Not for pregnancy or breastfeeding."
      onClose={onClose}
      footer={
        <Button variant="primary" block onClick={calculate}>
          Work it out
        </Button>
      }
    >
      <div className={cls.form}>
        <Labeled label="Sex">
          <Segmented
            label="Sex"
            value={profile.sex}
            options={[
              { value: "female", label: "Female" },
              { value: "male", label: "Male" },
              { value: "other", label: "Skip" },
            ]}
            onChange={(sex) => set({ sex })}
          />
        </Labeled>
        <div className={cls.three}>
          <YearPicker value={birthYear} onChange={setBirthYear} />
          <Field
            label="Height"
            inputMode="decimal"
            suffix="cm"
            value={height}
            onChange={(e) => setHeight(e.target.value)}
          />
          <Field
            label="Weight"
            inputMode="decimal"
            suffix="kg"
            value={weight}
            onChange={(e) => setWeight(e.target.value)}
          />
        </div>
        <Labeled label="Activity">
          <Segmented
            label="Activity"
            value={profile.activity}
            options={ACTIVITY.map((a) => ({ value: a.value, label: a.label }))}
            onChange={(activity) => set({ activity })}
          />
          <span className={cls.hint}>
            {ACTIVITY.find((a) => a.value === profile.activity)?.hint}
          </span>
        </Labeled>
        {onMedication ? (
          <p className={cls.hint}>
            You track a medication plan, so this suggests keeping your weight. Ask your clinician
            before eating less.
          </p>
        ) : (
          <Labeled label="Change a week, in kg">
            <Segmented
              label="Kilograms a week"
              value={pace}
              options={PACE}
              onChange={(next) => set({ pace: next })}
            />
          </Labeled>
        )}
        {error ? (
          <p className={cls.error} role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </Sheet>
  );
}

function Result({ r }: { r: GoalSuggestion }) {
  const rows: Array<[string, string]> = [
    ["Protein", `${r.proteinG} g`],
    ["Carbs", `${r.carbsG} g`],
    ["Fat", `${r.fatG} g`],
    ["Fibre", `${r.fiberG} g`],
  ];
  return (
    <div className="grid gap-4">
      <div>
        <p className="font-display text-display leading-display font-semibold">
          {formatKcal(r.kcal)}
          <span className="ml-2 text-label font-normal text-ink-2">kcal a day</span>
        </p>
        <p className={cls.hint}>
          Keeping your weight takes about {formatKcal(r.maintenanceKcal)}
          {r.adjustKcal === 0 ? "." : `; ${signed(r.adjustKcal)} for your pace.`}
          {r.raisedToFloor ? " It stops at a safe minimum." : ""}
        </p>
      </div>
      <dl className={cls.facts}>
        {rows.map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
