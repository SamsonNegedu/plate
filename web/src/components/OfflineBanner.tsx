import { copy } from "@/lib/copy";
import styles from "./OfflineBanner.module.css";

export function OfflineBanner({ notVerified }: { notVerified?: boolean }) {
  return (
    <p className={styles.banner} role="status">
      <strong>{notVerified ? copy.offline.notVerified : "Offline"}</strong> {copy.offline.banner}
    </p>
  );
}
