import { getMeta, META, setMeta } from "@/db/meta";
import { nextBatch, pendingCount, recoverInflight } from "@/db/outbox";
import type { PlateDB } from "@/db/schema";
import type { OutboxOp } from "@/db/types";
import { uuidv7 } from "@/lib/uuid";
import {
  AuthError,
  NetworkError,
  ProtocolError,
  ResyncRequired,
  ServerError,
  SyncDisabled,
  SyncError,
} from "./errors";
import type { SyncStore } from "./status";
import type { PullChange, PushOp, Transport } from "./transport";
import {
  deletedDoc,
  entryDoc,
  favoriteDoc,
  foodDoc,
  savedMealDoc,
  settingsDoc,
  toEntry,
  toFavorite,
  toFood,
  toMeal,
  toSettings,
} from "./wire";

const BATCH = 100;
const PAGE = 500;
const BACKOFF_SECONDS = [1, 2, 4, 8, 16, 30, 60] as const;
const LEASE_MS = 15_000;
const MAX_ROUNDS = 4;
const RESCUE_KEEP = 3;

export interface EngineOptions {
  now?: () => number;
  /** Returns a number in [0, 1). Replaced in tests to make jitter deterministic. */
  random?: () => number;
  /** A stable id for this browser tab, used for the lease fallback. */
  tabId?: string;
  locks?: Pick<LockManager, "request"> | null;
}

export interface SyncOutcome {
  ran: boolean;
  reason?: "backoff" | "not-leader" | "paused";
}

export class SyncEngine {
  private readonly now: () => number;
  private readonly random: () => number;
  private readonly tabId: string;
  private readonly locks: Pick<LockManager, "request"> | null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private interval: ReturnType<typeof setInterval> | undefined;
  private running = false;
  private teardown: Array<() => void> = [];

  constructor(
    private readonly db: PlateDB,
    private readonly transport: Transport,
    private readonly status: SyncStore,
    opts: EngineOptions = {},
  ) {
    this.now = opts.now ?? Date.now;
    this.random = opts.random ?? Math.random;
    this.tabId = opts.tabId ?? uuidv7();
    this.locks =
      opts.locks === undefined
        ? typeof navigator !== "undefined" && "locks" in navigator
          ? navigator.locks
          : null
        : opts.locks;
  }

  // ---- lifecycle and triggers ----

  async start(): Promise<void> {
    await recoverInflight(this.db);
    await this.refreshCounts();
    const onOnline = () => void this.trigger(true); // the outage that set the backoff is over
    const onVisible = () => {
      if (document.visibilityState === "visible") void this.trigger();
    };
    window.addEventListener("online", onOnline);
    document.addEventListener("visibilitychange", onVisible);
    this.interval = setInterval(() => {
      if (document.visibilityState === "visible") void this.trigger();
    }, 60_000);
    this.teardown.push(
      () => window.removeEventListener("online", onOnline),
      () => document.removeEventListener("visibilitychange", onVisible),
    );
    void this.trigger();
  }

  stop(): void {
    clearTimeout(this.timer);
    clearInterval(this.interval);
    for (const t of this.teardown) t();
    this.teardown = [];
  }

  /** Called after every local write. Syncs 800 ms later so a burst of edits makes one request. */
  scheduleSoon(delayMs = 800): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.trigger(), delayMs);
  }

  trigger(force = false): Promise<SyncOutcome> {
    return this.syncOnce(force).catch(() => ({ ran: true }));
  }

  // ---- one sync cycle ----

  async syncOnce(force = false): Promise<SyncOutcome> {
    if (this.running) return { ran: false, reason: "not-leader" };
    this.running = true;
    try {
      return await this.withLeader(() => this.cycle(force));
    } finally {
      this.running = false;
    }
  }

  private async withLeader(fn: () => Promise<SyncOutcome>): Promise<SyncOutcome> {
    if (this.locks) {
      const got = await this.locks.request("plate-sync", { ifAvailable: true }, async (lock) =>
        lock ? fn() : null,
      );
      return got ?? { ran: false, reason: "not-leader" };
    }
    if (!(await this.claimLease())) return { ran: false, reason: "not-leader" };
    return fn();
  }

  /** Fallback leadership when Web Locks is missing: a short lease row in Dexie. */
  private async claimLease(): Promise<boolean> {
    return this.db.transaction("rw", this.db.meta, async () => {
      const cur = await getMeta<{ until: number; tab: string }>(this.db, META.leaderUntil);
      if (cur && cur.until > this.now() && cur.tab !== this.tabId) return false;
      await setMeta(this.db, META.leaderUntil, { until: this.now() + LEASE_MS, tab: this.tabId });
      return true;
    });
  }

  private async cycle(force: boolean): Promise<SyncOutcome> {
    const backoff = await getMeta<{ step: number; nextAttemptAt: number }>(this.db, META.backoff);
    if (!force && backoff && backoff.nextAttemptAt > this.now())
      return { ran: false, reason: "backoff" };

    this.status.setState({ state: "syncing", message: null });
    try {
      await this.checkMeta();
      for (let round = 0; round < MAX_ROUNDS; round++) {
        await this.drain();
        await this.pullAll();
        if ((await nextBatch(this.db, this.now(), 1)).length === 0) break;
      }
      await setMeta(this.db, META.backoff, undefined);
      const at = new Date(this.now()).toISOString();
      await setMeta(this.db, META.lastSyncedAt, at);
      this.status.setState({ state: "idle", lastSyncedAt: at, message: null });
      await this.refreshCounts();
      return { ran: true };
    } catch (err) {
      return this.fail(err);
    }
  }

  /** The cheapest request: a reachable /sync/meta proves we are online, and tells a kill switch from an outage. */
  private async checkMeta(): Promise<void> {
    const meta = await this.transport.meta();
    if (!meta.enabled) throw new SyncDisabled();
    const cursor = (await getMeta<number>(this.db, META.cursor)) ?? 0;
    if (cursor < meta.min_seq) throw new ResyncRequired(meta.min_seq);
  }

  private async fail(err: unknown): Promise<SyncOutcome> {
    await recoverInflight(this.db);
    await this.refreshCounts();
    if (err instanceof ResyncRequired) {
      try {
        await this.resync();
        return this.cycle(true);
      } catch (inner) {
        return this.fail(inner);
      }
    }
    if (err instanceof AuthError) {
      this.status.setState({ state: "auth", message: err.message });
      return { ran: true, reason: "paused" };
    }
    if (err instanceof SyncDisabled) {
      this.status.setState({ state: "paused", message: err.message });
      await this.backOff();
      return { ran: true, reason: "paused" };
    }
    if (err instanceof SyncError && err.kind === "access") {
      this.status.setState({ state: "access", message: err.message });
      return { ran: true, reason: "paused" };
    }
    await this.backOff();
    if (err instanceof NetworkError) {
      this.status.setState({ state: "offline", message: err.message });
    } else {
      this.status.setState({
        state: "error",
        message: err instanceof Error ? err.message : "Sync failed.",
      });
    }
    return { ran: true };
  }

  private async backOff(): Promise<void> {
    const cur = await getMeta<{ step: number; nextAttemptAt: number }>(this.db, META.backoff);
    const step = Math.min((cur?.step ?? -1) + 1, BACKOFF_SECONDS.length - 1);
    const base = (BACKOFF_SECONDS[step] ?? 60) * 1000;
    const jitter = 1 + (this.random() * 0.4 - 0.2);
    await setMeta(this.db, META.backoff, {
      step,
      nextAttemptAt: this.now() + Math.round(base * jitter),
    });
  }

  // ---- push ----

  private async drain(): Promise<void> {
    const clientId = await this.clientId();
    for (;;) {
      const batch = await nextBatch(this.db, this.now(), BATCH);
      if (batch.length === 0) return;
      const ids = batch.map((o) => o.id).filter((id): id is number => id !== undefined);
      await this.db.outbox
        .where("id")
        .anyOf(ids)
        .modify((o) => {
          o.status = "inflight";
          o.attempts += 1;
        });
      const res = await this.transport.push(clientId, batch.map(toWire));
      if (res.results.length !== batch.length)
        throw new ProtocolError("The server answered a different number of ops than were sent.");
      await this.settle(batch, res.results);
      await this.refreshCounts();
    }
  }

  private async settle(
    batch: OutboxOp[],
    results: Awaited<ReturnType<Transport["push"]>>["results"],
  ): Promise<void> {
    await this.db.transaction(
      "rw",
      [this.db.outbox, this.db.conflicts, this.db.entries, this.db.foods, this.db.savedMeals],
      async () => {
        for (const [i, op] of batch.entries()) {
          const r = results[i];
          if (!r || r.op_id !== op.opId || op.id === undefined)
            throw new ProtocolError("The server answered ops out of order.");
          switch (r.status) {
            case "applied":
            case "duplicate":
              await this.db.outbox.delete(op.id);
              if (r.conflict) {
                await this.db.conflicts.add({
                  at: new Date(this.now()).toISOString(),
                  entity: op.entity,
                  entityId: op.entityId,
                  serverSeq: r.server_seq ?? 0,
                });
              }
              break;
            case "tombstoned":
              await this.db.outbox.delete(op.id);
              await this.markDeletedLocally(op, r.tombstone);
              break;
            case "rejected":
              await this.db.outbox.update(op.id, {
                status: "failed",
                error: {
                  code: r.problem?.code ?? "rejected",
                  detail: r.problem?.detail ?? "The server rejected this change.",
                },
              });
              break;
          }
        }
      },
    );
  }

  private async markDeletedLocally(op: OutboxOp, tombstone: unknown): Promise<void> {
    const at = readDeletedAt(tombstone) ?? new Date(this.now()).toISOString();
    if (op.entity === "entry") await this.db.entries.update(op.entityId, { deletedAt: at });
    if (op.entity === "food")
      await this.db.foods.update(op.entityId, { deletedAt: at, barcode: null });
    if (op.entity === "saved_meal") await this.db.savedMeals.update(op.entityId, { deletedAt: at });
  }

  // ---- pull ----

  private async pullAll(): Promise<void> {
    for (;;) {
      const cursor = (await getMeta<number>(this.db, META.cursor)) ?? 0;
      const page = await this.transport.pull(cursor, PAGE);
      await this.applyPage(page.changes, page.next, cursor);
      if (!page.has_more) return;
    }
  }

  /** One transaction per page: the rows and the cursor commit together or not at all. */
  private async applyPage(changes: PullChange[], next: number, cursor: number): Promise<void> {
    const tables = [
      this.db.entries,
      this.db.foods,
      this.db.settings,
      this.db.savedMeals,
      this.db.savedMealItems,
      this.db.favorites,
      this.db.outbox,
      this.db.meta,
    ];
    await this.db.transaction("rw", tables, async () => {
      for (const change of changes) {
        if (change.seq <= cursor) continue;
        await this.applyChange(change);
      }
      if (next > cursor) await setMeta(this.db, META.cursor, next);
    });
  }

  private async hasPendingUpsert(entity: string, id: string): Promise<boolean> {
    const n = await this.db.outbox
      .where("entityId")
      .equals(id)
      .filter((o) => o.entity === entity && o.type === "upsert" && o.status !== "failed")
      .count();
    return n > 0;
  }

  private async applyChange(change: PullChange): Promise<void> {
    const bad = (what: string, err: unknown): never => {
      throw new ProtocolError(
        `Change ${change.seq} (${what}) is not valid: ${err instanceof Error ? err.message : String(err)}`,
      );
    };
    if (change.op === "delete") {
      const parsed = deletedDoc.safeParse(change.data);
      if (!parsed.success) bad(change.entity, parsed.error);
      const at = parsed.success
        ? (parsed.data.deleted_at ?? new Date(this.now()).toISOString())
        : "";
      await this.applyDelete(change, at);
      return;
    }
    // A pending local edit wins: it will be pushed after this pull and the server keeps the last write it receives.
    if (change.entity !== "settings" && (await this.hasPendingUpsert(change.entity, change.id)))
      return;

    switch (change.entity) {
      case "entry": {
        const p = entryDoc.safeParse(change.data);
        if (!p.success) return bad("entry", p.error);
        await this.db.entries.put(toEntry(p.data));
        return;
      }
      case "food": {
        const p = foodDoc.safeParse(change.data);
        if (!p.success) return bad("food", p.error);
        const food = toFood(p.data);
        const existing = await this.db.foods.get(food.id);
        if (food.barcode)
          await this.db.foods
            .where("barcode")
            .equals(food.barcode)
            .filter((f) => f.id !== food.id)
            .delete();
        await this.db.foods.put({ ...food, imagePath: existing?.imagePath ?? null });
        return;
      }
      case "settings": {
        const p = settingsDoc.safeParse(change.data);
        if (!p.success) return bad("settings", p.error);
        const userId = (await getMeta<string>(this.db, META.userId)) ?? change.id;
        await this.db.settings.put(toSettings(userId, p.data));
        return;
      }
      case "saved_meal": {
        const p = savedMealDoc.safeParse(change.data);
        if (!p.success) return bad("saved_meal", p.error);
        const { meal, items } = toMeal(p.data);
        await this.db.savedMealItems.where("savedMealId").equals(meal.id).delete();
        await this.db.savedMeals.put(meal);
        await this.db.savedMealItems.bulkPut(items);
        return;
      }
      case "favorite": {
        const p = favoriteDoc.safeParse(change.data);
        if (!p.success) return bad("favorite", p.error);
        await this.db.favorites.put(toFavorite(p.data));
        return;
      }
      default:
        throw new ProtocolError(`Unknown entity ${change.entity}`);
    }
  }

  private async applyDelete(change: PullChange, at: string): Promise<void> {
    switch (change.entity) {
      case "entry":
        await this.db.entries.update(change.id, { deletedAt: at, serverSeq: change.seq });
        return;
      case "food":
        await this.db.foods.update(change.id, {
          deletedAt: at,
          barcode: null,
          serverSeq: change.seq,
        });
        return;
      case "saved_meal":
        await this.db.savedMeals.update(change.id, { deletedAt: at, serverSeq: change.seq });
        await this.db.savedMealItems.where("savedMealId").equals(change.id).delete();
        return;
      case "favorite":
        await this.db.favorites.delete(change.id);
        return;
      case "settings":
        return;
      default:
        throw new ProtocolError(`Unknown entity ${change.entity}`);
    }
  }

  // ---- resync after a retention gap ----

  /**
   * Replace local synced rows from a snapshot. Rows with unsent edits are kept, and their ops are re-queued under new
   * op ids so a stale record on the server cannot mistake them for something already applied.
   */
  async resync(): Promise<void> {
    const snap = await this.transport.snapshot();
    const entries = snap.entries.map((e) => parse(entryDoc, e, "entry")).map(toEntry);
    const foods = snap.foods.map((f) => parse(foodDoc, f, "food")).map(toFood);
    const meals = snap.saved_meals.map((m) => toMeal(parse(savedMealDoc, m, "saved meal")));
    const favorites = snap.favorites.map((f) => toFavorite(parse(favoriteDoc, f, "favorite")));
    const userId = (await getMeta<string>(this.db, META.userId)) ?? "";
    const settings =
      snap.settings === undefined
        ? null
        : toSettings(userId, parse(settingsDoc, snap.settings, "settings"));

    const tables = [
      this.db.entries,
      this.db.foods,
      this.db.settings,
      this.db.savedMeals,
      this.db.savedMealItems,
      this.db.favorites,
      this.db.outbox,
      this.db.meta,
    ];
    await this.db.transaction("rw", tables, async () => {
      const ops = await this.db.outbox.toArray();
      const held = new Set(ops.map((o) => `${o.entity}:${o.entityId}`));
      await this.saveRescue(ops);

      await this.db.entries.filter((e) => !held.has(`entry:${e.id}`)).delete();
      await this.db.entries.bulkPut(entries.filter((e) => !held.has(`entry:${e.id}`)));
      await this.db.foods.filter((f) => f.source === "user" && !held.has(`food:${f.id}`)).delete();
      await this.db.foods.bulkPut(foods.filter((f) => !held.has(`food:${f.id}`)));
      await this.db.savedMeals.filter((m) => !held.has(`saved_meal:${m.id}`)).delete();
      await this.db.savedMealItems.filter((i) => !held.has(`saved_meal:${i.savedMealId}`)).delete();
      for (const { meal, items } of meals) {
        if (held.has(`saved_meal:${meal.id}`)) continue;
        await this.db.savedMeals.put(meal);
        await this.db.savedMealItems.bulkPut(items);
      }
      await this.db.favorites.filter((f) => !held.has(`favorite:${f.foodId}`)).delete();
      await this.db.favorites.bulkPut(favorites.filter((f) => !held.has(`favorite:${f.foodId}`)));
      if (settings && !held.has(`settings:${settings.userId}`))
        await this.db.settings.put(settings);

      for (const op of ops) {
        if (op.id === undefined) continue;
        await this.db.outbox.update(op.id, {
          opId: uuidv7(this.now()),
          status: "pending",
          nextAttemptAt: 0,
          error: undefined,
        });
      }
      await setMeta(this.db, META.cursor, snap.cursor);
      await setMeta(this.db, META.resyncedAt, new Date(this.now()).toISOString());
    });
    this.status.setState({ resyncedAt: new Date(this.now()).toISOString() });
  }

  private async saveRescue(ops: OutboxOp[]): Promise<void> {
    const at = new Date(this.now()).toISOString();
    const keys = (await this.db.meta.toArray())
      .map((m) => m.key)
      .filter((k) => k.startsWith("rescue:"))
      .sort();
    for (const k of keys.slice(0, Math.max(0, keys.length - (RESCUE_KEEP - 1))))
      await this.db.meta.delete(k);
    await setMeta(this.db, `rescue:${at}`, {
      at,
      ops,
      entries: await this.db.entries.toArray(),
      foods: await this.db.foods.filter((f) => f.source === "user").toArray(),
    });
  }

  // ---- helpers ----

  private async clientId(): Promise<string> {
    const existing = await getMeta<string>(this.db, "clientId");
    if (existing) return existing;
    const id = uuidv7(this.now());
    await setMeta(this.db, "clientId", id);
    return id;
  }

  async refreshCounts(): Promise<void> {
    const [pending, failed, conflicts, lastSyncedAt, resyncedAt] = await Promise.all([
      pendingCount(this.db),
      this.db.outbox.where("status").equals("failed").count(),
      this.db.conflicts.count(),
      getMeta<string>(this.db, META.lastSyncedAt),
      getMeta<string>(this.db, META.resyncedAt),
    ]);
    this.status.setState({
      pending,
      failed,
      conflicts,
      lastSyncedAt: lastSyncedAt ?? null,
      resyncedAt: resyncedAt ?? null,
    });
  }
}

function toWire(op: OutboxOp): PushOp {
  return {
    op_id: op.opId,
    entity: op.entity,
    type: op.type,
    id: op.entityId,
    ...(op.baseSeq !== undefined ? { base_seq: op.baseSeq } : {}),
    client_ts: op.clientTs,
    ...(op.type === "upsert" && op.data !== undefined ? { data: op.data } : {}),
  };
}

function readDeletedAt(doc: unknown): string | null {
  if (
    typeof doc === "object" &&
    doc !== null &&
    "deleted_at" in doc &&
    typeof doc.deleted_at === "string"
  )
    return doc.deleted_at;
  return null;
}

function parse<T>(
  schema: { safeParse(v: unknown): { success: true; data: T } | { success: false; error: Error } },
  v: unknown,
  what: string,
): T {
  const r = schema.safeParse(v);
  if (!r.success) throw new ProtocolError(`Snapshot ${what} is not valid: ${r.error.message}`);
  return r.data;
}

export { AuthError, NetworkError, ServerError };
