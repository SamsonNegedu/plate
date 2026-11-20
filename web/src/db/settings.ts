import { settingsBody } from "@/sync/bodies";
import { emitLocalWrite } from "./events";
import { getMeta, META } from "./meta";
import { enqueue } from "./outbox";
import type { PlateDB } from "./schema";
import type { Settings } from "./types";

export const DEFAULT_SETTINGS: Omit<Settings, "userId"> = {
  goalKcal: 2000,
  proteinG: 0,
  carbsG: 0,
  fatG: 0,
  fiberG: 0,
  dayStartHour: 0,
  theme: "auto",
  weightGoalKg: null,
  medName: null,
  medIntervalDays: null,
  medStartedOn: null,
  medSupplyDoses: null,
  medSupplyAsOf: null,
  updatedAt: "",
  serverSeq: 0,
};

export async function currentUserId(db: PlateDB): Promise<string> {
  return (await getMeta<string>(db, META.userId)) ?? "";
}

export async function getSettings(db: PlateDB): Promise<Settings> {
  const row = await db.settings.toCollection().first();
  return row ?? { ...DEFAULT_SETTINGS, userId: await currentUserId(db) };
}

export async function saveSettings(
  db: PlateDB,
  patch: Partial<Omit<Settings, "userId" | "updatedAt" | "serverSeq">>,
  now: number = Date.now(),
): Promise<Settings> {
  const userId = await currentUserId(db);
  const saved = await db.transaction("rw", [db.settings, db.outbox], async () => {
    const existing = await db.settings.get(userId);
    const s: Settings = {
      ...(existing ?? { ...DEFAULT_SETTINGS, userId }),
      ...patch,
      userId,
      updatedAt: new Date(now).toISOString(),
      serverSeq: existing?.serverSeq ?? 0,
    };
    await db.settings.put(s);
    if (userId)
      await enqueue(
        db,
        { entity: "settings", entityId: userId, type: "upsert", data: settingsBody(s) },
        now,
      );
    return s;
  });
  emitLocalWrite();
  return saved;
}
