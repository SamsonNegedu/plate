/** A prescription GLP-1 product as people recognise it: the name on the pen or box. */
export interface Product {
  name: string;
  generic: string;
  group: "Weekly injection" | "Daily injection" | "Daily tablet";
  /** Days between doses as the product is normally used. */
  intervalDays: number;
  /** The strengths the product comes in, in mg, smallest first. They differ a little by country, so they are shortcuts, not limits. */
  strengthsMg: number[];
}

export const PRODUCTS: Product[] = [
  {
    name: "Wegovy",
    generic: "semaglutide",
    group: "Weekly injection",
    intervalDays: 7,
    strengthsMg: [0.25, 0.5, 1, 1.7, 2.4],
  },
  {
    name: "Ozempic",
    generic: "semaglutide",
    group: "Weekly injection",
    intervalDays: 7,
    strengthsMg: [0.25, 0.5, 1, 2],
  },
  {
    name: "Mounjaro",
    generic: "tirzepatide",
    group: "Weekly injection",
    intervalDays: 7,
    strengthsMg: [2.5, 5, 7.5, 10, 12.5, 15],
  },
  {
    name: "Zepbound",
    generic: "tirzepatide",
    group: "Weekly injection",
    intervalDays: 7,
    strengthsMg: [2.5, 5, 7.5, 10, 12.5, 15],
  },
  {
    name: "Trulicity",
    generic: "dulaglutide",
    group: "Weekly injection",
    intervalDays: 7,
    strengthsMg: [0.75, 1.5, 3, 4.5],
  },
  {
    name: "Bydureon",
    generic: "exenatide",
    group: "Weekly injection",
    intervalDays: 7,
    strengthsMg: [2],
  },
  {
    name: "Saxenda",
    generic: "liraglutide",
    group: "Daily injection",
    intervalDays: 1,
    strengthsMg: [0.6, 1.2, 1.8, 2.4, 3],
  },
  {
    name: "Victoza",
    generic: "liraglutide",
    group: "Daily injection",
    intervalDays: 1,
    strengthsMg: [0.6, 1.2, 1.8],
  },
  {
    name: "Rybelsus",
    generic: "semaglutide",
    group: "Daily tablet",
    intervalDays: 1,
    strengthsMg: [3, 7, 14],
  },
];

export const PRODUCT_GROUPS: Product["group"][] = [
  "Weekly injection",
  "Daily injection",
  "Daily tablet",
];

/** The product a name refers to, matched without regard to case or spaces. Null for anything else, such as a compounded pen. */
export function productNamed(name: string): Product | null {
  const key = name.trim().toLowerCase();
  return PRODUCTS.find((p) => p.name.toLowerCase() === key) ?? null;
}
