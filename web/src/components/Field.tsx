import { type InputHTMLAttributes, type ReactNode, useId } from "react";

interface Props extends Omit<InputHTMLAttributes<HTMLInputElement>, "id"> {
  label: string;
  error?: string | undefined;
  hint?: string | undefined;
  suffix?: ReactNode;
}

function describedBy(id: string, error?: string, hint?: string): string | undefined {
  if (error) return `${id}-e`;
  return hint ? `${id}-h` : undefined;
}

/** A labelled input. Errors are tied to the input with aria-describedby and announced. */
export function Field({ label, error, hint, suffix, ...input }: Props) {
  const id = useId();
  const descId = `${id}-d`;
  const described = describedBy(descId, error, hint);
  return (
    <div className="grid grid-cols-1 gap-1.5">
      <label htmlFor={id} className="text-meta font-medium text-ink-2">
        {label}
      </label>
      <div className="flex items-center rounded-ctl border border-line bg-surface focus-within:outline-2 focus-within:outline-offset-0 focus-within:outline-accent has-[[aria-invalid=true]]:border-red">
        <input
          id={id}
          enterKeyHint="done"
          className="min-h-12 min-w-0 flex-1 rounded-ctl bg-transparent px-3 text-input outline-none focus:outline-none focus-visible:outline-none"
          aria-invalid={error ? true : undefined}
          aria-describedby={described}
          {...input}
        />
        {suffix ? <span className="pr-3 text-label text-ink-2">{suffix}</span> : null}
      </div>
      {error ? (
        <p id={`${descId}-e`} className="text-meta text-red" role="alert">
          {error}
        </p>
      ) : null}
      {!error && hint ? (
        <p id={`${descId}-h`} className="text-meta text-ink-2">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
