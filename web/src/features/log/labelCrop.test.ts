import { describe, expect, test } from "vitest";
import { clampView, cropRegion, MAX_ZOOM } from "./labelCrop";

const image = { w: 1200, h: 900 };
const frame = { w: 400, h: 300 };

describe("cropRegion", () => {
  test("uses the whole photo at rest", () => {
    expect(cropRegion(image.w, image.h, frame.w, frame.h, { scale: 1, x: 0, y: 0 })).toEqual({
      sx: 0,
      sy: 0,
      sw: 1200,
      sh: 900,
    });
  });

  test("zooming to 2x takes the middle half", () => {
    expect(cropRegion(image.w, image.h, frame.w, frame.h, { scale: 2, x: 0, y: 0 })).toEqual({
      sx: 300,
      sy: 225,
      sw: 600,
      sh: 450,
    });
  });

  test("panning to the edge never leaves the photo", () => {
    const crop = cropRegion(image.w, image.h, frame.w, frame.h, { scale: 2, x: 5000, y: 5000 });
    expect(crop.sx).toBe(0);
    expect(crop.sy).toBe(0);
  });
});

describe("clampView", () => {
  test("caps the zoom", () => {
    expect(clampView({ scale: 10, x: 0, y: 0 }, image.w, image.h, frame.w, frame.h).scale).toBe(
      MAX_ZOOM,
    );
  });

  test("keeps the photo covering the frame", () => {
    expect(clampView({ scale: 2, x: 5000, y: -5000 }, image.w, image.h, frame.w, frame.h)).toEqual({
      scale: 2,
      x: 200,
      y: -150,
    });
  });
});
