/**
 * Roster page geometry: where each face's printed text sits (its slot), how OCR
 * fragments regroup into lines, and how a slot's lines become name / role / bio
 * for each page subtype. Pure functions, no I/O.
 */
import type { FaceBox } from "./faces";

export type Rect = { x: number; y: number; w: number; h: number };
export type OcrFragment = { text: string; score: number; box: Rect };
export type TextLine = { text: string; score: number; box: Rect };

export type RosterLayout = "yearbook" | "yearbook_advanced" | "cyt" | "cyt_leads";
/** How a subtype's text is arranged around each face. */
type Parse = "below_name" | "below_first_last" | "below_name_role" | "row_list" | "beside_role_dash" | "beside_name_in_bio";
export type RosterSubtype = { value: string; parse: Parse; role?: boolean; bio?: boolean };

export const ROSTER_LAYOUTS = ["yearbook", "yearbook_advanced", "cyt", "cyt_leads"] as const;

/** The first subtype of each layout is its default. */
export const ROSTER_SUBTYPES: Record<RosterLayout, RosterSubtype[]> = {
  yearbook: [{ value: "standard", parse: "below_name" }],
  yearbook_advanced: [{ value: "standard", parse: "row_list" }],
  cyt: [
    { value: "separated", parse: "below_first_last" },
    { value: "name_role", parse: "below_name_role", role: true },
  ],
  cyt_leads: [
    { value: "spokane", parse: "beside_role_dash", role: true, bio: true },
    { value: "north_idaho", parse: "beside_name_in_bio", role: true, bio: true },
  ],
};

// ── Slots ────────────────────────────────────────────────────────────────────

/** A face's text regions: `main` holds the name (and bio beside it); `role` is North Idaho's caption under the photo. */
export type Slot = { main: Rect; role?: Rect };

const bottom = (b: Rect) => b.y + b.h;
const right = (b: Rect) => b.x + b.w;
const cx = (b: Rect) => b.x + b.w / 2;
const cy = (b: Rect) => b.y + b.h / 2;

/** Rows by vertical centre, each left to right; rows top to bottom. */
export function faceRows<T extends { box: FaceBox }>(items: T[]): T[][] {
  const byY = [...items].sort((a, b) => cy(a.box) - cy(b.box));
  const rows: T[][] = [];
  for (const item of byY) {
    const row = rows[rows.length - 1];
    const rowCy = row && row.reduce((s, r) => s + cy(r.box), 0) / row.length;
    const rowH = row && row.reduce((s, r) => s + r.box.h, 0) / row.length;
    if (row && Math.abs(cy(item.box) - rowCy!) < rowH! * 0.5) row.push(item);
    else rows.push([item]);
  }
  return rows.map((row) => row.sort((a, b) => a.box.x - b.box.x));
}

const clampRect = (r: Rect, page: { w: number; h: number }): Rect => {
  const x = Math.max(0, Math.round(r.x)), y = Math.max(0, Math.round(r.y));
  return { x, y, w: Math.max(1, Math.min(page.w, Math.round(r.x + r.w)) - x), h: Math.max(1, Math.min(page.h, Math.round(r.y + r.h)) - y) };
};

/**
 * One slot per face, in the same order as `rows.flat()`. Sizes are relative to
 * face height, so they hold at any scan resolution.
 */
export function slotsFor(parse: Parse, rows: { box: FaceBox }[][], page: { w: number; h: number }): Slot[] {
  const slots: Slot[] = [];
  rows.forEach((row, r) => {
    const nextTop = rows[r + 1] ? Math.min(...rows[r + 1].map((f) => f.box.y)) : Infinity;
    const prevBottom = rows[r - 1] ? Math.max(...rows[r - 1].map((f) => bottom(f.box))) : -Infinity;
    row.forEach((f, i) => {
      const b = f.box;
      if (parse.startsWith("below")) {
        // Column: halfway to each neighbour; rows run from the face down to the next row's faces.
        const prev = row[i - 1]?.box, next = row[i + 1]?.box;
        const half = prev || next ? Math.abs(cx(next ?? b) - cx(prev ?? b)) / (prev && next ? 4 : 2) : b.w * 1.5;
        const left = prev ? (cx(prev) + cx(b)) / 2 : cx(b) - half;
        const rightEdge = next ? (cx(b) + cx(next)) / 2 : cx(b) + half;
        slots.push({ main: clampRect({ x: left, y: bottom(b), w: rightEdge - left, h: Math.min(nextTop, bottom(b) + b.h * 2.5) - bottom(b) }, page) });
      } else if (parse === "row_list") {
        // The row's name list sits left of its first face; every face in the row shares it.
        const first = row[0].box;
        const rowTop = Math.min(...row.map((x) => x.box.y)), rowBottom = Math.max(...row.map((x) => bottom(x.box)));
        slots.push({ main: clampRect({ x: 0, y: rowTop - first.h * 0.5, w: first.x - first.w * 0.1, h: rowBottom - rowTop + first.h }, page) });
      } else {
        // Leads: the text block beside the face, split from its neighbours halfway between faces.
        const top = Number.isFinite(prevBottom) ? (prevBottom + Math.min(...row.map((x) => x.box.y))) / 2 : b.y - b.h * 0.5;
        const end = Number.isFinite(nextTop) ? (bottom(b) + nextTop) / 2 : bottom(b) + b.h * 0.6;
        const main = clampRect({ x: right(b), y: top, w: page.w - right(b), h: end - top }, page);
        const role = parse === "beside_name_in_bio"
          ? clampRect({ x: cx(b) - b.w * 1.2, y: bottom(b), w: b.w * 2, h: Math.min(nextTop, bottom(b) + b.h * 1.2) - bottom(b) }, page)
          : undefined;
        slots.push({ main, role });
      }
    });
  });
  return slots;
}

export const contains = (r: Rect, b: Rect) => cx(b) >= r.x && cx(b) <= r.x + r.w && cy(b) >= r.y && cy(b) <= r.y + r.h;

/**
 * The first text block in a slot: lines from the top while each starts within a
 * line height of the one above and is not much larger (a big page heading or
 * footer). The rest is left over.
 */
export function firstBlock(lines: TextLine[]): [TextLine[], TextLine[]] {
  const sorted = [...lines].sort((a, b) => a.box.y - b.box.y);
  let n = sorted.length ? 1 : 0;
  const fits = (prev: TextLine, line: TextLine) => line.box.y - bottom(prev.box) < prev.box.h && line.box.h < prev.box.h * 1.6;
  while (n < sorted.length && fits(sorted[n - 1], sorted[n])) n++;
  return [sorted.slice(0, n), sorted.slice(n)];
}

// ── OCR fragments → lines ────────────────────────────────────────────────────

/** OCR's 4-point quad as an axis-aligned box. */
export function quadToRect(quad: number[][]): Rect {
  const xs = quad.map((p) => p[0]), ys = quad.map((p) => p[1]);
  const x = Math.min(...xs), y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

/**
 * Join fragments that sit on the same printed line. Chaining from each line's
 * last fragment follows the slight curve of a photographed page.
 */
export function groupLines(fragments: OcrFragment[]): TextLine[] {
  const lines: OcrFragment[][] = [];
  for (const frag of [...fragments].sort((a, b) => a.box.x - b.box.x)) {
    let best: OcrFragment[] | null = null, bestDy = Infinity;
    for (const line of lines) {
      const last = line[line.length - 1];
      const dy = Math.abs(cy(last.box) - cy(frag.box));
      const gap = frag.box.x - right(last.box);
      if (dy < Math.min(last.box.h, frag.box.h) * 0.5 && gap > -last.box.h && gap < last.box.h * 1.5 && dy < bestDy) {
        best = line;
        bestDy = dy;
      }
    }
    if (best) best.push(frag);
    else lines.push([frag]);
  }
  return lines
    .map((parts): TextLine => {
      const x = Math.min(...parts.map((p) => p.box.x)), y = Math.min(...parts.map((p) => p.box.y));
      return {
        text: parts.map((p) => p.text.trim()).filter(Boolean).join(" "),
        score: Math.min(...parts.map((p) => p.score)),
        box: { x, y, w: Math.max(...parts.map((p) => right(p.box))) - x, h: Math.max(...parts.map((p) => bottom(p.box))) - y },
      };
    })
    .filter((l) => l.text)
    .sort((a, b) => cy(a.box) - cy(b.box));
}

// ── Lines → fields ───────────────────────────────────────────────────────────

export type ParsedSlot = { name: string; role: string; bio: string; lowConfidence: boolean };

const LOW_SCORE = 0.8;

/** "DANNY HOLDER" → "Danny Holder"; OCR's lower-case "lan" → "Ian". Mixed-case names stay as printed. */
export function cleanName(raw: string): string {
  let name = raw.replace(/\s+/g, " ").replace(/^[^\p{L}]+|[^\p{L}.)]+$/gu, "").trim();
  if (name && name === name.toUpperCase() && /\p{Lu}/u.test(name)) {
    name = name.toLowerCase().replace(/(^|[\s\-'’])(\p{L})/gu, (_, sep, c) => sep + c.toUpperCase())
      .replace(/\b(Mc|Mac)(\p{L})/gu, (_, p, c) => p + c.toUpperCase());
  }
  return name.replace(/(^|\s)l(?=\p{Ll})/gu, "$1I");
}

/** Bio lines into one paragraph, re-joining words hyphenated across a line break. */
const joinParagraph = (lines: TextLine[]) =>
  lines.map((l) => l.text).join("\n").replace(/-\n(?=\p{Ll})/gu, "").replace(/\s*\n\s*/g, " ").trim();

/** North Idaho bios open with the bold name: "Bren Altenbach was last seen as ...". */
const NAME_IN_BIO = /^((?:[\p{Lu}][\p{L}'’.-]*\s+){1,3}?[\p{Lu}][\p{L}'’.-]*)\s+(?:is|was|has|had|will|loves|plays|enjoys|started|returns|joins|first)\b/u;

export function parseSlot(parse: Parse, main: TextLine[], role: TextLine[] = []): ParsedSlot {
  const low = (ls: TextLine[]) => ls.some((l) => l.score < LOW_SCORE);
  switch (parse) {
    case "below_name": {
      const name = cleanName(main.map((l) => l.text).join(" "));
      return { name, role: "", bio: "", lowConfidence: !name || main.length > 2 || low(main) };
    }
    case "below_first_last": {
      const name = cleanName(main.map((l) => l.text).join(" "));
      return { name, role: "", bio: "", lowConfidence: main.length !== 2 || low(main) };
    }
    case "below_name_role": {
      const [first, ...rest] = main;
      const name = cleanName(first?.text ?? "");
      return { name, role: rest.map((l) => l.text).join(" ").trim(), bio: "", lowConfidence: !name || rest.length === 0 || low(main) };
    }
    case "beside_role_dash": {
      const [first, ...rest] = main;
      const m = first?.text.match(/^(.+?)\s*[-–—]\s+(.+)$/);
      return {
        name: cleanName(m ? m[2] : first?.text ?? ""),
        role: m ? m[1].trim() : "",
        bio: joinParagraph(rest),
        lowConfidence: !m || (first?.score ?? 0) < LOW_SCORE,
      };
    }
    case "beside_name_in_bio": {
      const bio = joinParagraph(main);
      const m = bio.match(NAME_IN_BIO);
      return { name: m ? cleanName(m[1]) : "", role: role.map((l) => l.text).join(" ").trim(), bio, lowConfidence: !m || role.length === 0 || (main[0]?.score ?? 0) < LOW_SCORE };
    }
    case "row_list":
      throw new Error("row_list is split per row with splitRowList");
  }
}

/** Yearbook advanced: a row's printed name list, split into one name per face. */
export function splitRowList(lines: TextLine[], faces: number): ParsedSlot[] {
  const names = lines.flatMap((l) => l.text.split(/\s*[,;•·]\s*/)).map(cleanName).filter(Boolean);
  const mismatch = names.length !== faces || low(lines);
  return Array.from({ length: faces }, (_, i) => ({ name: names[i] ?? "", role: "", bio: "", lowConfidence: mismatch || !names[i] }));
  function low(ls: TextLine[]) { return ls.some((l) => l.score < LOW_SCORE); }
}
