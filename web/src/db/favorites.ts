import { emitLocalWrite } from "./events";
import { enqueue } from "./outbox";
import type { PlateDB } from "./schema";

export async function setFavorite(
  db: PlateDB,
  foodId: string,
  on: boolean,
  now: number = Date.now(),
): Promise<void> {
  await db.transaction("rw", [db.favorites, db.outbox], async () => {
    const existing = await db.favorites.get(foodId);
    if (on === (existing !== undefined)) return;
    const ts = new Date(now).toISOString();
    if (on) await db.favorites.put({ foodId, createdAt: ts, updatedAt: ts, serverSeq: 0 });
    else await db.favorites.delete(foodId);
    await enqueue(
      db,
      { entity: "favorite", entityId: foodId, type: on ? "upsert" : "delete" },
      now,
    );
  });
  emitLocalWrite();
}
