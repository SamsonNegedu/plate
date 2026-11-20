interface Props {
  label: string;
  /** null means no entry reported it: shown as a dash, never a zero. */
  value: number | null;
  target: number;
}

export function MacroBar({ label, value, target }: Props) {
  const fill = value !== null && target > 0 ? Math.min(1, value / target) : 0;
  return (
    <div className="min-w-0">
      <span className="block text-micro text-ink-2">{label}</span>
      <b className="block truncate text-body font-semibold text-ink">
        {value === null ? "—" : Math.round(value)}
        {value === null ? null : (
          <small className="text-micro font-normal text-ink-2">
            {target > 0 ? ` / ${target} g` : " g"}
          </small>
        )}
      </b>
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
