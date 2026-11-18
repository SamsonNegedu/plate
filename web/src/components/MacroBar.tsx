interface Props {
  label: string;
  /** null means no entry reported it: shown as a dash, never a zero. */
  value: number | null;
  target: number;
}

function amountText(value: number | null, target: number): string {
  if (value === null) return "—";
  return target > 0 ? `${Math.round(value)} / ${target} g` : `${Math.round(value)} g`;
}

export function MacroBar({ label, value, target }: Props) {
  const fill = value !== null && target > 0 ? Math.min(1, value / target) : 0;
  const amount = amountText(value, target);
  return (
    <div className="min-w-0">
      <span className="block text-micro text-ink-2">{label}</span>
      <b className="block truncate text-body font-semibold text-ink">{amount}</b>
      {target > 0 ? (
        <span
          className="mt-1 block h-[3px] overflow-hidden rounded-pill bg-surface-2"
          aria-hidden="true"
        >
          <i className="block h-full bg-ink-3" style={{ width: `${Math.round(fill * 100)}%` }} />
        </span>
      ) : null}
    </div>
  );
}
