import { useState } from "react";
import { useNavigate } from "react-router";
import { Button } from "@/components/Button";
import { Icon } from "@/components/Icon";
import { Segmented } from "@/components/Segmented";
import { Sheet } from "@/components/Sheet";
import { useRecipe } from "@/db/hooks";
import type { Meal } from "@/db/types";
import { MEALS } from "@/db/types";
import { cn } from "@/lib/cn";
import { copy } from "@/lib/copy";
import { formatKcal, formatOptional, parseDecimal } from "@/lib/numbers";
import { NUTRIENT_NAME, recipeNutrition } from "@/lib/recipe";
import { useUi } from "@/lib/ui";
import { useLog } from "./useLog";

const MAX_PORTIONS = 100;
const PRESETS: Array<{ name: string; portions: number }> = [
  { name: "¼ portion", portions: 0.25 },
  { name: "½ portion", portions: 0.5 },
  { name: "1 portion", portions: 1 },
  { name: "2 portions", portions: 2 },
];

interface Props {
  recipeId: string;
  meal: Meal;
  date: string;
}

/** Log some portions of a recipe as one entry. The portion count is the only number needed. */
export function LogRecipeSheet({ recipeId, meal: initialMeal, date }: Props) {
  const recipe = useRecipe(recipeId);
  const ui = useUi();
  if (recipe === undefined) return null;
  if (recipe === null) {
    return (
      <Sheet title="Recipe" onClose={ui.close}>
        <p className="text-meta text-ink-2">This recipe was deleted.</p>
      </Sheet>
    );
  }
  return (
    <Logger
      recipeId={recipeId}
      name={recipe.meal.name}
      servings={recipe.meal.servings}
      items={recipe.items}
      meal={initialMeal}
      date={date}
    />
  );
}

function Logger({
  recipeId,
  name,
  servings,
  items,
  meal: initialMeal,
  date,
}: {
  recipeId: string;
  name: string;
  servings: number;
  items: Parameters<typeof recipeNutrition>[0];
  meal: Meal;
  date: string;
}) {
  const ui = useUi();
  const navigate = useNavigate();
  const { logPortions } = useLog();
  const [text, setText] = useState("1");
  const [meal, setMeal] = useState<Meal>(initialMeal);
  const [busy, setBusy] = useState(false);

  const portions = parseDecimal(text);
  const error = portionsError(portions);
  const n = recipeNutrition(items, servings);
  const eaten = portions !== null && !error ? portions : null;

  const step = (dir: 1 | -1) => {
    const next = Math.max(0.25, Math.round(((portions ?? 1) + dir * 0.5) * 100) / 100);
    setText(String(next));
  };

  const add = async () => {
    if (eaten === null) return;
    setBusy(true);
    try {
      if (await logPortions(recipeId, name, date, meal, eaten)) {
        ui.closeAll();
        void navigate("/today");
      }
    } finally {
      setBusy(false);
    }
  };

  const stepBtn =
    "grid size-12 flex-none place-items-center rounded-ctl border border-line bg-surface text-ink";

  return (
    <Sheet
      title={name}
      description={`Makes ${servings === 1 ? "1 portion" : `${servings} portions`} · ${formatKcal(n.portion.kcal)} kcal a portion`}
      onClose={ui.close}
      footer={
        <Button
          variant="primary"
          block
          onClick={() => void add()}
          busy={busy}
          disabled={Boolean(error)}
        >
          {`Add to ${copy.meals[meal].toLowerCase()}`}
        </Button>
      }
    >
      <section aria-label="Portions" className="grid gap-2.5">
        <div className="flex items-center gap-2">
          <button
            type="button"
            className={stepBtn}
            onClick={() => step(-1)}
            aria-label="Fewer portions"
          >
            <Icon name="minus" />
          </button>
          <label className="flex-1 [&_input]:min-h-12 [&_input]:w-full [&_input]:rounded-ctl [&_input]:border [&_input]:border-line [&_input]:bg-surface [&_input]:text-center [&_input]:font-display [&_input]:text-wordmark [&_input]:font-semibold [&_input[aria-invalid=true]]:border-red">
            <span className="sr-only">Portions</span>
            <input
              inputMode="decimal"
              value={text}
              onChange={(e) => setText(e.target.value)}
              aria-invalid={error ? true : undefined}
              aria-describedby="portions-help"
            />
          </label>
          <button
            type="button"
            className={stepBtn}
            onClick={() => step(1)}
            aria-label="More portions"
          >
            <Icon name="plus" />
          </button>
        </div>
        <p
          id="portions-help"
          className={cn("min-h-5 text-center text-meta", error ? "text-red" : "text-ink-2")}
          role={error ? "alert" : undefined}
        >
          {error ??
            (eaten === null
              ? " "
              : `${Math.round(eaten * n.portionGrams)} g of ${Math.round(n.totalGrams)} g`)}
        </p>
        <div className="flex flex-wrap gap-1.5">
          {PRESETS.map((p) => (
            <button
              key={p.name}
              type="button"
              className="min-h-11 rounded-pill border border-line bg-surface px-3.5 text-meta text-ink"
              onClick={() => setText(String(p.portions))}
            >
              {p.name}
            </button>
          ))}
        </div>
      </section>

      <p
        className="mt-3.5 text-body text-ink-2 [&_b]:font-display [&_b]:text-total [&_b]:font-semibold [&_b]:text-ink"
        aria-live="polite"
      >
        <b>{eaten === null ? "—" : formatKcal(n.portion.kcal * eaten)}</b> kcal
        {eaten === null ? null : (
          <span>
            {" · "}P {formatOptional(scale(n.portion.protein, eaten), " g")} · C{" "}
            {formatOptional(scale(n.portion.carbs, eaten), " g")} · F{" "}
            {formatOptional(scale(n.portion.fat, eaten), " g")}
          </span>
        )}
      </p>
      {n.partial.length > 0 ? (
        <p className="mt-1 text-meta text-ink-2">
          {`Some ingredients do not report ${n.partial.map((k) => NUTRIENT_NAME[k]).join(", ")}, so those are a minimum.`}
        </p>
      ) : null}

      <div className="mt-3.5">
        <Segmented
          label={copy.sheet.meal}
          value={meal}
          options={MEALS.map((m) => ({ value: m, label: copy.meals[m] }))}
          onChange={setMeal}
        />
      </div>
    </Sheet>
  );
}

function portionsError(portions: number | null): string | undefined {
  if (portions === null || portions <= 0) return "Enter the portions you ate, like 1 or 0,5.";
  return portions > MAX_PORTIONS ? `That is more than ${MAX_PORTIONS} portions.` : undefined;
}

const scale = (v: number | null, by: number): number | null => (v === null ? null : v * by);
