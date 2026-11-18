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
import { copy } from "@/lib/copy";
import { formatKcal, formatOptional, parseDecimal } from "@/lib/numbers";
import { amountLabel, gramsFor, MAX_GRAMS, portionOf } from "@/lib/nutrition";
import { useUi } from "@/lib/ui";
import styles from "./ProductSheet.module.css";
import { isLiquid, packSize, startingPortion, stepFor } from "./portion";
import { useLog } from "./useLog";

interface Props {
  food: Food;
  meal: Meal;
  date: string;
  notice?: string | undefined;
}

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
  const error =
    amount === null
      ? "Enter an amount, like 100 or 1,5."
      : grams === null
        ? "Enter an amount above zero."
        : grams > MAX_GRAMS
          ? `That is more than ${MAX_GRAMS} g.`
          : undefined;
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
  const sourceNote =
    food.source === "off"
      ? copy.sheet.fromOff
      : food.source === "catalog"
        ? copy.sheet.fromCatalog
        : food.source === "user"
          ? copy.sheet.custom
          : null;

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
      <div className={styles.top}>
        <span className={styles.img}>
          {food.imagePath ? (
            <img src={food.imagePath} alt="" loading="lazy" />
          ) : (
            <Icon name="bottle" size={26} />
          )}
        </span>
        <div className={styles.facts}>
          {food.barcode ? <span className={styles.meta}>{food.barcode}</span> : null}
          {food.nutriscore ? (
            <span className={`${styles.score} ${styles[`s${food.nutriscore}`]}`}>
              Nutri-Score <b>{food.nutriscore.toUpperCase()}</b>
            </span>
          ) : null}
        </div>
        <button
          type="button"
          className={styles.star}
          aria-pressed={isFav}
          aria-label={isFav ? "Remove from favorites" : "Add to favorites"}
          onClick={() => void setFavorite(db, food.id, !isFav)}
        >
          <Icon name="star" />
        </button>
      </div>

      {notice ? (
        <p className={styles.notice} role="status">
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

      <section aria-label="Portion" className={styles.portion}>
        <Segmented
          label="Unit"
          value={unit}
          options={units.map((u) => ({ value: u, label: u === "serving" ? "Portion" : u }))}
          onChange={(u) => set(u, u === "serving" ? 1 : 100)}
        />
        <div className={styles.stepper}>
          <button type="button" onClick={() => step(-1)} aria-label="Decrease amount">
            <Icon name="minus" />
          </button>
          <label className={styles.amount}>
            <span className="srOnly">{copy.sheet.amount}</span>
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
          className={error ? styles.error : styles.help}
          role={error ? "alert" : undefined}
        >
          {error ??
            (unit !== "g" && unit !== "ml" && grams !== null
              ? `${amountLabel(amount ?? 0, unit)} · ${Math.round(grams * 10) / 10} g`
              : " ")}
        </p>
        <div className={styles.presets}>
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

      <p className={styles.total} aria-live="polite">
        <b>{portion ? formatKcal(portion.kcal) : "—"}</b> kcal
        {portion ? (
          <span>
            {" · "}P {formatOptional(portion.protein, " g")} · C{" "}
            {formatOptional(portion.carbs, " g")} · F {formatOptional(portion.fat, " g")}
          </span>
        ) : null}
      </p>

      <div className={styles.meal}>
        <Segmented
          label={copy.sheet.meal}
          value={meal}
          options={MEALS.map((m) => ({ value: m, label: copy.meals[m] }))}
          onChange={setMeal}
        />
      </div>

      <table className={styles.label}>
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
          <tr className={styles.sub}>
            <th scope="row">of which saturates</th>
            <td>{formatOptional(food.satfat, " g")}</td>
          </tr>
          <tr>
            <th scope="row">Carbohydrate</th>
            <td>{formatOptional(food.carbs, " g")}</td>
          </tr>
          <tr className={styles.sub}>
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

      <div className={styles.links}>
        {sourceNote ? (
          <p className={styles.source}>
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
            className={styles.ext}
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
