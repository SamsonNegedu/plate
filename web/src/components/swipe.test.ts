import { describe, expect, it } from "vitest";
import { resolveSwipe } from "./swipe";

describe("resolveSwipe", () => {
  it("ignores a short drag", () => {
    expect(resolveSwipe(-40, "right")).toBeNull();
    expect(resolveSwipe(60, "left")).toBeNull();
  });
  it("deletes toward the thumb and repeats away from it", () => {
    expect(resolveSwipe(-100, "right")).toBe("delete");
    expect(resolveSwipe(100, "right")).toBe("repeat");
    expect(resolveSwipe(100, "left")).toBe("delete");
    expect(resolveSwipe(-100, "left")).toBe("repeat");
  });
});
