import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useState } from "react";
import { Button } from "@/components/Button";
import { Field } from "@/components/Field";
import { Segmented } from "@/components/Segmented";
import { Sheet } from "@/components/Sheet";
import { useDb } from "@/db/context";
import { saveEntry } from "@/db/entries";
import { getFood } from "@/db/foods";
import type { Entry, Meal, Unit } from "@/db/types";
import { MEALS } from "@/db/types";
import { copy } from "@/lib/copy";
import { formatKcal, parseDecimal } from "@/lib/numbers";
import { MAX_GRAMS } from "@/lib/nutrition";
import { useUi } from "@/lib/ui";
import styles from "./forms.module.css";
import { useLog } from "./useLog";

/** Edit amount, meal and note. The nutrition snapshot never changes here: a food edit does not rewrite history. */
export function EntryEditSheet({ entryId }: { entryId: string }) {
  const db = useDb();
  const ui = useUi();
  const { removeEntry } = useLog();
  const entry = useLiveQuery(() => db.entries.get(entryId), [db, entryId]);
  if (entry === undefined) return null;
  if (!entry || entry.deletedAt) {
    return (
      <Sheet title="Entry" onClose={ui.close}>
        <p className={styles.muted}>This entry was deleted.</p>
      </Sheet>
    );
  }
  return <Editor key={entry.id} entry={entry} onDelete={() => removeEntry(entry).then(ui.close)} />;
}

function Editor({ entry, onDelete }: { entry: Entry; onDelete: () => void }) {
  const db = useDb();
  const ui = useUi();
  const [text, setText] = useState(String(entry.amount));
  const [unit, setUnit] = useState<Unit>(entry.unit);
  const [meal, setMeal] = useState<Meal>(entry.meal);
  const [note, setNote] = useState(entry.note);
  const [foodName, setFoodName] = useState<string | null>(null);

  useEffect(() => {
    if (!entry.foodId) return;
    void getFood(db, entry.foodId).then((f) =>
      setFoodName(
        f
          ? `${f.source === "user" ? "Custom food" : f.source === "bls" ? "BLS" : "Open Food Facts"}`
          : null,
      ),
    );
  }, [db, entry.foodId]);

  // grams per unit comes from the entry itself, so a food that has since changed cannot alter this entry
  const perUnit = entry.grams / entry.amount;
  const amount = parseDecimal(text);
  const grams = amount === null ? null : unit === "g" || unit === "ml" ? amount : amount * perUnit;
  const error =
    amount === null || amount <= 0
      ? "Enter an amount above zero."
      : grams !== null && grams > MAX_GRAMS
        ? `That is more than ${MAX_GRAMS} g.`
        : undefined;
  const units: Unit[] = entry.unit === "g" || entry.unit === "ml" ? ["g", "ml"] : [entry.unit];

  const save = async () => {
    if (amount === null || grams === null || error) return;
    await saveEntry(db, { ...entry, amount, unit, grams, meal, note: note.trim() });
    ui.close();
  };

  return (
    <Sheet
      title={entry.name}
      description={[entry.brand, `${formatKcal((entry.kcal * (grams ?? entry.grams)) / 100)} kcal`]
        .filter(Boolean)
        .join(" · ")}
      onClose={ui.close}
      footer={
        <>
          <Button variant="primary" block onClick={() => void save()} disabled={Boolean(error)}>
            {copy.common.save}
          </Button>
          <Button variant="danger" block onClick={onDelete}>
            {copy.common.delete}
          </Button>
        </>
      }
    >
      <div className={styles.form}>
        {units.length > 1 ? (
          <Segmented
            label="Unit"
            value={unit}
            options={units.map((u) => ({ value: u, label: u }))}
            onChange={setUnit}
          />
        ) : null}
        <Field
          label="Amount"
          inputMode="decimal"
          suffix={unit === "serving" ? "portions" : unit === "piece" ? "pieces" : unit}
          value={text}
          onChange={(e) => setText(e.target.value)}
          error={error}
        />
        <Segmented
          label={copy.sheet.meal}
          value={meal}
          options={MEALS.map((m) => ({ value: m, label: copy.meals[m] }))}
          onChange={setMeal}
        />
        <Field
          label="Note (optional)"
          value={note}
          maxLength={500}
          onChange={(e) => setNote(e.target.value)}
        />
        <p className={styles.muted}>
          {foodName ? `Source: ${foodName}. ` : ""}
          Nutrition values are kept as they were when you logged this.
        </p>
      </div>
    </Sheet>
  );
}
