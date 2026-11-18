import { useRef, useState } from "react";
import { useAuth } from "@/app/auth";
import { useSyncEngine } from "@/app/sync";
import { Button } from "@/components/Button";
import { Field } from "@/components/Field";
import { useDb } from "@/db/context";
import { download, localDump } from "@/lib/diagnostics";
import { useUi } from "@/lib/ui";
import { NetworkError } from "@/sync/errors";
import {
  type BackupSummary,
  deleteServerData,
  fetchExport,
  importBackup,
  summarizeBackup,
  wipeLocal,
} from "./dataTools";
import styles from "./Settings.module.css";

const stamp = () => new Date().toISOString().slice(0, 10);

export function DataPanel() {
  const db = useDb();
  const auth = useAuth();
  const engine = useSyncEngine();
  const toast = useUi((s) => s.toast);
  const fileRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<{ text: string; summary: BackupSummary } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [typed, setTyped] = useState("");

  const exportServer = async () => {
    setProblem(null);
    try {
      download(`plate-backup-${stamp()}.json`, await fetchExport());
    } catch (e) {
      if (e instanceof NetworkError)
        setProblem(
          "You are offline. Use the offline copy under Advanced, which may be incomplete.",
        );
      else setProblem(e instanceof Error ? e.message : "Export failed.");
    }
  };

  const exportLocal = async () => download(`plate-local-${stamp()}.json`, await localDump(db));

  const pick = async (file: File) => {
    setProblem(null);
    setPending(null);
    try {
      const text = await file.text();
      setPending({ text, summary: summarizeBackup(text) });
    } catch (e) {
      setProblem(e instanceof Error ? e.message : "Could not read that file.");
    }
  };

  const confirmImport = async () => {
    if (!pending) return;
    setBusy(true);
    setProblem(null);
    try {
      await importBackup(pending.text);
      await wipeLocal(db, { everything: false });
      await engine?.resync();
      toast({ message: "Backup restored" });
      setPending(null);
      window.location.reload();
    } catch (e) {
      setProblem(
        e instanceof NetworkError
          ? "You are offline. Importing needs the server."
          : e instanceof Error
            ? e.message
            : "Import failed.",
      );
    } finally {
      setBusy(false);
    }
  };

  const deleteAll = async () => {
    setBusy(true);
    setProblem(null);
    try {
      await deleteServerData();
      await wipeLocal(db, { everything: true });
      await auth.logout();
      window.location.assign("/login");
    } catch (e) {
      setProblem(
        e instanceof NetworkError
          ? "You are offline. Deleting needs the server so every device is cleared."
          : e instanceof Error
            ? e.message
            : "Delete failed.",
      );
      setBusy(false);
    }
  };

  return (
    <section className={styles.section} aria-labelledby="data-h">
      <h2 id="data-h">Your data</h2>
      <p className={styles.muted}>
        Keep a copy now and then. The backup holds your entries, foods, saved meals and goals. It is
        separate from sync, so it survives a bad edit or a lost server database.
      </p>
      <div className={styles.actions}>
        <Button onClick={() => void exportServer()}>Export a backup</Button>
        <Button onClick={() => fileRef.current?.click()}>Import a backup</Button>
      </div>
      <details className={styles.advanced}>
        <summary>Advanced</summary>
        <p className={styles.muted}>
          Export the offline copy when the server is unreachable. It may be incomplete.
        </p>
        <Button variant="ghost" onClick={() => void exportLocal()}>
          Export the offline copy
        </Button>
      </details>
      <input
        ref={fileRef}
        type="file"
        accept="application/json,.json"
        className="srOnly"
        tabIndex={-1}
        aria-label="Choose a backup file"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) void pick(f);
        }}
      />
      {problem ? (
        <p className={styles.error} role="alert">
          {problem}
        </p>
      ) : null}

      {pending ? (
        <div className={`${styles.panel} ${styles.warn}`}>
          <h3>Replace all data with this backup?</h3>
          <dl className={styles.facts}>
            <div>
              <dt>Entries</dt>
              <dd>{pending.summary.entries}</dd>
            </div>
            <div>
              <dt>Foods</dt>
              <dd>{pending.summary.foods}</dd>
            </div>
            <div>
              <dt>Saved meals</dt>
              <dd>{pending.summary.savedMeals}</dd>
            </div>
            <div>
              <dt>Dates</dt>
              <dd>
                {pending.summary.from ? `${pending.summary.from} to ${pending.summary.to}` : "None"}
              </dd>
            </div>
          </dl>
          <p className={styles.muted}>
            Everything on the server that is not in this file is removed. The server keeps a
            snapshot first.
          </p>
          <div className={styles.actions}>
            <Button variant="danger" onClick={() => void confirmImport()} busy={busy}>
              Replace all data
            </Button>
            <Button variant="ghost" onClick={() => setPending(null)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : null}

      <div className={styles.panel}>
        <h3>Delete all data</h3>
        <p className={styles.muted}>
          Removes your log from the server and from this device, then signs you out. Export a backup
          first.
        </p>
        {deleting ? (
          <>
            <Field
              label="Type DELETE to confirm"
              autoCapitalize="characters"
              autoComplete="off"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
            />
            <div className={styles.actions}>
              <Button
                variant="danger"
                disabled={typed !== "DELETE"}
                busy={busy}
                onClick={() => void deleteAll()}
              >
                Delete everything
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  setDeleting(false);
                  setTyped("");
                }}
              >
                Cancel
              </Button>
            </div>
          </>
        ) : (
          <div className={styles.actions}>
            <Button variant="danger" onClick={() => setDeleting(true)}>
              Delete all data
            </Button>
          </div>
        )}
      </div>
    </section>
  );
}
