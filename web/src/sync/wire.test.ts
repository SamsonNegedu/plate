import { describe, expect, test } from "vitest";
import { foodDoc, mergeImagePath, toFood } from "./wire";

const doc = (extra: Record<string, unknown>) =>
  toFood(
    foodDoc.parse({
      id: "0190a1b2-0000-7000-8000-000000000001",
      barcode: "4337256560191",
      name: "Räucherlachs",
      kcal: 192,
      source: "catalog",
      updated_at: "2026-11-21T00:00:00Z",
      server_seq: 3,
      ...extra,
    }),
  );

describe("the picture of a synced food", () => {
  test("a community food with no picture of its own points at the photo shared with its revision", () => {
    const f = doc({ community_rev: "0190a1b2-0000-7000-8000-0000000000aa", image_key: null });
    expect(f.community).toBe(true);
    expect(f.imagePath).toBe("/api/v1/images/fact/0190a1b2-0000-7000-8000-0000000000aa/front");
  });

  test("a community food that has its own picture does not point at the shared photo", () => {
    const f = doc({
      community_rev: "0190a1b2-0000-7000-8000-0000000000aa",
      image_key: "a".repeat(32),
    });
    expect(f.imagePath).toBeNull();
  });

  test("a food that is not a community food has no derived picture, as before", () => {
    expect(doc({}).imagePath).toBeNull();
  });
});

describe("mergeImagePath", () => {
  const fact = (rev: string) => `/api/v1/images/fact/${rev}/front`;

  test("a picture the device already has is kept", () => {
    expect(mergeImagePath("/api/v1/images/abc", fact("r2"))).toBe("/api/v1/images/abc");
    expect(mergeImagePath("/api/v1/images/abc", null)).toBe("/api/v1/images/abc");
  });

  test("an old shared photo gives way to the new revision's, or to nothing", () => {
    expect(mergeImagePath(fact("r1"), fact("r2"))).toBe(fact("r2"));
    expect(mergeImagePath(fact("r1"), null)).toBeNull();
  });

  test("with nothing before, the incoming path is used", () => {
    expect(mergeImagePath(undefined, fact("r2"))).toBe(fact("r2"));
    expect(mergeImagePath(null, null)).toBeNull();
  });
});
