import { formatKcal } from "@/lib/numbers";
import type { TopFood } from "./stats";

interface Props {
  foods: TopFood[];
  /** Share of all calories the listed foods make up, 0 to 1. */
  coverage: number;
  days: number;
}

/** The few foods that supply most of the calories in the range. */
export function TopFoods({ foods, coverage, days }: Props) {
  if (foods.length === 0) return null;
  return (
    <section aria-labelledby="top-foods" className="grid grid-cols-[minmax(0,1fr)] gap-1.5">
      <h2 id="top-foods" className="text-section font-semibold">
        Top foods
      </h2>
      <p className="text-label text-ink-2">
        {`${foods.length === 1 ? "This food made" : `These ${foods.length} foods made`} up ${Math.round(coverage * 100)}% of your calories in the last ${days} days.`}
      </p>
      <ol>
        {foods.map((f) => (
          <li key={f.key} className="border-b border-line py-2">
            <div className="flex items-baseline gap-2">
              <span className="min-w-0 flex-1 truncate text-body">{f.name}</span>
              <span className="text-meta text-ink-2">{`${f.times}×`}</span>
              <span className="min-w-[84px] text-right text-body font-semibold">
                {formatKcal(f.kcal)} kcal
              </span>
            </div>
            <div className="mt-1.5 flex items-center gap-2">
              <span
                className="block h-[3px] flex-1 overflow-hidden rounded-pill bg-surface-2"
                aria-hidden="true"
              >
                <i
                  className="block h-full bg-ink-3"
                  style={{ width: `${Math.round(f.share * 100)}%` }}
                />
              </span>
              <span className="text-micro text-ink-2">{`${Math.round(f.share * 100)}% of calories`}</span>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
