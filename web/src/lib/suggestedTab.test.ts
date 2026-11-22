import { describe, expect, it } from "vitest";
import { suggestedTab } from "./health";

describe("suggestedTab", () => {
  it("opens on what is overdue first", () => {
    expect(suggestedTab({ doseDue: true, weightStale: true, tracksMedication: true })).toBe(
      "medication",
    );
    expect(suggestedTab({ doseDue: false, weightStale: true, tracksMedication: true })).toBe(
      "weight",
    );
    expect(suggestedTab({ doseDue: false, weightStale: false, tracksMedication: true })).toBe(
      "medication",
    );
    expect(suggestedTab({ doseDue: false, weightStale: false, tracksMedication: false })).toBe(
      "weight",
    );
  });
});
