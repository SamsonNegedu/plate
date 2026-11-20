import { useState } from "react";
import type { Entry } from "@/db/types";
import { formatKcal } from "@/lib/numbers";
import { amountLabel, entryKcal } from "@/lib/nutrition";
import { isRecipeEntry, portionLabel } from "@/lib/recipe";
import { Icon } from "./Icon";

const rowIcon = (foodId: string | null, recipe: boolean) => {
  if (recipe) return "recipes";
  return foodId ? "bottle" : "lines";
};

export function EntryRow({
  entry,
  imagePath,
  onOpen,
}: {
  entry: Entry;
  imagePath: string | null;
  onOpen: () => void;
}) {
  const [broken, setBroken] = useState(false);
  const recipe = isRecipeEntry(entry);
  const meta = (
    recipe
      ? [entry.brand, portionLabel(entry.amount), `${Math.round(entry.grams)} g`]
      : [entry.brand, amountLabel(entry.amount, entry.unit)]
  )
    .filter(Boolean)
    .join(" · ");
  return (
    <button
      type="button"
      className="flex min-h-14 w-full items-center gap-3 border-b border-line bg-transparent py-1.5 text-left text-ink"
      onClick={onOpen}
    >
      <span
        className="grid size-9 flex-none place-items-center overflow-hidden rounded-lg bg-surface-2 text-ink-3"
        aria-hidden="true"
      >
        {imagePath && !broken ? (
          <img
            className="size-full object-cover"
            src={imagePath}
            alt=""
            loading="lazy"
            onError={() => setBroken(true)}
          />
        ) : (
          <Icon name={rowIcon(entry.foodId, recipe)} size={17} />
        )}
      </span>
      <span className="grid min-w-0 flex-1 gap-px">
        <strong className="truncate text-body leading-row font-medium">{entry.name}</strong>
        <span className="truncate text-meta text-ink-2">{meta}</span>
      </span>
      <span className="text-body font-semibold whitespace-nowrap">
        {formatKcal(entryKcal(entry))}
        <small className="text-micro font-normal text-ink-2"> kcal</small>
      </span>
    </button>
  );
}
