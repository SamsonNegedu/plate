import type { Hand } from "@/db/prefs";

export type SwipeAction = "delete" | "repeat";

const SWIPE_COMMIT = 72;

/** The thumb pulls inward: a right-handed swipe to the left deletes, and a left-handed swipe to the right does. */
export function resolveSwipe(dx: number, hand: Hand): SwipeAction | null {
  if (Math.abs(dx) < SWIPE_COMMIT) return null;
  const inward = hand === "right" ? dx < 0 : dx > 0;
  return inward ? "delete" : "repeat";
}
