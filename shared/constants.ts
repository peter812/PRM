export const INSTAGRAM_TYPE_ID = "00000000-0000-0000-0001-000000000001";

/** Colors a new highlight set is given, in order; the user can pick any other. */
export const HIGHLIGHT_PALETTE = [
  "#e11d48",
  "#2563eb",
  "#16a34a",
  "#d97706",
  "#9333ea",
  "#0891b2",
  "#db2777",
  "#65a30d",
  "#ea580c",
  "#4f46e5",
];

export const nextHighlightColor = (used: string[]): string =>
  HIGHLIGHT_PALETTE.find((c) => !used.includes(c)) ??
  HIGHLIGHT_PALETTE[used.length % HIGHLIGHT_PALETTE.length];
