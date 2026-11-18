// Draws the app icons (a barcode on the accent green) with no image dependency. Output is committed; run `node scripts/make-icons.mjs` to regenerate.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const out = resolve(root, "public/icons");
mkdirSync(out, { recursive: true });

const GREEN = [0x2e, 0x6b, 0x4a];
const PAPER = [0xf4, 0xf5, 0xef];

function crc32(buf) {
  let c;
  const table = Array.from({ length: 256 }, (_, n) => {
    c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  let crc = 0xffffffff;
  for (const b of buf) crc = table[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function png(size, pixel) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixel(x / size, y / size);
      const o = y * (size * 4 + 1) + 1 + x * 4;
      raw[o] = r;
      raw[o + 1] = g;
      raw[o + 2] = b;
      raw[o + 3] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

// Bars as [start, width] in a 0..1 box, widest at the edges like a real code.
const bars = [[0, 0.1], [0.16, 0.05], [0.26, 0.1], [0.42, 0.05], [0.52, 0.12], [0.7, 0.05], [0.8, 0.05], [0.9, 0.1]];

function icon(size, { maskable }) {
  const box = maskable ? 0.4 : 0.54; // maskable icons keep their art inside the central safe zone
  const left = (1 - box) / 2;
  const top = 0.5 - box * 0.35;
  const bottom = 0.5 + box * 0.35;
  const radius = maskable ? 0 : 0.22;
  return png(size, (u, v) => {
    const dx = Math.max(Math.abs(u - 0.5) - (0.5 - radius), 0);
    const dy = Math.max(Math.abs(v - 0.5) - (0.5 - radius), 0);
    if (!maskable && Math.hypot(dx, dy) > radius) return [0, 0, 0, 0];
    const inBars = v >= top && v <= bottom && bars.some(([s, w]) => u >= left + s * box && u <= left + (s + w) * box);
    return inBars ? [...PAPER, 255] : [...GREEN, 255];
  });
}

writeFileSync(resolve(out, "icon-192.png"), icon(192, { maskable: false }));
writeFileSync(resolve(out, "icon-512.png"), icon(512, { maskable: false }));
writeFileSync(resolve(out, "icon-maskable-512.png"), icon(512, { maskable: true }));
writeFileSync(resolve(out, "apple-touch-icon.png"), icon(180, { maskable: true }));
console.log("icons written");
