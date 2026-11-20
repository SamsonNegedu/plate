import { describe, expect, test } from "vitest";
import { findCounter, leadingZeroBits } from "./pow";

describe("leadingZeroBits", () => {
  test.each([
    [[0xff], 0],
    [[0x7f], 1],
    [[0x01], 7],
    [[0x00, 0x80], 8],
    [[0x00, 0x00, 0x10], 19],
    [[0x00, 0x00], 16],
  ])("%j has %i", (bytes, want) => {
    expect(leadingZeroBits(Uint8Array.from(bytes))).toBe(want);
  });
});

describe("findCounter", () => {
  test("returns a counter whose hash meets the target", async () => {
    const salt = "0123456789abcdef0123456789abcdef";
    const n = await findCounter(salt, 8);
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${salt}:${n}`));
    expect(leadingZeroBits(new Uint8Array(digest))).toBeGreaterThanOrEqual(8);
  });

  test("zero bits needs no work", async () => {
    expect(await findCounter("x", 0)).toBe(0);
  });

  test("stops when aborted", async () => {
    const ctl = new AbortController();
    ctl.abort();
    await expect(findCounter("x", 28, ctl.signal)).rejects.toThrow("Aborted");
  });
});
