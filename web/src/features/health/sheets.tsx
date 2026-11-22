import { useState } from "react";
import { Button } from "@/components/Button";
import { ConfirmSheet } from "@/components/ConfirmSheet";
import { Field } from "@/components/Field";
import { Segmented } from "@/components/Segmented";
import { Select } from "@/components/Select";
import { Sheet } from "@/components/Sheet";
import { useDb } from "@/db/context";
import { addHealthRecord, deleteHealthRecord, saveHealthRecord } from "@/db/health";
import { savePlan, setWeightGoal, stopPlan } from "@/db/medication";
import type { HealthRecord } from "@/db/types";
import { cls } from "@/features/log/forms";
import { haptic } from "@/features/scan/feedback";
import { localDate } from "@/lib/dates";
import { MEASURES } from "@/lib/health";
import { formatGrams, formatMg, parseDecimal } from "@/lib/numbers";
import { PRODUCT_GROUPS, PRODUCTS, productNamed } from "@/lib/pens";
import { localInput, nudge } from "./when";
import { WhenField } from "./WhenField";

export { localInput } from "./when";

/** A datetime-local value back to a Date, or null when it is empty or not a time. */
function fromInput(v: string): Date | null {
  const d = new Date(v);
  return v === "" || Number.isNaN(d.getTime()) ? null : d;
}

export const SITES = [
  "Left abdomen",
  "Right abdomen",
  "Left thigh",
  "Right thigh",
  "Left upper arm",
  "Right upper arm",
] as const;

/** The injection site after the one used last, so rotating is one tap. */
export function nextSite(last: string | undefined): string {
  const i = SITES.findIndex((s) => s === last);
  return SITES[(i + 1) % SITES.length] ?? SITES[0];
}

export type MeasureKind = (typeof MEASURES)[number]["kind"];

/** Log a weight or a body measurement. The kind is a choice in the sheet, so one entry point covers all of them. */
export function MeasureSheet({
  kind: initial,
  canChoose,
  latestOf,
  onClose,
  onSaved,
}: {
  kind: MeasureKind;
  /** Offer the choice of what to measure. Off when the person already said: "Log weight" asks for a weight and nothing else. */
  canChoose: boolean;
  latestOf: (kind: MeasureKind) => number | null;
  onClose: () => void;
  onSaved: (record: HealthRecord) => void;
}) {
  const db = useDb();
  const [kind, setKind] = useState<MeasureKind>(initial);
  const [value, setValue] = useState(() => {
    const v = latestOf(initial);
    return v === null ? "" : formatGrams(v);
  });
  const [when, setWhen] = useState(() => localInput(new Date()));
  const [error, setError] = useState<string | undefined>();
  const [whenError, setWhenError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const measure = MEASURES.find((m) => m.kind === kind) ?? {
    kind: "weight" as const,
    label: "Weight",
    unit: "kg" as const,
  };
  const [min, max] = measure.unit === "kg" ? [20, 500] : [10, 300];

  const choose = (next: MeasureKind) => {
    setKind(next);
    const v = latestOf(next);
    setValue(v === null ? "" : formatGrams(v));
    setError(undefined);
  };

  const last = latestOf(kind);

  const save = async (text: string = value) => {
    const v = parseDecimal(text);
    const at = fromInput(when);
    const bad = v === null || v < min || v > max;
    setError(
      bad
        ? `Enter ${measure.label.toLowerCase()} in ${measure.unit}, ${min} to ${max}.`
        : undefined,
    );
    setWhenError(at === null ? "Enter a date and time." : undefined);
    if (bad || at === null) return;
    setBusy(true);
    try {
      onSaved(await addHealthRecord(db, { kind, value: v, at }));
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      title={canChoose ? "Log a measurement" : `Log ${measure.label.toLowerCase()}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="primary" block busy={busy} onClick={() => void save()}>
            Save
          </Button>
          {last !== null ? (
            <Button block busy={busy} onClick={() => void save(formatGrams(last))}>
              {`Same as last · ${formatGrams(last)} ${measure.unit}`}
            </Button>
          ) : null}
        </>
      }
    >
      <div className={cls.form}>
        {canChoose ? (
          <div className="grid gap-1.5">
            <label htmlFor="measure-kind" className="text-meta font-medium text-ink-2">
              Measure
            </label>
            <Select
              id="measure-kind"
              value={kind}
              onChange={(e) => choose(e.target.value as MeasureKind)}
            >
              {MEASURES.map((m) => (
                <option key={m.kind} value={m.kind}>
                  {m.label}
                </option>
              ))}
            </Select>
          </div>
        ) : null}
        <Field
          label={measure.label}
          inputMode="decimal"
          suffix={measure.unit}
          autoFocus={latestOf(kind) === null}
          value={value}
          error={error}
          hint={measure.unit === "cm" ? "Measured around the body, in cm." : undefined}
          onChange={(e) => setValue(e.target.value)}
        />
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Adjust the value">
          {(measure.unit === "kg" ? [-1, -0.1, 0.1, 1] : [-1, -0.5, 0.5, 1]).map((d) => (
            <button
              key={d}
              type="button"
              className="min-h-12 min-w-16 flex-1 rounded-ctl border border-line bg-surface text-label font-medium text-ink"
              onClick={() => {
                haptic(10);
                setValue((v) => nudge(v, d, latestOf(kind), parseDecimal));
              }}
            >
              {`${d > 0 ? "+" : "−"}${Math.abs(d)}`}
            </button>
          ))}
        </div>
        <WhenField value={when} onChange={setWhen} error={whenError} />
      </div>
    </Sheet>
  );
}

export function GoalSheet({ current, onClose }: { current: number | null; onClose: () => void }) {
  const db = useDb();
  const [value, setValue] = useState(current === null ? "" : formatGrams(current));
  const [error, setError] = useState<string | undefined>();

  const save = async () => {
    if (value.trim() === "") {
      await setWeightGoal(db, null);
      onClose();
      return;
    }
    const v = parseDecimal(value);
    if (v === null || v < 20 || v > 500) {
      setError("Enter a weight in kg, 20 to 500, or leave it empty for no goal.");
      return;
    }
    await setWeightGoal(db, v);
    onClose();
  };

  return (
    <Sheet
      title="Weight goal"
      description="Leave it empty to track without a goal."
      onClose={onClose}
      footer={
        <Button variant="primary" block onClick={() => void save()}>
          Save
        </Button>
      }
    >
      <Field
        label="Goal weight"
        inputMode="decimal"
        suffix="kg"
        autoFocus
        value={value}
        error={error}
        onChange={(e) => setValue(e.target.value)}
      />
    </Sheet>
  );
}

function startingDose(record: HealthRecord | undefined, last: HealthRecord | undefined): string {
  const from = record ?? last;
  return from ? formatMg(from.value) : "";
}

export function DoseSheet({
  medication,
  lastDose,
  record,
  onClose,
  onSaved,
  onDeleted,
}: {
  medication: string;
  lastDose: HealthRecord | undefined;
  /** Set when editing a dose that was already logged. */
  record?: HealthRecord;
  onClose: () => void;
  onSaved: (record: HealthRecord, isNew: boolean) => void;
  onDeleted: (record: HealthRecord) => void;
}) {
  const db = useDb();
  const [mg, setMg] = useState(() => startingDose(record, lastDose));
  const [site, setSite] = useState(record ? record.site : nextSite(lastDose?.site));
  const [when, setWhen] = useState(() =>
    localInput(record ? new Date(record.recordedAt) : new Date()),
  );
  const [note, setNote] = useState(record?.note ?? "");
  const [errors, setErrors] = useState<{ mg?: string; when?: string }>({});
  const strengths = productNamed(medication)?.strengthsMg ?? [];
  const [busy, setBusy] = useState(false);
  // With a last dose to copy from, logging is one tap on a summary; "Change details" opens the whole form.
  const [showForm, setShowForm] = useState(Boolean(record) || lastDose === undefined);

  const save = async () => {
    const v = parseDecimal(mg);
    const at = fromInput(when);
    const next = {
      mg:
        v === null || v <= 0 || v > 100
          ? "Enter the dose in mg, above 0 and up to 100."
          : undefined,
      when: at === null ? "Enter a date and time." : undefined,
    };
    setErrors(next);
    if (next.mg || next.when) setShowForm(true);
    if (v === null || at === null || next.mg || next.when) return;
    setBusy(true);
    try {
      if (record) {
        const updated = await saveHealthRecord(db, {
          ...record,
          value: v,
          site: site.trim(),
          note: note.trim(),
          recordedAt: at.toISOString(),
          recordedOn: localDate(at),
        });
        onSaved(updated, false);
      } else {
        onSaved(
          await addHealthRecord(db, { kind: "dose", value: v, at, medication, site, note }),
          true,
        );
      }
      onClose();
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!record) return;
    await deleteHealthRecord(db, record.id);
    onDeleted(record);
    onClose();
  };

  return (
    <Sheet
      title={record ? "Edit dose" : "Log a dose"}
      description={
        productNamed(medication)
          ? `${medication} (${productNamed(medication)?.generic})`
          : medication
      }
      onClose={onClose}
      footer={
        <>
          <Button variant="primary" block busy={busy} onClick={() => void save()}>
            {showForm ? "Save" : "Log dose"}
          </Button>
          {record ? (
            <Button variant="danger" block onClick={() => void remove()}>
              Delete
            </Button>
          ) : null}
        </>
      }
    >
      {showForm ? null : (
        <div className="grid gap-3">
          <p className="font-display text-stat leading-stat font-semibold">
            {`${mg} mg`}
            {site ? (
              <small className="ml-2 font-sans text-label font-normal text-ink-2">{site}</small>
            ) : null}
          </p>
          <p className={cls.muted}>Same dose as last time, next site in the rotation, taken now.</p>
          <Button onClick={() => setShowForm(true)}>Change details</Button>
        </div>
      )}
      <div className={cls.form} hidden={!showForm}>
        <div className="grid gap-2">
          <div className="grid grid-cols-2 items-start gap-3">
            <Field
              label="Dose"
              inputMode="decimal"
              suffix="mg"
              value={mg}
              error={errors.mg}
              onChange={(e) => setMg(e.target.value)}
            />
            <div className="grid gap-1.5">
              <label htmlFor="site" className="text-meta font-medium text-ink-2">
                Injection site
              </label>
              <Select id="site" value={site} onChange={(e) => setSite(e.target.value)}>
                <option value="">Not noted</option>
                {SITES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </Select>
            </div>
          </div>
          {strengths.length > 0 ? (
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Strengths">
              {strengths.map((st) => (
                <button
                  key={st}
                  type="button"
                  aria-pressed={parseDecimal(mg) === st}
                  className="min-h-12 rounded-pill border border-line bg-surface px-3.5 text-meta text-ink-2 aria-pressed:border-ink aria-pressed:text-ink"
                  onClick={() => setMg(formatMg(st))}
                >
                  {`${formatMg(st)} mg`}
                </button>
              ))}
            </div>
          ) : null}
          {lastDose && parseDecimal(mg) !== null && parseDecimal(mg) !== lastDose.value ? (
            <p className={cls.muted}>
              {`${(parseDecimal(mg) ?? 0) > lastDose.value ? "Up" : "Down"} from ${formatMg(lastDose.value)} mg last time.`}
            </p>
          ) : null}
          {!record && lastDose?.site ? (
            <p
              className={cls.muted}
            >{`Last time: ${lastDose.site}. The next site in the rotation is chosen.`}</p>
          ) : null}
        </div>
        <WhenField
          value={when}
          onChange={setWhen}
          error={errors.when}
          initial={record ? "other" : "now"}
        />
        <Field
          label="Note (optional)"
          value={note}
          maxLength={500}
          onChange={(e) => setNote(e.target.value)}
        />
      </div>
    </Sheet>
  );
}

const INTERVALS = [
  { value: "7", label: "Weekly" },
  { value: "14", label: "Every 2 weeks" },
  { value: "1", label: "Daily" },
] as const;

const OTHER = "__other";

export function PlanSheet({
  current,
  onClose,
}: {
  current: { name: string; intervalDays: number; startedOn: string; supply: number | null } | null;
  onClose: () => void;
}) {
  const db = useDb();
  const [choice, setChoice] = useState(() => {
    if (!current) return "";
    return productNamed(current.name) ? current.name : OTHER;
  });
  const [custom, setCustom] = useState(() =>
    current && !productNamed(current.name) ? current.name : "",
  );
  const [interval, setInterval] = useState(String(current?.intervalDays ?? 7));
  const [startedOn, setStartedOn] = useState(() => current?.startedOn ?? localDate(new Date()));
  const [supply, setSupply] = useState(
    current?.supply === null || !current ? "" : String(current.supply),
  );
  const [errors, setErrors] = useState<{
    name?: string;
    interval?: string;
    start?: string;
    supply?: string;
  }>({});
  const product = choice === OTHER ? null : productNamed(choice);
  const name = choice === OTHER ? custom : choice;
  const switching =
    current !== null &&
    name.trim() !== "" &&
    name.trim().toLowerCase() !== current.name.toLowerCase();

  const pick = (next: string) => {
    setChoice(next);
    const p = productNamed(next);
    if (p) setInterval(String(p.intervalDays));
    setErrors((e) => ({ ...e, name: undefined }));
  };

  const save = async () => {
    const days = parseDecimal(interval);
    const doses = supply.trim() === "" ? null : parseDecimal(supply);
    const next = {
      name: name.trim() === "" ? "Choose your medication, or name it." : undefined,
      interval:
        days === null || !Number.isInteger(days) || days < 1 || days > 90
          ? "Enter whole days, 1 to 90."
          : undefined,
      start: startedOn === "" ? "Enter the date you started." : undefined,
      supply:
        supply.trim() !== "" &&
        (doses === null || !Number.isInteger(doses) || doses < 0 || doses > 1000)
          ? "Enter a whole number of doses, or leave it empty."
          : undefined,
    };
    setErrors(next);
    if (days === null || Object.values(next).some(Boolean)) return;
    await savePlan(db, { name, intervalDays: days, startedOn, supplyDoses: doses });
    onClose();
  };

  const [confirmStop, setConfirmStop] = useState(false);
  const stop = async () => {
    await stopPlan(db);
    onClose();
  };

  return (
    <>
      <Sheet
        title={current ? "Change medication" : "Track a medication"}
        description="Plate keeps your log and a schedule. It never suggests or changes a dose."
        onClose={onClose}
        footer={
          <>
            <Button variant="primary" block onClick={() => void save()}>
              {switching ? "Switch medication" : "Save"}
            </Button>
            {current ? (
              <Button variant="danger" block onClick={() => setConfirmStop(true)}>
                Stop tracking
              </Button>
            ) : null}
          </>
        }
      >
        <div className={cls.form}>
          <div className="grid gap-1.5">
            <label htmlFor="product" className="text-meta font-medium text-ink-2">
              Medication
            </label>
            <Select
              id="product"
              value={choice}
              invalid={Boolean(errors.name)}
              onChange={(e) => pick(e.target.value)}
            >
              <option value="">Choose the name on your pen or box</option>
              {PRODUCT_GROUPS.map((g) => (
                <optgroup key={g} label={g}>
                  {PRODUCTS.filter((p) => p.group === g).map((p) => (
                    <option key={p.name} value={p.name}>
                      {`${p.name} (${p.generic})`}
                    </option>
                  ))}
                </optgroup>
              ))}
              <option value={OTHER}>Other, such as a compounded pen</option>
            </Select>
            {product ? (
              <p className={cls.muted}>
                {`${product.generic[0]?.toUpperCase()}${product.generic.slice(1)}, ${product.group.toLowerCase()}. Comes in ${product.strengthsMg.map((m) => formatMg(m)).join(", ")} mg; check your pen's label, as strengths differ by country.`}
              </p>
            ) : null}
            {errors.name ? (
              <p className="text-meta text-red" role="alert">
                {errors.name}
              </p>
            ) : null}
          </div>
          {choice === OTHER ? (
            <Field
              label="Name"
              placeholder="As written on the label"
              value={custom}
              maxLength={100}
              onChange={(e) => setCustom(e.target.value)}
            />
          ) : null}
          {switching ? (
            <p className="rounded-ctl border border-line bg-surface-2 px-3 py-2.5 text-meta text-ink-2">
              Your earlier doses stay in the log. The schedule starts again from the date below.
            </p>
          ) : null}
          <Segmented
            label="How often"
            value={INTERVALS.some((i) => i.value === interval) ? interval : ""}
            options={INTERVALS.map((i) => ({ value: i.value, label: i.label }))}
            onChange={setInterval}
          />
          <Field
            label="Days between doses"
            inputMode="numeric"
            value={interval}
            error={errors.interval}
            onChange={(e) => setInterval(e.target.value)}
          />
          <Field
            label={switching ? "Starts on" : "Started on"}
            type="date"
            value={startedOn}
            error={errors.start}
            onChange={(e) => setStartedOn(e.target.value)}
          />
          <Field
            label="Doses on hand (optional)"
            inputMode="numeric"
            hint="Shows how many are left and when to refill."
            value={supply}
            error={errors.supply}
            onChange={(e) => setSupply(e.target.value)}
          />
        </div>
      </Sheet>
      {confirmStop ? (
        <ConfirmSheet
          title="Stop tracking?"
          body="Your logged doses stay. Reminders and the next-dose schedule stop."
          confirmLabel="Stop tracking"
          onCancel={() => setConfirmStop(false)}
          onConfirm={stop}
        />
      ) : null}
    </>
  );
}
