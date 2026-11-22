import { addDays } from "@/lib/dates";
import { buildEntry, deleteEntry, saveEntry } from "./entries";
import { deleteCustomFood, saveCustomFood } from "./foods";
import { buildHealthRecord, deleteHealthRecord, saveHealthRecord } from "./health";
import { savePlan, setWeightGoal, stopPlan } from "./medication";
import { deleteMeal, type ItemInput, logRecipe, saveMeal } from "./savedMeals";
import type { PlateDB } from "./schema";
import { getSettings } from "./settings";
import type { Food, Meal, Nutrients } from "./types";

/** Marks every sample entry so the sample data can be removed again without touching real logs. */
const SAMPLE_NOTE = "Sample data";

const n = (
  kcal: number,
  protein: number | null,
  carbs: number | null,
  fat: number | null,
  fiber: number | null,
  sugar: number | null = null,
  satfat: number | null = null,
  salt: number | null = null,
): Nutrients => ({ kcal, protein, carbs, fat, sugar, satfat, fiber, salt });

interface SampleFood {
  name: string;
  brand: string;
  per100: Nutrients;
  /** Weight of one piece or portion, when there is a natural one. */
  servingGrams?: number;
}

/**
 * Typical supermarket staples as a German shopper buys them. Values are rounded label figures for the kind of product, not
 * measurements of one exact pack, and a nutrient the label usually omits stays null.
 */
const FOODS = {
  proteinPasta: {
    name: "Protein-Nudeln aus Linsen",
    brand: "REWE Beste Wahl",
    per100: n(340, 25, 45, 2.5, 9, 3, 0.4, 0.03),
    servingGrams: 75,
  },
  chicken: {
    name: "Hähnchenbrustfilet",
    brand: "Metzgerfrisch (Lidl)",
    per100: n(107, 23.5, 0, 1.2, null, 0, 0.3, 0.14),
  },
  skyr: {
    name: "Skyr natur",
    brand: "Milbona (Lidl)",
    per100: n(63, 11, 4, 0.2, null, 4, 0.1, 0.1),
  },
  pesto: {
    name: "Pesto Genovese",
    brand: "Italiamo (Lidl)",
    per100: n(470, 5, 4, 47, null, 2.5, 7, 1.6),
  },
  cherryTomatoes: {
    name: "Kirschtomaten",
    brand: "REWE Regional",
    per100: n(19, 0.9, 3, 0.2, 1, 2.7, 0, 0.01),
  },
  parmesan: {
    name: "Parmigiano Reggiano",
    brand: "Italiamo (Lidl)",
    per100: n(392, 33, 0, 28, null, 0, 18, 1.6),
  },
  oil: {
    name: "Olivenöl nativ extra",
    brand: "REWE Beste Wahl",
    per100: n(884, 0, 0, 100, 0, 0, 14, 0),
  },
  mince: {
    name: "Rinderhackfleisch mager",
    brand: "REWE Beste Wahl",
    per100: n(160, 20, 0, 9, null, 0, 4, 0.2),
  },
  passata: {
    name: "Passierte Tomaten",
    brand: "Freshona (Lidl)",
    per100: n(24, 1.3, 4, 0.2, 1.2, 3.8, 0, 0.3),
  },
  onion: { name: "Zwiebeln", brand: "REWE Regional", per100: n(40, 1.1, 9.3, 0.1, 1.7, 4.2, 0, 0) },
  carrot: {
    name: "Möhren",
    brand: "REWE Regional",
    per100: n(41, 0.9, 9.6, 0.2, 2.8, 4.7, 0, 0.17),
  },
  pizzaDough: {
    name: "Pizzateig frisch",
    brand: "REWE Beste Wahl",
    per100: n(255, 8, 48, 3, 2.5, 2, 0.5, 1.2),
  },
  mozzarella: {
    name: "Mozzarella",
    brand: "Milbona (Lidl)",
    per100: n(240, 18, 1, 18, null, 1, 12, 0.6),
  },
  rice: {
    name: "Jasminreis gekocht",
    brand: "REWE Beste Wahl",
    per100: n(130, 2.7, 28, 0.3, 0.4, 0.1, 0.1, 0.01),
  },
  eggs: {
    name: "Eier Bio",
    brand: "REWE Bio",
    per100: n(143, 12.6, 0.7, 9.5, null, 0.4, 2.7, 0.36),
    servingGrams: 60,
  },
  peasCarrots: {
    name: "TK Erbsen und Möhren",
    brand: "Freshona (Lidl)",
    per100: n(55, 3.5, 8, 0.5, 4.5, 4, 0.1, 0.1),
  },
  soy: { name: "Sojasauce", brand: "Vitasia (Lidl)", per100: n(60, 6, 6, 0, null, 1.5, 0, 16) },
  sesameOil: {
    name: "Sesamöl geröstet",
    brand: "Vitasia (Lidl)",
    per100: n(884, 0, 0, 100, 0, 0, 15, 0),
  },
  springOnion: {
    name: "Frühlingszwiebeln",
    brand: "REWE Regional",
    per100: n(32, 1.8, 5, 0.2, 2.6, 2.3, 0, 0),
  },
  oats: {
    name: "Haferflocken zart",
    brand: "REWE Bio",
    per100: n(372, 13.5, 58.7, 7, 10, 1.1, 1.3, 0.01),
  },
  milk: {
    name: "Milch 1,5 %",
    brand: "Milbona (Lidl)",
    per100: n(47, 3.4, 4.9, 1.5, null, 4.9, 1, 0.1),
  },
  chia: {
    name: "Chiasamen",
    brand: "REWE Bio",
    per100: n(486, 16.5, 42, 30.7, 34.4, 0, 3.3, 0.02),
  },
  banana: {
    name: "Bananen",
    brand: "REWE Beste Wahl",
    per100: n(89, 1.1, 22.8, 0.3, 2.6, 12.2, 0.1, 0),
    servingGrams: 120,
  },
  lentils: {
    name: "Rote Linsen",
    brand: "REWE Beste Wahl",
    per100: n(358, 24, 60, 1.5, 11, 2, 0.2, 0.02),
  },
  apple: {
    name: "Äpfel",
    brand: "REWE Regional",
    per100: n(52, 0.3, 13.8, 0.2, 2.4, 10.4, 0, 0),
    servingGrams: 150,
  },
  chocolate: {
    name: "Zartbitterschokolade 70 %",
    brand: "Fin Carré (Lidl)",
    per100: n(560, 7.8, 33, 41, 11, 24, 24, 0.02),
  },
  beer: { name: "Pils", brand: "Perlenbacher (Lidl)", per100: n(43, 0.5, 3.6, 0, 0, 0, 0, 0.01) },
} satisfies Record<string, SampleFood>;

type FoodKey = keyof typeof FOODS;

/** A recipe line: the food, the grams that went in, and how many pieces that is when it is counted rather than weighed. */
type Line = [food: FoodKey, grams: number, pieces?: number];

interface SampleRecipe {
  name: string;
  servings: number;
  lines: Line[];
}

const SAMPLE_RECIPES: SampleRecipe[] = [
  {
    name: "Overnight protein oats",
    servings: 2,
    lines: [
      ["oats", 80],
      ["skyr", 250],
      ["milk", 100],
      ["chia", 20],
      ["banana", 120, 1],
    ],
  },
  {
    name: "High-protein chicken pasta with Skyr pesto",
    servings: 2,
    lines: [
      ["proteinPasta", 160],
      ["chicken", 300],
      ["skyr", 150],
      ["pesto", 40],
      ["cherryTomatoes", 200],
      ["parmesan", 30],
      ["oil", 10],
    ],
  },
  {
    name: "High-protein bolognese",
    servings: 4,
    lines: [
      ["proteinPasta", 320],
      ["mince", 500],
      ["passata", 500],
      ["onion", 150],
      ["carrot", 100],
      ["parmesan", 40],
      ["oil", 20],
    ],
  },
  {
    name: "Pizza margherita",
    servings: 2,
    lines: [
      ["pizzaDough", 400],
      ["passata", 150],
      ["mozzarella", 250],
      ["oil", 10],
    ],
  },
  {
    name: "Chinese egg fried rice",
    servings: 3,
    lines: [
      ["rice", 600],
      ["eggs", 240, 4],
      ["peasCarrots", 150],
      ["springOnion", 50],
      ["soy", 30],
      ["sesameOil", 15],
    ],
  },
  {
    name: "Red lentil soup",
    servings: 6,
    lines: [
      ["lentils", 300],
      ["carrot", 300],
      ["onion", 200],
      ["passata", 400],
      ["oil", 30],
    ],
  },
];

const noon = (date: string) => {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1, 12).getTime();
};

/** A repeatable pseudo-random number from a day offset, so the sample history looks the same every time. */
const roll = (day: number, salt: number) => {
  const x = Math.sin(day * 12.9898 + salt * 78.233) * 43758.5453;
  return x - Math.floor(x);
};

interface SampleResult {
  foods: number;
  recipes: number;
  entries: number;
  /** Weights, doses and ratings. */
  health: number;
}

const SAMPLE_MED = "Wegovy";

/**
 * A fortnight into a weekly medication: a weight every few days drifting down, three doses with the amount stepped up on
 * the last one, rotated sites, and appetite a little lower in the days after each dose.
 */
async function seedHealth(db: PlateDB, today: string): Promise<number> {
  if ((await db.healthRecords.filter((h) => h.note === SAMPLE_NOTE && !h.deletedAt).count()) > 0)
    return 0;
  let count = 0;
  const put = async (
    input: Parameters<typeof buildHealthRecord>[0],
    date: string,
    offset: number,
  ) => {
    const at = new Date(noon(date) + offset * 60_000);
    await saveHealthRecord(
      db,
      buildHealthRecord({ ...input, at, note: SAMPLE_NOTE }, at.getTime()),
      at.getTime(),
    );
    count++;
  };
  const startedOn = addDays(today, -15);
  await savePlan(db, { name: SAMPLE_MED, intervalDays: 7, startedOn, supplyDoses: 3 });
  await setWeightGoal(db, 80);

  const doseDays = [-15, -8, -1].map((b) => addDays(today, b));
  const mg = [0.25, 0.25, 0.5];
  const sites = ["Left abdomen", "Right abdomen", "Left thigh"];
  for (const [i, date] of doseDays.entries()) {
    await put(
      { kind: "dose", value: mg[i] ?? 0.25, medication: SAMPLE_MED, site: sites[i] ?? "" },
      date,
      -60,
    );
  }
  for (let back = 30; back >= 0; back -= 2) {
    const date = addDays(today, -back);
    const kg = 92.4 - (30 - back) * 0.13 + (roll(back, 7) - 0.5) * 0.8;
    await put({ kind: "weight", value: Math.round(kg * 10) / 10 }, date, -120);
  }
  // A few body measurements, so the list shows more than weight
  const circumferences: Array<
    [Parameters<typeof buildHealthRecord>[0]["kind"], number, number, number]
  > = [
    ["waist", 30, 99, 0],
    ["waist", 2, 96.5, 0],
    ["hips", 30, 108, 0],
    ["arm", 30, 35, 0],
    ["arm", 2, 34, 0],
  ];
  for (const [kind, back, value, offset] of circumferences)
    await put({ kind, value }, addDays(today, -back), offset - 90);
  for (let back = 14; back >= 0; back--) {
    const date = addDays(today, -back);
    const sinceDose = Math.min(...doseDays.map((d) => daysBack(d, date)).filter((n) => n >= 0), 99);
    const appetite = sinceDose <= 2 ? 1 + Math.round(roll(back, 8)) : 3 + Math.round(roll(back, 9));
    await put({ kind: "appetite", value: appetite }, date, 0);
    if (sinceDose <= 1)
      await put({ kind: "nausea", value: 1 + Math.round(roll(back, 10)) }, date, 1);
  }
  return count;
}

/** Whole days from `from` to `to` on the calendar. */
const daysBack = (from: string, to: string) => Math.round((noon(to) - noon(from)) / 86_400_000);

const FOOD_KEYS = Object.keys(FOODS) as FoodKey[];
const isSampleFood = (f: Food) =>
  f.source === "user" &&
  !f.deletedAt &&
  FOOD_KEYS.some((k) => FOODS[k].name === f.name && FOODS[k].brand === f.brand);

/** The sample foods as stored foods, creating the ones that are missing. They sync and show up in search like any custom food. */
async function ensureFoods(db: PlateDB, at: number): Promise<Map<FoodKey, Food>> {
  const have = (await db.foods.where("source").equals("user").toArray()).filter(isSampleFood);
  const out = new Map<FoodKey, Food>();
  for (const [i, key] of FOOD_KEYS.entries()) {
    const def: SampleFood = FOODS[key];
    const found = have.find((f) => f.name === def.name && f.brand === def.brand);
    out.set(
      key,
      found ??
        (await saveCustomFood(
          db,
          {
            barcode: null,
            name: def.name,
            brand: def.brand,
            servingGrams: def.servingGrams ?? null,
            ...def.per100,
          },
          at + i,
        )),
    );
  }
  return out;
}

const itemOf = (food: Food, [, grams, pieces]: Line): ItemInput => ({
  foodId: food.id,
  name: food.name,
  brand: food.brand,
  amount: pieces ?? grams,
  unit: pieces ? "piece" : "g",
  grams,
  kcal: food.kcal,
  protein: food.protein,
  carbs: food.carbs,
  fat: food.fat,
  sugar: food.sugar,
  satfat: food.satfat,
  fiber: food.fiber,
  salt: food.salt,
});

/**
 * Write sample foods, recipes and about a month of history through the normal write paths, so they sync like real data.
 * Fridays and Saturdays run heavier (pizza, a beer, chocolate) and a few days are left unlogged, which shows the pattern note
 * and the gaps.
 */
export async function loadSampleData(db: PlateDB, today: string): Promise<SampleResult> {
  // Foods and recipes are stamped before the oldest entry: the outbox drains by time, and the server rejects a row that
  // refers to a food it has not seen yet.
  const seedAt = noon(addDays(today, -31));
  const foods = await ensureFoods(db, seedAt);
  const health = await seedHealth(db, today);
  const existing = new Map(
    (await db.savedMeals.toArray()).filter((m) => !m.deletedAt).map((m) => [m.name, m.id]),
  );
  const ids = new Map<string, string>();
  for (const r of SAMPLE_RECIPES) {
    const items = r.lines.map((line) => itemOf(foods.get(line[0]) as Food, line));
    const at = seedAt + 1000 + ids.size;
    ids.set(
      r.name,
      existing.get(r.name) ?? (await saveMeal(db, r.name, r.servings, items, undefined, at)).id,
    );
  }
  const base = { foods: foods.size, recipes: ids.size, health };
  const already = await db.entries.filter((e) => e.note === SAMPLE_NOTE && !e.deletedAt).count();
  if (already > 0) return { ...base, entries: 0 };

  let entries = 0;
  const log = async (date: string, meal: Meal, recipe: string, portions: number, at: number) => {
    const id = ids.get(recipe);
    if (id && (await logRecipe(db, id, date, meal, portions, { now: at, note: SAMPLE_NOTE })))
      entries++;
  };
  const eat = async (date: string, meal: Meal, key: FoodKey, grams: number, at: number) => {
    const food = foods.get(key) as Food;
    await saveEntry(
      db,
      buildEntry(
        {
          eatenOn: date,
          meal,
          foodId: food.id,
          name: food.name,
          brand: food.brand,
          barcode: null,
          amount: grams,
          unit: key === "beer" ? "ml" : "g",
          grams,
          note: SAMPLE_NOTE,
          kcal: food.kcal,
          protein: food.protein,
          carbs: food.carbs,
          fat: food.fat,
          sugar: food.sugar,
          satfat: food.satfat,
          fiber: food.fiber,
          salt: food.salt,
        },
        at,
      ),
      at,
    );
    entries++;
  };

  const lunches = [
    "Chinese egg fried rice",
    "Red lentil soup",
    "High-protein chicken pasta with Skyr pesto",
  ];
  const dinners = [
    "High-protein bolognese",
    "High-protein chicken pasta with Skyr pesto",
    "Chinese egg fried rice",
  ];
  const pick = <T>(list: T[], r: number) => list[Math.floor(r * list.length)] as T;

  for (let back = 29; back >= 0; back--) {
    const date = addDays(today, -back);
    const weekday = new Date(noon(date)).getDay();
    const heavy = weekday === 5 || weekday === 6;
    const at = noon(date);
    if (back > 0 && roll(back, 1) < 0.1) continue; // a day not logged
    await log(date, "breakfast", "Overnight protein oats", 1, at);
    if (back === 0) continue; // today so far: breakfast only
    await log(date, "lunch", pick(lunches, roll(back, 2)), 1, at + 1000);
    if (heavy) {
      await log(date, "dinner", "Pizza margherita", roll(back, 3) < 0.5 ? 1 : 1.5, at + 2000);
      await eat(date, "snack", "beer", 500, at + 3000);
      await eat(date, "snack", "chocolate", 60, at + 4000);
    } else {
      await log(date, "dinner", pick(dinners, roll(back, 4)), 1, at + 2000);
      await eat(date, "snack", roll(back, 5) < 0.5 ? "apple" : "skyr", 150, at + 3000);
    }
  }
  return { ...base, entries };
}

/** Remove what loadSampleData wrote: its entries by their note, its recipes and foods by name. Each is tombstoned like any delete. */
export async function removeSampleData(db: PlateDB): Promise<SampleResult> {
  const sampleEntries = await db.entries
    .filter((e) => e.note === SAMPLE_NOTE && !e.deletedAt)
    .toArray();
  for (const e of sampleEntries) await deleteEntry(db, e.id);
  const names = new Set(SAMPLE_RECIPES.map((r) => r.name));
  const recipes = (await db.savedMeals.toArray()).filter((m) => !m.deletedAt && names.has(m.name));
  for (const r of recipes) await deleteMeal(db, r.id);
  const foods = (await db.foods.where("source").equals("user").toArray()).filter(isSampleFood);
  for (const f of foods) await deleteCustomFood(db, f.id);
  const sampleHealth = await db.healthRecords
    .filter((h) => h.note === SAMPLE_NOTE && !h.deletedAt)
    .toArray();
  for (const h of sampleHealth) await deleteHealthRecord(db, h.id);
  if ((await getSettings(db)).medName === SAMPLE_MED) {
    await stopPlan(db);
    await setWeightGoal(db, null);
  }
  return {
    foods: foods.length,
    recipes: recipes.length,
    entries: sampleEntries.length,
    health: sampleHealth.length,
  };
}
