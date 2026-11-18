/** Lowercase, fold umlauts, collapse punctuation. Mirrors the server's SearchName. */
export function searchName(s: string): string {
  return s
    .toLowerCase()
    .replace(/ä/g, "a")
    .replace(/ö/g, "o")
    .replace(/ü/g, "u")
    .replace(/ß/g, "ss")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}
