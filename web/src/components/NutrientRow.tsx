import { type InputHTMLAttributes, type ReactNode, useId } from "react";
import { nextOnEnter } from "@/lib/keyboard";

const UNIT_WORDS: Record<string, string> = { kcal: "kilocalories", kJ: "kilojoules", g: "grams" };

interface Props extends Omit<InputHTMLAttributes<HTMLInputElement>, "id"> {
  label: string;
  unit: string;
  /** An "of which" row, set under its parent like a printed label. */
  sub?: boolean;
  error?: string | undefined;
  /** The value was read from a photo and needs a look. Text says so; colour is never the only signal. */
  check?: boolean;
}

/** One line of a nutrition table: the name on the left, the number and its unit on the right. */
export function NutrientRow({ label, unit, sub, error, check, ...input }: Props) {
  const id = useId();
  const note = error ?? (check ? "Check this value against the label." : undefined);
  return (
    <div className="border-b border-line py-1.5">
      <div className="grid min-h-11 grid-cols-[1fr_auto] items-center gap-3">
        <label
          htmlFor={id}
          className={sub ? "pl-3.5 text-label text-ink-2" : "text-label font-medium"}
        >
          {label} <span className="sr-only">{`in ${UNIT_WORDS[unit] ?? unit}`}</span>
        </label>
        <div className="flex w-32 items-center rounded-ctl border border-line bg-surface focus-within:outline-2 focus-within:outline-offset-0 focus-within:outline-accent has-[[aria-invalid=true]]:border-red has-[[data-check=true]]:border-amber">
          <input
            id={id}
            inputMode="decimal"
            autoComplete="off"
            enterKeyHint="next"
            onKeyDown={nextOnEnter}
            className="min-h-11 min-w-0 flex-1 rounded-ctl bg-transparent pl-3 text-right text-input tabular-nums outline-none focus:outline-none focus-visible:outline-none"
            aria-invalid={error ? true : undefined}
            aria-describedby={note ? `${id}-n` : undefined}
            data-check={check && !error ? true : undefined}
            {...input}
          />
          <span className="w-10 pr-3 text-left text-meta text-ink-2" aria-hidden="true">
            {unit}
          </span>
        </div>
      </div>
      {note ? (
        <p
          id={`${id}-n`}
          className={error ? "pb-1 text-meta text-red" : "pb-1 text-meta text-ink-2"}
          role={error ? "alert" : undefined}
        >
          {note}
        </p>
      ) : null}
    </div>
  );
}

/** A table heading and its rows, grouped for assistive technology. */
export function NutrientTable({
  title,
  action,
  children,
}: {
  title: string;
  /** Something that belongs to the whole table, such as the energy unit. */
  action?: ReactNode;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <section aria-labelledby={id}>
      <div className="flex items-center justify-between gap-3 border-b border-ink pb-1.5">
        <h3 id={id} className="text-body font-semibold">
          {title}
        </h3>
        {action}
      </div>
      {children}
    </section>
  );
}
