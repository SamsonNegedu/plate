/** Joins class names, skipping falsy values. Utilities in one string never conflict, so no merge step is needed. */
export const cn = (...parts: Array<string | false | null | undefined>): string =>
  parts.filter(Boolean).join(" ");
