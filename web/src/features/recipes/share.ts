import { z } from "zod";
import type { ItemInput } from "@/db/savedMeals";
import { formatGrams, formatKcal, formatOptional } from "@/lib/numbers";
import { amountLabel } from "@/lib/nutrition";
import { portionLabel, recipeNutrition } from "@/lib/recipe";

/**
 * A recipe travels as a copy: a small JSON file, or the text of it. Nothing is linked, hosted or synced, so there is no account
 * to invite and the other person's Plate never reads this one. Foods are not shared by id, only by name and nutrition.
 */
export const SHARE_FORMAT = "plate-recipe";
export const SHARE_VERSION = 1;
export const MAX_SHARED_BYTES = 200_000;

const num = z.number().finite();
const nullable = (max: number) =>
  z
    .number()
    .finite()
    .min(0)
    .max(max)
    .nullable()
    .optional()
    .transform((v) => v ?? null);

const item = z.object({
  name: z.string().trim().min(1).max(200),
  brand: z.string().trim().max(200).optional().default(""),
  amount: num.gt(0).max(100_000),
  unit: z.enum(["g", "ml", "piece", "serving"]),
  grams: num.gt(0).max(100_000),
  kcal: num.min(0).max(1000),
  protein: nullable(100),
  carbs: nullable(100),
  fat: nullable(100),
  sugar: nullable(100),
  satfat: nullable(100),
  fiber: nullable(100),
  salt: nullable(100),
});

const shared = z.object({
  format: z.literal(SHARE_FORMAT),
  version: z.number().int().min(1).max(SHARE_VERSION),
  name: z.string().trim().min(1).max(200),
  servings: num.gt(0).max(1000),
  items: z.array(item).min(1).max(100),
});

export interface SharedRecipe {
  name: string;
  servings: number;
  items: ItemInput[];
}

export type ParseResult = { ok: true; recipe: SharedRecipe } | { ok: false; error: string };

/** The recipe as the file that is shared. Ids and account details are left out on purpose. */
export function toShareJson(recipe: SharedRecipe): string {
  return JSON.stringify(
    {
      format: SHARE_FORMAT,
      version: SHARE_VERSION,
      name: recipe.name.trim(),
      servings: recipe.servings,
      items: recipe.items.map((i) => ({
        name: i.name,
        brand: i.brand,
        amount: i.amount,
        unit: i.unit,
        grams: i.grams,
        kcal: i.kcal,
        protein: i.protein,
        carbs: i.carbs,
        fat: i.fat,
        sugar: i.sugar,
        satfat: i.satfat,
        fiber: i.fiber,
        salt: i.salt,
      })),
    },
    null,
    2,
  );
}

/** A recipe a person can read in a message: ingredients with their amounts, then what a portion comes to. */
export function toShareText(recipe: SharedRecipe): string {
  const n = recipeNutrition(recipe.items, recipe.servings);
  const lines = recipe.items.map(
    (i) =>
      `- ${amountLabel(i.amount, i.unit)}${i.unit === "g" || i.unit === "ml" ? "" : ` (${formatGrams(i.grams)} g)`} ${i.name}${i.brand ? `, ${i.brand}` : ""}`,
  );
  return [
    `${recipe.name.trim()}, makes ${portionLabel(recipe.servings)}`,
    "",
    ...lines,
    "",
    `Per portion: ${formatKcal(n.portion.kcal)} kcal · protein ${formatOptional(n.portion.protein, " g")} · carbs ${formatOptional(n.portion.carbs, " g")} · fat ${formatOptional(n.portion.fat, " g")}`,
  ].join("\n");
}

/** Read what someone pasted or picked. It is untrusted until every field has passed, and anything else is refused with a reason. */
export function parseShared(text: string): ParseResult {
  if (text.length > MAX_SHARED_BYTES)
    return { ok: false, error: "That is too large to be a recipe." };
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return {
      ok: false,
      error: "That is not a Plate recipe. Paste the recipe data or choose the file.",
    };
  }
  const parsed = shared.safeParse(data);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    const where = first?.path.length ? ` (${first.path.join(".")})` : "";
    return {
      ok: false,
      error: `That recipe cannot be added: ${first?.message ?? "it is not valid"}${where}.`,
    };
  }
  const { name, servings, items } = parsed.data;
  return {
    ok: true,
    recipe: {
      name,
      servings,
      items: items.map((i) => ({ ...i, foodId: null })),
    },
  };
}

/** A file name for a shared recipe. */
export function shareFileName(name: string): string {
  const slug = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return `${slug || "recipe"}.plate-recipe.json`;
}
