import type { Food } from "@/db/types";

export interface Measure {
  label: string;
  /** The weight (or volume, for liquids) the measure stands for, in the food's own g or ml. */
  amount: number;
  unit: "g" | "ml";
}

interface Rule {
  match: RegExp;
  measures: Array<[label: string, amount: number]>;
  /** The measure a quick add starts from, by index into `measures`. */
  start?: number;
}

// Typical kitchen values, deliberately rounded. Names are matched in German and English because the catalog is German.
const RULES: Rule[] = [
  {
    match: /\b(oil|öl|olivenöl)\b|\böl\b/i,
    measures: [
      ["1 tsp", 4.5],
      ["1 tbsp", 14],
    ],
    start: 1,
  },
  {
    match: /butter|margarine|ghee|schmalz/i,
    measures: [
      ["1 tsp", 5],
      ["1 tbsp", 14],
    ],
    start: 1,
  },
  {
    match: /soy ?sauce|sojasauce|sojasoße|fish ?sauce|fischsauce|worcester/i,
    measures: [
      ["1 tsp", 6],
      ["1 tbsp", 16],
    ],
    start: 1,
  },
  {
    match: /ketchup|tomatenmark|tomato paste|sambal|gochujang|miso|harissa|senf|mustard/i,
    measures: [
      ["1 tsp", 6],
      ["1 tbsp", 17],
    ],
    start: 1,
  },
  {
    match: /peanut butter|erdnussbutter|erdnussmus|tahini|nussmus/i,
    measures: [["1 tbsp", 16]],
    start: 0,
  },
  {
    match: /honey|honig|syrup|sirup|agave/i,
    measures: [
      ["1 tsp", 7],
      ["1 tbsp", 21],
    ],
    start: 1,
  },
  {
    match: /sugar|zucker/i,
    measures: [
      ["1 tsp", 4],
      ["1 tbsp", 12.5],
      ["1 cup", 200],
    ],
    start: 0,
  },
  {
    match: /\bsalt\b|salz/i,
    measures: [
      ["1 tsp", 6],
      ["1 tbsp", 18],
    ],
    start: 0,
  },
  {
    match:
      /pepper|pfeffer|paprika pulver|chili|chilli|curry|cumin|kreuzkümmel|kurkuma|turmeric|zimt|cinnamon|gewürz|spice|seasoning/i,
    measures: [
      ["1 tsp", 2.5],
      ["1 tbsp", 7],
    ],
    start: 0,
  },
  {
    match: /garlic|knoblauch/i,
    measures: [
      ["1 clove", 4],
      ["1 bulb", 40],
    ],
    start: 0,
  },
  {
    match: /ginger|ingwer/i,
    measures: [
      ["1 thumb", 15],
      ["1 tbsp grated", 6],
    ],
    start: 0,
  },
  {
    match: /onion|zwiebel|shallot|schalotte/i,
    measures: [
      ["1 small", 70],
      ["1 medium", 110],
      ["1 large", 180],
    ],
    start: 1,
  },
  { match: /\b(egg|eggs|ei|eier)\b/i, measures: [["1 egg", 55]], start: 0 },
  {
    match: /(cooked|gekocht).*(rice|reis)|(rice|reis).*(cooked|gekocht)/i,
    measures: [
      ["1 cup", 160],
      ["1 handful", 60],
    ],
    start: 0,
  },
  {
    match: /\brice\b|\breis\b|couscous|quinoa|bulgur|hirse|millet|oats|haferflocken|linsen|lentil/i,
    measures: [
      ["1 handful", 45],
      ["1 cup", 185],
    ],
    start: 0,
  },
  {
    match: /flour|mehl|cornstarch|stärke|grits|polenta|semolina|grieß/i,
    measures: [
      ["1 tbsp", 8],
      ["1 cup", 125],
    ],
    start: 0,
  },
  {
    match:
      /spinach|spinat|kale|collard|grünkohl|salad|salat|herbs|kräuter|cilantro|koriander|parsley|petersilie/i,
    measures: [["1 handful", 30]],
    start: 0,
  },
  {
    match: /tomato|tomate/i,
    measures: [
      ["1 small", 80],
      ["1 medium", 120],
      ["1 large", 180],
    ],
    start: 1,
  },
  {
    match:
      /chicken|hähnchen|huhn|beef|rind|pork|schwein|lamb|lamm|meat|fleisch|fish|fisch|tofu|shrimp|garnele/i,
    measures: [
      ["1 palm", 100],
      ["1 handful", 60],
    ],
    start: 0,
  },
];

function ruleFor(food: Pick<Food, "name">): Rule | undefined {
  return RULES.find((r) => r.match.test(food.name));
}

const LIQUID = /(oil|öl)\b|sauce|soße|sirup|syrup|honig|honey/i;

/** Kitchen measures for a food, as weights it can be logged in. Empty when nothing sensible is known. */
export function householdMeasures(food: Pick<Food, "name">): Measure[] {
  const rule = ruleFor(food);
  if (!rule) return [];
  const unit = LIQUID.test(food.name) ? "ml" : "g";
  return rule.measures.map(([label, amount]) => ({ label, amount, unit }));
}

/** The amount a one-tap add starts from when the food has a natural kitchen measure (a tablespoon of oil). */
export function quickMeasure(food: Pick<Food, "name">): Measure | null {
  const rule = ruleFor(food);
  if (!rule || rule.start === undefined) return null;
  return householdMeasures(food)[rule.start] ?? null;
}
