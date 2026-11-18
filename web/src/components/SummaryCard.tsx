import { copy } from "@/lib/copy";
import { formatKcal } from "@/lib/numbers";
import { type DayTotals, meterFill } from "@/lib/nutrition";
import { MacroBar } from "./MacroBar";
import { Meter } from "./Meter";
import styles from "./SummaryCard.module.css";

interface Props {
  totals: DayTotals;
  goalKcal: number;
  targets: { protein: number; carbs: number; fat: number };
}

export function SummaryCard({ totals, goalKcal, targets }: Props) {
  const eaten = Math.round(totals.kcal);
  const { fill, over, left } = meterFill(eaten, goalKcal);
  return (
    <section className={styles.card} aria-label="Day summary">
      <div className={styles.top}>
        <div>
          <p className={`${styles.big} ${over ? styles.overText : ""}`}>{formatKcal(left)}</p>
          <p className={styles.cap}>
            kcal {over ? copy.today.over : copy.today.left}
            {over ? (
              <span className="srOnly">{` of your ${formatKcal(goalKcal)} goal`}</span>
            ) : null}
          </p>
        </div>
        <dl className={styles.side}>
          <div>
            <dt>{copy.today.eaten}</dt>
            <dd>{formatKcal(eaten)}</dd>
          </div>
          <div>
            <dt>{copy.today.goal}</dt>
            <dd>{formatKcal(goalKcal)}</dd>
          </div>
        </dl>
      </div>
      <Meter
        fill={fill}
        over={over}
        label={
          over
            ? `Over goal by ${formatKcal(left)} kcal`
            : `${formatKcal(left)} kcal left of ${formatKcal(goalKcal)}`
        }
      />
      {totals.count > 0 ? (
        <>
          <div className={styles.macros}>
            <MacroBar label="Protein" value={totals.protein} target={targets.protein} />
            <MacroBar label="Carbs" value={totals.carbs} target={targets.carbs} />
            <MacroBar label="Fat" value={totals.fat} target={targets.fat} />
            <MacroBar label="Fibre" value={totals.fiber} target={0} />
          </div>
        </>
      ) : null}
      {totals.missing.length > 0 ? <p className={styles.note}>{copy.today.missingMacros}</p> : null}
    </section>
  );
}
