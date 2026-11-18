import type { ReactNode } from "react";
import { useFoodImages } from "@/db/hooks";
import type { Entry, Meal } from "@/db/types";
import { copy } from "@/lib/copy";
import { formatKcal } from "@/lib/numbers";
import { entryKcal } from "@/lib/nutrition";
import { EntryRow } from "./EntryRow";
import { Icon } from "./Icon";

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
    <section className="mt-5" aria-labelledby={`meal-${meal}`}>
      <header className="flex min-h-11 items-center gap-2 border-b-[1.5px] border-ink">
        <h2 className="text-section font-semibold" id={`meal-${meal}`}>
          {label}
        </h2>
        <span className="ml-auto text-meta text-ink-2">
          {entries.length > 0 ? `${formatKcal(total)} kcal` : ""}
        </span>
        <button
          type="button"
          className="-mr-2.5 grid size-11 place-items-center bg-transparent text-ink"
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
