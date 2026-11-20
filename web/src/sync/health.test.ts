import { afterEach, expect, test } from "vitest";
import { addHealthRecord, deleteHealthRecord } from "@/db/health";
import { PlateDB } from "@/db/schema";
import { FakeServer } from "@/test/fakeServer";
import { SyncEngine } from "./engine";
import { createSyncStore } from "./status";

const dbs: PlateDB[] = [];
afterEach(async () => {
  await Promise.all(
    dbs.splice(0).map(async (d) => {
      d.close();
      await d.delete();
    }),
  );
});

function client(server: FakeServer, name: string) {
  const db = new PlateDB(name);
  dbs.push(db);
  const clock = 1_800_000_000_000;
  const engine = new SyncEngine(db, server, createSyncStore(), {
    now: () => clock,
    random: () => 0.5,
    locks: null,
  });
  return { db, engine };
}

test("a weight and a dose logged on one device arrive on the other, and a delete follows", async () => {
  const server = new FakeServer();
  const a = client(server, "health-a");
  const b = client(server, "health-b");
  const weight = await addHealthRecord(a.db, { kind: "weight", value: 88.4 });
  const dose = await addHealthRecord(a.db, {
    kind: "dose",
    value: 2.5,
    medication: "Mounjaro",
    site: "Left thigh",
  });
  await a.engine.syncOnce(true);
  await b.engine.syncOnce(true);

  const got = await b.db.healthRecords.toArray();
  expect(got.map((r) => r.id).sort()).toEqual([weight.id, dose.id].sort());
  expect(got.find((r) => r.id === dose.id)).toMatchObject({
    kind: "dose",
    value: 2.5,
    medication: "Mounjaro",
    site: "Left thigh",
  });

  await deleteHealthRecord(a.db, weight.id);
  await a.engine.syncOnce(true);
  await b.engine.syncOnce(true);
  expect((await b.db.healthRecords.get(weight.id))?.deletedAt).not.toBeNull();
  expect((await b.db.healthRecords.get(dose.id))?.deletedAt).toBeNull();
});

test("a resync from a snapshot brings the health records back", async () => {
  const server = new FakeServer();
  const a = client(server, "health-c");
  const r = await addHealthRecord(a.db, { kind: "waist", value: 91 });
  await a.engine.syncOnce(true);
  await a.db.healthRecords.clear();
  await a.engine.resync();
  expect((await a.db.healthRecords.get(r.id))?.value).toBe(91);
});
