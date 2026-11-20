/** Parse a number the way people type it: a decimal comma is fine. Returns null for anything else. */
export function parseDecimal(input: string): number | null {
  const s = input.trim().replace(/\s/g, "").replace(",", ".");
  if (s === "" || !/^-?\d*\.?\d+$|^-?\d+\.$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export function round(n: number, places = 0): number {
  const p = 10 ** places;
  return Math.round(n * p) / p;
}

const nf0 = new Intl.NumberFormat("en-GB", { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat("en-GB", { maximumFractionDigits: 1 });
const nf2 = new Intl.NumberFormat("en-GB", { maximumFractionDigits: 2 });

export const formatKcal = (n: number): string => nf0.format(round(n));
/** A medication dose in mg. Two decimals, because pens come in 0.25 and 0.5 mg steps. */
export const formatMg = (n: number): string => nf2.format(round(n, 2));
export const formatGrams = (n: number): string => nf1.format(round(n, 1));

/** "—" for a missing value, never "0". */
export function formatOptional(n: number | null, suffix = ""): string {
  return n === null ? "—" : `${nf1.format(round(n, 1))}${suffix}`;
}
