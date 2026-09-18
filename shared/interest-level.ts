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

/** The three things a scheduled check can refresh. */
export const TRACKING_KINDS = ["info", "follows", "posts"] as const;
export type TrackingKind = (typeof TRACKING_KINDS)[number];

/** Days between checks, per kind. Null means "never" (level none). */
export type Cadence = Record<TrackingKind, number | null>;

/** app_settings key holding a { level: Cadence } JSON; seeded from the defaults below. */
export const TRACKING_LEVEL_DEFAULTS_KEY = "tracking_level_defaults";

export const DEFAULT_LEVEL_CADENCES: Record<InterestLevel, Cadence> = {
  none: { info: null, follows: null, posts: null },
  low: { info: 30, follows: 30, posts: 60 },
  medium: { info: 7, follows: 30, posts: 30 },
  high: { info: 7, follows: 30, posts: 30 },
  very_high: { info: 7, follows: 30, posts: 30 },
  extreme: { info: 7, follows: 30, posts: 30 },
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

export const TRACKING_KIND_LABEL: Record<TrackingKind, string> = {
  info: "Profile info",
  follows: "Followers & following",
  posts: "Posts",
};

// ── Post import settings (app_settings; the Posts tab on /instagram) ──

export const POSTS_COMMENTS_KEY = "posts_import_comments";
export const POSTS_VIDEOS_KEY = "posts_download_videos";
export const POSTS_COMMENT_LIMIT_KEY = "posts_comment_limit";
export const POSTS_SCAN_LIMIT_KEY = "posts_scan_limit";
export const POSTS_COMMENT_LIMITS = [10, 20, 100] as const;

/** What a posts job scans and fetches; sent to prm-stories with each job. */
export type PostSettings = { comments: boolean; commentLimit: number; scanLimit: number; videos: boolean };
export const DEFAULT_POST_SETTINGS: PostSettings = { comments: false, commentLimit: 10, scanLimit: 100, videos: true };

export function parsePostSettings(raw: Record<string, string | null | undefined>): PostSettings {
  const num = (v: string | null | undefined, fallback: number) => {
    const n = Number(v);
    return v != null && Number.isInteger(n) && n >= 1 ? n : fallback;
  };
  return {
    comments: raw[POSTS_COMMENTS_KEY] === "true",
    commentLimit: Math.min(num(raw[POSTS_COMMENT_LIMIT_KEY], DEFAULT_POST_SETTINGS.commentLimit), 100),
    scanLimit: num(raw[POSTS_SCAN_LIMIT_KEY], DEFAULT_POST_SETTINGS.scanLimit),
    videos: raw[POSTS_VIDEOS_KEY] !== "false",
  };
}

/** Parse the stored defaults, falling back per level so a partial or corrupt value never breaks scheduling. */
export function parseLevelCadences(raw: string | null | undefined): Record<InterestLevel, Cadence> {
  let parsed: Partial<Record<InterestLevel, Partial<Cadence>>> = {};
  try {
    if (raw) parsed = JSON.parse(raw);
  } catch {}
  const out = {} as Record<InterestLevel, Cadence>;
  for (const level of INTEREST_LEVELS) {
    const c = parsed[level] ?? {};
    out[level] = {
      info: days(c.info, DEFAULT_LEVEL_CADENCES[level].info),
      follows: days(c.follows, DEFAULT_LEVEL_CADENCES[level].follows),
      posts: days(c.posts, DEFAULT_LEVEL_CADENCES[level].posts),
    };
  }
  return out;
}

function days(v: unknown, fallback: number | null): number | null {
  return typeof v === "number" && Number.isFinite(v) && v >= 1 ? Math.round(v) : fallback;
}

/** The account's effective cadence: its own override when set, else its level's default. */
export function resolveCadence(
  account: { interestLevel: string; infoEveryDays: number | null; followsEveryDays: number | null; postsEveryDays: number | null },
  defaults: Record<InterestLevel, Cadence>,
): Cadence {
  const level = (INTEREST_LEVELS as readonly string[]).includes(account.interestLevel) ? (account.interestLevel as InterestLevel) : "none";
  if (level === "none") return DEFAULT_LEVEL_CADENCES.none;
  const d = defaults[level];
  return {
    info: account.infoEveryDays ?? d.info,
    follows: account.followsEveryDays ?? d.follows,
    posts: account.postsEveryDays ?? d.posts,
  };
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
  if (kind === "info") return null;
  if (account.isPrivate) return "private";
  if (kind === "follows" && Math.max(account.reportedFollowersCount ?? 0, account.reportedFollowingCount ?? 0) > MAX_FOLLOWS) return "too_many_follows";
  return null;
}
