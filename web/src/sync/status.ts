import { createStore, type StoreApi } from "zustand/vanilla";

type SyncState = "idle" | "syncing" | "offline" | "error" | "auth" | "paused" | "access";

export interface SyncStatus {
  state: SyncState;
  pending: number;
  failed: number;
  conflicts: number;
  lastSyncedAt: string | null;
  message: string | null;
  resyncedAt: string | null;
}

const initialStatus: SyncStatus = {
  state: "idle",
  pending: 0,
  failed: 0,
  conflicts: 0,
  lastSyncedAt: null,
  message: null,
  resyncedAt: null,
};

export type SyncStore = StoreApi<SyncStatus>;

export function createSyncStore(): SyncStore {
  return createStore<SyncStatus>(() => initialStatus);
}

/** The label the badge shows. It is always true: pending beats synced, errors beat pending. */
export function badgeLabel(s: SyncStatus, now: Date = new Date()): string {
  switch (s.state) {
    case "offline":
      return s.pending > 0 ? `Offline · ${s.pending} pending` : "Offline";
    case "auth":
      return "Sign in again";
    case "access":
      return "Sign in to continue";
    case "paused":
      return "Sync paused by server";
    case "error":
      return s.pending > 0 ? `Sync error · ${s.pending} pending` : "Sync error";
    case "syncing":
      return "Syncing";
    default:
      if (s.failed > 0) return `${s.failed} need attention`;
      if (s.pending > 0) return `Pending ${s.pending}`;
      return s.lastSyncedAt ? `Synced ${formatSynced(s.lastSyncedAt, now)}` : "Not synced yet";
  }
}

function formatSynced(iso: string, now: Date): string {
  const t = new Date(iso);
  const mins = Math.floor((now.getTime() - t.getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const sameDay = t.toDateString() === now.toDateString();
  return sameDay
    ? t.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })
    : t.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}
