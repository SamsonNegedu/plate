/** How the captured photo is moved and zoomed behind the fixed crop frame. Offsets are CSS pixels. */
export interface CropView {
  scale: number;
  x: number;
  y: number;
}

interface CropRegion {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
}

export const MAX_ZOOM = 4;

/**
 * Keeps the photo covering the frame: at least its natural fit, at most 4x, and never moved so far that an edge shows.
 * `imageW`/`imageH` are the photo's pixels, `viewW`/`viewH` the frame's CSS pixels.
 */
export function clampView(
  view: CropView,
  imageW: number,
  imageH: number,
  viewW: number,
  viewH: number,
): CropView {
  const base = Math.max(viewW / imageW, viewH / imageH);
  const scale = Math.min(MAX_ZOOM, Math.max(1, view.scale));
  const maxX = Math.max(0, (imageW * base * scale - viewW) / 2);
  const maxY = Math.max(0, (imageH * base * scale - viewH) / 2);
  return {
    scale,
    x: Math.min(maxX, Math.max(-maxX, view.x)),
    y: Math.min(maxY, Math.max(-maxY, view.y)),
  };
}

/** The part of the photo under the frame, in the photo's own pixels. */
export function cropRegion(
  imageW: number,
  imageH: number,
  viewW: number,
  viewH: number,
  view: CropView,
): CropRegion {
  const v = clampView(view, imageW, imageH, viewW, viewH);
  const s = Math.max(viewW / imageW, viewH / imageH) * v.scale;
  const left = viewW / 2 - (imageW * s) / 2 + v.x;
  const top = viewH / 2 - (imageH * s) / 2 + v.y;
  const sw = viewW / s;
  const sh = viewH / s;
  return {
    sx: Math.min(Math.max(0, -left / s), imageW - sw),
    sy: Math.min(Math.max(0, -top / s), imageH - sh),
    sw,
    sh,
  };
}
