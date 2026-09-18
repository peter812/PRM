// Interest level → cadence → due dates (account-tracking-plan.md §1–2).
//
// `*_due_at` on social_accounts is the scheduler's only per-account state. A
// fresh due date is spread uniformly across the cadence window, and every
// reschedule after a check adds ±10 % jitter, so accounts that were graded
// together never keep coming due together.
import crypto from "crypto";
import { and, desc, eq, inArray, sql, type SQL } from "drizzle-orm";
import { db } from "./db";
import { visibleShared } from "./access";
import { appSettings, socialAccounts, trackingJobs, type SocialAccount, type TrackingJob } from "@shared/schema";
import {
  INTEREST_LEVELS,
  MAX_FOLLOWS,
  POSTS_COMMENTS_KEY,
  POSTS_COMMENT_LIMIT_KEY,
  POSTS_SCAN_LIMIT_KEY,
  POSTS_VIDEOS_KEY,
  RECENT_CHECK_HOURS,
  TRACKING_KINDS,
  TRACKING_LEVEL_DEFAULTS_KEY,
  TRACKING_SKIP_RECENT_KEY,
  parseLevelCadences,
  parsePostSettings,
  resolveCadence,
  skipRecentEnabled,
  type Cadence,
  type InterestLevel,
  type PostSettings,
  type TrackingKind,
} from "@shared/interest-level";

export const INSTAGRAM_TYPE_ID = "00000000-0000-0000-0001-000000000001";

const DAY_MS = 86_400_000;

export async function levelCadences(): Promise<Record<InterestLevel, Cadence>> {
  const [row] = await db.select().from(appSettings).where(eq(appSettings.key, TRACKING_LEVEL_DEFAULTS_KEY));
  return parseLevelCadences(row?.value);
}

/** The Posts tab's settings, sent to prm-stories with every tracking run. */
export async function postSettings(): Promise<PostSettings> {
  const keys = [POSTS_COMMENTS_KEY, POSTS_COMMENT_LIMIT_KEY, POSTS_SCAN_LIMIT_KEY, POSTS_VIDEOS_KEY];
  const rows = await db.select().from(appSettings).where(inArray(appSettings.key, keys));
  return parsePostSettings(Object.fromEntries(rows.map((r) => [r.key, r.value])));
}

/** Whether bulk queues and the morning tick skip accounts checked in the last RECENT_CHECK_HOURS (Settings → Tracking). */
export async function skipRecentlyChecked(): Promise<boolean> {
  const [row] = await db.select().from(appSettings).where(eq(appSettings.key, TRACKING_SKIP_RECENT_KEY));
  return skipRecentEnabled(row?.value);
}

/** SQL: `checkedAt` (a timestamp expression) is within the last RECENT_CHECK_HOURS; false, not null, when never checked, so `NOT` works. */
const recentlyChecked = (checkedAt: SQL) => sql`COALESCE(${checkedAt} >= now() - ${RECENT_CHECK_HOURS} * interval '1 hour', false)`;

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

const DUE_COLUMN = { info: "infoDueAt", follows: "followsDueAt", posts: "postsDueAt" } as const;
const CHECKED_COLUMN = { info: "infoCheckedAt", follows: "followsCheckedAt", posts: "postsCheckedAt" } as const;
const OVERRIDE_COLUMN = { info: "infoEveryDays", follows: "followsEveryDays", posts: "postsEveryDays" } as const;

export type TrackingPatch = Partial<Pick<SocialAccount, "interestLevel" | "infoEveryDays" | "followsEveryDays" | "postsEveryDays">>;

/**
 * Change an account's level and/or cadence overrides. A level change clears the
 * overrides (the UI says so) and re-spreads every due date; an override change
 * re-spreads only its own kind.
 */
export async function updateTracking(account: SocialAccount, patch: TrackingPatch): Promise<void> {
  const set: Record<string, unknown> = {};
  const levelChanged = patch.interestLevel !== undefined && patch.interestLevel !== account.interestLevel;
  if (patch.interestLevel !== undefined) {
    if (!(INTEREST_LEVELS as readonly string[]).includes(patch.interestLevel)) throw new Error("Unknown interest level");
    set.interestLevel = patch.interestLevel;
    set.interestLevelManual = true;
  }
  const kindsToSpread = new Set<TrackingKind>();
  if (levelChanged) {
    for (const k of TRACKING_KINDS) {
      set[OVERRIDE_COLUMN[k]] = null;
      kindsToSpread.add(k);
    }
  } else {
    for (const k of TRACKING_KINDS) {
      const col = OVERRIDE_COLUMN[k];
      if (patch[col] !== undefined && patch[col] !== account[col]) {
        set[col] = patch[col];
        kindsToSpread.add(k);
      }
    }
  }
  if (kindsToSpread.size) {
    const cadence = resolveCadence({ ...account, ...(set as Partial<SocialAccount>) }, await levelCadences());
    for (const k of kindsToSpread) set[DUE_COLUMN[k]] = spreadDue(cadence[k]);
  }
  if (Object.keys(set).length) await db.update(socialAccounts).set(set).where(eq(socialAccounts.id, account.id));
}

/** A check of `kind` just finished: stamp it and roll the due date forward. */
export async function markChecked(accountId: string, kind: TrackingKind): Promise<void> {
  const [account] = await db.select().from(socialAccounts).where(eq(socialAccounts.id, accountId));
  if (!account) return;
  const cadence = resolveCadence(account, await levelCadences());
  await db
    .update(socialAccounts)
    .set({ [CHECKED_COLUMN[kind]]: new Date(), [DUE_COLUMN[kind]]: jitteredDue(cadence[kind]) })
    .where(eq(socialAccounts.id, accountId));
}

/** Accounts with a me person as owner — the ones whose network the "me" rule grades. */
const ME_ACCOUNTS = sql`SELECT sa.id FROM social_accounts sa JOIN people p ON p.id = sa.owner_uuid WHERE p.user_id IS NOT NULL`;

/**
 * The "me" rule: any Instagram account on either side of a follow edge with a me
 * account starts at medium. Only ever raises from none, and never touches a level
 * a person chose. With `candidateIds` it looks at those accounts only (the hook in
 * applySnapshot); without, at every edge (boot).
 */
export async function applyMeRule(candidateIds?: string[]): Promise<void> {
  if (candidateIds && candidateIds.length === 0) return;
  const medium = (await levelCadences()).medium;
  const conditions: SQL[] = [
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
    .set({
      interestLevel: "medium",
      infoDueAt: spreadDue(medium.info),
      followsDueAt: spreadDue(medium.follows),
      postsDueAt: spreadDue(medium.posts),
    })
    .where(and(...conditions));
}

// ── The job queue (account-tracking-plan.md §2.2–2.4) ──

/** What the service needs to run one job. */
export type ClaimedJob = { id: string; kind: TrackingKind; username: string; needJoinedAt: boolean };

type ClaimedRow = { id: string; kind: TrackingKind; username: string; joined_at: Date | null };
// The date joined never changes, so an info check opens the About dialog only
// until the account has one.
const toClaimed = (r: ClaimedRow): ClaimedJob => ({
  id: r.id,
  kind: r.kind,
  username: r.username,
  needJoinedAt: r.kind === "info" && r.joined_at == null,
});

/**
 * Claim up to `limit` jobs for `importerId`, marked running on the spot so two
 * importers (or the morning tick and a manual kick) can never take the same
 * one: queued manual jobs first (oldest first), then one schedule job per due
 * account and kind, most overdue first. The caller stamps the run id once it
 * has one, or hands the jobs back with `releaseTrackingJobs`.
 */
export async function claimTrackingJobs(importerId: string, limit: number, opts: { manualOnly?: boolean } = {}): Promise<ClaimedJob[]> {
  const skipRecent = opts.manualOnly ? false : await skipRecentlyChecked();
  return db.transaction(async (tx) => {
    const manual = await tx.execute<ClaimedRow>(sql`
      UPDATE tracking_jobs j
      SET status = 'running', importer_id = ${importerId}, started_at = now(), attempts = j.attempts + 1
      FROM social_accounts sa
      WHERE sa.id = j.social_account_id
        AND j.id IN (
          SELECT id FROM tracking_jobs
          WHERE status = 'queued' AND origin = 'manual'
          ORDER BY created_at
          LIMIT ${limit}
          FOR UPDATE SKIP LOCKED
        )
      RETURNING j.id, j.kind, sa.username, sa.joined_at
    `);
    const remaining = limit - manual.rows.length;
    if (opts.manualOnly || remaining <= 0) return manual.rows.map(toClaimed);

    // The blocker rule here must match `trackingBlocker` in shared/interest-level.ts,
    // which the account page uses: private accounts get only info checks, and
    // follows are skipped above MAX_FOLLOWS. Blocked rows are left out here rather
    // than filtered afterwards so they can't crowd the due list forever. A kind
    // checked in the last RECENT_CHECK_HOURS (by hand, say) stays due but waits.
    const notRecent = skipRecent ? sql`AND NOT (${recentlyChecked(sql`k.checked`)})` : sql``;
    const due = await tx.execute<ClaimedRow>(sql`
      INSERT INTO tracking_jobs (social_account_id, kind, origin, status, importer_id, started_at, attempts)
      SELECT d.id, d.kind, 'schedule', 'running', ${importerId}, now(), 1
      FROM (
        SELECT sa.id, k.kind
        FROM social_accounts sa
        CROSS JOIN LATERAL (VALUES
          ('info', sa.info_due_at, sa.info_checked_at),
          ('follows', sa.follows_due_at, sa.follows_checked_at),
          ('posts', sa.posts_due_at, sa.posts_checked_at)
        ) AS k(kind, due, checked)
        WHERE sa.type_id = ${INSTAGRAM_TYPE_ID}
          AND k.due <= now()
          ${notRecent}
          AND (k.kind = 'info' OR (
            sa.is_private IS NOT TRUE
            AND (k.kind <> 'follows' OR GREATEST(COALESCE(sa.reported_followers_count, 0), COALESCE(sa.reported_following_count, 0)) <= ${MAX_FOLLOWS})
          ))
          AND NOT EXISTS (SELECT 1 FROM tracking_jobs j WHERE j.social_account_id = sa.id AND j.status IN ('queued', 'running'))
        ORDER BY k.due ASC
        LIMIT ${remaining}
        FOR UPDATE OF sa SKIP LOCKED
      ) d
      RETURNING id, kind, (SELECT username FROM social_accounts WHERE id = social_account_id) AS username,
                (SELECT joined_at FROM social_accounts WHERE id = social_account_id) AS joined_at
    `);
    return [...manual.rows, ...due.rows].map(toClaimed);
  });
}

/**
 * The service declined the run: schedule jobs are re-derived tomorrow, manual
 * ones wait for the next chance. The service never saw them, so the hand
 * doesn't count as an attempt.
 */
export async function releaseTrackingJobs(jobs: ClaimedJob[]): Promise<void> {
  if (jobs.length === 0) return;
  const ids = jobs.map((j) => j.id);
  await db.delete(trackingJobs).where(and(inArray(trackingJobs.id, ids), eq(trackingJobs.origin, "schedule"), eq(trackingJobs.status, "running")));
  await db
    .update(trackingJobs)
    .set({ status: "queued", importerId: null, runId: null, startedAt: null, attempts: sql`greatest(${trackingJobs.attempts} - 1, 0)` })
    .where(and(inArray(trackingJobs.id, ids), eq(trackingJobs.status, "running")));
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
}

/**
 * Safety net when a run ends: whatever the service never reported is not left
 * running forever — manual jobs with attempts to spare are queued again, the
 * rest are failed.
 */
export async function failUnfinishedJobs(runId: string, runStatus: string): Promise<void> {
  const unfinished = and(eq(trackingJobs.runId, runId), eq(trackingJobs.status, "running"));
  await db
    .update(trackingJobs)
    .set(REQUEUE)
    .where(and(unfinished, eq(trackingJobs.origin, "manual"), sql`${trackingJobs.attempts} < ${MAX_JOB_ATTEMPTS}`));
  await db
    .update(trackingJobs)
    .set({ status: "failed", error: `run ended: ${runStatus}`, finishedAt: new Date() })
    .where(unfinished);
}

export async function queueManualJob(accountId: string, kind: TrackingKind, userId: number): Promise<TrackingJob> {
  const [job] = await db
    .insert(trackingJobs)
    .values({ socialAccountId: accountId, kind, origin: "manual", requestedBy: userId })
    .returning();
  return job;
}

// ── Batches: the Tracking page (account-tracking-plan.md §2.4) ──

/** The Instagram accounts a user's own accounts follow — ones with a username, the only ones a job can open. */
const followedBy = (userId: number) => sql`
  SELECT DISTINCT f.followed_id AS id, sa.info_checked_at, sa.follows_checked_at, sa.posts_checked_at
  FROM social_follows f
  JOIN social_accounts me ON me.id = f.follower_id
  JOIN people p ON p.id = me.owner_uuid AND p.user_id = ${userId}
  JOIN social_accounts sa ON sa.id = f.followed_id
  WHERE sa.type_id = ${INSTAGRAM_TYPE_ID} AND sa.username IS NOT NULL AND sa.username <> ''`;

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

const CHECKED_SQL_COLUMN = { info: sql`d.info_checked_at`, follows: sql`d.follows_checked_at`, posts: sql`d.posts_checked_at` } as const;

export type QueuedBatch = { batch: BatchSummary | null; skippedRecent: number };

/**
 * Queue one manual `kind` job for every account `source` (a subquery yielding
 * `id` and the `*_checked_at` columns) selects, in one statement. Accounts
 * that already have that check queued or running are left alone, so a second
 * click never doubles the queue; with the setting on, so are accounts whose
 * `kind` check ran in the last RECENT_CHECK_HOURS — those are counted back as
 * `skippedRecent`. `batch` is null when nothing was queued.
 */
async function queueBatch(userId: number, kind: TrackingKind, source: SQL): Promise<QueuedBatch> {
  const batchId = crypto.randomUUID();
  const recent = recentlyChecked(CHECKED_SQL_COLUMN[kind]);
  const skipRecent = await skipRecentlyChecked();
  const inserted = await db.execute<{ id: string }>(sql`
    INSERT INTO tracking_jobs (social_account_id, kind, origin, requested_by, batch_id)
    SELECT d.id, ${kind}, 'manual', ${userId}, ${batchId}
    FROM (${source}) d
    WHERE NOT ${hasOpenJob(kind)} ${skipRecent ? sql`AND NOT (${recent})` : sql``}
    RETURNING id
  `);
  let skippedRecent = 0;
  if (skipRecent) {
    const { rows } = await db.execute<{ n: string }>(sql`SELECT count(*) AS n FROM (${source}) d WHERE NOT ${hasOpenJob(kind)} AND ${recent}`);
    skippedRecent = Number(rows[0]?.n ?? 0);
  }
  return { batch: inserted.rows.length ? await batchSummary(batchId) : null, skippedRecent };
}

/** The Tracking page's button: `kind` for everyone the user follows. */
export function queueFollowingRefresh(userId: number, kind: TrackingKind): Promise<QueuedBatch> {
  return queueBatch(userId, kind, followedBy(userId));
}

/**
 * The accounts list's selection: `kind` for the chosen accounts — those the
 * caller can see that are Instagram with a username, since only those can be
 * opened by a job; the rest of the selection is silently left out.
 */
export function queueAccountsRefresh(userId: number, kind: TrackingKind, accountIds: string[]): Promise<QueuedBatch> {
  if (!accountIds.length) return Promise.resolve({ batch: null, skippedRecent: 0 });
  const visible = visibleShared(socialAccounts.visibility, socialAccounts.createdByUserId) ?? sql`true`;
  const source = sql`
    SELECT ${socialAccounts.id} AS id, info_checked_at, follows_checked_at, posts_checked_at FROM social_accounts
    WHERE ${inArray(socialAccounts.id, accountIds)}
      AND ${socialAccounts.typeId} = ${INSTAGRAM_TYPE_ID}
      AND ${socialAccounts.username} IS NOT NULL AND ${socialAccounts.username} <> ''
      AND ${visible}`;
  return queueBatch(userId, kind, source);
}

/**
 * How many accounts the user follows are eligible, how many of those have a
 * `kind` check open right now, and how many of the rest a refresh would skip
 * as checked in the last RECENT_CHECK_HOURS (0 when that setting is off).
 */
export async function followingCounts(userId: number, kind: TrackingKind): Promise<{ following: number; open: number; recent: number }> {
  const open = hasOpenJob(kind);
  const { rows } = await db.execute<{ following: string; open: string; recent: string }>(sql`
    SELECT count(*) AS following,
           count(*) FILTER (WHERE ${open}) AS open,
           count(*) FILTER (WHERE NOT ${open} AND ${recentlyChecked(CHECKED_SQL_COLUMN[kind])}) AS recent
    FROM (${followedBy(userId)}) d
  `);
  const skip = await skipRecentlyChecked();
  return { following: Number(rows[0]?.following ?? 0), open: Number(rows[0]?.open ?? 0), recent: skip ? Number(rows[0]?.recent ?? 0) : 0 };
}

/** The most recent batch the user queued, with its jobs counted by status; null when they never queued one. */
export async function latestBatch(userId: number): Promise<BatchSummary | null> {
  const [row] = await db
    .select({ id: trackingJobs.batchId })
    .from(trackingJobs)
    .where(and(eq(trackingJobs.requestedBy, userId), sql`${trackingJobs.batchId} IS NOT NULL`))
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
export async function cancelBatch(batchId: string, userId: number): Promise<number> {
  const rows = await db
    .delete(trackingJobs)
    .where(and(eq(trackingJobs.batchId, batchId), eq(trackingJobs.requestedBy, userId), eq(trackingJobs.status, "queued")))
    .returning({ id: trackingJobs.id });
  return rows.length;
}
