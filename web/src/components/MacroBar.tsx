import styles from "./MacroBar.module.css";

interface Props {
  label: string;
  /** null means no entry reported it: shown as a dash, never a zero. */
  value: number | null;
  target: number;
}

export function MacroBar({ label, value, target }: Props) {
  const fill = value !== null && target > 0 ? Math.min(1, value / target) : 0;
  const amount =
    value === null
      ? "—"
      : target > 0
        ? `${Math.round(value)} / ${target} g`
        : `${Math.round(value)} g`;
  return (
    <div className={styles.macro}>
      <span className={styles.label}>{label}</span>
      <b className={styles.value}>{amount}</b>
      {target > 0 ? (
        <span className={styles.mini} aria-hidden="true">
          <i style={{ width: `${Math.round(fill * 100)}%` }} />
        </span>
      ) : null}
    </div>
  );
}
