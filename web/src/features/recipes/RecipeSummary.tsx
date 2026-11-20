import { formatGrams, formatKcal, formatOptional } from "@/lib/numbers";
import { ingredientShares, NUTRIENT_NAME, type RecipeNutrition } from "@/lib/recipe";
import type { DraftItem } from "./draft";

type Row = { label: string; sub?: boolean; kcal?: boolean; key: keyof RecipeNutrition["per100"] };

const ROWS: Row[] = [
  { label: "Energy", key: "kcal", kcal: true },
  { label: "Fat", key: "fat" },
  { label: "of which saturates", key: "satfat", sub: true },
  { label: "Carbohydrate", key: "carbs" },
  { label: "of which sugars", key: "sugar", sub: true },
  { label: "Fibre", key: "fiber" },
  { label: "Protein", key: "protein" },
  { label: "Salt", key: "salt" },
];

/** The recipe as a nutrition label, plus which ingredients its calories come from. */
export function RecipeSummary({
  nutrition,
  servings,
  items,
}: {
  nutrition: RecipeNutrition;
  servings: number;
  items: DraftItem[];
}) {
  if (items.length === 0) {
    return <p className="py-2 text-body text-ink-2">Add an ingredient to see the nutrition.</p>;
  }
  const shares = ingredientShares(items);
  const cell = (v: number | null, r: Row) =>
    r.kcal ? `${formatKcal(v ?? 0)} kcal` : formatOptional(v, " g");
  return (
    <section aria-label="Nutrition" className="grid gap-4">
      <table className="w-full border-collapse text-label [&_td]:border-b [&_td]:border-line [&_td]:py-1.75 [&_td]:text-right [&_td]:font-medium [&_th]:border-b [&_th]:border-line [&_th]:py-1.75 [&_th]:text-left [&_th]:font-normal [&_thead_th]:border-ink [&_thead_th]:pb-1.5 [&_thead_th]:text-right [&_thead_th]:font-semibold [&_thead_th:first-child]:text-left">
        <caption className="sr-only">Nutrition per portion and per 100 g</caption>
        <thead>
          <tr>
            <th scope="col">
              <span className="sr-only">Nutrient</span>
            </th>
            <th scope="col">Per portion</th>
            <th scope="col">Per 100 g</th>
          </tr>
        </thead>
        <tbody>
          {ROWS.map((r) => (
            <tr key={r.key} className={r.sub ? "[&_th]:pl-3.5 [&_th]:text-ink-2" : undefined}>
              <th scope="row">{r.label}</th>
              <td>{cell(nutrition.portion[r.key], r)}</td>
              <td>{cell(nutrition.per100[r.key], r)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="-mt-2 text-meta text-ink-2">
        {`${formatKcal(nutrition.total.kcal)} kcal in total across ${servings === 1 ? "1 portion" : `${formatGrams(servings)} portions`}, about ${formatKcal(nutrition.portionGrams)} g each.`}
      </p>
      {nutrition.partial.length > 0 ? (
        <p className="-mt-2 text-meta text-ink-2" role="status">
          {`Some ingredients do not report ${nutrition.partial.map((k) => NUTRIENT_NAME[k]).join(", ")}, so those are a minimum.`}
        </p>
      ) : null}
      <div>
        <h3 className="mb-1 border-b-[1.5px] border-ink pb-1 text-label font-semibold">
          Where the calories come from
        </h3>
        <ol>
          {shares.map((s) => (
            <li key={s.item.key} className="py-1">
              <div className="flex gap-2 text-meta">
                <span className="min-w-0 flex-1 truncate">{s.item.name}</span>
                <span className="text-ink-2">{`${Math.round(s.share * 100)}%`}</span>
                <span className="min-w-[72px] text-right font-semibold">
                  {formatKcal(s.kcal)} kcal
                </span>
              </div>
              <span
                className="mt-1 block h-[3px] overflow-hidden rounded-pill bg-surface-2"
                aria-hidden="true"
              >
                <i
                  className="block h-full bg-ink-3"
                  style={{ width: `${Math.round(s.share * 100)}%` }}
                />
              </span>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
