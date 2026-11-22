import { useState } from "react";
import { Icon } from "@/components/Icon";
import type { SwipeAction } from "@/components/swipe";
import { SwipeRow } from "@/components/SwipeRow";
import { formatKcal, parseDecimal } from "@/lib/numbers";
import { amountLabel } from "@/lib/nutrition";
import type { DraftItem } from "./draft";

const UNIT_SUFFIX: Record<string, string> = { serving: "portions", piece: "pieces" };

/** One ingredient on one row: what it is and what it adds on the left, the amount to change and a remove on the right. */
export function IngredientRow({
  item,
  onAmount,
  onRemove,
  onSwipe,
}: {
  item: DraftItem;
  onAmount: (amount: number) => void;
  onRemove: () => void;
  onSwipe: (a: SwipeAction) => void;
}) {
  const [text, setText] = useState(String(Math.round(item.amount * 100) / 100));
  const suffix = UNIT_SUFFIX[item.unit] ?? item.unit;
  const counted = item.unit !== "g" && item.unit !== "ml";
  const meta = [
    item.brand,
    counted ? `${amountLabel(item.amount, item.unit)} = ${Math.round(item.grams)} g` : "",
    `${formatKcal((item.kcal * item.grams) / 100)} kcal`,
  ].filter(Boolean);

  return (
    <li className="border-b border-line">
      <SwipeRow onAction={onSwipe} labels={{ delete: "Remove", repeat: "Duplicate" }}>
        <div className="flex min-h-16 items-center gap-2 py-1.5">
          <span className="grid min-w-0 flex-1 gap-px">
            <strong className="line-clamp-2 text-body leading-snug font-medium">{item.name}</strong>
            <span className="text-meta text-ink-2">{meta.join(" · ")}</span>
          </span>
          <label className="flex flex-none items-center gap-1">
            <span className="sr-only">{`${item.name} amount in ${suffix}`}</span>
            <input
              inputMode="decimal"
              className="min-h-11 w-[4.5rem] rounded-ctl border border-line bg-surface px-2 text-right text-input"
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                const n = parseDecimal(e.target.value);
                if (n !== null && n > 0 && n <= 5000) onAmount(n);
              }}
            />
            <span className="w-9 text-meta text-ink-2">{suffix}</span>
          </label>
          <button
            type="button"
            className="-mr-2 grid size-11 flex-none place-items-center bg-transparent text-ink-3"
            aria-label={`Remove ${item.name}`}
            onClick={onRemove}
          >
            <Icon name="close" size={18} />
          </button>
        </div>
      </SwipeRow>
    </li>
  );
}
