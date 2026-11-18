import { lazy, Suspense } from "react";
import { Outlet } from "react-router";
import { useStore } from "zustand";
import { AppBar } from "@/components/AppBar";
import { OfflineBanner } from "@/components/OfflineBanner";
import { TabBar } from "@/components/TabBar";
import { useDb } from "@/db/context";
import { download, localDump } from "@/lib/diagnostics";
import { useUi } from "@/lib/ui";
import styles from "./AppShell.module.css";
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
    <div className={styles.shell}>
      <AppBar />
      <main className={styles.main} id="main">
        {quota ? (
          <p className={styles.quota} role="alert">
            This device is out of storage, so new entries may not be saved.{" "}
            <button
              type="button"
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
