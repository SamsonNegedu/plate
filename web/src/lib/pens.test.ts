import { describe, expect, test } from "vitest";
import { PRODUCT_GROUPS, PRODUCTS, productNamed } from "./pens";

describe("GLP-1 products", () => {
  test("a name is found without regard to case or spaces, and an unknown one is not a product", () => {
    expect(productNamed(" wegovy ")?.generic).toBe("semaglutide");
    expect(productNamed("Mounjaro")?.generic).toBe("tirzepatide");
    expect(productNamed("my compounded pen")).toBeNull();
  });

  test("every product has strengths in ascending order and a sensible interval", () => {
    for (const p of PRODUCTS) {
      expect(p.strengthsMg.length).toBeGreaterThan(0);
      expect([...p.strengthsMg].sort((a, b) => a - b)).toEqual(p.strengthsMg);
      expect([1, 7]).toContain(p.intervalDays);
      expect(PRODUCT_GROUPS).toContain(p.group);
    }
  });

  test("names are unique, because the name is what a dose is saved under", () => {
    expect(new Set(PRODUCTS.map((p) => p.name.toLowerCase())).size).toBe(PRODUCTS.length);
  });

  test("the same drug under two brands keeps each brand's own strengths", () => {
    expect(productNamed("Wegovy")?.strengthsMg).toContain(2.4);
    expect(productNamed("Ozempic")?.strengthsMg).not.toContain(2.4);
  });
});
