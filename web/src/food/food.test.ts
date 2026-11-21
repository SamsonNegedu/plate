import { afterEach, describe, expect, test, vi } from "vitest";
import { cacheFood } from "@/db/foods";
import { PlateDB } from "@/db/schema";
import type { Food } from "@/db/types";
import { createDetector, makeDeduper } from "./barcode";
import { classifyCameraError } from "./camera";
import { digitsOnly, foodView, resolveBarcode } from "./lookup";
import { LocalSearch, spellings } from "./searchIndex";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

let n = 0;
const dbs: PlateDB[] = [];
const fresh = () => {
  const d = new PlateDB(`food-test-${++n}`);
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

const mk = (id: string, name: string, brand = "", barcode: string | null = null): Food => ({
  id,
  barcode,
  name,
  brand,
  quantity: "",
  servingSize: "",
  servingGrams: null,
  kcal: 100,
  protein: null,
  carbs: null,
  fat: null,
  sugar: null,
  satfat: null,
  fiber: null,
  salt: null,
  nutriscore: null,
  source: "user",
  sourceId: null,
  sourceCheckedAt: null,
  stale: false,
  imagePath: null,
  ingredients: "",
  allergens: "",
  searchName: `${name} ${brand}`.toLowerCase(),
  updatedAt: "",
  deletedAt: null,
  serverSeq: 0,
});

describe("barcode detector", () => {
  test("uses the native BarcodeDetector when it reads EAN-13", async () => {
    class Native {
      static getSupportedFormats = () => Promise.resolve(["ean_13", "code_128", "qr_code"]);
      constructor(public opts: { formats: string[] }) {}
      detect = () => Promise.resolve([{ rawValue: "4012345678901" }]);
    }
    vi.stubGlobal("BarcodeDetector", Native);
    const d = await createDetector();
    expect(d.kind).toBe("native");
    expect(await d.detect(new Blob() as unknown as ImageBitmapSource)).toBe("4012345678901");
  });

  test("falls back to the self-hosted ponyfill when the native detector lacks EAN-13", async () => {
    const Native = Object.assign(class {}, {
      getSupportedFormats: () => Promise.resolve(["qr_code"]),
    });
    vi.stubGlobal("BarcodeDetector", Native);
    const overrides = vi.fn<(cfg: { locateFile: (p: string, prefix: string) => string }) => void>();
    vi.doMock("barcode-detector/ponyfill", () => ({
      setZXingModuleOverrides: overrides,
      BarcodeDetector: class {
        detect() {
          return Promise.resolve([{ rawValue: "80177173" }]);
        }
      },
    }));
    vi.resetModules();
    const { createDetector: create } = await import("./barcode");
    const d = await create();
    expect(d.kind).toBe("ponyfill");
    expect(await d.detect(new Blob() as unknown as ImageBitmapSource)).toBe("80177173");
    const cfg = overrides.mock.calls[0]?.[0];
    if (!cfg) throw new Error("the ZXing overrides were never set");
    expect(cfg.locateFile("zxing_reader.wasm", "https://cdn.example/")).toBe(
      "/wasm/zxing_reader.wasm",
    );
    vi.doUnmock("barcode-detector/ponyfill");
  });

  test("an empty frame is null, not an error", async () => {
    class Native {
      static getSupportedFormats = () => Promise.resolve(["ean_13"]);
      detect = () => Promise.resolve([]);
    }
    vi.stubGlobal("BarcodeDetector", Native);
    expect(
      await (await createDetector()).detect(new Blob() as unknown as ImageBitmapSource),
    ).toBeNull();
  });

  test("the same code is suppressed for 2.5 seconds, a different one is not", () => {
    let t = 0;
    const accept = makeDeduper(2500, () => t);
    expect(accept("111")).toBe(true);
    t = 1000;
    expect(accept("111")).toBe(false);
    expect(accept("222")).toBe(true);
    t = 4000;
    expect(accept("222")).toBe(true);
  });
});

describe("camera errors", () => {
  test.each([
    ["NotAllowedError", "denied"],
    ["SecurityError", "denied"],
    ["NotFoundError", "no-camera"],
    ["OverconstrainedError", "no-camera"],
    ["NotReadableError", "busy"],
    ["AbortError", "busy"],
    ["TypeError", "unsupported"],
  ])("%s becomes %s", (name, state) => {
    expect(classifyCameraError(new DOMException("x", name))).toBe(state);
  });
});

describe("barcode lookup", () => {
  test("digits are extracted from whatever was typed", () => {
    expect(digitsOnly(" 4 000000-000011 ")).toBe("4000000000011");
  });

  test("an invalid code never reaches the network", async () => {
    const fetchSpy = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchSpy);
    expect(await resolveBarcode(fresh(), "12ab")).toEqual({ kind: "invalid" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test("a cached food resolves locally with no request", async () => {
    const db = fresh();
    await cacheFood(
      db,
      mk("0190a1b2-0000-7000-8000-000000000001", "Joghurt", "Ehrmann", "4000000000011"),
    );
    const fetchSpy = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchSpy);
    const r = await resolveBarcode(db, "4000000000011");
    expect(r).toMatchObject({ kind: "found", cached: true });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test("an offline miss does not call the network and is logged locally", async () => {
    const db = fresh();
    const fetchSpy = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchSpy);
    expect(await resolveBarcode(db, "4999999999993", { online: false })).toEqual({
      kind: "offline",
    });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(await db.foodMisses.count()).toBe(1);
  });

  test("a failed request is reported as offline, not as an exception", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockRejectedValue(new TypeError("Failed to fetch")),
    );
    expect(await resolveBarcode(fresh(), "4999999999993")).toEqual({ kind: "offline" });
  });

  test("a 404, a not-loggable product and an outage each get their own result", async () => {
    const reply = (status: number, body: unknown) =>
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response(JSON.stringify(body), {
          status,
          headers: { "content-type": "application/problem+json" },
        }),
      );
    vi.stubGlobal("fetch", reply(404, { code: "not_found" }));
    expect(await resolveBarcode(fresh(), "4999999999993")).toEqual({ kind: "not-found" });
    vi.stubGlobal(
      "fetch",
      reply(422, {
        code: "not_loggable",
        reason: "no_nutrition",
        product: { name: "Mystery bar", image_path: null },
      }),
    );
    expect(await resolveBarcode(fresh(), "4999999999994")).toMatchObject({
      kind: "not-loggable",
      name: "Mystery bar",
      reason: "no_nutrition",
    });
    vi.stubGlobal("fetch", reply(503, { code: "upstream_unavailable", retry_after: 30 }));
    expect(await resolveBarcode(fresh(), "4999999999995")).toEqual({
      kind: "unavailable",
      retryAfter: 30,
    });
  });

  test("a found product is validated, cached, and then resolves locally", async () => {
    const db = fresh();
    const body = {
      id: "0190a1b2-0000-7000-8000-000000000009",
      barcode: "80177173",
      name: "Nutella",
      brand: "Ferrero",
      kcal: 539,
      protein: 6.3,
      source: "catalog",
      image_path: "/api/v1/images/catalog/80177173",
    };
    const fetchSpy = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchSpy);
    const first = await resolveBarcode(db, "80177173");
    expect(first).toMatchObject({ kind: "found", cached: false });
    const second = await resolveBarcode(db, "80177173");
    expect(second).toMatchObject({ kind: "found", cached: true });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(first).toMatchObject({
      food: { carbs: null, imagePath: "/api/v1/images/catalog/80177173" },
    });
  });

  test("a server answer that is not a food is rejected, not stored", () => {
    expect(foodView.safeParse({ id: "x", name: "No kcal", source: "off" }).success).toBe(false);
    expect(
      foodView.safeParse({ id: "x", name: "Bad source", kcal: 1, source: "mars" }).success,
    ).toBe(false);
  });
});

describe("local search", () => {
  const idx = new LocalSearch();
  idx.rebuild([
    mk("1", "Vollkornbrot", "Harry"),
    mk("2", "Käse", "Hochland"),
    mk("3", "Müllermilch", "Müller"),
    mk("4", "Joghurt", "Gut & Günstig"),
    mk("5", "Gone"),
  ]);

  test.each([
    ["vollkorn", "Vollkornbrot"],
    ["Kase", "Käse"],
    ["käse", "Käse"],
    ["muller", "Müllermilch"],
    ["Müller", "Müllermilch"],
    ["gut gunstig", "Joghurt"],
    ["jogurt", "Joghurt"],
  ])("%s finds %s", (q, name) => {
    expect(idx.search(q).map((f) => f.name)).toContain(name);
  });

  test("short and punctuation-only queries return nothing", () => {
    expect(idx.search("k")).toEqual([]);
    expect(idx.search("!!")).toEqual([]);
  });

  test("deleted foods are not indexed", () => {
    const i = new LocalSearch();
    i.rebuild([{ ...mk("9", "Hidden"), deletedAt: "2026-11-13T00:00:00Z" }]);
    expect(i.search("hidden")).toEqual([]);
  });
});

describe("local search spellings", () => {
  test("a word typed without umlaut keys finds the umlaut product, and the other way round", () => {
    const search = new LocalSearch();
    search.rebuild([
      mk("0190a1b2-0000-7000-8000-000000000011", "Käse mild", "Hochland"),
      mk("0190a1b2-0000-7000-8000-000000000012", "Müller Reis", "Müller"),
      mk("0190a1b2-0000-7000-8000-000000000013", "Hähnchenbrust", "Wiesenhof"),
      mk("0190a1b2-0000-7000-8000-000000000014", "Weißbrot", "Harry"),
    ]);
    expect(search.search("kaese").map((f) => f.name)).toEqual(["Käse mild"]);
    expect(search.search("mueller").map((f) => f.name)).toContain("Müller Reis");
    expect(search.search("haehnchen").map((f) => f.name)).toEqual(["Hähnchenbrust"]);
    expect(search.search("weissbrot").map((f) => f.name)).toEqual(["Weißbrot"]);
    expect(search.search("käse").map((f) => f.name)).toEqual(["Käse mild"]);
  });

  test("a query that needs no change is searched once", () => {
    expect(spellings("brot")).toEqual(["brot"]);
    expect(spellings("Kaese")).toEqual(["Kaese", "kase"]);
  });
});
