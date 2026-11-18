import { useLiveQuery } from "dexie-react-hooks";
import { useState } from "react";
import { useStore } from "zustand";
import { useAuth } from "@/app/auth";
import { useSyncEngine, useSyncStore } from "@/app/sync";
import { Button } from "@/components/Button";
import { useDb } from "@/db/context";
import { discardFailed, retryFailed } from "@/db/outbox";
import { api } from "@/lib/api";
import { useUi } from "@/lib/ui";
import { badgeLabel } from "@/sync/status";
import styles from "./Settings.module.css";

export function SyncPanel() {
  const db = useDb();
  const engine = useSyncEngine();
  const status = useStore(useSyncStore());
  const auth = useAuth();
  const toast = useUi((s) => s.toast);
  const [busy, setBusy] = useState(false);
  const failed =
    useLiveQuery(() => db.outbox.where("status").equals("failed").toArray(), [db]) ?? [];
  const conflicts =
    useLiveQuery(() => db.conflicts.orderBy("at").reverse().limit(20).toArray(), [db]) ?? [];

  const syncNow = async () => {
    setBusy(true);
    try {
      await engine?.syncOnce(true);
    } finally {
      setBusy(false);
    }
  };

  const logoutAll = async () => {
    try {
      const res = await api.POST("/auth/logout-all");
      if (res.response.status === 204 || res.response.ok) {
        toast({ message: "Signed out everywhere" });
        auth.expire();
      }
    } catch {
      toast({
        message: "Could not reach the server. Try again when you are online.",
        tone: "error",
      });
    }
  };

  return (
    <section className={styles.section} aria-labelledby="sync-h">
      <h2 id="sync-h">Sync</h2>
      <dl className={styles.facts}>
        <div>
          <dt>Status</dt>
          <dd>{badgeLabel(status)}</dd>
        </div>
        <div>
          <dt>Waiting to send</dt>
          <dd>{status.pending}</dd>
        </div>
        <div>
          <dt>Conflicts</dt>
          <dd>{status.conflicts}</dd>
        </div>
      </dl>
      {status.state === "paused" ? (
        <p className={styles.muted}>
          Sync is paused by the server. You can keep logging; everything is kept on this device and
          sent later.
        </p>
      ) : null}
      {status.state === "error" && status.message ? (
        <p className={styles.error} role="alert">
          {status.message}
        </p>
      ) : null}
      {status.resyncedAt ? (
        <p className={styles.muted}>
          Resynced from the server on {new Date(status.resyncedAt).toLocaleString("en-GB")}.
        </p>
      ) : null}
      <div className={styles.actions}>
        <Button onClick={() => void syncNow()} busy={busy}>
          Sync now
        </Button>
        <Button variant="danger" onClick={() => void logoutAll()}>
          Log out all devices
        </Button>
      </div>

      {failed.length > 0 ? (
        <div className={`${styles.panel} ${styles.warn}`}>
          <h3>
            {failed.length} {failed.length === 1 ? "change needs" : "changes need"} attention
          </h3>
          <ul className={styles.list}>
            {failed.map((op) => (
              <li key={op.id} className={styles.item}>
                <span>
                  <strong>{`${op.entity.replace("_", " ")} ${op.type}`}</strong>
                  <small>{op.error?.detail ?? "Rejected by the server."}</small>
                </span>
                <button
                  type="button"
                  className={styles.small}
                  onClick={() => op.id !== undefined && void discardFailed(db, op.id)}
                >
                  Discard
                </button>
              </li>
            ))}
          </ul>
          <Button onClick={() => void retryFailed(db).then(() => engine?.scheduleSoon(0))}>
            Retry all
          </Button>
        </div>
      ) : null}

      {conflicts.length > 0 ? (
        <details>
          <summary className={styles.hint}>Conflicts ({conflicts.length})</summary>
          <p className={styles.muted}>
            Another device changed these after this one last synced. The latest write won.
          </p>
          <ul className={styles.list}>
            {conflicts.map((c) => (
              <li key={c.id} className={styles.item}>
                <span>
                  <strong>{c.entity.replace("_", " ")}</strong>
                  <small>
                    {new Date(c.at).toLocaleString("en-GB")} · server change {c.serverSeq}
                  </small>
                </span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}
