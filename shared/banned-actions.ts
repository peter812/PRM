// Per-account processing bans (social_accounts.banned_actions): automatic and
// bulk runs skip a banned account's content; manual runs still work.
export const BANNED_ACTION_LABELS = {
  facial_scan: "Face scan",
  ocr: "OCR",
  summary: "AI summaries",
  transcribe: "Video transcription",
} as const;

export type BannedAction = keyof typeof BANNED_ACTION_LABELS;

export const isBannedAction = (value: unknown): value is BannedAction =>
  typeof value === "string" && value in BANNED_ACTION_LABELS;
