import { lazy, Suspense, useCallback } from "react";
import { Outlet } from "react-router";
import { AppBar } from "@/components/AppBar";
import { TabBar } from "@/components/TabBar";
import { useDb } from "@/db/context";
import { download, localDump } from "@/lib/diagnostics";
import { PULL_THRESHOLD, usePullToRefresh } from "@/lib/pullToRefresh";
import { useUi } from "@/lib/ui";
import { useAuth } from "./auth";
import { useStorageGuards } from "./storage";
import { useSyncEngine } from "./sync";
import { UpdatePrompt } from "./UpdatePrompt";

// Sheets, forms and toasts are needed only after the first tap, so they load as a separate chunk.
const SheetHost = lazy(() =>
  import("@/features/log/SheetHost").then((m) => ({ default: m.SheetHost })),
);
const ToastHost = lazy(() =>
  import("@/components/ToastHost").then((m) => ({ default: m.ToastHost })),
);

export function AppShell() {
  const auth = useAuth();
  const db = useDb();
  const quota = useUi((s) => s.quotaExceeded);
  useStorageGuards(auth.status === "authed");
  const engine = useSyncEngine();
  const toast = useUi((s) => s.toast);
  const refresh = useCallback(() => {
    if (!engine) return;
    toast({ message: "Syncing" });
    void engine.trigger(true);
  }, [engine, toast]);
  const pull = usePullToRefresh(refresh, engine !== null);
  return (
    <div className="mx-auto max-w-[560px] pr-[max(16px,env(safe-area-inset-right,0px))] pb-[calc(var(--tabbar-h)+env(safe-area-inset-bottom,0px)+24px)] pl-[max(16px,env(safe-area-inset-left,0px))]">
      {pull > 8 ? (
        <p
          className="pointer-events-none fixed inset-x-0 top-[calc(env(safe-area-inset-top,0px)+8px)] z-20 mx-auto w-fit rounded-pill border border-line bg-surface px-3 py-1.5 text-meta text-ink-2"
          aria-hidden="true"
        >
          {pull >= PULL_THRESHOLD ? "Release to sync" : "Pull to sync"}
        </p>
      ) : null}
      <AppBar />
      <main className="pt-1" id="main">
        {quota ? (
          <p
            className="mb-3 rounded-ctl border border-red bg-surface px-3 py-2.5 text-meta"
            role="alert"
          >
            This device is out of storage, so new entries may not be saved.{" "}
            <button
              type="button"
              className="min-h-11 bg-transparent p-0 font-semibold text-ink underline"
              onClick={() =>
                void localDump(db).then((t) =>
                  download(`plate-device-${new Date().toISOString().slice(0, 10)}.json`, t),
                )
              }
            >
              Export your data
            </button>
          </p>
        ) : null}
        <Outlet />
      </main>
      <TabBar />
      <Suspense fallback={null}>
        <SheetHost />
        <ToastHost />
      </Suspense>
      <UpdatePrompt />
    </div>
  );
}
