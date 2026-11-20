import { useLiveQuery } from "dexie-react-hooks";
import { useState } from "react";
import { useStore } from "zustand";
import { useSyncEngine, useSyncStore } from "@/app/sync";
import { Button } from "@/components/Button";
import { useDb } from "@/db/context";
import { discardFailed, retryFailed } from "@/db/outbox";
import { badgeLabel } from "@/sync/status";
import { cls, panel, smallBtn } from "./ui";

export function SyncPanel() {
  const db = useDb();
  const engine = useSyncEngine();
  const status = useStore(useSyncStore());
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

  return (
    <section className={cls.section} aria-labelledby="sync-h">
      <h2 id="sync-h">Sync</h2>
      <p className="text-body font-medium">{badgeLabel(status)}</p>
      {status.state === "paused" ? (
        <p className={cls.muted}>
          Sync is paused by the server. You can keep logging; everything is kept on this device and
          sent later.
        </p>
      ) : null}
      {status.state === "error" && status.message ? (
        <p className={cls.error} role="alert">
          {status.message}
        </p>
      ) : null}
      {status.resyncedAt ? (
        <p className={cls.muted}>
          Resynced from the server on {new Date(status.resyncedAt).toLocaleString("en-GB")}.
        </p>
      ) : null}
      <div className={cls.actions}>
        <Button onClick={() => void syncNow()} busy={busy}>
          Sync now
        </Button>
      </div>
      <details className={cls.advanced}>
        <summary>Details</summary>
        <dl className={cls.facts}>
          <div>
            <dt>Waiting to send</dt>
            <dd>{status.pending}</dd>
          </div>
          <div>
            <dt>Conflicts</dt>
            <dd>{status.conflicts}</dd>
          </div>
        </dl>
      </details>

      {failed.length > 0 ? (
        <div className={panel(true)}>
          <h3>
            {failed.length} {failed.length === 1 ? "change needs" : "changes need"} attention
          </h3>
          <ul>
            {failed.map((op) => (
              <li key={op.id} className={cls.item}>
                <span>
                  <strong>{`${op.entity.replace("_", " ")} ${op.type}`}</strong>
                  <small>{op.error?.detail ?? "Rejected by the server."}</small>
                </span>
                <button
                  type="button"
                  className={smallBtn()}
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
          <summary className={cls.hint}>Conflicts ({conflicts.length})</summary>
          <p className={cls.muted}>
            Another device changed these after this one last synced. The latest write won.
          </p>
          <ul>
            {conflicts.map((c) => (
              <li key={c.id} className={cls.item}>
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
