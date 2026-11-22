import { describe, expect, it } from "vitest";
import { flickDirection } from "./swipeNav";

describe("flickDirection", () => {
  it("needs a long, mostly horizontal move", () => {
    expect(flickDirection(60, 0)).toBe(0);
    expect(flickDirection(120, 100)).toBe(0);
    expect(flickDirection(120, 10)).toBe(1);
    expect(flickDirection(-120, 10)).toBe(-1);
  });
});
