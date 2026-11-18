import { useStore } from "zustand";
import { useSyncStore } from "@/app/sync";
import { badgeLabel } from "@/sync/status";
import styles from "./SyncBadge.module.css";

/** Always says what is true: Offline, Pending N, Syncing, an error, or when it last synced. */
export function SyncBadge() {
  const store = useSyncStore();
  const status = useStore(store);
  const tone =
    ["error", "auth", "access", "paused"].includes(status.state) || status.failed > 0
      ? "warn"
      : status.state === "offline" || status.pending > 0
        ? "wait"
        : "ok";
  return (
    <span className={`${styles.badge} ${styles[tone]}`} role="status">
      <i aria-hidden="true" />
      {badgeLabel(status)}
    </span>
  );
}
