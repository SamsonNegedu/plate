import styles from "./Segmented.module.css";

interface Option<T extends string> {
  value: T;
  label: string;
}

export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: Array<Option<T>>;
  onChange: (v: T) => void;
}) {
  return (
    <fieldset className={styles.group}>
      <legend className="srOnly">{label}</legend>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={o.value === value}
          className={styles.opt}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </fieldset>
  );
}
