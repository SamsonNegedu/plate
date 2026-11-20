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
  /** Opens that meal's nutrient table. Only offered once the meal has entries. */
  onDetails: () => void;
  onOpen: (e: Entry) => void;
  extra?: ReactNode;
}

export function MealSection({ meal, entries, onAdd, onDetails, onOpen, extra }: Props) {
  const total = entries.reduce((s, e) => s + entryKcal(e), 0);
  const images = useFoodImages(entries.flatMap((e) => (e.foodId ? [e.foodId] : [])));
  const label = copy.meals[meal];
  return (
    <section className="mt-5" aria-labelledby={`meal-${meal}`}>
      <header className="flex min-h-11 items-center gap-2 border-b-[1.5px] border-ink">
        <h2 className="min-w-0 flex-1 text-section font-semibold" id={`meal-${meal}`}>
          {entries.length > 0 ? (
            <button
              type="button"
              className="flex min-h-11 w-full items-center gap-2 bg-transparent p-0 text-left font-semibold"
              onClick={onDetails}
              aria-label={`${label} nutrition, ${formatKcal(total)} kcal`}
            >
              <span>{label}</span>
              <span className="ml-auto text-meta font-normal text-ink-2">
                {`${formatKcal(total)} kcal`}
              </span>
              <span className="text-glyph font-normal text-ink-3" aria-hidden="true">
                ›
              </span>
            </button>
          ) : (
            label
          )}
        </h2>
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
