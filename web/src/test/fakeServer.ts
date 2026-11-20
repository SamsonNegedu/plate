import { AccessExpired, AuthError, NetworkError, ResyncRequired } from "@/sync/errors";
import type {
  MetaResponse,
  PullChange,
  PullResponse,
  PushOp,
  PushResponse,
  PushResult,
  SnapshotResponse,
  Transport,
  WireEntity,
} from "@/sync/transport";

interface Row {
  doc: Record<string, unknown>;
  deleted: boolean;
}

/** An in-memory server that follows the Go server's rules: op-id idempotency, tombstones, last write wins, a change stream. */
export class FakeServer implements Transport {
  seq = 0;
  minSeq = 0;
  enabled = true;
  offline = false;
  unauthorized = false;
  html = false;
  /** Apply the batch but fail the response, like a connection lost after the server committed. */
  loseNextResponse = false;
  failNextPull = false;
  rows = new Map<string, Row>();
  changes: PullChange[] = [];
  applied = new Map<string, { seq: number; conflict: boolean }>();
  /** How many times each op id was applied for the first time. */
  appliedCount = new Map<string, number>();
  pushCalls = 0;
  rejectPredicate: (op: PushOp) => boolean = () => false;

  private gate(): void {
    if (this.offline) throw new NetworkError();
    if (this.unauthorized) throw new AuthError();
    if (this.html) throw new AccessExpired();
  }

  async meta(): Promise<MetaResponse> {
    this.gate();
    return {
      enabled: this.enabled,
      head: this.seq,
      min_seq: this.minSeq,
      server_time: new Date().toISOString(),
    };
  }

  async push(_clientId: string, ops: PushOp[]): Promise<PushResponse> {
    this.gate();
    this.pushCalls++;
    const results: PushResult[] = ops.map((op) => this.applyOp(op));
    if (this.loseNextResponse) {
      this.loseNextResponse = false;
      throw new NetworkError("connection lost");
    }
    return { results, cursor: this.seq };
  }

  private applyOp(op: PushOp): PushResult {
    const done = this.applied.get(op.op_id);
    if (done)
      return {
        op_id: op.op_id,
        status: "duplicate",
        server_seq: done.seq,
        conflict: done.conflict,
      };
    if (this.rejectPredicate(op)) {
      return {
        op_id: op.op_id,
        status: "rejected",
        problem: { code: "validation_failed", detail: "rejected by the test" },
      };
    }
    const key = `${op.entity}:${op.id}`;
    const existing = this.rows.get(key);
    let conflict = false;

    if (op.type === "delete") {
      if (!existing)
        return {
          op_id: op.op_id,
          status: "rejected",
          problem: { code: "not_found", detail: "no such row" },
        };
      if (!existing.deleted) {
        existing.deleted = true;
        existing.doc = { ...existing.doc, deleted_at: new Date().toISOString() };
        this.record(op, key, "delete", existing.doc);
      }
    } else {
      if (existing?.deleted)
        return { op_id: op.op_id, status: "tombstoned", tombstone: existing.doc };
      if (existing && op.base_seq !== undefined && Number(existing.doc.server_seq) > op.base_seq)
        conflict = true;
      const created = existing ? existing.doc.created_at : new Date().toISOString();
      const doc = {
        ...(op.data as Record<string, unknown>),
        id: op.id,
        created_at: created,
        updated_at: new Date().toISOString(),
        deleted_at: null,
        server_seq: 0,
      };
      this.rows.set(key, { doc, deleted: false });
      this.record(op, key, "upsert", doc);
    }
    const seq = this.seq;
    this.applied.set(op.op_id, { seq, conflict });
    this.appliedCount.set(op.op_id, (this.appliedCount.get(op.op_id) ?? 0) + 1);
    return { op_id: op.op_id, status: "applied", server_seq: seq, conflict };
  }

  private record(
    op: PushOp,
    key: string,
    kind: "upsert" | "delete",
    doc: Record<string, unknown>,
  ): void {
    this.seq++;
    const row = this.rows.get(key);
    if (row) row.doc = { ...row.doc, server_seq: this.seq };
    this.changes.push({
      seq: this.seq,
      entity: op.entity,
      id: op.id,
      op: kind,
      data: kind === "delete" ? { deleted_at: doc.deleted_at } : { ...doc, server_seq: this.seq },
    });
  }

  async pull(since: number, limit: number): Promise<PullResponse> {
    this.gate();
    if (this.failNextPull) {
      this.failNextPull = false;
      throw new NetworkError("pull failed");
    }
    if (since < this.minSeq) throw new ResyncRequired(this.minSeq);
    const rest = this.changes.filter((c) => c.seq > since);
    const page = rest.slice(0, limit);
    return { changes: page, next: page.at(-1)?.seq ?? since, has_more: rest.length > limit };
  }

  async snapshot(): Promise<SnapshotResponse> {
    this.gate();
    const live = (entity: string) =>
      [...this.rows.entries()]
        .filter(([k, r]) => k.startsWith(`${entity}:`) && !r.deleted)
        .map(([, r]) => r.doc);
    return {
      cursor: this.seq,
      min_seq: this.minSeq,
      foods: live("food"),
      entries: live("entry"),
      saved_meals: live("saved_meal"),
      favorites: live("favorite"),
      health_records: live("health_record"),
    };
  }

  /** Put a row on the server directly, as if another device had written it. */
  inject(entity: WireEntity, id: string, doc: Record<string, unknown>): void {
    const op: PushOp = {
      op_id: `injected-${this.seq + 1}`,
      entity,
      type: "upsert",
      id,
      client_ts: "",
      data: doc,
    };
    const full = {
      ...doc,
      id,
      updated_at: new Date().toISOString(),
      deleted_at: null,
      server_seq: 0,
    };
    this.rows.set(`${entity}:${id}`, { doc: full, deleted: false });
    this.record(op, `${entity}:${id}`, "upsert", full);
  }

  /** Simulate retention: drop old changes and raise min_seq. */
  prune(upTo: number): void {
    this.changes = this.changes.filter((c) => c.seq > upTo);
    this.minSeq = upTo;
  }
}
