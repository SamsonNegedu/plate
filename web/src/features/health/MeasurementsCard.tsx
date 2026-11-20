import type { CircumferenceKind } from "@/db/types";
import { shortLabel } from "@/lib/dates";
import { MEASURES, type MeasureSummary } from "@/lib/health";
import { formatGrams } from "@/lib/numbers";

const labelOf = (k: CircumferenceKind) => MEASURES.find((m) => m.kind === k)?.label ?? k;

function signed(n: number): string {
  if (n < 0) return `−${formatGrams(-n)}`;
  return `${n > 0 ? "+" : ""}${formatGrams(n)}`;
}

/**
 * Body measurements beyond weight. Only the ones the person has logged are listed, so the page stays quiet for someone who
 * tracks nothing but weight, and one button adds any of them.
 */
export function MeasurementsCard({
  summaries,
  onEdit,
}: {
  summaries: MeasureSummary[];
  onEdit: (kind: CircumferenceKind) => void;
}) {
  return (
    <section aria-labelledby="measures-h" className="grid gap-2">
      <h2 id="measures-h" className="border-b-[1.5px] border-ink pb-1.5 text-section font-semibold">
        Measurements
      </h2>
      {summaries.length === 0 ? (
        <p className="text-body text-ink-2">
          Waist, hips, chest, arm, thigh or neck. Log one when you measure; only the ones you use
          appear here.
        </p>
      ) : (
        <ul aria-label="Body measurements">
          {summaries.map((m) => (
            <li key={m.kind} className="border-b border-line">
              <button
                type="button"
                className="flex min-h-14 w-full items-center gap-2.5 bg-transparent text-left text-ink"
                onClick={() => onEdit(m.kind)}
                aria-label={`${labelOf(m.kind)}, ${formatGrams(m.latest.value)} cm. Log another`}
              >
                <span className="grid min-w-0 flex-1 gap-px">
                  <strong className="text-body font-medium">{labelOf(m.kind)}</strong>
                  <span className="truncate text-meta text-ink-2">
                    {m.count > 1
                      ? `${signed(m.changeCm)} cm since ${shortLabel(m.first.recordedOn)}`
                      : `Logged ${shortLabel(m.latest.recordedOn)}`}
                  </span>
                </span>
                <span className="text-body font-semibold whitespace-nowrap">
                  {formatGrams(m.latest.value)}
                  <small className="text-micro font-normal text-ink-2"> cm</small>
                </span>
                <span className="text-glyph text-ink-3" aria-hidden="true">
                  ›
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
