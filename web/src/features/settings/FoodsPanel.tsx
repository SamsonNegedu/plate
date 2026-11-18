import { Button } from "@/components/Button";
import { useDb } from "@/db/context";
import { setFavorite } from "@/db/favorites";
import { deleteCustomFood } from "@/db/foods";
import { useCustomFoods, useFavoriteFoods, useSavedMeals } from "@/db/hooks";
import { deleteMeal } from "@/db/savedMeals";
import { defaultMeal, logicalDate } from "@/lib/dates";
import { formatKcal } from "@/lib/numbers";
import { useUi } from "@/lib/ui";
import styles from "./Settings.module.css";

/** Favorites, saved meals and custom foods. Deleting a custom food never touches entries already logged. */
export function FoodsPanel({ dayStartHour }: { dayStartHour: number }) {
  const db = useDb();
  const ui = useUi();
  const favorites = useFavoriteFoods() ?? [];
  const meals = useSavedMeals() ?? [];
  const foods = useCustomFoods() ?? [];
  const date = logicalDate(new Date(), dayStartHour);
  const meal = defaultMeal(new Date());

  return (
    <section className={styles.section} aria-labelledby="foods-h">
      <h2 id="foods-h">Foods and meals</h2>

      <h3 className={styles.hint}>Favorites</h3>
      {favorites.length === 0 ? (
        <p className={styles.muted}>Star a food to pin it above your search results.</p>
      ) : (
        <ul className={styles.list}>
          {favorites.map((r) => (
            <li key={r.food.id} className={styles.item}>
              <span>
                <strong>{r.food.name}</strong>
                <small>{r.food.brand || "No brand"}</small>
              </span>
              <button
                type="button"
                className={styles.small}
                onClick={() => void setFavorite(db, r.food.id, false)}
              >
                Unfavorite
              </button>
            </li>
          ))}
        </ul>
      )}

      <h3 className={styles.hint}>Saved meals</h3>
      {meals.length === 0 ? (
        <p className={styles.muted}>
          On Today, choose "Save as meal" under a meal to keep it here.
        </p>
      ) : (
        <ul className={styles.list}>
          {meals.map((m) => (
            <li key={m.meal.id} className={styles.item}>
              <span>
                <strong>{m.meal.name}</strong>
                <small>{`${m.count} ${m.count === 1 ? "item" : "items"} · ${formatKcal(m.kcal)} kcal`}</small>
              </span>
              <button
                type="button"
                className={`${styles.small} ${styles.dangerSmall}`}
                onClick={() => void deleteMeal(db, m.meal.id)}
                aria-label={`Delete ${m.meal.name}`}
              >
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}

      <h3 className={styles.hint}>Custom foods</h3>
      {foods.length === 0 ? (
        <p className={styles.muted}>Foods you add or correct by hand appear here.</p>
      ) : (
        <ul className={styles.list}>
          {foods.map((f) => (
            <li key={f.id} className={styles.item}>
              <span>
                <strong>{f.name}</strong>
                <small>
                  {[f.barcode, `${formatKcal(f.kcal)} kcal / 100 g`].filter(Boolean).join(" · ")}
                </small>
              </span>
              <button
                type="button"
                className={styles.small}
                onClick={() => ui.open({ kind: "manual", meal, date, barcode: f.barcode, food: f })}
              >
                Edit
              </button>
              <button
                type="button"
                className={`${styles.small} ${styles.dangerSmall}`}
                onClick={() => void deleteCustomFood(db, f.id)}
                aria-label={`Delete ${f.name}`}
              >
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className={styles.actions}>
        <Button onClick={() => ui.open({ kind: "manual", meal, date, barcode: null })}>
          Add a food
        </Button>
      </div>
    </section>
  );
}
