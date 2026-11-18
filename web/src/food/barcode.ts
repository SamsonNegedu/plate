/** The scanner's decoder: the browser's own BarcodeDetector when it reads EAN-13, otherwise the self-hosted WASM ponyfill. */
export type BarcodeFormat = "ean_13" | "ean_8" | "upc_a" | "upc_e" | "code_128";

export const FORMATS: BarcodeFormat[] = ["ean_13", "ean_8", "upc_a", "upc_e", "code_128"];

interface DetectedBarcode {
  rawValue: string;
}

interface DetectorLike {
  detect(source: ImageBitmapSource): Promise<DetectedBarcode[]>;
}

interface DetectorCtor {
  new (opts: { formats: BarcodeFormat[] }): DetectorLike;
  getSupportedFormats?: () => Promise<string[]>;
}

export interface Detector {
  kind: "native" | "ponyfill";
  /** Returns the first barcode in the source, or null. */
  detect(source: ImageBitmapSource): Promise<string | null>;
}

const WASM_URL = "/wasm/zxing_reader.wasm";

function wrap(kind: Detector["kind"], d: DetectorLike): Detector {
  return {
    kind,
    async detect(source) {
      const hits = await d.detect(source);
      return hits[0]?.rawValue ?? null;
    },
  };
}

export async function createDetector(): Promise<Detector> {
  const native = (globalThis as { BarcodeDetector?: DetectorCtor }).BarcodeDetector;
  if (native) {
    try {
      const supported = (await native.getSupportedFormats?.()) ?? [];
      if (supported.includes("ean_13")) {
        const formats = FORMATS.filter((f) => supported.includes(f));
        return wrap("native", new native({ formats }));
      }
    } catch {
      // A broken native detector falls through to the ponyfill.
    }
  }
  // Loaded only when needed, so the scanner is not in the initial bundle.
  const mod = await import("barcode-detector/ponyfill");
  mod.setZXingModuleOverrides({
    locateFile: (path: string, prefix: string) =>
      path.endsWith(".wasm") ? WASM_URL : prefix + path,
  });
  return wrap(
    "ponyfill",
    new (mod.BarcodeDetector as unknown as DetectorCtor)({ formats: FORMATS }),
  );
}

/** Suppress the same code for a short window: a camera sees one barcode in many consecutive frames. */
export function makeDeduper(windowMs = 2500, now: () => number = Date.now) {
  let last = "";
  let at = 0;
  return (code: string): boolean => {
    const t = now();
    if (code === last && t - at < windowMs) return false;
    last = code;
    at = t;
    return true;
  };
}
