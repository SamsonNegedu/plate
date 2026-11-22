import { describe, expect, it } from "vitest";
import { nearestIndex, nudge, whenPresets } from "./when";

const parse = (s: string) => (s.trim() === "" ? null : Number(s.replace(",", ".")));

describe("whenPresets", () => {
  it("hides this morning before 08:00", () => {
    const early = whenPresets(new Date(2026, 10, 22, 6, 30)).map((p) => p.choice);
    expect(early).toEqual(["now", "yesterday"]);
    const later = whenPresets(new Date(2026, 10, 22, 13, 0)).map((p) => p.choice);
    expect(later).toEqual(["now", "morning", "yesterday"]);
  });
});

describe("nudge", () => {
  it("steps, rounds and floors at zero", () => {
    expect(nudge("80", 0.1, null, parse)).toBe("80.1");
    expect(nudge("80,2", -1, null, parse)).toBe("79.2");
    expect(nudge("0.5", -1, null, parse)).toBe("0");
    expect(nudge("", 1, 70, parse)).toBe("71");
  });
});

describe("nearestIndex", () => {
  it("finds the closest point", () => {
    expect(nearestIndex([10, 50, 90], 60)).toBe(1);
    expect(nearestIndex([], 5)).toBe(-1);
  });
});
