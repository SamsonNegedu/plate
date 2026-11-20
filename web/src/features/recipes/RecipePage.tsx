import { useEffect, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { Button } from "@/components/Button";
import { EmptyState } from "@/components/EmptyState";
import { Field } from "@/components/Field";
import { Icon } from "@/components/Icon";
import { Segmented } from "@/components/Segmented";
import { useDb } from "@/db/context";
import { useRecipe, useSettings } from "@/db/hooks";
import { deleteMeal, saveMeal } from "@/db/savedMeals";
import { defaultMeal, logicalDate } from "@/lib/dates";
import { formatKcal, formatOptional, parseDecimal } from "@/lib/numbers";
import { recipeNutrition } from "@/lib/recipe";
import { useUi } from "@/lib/ui";
import { useNow } from "@/lib/useNow";
import { type DraftItem, draftFromSaved, draftOf, toInput, withAmount } from "./draft";
import { IngredientRow } from "./IngredientRow";
import { RecipeSummary } from "./RecipeSummary";
import { ShareSheet } from "./ShareSheet";

const MAX_INGREDIENTS = 100;

export default function RecipePage() {
  const { id } = useParams();
  const recipe = useRecipe(id ?? "");
  if (id === "new") return <Editor key="new" />;
  if (recipe === undefined) return null;
  if (recipe === null) {
    return (
      <EmptyState title="That recipe is gone.">
        <Link to="/recipes" className="font-medium text-accent">
          Back to recipes
        </Link>
      </EmptyState>
    );
  }
  return (
    <Editor
      key={recipe.meal.id}
      id={recipe.meal.id}
      initial={{
        name: recipe.meal.name,
        servings: recipe.meal.servings,
        items: draftFromSaved(recipe.items),
      }}
    />
  );
}

/** Name, portions and every ingredient's food and amount: two forms with the same snapshot have nothing to save. */
function snapshot(name: string, servings: string, items: DraftItem[]): string {
  return JSON.stringify([
    name.trim(),
    parseDecimal(servings),
    items.map((i) => [i.foodId, i.name, i.unit, i.amount, Math.round(i.grams * 1000)]),
  ]);
}

interface Initial {
  name: string;
  servings: number;
  items: DraftItem[];
}

function Editor({ id, initial }: { id?: string; initial?: Initial }) {
  const db = useDb();
  const ui = useUi();
  const navigate = useNavigate();
  const now = useNow();
  const settings = useSettings();
  // Unsaved work parked while the scanner ran comes back once; otherwise the editor starts from the saved recipe.
  const [parked] = useState(() => {
    const d = useUi.getState().recipeDraft;
    return d?.key === (id ?? "new") ? d : null;
  });
  useEffect(() => {
    if (parked) useUi.getState().setRecipeDraft(null);
  }, [parked]);
  const [name, setName] = useState(parked?.name ?? initial?.name ?? "");
  const [servings, setServings] = useState(parked?.servings ?? String(initial?.servings ?? 1));
  const [items, setItems] = useState<DraftItem[]>(parked?.items ?? initial?.items ?? []);
  // What the saved recipe looks like, to tell a real change from an untouched form.
  const [baseline] = useState(() =>
    snapshot(initial?.name ?? "", String(initial?.servings ?? 1), initial?.items ?? []),
  );
  const dirty = snapshot(name, servings, items) !== baseline;
  const [errors, setErrors] = useState<{ name?: string; servings?: string; items?: string }>({});
  const [busy, setBusy] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [query, setQuery] = useSearchParams();
  const tab: "ingredients" | "nutrition" =
    query.get("tab") === "nutrition" ? "nutrition" : "ingredients";
  const setTab = (t: "ingredients" | "nutrition") =>
    setQuery(t === "nutrition" ? { tab: t } : {}, { replace: true });

  const portions = parseDecimal(servings);
  const validServings = portions !== null && portions > 0 && portions <= 1000;
  const nutrition = recipeNutrition(items, validServings ? portions : 1);

  const addIngredient = () => {
    if (items.length >= MAX_INGREDIENTS) {
      setErrors((e) => ({ ...e, items: `A recipe holds up to ${MAX_INGREDIENTS} ingredients.` }));
      return;
    }
    ui.open({
      kind: "search",
      meal: "lunch",
      date: settings ? logicalDate(now, settings.dayStartHour) : "",
      pick: (item) => {
        setItems((cur) => [...cur, draftOf(item)]);
        setErrors((e) => ({ ...e, items: undefined }));
      },
    });
  };

  const scanIngredient = () => {
    ui.setRecipeDraft({ key: id ?? "new", name, servings, items });
    void navigate(`/scan?recipe=${id ?? "new"}`);
  };

  const save = async () => {
    const next: typeof errors = {};
    if (name.trim() === "") next.name = "Give the recipe a name.";
    if (!validServings) next.servings = "Enter how many portions it makes, like 4.";
    if (items.length === 0) next.items = "Add at least one ingredient.";
    setErrors(next);
    if (Object.keys(next).length > 0 || portions === null) return;
    setBusy(true);
    try {
      await saveMeal(db, name, portions, items.map(toInput), id);
      ui.toast({ message: `Saved ${name.trim()}` });
      void navigate("/recipes");
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!id) return;
    await deleteMeal(db, id);
    ui.toast({ message: `Deleted ${name.trim() || "recipe"}` });
    void navigate("/recipes");
  };

  const logPortion = () => {
    if (!id || !settings) return;
    ui.open({
      kind: "logRecipe",
      recipeId: id,
      meal: defaultMeal(now),
      date: logicalDate(now, settings.dayStartHour),
    });
  };

  const bump = (dir: 1 | -1) => {
    const next = Math.max(1, Math.round(((portions ?? 1) + dir) * 100) / 100);
    setServings(String(next));
    setErrors((c) => ({ ...c, servings: undefined }));
  };
  const p = nutrition.portion;

  const iconBtn =
    "grid size-11 flex-none place-items-center rounded-ctl border border-line bg-surface text-ink";

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4 pb-2">
      <div className="mt-1 flex items-center gap-2">
        <Link
          to="/recipes"
          className="-ml-2 grid size-11 place-items-center text-ink no-underline"
          aria-label="Back to recipes"
        >
          <Icon name="back" />
        </Link>
        <h1 className="text-title font-semibold">{id ? "Edit recipe" : "New recipe"}</h1>
        {id ? (
          <button
            type="button"
            className="-mr-2 ml-auto grid size-11 place-items-center bg-transparent text-ink"
            aria-label="Share recipe"
            onClick={() => setSharing(true)}
          >
            <Icon name="share" />
          </button>
        ) : null}
      </div>

      <Field
        label="Name"
        placeholder="Lentil soup"
        value={name}
        error={errors.name}
        maxLength={200}
        onChange={(e) => {
          setName(e.target.value);
          setErrors((c) => ({ ...c, name: undefined }));
        }}
      />

      <div className="grid gap-1.5">
        <span className="text-meta font-medium text-ink-2" id="makes-label">
          Makes
        </span>
        <div className="flex items-center gap-2" role="group" aria-labelledby="makes-label">
          <button
            type="button"
            className={iconBtn}
            onClick={() => bump(-1)}
            aria-label="Fewer portions"
          >
            <Icon name="minus" />
          </button>
          <input
            aria-label="Portions"
            inputMode="decimal"
            className="min-h-11 w-20 rounded-ctl border border-line bg-surface text-center text-input aria-invalid:border-red"
            value={servings}
            aria-invalid={errors.servings ? true : undefined}
            onChange={(e) => {
              setServings(e.target.value);
              setErrors((c) => ({ ...c, servings: undefined }));
            }}
          />
          <button
            type="button"
            className={iconBtn}
            onClick={() => bump(1)}
            aria-label="More portions"
          >
            <Icon name="plus" />
          </button>
          <span className="text-label text-ink-2">portions</span>
        </div>
        {errors.servings ? (
          <p className="text-meta text-red" role="alert">
            {errors.servings}
          </p>
        ) : null}
      </div>

      <div className="sticky top-0 z-10 -mx-4 grid gap-2 border-y border-line bg-bg px-4 py-2">
        <div className="flex items-center gap-3">
          <p
            className="min-w-0 flex-1 text-meta text-ink-2 [&_b]:font-display [&_b]:text-stat [&_b]:leading-none [&_b]:font-semibold [&_b]:text-ink"
            aria-live="polite"
          >
            <b>{items.length === 0 ? "—" : formatKcal(p.kcal)}</b> kcal a portion
            {items.length === 0 ? null : (
              <span className="block truncate">
                {`P ${formatOptional(p.protein, " g")} · C ${formatOptional(p.carbs, " g")} · F ${formatOptional(p.fat, " g")}`}
              </span>
            )}
          </p>
          <Button
            variant="primary"
            busy={busy}
            disabled={!dirty}
            onClick={() => void save()}
            aria-label="Save recipe"
          >
            {dirty || !id ? "Save" : "Saved"}
          </Button>
        </div>
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <Segmented
              label="Recipe view"
              value={tab}
              options={[
                {
                  value: "ingredients",
                  label: items.length > 0 ? `Ingredients · ${items.length}` : "Ingredients",
                },
                { value: "nutrition", label: "Nutrition" },
              ]}
              onChange={setTab}
            />
          </div>
          {tab === "ingredients" && items.length > 0 ? (
            <>
              <button
                type="button"
                className={iconBtn}
                onClick={addIngredient}
                aria-label="Search ingredients"
              >
                <Icon name="search" />
              </button>
              <button
                type="button"
                className={iconBtn}
                onClick={scanIngredient}
                aria-label="Scan ingredient"
              >
                <Icon name="barcode" />
              </button>
            </>
          ) : null}
        </div>
      </div>

      {tab === "ingredients" ? (
        <section aria-label="Ingredients" className="grid gap-1">
          {items.length === 0 ? (
            <div className="grid gap-3 py-2">
              <p className="text-body text-ink-2">
                Add each ingredient with the amount you put in, raw or as packed.
              </p>
              <div className="grid grid-cols-2 gap-2">
                <Button onClick={addIngredient} aria-label="Search ingredients">
                  <Icon name="search" />
                  Search
                </Button>
                <Button onClick={scanIngredient} aria-label="Scan ingredient">
                  <Icon name="barcode" />
                  Scan
                </Button>
              </div>
            </div>
          ) : (
            <>
              <p className="text-meta text-ink-2">{`${formatKcal(nutrition.totalGrams)} g in total`}</p>
              <ul>
                {items.map((item) => (
                  <IngredientRow
                    key={item.key}
                    item={item}
                    onAmount={(amount) =>
                      setItems((cur) =>
                        cur.map((i) => (i.key === item.key ? withAmount(i, amount) : i)),
                      )
                    }
                    onRemove={() => setItems((cur) => cur.filter((i) => i.key !== item.key))}
                  />
                ))}
              </ul>
            </>
          )}
          {errors.items ? (
            <p className="text-meta text-red" role="alert">
              {errors.items}
            </p>
          ) : null}
        </section>
      ) : (
        <RecipeSummary
          nutrition={nutrition}
          servings={validServings ? portions : 1}
          items={items}
        />
      )}

      {id ? (
        <div className="grid gap-2">
          <Button block onClick={logPortion}>
            Log a portion
          </Button>
          <Button variant="danger" block onClick={() => void remove()}>
            Delete recipe
          </Button>
        </div>
      ) : null}
      {sharing ? (
        <ShareSheet
          recipe={{
            name: name.trim() || "Recipe",
            servings: validServings ? (portions ?? 1) : 1,
            items: items.map(toInput),
          }}
          onClose={() => setSharing(false)}
        />
      ) : null}
    </div>
  );
}
