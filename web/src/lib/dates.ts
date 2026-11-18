import type { Meal } from "@/db/types";

const pad = (n: number) => String(n).padStart(2, "0");

/** A calendar date as YYYY-MM-DD from the device's local clock. Never derived from UTC. */
export function localDate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * The date a new entry belongs to. With day_start_hour 4, 00:30 still counts as the previous day.
 * The client assigns it once; the server stores it verbatim.
 */
export function logicalDate(now: Date, dayStartHour: number): string {
  const shifted = new Date(now);
  if (now.getHours() < dayStartHour) shifted.setDate(shifted.getDate() - 1);
  return localDate(shifted);
}

export function parseDate(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1, 12, 0, 0); // noon keeps DST shifts from changing the date
}

export function addDays(s: string, n: number): string {
  const d = parseDate(s);
  d.setDate(d.getDate() + n);
  return localDate(d);
}

export function isValidDate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && localDate(parseDate(s)) === s;
}

/** Every date from `from` to `to`, inclusive. Counted in calendar days, so a DST change never skips or repeats one. */
export function dateRange(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

/** Before 10:30 breakfast, to 15:00 lunch, to 21:00 dinner, after that a snack. */
export function defaultMeal(now: Date): Meal {
  const minutes = now.getHours() * 60 + now.getMinutes();
  if (minutes < 10 * 60 + 30) return "breakfast";
  if (minutes < 15 * 60) return "lunch";
  if (minutes < 21 * 60) return "dinner";
  return "snack";
}

export function dayTitle(date: string, today: string): string {
  if (date === today) return "Today";
  if (date === addDays(today, -1)) return "Yesterday";
  if (date === addDays(today, 1)) return "Tomorrow";
  return parseDate(date).toLocaleDateString("en-GB", { weekday: "long" });
}

export function dayLabel(date: string): string {
  return parseDate(date).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

export function shortLabel(date: string): string {
  return parseDate(date).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}
