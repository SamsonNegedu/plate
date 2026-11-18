import { z } from "zod";
import { parseDecimal } from "@/lib/numbers";

/** A required number typed as text. Accepts a decimal comma and blocks values outside min and max. */
export const requiredNumber = (label: string, min: number, max: number) =>
  z.string().transform((s, ctx) => {
    const n = parseDecimal(s);
    if (n === null) {
      ctx.addIssue({ code: "custom", message: `Enter ${label}.` });
      return z.NEVER;
    }
    if (n < min || n > max) {
      ctx.addIssue({
        code: "custom",
        message: `${label[0]?.toUpperCase()}${label.slice(1)} must be between ${min} and ${max}.`,
      });
      return z.NEVER;
    }
    return n;
  });

/** An optional number: blank stays null, never zero. */
export const optionalNumber = (label: string, min: number, max: number) =>
  z.string().transform((s, ctx) => {
    if (s.trim() === "") return null;
    const n = parseDecimal(s);
    if (n === null || n < min || n > max) {
      ctx.addIssue({
        code: "custom",
        message: `${label[0]?.toUpperCase()}${label.slice(1)} must be between ${min} and ${max}, or blank.`,
      });
      return z.NEVER;
    }
    return n;
  });
