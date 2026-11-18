import type { PlateDB } from "./schema";

export async function getMeta<T>(db: PlateDB, key: string): Promise<T | undefined> {
  const row = await db.meta.get(key);
  return row?.value as T | undefined;
}

export async function setMeta(db: PlateDB, key: string, value: unknown): Promise<void> {
  await db.meta.put({ key, value });
}

export const META = {
  cursor: "cursor",
  lastSyncedAt: "lastSyncedAt",
  backoff: "backoff",
  resyncedAt: "resyncedAt",
  leaderUntil: "leaderUntil",
  userId: "userId",
  email: "email",
  seeded: "seeded",
} as const;
