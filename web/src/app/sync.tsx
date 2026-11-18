import { createContext, type ReactNode, useContext, useEffect, useMemo, useState } from "react";
import { useStore } from "zustand";
import { useDb } from "@/db/context";
import { onLocalWrite } from "@/db/events";
import type { SyncEngine } from "@/sync/engine";
import { createSyncStore, type SyncStore } from "@/sync/status";
import { useAuth } from "./auth";

interface SyncValue {
  store: SyncStore;
  engine: SyncEngine | null;
}

const Ctx = createContext<SyncValue | null>(null);

export function SyncProvider({ children }: { children: ReactNode }) {
  const db = useDb();
  const auth = useAuth();
  const store = useMemo(() => createSyncStore(), []);
  const [engine, setEngine] = useState<SyncEngine | null>(null);

  // The engine and its validation library load after the first paint, so they stay out of the initial route's JavaScript.
  useEffect(() => {
    if (auth.status !== "authed") return;
    let alive = true;
    let stop: (() => void) | undefined;
    void Promise.all([import("@/sync/engine"), import("@/sync/api")]).then(
      ([{ SyncEngine: Engine }, { httpTransport }]) => {
        if (!alive) return;
        const e = new Engine(db, httpTransport, store);
        setEngine(e);
        void e.start();
        const off = onLocalWrite(() => e.scheduleSoon());
        stop = () => {
          off();
          e.stop();
        };
      },
    );
    return () => {
      alive = false;
      stop?.();
      setEngine(null);
    };
  }, [auth.status, db, store]);

  const state = useStore(store, (s) => s.state);
  useEffect(() => {
    if (state === "auth") auth.expire();
  }, [state, auth]);

  const value = useMemo(() => ({ store, engine }), [store, engine]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSyncStore(): SyncStore {
  const v = useContext(Ctx);
  if (!v) throw new Error("useSyncStore needs a SyncProvider");
  return v.store;
}

export function useSyncEngine(): SyncEngine | null {
  return useContext(Ctx)?.engine ?? null;
}
