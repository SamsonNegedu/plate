import { Icon } from "./Icon";

interface Props {
  title: string;
  label: string;
  onPrev: () => void;
  onNext: () => void;
  nextDisabled?: boolean;
}

const btn =
  "grid size-11 place-items-center bg-transparent text-ink-2 disabled:cursor-default disabled:opacity-35";

export function DayNav({ title, label, onPrev, onNext, nextDisabled }: Props) {
  return (
    <nav className="flex items-center gap-1 pt-1 pb-3" aria-label="Choose a day">
      <button type="button" className={btn} onClick={onPrev} aria-label="Previous day">
        <Icon name="prev" />
      </button>
      <div className="flex-1 text-center">
        <h1 className="text-heading leading-heading font-semibold">{title}</h1>
        <p className="mt-0.5 text-meta text-ink-2">{label}</p>
      </div>
      <button
        type="button"
        className={btn}
        onClick={onNext}
        aria-label="Next day"
        disabled={nextDisabled}
      >
        <Icon name="next" />
      </button>
    </nav>
  );
}
