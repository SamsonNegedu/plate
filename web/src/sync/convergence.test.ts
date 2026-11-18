import { afterEach, expect, test } from "vitest";
import { buildEntry, deleteEntry, type NewEntry, saveEntry } from "@/db/entries";
import { PlateDB } from "@/db/schema";
import { FakeServer } from "@/test/fakeServer";
import { SyncEngine } from "./engine";
import { createSyncStore } from "./status";

/** A small seeded generator so a failing run can be replayed. */
function rng(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

const dbs: PlateDB[] = [];
afterEach(async () => {
  await Promise.all(
    dbs.splice(0).map(async (d) => {
      d.close();
      await d.delete();
    }),
  );
});

const base: NewEntry = {
  eatenOn: "2026-11-13",
  meal: "lunch",
  foodId: null,
  name: "x",
  brand: "",
  barcode: null,
  amount: 10,
  unit: "g",
  grams: 10,
  kcal: 100,
  protein: null,
  carbs: null,
  fat: null,
  sugar: null,
  satfat: null,
  fiber: null,
  salt: null,
};

test("two clients converge after 1000 random creates, edits, deletes, outages and replays", async () => {
  const rand = rng(20261113);
  const server = new FakeServer();
  let clock = 1_800_000_000_000;
  const mk = (name: string) => {
    const db = new PlateDB(name);
    dbs.push(db);
    return {
      db,
      engine: new SyncEngine(db, server, createSyncStore(), {
        now: () => clock,
        random: () => 0.5,
        locks: null,
      }),
    };
  };
  const clients = [mk("conv-a"), mk("conv-b")];

  const live = async (db: PlateDB) => (await db.entries.toArray()).filter((e) => !e.deletedAt);

  for (let i = 0; i < 1000; i++) {
    clock += 1000;
    const c = clients[Math.floor(rand() * 2)];
    if (!c) throw new Error("no client");
    const r = rand();
    if (r < 0.3) {
      await saveEntry(
        c.db,
        buildEntry(
          {
            ...base,
            name: `n${i}`,
            amount: 1 + Math.floor(rand() * 500),
            grams: 1 + Math.floor(rand() * 500),
          },
          clock,
        ),
        clock,
      );
    } else if (r < 0.55) {
      const rows = await live(c.db);
      const row = rows[Math.floor(rand() * rows.length)];
      if (row) {
        const amount = 1 + Math.floor(rand() * 500);
        await saveEntry(c.db, { ...row, name: `e${i}`, amount, grams: amount }, clock);
      }
    } else if (r < 0.65) {
      const rows = await live(c.db);
      const row = rows[Math.floor(rand() * rows.length)];
      if (row) await deleteEntry(c.db, row.id, clock);
    } else {
      const outage = rand();
      if (outage < 0.15) server.offline = true;
      else if (outage < 0.25) server.loseNextResponse = true;
      await c.engine.syncOnce(true);
      server.offline = false;
      server.loseNextResponse = false;
    }
  }

  for (let round = 0; round < 3; round++) {
    for (const c of clients) {
      clock += 120_000;
      await c.engine.syncOnce(true);
    }
  }

  const serverLive = [...server.rows.entries()]
    .filter(([k, v]) => k.startsWith("entry:") && !v.deleted)
    .map(([k, v]) => ({ id: k.slice(6), name: v.doc.name, amount: v.doc.amount }))
    .sort((a, b) => a.id.localeCompare(b.id));
  expect(serverLive.length).toBeGreaterThan(20);

  for (const [i, c] of clients.entries()) {
    const mine = (await live(c.db))
      .map((e) => ({ id: e.id, name: e.name, amount: e.amount }))
      .sort((a, b) => a.id.localeCompare(b.id));
    expect(mine, `client ${i} differs from the server`).toEqual(serverLive);
    expect(
      await c.db.outbox.where("status").anyOf("pending", "inflight").count(),
      `client ${i} still has pending ops`,
    ).toBe(0);
  }
  for (const count of server.appliedCount.values()) expect(count).toBe(1);
}, 60_000);
