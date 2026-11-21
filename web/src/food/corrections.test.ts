import { afterEach, describe, expect, test, vi } from "vitest";
import { PlateDB } from "@/db/schema";
import { correctionBody, drainCorrections, submitCorrection, type Correction } from "./corrections";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

let n = 0;
const dbs: PlateDB[] = [];
const fresh = () => {
  const d = new PlateDB(`corrections-test-${++n}`);
  dbs.push(d);
  return d;
};
afterEach(async () => {
  await Promise.all(
    dbs.splice(0).map(async (d) => {
      d.close();
      await d.delete();
    }),
  );
});

const BARCODE = "4337256560191";

const salmon: Correction = {
  barcode: BARCODE,
  name: "Räucherlachs",
  brand: "REWE Beste Wahl",
  servingGrams: null,
  kcal: 192,
  protein: 21,
  carbs: 0,
  fat: 12,
  sugar: null,
  satfat: 1.9,
  fiber: null,
  salt: 2.8,
  source: "manual",
};

const sharedFood = {
  id: "0190a1b2-0000-7000-8000-0000000000aa",
  barcode: BARCODE,
  name: "Räucherlachs",
  brand: "REWE Beste Wahl",
  kcal: 192,
  protein: 21,
  carbs: 0,
  fat: 12,
  source: "catalog",
  community: true,
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** A fake server: the correction answer is chosen per test, the lookup returns the shared food. */
function server(correction: () => Response) {
  const calls: Array<{ method: string; url: string; body: unknown }> = [];
  const fn = vi.fn<typeof fetch>(async (input, init) => {
    const req = input instanceof Request ? input : new Request(input, init);
    const text = req.method === "PUT" ? await req.clone().text() : "";
    calls.push({ method: req.method, url: req.url, body: text ? JSON.parse(text) : null });
    if (req.method === "PUT") return correction();
    return json(200, sharedFood);
  });
  vi.stubGlobal("fetch", fn);
  return calls;
}

describe("correctionBody", () => {
  test("a missing nutrient stays null and never becomes 0", () => {
    const b = correctionBody(salmon, "rev-1");
    expect(b.sugar).toBeNull();
    expect(b.fiber).toBeNull();
    expect(b.protein).toBe(21);
    expect(b.carbs).toBe(0);
  });

  test("a data URL photo is sent as bare base64", () => {
    const b = correctionBody({ ...salmon, labelImage: "data:image/jpeg;base64,QUJD" }, "rev-1");
    expect(b.label_image).toBe("QUJD");
    expect(b).not.toHaveProperty("front_image");
  });
});

describe("submitCorrection", () => {
  test("an accepted correction replaces the private copy with the shared row and clears the miss", async () => {
    const db = fresh();
    await db.foodMisses.add({ barcode: BARCODE, query: null, note: "", createdAt: "" });
    const calls = server(() =>
      json(200, { revision_id: "r", status: "accepted", origin: "off_correction", issues: [] }),
    );

    const out = await submitCorrection(db, salmon);
    expect(out.kind).toBe("shared");
    const live = (await db.foods.toArray()).filter((f) => !f.deletedAt);
    expect(live).toHaveLength(1);
    expect(live[0]).toMatchObject({ kcal: 192, source: "catalog", community: true });
    expect(await db.foodMisses.count()).toBe(0);
    expect(calls.filter((c) => c.method === "PUT")).toHaveLength(1);
    expect(await db.corrections.count()).toBe(0);
  });

  test("a failed check keeps a private food, names the issues and queues no sync of the shared fact", async () => {
    const db = fresh();
    server(() =>
      json(200, {
        revision_id: "r",
        status: "pending",
        origin: "new_product",
        issues: ["energy_mismatch"],
      }),
    );

    const out = await submitCorrection(db, { ...salmon, kcal: 500 });
    expect(out).toMatchObject({ kind: "private", issues: ["energy_mismatch"] });
    const [food] = await db.foods.toArray();
    expect(food).toMatchObject({ source: "user", kcal: 500, barcode: BARCODE });
    expect(await db.outbox.count()).toBe(1);
    expect(await db.corrections.count()).toBe(0);
  });

  test("offline: the person still gets a food to log, and the correction waits", async () => {
    const db = fresh();
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockRejectedValue(new TypeError("Failed to fetch")),
    );

    const out = await submitCorrection(db, salmon);
    expect(out.kind).toBe("queued");
    expect(await db.foods.count()).toBe(1);
    expect(await db.corrections.count()).toBe(1);
  });

  test("the queue drains when the connection returns and an accepted one swaps in the shared row", async () => {
    const db = fresh();
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockRejectedValue(new TypeError("Failed to fetch")),
    );
    await submitCorrection(db, salmon);
    const revision = (await db.corrections.toArray())[0]?.revisionId;

    const calls = server(() =>
      json(200, { revision_id: "r", status: "accepted", origin: "new_product", issues: [] }),
    );
    expect(await drainCorrections(db)).toBe(1);
    expect(await db.corrections.count()).toBe(0);
    expect(calls.find((c) => c.method === "PUT")?.body).toMatchObject({ revision_id: revision });
    const live = (await db.foods.toArray()).filter((f) => !f.deletedAt);
    expect(live).toHaveLength(1);
    expect(live[0]).toMatchObject({ community: true });
  });

  test("a failed drain keeps the queue", async () => {
    const db = fresh();
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockRejectedValue(new TypeError("Failed to fetch")),
    );
    await submitCorrection(db, salmon);
    expect(await drainCorrections(db)).toBe(0);
    expect(await db.corrections.count()).toBe(1);
  });
});
