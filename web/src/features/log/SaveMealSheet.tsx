import { useState } from "react";
import { Button } from "@/components/Button";
import { Field } from "@/components/Field";
import { Sheet } from "@/components/Sheet";
import { useDb } from "@/db/context";
import { saveMeal } from "@/db/savedMeals";
import type { Entry } from "@/db/types";
import { copy } from "@/lib/copy";
import { useUi } from "@/lib/ui";
import styles from "./forms.module.css";

/** Snapshot the entries of one meal into a named saved meal. */
export function SaveMealSheet({ entries }: { entries: Entry[] }) {
  const db = useDb();
  const ui = useUi();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | undefined>();

  const save = async () => {
    if (name.trim() === "") {
      setError("Give the meal a name.");
      return;
    }
    await saveMeal(
      db,
      name,
      entries.map((e) => ({
        foodId: e.foodId,
        name: e.name,
        brand: e.brand,
        amount: e.amount,
        unit: e.unit,
        grams: e.grams,
        kcal: e.kcal,
        protein: e.protein,
        carbs: e.carbs,
        fat: e.fat,
        sugar: e.sugar,
        satfat: e.satfat,
        fiber: e.fiber,
        salt: e.salt,
      })),
    );
    ui.close();
    ui.toast({ message: `Saved ${name.trim()}` });
  };

  return (
    <Sheet
      title="Save as meal"
      description={`${entries.length} ${entries.length === 1 ? "item" : "items"} will be saved with their amounts.`}
      onClose={ui.close}
      footer={
        <Button variant="primary" block onClick={() => void save()}>
          {copy.common.save}
        </Button>
      }
    >
      <div className={styles.form}>
        <Field
          label="Name"
          placeholder="Usual breakfast"
          autoFocus
          value={name}
          error={error}
          onChange={(e) => {
            setName(e.target.value);
            setError(undefined);
          }}
        />
        <ul className={styles.muted}>
          {entries.map((e) => (
            <li key={e.id}>{e.name}</li>
          ))}
        </ul>
      </div>
    </Sheet>
  );
}
