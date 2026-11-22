import { useLiveQuery } from "dexie-react-hooks";
import type { Activity, Pace, Sex } from "@/lib/goals";
import { useDb } from "./context";
import { getMeta, setMeta } from "./meta";
import type { PlateDB } from "./schema";

export interface ScanFeedback {
  sound: boolean;
  haptics: boolean;
}

const DEFAULT: ScanFeedback = { sound: true, haptics: true };

/** Local-only preference: sound and vibration when a barcode is read. */
export function useScanFeedback(): ScanFeedback {
  const db = useDb();
  return (
    useLiveQuery(async () => (await getMeta<ScanFeedback>(db, "scanFeedback")) ?? DEFAULT, [db]) ??
    DEFAULT
  );
}

export async function setScanFeedback(db: PlateDB, value: ScanFeedback): Promise<void> {
  await setMeta(db, "scanFeedback", value);
}

export type Hand = "right" | "left";

/** Local-only preference: which thumb the swipe gestures and the camera controls favor. */
export function useHand(): Hand {
  const db = useDb();
  return useLiveQuery(async () => (await getMeta<Hand>(db, "hand")) ?? "right", [db]) ?? "right";
}

export async function setHand(db: PlateDB, value: Hand): Promise<void> {
  await setMeta(db, "hand", value);
}

export interface BodyProfile {
  sex: Sex;
  birthYear: number | null;
  heightCm: number | null;
  activity: Activity;
  pace: Pace;
}

const DEFAULT_PROFILE: BodyProfile = {
  sex: "other",
  birthYear: null,
  heightCm: null,
  activity: "light",
  pace: "0",
};

/** Device-local inputs for the goal helper. Never synced; weight comes from the health records. */
export function useBodyProfile(): BodyProfile | undefined {
  const db = useDb();
  return useLiveQuery(
    async () => ({ ...DEFAULT_PROFILE, ...(await getMeta<BodyProfile>(db, "bodyProfile")) }),
    [db],
  );
}

export async function setBodyProfile(db: PlateDB, value: BodyProfile): Promise<void> {
  await setMeta(db, "bodyProfile", value);
}
