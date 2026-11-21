// Copies the WebAssembly the app runs into public, so the app serves it itself. No CDN, ever (CSP, offline).
// wasm/ holds the barcode decoder (precached). ocr/ holds the label reader (the models and the ONNX runtime), which is
// only fetched the first time someone scans a nutrition label and then cached by the service worker.
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
// A build stores the label reader gzipped (30 MB becomes 18 MB, in the binary and on the wire); the Go server sends it
// with Content-Encoding. The dev server and the tests need the plain files. Only one form is ever left in public/.
const gzip = process.argv.includes("--gzip");
const copy = (from, to) => {
  const dest = resolve(root, to);
  mkdirSync(dirname(dest), { recursive: true });
  copyFileSync(resolve(root, from), dest);
  console.log(`copied ${to}`);
};
const copyOcr = (from, name) => {
  const plain = resolve(root, "public/ocr", name);
  const packed = `${plain}.gz`;
  mkdirSync(dirname(plain), { recursive: true });
  if (gzip) {
    writeFileSync(packed, gzipSync(readFileSync(resolve(root, from)), { level: 9 }));
    rmSync(plain, { force: true });
  } else {
    copyFileSync(resolve(root, from), plain);
    rmSync(packed, { force: true });
  }
  console.log(`copied public/ocr/${name}${gzip ? ".gz" : ""}`);
};

copy("node_modules/zxing-wasm/dist/reader/zxing_reader.wasm", "public/wasm/zxing_reader.wasm");

const models = "node_modules/@gutenye/ocr-models/assets";
copyOcr(`${models}/ch_PP-OCRv4_det_infer.onnx`, "det.onnx");
copyOcr(`${models}/ch_PP-OCRv4_rec_infer.onnx`, "rec.onnx");
copyOcr(`${models}/ppocr_keys_v1.txt`, "keys.txt");
const ort = "node_modules/onnxruntime-web/dist";
copyOcr(`${ort}/ort-wasm-simd-threaded.wasm`, "ort-wasm-simd-threaded.wasm");
copyOcr(`${ort}/ort-wasm-simd-threaded.mjs`, "ort-wasm-simd-threaded.mjs");
