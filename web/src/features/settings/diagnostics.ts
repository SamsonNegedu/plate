import type { PlateDB } from "@/db/schema";
import type { SyncStatus } from "@/sync/status";

/** A plain-text block for a bug report. It holds counts and states only: no product names, food history, identifiers or session values. */
export async function buildDiagnostics(
  db: PlateDB,
  sync: SyncStatus,
  storage: { used: number; quota: number; persisted: boolean } | null,
): Promise<string> {
  const [entries, foods, meals, favorites] = await Promise.all([
    db.entries.filter((e) => !e.deletedAt).count(),
    db.foods.filter((f) => !f.deletedAt).count(),
    db.savedMeals.filter((m) => !m.deletedAt).count(),
    db.favorites.count(),
  ]);
  return [
    "Plate diagnostics",
    `Version: ${import.meta.env.MODE === "production" ? "production" : "development"} build`,
    `Route: ${location.pathname}`,
    `Theme: ${document.documentElement.getAttribute("data-theme") ?? "auto"}`,
    `Online: ${navigator.onLine}`,
    `Sync: ${sync.state}, pending ${sync.pending}, failed ${sync.failed}, conflicts ${sync.conflicts}`,
    `Last synced: ${sync.lastSyncedAt ?? "never"}`,
    `Last sync message: ${sync.message ?? "none"}`,
    `Counts: ${entries} entries, ${foods} foods, ${meals} saved meals, ${favorites} favorites`,
    `Storage: ${storage ? `${Math.round(storage.used / 1048576)} MB of ${Math.round(storage.quota / 1048576)} MB, persisted ${storage.persisted}` : "unknown"}`,
    `Browser: ${navigator.userAgent}`,
  ].join("\n");
}

export async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    return;
  } catch {
    // Fall through to the selection fallback for browsers without clipboard access.
  }
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.className = "sr-only";
  document.body.append(area);
  area.select();
  document.execCommand("copy");
  area.remove();
}
