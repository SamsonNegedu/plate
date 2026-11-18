import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { z } from "zod";
import { Button } from "@/components/Button";
import { EmptyState } from "@/components/EmptyState";
import { Icon } from "@/components/Icon";
import { Sheet } from "@/components/Sheet";
import { useDb } from "@/db/context";
import { getFood } from "@/db/foods";
import {
  type RecentFood,
  useAllFoods,
  useFavoriteFoods,
  useRecentFoods,
  useSavedMeals,
} from "@/db/hooks";
import type { Food, FoodSource, Meal } from "@/db/types";
import { resolveBarcode } from "@/food/lookup";
import { LocalSearch } from "@/food/searchIndex";
import { api } from "@/lib/api";
import { copy } from "@/lib/copy";
import { formatKcal } from "@/lib/numbers";
import { useUi } from "@/lib/ui";
import { AccessExpired, NetworkError } from "@/sync/errors";
import { startingPortion } from "./portion";
import { useLog } from "./useLog";

const hitSchema = z.object({
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
  barcode: string | null;
  name: string;
  brand: string;
  kcal: number;
  source: FoodSource;
}

const fromFood = (f: Food): Hit => ({
  key: f.barcode ?? f.id,
  id: f.id,
  barcode: f.barcode,
  name: f.name,
  brand: f.brand,
  kcal: f.kcal,
  source: f.source,
});

const rowText =
  "grid min-w-0 flex-1 gap-px [&_strong]:truncate [&_strong]:text-body [&_strong]:font-medium [&_span]:truncate [&_span]:text-meta [&_span]:text-ink-2";
const rowKcal =
  "text-body font-semibold whitespace-nowrap [&_small]:text-micro [&_small]:font-normal [&_small]:text-ink-2";
const rowPlus = "grid size-11 flex-none place-items-center bg-transparent text-ink";
const row =
  "flex min-h-14 w-full items-center gap-2 border-b border-line bg-transparent py-1 text-left text-ink";

export function SearchSheet({ meal, date }: { meal: Meal; date: string }) {
  const db = useDb();
  const ui = useUi();
  const navigate = useNavigate();
  const { logFood, logSavedMeal } = useLog();
  const [query, setQuery] = useState("");
  const [remote, setRemote] = useState<{ q: string; hits: Hit[]; note: string | null } | null>(
    null,
  );
  const [opening, setOpening] = useState(false);
  const foods = useAllFoods();
  const recents = useRecentFoods(5);
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
                key: h.barcode ?? h.id ?? h.name,
                id: h.id,
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

  const open = async (hit: Hit) => {
    setOpening(true);
    try {
      if (hit.id) {
        const f = await getFood(db, hit.id);
        if (f) return ui.open({ kind: "product", food: f, meal, date });
      }
      if (hit.barcode) {
        const r = await resolveBarcode(db, hit.barcode);
        if (r.kind === "found") return ui.open({ kind: "product", food: r.food, meal, date });
      }
      ui.toast({
        message: "That food could not be opened. Try again when you are online.",
        tone: "error",
      });
    } finally {
      setOpening(false);
    }
  };

  const quickLog = async (r: RecentFood) => {
    const p = startingPortion(r.food, r.pref);
    await logFood(r.food, { ...p, meal, date, goToday: true });
    ui.closeAll();
  };

  const showEmpty = q.length < 2;
  const noMatch = !showEmpty && results.length === 0 && (server !== null || note !== null);

  return (
    <Sheet
      title={`${copy.sheet.addTo} ${copy.meals[meal].toLowerCase()}`}
      onClose={ui.close}
      footer={
        <Button block onClick={() => ui.replace({ kind: "quick", meal, date })}>
          {copy.sheet.quickAdd}
        </Button>
      }
    >
      <div className="flex items-center gap-2.5 rounded-ctl border border-line bg-surface px-3 text-ink-3 focus-within:outline-2 focus-within:outline-offset-0 focus-within:outline-accent [&_input]:min-h-11.5 [&_input]:min-w-0 [&_input]:flex-1 [&_input]:bg-transparent [&_input]:px-0.5 [&_input]:py-px [&_input]:text-input [&_input]:text-ink [&_input]:outline-none">
        <Icon name="search" size={19} />
        <label className="sr-only" htmlFor="food-search">
          {copy.sheet.search}
        </label>
        <input
          id="food-search"
          type="search"
          autoFocus
          autoComplete="off"
          enterKeyHint="search"
          placeholder={copy.sheet.searchPlaceholder}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      {note ? (
        <p className="mt-2.5 text-meta text-ink-2" role="status">
          {note}
        </p>
      ) : null}

      {showEmpty ? (
        <>
          <Section title={copy.sheet.recent}>
            {(recents ?? []).map((r) => (
              <FoodRow
                key={r.food.id}
                food={r.food}
                onOpen={() => ui.open({ kind: "product", food: r.food, meal, date })}
                onAdd={() => void quickLog(r)}
              />
            ))}
          </Section>
          <Section title={copy.sheet.favorites}>
            {(favorites ?? []).map((r) => (
              <FoodRow
                key={r.food.id}
                food={r.food}
                onOpen={() => ui.open({ kind: "product", food: r.food, meal, date })}
                onAdd={() => void quickLog(r)}
              />
            ))}
          </Section>
          <Section title={copy.sheet.savedMeals}>
            {(meals ?? []).map((m) => (
              <div key={m.meal.id} className={row}>
                <span className={rowText}>
                  <strong>{m.meal.name}</strong>
                  <span>{`${m.count} ${m.count === 1 ? "item" : "items"} · ${formatKcal(m.kcal)} kcal`}</span>
                </span>
                <button
                  type="button"
                  className={rowPlus}
                  aria-label={`Add ${m.meal.name} to ${copy.meals[meal].toLowerCase()}`}
                  onClick={() =>
                    void logSavedMeal(m.meal.id, m.meal.name, date, meal).then(() => {
                      ui.closeAll();
                      void navigate("/today");
                    })
                  }
                >
                  <Icon name="plus" size={19} />
                </button>
              </div>
            ))}
          </Section>
          {(recents ?? []).length + (favorites ?? []).length + (meals ?? []).length === 0 ? (
            <p className="mt-4 text-label text-ink-2">
              Search a food, or add calories without a label.
            </p>
          ) : null}
        </>
      ) : (
        <ul className="mt-2" aria-label={copy.sheet.results} aria-busy={opening}>
          {results.map((h) => (
            <li key={h.key}>
              <button type="button" className={row} onClick={() => void open(h)}>
                <span className={rowText}>
                  <strong>{h.name}</strong>
                  <span>{h.brand || "No brand"}</span>
                </span>
                <span className={rowKcal}>
                  {formatKcal(h.kcal)}
                  <small> kcal / 100 g</small>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {noMatch ? (
        <EmptyState title={copy.sheet.noMatch}>
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
        </EmptyState>
      ) : null}
    </Sheet>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode[] }) {
  if (children.length === 0) return null;
  return (
    <section className="mt-4.5 [&_h3]:border-b-[1.5px] [&_h3]:border-ink [&_h3]:pb-1 [&_h3]:text-body [&_h3]:font-semibold">
      <h3>{title}</h3>
      {children}
    </section>
  );
}

function FoodRow({ food, onOpen, onAdd }: { food: Food; onOpen: () => void; onAdd: () => void }) {
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
      <button
        type="button"
        className={rowPlus}
        aria-label={`Add ${food.name} again`}
        onClick={onAdd}
      >
        <Icon name="plus" size={19} />
      </button>
    </div>
  );
}
