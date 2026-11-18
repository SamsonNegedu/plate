import styles from "./DayNav.module.css";
import { Icon } from "./Icon";

interface Props {
  title: string;
  label: string;
  onPrev: () => void;
  onNext: () => void;
  nextDisabled?: boolean;
}

export function DayNav({ title, label, onPrev, onNext, nextDisabled }: Props) {
  return (
    <nav className={styles.nav} aria-label="Choose a day">
      <button type="button" className={styles.btn} onClick={onPrev} aria-label="Previous day">
        <Icon name="prev" />
      </button>
      <div className={styles.mid}>
        <h1>{title}</h1>
        <p>{label}</p>
      </div>
      <button
        type="button"
        className={styles.btn}
        onClick={onNext}
        aria-label="Next day"
        disabled={nextDisabled}
      >
        <Icon name="next" />
      </button>
    </nav>
  );
}
