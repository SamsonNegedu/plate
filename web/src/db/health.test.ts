import { afterEach, describe, expect, test } from "vitest";
import {
  addHealthRecord,
  buildHealthRecord,
  deleteHealthRecord,
  undoHealthAdd,
  undoHealthDelete,
} from "./health";
import { savePlan, setSupply, stopPlan } from "./medication";
import { PlateDB } from "./schema";
import { getSettings, saveSettings } from "./settings";

let n = 0;
const open: PlateDB[] = [];
const fresh = () => {
  const db = new PlateDB(`health-test-${++n}`);
  open.push(db);
  return db;
};
afterEach(async () => {
  await Promise.all(
    open.splice(0).map(async (d) => {
      d.close();
      await d.delete();
    }),
  );
});

describe("health records", () => {
  test("a record is written locally with its outbox op, dated by the device clock", async () => {
    const db = fresh();
    const at = new Date(2026, 10, 19, 23, 30); // 23:30 local on the 19th, which is already the 20th in UTC+1 or later
    const r = await addHealthRecord(db, { kind: "weight", value: 88.4, at });
    expect(r.recordedOn).toBe("2026-11-19");
    expect(r.medication).toBe("");
    const ops = await db.outbox.toArray();
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({ entity: "health_record", type: "upsert", entityId: r.id });
    expect(ops[0]?.data).toMatchObject({ value: 88.4 });
  });

  test("only a dose carries a medication", () => {
    expect(
      buildHealthRecord({ kind: "weight", value: 80, medication: "Mounjaro" }).medication,
    ).toBe("");
    expect(
      buildHealthRecord({ kind: "dose", value: 2.5, medication: " Mounjaro " }).medication,
    ).toBe("Mounjaro");
  });

  test("an unsent record vanishes on undo and a sent one is deleted", async () => {
    const db = fresh();
    const unsent = await addHealthRecord(db, { kind: "waist", value: 90 });
    await undoHealthAdd(db, unsent.id);
    expect(await db.healthRecords.get(unsent.id)).toBeUndefined();
    expect(await db.outbox.count()).toBe(0);

    const sent = await addHealthRecord(db, { kind: "waist", value: 91 });
    await db.healthRecords.update(sent.id, { serverSeq: 7 });
    await db.outbox.clear();
    await undoHealthAdd(db, sent.id);
    expect((await db.healthRecords.get(sent.id))?.deletedAt).not.toBeNull();
    expect((await db.outbox.toArray()).filter((o) => o.type === "delete")).toHaveLength(1);
  });

  test("deleting is a tombstone, and undoing an unsent delete restores the row and cancels the op", async () => {
    const db = fresh();
    const r = await addHealthRecord(db, { kind: "dose", value: 2.5, medication: "Mounjaro" });
    await db.healthRecords.update(r.id, { serverSeq: 3 });
    await db.outbox.clear();
    await deleteHealthRecord(db, r.id);
    expect((await db.healthRecords.get(r.id))?.deletedAt).not.toBeNull();
    await undoHealthDelete(db, r.id);
    expect((await db.healthRecords.get(r.id))?.deletedAt).toBeNull();
    expect(await db.outbox.count()).toBe(0);
  });

  test("undoing a delete that already synced re-creates the record under a new id", async () => {
    const db = fresh();
    const r = await addHealthRecord(db, { kind: "weight", value: 80 });
    await db.healthRecords.update(r.id, { serverSeq: 3, deletedAt: "2026-11-19T10:00:00Z" });
    await db.outbox.clear();
    await undoHealthDelete(db, r.id);
    const live = (await db.healthRecords.toArray()).filter((x) => !x.deletedAt);
    expect(live).toHaveLength(1);
    expect(live[0]?.id).not.toBe(r.id);
    expect(live[0]?.value).toBe(80);
  });
});

describe("medication plan", () => {
  test("saving goals never wipes the plan", async () => {
    const db = fresh();
    await savePlan(db, {
      name: " Mounjaro ",
      intervalDays: 7,
      startedOn: "2026-10-05",
      supplyDoses: 4,
    });
    await saveSettings(db, { goalKcal: 1800 });
    const s = await getSettings(db);
    expect(s.goalKcal).toBe(1800);
    expect(s.medName).toBe("Mounjaro");
    expect(s.medIntervalDays).toBe(7);
    expect(s.medSupplyDoses).toBe(4);
  });

  test("the plan syncs with settings as snake_case and null clears it", async () => {
    const db = fresh();
    await savePlan(db, {
      name: "Mounjaro",
      intervalDays: 7,
      startedOn: "2026-10-05",
      supplyDoses: null,
    });
    await db.settings.toCollection().modify({ userId: "u1" }); // outbox ops need a user id
    await stopPlan(db);
    const s = await getSettings(db);
    expect(s.medName).toBeNull();
    expect(s.medSupplyAsOf).toBeNull();
  });

  test("setting the supply stamps when it was counted", async () => {
    const db = fresh();
    await setSupply(db, 3, Date.UTC(2026, 10, 20, 8));
    const s = await getSettings(db);
    expect(s.medSupplyDoses).toBe(3);
    expect(s.medSupplyAsOf).toBe("2026-11-20T08:00:00.000Z");
  });
});
