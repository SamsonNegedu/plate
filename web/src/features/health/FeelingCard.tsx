import type { HealthKind, HealthRecord } from "@/db/types";
import { haptic } from "@/features/scan/feedback";
import { ratingFor } from "@/lib/health";

const LEVELS: Record<"appetite" | "nausea", string[]> = {
  appetite: ["None", "Low", "Some", "Normal", "Strong", "Very strong"],
  nausea: ["None", "Mild", "Some", "Noticeable", "Strong", "Severe"],
};

const NAMES = { appetite: "Appetite", nausea: "Nausea" } as const;

/** Two quick taps for today: how hungry, how nauseous. The chosen word sits beside the label, so there is no extra line. */
export function FeelingCard({
  records,
  today,
  onRate,
}: {
  records: HealthRecord[];
  today: string;
  onRate: (kind: Extract<HealthKind, "appetite" | "nausea">, value: number) => void;
}) {
  return (
    <section aria-labelledby="feel-h" className="grid gap-3">
      <h2 id="feel-h" className="border-b-[1.5px] border-ink pb-1.5 text-section font-semibold">
        How you feel today
      </h2>
      {(["appetite", "nausea"] as const).map((kind) => {
        const current = ratingFor(records, kind, today);
        return (
          <div key={kind} className="grid gap-1">
            <p className="flex items-baseline gap-2" id={`${kind}-label`}>
              <span className="text-label font-medium">{NAMES[kind]}</span>
              <span className="text-meta text-ink-2">
                {current === null ? "Not rated · 0 is none, 5 the most" : LEVELS[kind][current]}
              </span>
            </p>
            <div className="flex gap-1" role="group" aria-labelledby={`${kind}-label`}>
              {[0, 1, 2, 3, 4, 5].map((v) => (
                <button
                  key={v}
                  type="button"
                  aria-pressed={current === v}
                  aria-label={`${NAMES[kind]} ${v} of 5, ${LEVELS[kind][v]}`}
                  className="min-h-12 flex-1 rounded-lg border border-line bg-surface text-label font-medium text-ink-2 aria-pressed:border-ink aria-pressed:bg-surface-2 aria-pressed:text-ink"
                  onClick={() => {
                    haptic(15);
                    onRate(kind, v);
                  }}
                >
                  {v}
                </button>
              ))}
            </div>
          </div>
        );
      })}
    </section>
  );
}
