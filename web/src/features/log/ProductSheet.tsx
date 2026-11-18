import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/Button";
import { Icon } from "@/components/Icon";
import { Segmented } from "@/components/Segmented";
import { Sheet } from "@/components/Sheet";
import { useDb } from "@/db/context";
import { setFavorite } from "@/db/favorites";
import { getPref } from "@/db/foods";
import { useFavoriteIds } from "@/db/hooks";
import type { Food, Meal, Unit } from "@/db/types";
import { MEALS } from "@/db/types";
import { cn } from "@/lib/cn";
import { copy } from "@/lib/copy";
import { formatKcal, formatOptional, parseDecimal } from "@/lib/numbers";
import { amountLabel, gramsFor, MAX_GRAMS, portionOf } from "@/lib/nutrition";
import { useUi } from "@/lib/ui";
import { isLiquid, packSize, startingPortion, stepFor } from "./portion";
import { useLog } from "./useLog";

interface Props {
  food: Food;
  meal: Meal;
  date: string;
  notice?: string | undefined;
}

const sourceNotes: Partial<Record<Food["source"], string>> = {
  off: copy.sheet.fromOff,
  catalog: copy.sheet.fromCatalog,
  user: copy.sheet.custom,
};

function amountError(amount: number | null, grams: number | null): string | undefined {
  if (amount === null) return "Enter an amount, like 100 or 1,5.";
  if (grams === null) return "Enter an amount above zero.";
  return grams > MAX_GRAMS ? `That is more than ${MAX_GRAMS} g.` : undefined;
}

const scoreBorder: Record<string, string> = {
  a: "[&_b]:border-accent",
  b: "[&_b]:border-accent",
  c: "[&_b]:border-amber",
  d: "[&_b]:border-red",
  e: "[&_b]:border-red",
};

export function ProductSheet({ food, meal: initialMeal, date, notice }: Props) {
  const db = useDb();
  const { logFood } = useLog();
  const ui = useUi();
  const favorites = useFavoriteIds();
  const start = useMemo(() => startingPortion(food), [food]);
  const [unit, setUnit] = useState<Unit>(start.unit);
  const [text, setText] = useState(String(start.amount));
  const [meal, setMeal] = useState<Meal>(initialMeal);
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    void getPref(db, food.id)
      .then((p) => {
        if (!alive || !p || touched) return;
        const s = startingPortion(food, p);
        setUnit(s.unit);
        setText(String(s.amount));
      })
      .catch(() => undefined); // the preference is a convenience; a closed database must not surface as an error
    return () => {
      alive = false;
    };
  }, [db, food, touched]);

  const liquid = isLiquid(food);
  const units: Unit[] = [
    "g",
    ...(liquid ? (["ml"] as const) : []),
    ...(food.servingGrams ? (["serving"] as const) : []),
  ];
  const amount = parseDecimal(text);
  const grams = amount === null ? null : gramsFor(amount, unit, food.servingGrams);
  const error = amountError(amount, grams);
  const portion = grams !== null && !error ? portionOf(food, grams) : null;
  const pack = packSize(food);
  const isFav = favorites.has(food.id);

  const set = (u: Unit, a: number) => {
    setTouched(true);
    setUnit(u);
    setText(String(Math.round(a * 100) / 100));
  };

  const step = (dir: 1 | -1) => {
    const cur = amount ?? 0;
    const next = Math.max(0, Math.round((cur + dir * stepFor(unit, cur)) * 100) / 100);
    setTouched(true);
    setText(String(next));
  };

  const add = async () => {
    if (amount === null || error) return;
    setBusy(true);
    try {
      await logFood(food, { amount, unit, meal, date, goToday: true });
      ui.closeAll();
    } finally {
      setBusy(false);
    }
  };

  const mealLabel = copy.meals[meal].toLowerCase();
  const sourceNote = sourceNotes[food.source] ?? null;

  return (
    <Sheet
      title={food.name}
      description={[food.brand, food.quantity].filter(Boolean).join(" · ") || undefined}
      onClose={ui.close}
      footer={
        <Button
          variant="primary"
          block
          onClick={() => void add()}
          busy={busy}
          disabled={Boolean(error)}
        >
          {`Add to ${mealLabel}`}
        </Button>
      }
    >
      <div className="flex items-center gap-3">
        <span className="grid size-16 flex-none place-items-center overflow-hidden rounded-ctl bg-surface-2 text-ink-3 [&_img]:size-full [&_img]:object-contain">
          {food.imagePath ? (
            <img src={food.imagePath} alt="" loading="lazy" />
          ) : (
            <Icon name="bottle" size={26} />
          )}
        </span>
        <div className="grid min-w-0 flex-1 gap-1">
          {food.barcode ? <span className="text-meta text-ink-2">{food.barcode}</span> : null}
          {food.nutriscore ? (
            <span
              className={cn(
                "text-meta text-ink-2 [&_b]:ml-1 [&_b]:inline-grid [&_b]:h-5.5 [&_b]:min-w-5.5 [&_b]:place-items-center [&_b]:rounded-md [&_b]:border-[1.5px] [&_b]:font-semibold [&_b]:text-ink",
                scoreBorder[food.nutriscore],
              )}
            >
              Nutri-Score <b>{food.nutriscore.toUpperCase()}</b>
            </span>
          ) : null}
        </div>
        <button
          type="button"
          className="grid size-11 place-items-center bg-transparent text-ink-3 aria-pressed:text-amber aria-pressed:[&_svg]:fill-current"
          aria-pressed={isFav}
          aria-label={isFav ? "Remove from favorites" : "Add to favorites"}
          onClick={() => void setFavorite(db, food.id, !isFav)}
        >
          <Icon name="star" />
        </button>
      </div>

      {notice ? (
        <p
          className="mt-3 rounded-ctl border border-line bg-surface-2 px-3 py-2.5 text-meta text-ink-2 [&_a]:font-medium [&_a]:text-ink"
          role="status"
        >
          {notice}
          {food.barcode ? (
            <>
              {" "}
              <a
                href={`https://world.openfoodfacts.org/cgi/product.pl?type=search_or_add&code=${encodeURIComponent(food.barcode)}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                Add to Open Food Facts
              </a>
            </>
          ) : null}
        </p>
      ) : null}

      <section aria-label="Portion" className="mt-4 grid gap-2.5">
        <Segmented
          label="Unit"
          value={unit}
          options={units.map((u) => ({ value: u, label: u === "serving" ? "Portion" : u }))}
          onChange={(u) => set(u, u === "serving" ? 1 : 100)}
        />
        <div className="flex items-center gap-2 [&>button]:grid [&>button]:size-12 [&>button]:flex-none [&>button]:place-items-center [&>button]:rounded-ctl [&>button]:border [&>button]:border-line [&>button]:bg-surface [&>button]:text-ink">
          <button type="button" onClick={() => step(-1)} aria-label="Decrease amount">
            <Icon name="minus" />
          </button>
          <label className="flex-1 [&_input]:min-h-12 [&_input]:w-full [&_input]:rounded-ctl [&_input]:border [&_input]:border-line [&_input]:bg-surface [&_input]:text-center [&_input]:font-display [&_input]:text-wordmark [&_input]:font-semibold [&_input[aria-invalid=true]]:border-red">
            <span className="sr-only">{copy.sheet.amount}</span>
            <input
              inputMode="decimal"
              value={text}
              onChange={(e) => {
                setTouched(true);
                setText(e.target.value);
              }}
              aria-invalid={error ? true : undefined}
              aria-describedby="amount-help"
            />
          </label>
          <button type="button" onClick={() => step(1)} aria-label="Increase amount">
            <Icon name="plus" />
          </button>
        </div>
        <p
          id="amount-help"
          className={cn("-mt-0.5 min-h-5 text-center text-meta", error ? "text-red" : "text-ink-2")}
          role={error ? "alert" : undefined}
        >
          {error ??
            (unit !== "g" && unit !== "ml" && grams !== null
              ? `${amountLabel(amount ?? 0, unit)} · ${Math.round(grams * 10) / 10} g`
              : " ")}
        </p>
        <div className="flex flex-wrap gap-1.5 [&>button]:min-h-9.5 [&>button]:rounded-pill [&>button]:border [&>button]:border-line [&>button]:bg-surface [&>button]:px-3 [&>button]:text-meta [&>button]:text-ink">
          {food.servingGrams ? (
            <>
              <button type="button" onClick={() => set("serving", 1)}>
                1 portion
              </button>
              <button type="button" onClick={() => set("serving", 2)}>
                2 portions
              </button>
            </>
          ) : null}
          <button type="button" onClick={() => set(liquid ? "ml" : "g", 100)}>
            {liquid ? "100 ml" : "100 g"}
          </button>
          {pack ? (
            <button type="button" onClick={() => set(pack.unit, pack.amount)}>
              Whole pack
            </button>
          ) : null}
        </div>
      </section>

      <p
        className="mt-3.5 text-body text-ink-2 [&_b]:font-display [&_b]:text-total [&_b]:font-semibold [&_b]:text-ink"
        aria-live="polite"
      >
        <b>{portion ? formatKcal(portion.kcal) : "—"}</b> kcal
        {portion ? (
          <span>
            {" · "}P {formatOptional(portion.protein, " g")} · C{" "}
            {formatOptional(portion.carbs, " g")} · F {formatOptional(portion.fat, " g")}
          </span>
        ) : null}
      </p>

      <div className="mt-3.5">
        <Segmented
          label={copy.sheet.meal}
          value={meal}
          options={MEALS.map((m) => ({ value: m, label: copy.meals[m] }))}
          onChange={setMeal}
        />
      </div>

      <table className="mt-4.5 w-full border-collapse text-label [&_caption]:border-b-[1.5px] [&_caption]:border-ink [&_caption]:pb-1.5 [&_caption]:text-left [&_caption]:font-semibold [&_td]:border-b [&_td]:border-line [&_td]:py-1.75 [&_td]:text-right [&_td]:font-medium [&_th]:border-b [&_th]:border-line [&_th]:py-1.75 [&_th]:text-left [&_th]:font-normal">
        <caption>{copy.sheet.nutrition}</caption>
        <tbody>
          <tr>
            <th scope="row">Energy</th>
            <td>{formatKcal(food.kcal)} kcal</td>
          </tr>
          <tr>
            <th scope="row">Fat</th>
            <td>{formatOptional(food.fat, " g")}</td>
          </tr>
          <tr className="[&_th]:pl-3.5 [&_th]:text-ink-2">
            <th scope="row">of which saturates</th>
            <td>{formatOptional(food.satfat, " g")}</td>
          </tr>
          <tr>
            <th scope="row">Carbohydrate</th>
            <td>{formatOptional(food.carbs, " g")}</td>
          </tr>
          <tr className="[&_th]:pl-3.5 [&_th]:text-ink-2">
            <th scope="row">of which sugars</th>
            <td>{formatOptional(food.sugar, " g")}</td>
          </tr>
          <tr>
            <th scope="row">Fibre</th>
            <td>{formatOptional(food.fiber, " g")}</td>
          </tr>
          <tr>
            <th scope="row">Protein</th>
            <td>{formatOptional(food.protein, " g")}</td>
          </tr>
          <tr>
            <th scope="row">Salt</th>
            <td>{formatOptional(food.salt, " g")}</td>
          </tr>
        </tbody>
      </table>

      <div className="mt-3 grid gap-1">
        {sourceNote ? (
          <p className="text-meta text-ink-2">
            {sourceNote}
            {food.sourceCheckedAt
              ? ` ${copy.sheet.checked} ${new Date(food.sourceCheckedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}.`
              : ""}
            {food.stale ? ` ${copy.sheet.stale}` : ""}
          </p>
        ) : null}
        <Button
          variant="ghost"
          onClick={() => ui.replace({ kind: "manual", meal, date, barcode: food.barcode, food })}
        >
          {copy.sheet.editNutrition}
        </Button>
        {food.barcode && food.source !== "user" ? (
          <a
            className="inline-flex min-h-11 items-center text-label text-ink-2"
            href={`https://world.openfoodfacts.org/product/${encodeURIComponent(food.barcode)}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            {copy.sheet.viewOff}
          </a>
        ) : null}
      </div>
    </Sheet>
  );
}
