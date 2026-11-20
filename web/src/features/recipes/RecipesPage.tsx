import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { Button } from "@/components/Button";
import { EmptyState } from "@/components/EmptyState";
import { Icon } from "@/components/Icon";
import { useSavedMeals, useSettings } from "@/db/hooks";
import type { MealSummary } from "@/db/hooks";
import { defaultMeal, logicalDate } from "@/lib/dates";
import { formatKcal } from "@/lib/numbers";
import { useUi } from "@/lib/ui";
import { useNow } from "@/lib/useNow";
import { ImportSheet } from "./ImportSheet";
import { ShareSheet } from "./ShareSheet";

const portionsText = (n: number) => (n === 1 ? "1 portion" : `${n} portions`);

export default function RecipesPage() {
  const navigate = useNavigate();
  const ui = useUi();
  const now = useNow();
  const settings = useSettings();
  const recipes = useSavedMeals();
  const [importing, setImporting] = useState(false);
  const [sharing, setSharing] = useState<MealSummary | null>(null);
  if (!settings || !recipes) return null;
  const today = logicalDate(now, settings.dayStartHour);

  return (
    <div className="grid gap-3.5 pb-2">
      <div className="mt-1 flex items-center gap-3">
        <h1 className="flex-1 text-title font-semibold">Recipes</h1>
        <Button onClick={() => setImporting(true)}>Import</Button>
        <Button variant="primary" onClick={() => navigate("/recipes/new")}>
          New recipe
        </Button>
      </div>

      {recipes.length === 0 ? (
        <EmptyState
          title="No recipes yet."
          body="Add the ingredients once, say how many portions it makes, then log a portion in one tap."
        >
          <Button variant="primary" onClick={() => navigate("/recipes/new")}>
            Build a recipe
          </Button>
        </EmptyState>
      ) : (
        <ul aria-label="Recipes">
          {recipes.map((r) => (
            <li key={r.meal.id} className="flex items-center border-b border-line">
              <Link
                to={`/recipes/${r.meal.id}`}
                className="flex min-h-16 min-w-0 flex-1 items-center gap-2.5 text-ink no-underline"
              >
                <span className="grid min-w-0 flex-1 gap-px">
                  <strong className="line-clamp-2 text-body font-medium">{r.meal.name}</strong>
                  <span className="truncate text-meta text-ink-2">
                    {`${portionsText(r.meal.servings)} · ${r.count} ${r.count === 1 ? "ingredient" : "ingredients"}`}
                  </span>
                </span>
                <span className="text-right text-body font-semibold whitespace-nowrap">
                  {formatKcal(r.portionKcal)}
                  <small className="block text-micro font-normal text-ink-2">kcal a portion</small>
                </span>
              </Link>
              <button
                type="button"
                className="grid size-11 flex-none place-items-center bg-transparent text-ink-2"
                aria-label={`Share ${r.meal.name}`}
                onClick={() => setSharing(r)}
              >
                <Icon name="share" size={19} />
              </button>
              <button
                type="button"
                className="grid size-11 flex-none place-items-center bg-transparent text-ink"
                aria-label={`Log ${r.meal.name}`}
                onClick={() =>
                  ui.open({
                    kind: "logRecipe",
                    recipeId: r.meal.id,
                    meal: defaultMeal(now),
                    date: today,
                  })
                }
              >
                <Icon name="plus" size={19} />
              </button>
            </li>
          ))}
        </ul>
      )}
      {importing ? <ImportSheet onClose={() => setImporting(false)} /> : null}
      {sharing ? (
        <ShareSheet
          recipe={{
            name: sharing.meal.name,
            servings: sharing.meal.servings,
            items: sharing.items,
          }}
          onClose={() => setSharing(null)}
        />
      ) : null}
    </div>
  );
}
