import { z } from "zod";
import { cacheFood, findFoodByBarcode, logMiss } from "@/db/foods";
import type { PlateDB } from "@/db/schema";
import type { CategoryInfo, Food } from "@/db/types";
import { api } from "@/lib/api";
import { searchName } from "@/lib/searchName";
import { AccessExpired, NetworkError } from "@/sync/errors";

const nullableNum = z
  .number()
  .nullable()
  .optional()
  .transform((v) => v ?? null);
const nullableText = z
  .string()
  .nullable()
  .optional()
  .transform((v) => v ?? null);

/** The server's food view, validated before it touches the local database. */
export const foodView = z.object({
  id: z.string(),
  barcode: nullableText,
  name: z.string(),
  brand: z.string().optional().default(""),
  quantity: z.string().optional().default(""),
  serving_size: z.string().optional().default(""),
  serving_grams: nullableNum,
  kcal: z.number(),
  protein: nullableNum,
  carbs: nullableNum,
  fat: nullableNum,
  sugar: nullableNum,
  satfat: nullableNum,
  fiber: nullableNum,
  salt: nullableNum,
  nutriscore: nullableText,
  source: z.enum(["off", "bls", "user", "catalog"]),
  source_id: nullableText,
  source_checked_at: nullableText,
  stale: z.boolean().optional().default(false),
  image_path: nullableText,
  ingredients: z.string().optional().default(""),
  allergens: z.string().optional().default(""),
  updated_at: z.string().optional().default(""),
  community: z.boolean().optional().default(false),
  category: z
    .object({
      name: z.string(),
      ranges: z.record(z.string(), z.array(z.number()).length(3)),
    })
    .nullable()
    .optional(),
});

export function foodFromView(v: z.infer<typeof foodView>): Food {
  return {
    id: v.id,
    barcode: v.barcode,
    name: v.name,
    brand: v.brand,
    quantity: v.quantity,
    servingSize: v.serving_size,
    servingGrams: v.serving_grams,
    kcal: v.kcal,
    protein: v.protein,
    carbs: v.carbs,
    fat: v.fat,
    sugar: v.sugar,
    satfat: v.satfat,
    fiber: v.fiber,
    salt: v.salt,
    nutriscore: v.nutriscore,
    source: v.source,
    sourceId: v.source_id,
    sourceCheckedAt: v.source_checked_at,
    stale: v.stale,
    imagePath: v.image_path,
    ingredients: v.ingredients,
    allergens: v.allergens,
    searchName: searchName(`${v.name} ${v.brand}`),
    updatedAt: v.updated_at,
    deletedAt: null,
    serverSeq: 0,
    community: v.community,
    category: toCategory(v.category),
  };
}

const RANGE_KEYS = ["kcal", "fat", "protein", "carbs", "salt"] as const;

function toCategory(c: z.infer<typeof foodView>["category"]): CategoryInfo | undefined {
  if (!c) return undefined;
  const ranges: CategoryInfo["ranges"] = {};
  for (const k of RANGE_KEYS) {
    const r = c.ranges[k];
    if (r) ranges[k] = [r[0] ?? 0, r[1] ?? 0, r[2] ?? 0];
  }
  return Object.keys(ranges).length > 0 ? { name: c.name, ranges } : undefined;
}

export type LookupResult =
  | { kind: "found"; food: Food; cached: boolean }
  | { kind: "not-found" }
  | { kind: "not-loggable"; name: string; reason: string; imagePath: string | null }
  | { kind: "offline" }
  | { kind: "unavailable"; retryAfter: number | null }
  | { kind: "invalid" };

export const digitsOnly = (s: string): string => s.replace(/\D/g, "");

/**
 * Barcode to food. Local first, then the server (which checks the catalog before Open Food Facts). A miss or an outage
 * never dead-ends: the caller opens the manual sheet with the barcode.
 */
export const isBarcodeLength = (code: string): boolean => code.length >= 6 && code.length <= 14;

export async function resolveBarcode(
  db: PlateDB,
  raw: string,
  opts: { signal?: AbortSignal; online?: boolean } = {},
): Promise<LookupResult> {
  const code = digitsOnly(raw);
  if (!isBarcodeLength(code)) return { kind: "invalid" };

  const local = await findFoodByBarcode(db, code);
  if (local) return { kind: "found", food: local, cached: true };
  if (opts.online === false) {
    await logMiss(db, { barcode: code, query: null, note: "offline" });
    return { kind: "offline" };
  }

  try {
    const res = await api.GET("/foods/barcode/{code}", {
      params: { path: { code } },
      ...(opts.signal ? { signal: opts.signal } : {}),
    });
    if (res.data !== undefined) {
      const food = await cacheFood(db, foodFromView(foodView.parse(res.data)));
      return { kind: "found", food, cached: false };
    }
    const err = res.error as Record<string, unknown> | undefined;
    const status = res.response.status;
    if (status === 404) {
      await logMiss(db, { barcode: code, query: null });
      return { kind: "not-found" };
    }
    if (status === 422 && err?.code === "not_loggable") {
      const product =
        typeof err.product === "object" && err.product !== null
          ? (err.product as Record<string, unknown>)
          : {};
      await logMiss(db, { barcode: code, query: null, note: "not loggable" });
      return {
        kind: "not-loggable",
        name: typeof product.name === "string" ? product.name : "",
        reason: typeof err.reason === "string" ? err.reason : "no_nutrition",
        imagePath: typeof product.image_path === "string" ? product.image_path : null,
      };
    }
    if (status === 503 || status === 429)
      return {
        kind: "unavailable",
        retryAfter: typeof err?.retry_after === "number" ? err.retry_after : null,
      };
    if (status === 422) return { kind: "invalid" };
    return { kind: "unavailable", retryAfter: null };
  } catch (e) {
    if (e instanceof NetworkError || e instanceof AccessExpired) return { kind: "offline" };
    if (e instanceof DOMException && e.name === "AbortError") throw e;
    return { kind: "unavailable", retryAfter: null };
  }
}

export type ReferenceResult =
  | { kind: "found"; food: Food }
  | { kind: "offline" }
  | { kind: "unavailable" };

/**
 * A shared generic food (egusi, plantain) to a food of the account. Already-selected ones are found locally; the first
 * selection needs the server, which adds it to the account.
 */
export async function resolveReference(
  db: PlateDB,
  refId: string,
  opts: { online?: boolean } = {},
): Promise<ReferenceResult> {
  const local = await db.foods
    .filter(
      (f) => f.source === "catalog" && f.barcode === null && f.sourceId === refId && !f.deletedAt,
    )
    .first();
  if (local) return { kind: "found", food: local };
  if (opts.online === false) return { kind: "offline" };
  try {
    const res = await api.GET("/foods/reference/{id}", { params: { path: { id: refId } } });
    if (res.data === undefined) return { kind: "unavailable" };
    return { kind: "found", food: await cacheFood(db, foodFromView(foodView.parse(res.data))) };
  } catch (e) {
    if (e instanceof NetworkError || e instanceof AccessExpired) return { kind: "offline" };
    throw e;
  }
}
