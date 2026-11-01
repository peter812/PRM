/**
 * Interest levels drive how often prm-stories re-checks an Instagram account.
 * See account-tracking-plan.md §1–2.
 */
export const INTEREST_LEVELS = ["none", "low", "medium", "high", "very_high", "extreme"] as const;
export type InterestLevel = (typeof INTEREST_LEVELS)[number];

export const INTEREST_LEVEL_LABEL: Record<InterestLevel, string> = {
  none: "None",
  low: "Low",
  medium: "Medium",
  high: "High",
  very_high: "Very high",
  extreme: "Extreme",
};

/** Tailwind background class per level; the badge and the level select use it. */
export const INTEREST_LEVEL_COLOR: Record<InterestLevel, string> = {
  none: "bg-slate-400",
  low: "bg-sky-500",
  medium: "bg-emerald-500",
  high: "bg-amber-500",
  very_high: "bg-orange-600",
  extreme: "bg-red-600",
};

/**
 * The things a tracking job can refresh. `scan` is the only kind the schedule
 * creates; the single sections and follows run when a person queues them
 * (account-scan-plan.md §1).
 */
export const TRACKING_KINDS = ["scan", "info", "posts", "tagged", "highlights", "follows"] as const;
export type TrackingKind = (typeof TRACKING_KINDS)[number];

/** A lite scan reads the profile; a full one posts too, and comments and highlights at a deep level. */
export type ScanMode = "lite" | "full";
export const SCAN_MODE: Record<InterestLevel, ScanMode | null> = {
  none: null,
  low: "lite",
  medium: "full",
  high: "full",
  very_high: "full",
  extreme: "full",
};
/** Levels whose scans and posts jobs read comments and highlights. */
export const DEEP_LEVELS: readonly string[] = ["high", "very_high", "extreme"];

/** What a level's scan reads, for the cadence tables. */
export function scanCapability(level: InterestLevel): string {
  if (!SCAN_MODE[level]) return "—";
  if (SCAN_MODE[level] === "lite") return "Lite (profile only)";
  return DEEP_LEVELS.includes(level) ? "Full + comments + highlights" : "Full (profile + posts)";
}

/** app_settings key holding a { level: days } JSON; seeded from the defaults below. */
export const TRACKING_LEVEL_DEFAULTS_KEY = "tracking_level_defaults";

/** The longest cadence a level or account may have, in days. */
export const MAX_CADENCE_DAYS = 365;

/** Days between scans per level. Null means "never" (level none). */
export const DEFAULT_SCAN_CADENCE: Record<InterestLevel, number | null> = {
  none: null,
  low: 30,
  medium: 7,
  high: 7,
  very_high: 7,
  extreme: 7,
};

/**
 * app_settings key: bulk queues (the Tracking page, the accounts list's
 * selection) and the morning tick leave out accounts whose same-kind check ran
 * in the last RECENT_CHECK_HOURS. "false" turns that off; absent means on. A
 * single account's "run now" never skips.
 */
export const TRACKING_SKIP_RECENT_KEY = "tracking_skip_recent";
export const RECENT_CHECK_HOURS = 24;
export const skipRecentEnabled = (raw: string | null | undefined): boolean => raw !== "false";

/**
 * app_settings key: accounts whose profile reports more than BIG_ACCOUNT_FOLLOWERS
 * followers are kept at level none (unless a person chose their level), so
 * tracking never scrapes celebrity-sized accounts. "false" turns that off;
 * absent means on.
 */
export const TRACKING_BIG_ACCOUNTS_NONE_KEY = "tracking_big_accounts_none";
export const BIG_ACCOUNT_FOLLOWERS = 3_000;
export const bigAccountsNoneEnabled = (raw: string | null | undefined): boolean => raw !== "false";

/**
 * app_settings keys, both off unless "true": a handle tagged on an imported post
 * or story becomes an account (so its face can be connected to it), and each
 * account made that way gets a profile info check queued.
 */
export const TRACKING_MENTIONS_CREATE_KEY = "tracking_mentions_create_accounts";
export const TRACKING_MENTIONS_QUEUE_INFO_KEY = "tracking_mentions_queue_info";

export const TRACKING_KIND_LABEL: Record<TrackingKind, string> = {
  scan: "Scan",
  info: "Profile info",
  follows: "Followers & following",
  posts: "Posts",
  tagged: "Tagged posts",
  highlights: "Highlights",
};

// ── Post import settings (app_settings; the Posts tab on /instagram) ──

export const POSTS_VIDEOS_KEY = "posts_download_videos";
export const POSTS_COMMENT_LIMIT_KEY = "posts_comment_limit";
export const POSTS_SCAN_LIMIT_KEY = "posts_scan_limit";
export const POSTS_COMMENT_LIMITS = [10, 20, 100] as const;

/** What a posts job scans and fetches; sent to prm-stories with each run. Comments are read for deep levels only (DEEP_LEVELS). */
export type PostSettings = { commentLimit: number; scanLimit: number; videos: boolean };
export const DEFAULT_POST_SETTINGS: PostSettings = { commentLimit: 10, scanLimit: 150, videos: true };

export function parsePostSettings(raw: Record<string, string | null | undefined>): PostSettings {
  const num = (v: string | null | undefined, fallback: number) => {
    const n = Number(v);
    return v != null && Number.isInteger(n) && n >= 1 ? n : fallback;
  };
  return {
    commentLimit: Math.min(num(raw[POSTS_COMMENT_LIMIT_KEY], DEFAULT_POST_SETTINGS.commentLimit), 100),
    scanLimit: num(raw[POSTS_SCAN_LIMIT_KEY], DEFAULT_POST_SETTINGS.scanLimit),
    videos: raw[POSTS_VIDEOS_KEY] !== "false",
  };
}

/**
 * Parse the stored defaults, falling back per level so a partial or corrupt
 * value never breaks scheduling. The old { level: { info, posts, ... } } shape
 * reads its info days as the scan days.
 */
export function parseScanCadences(raw: string | null | undefined): Record<InterestLevel, number | null> {
  let parsed: Record<string, unknown> = {};
  try {
    if (raw) parsed = JSON.parse(raw);
  } catch {}
  const out = { ...DEFAULT_SCAN_CADENCE };
  for (const level of INTEREST_LEVELS) {
    if (level === "none") continue;
    const v = parsed[level];
    out[level] = days(v && typeof v === "object" ? (v as { info?: unknown }).info : v, DEFAULT_SCAN_CADENCE[level]);
  }
  return out;
}

function days(v: unknown, fallback: number | null): number | null {
  return typeof v === "number" && Number.isFinite(v) && v >= 1 ? Math.min(Math.round(v), MAX_CADENCE_DAYS) : fallback;
}

/** The account's days between scans: its own override when set, else its level's default; null at level none. */
export function scanCadence(account: { interestLevel: string; scanEveryDays: number | null }, defaults: Record<InterestLevel, number | null>): number | null {
  const level = (INTEREST_LEVELS as readonly string[]).includes(account.interestLevel) ? (account.interestLevel as InterestLevel) : "none";
  return level === "none" ? null : Math.min(account.scanEveryDays ?? defaults[level]!, MAX_CADENCE_DAYS);
}

/** The follower-list scroll is capped at 10,000 per direction; above that a run is never authoritative. */
export const MAX_FOLLOWS = 10_000;

/**
 * Why a scheduled check of `kind` can't run for this account right now, or null.
 * The scheduler skips these and the account page explains them.
 */
export function trackingBlocker(
  account: { isPrivate: boolean | null; reportedFollowersCount: number | null; reportedFollowingCount: number | null },
  kind: TrackingKind,
): "private" | "too_many_follows" | null {
  if (kind === "info" || kind === "scan") return null;
  if (account.isPrivate) return "private";
  if (kind === "follows" && Math.max(account.reportedFollowersCount ?? 0, account.reportedFollowingCount ?? 0) > MAX_FOLLOWS) return "too_many_follows";
  return null;
}
