import { describe, expect, test } from "vitest";
import { shouldDismissSheet } from "./Sheet";

describe("shouldDismissSheet", () => {
  test("ignores an upward or sideways drag", () => {
    expect(shouldDismissSheet(-40, 100)).toBe(false);
    expect(shouldDismissSheet(0, 100)).toBe(false);
  });

  test("dismisses after a clear pull", () => {
    expect(shouldDismissSheet(120, 900)).toBe(true);
  });

  test("dismisses a quick flick", () => {
    expect(shouldDismissSheet(40, 60)).toBe(true);
  });

  test("keeps the sheet on a slow, short drag", () => {
    expect(shouldDismissSheet(40, 900)).toBe(false);
  });
});
