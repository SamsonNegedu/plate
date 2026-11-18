import MiniSearch from "minisearch";
import type { Food } from "@/db/types";
import { searchName } from "@/lib/searchName";

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
    const hits = this.index.search(query);
    const out: Food[] = [];
    for (const h of hits) {
      const f = this.foods.get(String(h.id));
      if (f) out.push(f);
      if (out.length === limit) break;
    }
    return out;
  }
}
