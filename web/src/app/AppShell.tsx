import { lazy, Suspense } from "react";
import { Outlet } from "react-router";
import { useStore } from "zustand";
import { AppBar } from "@/components/AppBar";
import { OfflineBanner } from "@/components/OfflineBanner";
import { TabBar } from "@/components/TabBar";
import { useDb } from "@/db/context";
import { download, localDump } from "@/lib/diagnostics";
import { useUi } from "@/lib/ui";
import { useAuth } from "./auth";
import { useOnline } from "./online";
import { useStorageGuards } from "./storage";
import { useSyncStore } from "./sync";
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
  const online = useOnline();
  const syncState = useStore(useSyncStore(), (s) => s.state);
  const offline = !online || syncState === "offline" || auth.offline;
  const db = useDb();
  const quota = useUi((s) => s.quotaExceeded);
  useStorageGuards(auth.status === "authed");
  return (
    <div className="mx-auto max-w-[560px] pr-[max(16px,env(safe-area-inset-right,0px))] pb-[calc(var(--tabbar-h)+env(safe-area-inset-bottom,0px)+24px)] pl-[max(16px,env(safe-area-inset-left,0px))]">
      {/* Solid color behind the status bar, so the OS blur never sits over the app name. Zero height outside notched phones. */}
      <div
        aria-hidden="true"
        className="fixed inset-x-0 top-0 z-30 h-[env(safe-area-inset-top,0px)] bg-bg"
      />
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
        {offline ? <OfflineBanner notVerified={auth.offline} /> : null}
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
