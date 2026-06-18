// Tripartite fuzzy date model (GEDCOM X inspired). See family-tree-next-steps.md §2.F.
export type DatePrecision = "exact" | "year" | "month_year" | "range";
export interface ParsedFuzzyDate { dateString: string; dateSort: Date; datePrecision: DatePrecision; }

const MONTHS: Record<string, number> = { JAN:1,FEB:2,MAR:3,APR:4,MAY:5,JUN:6,JUL:7,AUG:8,SEP:9,OCT:10,NOV:11,DEC:12 };

export function parseFuzzyDate(raw: string): ParsedFuzzyDate {
  const s = (raw ?? "").trim();
  const u = s.toUpperCase();
  const mk = (y: number, m = 1, d = 1, p: DatePrecision = "exact"): ParsedFuzzyDate =>
    ({ dateString: s, dateSort: new Date(Date.UTC(y, m - 1, d)), datePrecision: p });
  let m: RegExpMatchArray | null;
  if ((m = u.match(/BET\s+(\d{4})\s+AND\s+(\d{4})/))) return mk(+m[1], 1, 1, "range");
  const mod = u.match(/^(ABT|EST|CAL|AFT|BEF)\s+(.*)$/);
  const t = mod ? mod[2] : u;
  if ((m = t.match(/^(\d{4})-(\d{2})-(\d{2})$/))) return mk(+m[1], +m[2], +m[3], mod ? "year" : "exact");
  if ((m = t.match(/^([A-Z]{3,9}|\d{1,2})[\s/-](\d{4})$/))) {
    const mo = isNaN(+m[1]) ? (MONTHS[m[1].slice(0, 3)] ?? 1) : +m[1];
    return mk(+m[2], mo, 1, "month_year");
  }
  if ((m = t.match(/^(\d{4})$/))) return mk(+m[1], 1, 1, "year");
  return { dateString: s, dateSort: new Date(), datePrecision: "exact" };
}
