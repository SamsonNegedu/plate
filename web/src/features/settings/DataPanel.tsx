import { useReducer, useRef } from "react";
import { useAuth } from "@/app/auth";
import { useSyncEngine } from "@/app/sync";
import { Button } from "@/components/Button";
import { Field } from "@/components/Field";
import { useDb } from "@/db/context";
import { download, localDump } from "@/lib/diagnostics";
import { useUi } from "@/lib/ui";
import { NetworkError } from "@/sync/errors";
import { DELETE_WORD, dataReducer, initialDataState } from "./dataMachine";
import {
  deleteServerData,
  fetchExport,
  importBackup,
  summarizeBackup,
  wipeLocal,
} from "./dataTools";
import { cls, panel } from "./ui";

const stamp = () => new Date().toISOString().slice(0, 10);

function failureMessage(e: unknown, offline: string, fallback: string): string {
  if (e instanceof NetworkError) return offline;
  return e instanceof Error ? e.message : fallback;
}

export function DataPanel() {
  const db = useDb();
  const auth = useAuth();
  const engine = useSyncEngine();
  const toast = useUi((s) => s.toast);
  const fileRef = useRef<HTMLInputElement>(null);
  const [state, dispatch] = useReducer(dataReducer, initialDataState);
  const { restore, wipe, problem } = state;

  const exportServer = async () => {
    dispatch({ type: "problemCleared" });
    try {
      download(`plate-backup-${stamp()}.json`, await fetchExport());
    } catch (e) {
      dispatch({
        type: "exportFailed",
        message: failureMessage(
          e,
          "You are offline. Use the offline copy under Advanced, which may be incomplete.",
          "Export failed.",
        ),
      });
    }
  };

  const exportLocal = async () => download(`plate-local-${stamp()}.json`, await localDump(db));

  const pick = async (file: File) => {
    dispatch({ type: "fileChosen" });
    try {
      const text = await file.text();
      dispatch({ type: "fileRead", text, summary: summarizeBackup(text) });
    } catch (e) {
      const message = e instanceof Error ? e.message : "Could not read that file.";
      dispatch({ type: "fileUnreadable", message });
    }
  };

  const confirmImport = async () => {
    if (restore.step !== "confirming") return;
    dispatch({ type: "restoreStarted" });
    try {
      await importBackup(restore.text);
      await wipeLocal(db, { everything: false });
      await engine?.resync();
      toast({ message: "Backup restored" });
      dispatch({ type: "restoreDone" });
      window.location.reload();
    } catch (e) {
      dispatch({
        type: "restoreFailed",
        message: failureMessage(
          e,
          "You are offline. Importing needs the server.",
          "Import failed.",
        ),
      });
    }
  };

  const deleteAll = async () => {
    dispatch({ type: "wipeStarted" });
    try {
      await deleteServerData();
      await wipeLocal(db, { everything: true });
      await auth.logout();
      window.location.assign("/login");
    } catch (e) {
      dispatch({
        type: "wipeFailed",
        message: failureMessage(
          e,
          "You are offline. Deleting needs the server so every device is cleared.",
          "Delete failed.",
        ),
      });
    }
  };

  return (
    <section className={cls.section} aria-labelledby="data-h">
      <h2 id="data-h">Your data</h2>
      <p className={cls.muted}>
        Keep a copy now and then. The backup holds your entries, foods, saved meals and goals. It is
        separate from sync, so it survives a bad edit or a lost server database.
      </p>
      <div className={cls.actions}>
        <Button onClick={() => void exportServer()}>Export a backup</Button>
        <Button onClick={() => fileRef.current?.click()}>Import a backup</Button>
      </div>
      <details className={cls.advanced}>
        <summary>Advanced</summary>
        <p className={cls.muted}>
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
        className="sr-only"
        tabIndex={-1}
        aria-label="Choose a backup file"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) void pick(f);
        }}
      />
      {problem ? (
        <p className={cls.error} role="alert">
          {problem}
        </p>
      ) : null}

      {restore.step !== "idle" ? (
        <div className={panel(true)}>
          <h3>Replace all data with this backup?</h3>
          <dl className={cls.facts}>
            <div>
              <dt>Entries</dt>
              <dd>{restore.summary.entries}</dd>
            </div>
            <div>
              <dt>Foods</dt>
              <dd>{restore.summary.foods}</dd>
            </div>
            <div>
              <dt>Saved meals</dt>
              <dd>{restore.summary.savedMeals}</dd>
            </div>
            <div>
              <dt>Dates</dt>
              <dd>
                {restore.summary.from ? `${restore.summary.from} to ${restore.summary.to}` : "None"}
              </dd>
            </div>
          </dl>
          <p className={cls.muted}>
            Everything on the server that is not in this file is removed. The server keeps a
            snapshot first.
          </p>
          <div className={cls.actions}>
            <Button
              variant="danger"
              onClick={() => void confirmImport()}
              busy={restore.step === "restoring"}
            >
              Replace all data
            </Button>
            <Button variant="ghost" onClick={() => dispatch({ type: "restoreCancelled" })}>
              Cancel
            </Button>
          </div>
        </div>
      ) : null}

      <div className={panel()}>
        <h3>Delete all data</h3>
        <p className={cls.muted}>
          Removes your log from the server and from this device, then signs you out. Export a backup
          first.
        </p>
        {wipe.step !== "idle" ? (
          <>
            <Field
              label="Type DELETE to confirm"
              autoCapitalize="characters"
              autoComplete="off"
              value={wipe.typed}
              onChange={(e) => dispatch({ type: "wipeTyped", typed: e.target.value })}
            />
            <div className={cls.actions}>
              <Button
                variant="danger"
                disabled={wipe.typed !== DELETE_WORD}
                busy={wipe.step === "wiping"}
                onClick={() => void deleteAll()}
              >
                Delete everything
              </Button>
              <Button variant="ghost" onClick={() => dispatch({ type: "wipeCancelled" })}>
                Cancel
              </Button>
            </div>
          </>
        ) : (
          <div className={cls.actions}>
            <Button variant="danger" onClick={() => dispatch({ type: "wipeOpened" })}>
              Delete all data
            </Button>
          </div>
        )}
      </div>
    </section>
  );
}
