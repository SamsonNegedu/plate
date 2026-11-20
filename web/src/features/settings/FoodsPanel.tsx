import { Button } from "@/components/Button";
import { useDb } from "@/db/context";
import { setFavorite } from "@/db/favorites";
import { deleteCustomFood } from "@/db/foods";
import { useCustomFoods, useFavoriteFoods, useSavedMeals } from "@/db/hooks";
import { deleteMeal } from "@/db/savedMeals";
import { defaultMeal, logicalDate } from "@/lib/dates";
import { formatKcal } from "@/lib/numbers";
import { useUi } from "@/lib/ui";
import { useNow } from "@/lib/useNow";
import { cls, smallBtn } from "./ui";

/** Favorites, saved meals and custom foods. Deleting a custom food never touches entries already logged. */
export function FoodsPanel({ dayStartHour }: { dayStartHour: number }) {
  const db = useDb();
  const ui = useUi();
  const favorites = useFavoriteFoods() ?? [];
  const meals = useSavedMeals() ?? [];
  const foods = useCustomFoods() ?? [];
  const now = useNow();
  const date = logicalDate(now, dayStartHour);
  const meal = defaultMeal(now);
  const nothingSaved = favorites.length + meals.length + foods.length === 0;

  return (
    <section className={cls.section} aria-labelledby="foods-h">
      <h2 id="foods-h">Foods and meals</h2>

      {nothingSaved ? (
        <p className={cls.muted}>
          Nothing here yet. Star foods to pin them in search, save a meal from Today, or add your
          own foods.
        </p>
      ) : null}

      {favorites.length > 0 ? (
        <>
          <h3 className={cls.hint}>Favorites</h3>
          <ul>
            {favorites.map((r) => (
              <li key={r.food.id} className={cls.item}>
                <span>
                  <strong>{r.food.name}</strong>
                  <small>{r.food.brand || "No brand"}</small>
                </span>
                <button
                  type="button"
                  className={smallBtn()}
                  onClick={() => void setFavorite(db, r.food.id, false)}
                >
                  Unfavorite
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : null}

      {meals.length > 0 ? (
        <>
          <h3 className={cls.hint}>Saved meals</h3>
          <ul>
            {meals.map((m) => (
              <li key={m.meal.id} className={cls.item}>
                <span>
                  <strong>{m.meal.name}</strong>
                  <small>{`${m.count} ${m.count === 1 ? "item" : "items"} · ${formatKcal(m.kcal)} kcal`}</small>
                </span>
                <button
                  type="button"
                  className={smallBtn(true)}
                  onClick={() => void deleteMeal(db, m.meal.id)}
                  aria-label={`Delete ${m.meal.name}`}
                >
                  Delete
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : null}

      {foods.length > 0 ? (
        <>
          <h3 className={cls.hint}>Custom foods</h3>
          <ul>
            {foods.map((f) => (
              <li key={f.id} className={cls.item}>
                <span>
                  <strong>{f.name}</strong>
                  <small>
                    {[f.barcode, `${formatKcal(f.kcal)} kcal / 100 g`].filter(Boolean).join(" · ")}
                  </small>
                </span>
                <button
                  type="button"
                  className={smallBtn()}
                  onClick={() =>
                    ui.open({ kind: "manual", meal, date, barcode: f.barcode, food: f })
                  }
                >
                  Edit
                </button>
                <button
                  type="button"
                  className={smallBtn(true)}
                  onClick={() => void deleteCustomFood(db, f.id)}
                  aria-label={`Delete ${f.name}`}
                >
                  Delete
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : null}

      <div className={cls.actions}>
        <Button onClick={() => ui.open({ kind: "manual", meal, date, barcode: null })}>
          Add a food
        </Button>
      </div>
    </section>
  );
}
