import MiniSearch from "minisearch";
import type { Food } from "@/db/types";
import { searchName } from "@/lib/searchName";

/** The query as typed, and with ae/oe/ue read as umlauts when that changes anything. */
export function spellings(query: string): string[] {
  const plain = query.toLowerCase().replace(/ae/g, "a").replace(/oe/g, "o").replace(/ue/g, "u");
  return plain === query.toLowerCase() ? [query] : [query, plain];
}

/** Instant, offline, German-aware search over the foods already on this device. */
export class LocalSearch {
  private readonly index = new MiniSearch<Food>({
    fields: ["name", "brand", "barcode"],
    storeFields: ["id"],
    idField: "id",
    extractField: (doc, field) => {
      const v = doc[field as keyof Food];
      return typeof v === "string" ? v : "";
    },
    processTerm: (term) => searchName(term) || null,
    searchOptions: {
      prefix: true,
      fuzzy: (term) => (term.length > 4 ? 0.15 : false),
      boost: { name: 3, brand: 1.5 },
      combineWith: "AND",
    },
  });
  private foods = new Map<string, Food>();

  rebuild(foods: Food[]): void {
    this.index.removeAll();
    this.foods = new Map(foods.filter((f) => !f.deletedAt).map((f) => [f.id, f]));
    this.index.addAll([...this.foods.values()]);
  }

  search(query: string, limit = 30): Food[] {
    if (searchName(query).length < 2) return [];
    const out: Food[] = [];
    const seen = new Set<string>();
    // The index folds ä ö ü to a o u, so a word typed as ae oe ue is also searched as the folded spelling (same rule as the server).
    for (const q of spellings(query)) {
      for (const h of this.index.search(q)) {
        const id = String(h.id);
        const f = this.foods.get(id);
        if (f && !seen.has(id)) {
          seen.add(id);
          out.push(f);
        }
        if (out.length === limit) return out;
      }
    }
    return out;
  }
}
