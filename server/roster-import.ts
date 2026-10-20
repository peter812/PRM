/**
 * Roster import (yearbook / playbill demo): find every face on a page, read the
 * printed text with OCR, pair each face with the text in its slot by page
 * geometry (server/roster-layout.ts), then save each reviewed face as a
 * reference (server/references.ts). An optional vision-model pass corrects OCR
 * misreads, but only accepts text grounded in that face's own OCR lines.
 *
 * References are separate from the standard face DB: the page never becomes a
 * photo, and no faces, people or groups are created.
 */
import sharp from "sharp";
import type { FaceBox } from "./faces";
import { describeImage } from "./ai/describe";
import { extractJsonObject } from "./json-extract";
import { runOcrOnBuffer } from "./recognition";
import { detectReferences, saveReferences, type NewReference } from "./references";
import {
  ROSTER_SUBTYPES, contains, faceRows, firstBlock, groupLines, parseSlot, quadToRect, slotsFor, splitRowList,
  type OcrFragment, type ParsedSlot, type Rect, type RosterLayout, type Slot, type TextLine,
} from "./roster-layout";
import type { ReferenceLocation } from "@shared/schema";

export { ROSTER_LAYOUTS, ROSTER_SUBTYPES, type RosterLayout } from "./roster-layout";

export type RosterEntry = {
  n: number;
  referenceUuid: string;
  box: FaceBox;
  cropUrl: string;
  name: string;
  role: string;
  bio: string;
  lowConfidence: boolean;
};

/** Dry-run debug output: the page with faces, slots and OCR lines drawn, each face's lines, and the AI exchange. */
export type RosterDebug = { annotatedImage: string; lines: { n: number; text: string[] }[]; prompt?: string; reply?: string };

/** Boxes are in `page` pixels: the upload, EXIF-rotated and scaled to fit 3000px. */
export type RosterAnalysis = { page: { w: number; h: number }; entries: RosterEntry[]; unmatchedText: string[]; debug?: RosterDebug };

const PAGE_MAX_SIDE = 3000;

// ── OCR ──────────────────────────────────────────────────────────────────────

type OcrLine = { text: string; score: number; box: number[][] };
const ocr = async (image: Buffer): Promise<OcrLine[]> => (await runOcrOnBuffer(image, "image/jpeg", "roster.jpg", {})).lines ?? [];

/** Page OCR fragments used as lines as-is: merging them joins neighbouring grid names. */
const pageLines = async (page: Buffer): Promise<TextLine[]> =>
  (await ocr(page)).map((l) => ({ text: l.text.trim(), score: l.score, box: quadToRect(l.box) })).filter((l) => l.text);

/** Retry for a low-confidence grid slot: the slot crop enlarged and sharpened. */
async function enhancedLines(page: Buffer, r: Rect): Promise<TextLine[]> {
  const SCALE = 2;
  const crop = await sharp(page).extract({ left: r.x, top: r.y, width: r.w, height: r.h })
    .greyscale().normalise().resize({ width: r.w * SCALE }).sharpen().jpeg({ quality: 95 }).toBuffer();
  return (await ocr(crop)).map((l) => {
    const b = quadToRect(l.box);
    return { text: l.text.trim(), score: l.score, box: { x: r.x + b.x / SCALE, y: r.y + b.y / SCALE, w: b.w / SCALE, h: b.h / SCALE } };
  }).filter((l) => l.text);
}

/** Centred moving average (zero-padded at the ends). */
function smooth(a: Float64Array, k: number): Float64Array {
  const out = new Float64Array(a.length), half = Math.floor(k / 2);
  for (let i = 0; i < a.length; i++) {
    let s = 0;
    for (let j = i - half; j <= i - half + k - 1; j++) if (j >= 0 && j < a.length) s += a[j];
    out[i] = s / k;
  }
  return out;
}

/** Per-row ink count over columns [x0, x1). */
function rowInk(ink: Float32Array, w: number, h: number, x0 = 0, x1 = w): Float64Array {
  const rows = new Float64Array(h);
  for (let y = 0; y < h; y++) for (let x = x0; x < x1; x++) rows[y] += ink[y * w + x];
  return rows;
}

/**
 * Vertical offset per column that straightens a curled page: the crop's ink
 * row-profile in K strips, each cross-correlated with its left neighbour.
 */
function curlOffsets(ink: Float32Array, w: number, h: number): Float64Array {
  const K = 12, sw = Math.floor(w / K), maxShift = Math.max(4, Math.floor(h / 12));
  const profiles = Array.from({ length: K }, (_, i) => smooth(rowInk(ink, w, h, i * sw, (i + 1) * sw), 5));
  const sum = (a: Float64Array) => a.reduce((s, v) => s + v, 0);
  const offs = [0];
  for (let i = 1; i < K; i++) {
    const a = profiles[i - 1], b = profiles[i];
    let best = 0, bestScore = -1;
    if (sum(a) >= 1 && sum(b) >= 1) {
      for (let s = -maxShift; s <= maxShift; s++) {
        let score = 0;
        for (let y = Math.max(0, -s); y < Math.min(h, h - s); y++) score += a[y + s] * b[y];
        if (score > bestScore) { bestScore = score; best = s; }
      }
    }
    offs.push(offs[i - 1] + best);
  }
  const dy = new Float64Array(w);
  for (let x = 0; x < w; x++) {
    const t = (x - sw / 2) / sw, i = Math.max(0, Math.min(K - 2, Math.floor(t)));
    const f = Math.max(0, Math.min(1, t - i));
    dy[x] = offs[i] + (offs[i + 1] - offs[i]) * f;
  }
  return dy;
}

/** out(x, y) = in(x, y - dy[x]), linear, `fill` outside. */
function remap<T extends Float32Array | Uint8Array>(src: T, out: T, w: number, h: number, dy: Float64Array, fill: number): T {
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      const sy = y - dy[x], y0 = Math.floor(sy), f = sy - y0;
      const at = (yy: number) => (yy >= 0 && yy < h ? src[yy * w + x] : fill);
      out[y * w + x] = at(y0) * (1 - f) + at(y0 + 1) * f;
    }
  }
  return out;
}

/** Text-line bands [top, bottom) from the row ink profile; a band ~2x the median height is split at its thinnest row. */
function lineBands(rows: Float64Array): [number, number][] {
  const ink = smooth(rows, 3), max = Math.max(...ink), raw: [number, number][] = [];
  let start = -1;
  for (let y = 0; y <= ink.length; y++) {
    const on = y < ink.length && ink[y] > max * 0.02;
    if (on && start < 0) start = y;
    if (!on && start >= 0) { if (y - start >= 5) raw.push([start, y]); start = -1; }
  }
  if (!raw.length) return raw;
  const heights = raw.map(([a, b]) => b - a).sort((a, b) => a - b), med = heights[Math.floor(heights.length / 2)];
  const bands: [number, number][] = [];
  for (let [a, b] of raw) {
    while (Math.round((b - a) / med) >= 2) {
      const lo = a + Math.floor(med * 0.6), hi = a + Math.floor(med * 1.4);
      let cut = lo;
      for (let y = lo; y < hi; y++) if (ink[y] < ink[cut]) cut = y;
      bands.push([a, cut]);
      a = cut;
    }
    bands.push([a, b]);
  }
  // Slivers are rule lines or a photo edge, not text.
  return bands.filter(([a, b]) => b - a >= med * 0.5);
}

/**
 * OCR for a block of paragraph text (leads bios). On a curled page each line's
 * detection box is skewed into its neighbours and recognition fails, so the
 * crop is straightened, cut into one band per printed line, and the bands are
 * restacked with white gaps between them. Each band becomes one line.
 */
export async function paragraphLines(page: Buffer, r: Rect): Promise<TextLine[]> {
  const { data, info } = await sharp(page).extract({ left: r.x, top: r.y, width: r.w, height: r.h })
    .greyscale().raw().toBuffer({ resolveWithObject: true });
  const w = info.width, h = info.height, ch = info.channels;
  const grey = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) grey[i] = data[i * ch];
  const blur = await sharp(Buffer.from(grey), { raw: { width: w, height: h, channels: 1 } }).blur(12).greyscale().raw().toBuffer();
  // Ink: darker than the local background, so photo edges and shading don't count.
  const ink = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) ink[i] = grey[i] < blur[i] - 25 ? 1 : 0;

  const dy = curlOffsets(ink, w, h);
  const bands = lineBands(rowInk(remap(ink, new Float32Array(w * h), w, h, dy, 0), w, h));
  // Divide out the paper shade so bands and the white gaps between them share one background.
  const paper = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) paper[i] = Math.min(255, (grey[i] * 255) / Math.max(1, blur[i] + 10));
  // White out the photo's edge beside the text and any vertical rule: columns dark over most of their height.
  const colMedian = (x: number) => { const c = Array.from({ length: h }, (_, y) => grey[y * w + x]).sort((a, b) => a - b); return c[h >> 1]; };
  const medians = Array.from({ length: w }, (_, x) => colMedian(x));
  const paperLevel = [...medians].sort((a, b) => a - b)[Math.floor(w * 0.75)];
  const blank = (x: number) => { for (let y = 0; y < h; y++) grey[y * w + x] = paper[y * w + x] = 255; };
  for (let x = 0; x < w; x++) if (medians[x] < paperLevel * 0.75) blank(x);

  // The detector still skips the odd clean line, so bands that come back empty are re-read from the unflattened crop.
  const found = new Map<number, OcrFragment[]>();
  for (const img of [paper, grey]) {
    const todo = bands.map((_, i) => i).filter((i) => !found.has(i));
    if (!todo.length) break;
    for (const [i, frags] of await readBands(remap(img, new Uint8Array(w * h), w, h, dy, 255), w, h, todo.map((i) => bands[i]))) {
      found.set(todo[i], frags.map((f) => {
        const x = Math.round(Math.min(w - 1, Math.max(0, f.box.x + f.box.w / 2)));
        return { ...f, box: { ...f.box, x: r.x + f.box.x, y: r.y + f.box.y - dy[x] } };
      }));
    }
  }
  return [...found.entries()].sort(([a], [b]) => a - b).map(([, frags]) => {
    frags.sort((a, b) => a.box.x - b.box.x);
    const x = Math.min(...frags.map((f) => f.box.x)), top = Math.min(...frags.map((f) => f.box.y));
    return {
      text: frags.map((f) => f.text).join(" "),
      score: Math.min(...frags.map((f) => f.score)),
      box: { x, y: top, w: Math.max(...frags.map((f) => f.box.x + f.box.w)) - x, h: Math.max(...frags.map((f) => f.box.y + f.box.h)) - top },
    };
  });
}

/** OCR of the given bands stacked with white gaps; fragments per band index, in the (straightened) crop's pixels. */
async function readBands(img: Uint8Array, w: number, h: number, bands: [number, number][]): Promise<Map<number, OcrFragment[]>> {
  let y = 0;
  const placed = bands.map(([a, b]) => {
    const m = Math.max(3, Math.floor((b - a) / 5));
    const p = { top: Math.max(0, a - m), bottom: Math.min(h, b + m), stackTop: y };
    y += p.bottom - p.top + (b - a);
    return { ...p, stackEnd: y };
  });
  y = Math.max(y, 300); // OCR scales a short image up to its detector size; keep that sane.
  const stack = new Uint8Array(w * y).fill(255);
  for (const p of placed) stack.set(img.subarray(p.top * w, p.bottom * w), p.stackTop * w);
  const image = await sharp(Buffer.from(stack), { raw: { width: w, height: y, channels: 1 } }).jpeg({ quality: 95 }).toBuffer();

  const out = new Map<number, OcrFragment[]>();
  for (const l of await ocr(image)) {
    const b = quadToRect(l.box), mid = b.y + b.h / 2;
    const i = placed.findIndex((p) => mid >= p.stackTop && mid < p.stackEnd);
    // A lone tall glyph is a rule line or page edge read as "I" or "|".
    if (i < 0 || !l.text.trim() || /^[|Il1!]$/.test(l.text.trim())) continue;
    out.set(i, [...(out.get(i) ?? []), { text: l.text.trim(), score: l.score, box: { ...b, y: b.y - placed[i].stackTop + placed[i].top } }]);
  }
  return out;
}

// ── AI refine ────────────────────────────────────────────────────────────────

const words = (s: string) => s.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);

function editDistance(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}

/** True when nearly every word of `value` is in `source`, allowing OCR-sized misreads ("glorv" → "glory"). */
function grounded(value: string, source: string): boolean {
  const have = words(source), want = words(value);
  if (!want.length) return true;
  const found = want.filter((w) => have.some((h) => editDistance(w, h) <= (w.length >= 8 ? 2 : w.length >= 4 ? 1 : 0)));
  return found.length >= want.length * 0.85;
}

/**
 * The vision model sees the page with numbered faces plus each face's OCR lines
 * (by id) and fixes misreads. A field is taken only when grounded in that
 * face's own lines or the unmatched ones, so it cannot swap text between faces.
 */
async function refineWithAi(
  labeled: Buffer, sub: { role?: boolean; bio?: boolean }, parsed: ParsedSlot[], slotText: TextLine[][], unmatched: TextLine[],
): Promise<{ prompt: string; reply: string }> {
  let id = 0;
  const listing = (ls: TextLine[]) => ls.map((l) => `  L${++id}: ${l.text}`).join("\n") || "  (none)";
  const prompt = [
    "This is a scanned yearbook or playbill page. I drew a red numbered box on each detected face.",
    "OCR has already read the text, and each face below lists the OCR lines printed beside it along with my current reading.",
    "Use the image to fix OCR misreads (wrong letters, split or joined words, caps). Only use text from that face's own lines or from the unmatched lines; never move text between faces and never invent text.",
    `Return name${sub.role ? ", role (multiple roles as one string, as printed)" : ""}${sub.bio ? ", bio (one paragraph, starting with any name it opens with)" : ""} for each face. Names in Title Case.`,
    "",
    ...parsed.flatMap((p, i) => [`Face ${i + 1}: current name "${p.name}"${sub.role ? `, role "${p.role}"` : ""}`, listing(slotText[i])]),
    "",
    "Unmatched lines:",
    listing(unmatched),
    "",
    `Reply with JSON only: {"faces":[{"n":1,"name":""${sub.role ? ',"role":""' : ""}${sub.bio ? ',"bio":""' : ""}}]}`,
  ].join("\n");
  const reply = await describeImage(labeled, { prompt });
  const faces = (extractJsonObject(reply) as { faces?: any[] } | null)?.faces;
  if (!Array.isArray(faces)) return { prompt, reply };
  const extra = unmatched.map((l) => l.text).join(" ");
  for (const f of faces) {
    const p = parsed[Number(f?.n) - 1];
    if (!p) continue;
    const source = `${slotText[Number(f.n) - 1].map((l) => l.text).join(" ")} ${extra}`;
    const take = (key: "name" | "role" | "bio") => {
      const v = typeof f[key] === "string" ? f[key].trim() : "";
      if (v && grounded(v, source)) { p[key] = v; return true; }
      return false;
    };
    if (take("name")) p.lowConfidence = false;
    if (sub.role) take("role");
    if (sub.bio) take("bio");
  }
  return { prompt, reply };
}

// ── Pipeline ─────────────────────────────────────────────────────────────────

/** The page with faces numbered; with `slots`/`lines`, also each face's text slot and the OCR lines read. */
async function annotate(page: Buffer, size: { w: number; h: number }, faces: FaceBox[], slots: Slot[] = [], lines: TextLine[] = []): Promise<Buffer> {
  const rect = (b: Rect, style: string) => `<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" fill="none" ${style}/>`;
  const marks = [
    ...slots.flatMap((s) => [s.main, s.role].filter((r): r is Rect => !!r).map((r) => rect(r, `stroke="#2563eb" stroke-width="3" stroke-dasharray="12 8"`))),
    ...lines.map((l) => rect(l.box, `stroke="${l.score < 0.8 ? "#f59e0b" : "#16a34a"}" stroke-width="2"`)),
    ...faces.map((b, i) => {
      const size = Math.max(14, Math.round(b.h * 0.3));
      return rect(b, `stroke="#ff0040" stroke-width="${Math.max(2, size / 8)}"`)
        + `<rect x="${b.x}" y="${b.y}" width="${size * (String(i + 1).length * 0.65 + 0.4)}" height="${size * 1.1}" fill="#ff0040"/>`
        + `<text x="${b.x + size * 0.2}" y="${b.y + size * 0.9}" font-family="Arial, sans-serif" font-weight="bold" font-size="${size}" fill="#fff">${i + 1}</text>`;
    }),
  ];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size.w}" height="${size.h}">${marks.join("")}</svg>`;
  return sharp(page).composite([{ input: Buffer.from(svg) }]).jpeg({ quality: 85 }).toBuffer();
}

/**
 * `dryRun` stores nothing (not even compute's vectors/crops) and returns debug
 * output. `aiRefine` adds the grounded vision-model pass.
 */
export async function analyzeRoster(
  upload: Buffer, layout: RosterLayout, subtype: string, opts: { dryRun?: boolean; aiRefine?: boolean } = {},
): Promise<RosterAnalysis> {
  const sub = ROSTER_SUBTYPES[layout].find((s) => s.value === subtype)!;
  // One orientation and scale for detection, OCR and the boxes the client draws.
  const { data: page, info } = await sharp(upload).rotate()
    .resize(PAGE_MAX_SIDE, PAGE_MAX_SIDE, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 95 }).toBuffer({ resolveWithObject: true });
  const size = { w: info.width, h: info.height };
  const beside = sub.parse.startsWith("beside");
  const [detected, ocrLines] = await Promise.all([
    detectReferences(page, "image/jpeg", "roster.jpg", opts.dryRun),
    beside ? Promise.resolve([]) : pageLines(page),
  ]);
  if (detected.length === 0) return { page: size, entries: [], unmatchedText: ocrLines.map((l) => l.text) };

  const rows = faceRows(detected);
  const faces = rows.flat();
  const slots = slotsFor(sub.parse, rows, size);
  const slotText: TextLine[][] = [];
  const used = new Set<TextLine>();
  let parsed: ParsedSlot[];

  if (sub.parse === "row_list") {
    let i = 0;
    parsed = rows.flatMap((row) => {
      const lines = ocrLines.filter((l) => contains(slots[i].main, l.box));
      lines.forEach((l) => used.add(l));
      row.forEach(() => { slotText[i++] = lines; });
      return splitRowList(lines, row.length);
    });
  } else if (beside) {
    // Leads slots are large and few; read them a couple at a time.
    parsed = [];
    for (let i = 0; i < slots.length; i += 2) {
      await Promise.all(slots.slice(i, i + 2).map(async (slot, k) => {
        const [main, role] = await Promise.all([paragraphLines(page, slot.main), slot.role ? enhancedLines(page, slot.role).then(groupLines) : []]);
        slotText[i + k] = [...main, ...role];
        parsed[i + k] = parseSlot(sub.parse, main, role);
      }));
    }
  } else {
    parsed = await Promise.all(slots.map(async (slot, i) => {
      const [main] = firstBlock(ocrLines.filter((l) => contains(slot.main, l.box)));
      main.forEach((l) => used.add(l));
      slotText[i] = main;
      const p = parseSlot(sub.parse, main);
      if (!p.lowConfidence) return p;
      const [retry] = firstBlock(await enhancedLines(page, slot.main));
      const p2 = parseSlot(sub.parse, retry);
      if (p2.lowConfidence) return p;
      slotText[i] = retry;
      return p2;
    }));
  }
  const unmatched = ocrLines.filter((l) => !used.has(l));

  let ai: { prompt: string; reply: string } | undefined;
  if (opts.aiRefine) ai = await refineWithAi(await annotate(page, size, faces.map((f) => f.box)), sub, parsed, slotText, unmatched);

  const entries = faces.map((face, i): RosterEntry => ({ n: i + 1, ...face, ...parsed[i] }));
  const debug = opts.dryRun ? {
    annotatedImage: `data:image/jpeg;base64,${(await annotate(page, size, faces.map((f) => f.box), slots, [...slotText.flat(), ...unmatched])).toString("base64")}`,
    lines: slotText.map((ls, i) => ({ n: i + 1, text: ls.map((l) => `${l.score.toFixed(2)}  ${l.text}`) })),
    ...ai,
  } : undefined;
  return { page: size, entries, unmatchedText: unmatched.map((l) => l.text), debug };
}

/** Save the kept faces as references; the skipped ones are dropped from compute. */
export function commitRoster(location: ReferenceLocation, entries: NewReference[], discard: string[]): Promise<number> {
  return saveReferences(location, entries, discard);
}
