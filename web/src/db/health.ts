import { localDate } from "@/lib/dates";
import { uuidv7 } from "@/lib/uuid";
import { healthBody } from "@/sync/bodies";
import { emitLocalWrite } from "./events";
import { enqueue } from "./outbox";
import type { PlateDB } from "./schema";
import type { HealthKind, HealthRecord } from "./types";

interface NewHealthRecord {
  kind: HealthKind;
  value: number;
  /** When it happened. Defaults to now. The calendar day comes from the device clock, never from UTC. */
  at?: Date;
  medication?: string;
  site?: string;
  note?: string;
}

export function buildHealthRecord(
  input: NewHealthRecord,
  now: number = Date.now(),
  id: string = uuidv7(now),
): HealthRecord {
  const at = input.at ?? new Date(now);
  const ts = new Date(now).toISOString();
  return {
    id,
    kind: input.kind,
    recordedOn: localDate(at),
    recordedAt: at.toISOString(),
    value: input.value,
    medication: input.kind === "dose" ? (input.medication ?? "").trim() : "",
    site: (input.site ?? "").trim(),
    note: (input.note ?? "").trim(),
    createdAt: ts,
    updatedAt: ts,
    deletedAt: null,
    serverSeq: 0,
  };
}

/** Write the optimistic row and its outbox op in one transaction. */
export async function saveHealthRecord(
  db: PlateDB,
  record: HealthRecord,
  now: number = Date.now(),
): Promise<HealthRecord> {
  const next: HealthRecord = { ...record, updatedAt: new Date(now).toISOString() };
  await db.transaction("rw", [db.healthRecords, db.outbox], async () => {
    await db.healthRecords.put(next);
    await enqueue(
      db,
      {
        entity: "health_record",
        entityId: next.id,
        type: "upsert",
        data: healthBody(next),
        ...(next.serverSeq ? { baseSeq: next.serverSeq } : {}),
      },
      now,
    );
  });
  emitLocalWrite();
  return next;
}

/** Log a new record. */
export async function addHealthRecord(
  db: PlateDB,
  input: NewHealthRecord,
  now: number = Date.now(),
): Promise<HealthRecord> {
  return saveHealthRecord(db, buildHealthRecord(input, now), now);
}

/** Tombstone locally and queue the delete, like an entry. */
export async function deleteHealthRecord(
  db: PlateDB,
  id: string,
  now: number = Date.now(),
): Promise<void> {
  await db.transaction("rw", [db.healthRecords, db.outbox], async () => {
    const row = await db.healthRecords.get(id);
    if (!row || row.deletedAt) return;
    await db.healthRecords.update(id, { deletedAt: new Date(now).toISOString() });
    await enqueue(db, { entity: "health_record", entityId: id, type: "delete" }, now);
  });
  emitLocalWrite();
}

/** Undo an add. A never-sent record vanishes without a trace; a sent one is deleted like any other. */
export async function undoHealthAdd(
  db: PlateDB,
  id: string,
  now: number = Date.now(),
): Promise<void> {
  const removed = await db.transaction("rw", [db.healthRecords, db.outbox], async () => {
    const row = await db.healthRecords.get(id);
    if (row?.serverSeq !== 0) return false;
    const ops = await db.outbox
      .where("entityId")
      .equals(id)
      .filter((o) => o.entity === "health_record")
      .toArray();
    if (ops.some((o) => o.status !== "pending")) return false;
    await db.outbox.bulkDelete(ops.map((o) => o.id).filter((x): x is number => x !== undefined));
    await db.healthRecords.delete(id);
    return true;
  });
  if (removed) emitLocalWrite();
  else await deleteHealthRecord(db, id, now);
}

/** Undo a delete: cancel an unsent delete, or re-create the record under a new id once the delete has synced. */
export async function undoHealthDelete(
  db: PlateDB,
  id: string,
  now: number = Date.now(),
): Promise<void> {
  const done = await db.transaction("rw", [db.healthRecords, db.outbox], async () => {
    const row = await db.healthRecords.get(id);
    if (!row?.deletedAt) return false;
    const op = await db.outbox
      .where("entityId")
      .equals(id)
      .filter((o) => o.entity === "health_record" && o.type === "delete" && o.status === "pending")
      .first();
    if (op?.id !== undefined) {
      await db.outbox.delete(op.id);
      await db.healthRecords.update(id, { deletedAt: null });
      return true;
    }
    const copy: HealthRecord = {
      ...row,
      id: uuidv7(now),
      deletedAt: null,
      serverSeq: 0,
      createdAt: new Date(now).toISOString(),
      updatedAt: new Date(now).toISOString(),
    };
    await db.healthRecords.put(copy);
    await enqueue(
      db,
      { entity: "health_record", entityId: copy.id, type: "upsert", data: healthBody(copy) },
      now,
    );
    return true;
  });
  if (done) emitLocalWrite();
}
