import { engineIsCached, type LoadProgress, type OcrMetrics, readLines, warmUp } from "./engine";
import { type Field, parseLabel, type ParsedLabel, type Region } from "./parse";

export type { Field, ParsedLabel };

const MAX_SIDE = 1800;

/** A photo, upright and no larger than the reader needs. A phone photo is 12 megapixels; reading it whole wastes time. */
export async function preparePhoto(file: Blob): Promise<Blob> {
  const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
  try {
    const scale = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
    const w = Math.round(bmp.width * scale);
    const h = Math.round(bmp.height * scale);
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("This browser cannot read the photo.");
    ctx.drawImage(bmp, 0, 0, w, h);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error("The photo could not be prepared."))),
        "image/jpeg",
        0.9,
      ),
    );
  } finally {
    bmp.close();
  }
}

const LABEL_PHOTO_BYTES = 380 * 1024; // the server takes 400 KB
const FRONT_PHOTO_BYTES = 230 * 1024; // and 250 KB; both photos in base64 must fit one 1 MB request

const dataUrlBytes = (url: string): number =>
  Math.floor(((url.length - url.indexOf(",") - 1) * 3) / 4);

/** A JPEG data URL of the canvas that fits `maxBytes`: lower quality first, then smaller. Re-encoding also drops the photo's metadata. */
function jpegUnder(source: CanvasImageSource, w: number, h: number, maxBytes: number): string {
  let width = w;
  let height = h;
  let url = "";
  for (let shrink = 0; shrink < 5; shrink++) {
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(width));
    canvas.height = Math.max(1, Math.round(height));
    canvas.getContext("2d")?.drawImage(source, 0, 0, canvas.width, canvas.height);
    for (const q of [0.85, 0.7, 0.55, 0.4]) {
      url = canvas.toDataURL("image/jpeg", q);
      if (dataUrlBytes(url) <= maxBytes) return url;
    }
    width *= 0.8;
    height *= 0.8;
  }
  return url;
}

/** The photo cropped to the nutrition table, so a kitchen, a hand or a face in the frame is not kept. */
async function cropToTable(photo: Blob, region: Region): Promise<string> {
  const bmp = await createImageBitmap(photo);
  try {
    const padX = (region.x1 - region.x0) * 0.04 + 8;
    const padY = (region.y1 - region.y0) * 0.04 + 8;
    const x = Math.max(0, region.x0 - padX);
    const y = Math.max(0, region.y0 - padY);
    const w = Math.min(bmp.width - x, region.x1 - region.x0 + 2 * padX);
    const h = Math.min(bmp.height - y, region.y1 - region.y0 + 2 * padY);
    const crop = document.createElement("canvas");
    crop.width = Math.round(w);
    crop.height = Math.round(h);
    crop.getContext("2d")?.drawImage(bmp, x, y, w, h, 0, 0, crop.width, crop.height);
    return jpegUnder(crop, crop.width, crop.height, LABEL_PHOTO_BYTES);
  } finally {
    bmp.close();
  }
}

/** A front-of-pack photo, upright, at most 900 px and 230 KB. */
export async function prepareFrontPhoto(file: Blob): Promise<string> {
  const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
  try {
    const scale = Math.min(1, 900 / Math.max(bmp.width, bmp.height));
    return jpegUnder(bmp, bmp.width * scale, bmp.height * scale, FRONT_PHOTO_BYTES);
  } finally {
    bmp.close();
  }
}

export interface ScanResult extends ParsedLabel {
  /** The table cropped out of the photo, ready to share with the product. Null when no table was found. */
  labelPhoto: string | null;
  metrics: OcrMetrics;
  /** A small copy of the photo as a data URL (the page's CSP allows data: images, not blob:), shown beside the values. */
  thumb: string;
  /** How many numbers were read, so the sheet can say "nothing found" instead of showing an empty table. */
  found: number;
}

async function thumbnail(photo: Blob): Promise<string> {
  const bmp = await createImageBitmap(photo);
  try {
    const scale = Math.min(1, 640 / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    canvas.getContext("2d")?.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.8);
  } finally {
    bmp.close();
  }
}

/** Photo in, per-100 g values and the fields to double-check out. Nothing leaves the device. */
export async function scanLabel(file: Blob, onProgress?: LoadProgress): Promise<ScanResult> {
  const photo = await preparePhoto(file);
  const { lines, metrics, level } = await readLines(photo, onProgress);
  const parsed = parseLabel(lines);
  // When the reader straightened the photo, the table's position is in that picture, so crop and show that one.
  const picture = level ?? photo;
  return {
    ...parsed,
    metrics,
    thumb: await thumbnail(picture),
    labelPhoto: parsed.region ? await cropToTable(picture, parsed.region) : null,
    found: Object.keys(parsed.values).length,
  };
}

/** Start loading the reader if its files are already on this device. It never starts a download on its own. */
export async function warmUpIfCached(): Promise<boolean> {
  const cached = await engineIsCached();
  if (cached) warmUp();
  return cached;
}
