import type { ReactNode } from "react";
import { useFoodImages } from "@/db/hooks";
import type { Entry, Meal } from "@/db/types";
import { copy } from "@/lib/copy";
import { formatKcal } from "@/lib/numbers";
import { entryKcal } from "@/lib/nutrition";
import { EntryRow } from "./EntryRow";
import { Icon } from "./Icon";
import styles from "./MealSection.module.css";

interface Props {
  meal: Meal;
  entries: Entry[];
  onAdd: () => void;
  onOpen: (e: Entry) => void;
  extra?: ReactNode;
}

export function MealSection({ meal, entries, onAdd, onOpen, extra }: Props) {
  const total = entries.reduce((s, e) => s + entryKcal(e), 0);
  const images = useFoodImages(entries.flatMap((e) => (e.foodId ? [e.foodId] : [])));
  const label = copy.meals[meal];
  return (
    <section className={styles.meal} aria-labelledby={`meal-${meal}`}>
      <header className={styles.head}>
        <h2 id={`meal-${meal}`}>{label}</h2>
        <span className={styles.total}>
          {entries.length > 0 ? `${formatKcal(total)} kcal` : ""}
        </span>
        <button
          type="button"
          className={styles.add}
          onClick={onAdd}
          aria-label={`Add to ${label.toLowerCase()}`}
        >
          <Icon name="plus" size={19} />
        </button>
      </header>
      {entries.map((e) => (
        <EntryRow
          key={e.id}
          entry={e}
          imagePath={e.foodId ? (images.get(e.foodId) ?? null) : null}
          onOpen={() => onOpen(e)}
        />
      ))}
      {extra}
    </section>
  );
}
