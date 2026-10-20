// Interest level → cadence → due dates (account-tracking-plan.md §1–2,
// account-scan-plan.md §2).
//
// `scan_due_at` on social_accounts is the scheduler's only per-account state. A
// fresh due date is spread uniformly across the cadence window, and every
// reschedule after a check adds ±10 % jitter, so accounts that were graded
// together never keep coming due together.
import crypto from "crypto";
import { and, desc, eq, inArray, isNull, or, sql, type SQL } from "drizzle-orm";
import { db } from "./db";
import { sseManager } from "./middleware/sse";
import { resolveScrapedAccounts } from "./task-worker";
import { postedBy } from "./storage";
import { appSettings, instagramHighlights, socialAccountPosts, socialAccounts, trackingJobs, type SocialAccount, type TrackingJob } from "@shared/schema";
import {
  DEEP_LEVELS,
  INTEREST_LEVELS,
  SCAN_MODE,
  POSTS_COMMENT_LIMIT_KEY,
  POSTS_SCAN_LIMIT_KEY,
  POSTS_VIDEOS_KEY,
  RECENT_CHECK_HOURS,
  TRACKING_LEVEL_DEFAULTS_KEY,
  TRACKING_SKIP_RECENT_KEY,
  TRACKING_BIG_ACCOUNTS_NONE_KEY,
  TRACKING_MENTIONS_CREATE_KEY,
  TRACKING_MENTIONS_QUEUE_INFO_KEY,
  BIG_ACCOUNT_FOLLOWERS,
  bigAccountsNoneEnabled,
  parsePostSettings,
  parseScanCadences,
  scanCadence,
  skipRecentEnabled,
  type InterestLevel,
  type PostSettings,
  type ScanMode,
  type TrackingKind,
} from "@shared/interest-level";

export const INSTAGRAM_TYPE_ID = "00000000-0000-0000-0001-000000000001";

const DAY_MS = 86_400_000;

export async function levelCadences(): Promise<Record<InterestLevel, number | null>> {
  const [row] = await db.select().from(appSettings).where(eq(appSettings.key, TRACKING_LEVEL_DEFAULTS_KEY));
  return parseScanCadences(row?.value);
}

/** The Posts tab's settings, sent to prm-stories with every tracking run. Whether a job reads comments is its level's call (`comments` on the job). */
export async function postSettings(): Promise<PostSettings> {
  const keys = [POSTS_COMMENT_LIMIT_KEY, POSTS_SCAN_LIMIT_KEY, POSTS_VIDEOS_KEY];
  const rows = await db.select().from(appSettings).where(inArray(appSettings.key, keys));
  return parsePostSettings(Object.fromEntries(rows.map((r) => [r.key, r.value])));
}

/** Whether bulk queues and the morning tick skip accounts checked in the last RECENT_CHECK_HOURS (Settings → Tracking). */
export async function skipRecentlyChecked(): Promise<boolean> {
  const [row] = await db.select().from(appSettings).where(eq(appSettings.key, TRACKING_SKIP_RECENT_KEY));
  return skipRecentEnabled(row?.value);
}

/** Whether accounts above BIG_ACCOUNT_FOLLOWERS are held at level none (Settings → Tracking). */
async function bigAccountsNone(): Promise<boolean> {
  const [row] = await db.select().from(appSettings).where(eq(appSettings.key, TRACKING_BIG_ACCOUNTS_NONE_KEY));
  return bigAccountsNoneEnabled(row?.value);
}

const isBigAccount = sql`COALESCE(${socialAccounts.reportedFollowersCount}, 0) > ${BIG_ACCOUNT_FOLLOWERS}`;

/**
 * With the setting on, drop accounts reporting more than BIG_ACCOUNT_FOLLOWERS
 * followers to level none, clearing their due dates. Never touches a level a
 * person chose. With `ids` it looks at those accounts only (applySnapshot);
 * without, at every account (boot, and turning the setting on).
 */
export async function applyBigAccountRule(ids?: string[]): Promise<void> {
  if (ids && ids.length === 0) return;
  if (!(await bigAccountsNone())) return;
  const conditions: SQL[] = [
    sql`${socialAccounts.interestLevel} <> 'none'`,
    eq(socialAccounts.interestLevelManual, false),
    isBigAccount,
  ];
  if (ids) conditions.push(inArray(socialAccounts.id, ids));
  await db
    .update(socialAccounts)
    .set({ interestLevel: "none", scanEveryDays: null, scanDueAt: null })
    .where(and(...conditions));
}

/** SQL: `checkedAt` (a timestamp expression) is within the last RECENT_CHECK_HOURS; false, not null, when never checked, so `NOT` works. */
const recentlyChecked = (checkedAt: SQL, at: SQL = sql`now()`) => sql`COALESCE(${checkedAt} >= ${at} - ${RECENT_CHECK_HOURS} * interval '1 hour', false)`;

/**
 * Somewhere in the next `days` days (at least tomorrow); null when the kind is off.
 * Evaluated per row in SQL, so one statement spreads any number of accounts.
 */
function spreadDue(days: number | null): SQL | null {
  return days == null ? null : sql`now() + (1 + random() * ${Math.max(days - 1, 0)}) * interval '1 day'`;
}

/** After a check: the cadence with ±10 % jitter. */
function jitteredDue(days: number | null): Date | null {
  return days == null ? null : new Date(Date.now() + days * (0.9 + Math.random() * 0.2) * DAY_MS);
}

/** The sections a job can read; each stamps its own `*_checked_at`. */
export type Section = Exclude<TrackingKind, "scan">;
const CHECKED_COLUMN = { info: "infoCheckedAt", follows: "followsCheckedAt", posts: "postsCheckedAt", highlights: "highlightsCheckedAt" } as const;

export type TrackingPatch = Partial<Pick<SocialAccount, "interestLevel" | "scanEveryDays">>;

/**
 * Change an account's level and/or scan cadence override. A level change
 * clears the override (the UI says so); either change re-spreads the due date.
 */
export async function updateTracking(account: SocialAccount, patch: TrackingPatch): Promise<void> {
  const set: Record<string, unknown> = {};
  const levelChanged = patch.interestLevel !== undefined && patch.interestLevel !== account.interestLevel;
  if (patch.interestLevel !== undefined) {
    if (!(INTEREST_LEVELS as readonly string[]).includes(patch.interestLevel)) throw new Error("Unknown interest level");
    set.interestLevel = patch.interestLevel;
    set.interestLevelManual = true;
  }
  if (levelChanged) set.scanEveryDays = null;
  else if (patch.scanEveryDays !== undefined && patch.scanEveryDays !== account.scanEveryDays) set.scanEveryDays = patch.scanEveryDays;
  if (levelChanged || "scanEveryDays" in set) {
    set.scanDueAt = spreadDue(scanCadence({ ...account, ...(set as Partial<SocialAccount>) }, await levelCadences()));
  }
  if (Object.keys(set).length) await db.update(socialAccounts).set(set).where(eq(socialAccounts.id, account.id));
}

/** A section just ran, by a scan or a job of its own: stamp it. Only a scan moves the due date (`markScanned`). */
export async function markChecked(accountId: string, section: Section): Promise<void> {
  await db.update(socialAccounts).set({ [CHECKED_COLUMN[section]]: new Date() }).where(eq(socialAccounts.id, accountId));
}

/** A scan just finished: stamp it and roll the due date forward. */
export async function markScanned(accountId: string): Promise<void> {
  const [account] = await db.select().from(socialAccounts).where(eq(socialAccounts.id, accountId));
  if (!account) return;
  await db
    .update(socialAccounts)
    .set({ scanCheckedAt: new Date(), scanDueAt: jitteredDue(scanCadence(account, await levelCadences())) })
    .where(eq(socialAccounts.id, accountId));
}

/**
 * While nothing is auto-tracking, a lapsed due date is moved forward by whole
 * cadences to the next one still ahead, so the account page always shows a
 * real next date and turning tracking back on doesn't bring every account due
 * at once. Whole steps keep each account's place in the spread.
 */
export async function rollForwardDueDates(): Promise<void> {
  const defaults = await levelCadences();
  const levelDays = sql.join(
    INTEREST_LEVELS.map((l) => sql`WHEN ${l} THEN ${defaults[l]}::int`),
    sql` `,
  );
  const days = sql`COALESCE(scan_every_days, CASE interest_level ${levelDays} END)`;
  await db.execute(sql`
    UPDATE social_accounts
    SET scan_due_at = scan_due_at + (floor(extract(epoch FROM now() - scan_due_at) / (${days} * 86400)) + 1) * ${days} * interval '1 day'
    WHERE scan_due_at <= now() AND ${days} >= 1
  `);
}

/** Accounts with a me person as owner — the ones whose network the "me" rule grades. */
const ME_ACCOUNTS = sql`SELECT sa.id FROM social_accounts sa JOIN app_settings s ON s.key = 'me_person_id' AND s.value = sa.owner_uuid`;

/**
 * The "me" rule: any Instagram account on either side of a follow edge with a me
 * account starts at medium. Only ever raises from none, and never touches a level
 * a person chose, nor raises an account the big-account rule holds at none. With
 * `candidateIds` it looks at those accounts only (the hook in applySnapshot);
 * without, at every edge (boot).
 */
export async function applyMeRule(candidateIds?: string[]): Promise<void> {
  if (candidateIds && candidateIds.length === 0) return;
  const medium = (await levelCadences()).medium;
  const conditions: SQL[] = [
    ...((await bigAccountsNone()) ? [sql`NOT (${isBigAccount})`] : []),
    eq(socialAccounts.interestLevel, "none"),
    eq(socialAccounts.interestLevelManual, false),
    eq(socialAccounts.typeId, INSTAGRAM_TYPE_ID),
    sql`${socialAccounts.id} IN (
      SELECT f.followed_id FROM social_follows f WHERE f.follower_id IN (${ME_ACCOUNTS})
      UNION
      SELECT f.follower_id FROM social_follows f WHERE f.followed_id IN (${ME_ACCOUNTS})
    )`,
  ];
  if (candidateIds) conditions.push(inArray(socialAccounts.id, candidateIds));
  await db
    .update(socialAccounts)
    .set({ interestLevel: "medium", scanDueAt: spreadDue(medium) })
    .where(and(...conditions));
}

// ── The job queue (account-tracking-plan.md §2.2–2.4) ──

type JobBase = {
  id: string;
  username: string;
  /** The date joined never changes, so the About dialog opens only until the account has one. */
  needJoinedAt: boolean;
};

/** A scan job (account-scan-plan.md §2, §3.1). A lite scan reads info only; a full one adds posts, and highlights at a deep level. */
export type ScanJob = JobBase & {
  kind: "scan";
  /** Full scans: walk the whole grid when PRM has never had this account's posts, else read the recent ones. */
  posts?: "recent" | "full";
  /** Full scans at a deep level. */
  comments?: boolean;
  /** Full scans at a deep level, unless the account's stories are skipped. */
  highlights?: boolean;
  /** What PRM already holds, so the service dedupes without asking mid-scan. */
  known: KnownContent;
};

/** A single-section job someone asked for (Refresh / Run now). */
export type SectionJob = JobBase & {
  kind: Exclude<TrackingKind, "scan">;
  /** Posts jobs at a deep level. */
  comments?: boolean;
};

/** What the service needs to run one job. */
export type ClaimedJob = ScanJob | SectionJob;

export type KnownContent = {
  /** Live, non-story posts the account is on, newest first. */
  posts: { pk: string; postedAt: string | null; pinned: boolean }[];
  storyPks: string[];
  /** Highlight sets PRM holds live. */
  highlightIds: string[];
};

type ClaimedRow = {
  id: string;
  kind: TrackingKind;
  scan_mode: ScanMode | null;
  account_id: string;
  username: string;
  interest_level: string;
  joined_at: Date | null;
  posts_checked_at: Date | null;
  skip_stories: boolean;
};

/** The claimed jobs `ids`, with what their accounts say the service should do. */
async function toClaimed(ids: string[]): Promise<ClaimedJob[]> {
  if (!ids.length) return [];
  const { rows } = await db.execute<ClaimedRow>(sql`
    SELECT j.id, j.kind, j.scan_mode, sa.id AS account_id, sa.username, sa.interest_level, sa.joined_at, sa.posts_checked_at, sa.skip_stories
    FROM tracking_jobs j JOIN social_accounts sa ON sa.id = j.social_account_id
    WHERE ${inArray(sql`j.id`, ids)}
  `);
  const byId = new Map(rows.map((r) => [r.id, r]));
  const jobs = ids.map((id) => claimedJob(byId.get(id)!));
  const scans = jobs.filter((j): j is ScanJob => j.kind === "scan");
  const accountOf = (j: ClaimedJob) => byId.get(j.id)!.account_id;
  const known = await knownContent(
    scans.filter((j) => j.posts).map(accountOf),
    scans.filter((j) => j.highlights).map(accountOf),
  );
  for (const j of scans) j.known = known(accountOf(j));
  return jobs;
}

function claimedJob(r: ClaimedRow): ClaimedJob {
  const deep = DEEP_LEVELS.includes(r.interest_level);
  const base = { id: r.id, username: r.username, needJoinedAt: (r.kind === "info" || r.kind === "scan") && r.joined_at == null };
  if (r.kind !== "scan") return { ...base, kind: r.kind, ...(r.kind === "posts" && { comments: deep }) };
  const job: ScanJob = { ...base, kind: "scan", known: { posts: [], storyPks: [], highlightIds: [] } };
  if (r.scan_mode === "full") {
    job.posts = r.posts_checked_at == null ? "full" : "recent";
    job.comments = deep;
    job.highlights = deep && !r.skip_stories;
  }
  return job;
}

/**
 * What PRM holds for the accounts whose scans read posts (`postAccounts`) and
 * highlights (`highlightAccounts`): three queries for the whole claim, then a
 * lookup per account.
 */
async function knownContent(postAccounts: string[], highlightAccounts: string[]): Promise<(accountId: string) => KnownContent> {
  const posts = new Map<string, KnownContent["posts"]>();
  const storyPks = new Map<string, string[]>();
  const highlightIds = new Map<string, string[]>();
  const push = <T,>(m: Map<string, T[]>, k: string, v: T) => (m.get(k) ?? m.set(k, []).get(k)!).push(v);
  if (postAccounts.length) {
    const wanted = new Set(postAccounts);
    const rows = await db
      .select({
        accountId: socialAccountPosts.socialAccountId,
        coauthors: socialAccountPosts.coauthorAccountIds,
        pk: socialAccountPosts.instagramPk,
        postedAt: socialAccountPosts.postedAt,
        pinned: sql<boolean>`COALESCE((${socialAccountPosts.metadata}->>'isPinned')::boolean, false)`,
      })
      .from(socialAccountPosts)
      .where(and(
        or(...postAccounts.map(postedBy)),
        sql`${socialAccountPosts.postType} <> 'story'`,
        eq(socialAccountPosts.isDeleted, false),
        sql`${socialAccountPosts.instagramPk} IS NOT NULL`,
      ))
      .orderBy(sql`${socialAccountPosts.postedAt} DESC NULLS LAST`);
    for (const r of rows) {
      const post = { pk: r.pk!, postedAt: r.postedAt?.toISOString() ?? null, pinned: r.pinned };
      // A post is on its poster's grid and on each coauthor's.
      const on = new Set([r.accountId, ...((r.coauthors as string[] | null) ?? [])].filter((id) => wanted.has(id)));
      for (const id of on) push(posts, id, post);
    }
  }
  if (highlightAccounts.length) {
    const stories = await db
      .select({ accountId: socialAccountPosts.socialAccountId, pk: socialAccountPosts.instagramPk })
      .from(socialAccountPosts)
      .where(and(inArray(socialAccountPosts.socialAccountId, highlightAccounts), eq(socialAccountPosts.postType, "story"), sql`${socialAccountPosts.instagramPk} IS NOT NULL`));
    for (const r of stories) push(storyPks, r.accountId, r.pk!);
    const sets = await db
      .select({ accountId: instagramHighlights.socialAccountId, id: instagramHighlights.instagramId })
      .from(instagramHighlights)
      .where(and(inArray(instagramHighlights.socialAccountId, highlightAccounts), sql`${instagramHighlights.deletedSeenAt} IS NULL`));
    for (const r of sets) push(highlightIds, r.accountId, r.id);
  }
  return (id) => ({ posts: posts.get(id) ?? [], storyPks: storyPks.get(id) ?? [], highlightIds: highlightIds.get(id) ?? [] });
}

/** SQL: the scan mode an account's level gets. */
const scanModeFor = (level: SQL) =>
  sql`CASE ${level} ${sql.join(INTEREST_LEVELS.map((l) => sql`WHEN ${l} THEN ${SCAN_MODE[l]}::text`), sql` `)} END`;

/**
 * FROM/WHERE over `sa`: one row per account the schedule would scan at `at`.
 * Shared by the claim and the Tracking page's preview so the two can't drift.
 *
 * A scan always runs, even on a private account: its info section does, and
 * the service skips the rest. Followers & following are never scheduled, only
 * queued by hand. An account scanned in the last RECENT_CHECK_HOURS (by hand,
 * say) stays due but waits. An account with any job open waits for it. An
 * account whose profile 404'd (an open not_found issue) waits for a person to
 * rename, dismiss or delete it; only manual jobs reach it meanwhile.
 */
function dueAt(at: SQL, skipRecent: boolean): SQL {
  const notRecent = skipRecent ? sql`AND NOT (${recentlyChecked(sql`sa.scan_checked_at`, at)})` : sql``;
  return sql`
    FROM social_accounts sa
    WHERE sa.type_id = ${INSTAGRAM_TYPE_ID}
      AND sa.scan_due_at <= ${at}
      ${notRecent}
      AND NOT EXISTS (SELECT 1 FROM tracking_jobs j WHERE j.social_account_id = sa.id AND j.status IN ('queued', 'running'))
      AND NOT EXISTS (SELECT 1 FROM social_account_issues i WHERE i.social_account_id = sa.id AND i.kind = 'not_found' AND i.status = 'open')`;
}

/**
 * Claim up to `limit` jobs for `importerId`, reserved on the spot (importer
 * set) so two importers (or the morning tick and a manual kick) can never take
 * the same one: queued manual jobs first (oldest first), then one scan per
 * due account, most overdue first. They stay queued, and so
 * removable, until the service starts each one (POST .../jobs/:id/start). The
 * caller stamps the run id once it has one, or hands the jobs back with
 * `releaseTrackingJobs`.
 */
export async function claimTrackingJobs(importerId: string, limit: number, opts: { manualOnly?: boolean } = {}): Promise<ClaimedJob[]> {
  const skipRecent = opts.manualOnly ? false : await skipRecentlyChecked();
  const claimed = await db.transaction(async (tx) => {
    const manual = await tx.execute<{ id: string; created_at: Date }>(sql`
      UPDATE tracking_jobs j
      SET importer_id = ${importerId}, attempts = j.attempts + 1
      WHERE j.id IN (
          SELECT id FROM tracking_jobs
          WHERE status = 'queued' AND origin = 'manual' AND importer_id IS NULL
          ORDER BY created_at
          LIMIT ${limit}
          FOR UPDATE SKIP LOCKED
        )
      RETURNING j.id, j.created_at
    `);
    const manualIds = manual.rows.sort((a, b) => +new Date(a.created_at) - +new Date(b.created_at)).map((r) => r.id);
    const remaining = limit - manualIds.length;
    if (opts.manualOnly || remaining <= 0) return manualIds;

    const due = await tx.execute<{ id: string }>(sql`
      INSERT INTO tracking_jobs (social_account_id, kind, scan_mode, origin, status, importer_id, attempts)
      SELECT d.id, 'scan', d.scan_mode, 'schedule', 'queued', ${importerId}, 1
      FROM (
        SELECT sa.id, ${scanModeFor(sql`sa.interest_level`)} AS scan_mode
        ${dueAt(sql`now()`, skipRecent)}
        ORDER BY sa.scan_due_at ASC
        LIMIT ${remaining}
        FOR UPDATE OF sa SKIP LOCKED
      ) d
      RETURNING id
    `);
    return [...manualIds, ...due.rows.map((r) => r.id)];
  }).then(toClaimed);
  if (claimed.length > 0) {
    sseManager.broadcast("tracking_job.updated", { action: "claimed", count: claimed.length });
  }
  return claimed;
}

export type UpcomingCheck = {
  accountId: string;
  username: string;
  nickname: string | null;
  interestLevel: string;
  kind: TrackingKind;
  /** Scans: lite or full. */
  scanMode: ScanMode | null;
  origin: "manual" | "schedule";
  /** Schedule rows: the due date. Manual rows: when it was queued. */
  at: Date;
};

/**
 * What `claimTrackingJobs` would take right now with this `limit`, without
 * claiming: queued manual jobs, then due schedule rows. Evaluated at now(),
 * like the claim, so the list never shows more than a run started now takes.
 */
export async function upcomingChecks(limit: number): Promise<UpcomingCheck[]> {
  const skipRecent = await skipRecentlyChecked();
  const rows = await db.execute<{ id: string; username: string; nickname: string | null; interest_level: string; kind: TrackingKind; scan_mode: ScanMode | null; origin: "manual" | "schedule"; at: Date }>(sql`
    WITH manual AS (
      SELECT j.social_account_id AS id, j.kind, j.scan_mode, 'manual' AS origin, j.created_at AS at, 0 AS rank
      FROM tracking_jobs j
      WHERE j.status = 'queued' AND j.origin = 'manual' AND j.importer_id IS NULL
      ORDER BY j.created_at
      LIMIT ${limit}
    ), scheduled AS (
      SELECT sa.id, 'scan' AS kind, ${scanModeFor(sql`sa.interest_level`)} AS scan_mode, 'schedule' AS origin, sa.scan_due_at AS at, 1 AS rank
      ${dueAt(sql`now()`, skipRecent)}
      ORDER BY sa.scan_due_at ASC
      LIMIT greatest(${limit} - (SELECT count(*) FROM manual), 0)
    )
    SELECT u.id, social_accounts.username, social_accounts.nickname, social_accounts.interest_level, u.kind, u.scan_mode, u.origin, u.at
    FROM (SELECT * FROM manual UNION ALL SELECT * FROM scheduled) u
    JOIN social_accounts ON social_accounts.id = u.id
    ORDER BY u.rank, u.at
  `);
  return rows.rows.map((r) => ({
    accountId: r.id,
    username: r.username,
    nickname: r.nickname,
    interestLevel: r.interest_level,
    kind: r.kind,
    scanMode: r.scan_mode,
    origin: r.origin,
    at: r.at,
  }));
}

/** A job a run has not reported on yet: waiting its turn or being worked. */
const OPEN = ["queued", "running"];

/**
 * The service declined the run: schedule jobs are re-derived tomorrow, manual
 * ones wait for the next chance. The service never saw them, so the hand
 * doesn't count as an attempt.
 */
export async function releaseTrackingJobs(jobs: ClaimedJob[]): Promise<void> {
  if (jobs.length === 0) return;
  const ids = jobs.map((j) => j.id);
  await db.delete(trackingJobs).where(and(inArray(trackingJobs.id, ids), eq(trackingJobs.origin, "schedule"), inArray(trackingJobs.status, OPEN)));
  await db
    .update(trackingJobs)
    .set({ status: "queued", importerId: null, runId: null, startedAt: null, attempts: sql`greatest(${trackingJobs.attempts} - 1, 0)` })
    .where(and(inArray(trackingJobs.id, ids), inArray(trackingJobs.status, OPEN)));
  sseManager.broadcast("tracking_job.updated", { action: "released", count: jobs.length });
}

/**
 * The service is about to work this job (or the next few, so a hand-off is
 * never mid-air): queued → running. Null when it isn't queued in that run any
 * more — removed from the Social Tasks list, say — so the service skips it.
 * A null `runId` (a signed-in admin poking the API) matches any run.
 */
export async function startTrackingJob(jobId: string, runId: string | null): Promise<TrackingJob | null> {
  const [job] = await db
    .update(trackingJobs)
    .set({ status: "running", startedAt: new Date() })
    .where(and(eq(trackingJobs.id, jobId), runId ? eq(trackingJobs.runId, runId) : undefined, eq(trackingJobs.status, "queued")))
    .returning();
  if (job) {
    sseManager.broadcast("tracking_job.updated", { id: job.id, status: "running", action: "started" });
  }
  return job ?? null;
}

/**
 * A manual job the service never got to (out of budget, a tripwire ended the
 * run, the run crashed) goes back in the queue rather than counting as done —
 * up to MAX_JOB_ATTEMPTS hands, so a job that breaks every run it joins can't
 * take a slot forever. Schedule jobs need nothing: their account stays due.
 */
export const MAX_JOB_ATTEMPTS = 3;
/** Reasons a skipped job was actually decided: the account itself can't be checked. */
const DECIDED_SKIPS = new Set(["private", "not_found"]);

export const isDeferral = (status: string, reason: string | null) => status === "skipped" && !DECIDED_SKIPS.has(reason ?? "");

/** Whether a job the run didn't reach should be queued again. */
export const canRetry = (job: Pick<TrackingJob, "origin" | "attempts">) => job.origin === "manual" && job.attempts < MAX_JOB_ATTEMPTS;

const REQUEUE = { status: "queued", importerId: null, runId: null, startedAt: null, result: null, error: null } as const;

/** Hand a job that its run never finished back to the queue. */
export async function requeueJob(jobId: string): Promise<void> {
  await db.update(trackingJobs).set(REQUEUE).where(eq(trackingJobs.id, jobId));
  sseManager.broadcast("tracking_job.updated", { id: jobId, status: "queued", action: "requeued" });
}

/**
 * Safety net when a run ends: whatever the service never reported (started or
 * still waiting its turn) is not left open forever — manual jobs with attempts
 * to spare are queued again, the rest are failed.
 */
export async function failUnfinishedJobs(runId: string, runStatus: string): Promise<void> {
  // A scan whose bundle PRM holds is the ingest's to finish, not the run's.
  const unfinished = and(eq(trackingJobs.runId, runId), inArray(trackingJobs.status, OPEN), isNull(trackingJobs.scanReceivedAt));
  await db
    .update(trackingJobs)
    .set(REQUEUE)
    .where(and(unfinished, eq(trackingJobs.origin, "manual"), sql`${trackingJobs.attempts} < ${MAX_JOB_ATTEMPTS}`));
  await db
    .update(trackingJobs)
    .set({ status: "failed", error: `run ended: ${runStatus}`, finishedAt: new Date() })
    .where(unfinished);
  sseManager.broadcast("tracking_job.updated", { runId, action: "run_ended" });
}

/** A scan queued by hand reads everything the account's level allows. */
const manualScanMode = (kind: TrackingKind): ScanMode | null => (kind === "scan" ? "full" : null);

export async function queueManualJob(accountId: string, kind: TrackingKind): Promise<TrackingJob> {
  const [job] = await db
    .insert(trackingJobs)
    .values({ socialAccountId: accountId, kind, scanMode: manualScanMode(kind), origin: "manual" })
    .returning();
  sseManager.broadcast("tracking_job.updated", { id: job.id, status: job.status, action: "queued" });
  return job;
}

/**
 * With the setting on, turn handles tagged on an imported post or story into
 * Instagram accounts, so Face Review can offer them for the faces on that
 * slide. With the second setting on too, the accounts this call created get a
 * profile info check queued; the caller kicks the queue when a batch comes back.
 */
export async function resolveMentionedAccounts(handles: string[]): Promise<QueuedBatch | null> {
  const wanted = [...new Set(handles.map((h) => h.trim().replace(/^@/, "").toLowerCase()).filter(Boolean))];
  if (!wanted.length) return null;
  const rows = await db.select().from(appSettings).where(inArray(appSettings.key, [TRACKING_MENTIONS_CREATE_KEY, TRACKING_MENTIONS_QUEUE_INFO_KEY]));
  const on = (key: string) => rows.some((r) => r.key === key && r.value === "true");
  if (!on(TRACKING_MENTIONS_CREATE_KEY)) return null;

  const known = new Set(
    (await db.select({ username: socialAccounts.username }).from(socialAccounts).where(inArray(socialAccounts.username, wanted))).map((a) => a.username),
  );
  const resolved = await resolveScrapedAccounts(wanted.map((username) => ({ username })), INSTAGRAM_TYPE_ID, "post mention");
  if (!on(TRACKING_MENTIONS_QUEUE_INFO_KEY)) return null;
  const created = wanted.filter((h) => !known.has(h)).map((h) => resolved.get(h)).filter((id): id is string => Boolean(id));
  return created.length ? queueAccountsRefresh("info", created) : null;
}

// ── Batches: the Tracking page (account-tracking-plan.md §2.4) ──

/** The Instagram accounts Me's accounts follow — ones with a username, the only ones a job can open. */
const FOLLOWED_BY_ME = sql`
  SELECT DISTINCT f.followed_id AS id, sa.scan_checked_at, sa.info_checked_at, sa.follows_checked_at, sa.posts_checked_at, sa.highlights_checked_at
  FROM social_follows f
  JOIN social_accounts sa ON sa.id = f.followed_id
  WHERE f.follower_id IN (${ME_ACCOUNTS})
    AND sa.type_id = ${INSTAGRAM_TYPE_ID} AND sa.username IS NOT NULL AND sa.username <> ''`;

export type BatchSummary = {
  id: string;
  kind: TrackingKind;
  createdAt: Date;
  total: number;
  queued: number;
  running: number;
  completed: number;
  failed: number;
  skipped: number;
};

/** An account of `d` (an alias over `source`) already has a `kind` check queued or running. */
const hasOpenJob = (kind: TrackingKind) => sql`EXISTS (
  SELECT 1 FROM tracking_jobs j
  WHERE j.social_account_id = d.id AND j.kind = ${kind} AND j.status IN ('queued', 'running')
)`;

const CHECKED_SQL_COLUMN = { scan: sql`d.scan_checked_at`, info: sql`d.info_checked_at`, follows: sql`d.follows_checked_at`, posts: sql`d.posts_checked_at`, highlights: sql`d.highlights_checked_at` } as const;

export type QueuedBatch = { batch: BatchSummary | null; skippedRecent: number };

/**
 * Queue one manual `kind` job for every account `source` (a subquery yielding
 * `id` and the `*_checked_at` columns) selects, in one statement. Accounts
 * that already have that check queued or running are left alone, so a second
 * click never doubles the queue; with the setting on, so are accounts whose
 * `kind` check ran in the last RECENT_CHECK_HOURS — those are counted back as
 * `skippedRecent`. `batch` is null when nothing was queued.
 */
async function queueBatch(kind: TrackingKind, source: SQL): Promise<QueuedBatch> {
  const batchId = crypto.randomUUID();
  const recent = recentlyChecked(CHECKED_SQL_COLUMN[kind]);
  const skipRecent = await skipRecentlyChecked();
  const inserted = await db.execute<{ id: string }>(sql`
    INSERT INTO tracking_jobs (social_account_id, kind, scan_mode, origin, batch_id)
    SELECT d.id, ${kind}, ${manualScanMode(kind)}, 'manual', ${batchId}
    FROM (${source}) d
    WHERE NOT ${hasOpenJob(kind)} ${skipRecent ? sql`AND NOT (${recent})` : sql``}
    RETURNING id
  `);
  let skippedRecent = 0;
  if (skipRecent) {
    const { rows } = await db.execute<{ n: string }>(sql`SELECT count(*) AS n FROM (${source}) d WHERE NOT ${hasOpenJob(kind)} AND ${recent}`);
    skippedRecent = Number(rows[0]?.n ?? 0);
  }
  if (inserted.rows.length > 0) {
    sseManager.broadcast("tracking_job.updated", { batchId, count: inserted.rows.length, action: "batch_queued" });
  }
  return { batch: inserted.rows.length ? await batchSummary(batchId) : null, skippedRecent };
}

/** The Tracking page's button: `kind` for everyone the user follows. */
export function queueFollowingRefresh(kind: TrackingKind): Promise<QueuedBatch> {
  return queueBatch(kind, FOLLOWED_BY_ME);
}

/**
 * The accounts list's selection: `kind` for the chosen accounts — those that
 * are Instagram with a username, since only those can be
 * opened by a job; the rest of the selection is silently left out.
 */
export function queueAccountsRefresh(kind: TrackingKind, accountIds: string[]): Promise<QueuedBatch> {
  if (!accountIds.length) return Promise.resolve({ batch: null, skippedRecent: 0 });
  const source = sql`
    SELECT ${socialAccounts.id} AS id, scan_checked_at, info_checked_at, follows_checked_at, posts_checked_at, highlights_checked_at FROM social_accounts
    WHERE ${inArray(socialAccounts.id, accountIds)}
      AND ${socialAccounts.typeId} = ${INSTAGRAM_TYPE_ID}
      AND ${socialAccounts.username} IS NOT NULL AND ${socialAccounts.username} <> ''`;
  return queueBatch(kind, source);
}

/**
 * How many accounts the user follows are eligible, how many of those have a
 * `kind` check open right now, and how many of the rest a refresh would skip
 * as checked in the last RECENT_CHECK_HOURS (0 when that setting is off).
 */
export async function followingCounts(kind: TrackingKind): Promise<{ following: number; open: number; recent: number }> {
  const open = hasOpenJob(kind);
  const { rows } = await db.execute<{ following: string; open: string; recent: string }>(sql`
    SELECT count(*) AS following,
           count(*) FILTER (WHERE ${open}) AS open,
           count(*) FILTER (WHERE NOT ${open} AND ${recentlyChecked(CHECKED_SQL_COLUMN[kind])}) AS recent
    FROM (${FOLLOWED_BY_ME}) d
  `);
  const skip = await skipRecentlyChecked();
  return { following: Number(rows[0]?.following ?? 0), open: Number(rows[0]?.open ?? 0), recent: skip ? Number(rows[0]?.recent ?? 0) : 0 };
}

/** The most recent batch, with its jobs counted by status; null when none was ever queued. */
export async function latestBatch(): Promise<BatchSummary | null> {
  const [row] = await db
    .select({ id: trackingJobs.batchId })
    .from(trackingJobs)
    .where(sql`${trackingJobs.batchId} IS NOT NULL`)
    .orderBy(desc(trackingJobs.createdAt))
    .limit(1);
  return row?.id ? batchSummary(row.id) : null;
}

async function batchSummary(batchId: string): Promise<BatchSummary> {
  const { rows } = await db.execute<Record<string, string>>(sql`
    SELECT min(kind) AS kind, min(created_at) AS created_at, count(*) AS total,
           count(*) FILTER (WHERE status = 'queued') AS queued,
           count(*) FILTER (WHERE status = 'running') AS running,
           count(*) FILTER (WHERE status = 'completed') AS completed,
           count(*) FILTER (WHERE status = 'failed') AS failed,
           count(*) FILTER (WHERE status = 'skipped') AS skipped
    FROM tracking_jobs WHERE batch_id = ${batchId}
  `);
  const r = rows[0];
  return {
    id: batchId,
    kind: r.kind as TrackingKind,
    createdAt: new Date(r.created_at),
    total: Number(r.total),
    queued: Number(r.queued),
    running: Number(r.running),
    completed: Number(r.completed),
    failed: Number(r.failed),
    skipped: Number(r.skipped),
  };
}

/** Drop a batch's jobs that haven't started; running ones finish on their own. Returns how many were dropped. */
export async function cancelBatch(batchId: string): Promise<number> {
  const rows = await db
    .delete(trackingJobs)
    .where(and(eq(trackingJobs.batchId, batchId), eq(trackingJobs.status, "queued")))
    .returning({ id: trackingJobs.id });
  if (rows.length > 0) {
    sseManager.broadcast("tracking_job.updated", { batchId, count: rows.length, action: "batch_cancelled" });
  }
  return rows.length;
}
