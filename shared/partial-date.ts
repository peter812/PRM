/**
 * Partial dates for address history (address-history-plan.md §4): "YYYY",
 * "YYYY-MM" or "YYYY-MM-DD". As strings they sort chronologically, so plain
 * string comparison orders them.
 */
import { z } from "zod";

/** End date of a past address whose real end is unknown (old TPS records). */
export const UNKNOWN_END = "0000";

export const partialDate = z
  .string()
  .regex(/^(\d{4})(-(0[1-9]|1[0-2])(-(0[1-9]|[12]\d|3[01]))?)?$/, "Use YYYY, YYYY-MM or YYYY-MM-DD");

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2017" → "2017", "2017-07" → "Jul 2017", "2017-07-14" → "Jul 14, 2017". */
export function formatPartialDate(date: string): string {
  const [y, m, d] = date.split("-");
  if (!m) return y;
  return d ? `${MONTHS[Number(m) - 1]} ${Number(d)}, ${y}` : `${MONTHS[Number(m) - 1]} ${y}`;
}

/** "Jul 2017 – present", "Jan 2015 – Jun 2018", "ended (date unknown)", or "" when nothing is known. */
export function formatDateRange(start: string | null | undefined, end: string | null | undefined): string {
  if (end === UNKNOWN_END) return start ? `${formatPartialDate(start)} – ?` : "ended (date unknown)";
  if (!start && !end) return "";
  return `${start ? formatPartialDate(start) : "?"} – ${end ? formatPartialDate(end) : "present"}`;
}

/**
 * TPS shows a range like "(Jul 2017 - Jul 2026)" in an address's details text.
 * Returns each side as YYYY-MM (or YYYY when TPS gives only a year); null when absent.
 */
export function parseTpsRange(text: string | null | undefined): { start: string | null; end: string | null } {
  const side = (s: string | undefined) => {
    const match = s?.trim().match(/^(?:([A-Za-z]{3})[a-z]*\s+)?(\d{4})$/);
    if (!match) return null;
    const month = match[1] ? MONTHS.indexOf(match[1][0].toUpperCase() + match[1].slice(1, 3).toLowerCase()) + 1 : 0;
    return month ? `${match[2]}-${String(month).padStart(2, "0")}` : match[2];
  };
  const range = text?.match(/\(([^()]*?)\s+-\s+([^()]*?)\)/);
  return { start: side(range?.[1]), end: side(range?.[2]) };
}
