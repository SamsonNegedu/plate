import { describe, expect, it } from "vitest";
import { householdMeasures, quickMeasure } from "./measures";

describe("householdMeasures", () => {
  it("knows oil in German and English", () => {
    expect(householdMeasures({ name: "Olivenöl nativ extra" }).map((m) => m.label)).toContain(
      "1 tbsp",
    );
    expect(quickMeasure({ name: "Palm oil" })).toMatchObject({
      label: "1 tbsp",
      amount: 14,
      unit: "ml",
    });
  });
  it("tells cooked rice from dry", () => {
    expect(quickMeasure({ name: "Jasmine rice, cooked" })?.amount).toBe(160);
    expect(quickMeasure({ name: "Basmati Reis" })?.amount).toBe(45);
  });
  it("gives nothing for an unknown food", () => {
    expect(householdMeasures({ name: "Egusi seeds" })).toEqual([]);
    expect(quickMeasure({ name: "Egusi seeds" })).toBeNull();
  });
});
