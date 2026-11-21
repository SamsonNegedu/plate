import { cacheFood, deleteCustomFood, type FoodInput, saveCustomFood } from "@/db/foods";
import type { PlateDB } from "@/db/schema";
import type { Food } from "@/db/types";
import { api, ApiError } from "@/lib/api";
import { uuidv7 } from "@/lib/uuid";
import { foodFromView, foodView } from "./lookup";

/** A person's version of a product's facts, plus how it was entered (ADR-020). */
export interface Correction extends FoodInput {
  barcode: string;
  kj?: number | null;
  source: "manual" | "ocr";
  lang?: string;
  /** A cropped photo of the nutrition table, as a data URL or raw base64 (at most 400 KB decoded). */
  labelImage?: string | null;
  frontImage?: string | null;
}

export type CorrectionOutcome =
  /** Every account sees it now. `food` is the shared row, already cached. */
  | { kind: "shared"; food: Food }
  /** A plausibility check failed, so it is saved for this account only. */
  | { kind: "private"; food: Food; issues: string[] }
  /** The server could not be reached. Saved for this account and sent when the connection returns. */
  | { kind: "queued"; food: Food };

const APP_VERSION = "web";

const rawBase64 = (v: string | null | undefined): string | undefined => {
  if (!v) return undefined;
  const i = v.indexOf("base64,");
  return i >= 0 ? v.slice(i + 7) : v;
};

export function correctionBody(c: Correction, revisionId: string): Record<string, unknown> {
  const body: Record<string, unknown> = {
    revision_id: revisionId,
    name: c.name.trim(),
    brand: c.brand.trim(),
    quantity: c.quantity ?? "",
    serving_size: c.servingSize ?? "",
    serving_grams: c.servingGrams,
    kcal: c.kcal,
    kj: c.kj ?? null,
    protein: c.protein,
    carbs: c.carbs,
    fat: c.fat,
    sugar: c.sugar,
    satfat: c.satfat,
    fiber: c.fiber,
    salt: c.salt,
    source: c.source,
    app_version: APP_VERSION,
    lang: c.lang ?? "de",
  };
  const label = rawBase64(c.labelImage);
  const front = rawBase64(c.frontImage);
  if (label) body.label_image = label;
  if (front) body.front_image = front;
  return body;
}

interface Sent {
  status: "accepted" | "pending" | "superseded" | "reverted";
  issues: string[];
}

async function send(barcode: string, body: Record<string, unknown>): Promise<Sent> {
  const res = await api.PUT("/foods/barcode/{code}/correction", {
    params: { path: { code: barcode } },
    // The body is validated by the server; the typed shape is the same object with optional photos.
    body: body as never,
  });
  if (res.data === undefined) {
    const e = res.error as { code?: string; detail?: string } | undefined;
    throw new ApiError(res.response.status, e?.code ?? "error", e?.detail ?? "", undefined);
  }
  return { status: res.data.status, issues: res.data.issues ?? [] };
}

/** The shared row for a barcode, fetched and cached. A private copy of the same barcode is retired first. */
async function adoptShared(db: PlateDB, barcode: string, privateId?: string): Promise<Food | null> {
  const res = await api.GET("/foods/barcode/{code}", { params: { path: { code: barcode } } });
  if (res.data === undefined) return null;
  const food = foodFromView(foodView.parse(res.data));
  if (privateId) await deleteCustomFood(db, privateId);
  await db.foodMisses.where("barcode").equals(barcode).delete();
  return cacheFood(db, food);
}

/**
 * Share a product's facts with every account. Online it goes live at once when the numbers are plausible. Offline, or
 * when a check fails, the person still gets a working food of their own, so logging never waits on this.
 */
export async function submitCorrection(
  db: PlateDB,
  c: Correction,
  opts: { existingFoodId?: string | undefined } = {},
): Promise<CorrectionOutcome> {
  const revisionId = uuidv7();
  const body = correctionBody(c, revisionId);
  const privateInput: FoodInput = {
    ...c,
    ...(opts.existingFoodId ? { id: opts.existingFoodId } : {}),
  };

  let sent: Sent;
  try {
    sent = await send(c.barcode, body);
  } catch {
    const food = await saveCustomFood(db, privateInput);
    await db.corrections.put({
      revisionId,
      barcode: c.barcode,
      body,
      createdAt: new Date().toISOString(),
    });
    return { kind: "queued", food };
  }
  if (sent.status === "accepted") {
    const food = await adoptShared(db, c.barcode, opts.existingFoodId);
    if (food) return { kind: "shared", food };
  }
  const food = await saveCustomFood(db, privateInput);
  return { kind: "private", food, issues: sent.issues };
}

/**
 * Send corrections that waited for a connection. A network failure stops the run and keeps the rest; a rejection from
 * the server drops that one, because retrying cannot change the answer. An accepted one replaces the person's private
 * copy only if it still holds the submitted numbers.
 */
export async function drainCorrections(db: PlateDB): Promise<number> {
  let done = 0;
  for (const pending of await db.corrections.orderBy("createdAt").toArray()) {
    try {
      const res = await api.PUT("/foods/barcode/{code}/correction", {
        params: { path: { code: pending.barcode } },
        body: pending.body as never,
      });
      if (res.data === undefined && (res.response.status >= 500 || res.response.status === 429))
        return done;
      if (res.data?.status === "accepted") {
        const mine = await db.foods
          .where("barcode")
          .equals(pending.barcode)
          .filter((f) => f.source === "user" && !f.deletedAt && f.kcal === pending.body.kcal)
          .first();
        await adoptShared(db, pending.barcode, mine?.id);
      }
      await db.corrections.delete(pending.revisionId);
      done++;
    } catch {
      return done; // offline or signed out: keep the queue
    }
  }
  return done;
}
