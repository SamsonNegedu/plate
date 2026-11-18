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
    <fieldset className="m-0 flex min-w-0 gap-1 rounded-ctl border border-line bg-surface-2 p-[3px]">
      <legend className="sr-only">{label}</legend>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={o.value === value}
          className="min-h-[38px] flex-1 rounded-lg border border-transparent bg-transparent px-1.5 text-label font-medium text-ink-2 aria-pressed:border-ink aria-pressed:bg-surface aria-pressed:text-ink"
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </fieldset>
  );
}
