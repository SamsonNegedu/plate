/**
 * Turns the text lines OCR found on a nutrition label into per-100 g values. Pure: no DOM, no network, so it is tested
 * against fixed lines. Two rules shape it. A per-serving column is never read as per 100 g, and a value that cannot be
 * read stays missing instead of becoming 0. Anything the checks cannot settle is flagged for the person to confirm.
 */

export interface Line {
  text: string;
  score: number;
  /** Four corners, clockwise from the top left, in pixels. */
  box: Array<[number, number]>;
}

export type Field =
  | "kcal"
  | "kj"
  | "fat"
  | "satfat"
  | "carbs"
  | "sugar"
  | "fiber"
  | "protein"
  | "salt";

export interface ParsedLabel {
  values: Partial<Record<Field, number>>;
  /** Fields the person should look at before saving. */
  check: Field[];
  /** The label only had per-serving numbers, so none were read. */
  perServing: boolean;
  /** The rows that held the values, so the photo can be cropped to the table. Null when nothing was read. */
  region: Region | null;
}

interface Word {
  t: string;
  cx: number;
  cy: number;
  h: number;
  /** The box of the OCR line this word came from, for cropping the photo to the table. */
  line: Region;
}

/** A rectangle in the photo's pixels. */
export interface Region {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

interface Row {
  cy: number;
  w: Word[];
}

interface Token {
  s: string;
  unit: string | null;
  cx: number;
  raw: string;
}

type Candidates = Array<[value: number, confidence: number]>;

const fold = (t: string): string =>
  t.toLowerCase().replace(/ß/g, "ss").normalize("NFKD").replace(/\p{M}/gu, "");

// Order matters: a row is the first field that matches, so "of which" rows come before their parents.
const LABELS: Array<[Field | "energy", RegExp]> = [
  ["satfat", /gesatt|saturat|satur|verzadig|nasycon|saturi|dont acides|acides gras/],
  ["sugar", /zucker|sugar|sucre|zucchero|zuccheri|azucar|suiker|cukr|cukier/],
  ["fiber", /ballast|fibre|fiber|fibra|vezel|blonnik|nahrungsfaser/],
  ["protein", /eiwei|protein|proteine|proteina|eiwit|bialk|bilkov/],
  [
    "carbs",
    /kohlenhydrat|carbohydrat|glucide|carboidrat|hidrato|koolhydr|weglowod|saharid|sacharid/,
  ],
  [
    "fat",
    /\bfett\b|\bfat\b|matieres grasses|graisses|lipid|grassi|grasas|\bvetten\b|tluszcz|\bzsir\b/,
  ],
  ["salt", /\b(salz|salt|sel|sale|sal|zout|sol)\b/],
  ["energy", /energie|energy|energia|energi|brennwert|valeur energ/],
];

const SERVING_PANEL = /nutrition facts|serving size|amount per serving|per serving/;
const PER_100 = /100\s?(g|ml)/;
const MAX_KCAL = 1000;
const GRAM_CAP = 100;
const KJ_PER_KCAL = 4.184;

const UNITS = new Set(["kcal", "kj", "mg", "ml"]);

/** A word of a nutrient's name: letters only, three or more, and not a unit. "g" and "og" are values, not labels. */
const isLabelWord = (t: string): boolean => /^\p{L}{3,}$/u.test(t) && !UNITS.has(t.toLowerCase());

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? (s[m] ?? 0) : ((s[m - 1] ?? 0) + (s[m] ?? 0)) / 2;
};

/** Splits each OCR line into words placed along the line's box, so columns can be told apart by x. */
export function toWords(lines: Line[]): Word[] {
  const out: Word[] = [];
  for (const l of lines) {
    const xs = l.box.map((p) => p[0]);
    const ys = l.box.map((p) => p[1]);
    const left = Math.min(...xs);
    const right = Math.max(...xs);
    const top = Math.min(...ys);
    const bottom = Math.max(...ys);
    const toks = l.text.split(/\s+/).filter(Boolean);
    if (toks.length === 0) continue;
    const total = toks.reduce((n, t) => n + t.length, 0) + toks.length - 1;
    let pos = left;
    for (const t of toks) {
      const width = ((right - left) * t.length) / total;
      out.push({
        t,
        cx: pos + width / 2,
        cy: (top + bottom) / 2,
        h: bottom - top,
        line: { x0: left, y0: top, x1: right, y1: bottom },
      });
      pos += width + (right - left) / total;
    }
  }
  return out;
}

export function toRows(words: Word[]): Row[] {
  if (words.length === 0) return [];
  const h = median(words.map((w) => w.h));
  const rows: Row[] = [];
  for (const w of [...words].sort((a, b) => a.cy - b.cy)) {
    const last = rows[rows.length - 1];
    if (last && Math.abs(w.cy - last.cy) < 0.6 * h) {
      last.w.push(w);
      last.cy = last.w.reduce((n, x) => n + x.cy, 0) / last.w.length;
    } else rows.push({ cy: w.cy, w: [w] });
  }
  for (const r of rows) r.w.sort((a, b) => a.cx - b.cx);
  return rows;
}

const NUMBER = /^[^\w<]*(<?\d+(?:[.,]\d+)?)\s*(kcal|kj|mg|g|k\)|kJ)?[^\w]*$/i;
const ZERO_G = /^[([]?[oO0][gG9]?[)\]]?$/;

function tokensOf(row: Row): Token[] {
  const out: Token[] = [];
  row.w.forEach((w, i) => {
    let t = w.t;
    if (ZERO_G.test(t) && /[gG9]$/.test(t.replace(/[)\]]/g, ""))) t = "0g";
    else if (/^[oO]$/.test(t)) t = "0";
    if (t.includes("%")) return;
    const m = NUMBER.exec(t.replace(/^[^\w<]+|[^\w]+$/g, "").replace(/O/g, "0")) ?? NUMBER.exec(t);
    if (!m) return;
    let unit = m[2]?.toLowerCase() ?? null;
    if (unit === null) {
      const next = row.w[i + 1]?.t.toLowerCase().replace(/[()/]/g, "");
      if (next === "g" || next === "mg" || next === "kcal" || next === "kj") unit = next;
    }
    out.push({ s: (m[1] ?? "").replace("<", "").replace(",", "."), unit, cx: w.cx, raw: w.t });
  });
  return out;
}

/** Readings of one number. A trailing 9 may be a misread "g"; a whole number may have lost its decimal separator. */
export function candidates(tok: Token): Candidates {
  const v = Number(tok.s);
  const u = tok.unit;
  if (u === "kcal" || u === "kj" || u === "k)") return [[v, 0.9]];
  if (u === "g" || u === "mg") {
    if (!tok.s.includes(".") && v >= 1)
      return [
        [v, 0.8],
        [v / 10, 0.5],
      ];
    return [[v, 0.9]];
  }
  if (/\d9$/.test(tok.s)) {
    if (tok.s.includes("."))
      return [
        [Number(tok.s.slice(0, -1)), 0.6],
        [v, 0.4],
      ];
    if (tok.s.length >= 2) {
      const body = tok.s.slice(0, -1);
      const alt = body.length > 1 ? Number(`${body.slice(0, -1)}.${body.slice(-1)}`) : Number(body);
      return [
        [Number(body), 0.5],
        [alt, 0.5],
        [v, 0.2],
      ];
    }
  }
  return [[v, 0.6]];
}

const HEADER_WORD = /^(je|pro|per|pour)?\s*100(g|ml)?[.)]?$/;

/**
 * The x of the "per 100 g" column heading. A pack has other "100 g" text (the weight, a serving line), so the heading is the
 * one closest above the energy row; without an energy row, the topmost one.
 */
export function header(rows: Row[]): number | null {
  const energy = rows.find((r) => r.w.some((w) => /kcal|kj|energi/.test(fold(w.t))));
  const found: Array<{ cx: number; cy: number }> = [];
  for (const r of rows)
    for (const w of r.w) if (HEADER_WORD.test(fold(w.t))) found.push({ cx: w.cx, cy: r.cy });
  if (found.length === 0) return null;
  if (energy) {
    const above = found.filter((f) => f.cy < energy.cy && energy.cy - f.cy < 400);
    const nearest = above.sort((x, y) => y.cy - x.cy)[0];
    if (nearest) return nearest.cx;
  }
  return found.sort((x, y) => x.cy - y.cy)[0]?.cx ?? null;
}

type Reading = Partial<Record<Field, Candidates>>;

const union = (words: Word[]): Region | null => {
  if (words.length === 0) return null;
  return {
    x0: Math.min(...words.map((w) => w.line.x0)),
    y0: Math.min(...words.map((w) => w.line.y0)),
    x1: Math.max(...words.map((w) => w.line.x1)),
    y1: Math.max(...words.map((w) => w.line.y1)),
  };
};

function read(rows: Row[]): { reading: Reading; region: Region | null } {
  const out: Reading = {};
  const used: Word[] = [];
  const hx = header(rows);
  let pend: Field | "energy" | null = null;
  rows.forEach((row, i) => {
    const text = fold(
      row.w
        .filter((w) => !/\d/.test(w.t))
        .map((w) => w.t)
        .join(" "),
    );
    let label: Field | "energy" | null = null;
    for (const [k, re] of LABELS)
      if (re.test(text)) {
        label = k;
        break;
      }
    // A value sits to the right of its label. Stray glyphs left of the label (the pack's side text read letter by letter)
    // are not values, and the right-hand column of a different panel is not part of this row.
    const labelEdge = Math.max(
      -Infinity,
      ...row.w.filter((w) => isLabelWord(w.t) && (hx === null || w.cx < hx)).map((w) => w.cx),
    );
    let toks = tokensOf(row).filter((t) => t.cx > labelEdge);
    if (label === null && pend && toks.length > 0) label = pend;
    pend = null;
    if (label === null) return;
    const next = rows[i + 1];
    if (toks.length === 0) {
      pend = label;
      if (label === "energy" && next) toks = tokensOf(next).filter((t) => t.cx > labelEdge);
      if (toks.length === 0) return;
    }
    if (label === "energy") {
      const nextIsLabel = next
        ? LABELS.some(([, re]) => re.test(fold(next.w.map((w) => w.t).join(" "))))
        : true;
      let all = nt(toks, next, nextIsLabel);
      if (hx !== null) {
        const near = all.filter((t) => Math.abs(t.cx - hx) < 250);
        if (near.length > 0) all = near;
      }
      const kcal = all.find((t) => t.unit === "kcal");
      const kj = all.find((t) => t.unit === "kj" || t.unit === "k)");
      if (kcal && !out.kcal) out.kcal = [[Number(kcal.s), 0.9]];
      if (kj && !out.kj) out.kj = [[Number(kj.s), 0.9]];
      if (kcal || kj) used.push(...row.w, ...(next && !nextIsLabel ? next.w : []));
      if (!kcal) {
        const vals = all.map((t) => Number(t.s));
        for (const a of vals)
          for (const b of vals)
            if (b > 0 && Math.abs(a / b - KJ_PER_KCAL) < 0.2) {
              out.kj ??= [[a, 0.7]];
              out.kcal ??= [[b, 0.7]];
            }
      }
      return;
    }
    if (hx !== null) toks.sort((a, b) => Math.abs(a.cx - hx) - Math.abs(b.cx - hx));
    const first = toks[0];
    if (first && !out[label]) {
      out[label] = candidates(first);
      used.push(...row.w);
    }
  });
  const headRow = hx === null ? undefined : rows.find((r) => r.w.some((w) => w.cx === hx));
  if (headRow) used.push(...headRow.w);
  return { reading: out, region: union(used) };
}

const nt = (toks: Token[], next: Row | undefined, nextIsLabel: boolean): Token[] =>
  next && !nextIsLabel ? [...toks, ...tokensOf(next)] : toks;

function capFor(k: Field): number {
  if (k === "kcal") return MAX_KCAL;
  if (k === "kj") return 3800;
  return GRAM_CAP;
}

/** Picks the combination of readings that agrees with the arithmetic of a label, and names what is still unsettled. */
export function solve(reading: Reading): {
  values: Partial<Record<Field, number>>;
  check: Field[];
} {
  const fields = (Object.keys(reading) as Field[]).filter((k) => (reading[k]?.length ?? 0) > 0);
  const opts = new Map<Field, Candidates>();
  for (const k of fields) {
    const cap = capFor(k);
    const seen: Candidates = [];
    for (const c of reading[k] ?? [])
      if (c[0] <= cap && !seen.some((s) => Math.abs(s[0] - c[0]) < 1e-9)) seen.push(c);
    if (seen.length > 0) opts.set(k, seen.slice(0, 3));
  }
  const keys = [...opts.keys()];
  let best: { score: number; v: Partial<Record<Field, number>> } | null = null;
  const all: Array<{ score: number; v: Partial<Record<Field, number>> }> = [];
  const walk = (i: number, v: Partial<Record<Field, number>>, conf: number) => {
    const key = keys[i];
    if (key === undefined) {
      const score = conf + checks(v);
      all.push({ score, v: { ...v } });
      if (!best || score > best.score) best = { score, v: { ...v } };
      return;
    }
    for (const [val, c] of opts.get(key) ?? []) walk(i + 1, { ...v, [key]: val }, conf + c);
  };
  walk(0, {}, 0);
  const chosen = best as { score: number; v: Partial<Record<Field, number>> } | null;
  if (!chosen) return { values: {}, check: [] };
  const check: Field[] = [];
  for (const k of keys) {
    const alt = all.filter((a) => a.v[k] !== chosen.v[k]).map((a) => a.score);
    if (alt.length > 0 && Math.max(...alt) >= chosen.score - 1) check.push(k);
  }
  return { values: chosen.v, check };
}

function checks(v: Partial<Record<Field, number>>): number {
  let s = 0;
  const { kcal, kj, protein, carbs, fat, fiber, satfat, sugar } = v;
  if (kcal !== undefined && protein !== undefined && carbs !== undefined && fat !== undefined) {
    const expected = 4 * protein + 4 * carbs + 9 * fat + 2 * (fiber ?? 0);
    s += Math.abs(expected - kcal) <= 0.15 * Math.max(kcal, 1) ? 3 : -3;
  }
  if (satfat !== undefined && fat !== undefined) s += satfat <= fat ? 1 : -3;
  if (sugar !== undefined && carbs !== undefined) s += sugar <= carbs ? 1 : -3;
  if (kcal !== undefined && kj !== undefined && kcal > 0)
    s += Math.abs(kj - KJ_PER_KCAL * kcal) <= 0.05 * kj ? 1 : -2;
  return s;
}

/** The whole job: lines in, per-100 g values and what to double-check out. */
export function parseLabel(lines: Line[]): ParsedLabel {
  const all = fold(lines.map((l) => l.text).join(" "));
  if (SERVING_PANEL.test(all) && !PER_100.test(all))
    return { values: {}, check: [], perServing: true, region: null }; // never read a per-serving column as per 100 g
  const words = toWords(lines);
  const hx = header(toRows(words));
  // Text further right than the value column belongs to another panel of the pack (address, certification, barcode) whose
  // lines sit between the table's rows; leaving it in would merge those lines into the table's rows.
  const reach = hx === null ? Infinity : hx + 3.8 * median(words.map((w) => w.h));
  const { reading, region } = read(toRows(words.filter((w) => w.cx <= reach)));
  const { values, check } = solve(reading);
  if (values.kcal === undefined && values.kj !== undefined) {
    values.kcal = Math.round(values.kj / KJ_PER_KCAL);
    check.push("kcal"); // derived from kJ, so worth a look
  }
  return { values, check, perServing: false, region };
}
