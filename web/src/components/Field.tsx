import { type InputHTMLAttributes, type ReactNode, useId } from "react";
import styles from "./Field.module.css";

interface Props extends Omit<InputHTMLAttributes<HTMLInputElement>, "id"> {
  label: string;
  error?: string | undefined;
  hint?: string | undefined;
  suffix?: ReactNode;
}

/** A labelled input. Errors are tied to the input with aria-describedby and announced. */
export function Field({ label, error, hint, suffix, ...input }: Props) {
  const id = useId();
  const descId = `${id}-d`;
  const described = error ? `${descId}-e` : hint ? `${descId}-h` : undefined;
  return (
    <div className={styles.field}>
      <label htmlFor={id} className={styles.label}>
        {label}
      </label>
      <div className={styles.control}>
        <input
          id={id}
          className={styles.input}
          aria-invalid={error ? true : undefined}
          aria-describedby={described}
          {...input}
        />
        {suffix ? <span className={styles.suffix}>{suffix}</span> : null}
      </div>
      {error ? (
        <p id={`${descId}-e`} className={styles.error} role="alert">
          {error}
        </p>
      ) : hint ? (
        <p id={`${descId}-h`} className={styles.hint}>
          {hint}
        </p>
      ) : null}
    </div>
  );
}
