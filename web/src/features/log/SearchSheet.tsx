import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { z } from "zod";
import { Button } from "@/components/Button";
import { EmptyState } from "@/components/EmptyState";
import { Icon } from "@/components/Icon";
import { Sheet } from "@/components/Sheet";
import { useDb } from "@/db/context";
import { getFood, getPref } from "@/db/foods";
import {
  type MealSummary,
  type RecentFood,
  useAllFoods,
  useFavoriteFoods,
  useRecentFoods,
  useSavedMeals,
  useUsualFoods,
} from "@/db/hooks";
import type { Food, FoodSource, Meal } from "@/db/types";
import { itemFromFood } from "@/features/recipes/draft";
import { resolveBarcode, resolveReference } from "@/food/lookup";
import { LocalSearch } from "@/food/searchIndex";
import { api } from "@/lib/api";
import { copy } from "@/lib/copy";
import { quickMeasure } from "@/lib/measures";
import { formatKcal } from "@/lib/numbers";
import { amountLabel } from "@/lib/nutrition";
import { type PickIngredient, useUi } from "@/lib/ui";
import { AccessExpired, NetworkError } from "@/sync/errors";
import { isLiquid, startingPortion } from "./portion";
import { useLog } from "./useLog";

const hitSchema = z.object({
  reference_id: z
    .string()
    .nullable()
    .optional()
    .transform((v) => v ?? null),
  id: z
    .string()
    .nullable()
    .optional()
    .transform((v) => v ?? null),
  barcode: z
    .string()
    .nullable()
    .optional()
    .transform((v) => v ?? null),
  name: z.string(),
  brand: z.string().optional().default(""),
  kcal: z.number(),
  serving_grams: z
    .number()
    .nullable()
    .optional()
    .transform((v) => v ?? null),
  source: z.enum(["off", "bls", "user", "catalog"]),
});

interface Hit {
  key: string;
  id: string | null;
  refId: string | null;
  barcode: string | null;
  name: string;
  brand: string;
  kcal: number;
  source: FoodSource;
}

const fromFood = (f: Food): Hit => ({
  key: f.barcode ?? f.id,
  id: f.id,
  refId: null,
  barcode: f.barcode,
  name: f.name,
  brand: f.brand,
  kcal: f.kcal,
  source: f.source,
});

const RECIPES_SHOWN = 3;

const rowText =
  "grid min-w-0 flex-1 gap-px [&_strong]:truncate [&_strong]:text-body [&_strong]:font-medium [&_span]:truncate [&_span]:text-meta [&_span]:text-ink-2";
const rowKcal =
  "text-body font-semibold whitespace-nowrap [&_small]:text-micro [&_small]:font-normal [&_small]:text-ink-2";
const rowPlus = "grid size-11 flex-none place-items-center bg-transparent text-ink";
const row =
  "flex min-h-14 w-full items-center gap-2 border-b border-line bg-transparent py-1 text-left text-ink";

export function SearchSheet({
  meal,
  date,
  pick,
}: {
  meal: Meal;
  date: string;
  pick?: PickIngredient | undefined;
}) {
  const db = useDb();
  const ui = useUi();
  const navigate = useNavigate();
  const { logFood } = useLog();
  const [query, setQuery] = useState("");
  const [remote, setRemote] = useState<{ q: string; hits: Hit[]; note: string | null } | null>(
    null,
  );
  const [opening, setOpening] = useState(false);
  const [added, setAdded] = useState(0);
  const foods = useAllFoods();
  const recentAll = useRecentFoods(8);
  const usual = useUsualFoods(meal, date, 4);
  const usualIds = new Set((usual ?? []).map((r) => r.food.id));
  const recents = (recentAll ?? []).filter((r) => !usualIds.has(r.food.id)).slice(0, 5);
  const favorites = useFavoriteFoods();
  const meals = useSavedMeals();
  const index = useMemo(() => {
    if (!foods) return null;
    const search = new LocalSearch();
    search.rebuild(foods);
    return search;
  }, [foods]);

  const q = query.trim();
  const local = useMemo(() => (index ? index.search(q).map(fromFood) : []), [index, q]);
  // The server answer is keyed by the query it was for, so a new query shows nothing stale and needs no reset effect.
  const server = q.length >= 2 && remote?.q === q ? remote : null;
  const note = server?.note ?? null;

  useEffect(() => {
    if (q.length < 2) return;
    const ctrl = new AbortController();
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const res = await api.GET("/foods/search", {
            params: { query: { q } },
            signal: ctrl.signal,
          });
          if (res.data) {
            const hits = z
              .array(hitSchema)
              .parse(res.data.results)
              .map((h): Hit => ({
                key: h.barcode ?? h.id ?? h.reference_id ?? h.name,
                id: h.id,
                refId: h.reference_id,
                barcode: h.barcode,
                name: h.name,
                brand: h.brand,
                kcal: h.kcal,
                source: h.source,
              }));
            setRemote({ q, hits, note: null });
          } else if (res.response.status === 429 || res.response.status >= 500) {
            setRemote({ q, hits: [], note: copy.sheet.searchUnavailable });
          }
        } catch (e) {
          if (e instanceof DOMException && e.name === "AbortError") return;
          const offline = e instanceof NetworkError || e instanceof AccessExpired;
          setRemote({
            q,
            hits: [],
            note: offline ? copy.sheet.offlineSearch : copy.sheet.searchUnavailable,
          });
        }
      })();
    }, 250);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [q]);

  // server results replace local duplicates; local-only rows (not yet synced) stay below them
  const results = useMemo(() => {
    if (q.length < 2) return [];
    if (!server) return local;
    const seen = new Set(server.hits.map((h) => h.key));
    return [...server.hits, ...local.filter((l) => !seen.has(l.key))];
  }, [q, server, local]);

  const foodOf = async (hit: Hit): Promise<Food | null> => {
    if (hit.refId) {
      const r = await resolveReference(db, hit.refId, { online: navigator.onLine });
      return r.kind === "found" ? r.food : null;
    }
    if (hit.id) {
      const f = await getFood(db, hit.id);
      if (f) return f;
    }
    if (hit.barcode) {
      const r = await resolveBarcode(db, hit.barcode);
      if (r.kind === "found") return r.food;
    }
    return null;
  };

  const unreachable = () =>
    ui.toast({
      message: "That food could not be opened. Try again when you are online.",
      tone: "error",
    });

  const open = async (hit: Hit) => {
    setOpening(true);
    try {
      const f = await foodOf(hit);
      if (f) ui.open({ kind: "product", food: f, meal, date, ...(pick ? { pick } : {}) });
      else unreachable();
    } finally {
      setOpening(false);
    }
  };

  /** Adds a recipe ingredient in one tap: the amount used last time, else a kitchen measure, else 100 g. The sheet stays open for the next one. */
  const quickPick = async (food: Food) => {
    if (!pick) return;
    const pref = await getPref(db, food.id);
    const measure = quickMeasure(food);
    let start = startingPortion(food, pref);
    if (!pref && measure) {
      const unit = measure.unit === "ml" && !isLiquid(food) ? "g" : measure.unit;
      start = { unit, amount: measure.amount };
    }
    const item = itemFromFood(food, start.unit, start.amount);
    if (!item) return;
    pick(item);
    setAdded((n) => n + 1);
    setQuery("");
    ui.toast({ message: `Added ${food.name} · ${amountLabel(item.amount, item.unit)}` });
  };

  const quickPickHit = async (hit: Hit) => {
    const f = await foodOf(hit);
    if (f) await quickPick(f);
    else unreachable();
  };

  const quickLog = async (r: RecentFood) => {
    const p = startingPortion(r.food, r.pref);
    await logFood(r.food, { ...p, meal, date, goToday: true });
    ui.closeAll();
  };

  const showEmpty = q.length < 2;
  const recipeMatches = pick
    ? []
    : (meals ?? []).filter((m) => m.meal.name.toLowerCase().includes(q.toLowerCase()));
  const noMatch =
    !showEmpty &&
    results.length === 0 &&
    recipeMatches.length === 0 &&
    (server !== null || note !== null);

  return (
    <Sheet
      title={
        pick
          ? `Add ingredient${added > 0 ? ` · ${added} added` : ""}`
          : `${copy.sheet.addTo} ${copy.meals[meal].toLowerCase()}`
      }
      onClose={ui.close}
      tall
      pinned={
        <div className="flex items-center gap-2.5 rounded-ctl border border-line bg-surface px-3 text-ink-3 focus-within:outline-2 focus-within:outline-offset-0 focus-within:outline-accent [&_input]:min-h-11.5 [&_input]:min-w-0 [&_input]:flex-1 [&_input]:bg-transparent [&_input]:px-0.5 [&_input]:py-px [&_input]:text-input [&_input]:text-ink [&_input]:outline-none">
          <Icon name="search" size={19} />
          <label className="sr-only" htmlFor="food-search">
            {copy.sheet.search}
          </label>
          <input
            id="food-search"
            type="search"
            autoFocus={!coarsePointer()}
            autoComplete="off"
            enterKeyHint="search"
            placeholder={copy.sheet.searchPlaceholder}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      }
      footer={
        pick ? (
          <Button variant="primary" block onClick={ui.close}>
            {added > 0 ? `Done · ${added} added` : "Done"}
          </Button>
        ) : (
          <Button block onClick={() => ui.replace({ kind: "quick", meal, date })}>
            {copy.sheet.quickAdd}
          </Button>
        )
      }
    >
      {note ? (
        <p className="mt-2.5 text-meta text-ink-2" role="status">
          {note}
        </p>
      ) : null}

      {showEmpty ? (
        <>
          {pick ? null : (
            <Section title={copy.sheet.savedMeals}>
              {(meals ?? []).slice(0, RECIPES_SHOWN).map((m) => (
                <RecipeRow key={m.meal.id} recipe={m} meal={meal} date={date} />
              ))}
              {(meals ?? []).length > RECIPES_SHOWN ? (
                <button
                  type="button"
                  className="flex min-h-11 w-full items-center bg-transparent text-left text-label font-medium text-accent"
                  onClick={() => {
                    ui.closeAll();
                    void navigate("/recipes");
                  }}
                >
                  {`All ${(meals ?? []).length} recipes`}
                </button>
              ) : null}
            </Section>
          )}
          <Section title={`Usual for ${copy.meals[meal].toLowerCase()}`}>
            {(usual ?? []).map((r) => (
              <FoodRow
                key={r.food.id}
                food={r.food}
                onOpen={() =>
                  ui.open({ kind: "product", food: r.food, meal, date, ...(pick ? { pick } : {}) })
                }
                onAdd={() => void (pick ? quickPick(r.food) : quickLog(r))}
              />
            ))}
          </Section>
          <Section title={copy.sheet.recent}>
            {recents.map((r) => (
              <FoodRow
                key={r.food.id}
                food={r.food}
                onOpen={() =>
                  ui.open({ kind: "product", food: r.food, meal, date, ...(pick ? { pick } : {}) })
                }
                onAdd={() => void (pick ? quickPick(r.food) : quickLog(r))}
              />
            ))}
          </Section>
          <Section title={copy.sheet.favorites}>
            {(favorites ?? []).map((r) => (
              <FoodRow
                key={r.food.id}
                food={r.food}
                onOpen={() =>
                  ui.open({ kind: "product", food: r.food, meal, date, ...(pick ? { pick } : {}) })
                }
                onAdd={() => void (pick ? quickPick(r.food) : quickLog(r))}
              />
            ))}
          </Section>
          {(usual ?? []).length +
            recents.length +
            (favorites ?? []).length +
            (pick ? 0 : (meals ?? []).length) ===
          0 ? (
            <p className="mt-4 text-label text-ink-2">
              {pick
                ? "Search for an ingredient."
                : "Search a food, or add calories without a label."}
            </p>
          ) : null}
        </>
      ) : (
        <ul className="mt-2" aria-label={copy.sheet.results} aria-busy={opening}>
          {recipeMatches.map((m) => (
            <li key={m.meal.id}>
              <RecipeRow recipe={m} meal={meal} date={date} />
            </li>
          ))}
          {results.map((h) => (
            <li key={h.key} className={pick ? "flex items-center border-b border-line" : undefined}>
              <button
                type="button"
                className={pick ? `${row} border-b-0` : row}
                onClick={() => void open(h)}
              >
                <span className={rowText}>
                  <strong>{h.name}</strong>
                  <span>{h.brand || "No brand"}</span>
                </span>
                <span className={rowKcal}>
                  {formatKcal(h.kcal)}
                  <small> kcal / 100 g</small>
                </span>
              </button>
              {pick ? (
                <button
                  type="button"
                  className={rowPlus}
                  aria-label={`Add ${h.name} to the recipe`}
                  onClick={() => void quickPickHit(h)}
                >
                  <Icon name="plus" size={19} />
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {noMatch ? (
        <EmptyState title={copy.sheet.noMatch}>
          {pick ? null : (
            <>
              <Button
                onClick={() => ui.replace({ kind: "manual", meal, date, barcode: null, name: q })}
              >
                {copy.sheet.addManually}
              </Button>
              <Button
                onClick={() => {
                  ui.closeAll();
                  void navigate("/scan");
                }}
              >
                {copy.scan.title}
              </Button>
            </>
          )}
        </EmptyState>
      ) : null}
    </Sheet>
  );
}

function RecipeRow({ recipe, meal, date }: { recipe: MealSummary; meal: Meal; date: string }) {
  const ui = useUi();
  const { servings } = recipe.meal;
  return (
    <div className={row}>
      <span className={rowText}>
        <strong>{recipe.meal.name}</strong>
        <span>{`Recipe · ${formatKcal(recipe.portionKcal)} kcal a portion · ${servings === 1 ? "1 portion" : `${servings} portions`}`}</span>
      </span>
      <button
        type="button"
        className={rowPlus}
        aria-label={`Add ${recipe.meal.name} to ${copy.meals[meal].toLowerCase()}`}
        onClick={() => ui.open({ kind: "logRecipe", recipeId: recipe.meal.id, meal, date })}
      >
        <Icon name="plus" size={19} />
      </button>
    </div>
  );
}

/** A touch screen shows the keyboard only when the field is tapped, so the first view is the list, not a keyboard. */
const coarsePointer = () => window.matchMedia("(pointer: coarse)").matches;

function Section({ title, children }: { title: string; children: React.ReactNode[] }) {
  if (children.length === 0) return null;
  return (
    <section className="mt-4.5 [&_h3]:border-b-[1.5px] [&_h3]:border-ink [&_h3]:pb-1 [&_h3]:text-body [&_h3]:font-semibold">
      <h3>{title}</h3>
      {children}
    </section>
  );
}

function FoodRow({
  food,
  onOpen,
  onAdd,
  addLabel = `Add ${food.name} again`,
}: {
  food: Food;
  onOpen: () => void;
  onAdd: (() => void) | undefined;
  addLabel?: string;
}) {
  return (
    <div className={row}>
      <button
        type="button"
        className="flex min-h-14 min-w-0 flex-1 items-center gap-2 bg-transparent p-0 text-left text-inherit"
        onClick={onOpen}
      >
        <span className={rowText}>
          <strong>{food.name}</strong>
          <span>{food.brand || "No brand"}</span>
        </span>
        <span className={rowKcal}>
          {formatKcal(food.kcal)}
          <small> kcal / 100 g</small>
        </span>
      </button>
      {onAdd ? (
        <button type="button" className={rowPlus} aria-label={addLabel} onClick={onAdd}>
          <Icon name="plus" size={19} />
        </button>
      ) : null}
    </div>
  );
}
