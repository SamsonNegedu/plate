import type { PlateDB } from "@/db/schema";

/** Everything on this device that the server may not have yet, as a downloadable JSON file. Used by the error screen and Settings. */
export async function localDump(db: PlateDB): Promise<string> {
  const dump = {
    exportedAt: new Date().toISOString(),
    entries: await db.entries.toArray(),
    foods: await db.foods.where("source").equals("user").toArray(),
    settings: await db.settings.toArray(),
    savedMeals: await db.savedMeals.toArray(),
    healthRecords: await db.healthRecords.toArray(),
    savedMealItems: await db.savedMealItems.toArray(),
    favorites: await db.favorites.toArray(),
    outbox: await db.outbox.toArray(),
    foodMisses: await db.foodMisses.toArray(),
    conflicts: await db.conflicts.toArray(),
  };
  return JSON.stringify(dump, null, 2);
}

export function download(filename: string, text: string, type = "application/json"): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
