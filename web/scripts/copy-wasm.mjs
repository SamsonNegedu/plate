// Copies the scanner's WebAssembly decoder into public/wasm so the app serves it itself. No CDN, ever (CSP, offline).
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const src = resolve(root, "node_modules/zxing-wasm/dist/reader/zxing_reader.wasm");
const dest = resolve(root, "public/wasm/zxing_reader.wasm");
mkdirSync(dirname(dest), { recursive: true });
copyFileSync(src, dest);
console.log("copied zxing_reader.wasm to public/wasm");
