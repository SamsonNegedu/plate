import { copy } from "@/lib/copy";
import styles from "./AppBar.module.css";
import { SyncBadge } from "./SyncBadge";

export function AppBar() {
  return (
    <header className={styles.bar}>
      <p className={styles.word}>{copy.app.name}</p>
      <SyncBadge />
    </header>
  );
}
