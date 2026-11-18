import { useState } from "react";
import type { Entry } from "@/db/types";
import { formatKcal } from "@/lib/numbers";
import { amountLabel, entryKcal } from "@/lib/nutrition";
import styles from "./EntryRow.module.css";
import { Icon } from "./Icon";

export function EntryRow({
  entry,
  imagePath,
  onOpen,
}: {
  entry: Entry;
  imagePath: string | null;
  onOpen: () => void;
}) {
  const [broken, setBroken] = useState(false);
  const meta = [entry.brand, amountLabel(entry.amount, entry.unit)].filter(Boolean).join(" · ");
  return (
    <button type="button" className={styles.row} onClick={onOpen}>
      <span className={styles.thumb} aria-hidden="true">
        {imagePath && !broken ? (
          <img src={imagePath} alt="" loading="lazy" onError={() => setBroken(true)} />
        ) : (
          <Icon name={entry.foodId ? "bottle" : "lines"} size={17} />
        )}
      </span>
      <span className={styles.text}>
        <strong>{entry.name}</strong>
        <span>{meta}</span>
      </span>
      <span className={styles.kcal}>
        {formatKcal(entryKcal(entry))}
        <small> kcal</small>
      </span>
    </button>
  );
}
