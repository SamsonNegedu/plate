import { afterEach, describe, expect, test } from "vitest";
import { constrainedNetwork } from "./network";

const connection = (value: unknown) =>
  Object.defineProperty(navigator, "connection", { configurable: true, value });

afterEach(() => Reflect.deleteProperty(navigator, "connection"));

describe("constrainedNetwork", () => {
  test("treats save-data as constrained", () => {
    connection({ saveData: true, effectiveType: "4g" });
    expect(constrainedNetwork()).toBe(true);
  });

  test("treats 2g as constrained", () => {
    connection({ effectiveType: "2g" });
    expect(constrainedNetwork()).toBe(true);
  });

  test("allows a fast connection", () => {
    connection({ effectiveType: "4g" });
    expect(constrainedNetwork()).toBe(false);
  });

  test("allows a browser that reports nothing", () => {
    expect(constrainedNetwork()).toBe(false);
  });
});
