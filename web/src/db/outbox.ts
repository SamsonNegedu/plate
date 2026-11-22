import { uuidv7 } from "@/lib/uuid";
import type { PlateDB } from "./schema";
import type { OutboxOp, SyncEntity } from "./types";

interface EnqueueInput {
  entity: SyncEntity;
  entityId: string;
  type: "upsert" | "delete";
  data?: unknown;
  baseSeq?: number;
}

/**
 * Queue an op inside the caller's transaction. A pending upsert for the same row is replaced by the newer one, so a
 * flurry of edits sends one op. An op that is already inflight is never touched.
 */
export async function enqueue(
  db: PlateDB,
  input: EnqueueInput,
  now: number = Date.now(),
): Promise<void> {
  if (input.type === "upsert") {
    const pending = await db.outbox
      .where("entityId")
      .equals(input.entityId)
      .filter((o) => o.entity === input.entity && o.status === "pending" && o.type === "upsert")
      .first();
    const last = await lastOpFor(db, input.entity, input.entityId);
    if (pending?.id !== undefined && last?.id === pending.id) {
      await db.outbox.update(pending.id, {
        data: input.data,
        clientTs: new Date(now).toISOString(),
        baseSeq: input.baseSeq ?? pending.baseSeq,
      });
      return;
    }
  }
  const op: OutboxOp = {
    opId: uuidv7(now),
    entity: input.entity,
    entityId: input.entityId,
    type: input.type,
    data: input.data,
    ...(input.baseSeq !== undefined ? { baseSeq: input.baseSeq } : {}),
    clientTs: new Date(now).toISOString(),
    status: "pending",
    attempts: 0,
    createdAt: now,
    nextAttemptAt: 0,
  };
  await db.outbox.add(op);
}

async function lastOpFor(
  db: PlateDB,
  entity: SyncEntity,
  entityId: string,
): Promise<OutboxOp | undefined> {
  const ops = await db.outbox
    .where("entityId")
    .equals(entityId)
    .filter((o) => o.entity === entity)
    .toArray();
  return ops.sort((a, b) => (a.id ?? 0) - (b.id ?? 0)).at(-1);
}

export async function pendingCount(db: PlateDB): Promise<number> {
  return db.outbox.where("status").anyOf("pending", "inflight").count();
}

/** A crash mid-request leaves ops inflight. They go back to pending, which is safe because pushes are idempotent. */
export async function recoverInflight(db: PlateDB): Promise<number> {
  return db.outbox.where("status").equals("inflight").modify({ status: "pending" });
}

export async function retryFailed(db: PlateDB): Promise<void> {
  await db.outbox
    .where("status")
    .equals("failed")
    .modify({ status: "pending", nextAttemptAt: 0, error: undefined });
}

export async function discardFailed(db: PlateDB, id: number): Promise<void> {
  await db.outbox.delete(id);
}

/** Pending ops in drain order: oldest first, never an op with a failed or inflight predecessor for the same row. */
export async function nextBatch(db: PlateDB, now: number, limit: number): Promise<OutboxOp[]> {
  const due = await db.outbox
    .where("status")
    .equals("pending")
    .filter((o) => o.nextAttemptAt <= now)
    .toArray();
  due.sort((a, b) => a.createdAt - b.createdAt || (a.id ?? 0) - (b.id ?? 0));
  return due.slice(0, limit);
}
