import { localDate } from "@/lib/dates";

const pad = (n: number) => String(n).padStart(2, "0");

/** The value a datetime-local field takes: the device's local time, to the minute. */
export const localInput = (d: Date): string =>
  `${localDate(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;

export type WhenChoice = "now" | "morning" | "yesterday" | "other";

/** The times the quick chips stand for. "This morning" is offered only once 08:00 has passed. */
export function whenPresets(
  now: Date,
): Array<{ choice: Exclude<WhenChoice, "other">; label: string; at: Date }> {
  const morning = new Date(now);
  morning.setHours(8, 0, 0, 0);
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  return [
    { choice: "now" as const, label: "Now", at: now },
    ...(morning.getTime() < now.getTime()
      ? [{ choice: "morning" as const, label: "This morning", at: morning }]
      : []),
    { choice: "yesterday" as const, label: "Yesterday", at: yesterday },
  ];
}

/** Moves a typed value by a step, never below zero, rounded to one decimal. A blank or bad value starts from `from`. */
export function nudge(
  text: string,
  delta: number,
  from: number | null,
  parse: (s: string) => number | null,
): string {
  const cur = parse(text) ?? from ?? 0;
  const next = Math.max(0, Math.round((cur + delta) * 10) / 10);
  return String(next);
}

/** The index of the x closest to `x`, or -1 for an empty list. */
export function nearestIndex(xs: number[], x: number): number {
  let best = -1;
  let dist = Number.POSITIVE_INFINITY;
  for (const [i, v] of xs.entries()) {
    const d = Math.abs(v - x);
    if (d < dist) {
      dist = d;
      best = i;
    }
  }
  return best;
}
