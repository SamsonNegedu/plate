import { uuidv7 } from "@/lib/uuid";
import { entryBody } from "@/sync/bodies";
import { emitLocalWrite } from "./events";
import { enqueue } from "./outbox";
import type { PlateDB } from "./schema";
import type { Entry, Meal, Nutrients, Unit } from "./types";

export interface NewEntry extends Nutrients {
  eatenOn: string;
  meal: Meal;
  foodId: string | null;
  name: string;
  brand: string;
  barcode: string | null;
  amount: number;
  unit: Unit;
  grams: number;
  note?: string;
}

export function buildEntry(
  input: NewEntry,
  now: number = Date.now(),
  id: string = uuidv7(now),
): Entry {
  const ts = new Date(now).toISOString();
  return {
    ...input,
    id,
    note: input.note ?? "",
    createdAt: ts,
    updatedAt: ts,
    clientUpdatedAt: ts,
    deletedAt: null,
    serverSeq: 0,
  };
}

/** Write the optimistic row and its outbox op in one transaction. */
export async function saveEntry(
  db: PlateDB,
  entry: Entry,
  now: number = Date.now(),
): Promise<void> {
  const next: Entry = { ...entry, clientUpdatedAt: new Date(now).toISOString() };
  await db.transaction("rw", [db.entries, db.outbox], async () => {
    await db.entries.put(next);
    await enqueue(
      db,
      {
        entity: "entry",
        entityId: next.id,
        type: "upsert",
        data: entryBody(next),
        ...(next.serverSeq ? { baseSeq: next.serverSeq } : {}),
      },
      now,
    );
  });
  emitLocalWrite();
}

/** Tombstone locally and queue the delete. The row stays so the delete can be undone or synced. */
export async function deleteEntry(
  db: PlateDB,
  id: string,
  now: number = Date.now(),
): Promise<void> {
  await db.transaction("rw", [db.entries, db.outbox], async () => {
    const row = await db.entries.get(id);
    if (!row || row.deletedAt) return;
    await db.entries.update(id, { deletedAt: new Date(now).toISOString() });
    await enqueue(db, { entity: "entry", entityId: id, type: "delete" }, now);
  });
  emitLocalWrite();
}

/**
 * Undo a delete. If the delete op has not been sent, cancel it and restore the row. Once it has synced, the tombstone
 * stays and the entry is re-created under a new id. Returns the id of the live entry, or null if there was nothing to undo.
 */
export async function undoDelete(
  db: PlateDB,
  id: string,
  now: number = Date.now(),
): Promise<string | null> {
  const result = await db.transaction("rw", [db.entries, db.outbox], async () => {
    const row = await db.entries.get(id);
    if (!row?.deletedAt) return null;
    const op = await db.outbox
      .where("entityId")
      .equals(id)
      .filter((o) => o.entity === "entry" && o.type === "delete" && o.status === "pending")
      .first();
    if (op?.id !== undefined) {
      await db.outbox.delete(op.id);
      await db.entries.update(id, { deletedAt: null });
      return id;
    }
    const copy = buildEntry({ ...row }, now);
    await db.entries.put(copy);
    await enqueue(
      db,
      { entity: "entry", entityId: copy.id, type: "upsert", data: entryBody(copy) },
      now,
    );
    return copy.id;
  });
  if (result) emitLocalWrite();
  return result;
}

/** Undo an add. A never-sent entry vanishes without a trace; a sent one is deleted like any other. */
export async function undoAdd(db: PlateDB, id: string, now: number = Date.now()): Promise<void> {
  const removed = await db.transaction("rw", [db.entries, db.outbox], async () => {
    const row = await db.entries.get(id);
    if (row?.serverSeq !== 0) return false;
    const ops = await db.outbox
      .where("entityId")
      .equals(id)
      .filter((o) => o.entity === "entry")
      .toArray();
    if (ops.some((o) => o.status !== "pending")) return false;
    await db.outbox.bulkDelete(ops.map((o) => o.id).filter((x): x is number => x !== undefined));
    await db.entries.delete(id);
    return true;
  });
  if (removed) emitLocalWrite();
  else await deleteEntry(db, id, now);
}

export async function entriesForDay(db: PlateDB, date: string): Promise<Entry[]> {
  const rows = await db.entries
    .where("eatenOn")
    .equals(date)
    .filter((e) => e.deletedAt === null)
    .toArray();
  return rows.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
}

/** Copy the live entries of one day (or one meal of it) into another day, with new ids and the same portions. */
export async function copyDay(
  db: PlateDB,
  from: string,
  to: string,
  now: number = Date.now(),
  meal?: Meal,
): Promise<string[]> {
  const source = (await entriesForDay(db, from)).filter(
    (e) => meal === undefined || e.meal === meal,
  );
  const ids: string[] = [];
  await db.transaction("rw", [db.entries, db.outbox], async () => {
    for (const [i, e] of source.entries()) {
      const copy = buildEntry({ ...e, eatenOn: to }, now + i);
      await db.entries.put(copy);
      await enqueue(
        db,
        { entity: "entry", entityId: copy.id, type: "upsert", data: entryBody(copy) },
        now + i,
      );
      ids.push(copy.id);
    }
  });
  if (ids.length) emitLocalWrite();
  return ids;
}
