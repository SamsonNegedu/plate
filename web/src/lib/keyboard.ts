import type { KeyboardEvent } from "react";

/**
 * Enter on a phone keyboard says "next". In a form of many number fields it moves to the following field instead of
 * submitting half a label; on the last field it submits as usual.
 */
export function nextOnEnter(e: KeyboardEvent<HTMLInputElement>): void {
  const el = e.currentTarget;
  if (e.key !== "Enter" || !el.form) return;
  const fields = Array.from(
    el.form.querySelectorAll<HTMLInputElement | HTMLSelectElement>(
      "input:not([type=file]):not([type=checkbox]):not([readonly]), select",
    ),
  );
  const next = fields[fields.indexOf(el) + 1];
  if (!next) return;
  e.preventDefault();
  next.focus();
}
