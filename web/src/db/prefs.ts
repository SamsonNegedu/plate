import { useLiveQuery } from "dexie-react-hooks";
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
