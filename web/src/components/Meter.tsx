import styles from "./Meter.module.css";

/** Calories against the goal. The fill caps at 100 percent; over goal turns red and the text says "over". */
export function Meter({ fill, over, label }: { fill: number; over: boolean; label: string }) {
  return (
    <div
      className={styles.meter}
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(fill * 100)}
    >
      <i
        className={over ? styles.over : styles.fill}
        style={{ width: `${Math.round(fill * 100)}%` }}
      />
    </div>
  );
}
