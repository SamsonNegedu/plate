import type * as OrtModule from "onnxruntime-web/wasm";
import type { Line } from "./parse";

/**
 * Reads the text on a photo with PP-OCRv4 (a text detector and a text recognizer) through ONNX Runtime in WebAssembly.
 * Both run on the device; the files are same-origin and the service worker keeps them after the first use. The two
 * steps around the models are written here, not pulled from a library that needs OpenCV: find text regions in the
 * detector's probability map, then decode the recognizer's output.
 */

/** Where the label reader's files are served from. */
const BASE = "/ocr";
const FILES = ["det.onnx", "rec.onnx", "keys.txt", "ort-wasm-simd-threaded.wasm"] as const;

const DET_MAX_SIDE = 1600;
const DET_MIN_SIDE = 736; // a small photo is scaled up: finer rows keep neighbouring lines apart
const DET_UPSCALE_CAP = 2400;
const DET_THRESHOLD = 0.3;
const BOX_THRESHOLD = 0.5;
const UNCLIP_RATIO = 1.6;
const MIN_SIDE = 3;
const MAX_TILT = (35 * Math.PI) / 180; // beyond this a region is not a line of text on a label
const MIN_TILT = (1.5 * Math.PI) / 180; // smaller tilts are read as they are
const REC_HEIGHT = 48;
const REC_MAX_WIDTH = 1280;
const MEAN = [0.485, 0.456, 0.406] as const;
const STD = [0.229, 0.224, 0.225] as const;

/** What a scan cost, for the diagnostics panel and for tuning. */
export interface OcrMetrics {
  /** Milliseconds to fetch and start the models, 0 when they were already running. */
  loadMs: number;
  /** Milliseconds to read the photo. */
  readMs: number;
  /** Bytes the engine's files added over the network (0 when served from cache). */
  downloadedBytes: number;
  /** JS heap in use after the scan, when the browser reports it (Chromium only). */
  heapBytes: number | null;
}

type Ort = typeof OrtModule;
interface Engine {
  ort: Ort;
  det: OrtModule.InferenceSession;
  rec: OrtModule.InferenceSession;
  dict: string[];
}

let engine: Promise<Engine> | null = null;

/** True once the files are on this device, so the UI can say "Downloading" only the first time. */
export async function engineIsCached(): Promise<boolean> {
  if (engine) return true; // already loaded in this session
  if (typeof caches === "undefined") return false;
  try {
    const hits = await Promise.all(FILES.map((f) => caches.match(`${BASE}/${f}`)));
    return hits.every(Boolean);
  } catch {
    return false;
  }
}

async function create(): Promise<Engine> {
  const ort = await import("onnxruntime-web/wasm");
  // Same-origin WASM and one thread (a page without cross-origin isolation cannot share memory). The proxy runs the model
  // in ORT's own worker so the screen stays responsive while it works.
  ort.env.wasm.wasmPaths = `${BASE}/`;
  ort.env.wasm.numThreads = 1;
  ort.env.wasm.proxy = true;
  const options = { executionProviders: ["wasm"] };
  const [det, rec, keys] = await Promise.all([
    ort.InferenceSession.create(`${BASE}/det.onnx`, options),
    ort.InferenceSession.create(`${BASE}/rec.onnx`, options),
    fetch(`${BASE}/keys.txt`).then((r) => r.text()),
  ]);
  // CTC index 0 is the blank; the dictionary follows, then a space.
  return { ort, det, rec, dict: ["", ...keys.split("\n").filter((l) => l !== ""), " "] };
}

/** Start loading the models without reading anything, so the first scan does not wait for them. Safe to call often. */
export function warmUp(): void {
  engine ??= create().catch((e: unknown) => {
    engine = null; // let the next scan try again
    throw e;
  });
  void engine.catch(() => undefined);
}

function engineBytes(): number {
  return performance
    .getEntriesByType("resource")
    .filter((e) => e.name.includes(`${BASE}/`))
    .reduce((sum, e) => sum + ((e as PerformanceResourceTiming).transferSize || 0), 0);
}

// ---- the picture ----

type Canvas = OffscreenCanvas | HTMLCanvasElement;

function makeCanvas(w: number, h: number): Canvas {
  if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(w, h);
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}

function context(c: Canvas): CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D {
  const ctx = c.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("This browser cannot read the photo.");
  return ctx as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
}

/** The photo upright, as the person sees it: a phone stores its rotation as a tag, which the bitmap applies. */
async function loadPhoto(src: string | Blob): Promise<ImageBitmap> {
  const blob = typeof src === "string" ? await (await fetch(src)).blob() : src;
  return createImageBitmap(blob, { imageOrientation: "from-image" });
}

/** CHW float planes of an image drawn at w x h, normalized as `(v / 255 - mean) / std`. */
function toTensorData(
  source: CanvasImageSource,
  w: number,
  h: number,
  mean: readonly number[],
  std: readonly number[],
): Float32Array {
  const c = makeCanvas(w, h);
  const ctx = context(c);
  ctx.drawImage(source, 0, 0, w, h);
  const px = ctx.getImageData(0, 0, w, h).data;
  const out = new Float32Array(3 * w * h);
  const plane = w * h;
  for (let i = 0; i < plane; i++) {
    for (let k = 0; k < 3; k++)
      out[k * plane + i] = ((px[i * 4 + k] ?? 0) / 255 - (mean[k] ?? 0)) / (std[k] ?? 1);
  }
  return out;
}

// ---- finding text ----

interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Text regions in the detector's probability map: connected areas above the threshold, grown back to full height. */
export function findBoxes(
  prob: Float32Array,
  w: number,
  h: number,
): { boxes: Box[]; angle: number | null } {
  const tilts: Array<{ angle: number; weight: number }> = [];
  const seen = new Uint8Array(w * h);
  const stack = new Int32Array(w * h);
  const boxes: Box[] = [];
  for (let start = 0; start < w * h; start++) {
    if (seen[start] || (prob[start] ?? 0) <= DET_THRESHOLD) continue;
    let sp = 0;
    stack[sp++] = start;
    seen[start] = 1;
    let x0 = w;
    let y0 = h;
    let x1 = 0;
    let y1 = 0;
    let sum = 0;
    let count = 0;
    let sx = 0;
    let sy = 0;
    let sxx = 0;
    let syy = 0;
    let sxy = 0;
    while (sp > 0) {
      const p = stack[--sp] ?? 0;
      const x = p % w;
      const y = (p - x) / w;
      sum += prob[p] ?? 0;
      count++;
      sx += x;
      sy += y;
      sxx += x * x;
      syy += y * y;
      sxy += x * y;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const q = ny * w + nx;
        if (!seen[q] && (prob[q] ?? 0) > DET_THRESHOLD) {
          seen[q] = 1;
          stack[sp++] = q;
        }
      }
    }
    const bw = x1 - x0 + 1;
    const bh = y1 - y0 + 1;
    if (Math.min(bw, bh) < MIN_SIDE || sum / count < BOX_THRESHOLD) continue;
    // A long thin region is a line of text; the direction it points in is how far the photo is tilted.
    const mx = sx / count;
    const my = sy / count;
    const cxx = sxx / count - mx * mx;
    const cyy = syy / count - my * my;
    const cxy = sxy / count - mx * my;
    const spread = Math.sqrt((cxx - cyy) ** 2 + 4 * cxy * cxy);
    const major = (cxx + cyy + spread) / 2;
    const minor = Math.max((cxx + cyy - spread) / 2, 1e-6);
    const theta = 0.5 * Math.atan2(2 * cxy, cxx - cyy);
    if (count >= 150 && Math.sqrt(major / minor) > 3 && Math.abs(theta) < MAX_TILT)
      tilts.push({ angle: theta, weight: count });
    // The detector draws a shrunken core of each line; grow it by the DB unclip distance.
    const d = (bw * bh * UNCLIP_RATIO) / (2 * (bw + bh));
    boxes.push({
      x0: Math.max(0, x0 - d),
      y0: Math.max(0, y0 - d),
      x1: Math.min(w - 1, x1 + d),
      y1: Math.min(h - 1, y1 + d),
    });
  }
  return { boxes, angle: dominantAngle(tilts) };
}

/** The tilt most text agrees on: the median angle, each line counted by its size. */
function dominantAngle(tilts: Array<{ angle: number; weight: number }>): number | null {
  if (tilts.length < 3) return null;
  const sorted = [...tilts].sort((a, b) => a.angle - b.angle);
  const half = sorted.reduce((n, t) => n + t.weight, 0) / 2;
  let run = 0;
  for (const t of sorted) {
    run += t.weight;
    if (run >= half) return t.angle;
  }
  return null;
}

/** Greedy CTC decoding: the best symbol at each step, repeats merged, blanks dropped. */
export function decodeCtc(
  logits: Float32Array,
  steps: number,
  classes: number,
  dict: string[],
): { text: string; score: number } {
  let text = "";
  let prev = -1;
  let total = 0;
  let kept = 0;
  for (let t = 0; t < steps; t++) {
    let best = 0;
    let bestV = -Infinity;
    for (let c = 0; c < classes; c++) {
      const v = logits[t * classes + c] ?? -Infinity;
      if (v > bestV) {
        bestV = v;
        best = c;
      }
    }
    if (best !== 0 && best !== prev) {
      text += dict[best] ?? "";
      total += bestV;
      kept++;
    }
    prev = best;
  }
  return { text, score: kept > 0 ? total / kept : 0 };
}

/** How far to scale a photo before detection: down when large, up when its short side is too small to separate lines. */
export function detectionScale(width: number, height: number): number {
  const long = Math.max(width, height);
  const short = Math.min(width, height);
  const down = Math.min(1, DET_MAX_SIDE / long);
  if (short * down >= DET_MIN_SIDE) return down;
  return Math.min(DET_MIN_SIDE / short, DET_UPSCALE_CAP / long);
}

/** The photo turned by `angle` so tilted text runs level; the corners are filled with the photo's own mid-grey. */
function straighten(source: ImageBitmap, angle: number): Canvas {
  const cos = Math.abs(Math.cos(angle));
  const sin = Math.abs(Math.sin(angle));
  const w = Math.round(source.width * cos + source.height * sin);
  const h = Math.round(source.width * sin + source.height * cos);
  const canvas = makeCanvas(w, h);
  const ctx = context(canvas);
  ctx.fillStyle = "#808080";
  ctx.fillRect(0, 0, w, h);
  ctx.translate(w / 2, h / 2);
  ctx.rotate(-angle);
  ctx.drawImage(source, -source.width / 2, -source.height / 2);
  return canvas;
}

function canvasToBlob(c: Canvas): Promise<Blob> {
  if ("convertToBlob" in c) return c.convertToBlob({ type: "image/jpeg", quality: 0.9 });
  return new Promise((resolve, reject) =>
    c.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("The photo could not be turned."))),
      "image/jpeg",
      0.9,
    ),
  );
}

const hasNumbers = (lines: Line[]): number => lines.filter((l) => /\d/.test(l.text)).length;

/** Detect text regions in one picture and read each. Also reports the tilt the regions agree on. */
async function readPass(
  eng: Engine,
  picture: ImageBitmap | Canvas,
): Promise<{ lines: Line[]; angle: number | null }> {
  const { ort, det, rec, dict } = eng;
  const scale = detectionScale(picture.width, picture.height);
  const dw = Math.max(32, Math.round((picture.width * scale) / 32) * 32);
  const dh = Math.max(32, Math.round((picture.height * scale) / 32) * 32);
  const input = toTensorData(picture, dw, dh, MEAN, STD);
  const out = await det.run({
    [det.inputNames[0] ?? "x"]: new ort.Tensor("float32", input, [1, 3, dh, dw]),
  });
  const prob = out[det.outputNames[0] ?? ""]?.data as Float32Array;
  const { boxes, angle } = findBoxes(prob, dw, dh);

  const sx = picture.width / dw;
  const sy = picture.height / dh;
  const lines: Line[] = [];
  for (const b of boxes) {
    const x = b.x0 * sx;
    const y = b.y0 * sy;
    const w = (b.x1 - b.x0 + 1) * sx;
    const h = (b.y1 - b.y0 + 1) * sy;
    const rw = Math.min(REC_MAX_WIDTH, Math.max(8, Math.ceil((REC_HEIGHT * w) / h)));
    const crop = makeCanvas(rw, REC_HEIGHT);
    context(crop).drawImage(picture, x, y, w, h, 0, 0, rw, REC_HEIGHT);
    const data = toTensorData(crop, rw, REC_HEIGHT, [0.5, 0.5, 0.5], [0.5, 0.5, 0.5]);
    const res = await rec.run({
      [rec.inputNames[0] ?? "x"]: new ort.Tensor("float32", data, [1, 3, REC_HEIGHT, rw]),
    });
    const t = res[rec.outputNames[0] ?? ""];
    const dims = t?.dims ?? [];
    const { text, score } = decodeCtc(
      t?.data as Float32Array,
      Number(dims[1] ?? 0),
      Number(dims[2] ?? 0),
      dict,
    );
    if (text.trim() === "") continue;
    lines.push({
      text,
      score,
      box: [
        [x, y],
        [x + w, y],
        [x + w, y + h],
        [x, y + h],
      ],
    });
  }
  lines.sort((a, b) => (a.box[0]?.[1] ?? 0) - (b.box[0]?.[1] ?? 0));
  return { lines, angle };
}

/**
 * Read the text on a photo (a data or blob URL, or a Blob). Lines come back top to bottom. A label held at an angle is
 * read twice: once as it is, then straightened by the tilt the first pass found; the pass that found more numbers wins.
 */
export async function readLines(
  image: string | Blob,
): Promise<{ lines: Line[]; metrics: OcrMetrics; tilt: number; level: Blob | null }> {
  const t0 = performance.now();
  warmUp();
  const eng = await (engine as Promise<Engine>);
  const t1 = performance.now();

  const photo = await loadPhoto(image);
  try {
    const first = await readPass(eng, photo);
    let lines = first.lines;
    let tilt = 0;
    let level: Blob | null = null;
    if (first.angle !== null && Math.abs(first.angle) > MIN_TILT) {
      const turned = straighten(photo, first.angle);
      const second = await readPass(eng, turned);
      if (hasNumbers(second.lines) > hasNumbers(lines)) {
        lines = second.lines;
        tilt = first.angle;
        level = await canvasToBlob(turned); // the coordinates of `lines` belong to this picture, not the original
      }
    }
    const t2 = performance.now();
    const mem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
    return {
      lines,
      level,
      tilt: Math.round((tilt * 180) / Math.PI),
      metrics: {
        loadMs: Math.round(t1 - t0),
        readMs: Math.round(t2 - t1),
        downloadedBytes: engineBytes(),
        heapBytes: mem?.usedJSHeapSize ?? null,
      },
    };
  } finally {
    photo.close();
  }
}
