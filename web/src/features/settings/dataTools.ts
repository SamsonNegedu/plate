import { z } from "zod";
import type { PlateDB } from "@/db/schema";
import { NetworkError } from "@/sync/errors";

const backup = z.object({
  format_version: z.number().int().min(1),
  schema_version: z.number().int().min(1),
  exported_at: z.string().optional(),
  entries: z.array(z.object({ eaten_on: z.string() }).passthrough()),
  foods: z.array(z.unknown()),
  saved_meals: z.array(z.unknown()),
  favorites: z.array(z.unknown()),
});

export interface BackupSummary {
  entries: number;
  foods: number;
  savedMeals: number;
  from: string | null;
  to: string | null;
  schemaVersion: number;
}

export const MAX_IMPORT_BYTES = 32 * 1024 * 1024;

/** Check a backup file before anything is sent: shape, version and size. Throws a readable message. */
export function summarizeBackup(text: string): BackupSummary {
  if (text.length > MAX_IMPORT_BYTES) throw new Error("That file is larger than 32 MB.");
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error("That file is not valid JSON.");
  }
  const parsed = backup.safeParse(raw);
  if (!parsed.success) throw new Error("That file is not a Plate backup.");
  const dates = parsed.data.entries.map((e) => e.eaten_on).sort();
  return {
    entries: parsed.data.entries.length,
    foods: parsed.data.foods.length,
    savedMeals: parsed.data.saved_meals.length,
    from: dates[0] ?? null,
    to: dates.at(-1) ?? null,
    schemaVersion: parsed.data.schema_version,
  };
}

async function request(path: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(`/api/v1${path}`, { credentials: "include", ...init });
  } catch {
    throw new NetworkError();
  }
}

/** The server's export, as text. */
export async function fetchExport(): Promise<string> {
  const res = await request("/export");
  if (!res.ok) throw new Error("The server could not make a backup.");
  return res.text();
}

export async function importBackup(text: string): Promise<void> {
  const res = await request("/import?mode=replace", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: text,
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { detail?: string };
    throw new Error(body.detail ?? "The server rejected that backup. Nothing was changed.");
  }
}

/** Delete everything on the server by restoring an empty backup, which tombstones every row so other devices follow. */
export async function deleteServerData(): Promise<void> {
  const current = JSON.parse(await fetchExport()) as { schema_version: number };
  const empty = JSON.stringify({
    format_version: 1,
    schema_version: current.schema_version,
    entries: [],
    deleted_entries: [],
    foods: [],
    saved_meals: [],
    favorites: [],
  });
  await importBackup(empty);
}

/** Clear every local table, then localStorage and the service worker caches. Used after import and delete-all. */
export async function wipeLocal(db: PlateDB, opts: { everything: boolean }): Promise<void> {
  await db.transaction("rw", db.tables, async () => {
    for (const t of db.tables) await t.clear();
  });
  if (!opts.everything) return;
  try {
    localStorage.clear();
  } catch {
    // Nothing to clear.
  }
  if ("caches" in globalThis) for (const k of await caches.keys()) await caches.delete(k);
}
