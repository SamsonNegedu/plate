import { useEffect, useState } from "react";
import { useAuth } from "@/app/auth";
import { Button } from "@/components/Button";
import { Field } from "@/components/Field";
import { useDb } from "@/db/context";
import { RecoveryCodes } from "@/features/auth/RecoveryCodes";
import { ApiError, api, toApiError } from "@/lib/api";
import { copy } from "@/lib/copy";
import { useUi } from "@/lib/ui";
import { NetworkError } from "@/sync/errors";
import { wipeLocal } from "./dataTools";
import { cls, panel } from "./ui";

type Action = "none" | "codes" | "delete";

function problemText(err: unknown): string {
  if (err instanceof NetworkError) return copy.account.offline;
  if (err instanceof ApiError && err.status === 401) return copy.account.wrongPassword;
  if (err instanceof ApiError && err.status === 429) return copy.account.rateLimited;
  return copy.account.failed;
}

export function AccountPanel() {
  const db = useDb();
  const auth = useAuth();
  const toast = useUi((s) => s.toast);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [action, setAction] = useState<Action>("none");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [fresh, setFresh] = useState<string[] | null>(null);

  useEffect(() => {
    let live = true;
    void api
      .GET("/auth/me")
      .then((res) => {
        if (live && res.data) setRemaining(res.data.recovery_codes_remaining);
      })
      .catch(() => undefined); // offline: the count simply stays hidden
    return () => {
      live = false;
    };
  }, []);

  const close = () => {
    setAction("none");
    setPassword("");
    setProblem(null);
  };

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setProblem(null);
    try {
      await fn();
    } catch (err) {
      setProblem(problemText(err));
    } finally {
      setBusy(false);
    }
  };

  const makeCodes = () =>
    run(async () => {
      const res = await api.POST("/auth/recovery-codes", { body: { password } });
      if (!res.data) throw toApiError(res.response.status, res.error);
      setFresh(res.data.recovery_codes);
      setRemaining(res.data.recovery_codes.length);
      close();
    });

  const logoutAll = async () => {
    try {
      const res = await api.POST("/auth/logout-all");
      if (res.response.ok) {
        toast({ message: "Signed out everywhere" });
        auth.expire();
      }
    } catch {
      toast({ message: copy.account.offline, tone: "error" });
    }
  };

  const deleteAccount = () =>
    run(async () => {
      const res = await api.POST("/auth/delete-account", { body: { password } });
      if (!res.response.ok) throw toApiError(res.response.status, res.error);
      await wipeLocal(db, { everything: true });
      auth.expire();
      window.location.assign("/login");
    });

  if (fresh) {
    return (
      <section className={cls.section} aria-labelledby="account-h">
        <h2 id="account-h">{copy.account.title}</h2>
        <RecoveryCodes
          codes={fresh}
          onDone={() => {
            setFresh(null);
            void auth.recheck();
          }}
        />
      </section>
    );
  }

  return (
    <section className={cls.section} aria-labelledby="account-h">
      <h2 id="account-h">{copy.account.title}</h2>
      {auth.username ? <p className={cls.muted}>{copy.account.signedInAs(auth.username)}</p> : null}
      {auth.codesSaved === false ? (
        <p className={cls.dirty} role="status">
          {copy.account.codesUnsaved}
        </p>
      ) : null}
      {remaining !== null ? (
        <p className={remaining <= 2 ? cls.dirty : cls.muted}>
          {copy.account.codesLeft(remaining)} {remaining <= 2 ? copy.account.codesLow : ""}
        </p>
      ) : null}

      {action === "none" ? (
        <>
          <div className={cls.actions}>
            <Button onClick={() => setAction("codes")}>{copy.account.newCodes}</Button>
            <Button onClick={() => void logoutAll()}>{copy.account.logoutAll}</Button>
          </div>
          <div className="mt-4 grid gap-2 border-t border-line pt-4">
            <p className={cls.muted}>{copy.account.deleteBody}</p>
            <div className={cls.actions}>
              <Button variant="danger" onClick={() => setAction("delete")}>
                {copy.account.deleteAction}
              </Button>
            </div>
          </div>
        </>
      ) : (
        <form
          className={panel(action === "delete")}
          onSubmit={(e) => {
            e.preventDefault();
            void (action === "codes" ? makeCodes() : deleteAccount());
          }}
        >
          <h3>{action === "codes" ? copy.account.newCodes : copy.account.deleteTitle}</h3>
          <p className={cls.muted}>
            {action === "codes" ? copy.account.newCodesBody : copy.account.deleteBody}
          </p>
          <Field
            label={copy.account.password}
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          {problem ? (
            <p className={cls.error} role="alert">
              {problem}
            </p>
          ) : null}
          <div className={cls.actions}>
            <Button
              type="submit"
              variant={action === "delete" ? "danger" : "primary"}
              busy={busy}
              disabled={password === ""}
            >
              {action === "codes" ? copy.account.confirm : copy.account.deleteConfirm}
            </Button>
            <Button variant="ghost" onClick={close}>
              {copy.common.cancel}
            </Button>
          </div>
        </form>
      )}
    </section>
  );
}
