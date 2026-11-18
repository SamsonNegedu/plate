import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  buildEntry,
  deleteEntry,
  type NewEntry,
  saveEntry,
  undoAdd,
  undoDelete,
} from "@/db/entries";
import { getMeta, META, setMeta } from "@/db/meta";
import { PlateDB } from "@/db/schema";
import { FakeServer } from "@/test/fakeServer";
import { SyncEngine } from "./engine";
import { createSyncStore } from "./status";

let n = 0;
const dbs: PlateDB[] = [];

function freshDb(name = `plate-test-${++n}`): PlateDB {
  const db = new PlateDB(name);
  dbs.push(db);
  return db;
}

afterEach(async () => {
  await Promise.all(
    dbs.splice(0).map(async (d) => {
      d.close();
      await d.delete();
    }),
  );
  vi.useRealTimers();
});

const base: NewEntry = {
  eatenOn: "2026-11-13",
  meal: "lunch",
  foodId: null,
  name: "Oats",
  brand: "",
  barcode: null,
  amount: 40,
  unit: "g",
  grams: 40,
  kcal: 370,
  protein: 13,
  carbs: null,
  fat: null,
  sugar: null,
  satfat: null,
  fiber: null,
  salt: null,
};

function setup(server = new FakeServer(), db = freshDb()) {
  const status = createSyncStore();
  let clock = 1_800_000_000_000;
  const engine = new SyncEngine(db, server, status, {
    now: () => clock,
    random: () => 0.5,
    locks: null,
  });
  return {
    db,
    server,
    status,
    engine,
    tick: (ms: number) => {
      clock += ms;
    },
    clock: () => clock,
  };
}

async function add(db: PlateDB, mods: Partial<NewEntry> = {}, now?: number) {
  const e = buildEntry({ ...base, ...mods }, now);
  await saveEntry(db, e, now);
  return e;
}

describe("sync engine", () => {
  test("an offline create survives a reload and syncs later", async () => {
    const { db, server } = setup();
    server.offline = true;
    const e = await add(db);
    const name = db.name;
    db.close();
    const reopened = freshDb(name);
    expect(await reopened.entries.get(e.id)).toMatchObject({ name: "Oats", serverSeq: 0 });
    expect(await reopened.outbox.count()).toBe(1);

    server.offline = false;
    const s = setup(server, reopened);
    await s.engine.syncOnce(true);
    expect(await reopened.outbox.count()).toBe(0);
    expect((await reopened.entries.get(e.id))?.serverSeq).toBeGreaterThan(0);
    expect(s.status.getState().state).toBe("idle");
  });

  test("a push, a pull and a status that tells the truth", async () => {
    const { db, server, status, engine } = setup();
    await add(db);
    await add(db, { name: "Milk" });
    expect(await getPending(db)).toBe(2);
    await engine.syncOnce();
    expect(server.rows.size).toBe(2);
    expect(status.getState()).toMatchObject({ state: "idle", pending: 0, failed: 0 });
    expect(status.getState().lastSyncedAt).not.toBeNull();
  });

  test("a replayed batch after a lost response does not duplicate rows", async () => {
    const { db, server, engine, tick } = setup();
    await add(db);
    server.loseNextResponse = true;
    await engine.syncOnce();
    expect(server.rows.size).toBe(1);
    expect(await getPending(db)).toBe(1); // the client never saw the answer
    tick(2 * 60_000);
    await engine.syncOnce(true);
    expect(server.rows.size).toBe(1);
    expect([...server.appliedCount.values()].every((c) => c === 1)).toBe(true);
    expect(await getPending(db)).toBe(0);
  });

  test("a crash mid-push returns inflight ops to pending on start", async () => {
    const { db, server, status } = setup();
    const e = await add(db);
    await db.outbox.toCollection().modify({ status: "inflight" });
    const fresh = setup(server, db);
    await fresh.engine.start();
    fresh.engine.stop();
    await vi.waitFor(async () =>
      expect((await db.entries.get(e.id))?.serverSeq).toBeGreaterThan(0),
    );
    expect(server.rows.size).toBe(1);
    expect(status.getState().state).toBe("idle");
  });

  test("a rejected op is visible and does not block later ops", async () => {
    const { db, server, engine, status } = setup();
    const bad = await add(db, { name: "Bad" }, 1_000);
    const good = await add(db, { name: "Good" }, 2_000);
    server.rejectPredicate = (op) => op.id === bad.id;
    await engine.syncOnce();
    expect(server.rows.has(`entry:${good.id}`)).toBe(true);
    const failed = await db.outbox.where("status").equals("failed").toArray();
    expect(failed).toHaveLength(1);
    expect(failed[0]?.error?.code).toBe("validation_failed");
    expect(status.getState().failed).toBe(1);
    expect(status.getState().state).toBe("idle");
  });

  test("pull applies in order and the cursor advances with the rows", async () => {
    const { db, server, engine } = setup();
    for (let i = 0; i < 5; i++)
      server.inject(
        "entry",
        `0190a1b2-0000-7000-8000-00000000000${i}`,
        entryDoc(`0190a1b2-0000-7000-8000-00000000000${i}`, `Food ${i}`),
      );
    await engine.syncOnce();
    expect(await db.entries.count()).toBe(5);
    expect(await getMeta<number>(db, META.cursor)).toBe(5);
    await engine.syncOnce(true);
    expect(await db.entries.count()).toBe(5);
  });

  test("a bad change fails the whole page: nothing applies and the cursor stays", async () => {
    const { db, server, engine, status } = setup();
    server.inject(
      "entry",
      "0190a1b2-0000-7000-8000-000000000001",
      entryDoc("0190a1b2-0000-7000-8000-000000000001", "Fine"),
    );
    server.inject("entry", "0190a1b2-0000-7000-8000-000000000002", { name: 42 });
    await engine.syncOnce();
    expect(await db.entries.count()).toBe(0);
    expect(await getMeta<number>(db, META.cursor)).toBeUndefined();
    expect(status.getState().state).toBe("error");
  });

  test("a pull that fails midway leaves the cursor where it was", async () => {
    const { db, server, engine } = setup();
    server.inject(
      "entry",
      "0190a1b2-0000-7000-8000-000000000001",
      entryDoc("0190a1b2-0000-7000-8000-000000000001", "A"),
    );
    server.failNextPull = true;
    await engine.syncOnce();
    expect(await getMeta<number>(db, META.cursor)).toBeUndefined();
    await engine.syncOnce(true);
    expect(await db.entries.count()).toBe(1);
  });

  test("a pending local edit is not overwritten by an older server row", async () => {
    const { db, server, engine } = setup();
    const e = await add(db, { name: "Local" });
    server.inject("entry", e.id, entryDoc(e.id, "Server"));
    server.offline = true;
    await engine.syncOnce();
    server.offline = false;
    await engine.syncOnce(true);
    expect((await db.entries.get(e.id))?.name).toBe("Local");
    expect(server.rows.get(`entry:${e.id}`)?.doc.name).toBe("Local");
  });

  test("a server delete reaches the client as a tombstone", async () => {
    const a = setup();
    const e = await add(a.db);
    await a.engine.syncOnce();
    const b = setup(a.server);
    await b.engine.syncOnce();
    expect((await b.db.entries.get(e.id))?.deletedAt).toBeNull();
    await deleteEntry(a.db, e.id);
    await a.engine.syncOnce();
    await b.engine.syncOnce();
    expect((await b.db.entries.get(e.id))?.deletedAt).not.toBeNull();
  });

  test("an edit of a deleted row comes back tombstoned and the client keeps it deleted", async () => {
    const a = setup();
    const b = setup(a.server);
    const e = await add(a.db);
    await a.engine.syncOnce();
    await b.engine.syncOnce();
    await deleteEntry(a.db, e.id);
    await a.engine.syncOnce();
    const row = await b.db.entries.get(e.id);
    if (!row) throw new Error("missing");
    await saveEntry(b.db, { ...row, name: "Edited after delete" });
    await b.engine.syncOnce();
    expect((await b.db.entries.get(e.id))?.deletedAt).not.toBeNull();
    expect(await b.db.outbox.count()).toBe(0);
  });

  test("a conflict is recorded when the server row was newer", async () => {
    const a = setup();
    const b = setup(a.server);
    const e = await add(a.db);
    await a.engine.syncOnce();
    await b.engine.syncOnce();
    const mine = await a.db.entries.get(e.id);
    const theirs = await b.db.entries.get(e.id);
    if (!mine || !theirs) throw new Error("missing");
    await saveEntry(a.db, { ...mine, name: "From A" });
    await saveEntry(b.db, { ...theirs, name: "From B" });
    await a.engine.syncOnce();
    await b.engine.syncOnce();
    expect(await b.db.conflicts.count()).toBe(1);
    expect(b.status.getState().conflicts).toBe(1);
    await a.engine.syncOnce(true);
    await b.engine.syncOnce(true);
    expect((await a.db.entries.get(e.id))?.name).toBe((await b.db.entries.get(e.id))?.name);
  });

  test("backoff follows 1, 2, 4, 8, 16, 30, 60 seconds and resets on success", async () => {
    const { db, server, engine, tick, clock } = setup();
    await add(db);
    server.offline = true;
    const waits: number[] = [];
    for (let i = 0; i < 8; i++) {
      await engine.syncOnce(true);
      const b = await getMeta<{ step: number; nextAttemptAt: number }>(db, META.backoff);
      waits.push(Math.round(((b?.nextAttemptAt ?? 0) - clock()) / 1000));
      tick(61_000);
    }
    expect(waits).toEqual([1, 2, 4, 8, 16, 30, 60, 60]);
    server.offline = false;
    await engine.syncOnce(true);
    expect(await getMeta(db, META.backoff)).toBeUndefined();
  });

  test("backoff is skipped until its time and applies jitter within 20 percent", async () => {
    const lo = setup(new FakeServer());
    const hi = setup(new FakeServer());
    lo.server.offline = hi.server.offline = true;
    const low = new SyncEngine(lo.db, lo.server, lo.status, {
      now: () => 1_000,
      random: () => 0,
      locks: null,
    });
    const high = new SyncEngine(hi.db, hi.server, hi.status, {
      now: () => 1_000,
      random: () => 0.999,
      locks: null,
    });
    await low.syncOnce(true);
    await high.syncOnce(true);
    const a = (await getMeta<{ nextAttemptAt: number }>(lo.db, META.backoff))?.nextAttemptAt ?? 0;
    const b = (await getMeta<{ nextAttemptAt: number }>(hi.db, META.backoff))?.nextAttemptAt ?? 0;
    expect(a - 1_000).toBe(800);
    expect(b - 1_000).toBeGreaterThanOrEqual(1190);
    expect(b - 1_000).toBeLessThanOrEqual(1200);
    expect(await low.syncOnce()).toEqual({ ran: false, reason: "backoff" });
  });

  test("coming back online syncs at once, even inside the backoff window", async () => {
    const { db, server, engine, status } = setup();
    await add(db);
    server.offline = true;
    await engine.syncOnce(true);
    expect(status.getState().state).toBe("offline");
    expect(await engine.syncOnce()).toEqual({ ran: false, reason: "backoff" });

    await engine.start();
    await new Promise((r) => setTimeout(r, 50)); // let start()'s own first cycle finish, as a real event would arrive later
    server.offline = false;
    window.dispatchEvent(new Event("online"));
    await vi.waitFor(async () => expect(await db.outbox.count()).toBe(0));
    expect(status.getState().state).toBe("idle");
    engine.stop();
  });

  test("a 401 pauses sync, keeps the outbox and asks for login", async () => {
    const { db, server, engine, status } = setup();
    await add(db);
    server.unauthorized = true;
    await engine.syncOnce();
    expect(status.getState().state).toBe("auth");
    expect(await getPending(db)).toBe(1);
    expect(await db.entries.count()).toBe(1);
  });

  test("an HTML answer from Cloudflare Access is a sign-in prompt, not a server error", async () => {
    const { db, server, engine, status } = setup();
    await add(db);
    server.html = true;
    await engine.syncOnce();
    expect(status.getState().state).toBe("access");
    expect(await getPending(db)).toBe(1);
  });

  test("the server kill switch pauses sync but never touches local data", async () => {
    const { db, server, engine, status } = setup();
    await add(db);
    server.enabled = false;
    await engine.syncOnce();
    expect(status.getState()).toMatchObject({ state: "paused", pending: 1 });
    expect(await db.entries.count()).toBe(1);
    server.enabled = true;
    await engine.syncOnce(true);
    expect(status.getState()).toMatchObject({ state: "idle", pending: 0 });
    expect(server.rows.size).toBe(1);
  });

  test("two tabs sharing one database never push the same ops twice", async () => {
    const server = new FakeServer();
    const db = freshDb();
    const a = setup(server, db);
    const b = new SyncEngine(db, server, createSyncStore(), {
      now: a.clock,
      locks: null,
      tabId: "tab-b",
    });
    for (let i = 0; i < 5; i++) await add(db, { name: `F${i}` });
    const [ra, rb] = await Promise.all([a.engine.syncOnce(true), b.syncOnce(true)]);
    expect([ra.ran, rb.ran].filter(Boolean)).toHaveLength(1);
    expect(server.pushCalls).toBe(1);
    expect([...server.appliedCount.values()].every((c) => c === 1)).toBe(true);
  });

  test("Web Locks elect a single drainer when available", async () => {
    let held = false;
    const locks = {
      request: async (_n: string, _o: unknown, cb: (l: unknown) => Promise<unknown>) => {
        if (held) return cb(null);
        held = true;
        try {
          return await cb({});
        } finally {
          held = false;
        }
      },
    } as unknown as LockManager;
    const server = new FakeServer();
    const db = freshDb();
    const mk = () => new SyncEngine(db, server, createSyncStore(), { locks });
    await add(db);
    const [x, y] = [mk(), mk()];
    const out = await Promise.all([x.syncOnce(true), y.syncOnce(true)]);
    expect(out.filter((o) => o.ran)).toHaveLength(1);
    expect(server.pushCalls).toBe(1);
  });

  test("a retention gap triggers a snapshot resync that keeps pending user ops", async () => {
    const a = setup();
    const e1 = await add(a.db, { name: "Synced" }, 1_000);
    await a.engine.syncOnce();
    // another device adds entries, the server prunes its stream past this client's cursor
    const other = setup(a.server);
    await add(other.db, { name: "Elsewhere" }, 3_000);
    await other.engine.syncOnce();
    a.server.prune(a.server.seq);
    // meanwhile this client created something offline
    a.server.offline = true;
    const local = await add(a.db, { name: "Made offline" }, 5_000);
    await a.engine.syncOnce();
    a.server.offline = false;
    await a.engine.syncOnce(true);

    const names = (await a.db.entries.toArray())
      .filter((e) => !e.deletedAt)
      .map((e) => e.name)
      .sort();
    expect(names).toEqual(["Elsewhere", "Made offline", "Synced"]);
    expect(await getPending(a.db)).toBe(0);
    expect(a.server.rows.has(`entry:${local.id}`)).toBe(true);
    expect(a.server.rows.has(`entry:${e1.id}`)).toBe(true);
    expect(await getMeta(a.db, META.resyncedAt)).toBeTruthy();
    const rescue = (await a.db.meta.toArray()).filter((m) => m.key.startsWith("rescue:"));
    expect(rescue).toHaveLength(1);
    expect(a.status.getState().resyncedAt).toBeTruthy();
  });

  test("a resync requeues pending ops under new op ids", async () => {
    const a = setup();
    await add(a.db, { name: "Unsent" });
    const before = (await a.db.outbox.toArray())[0]?.opId;
    a.server.prune(0);
    a.server.minSeq = 3;
    a.server.seq = 3;
    await setMeta(a.db, META.cursor, 0);
    await a.engine.resync();
    const after = (await a.db.outbox.toArray())[0];
    expect(after?.opId).not.toBe(before);
    expect(after?.status).toBe("pending");
  });
});

describe("undo", () => {
  test("undoing an add before it syncs leaves no trace", async () => {
    const { db } = setup();
    const e = await add(db);
    await undoAdd(db, e.id);
    expect(await db.entries.count()).toBe(0);
    expect(await db.outbox.count()).toBe(0);
  });

  test("undoing an add after it synced deletes it with a tombstone", async () => {
    const { db, engine, server } = setup();
    const e = await add(db);
    await engine.syncOnce();
    await undoAdd(db, e.id);
    await engine.syncOnce();
    expect(server.rows.get(`entry:${e.id}`)?.deleted).toBe(true);
    expect((await db.entries.get(e.id))?.deletedAt).not.toBeNull();
  });

  test("undoing a delete before it syncs cancels the op and restores the row", async () => {
    const { db, engine } = setup();
    const e = await add(db);
    await engine.syncOnce();
    await deleteEntry(db, e.id);
    const restored = await undoDelete(db, e.id);
    expect(restored).toBe(e.id);
    expect((await db.entries.get(e.id))?.deletedAt).toBeNull();
    expect(await db.outbox.count()).toBe(0);
  });

  test("undoing a delete after it synced creates a new entry and leaves the tombstone", async () => {
    const { db, engine, server } = setup();
    const e = await add(db);
    await engine.syncOnce();
    await deleteEntry(db, e.id);
    await engine.syncOnce();
    const restored = await undoDelete(db, e.id);
    expect(restored).not.toBe(e.id);
    await engine.syncOnce();
    expect(server.rows.get(`entry:${e.id}`)?.deleted).toBe(true);
    expect(server.rows.get(`entry:${restored}`)?.deleted).toBe(false);
    expect((await db.entries.get(e.id))?.deletedAt).not.toBeNull();
  });

  test("consecutive edits before a sync coalesce into one op", async () => {
    const { db } = setup();
    const e = await add(db);
    await saveEntry(db, { ...e, amount: 50, grams: 50 });
    await saveEntry(db, { ...e, amount: 60, grams: 60 });
    expect(await db.outbox.count()).toBe(1);
    expect((await db.outbox.toArray())[0]?.data).toMatchObject({ amount: 60 });
  });
});

async function getPending(db: PlateDB): Promise<number> {
  return db.outbox.where("status").anyOf("pending", "inflight").count();
}

function entryDoc(id: string, name: string): Record<string, unknown> {
  return {
    eaten_on: "2026-11-13",
    meal: "lunch",
    food_id: null,
    name,
    brand: "",
    barcode: null,
    amount: 40,
    unit: "g",
    grams: 40,
    kcal: 370,
    protein: null,
    carbs: null,
    fat: null,
    sugar: null,
    satfat: null,
    fiber: null,
    salt: null,
    note: "",
    client_updated_at: "2026-11-13T08:00:00Z",
    created_at: "2026-11-13T08:00:00Z",
    id,
  };
}

beforeEach(() => {
  n += 0;
});
