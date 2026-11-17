// Instagram stories: PRM owns the schedule, the prm-stories services do the
// watching. Each story_importers row is one service install (one Chrome
// profile, one Instagram login). Once a day, at a random minute inside the
// importer's evening window, PRM mints a run row plus a short-lived token and
// asks that service to start. The service confirms the token with
// GET /api/v1/stories/auth, opens Instagram to see whether the profile is still
// logged in, reports which @username it is logged in as, and answers before it
// begins; the stories themselves arrive later on the /api/v1/stories routes.
//
// The same importer also runs *tracking*, checked about once an hour outside
// its quiet hours: once enough accounts are due by their interest level
// (account-tracking-plan.md §2.3), PRM claims a batch, mints a run of kind
// 'tracking' and asks the service's POST /track to work through it. Both kinds
// share the token, the run rows and the backoff.
//
// Everything here is instance-wide (story_importers / app_settings), not per user.
import crypto from "crypto";
import { desc, eq, gt, inArray, and, lt, or } from "drizzle-orm";
import { db } from "./db";
import { log } from "./vite";
import { sseManager } from "./middleware/sse";
import { storyImporters, storyScrapeRuns, trackingJobs, type StoryImporter } from "@shared/schema";
import { claimTrackingJobs, dueNow, failUnfinishedJobs, inQuietHours, markClaimedJobsAttached, parseQuietHours, postSettings, releaseOrphanedTrackingJobs, releaseTrackingJobs, rollForwardDueDates, type ClaimedJob } from "./tracking";

export const DEFAULT_WINDOW = "19:30-22:30";
const TOKEN_TTL_MS = 6 * 60 * 60 * 1000;
const RATE_LIMIT_BACKOFF_MS = 48 * 60 * 60 * 1000;
const TICK_MS = 60_000;
/** Minutes a job is expected to take: a lite scan 2, a full one 6, a deep one 10; a single section 2, follows 10. */
const jobMinutes = (j: ClaimedJob) =>
  j.kind === "follows" ? 10 : j.kind !== "scan" || !j.posts ? 2 : j.comments || j.highlights ? 10 : 6;
/** The batch's minutes, capped under the token's 6 h TTL. */
const MAX_BUDGET_MINUTES = 300;
/** An hourly run's budget: done before the next check. */
const HOURLY_BUDGET_MINUTES = 55;
const HOUR_MS = 60 * 60_000;
const workMinutes = (jobs: ClaimedJob[]) => jobs.reduce((sum, j) => sum + jobMinutes(j), 0);
/** A manual run's budget: at least an hour, and time enough for the batch's work. */
const manualBudgetMinutes = (jobs: ClaimedJob[]) => Math.min(Math.max(60, workMinutes(jobs)), MAX_BUDGET_MINUTES);
const UNREACHABLE_RETRY_MS = 15 * 60_000;
/** The service said already_running to a kick: it is wrapping up (or in a login window). Ask again shortly. */
const BUSY_RETRY_MS = 60_000;

export function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

/** "19:30-22:30" → minutes since midnight [1170, 1350]; falls back to the default when unparseable. */
function parseWindow(spec: string | null): [number, number] {
  const m = /^(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})$/.exec((spec ?? "").trim());
  if (!m) return parseWindow(DEFAULT_WINDOW);
  const a = Number(m[1]) * 60 + Number(m[2]);
  const b = Number(m[3]) * 60 + Number(m[4]);
  return a < b ? [a, b] : parseWindow(DEFAULT_WINDOW);
}

/** A random moment inside the window on `day` (local time). */
function randomTimeInWindow(day: Date, [start, end]: [number, number]): Date {
  const at = new Date(day);
  at.setHours(0, 0, 0, 0);
  at.setMinutes(start + Math.floor(Math.random() * (end - start)));
  return at;
}

/**
 * The importer's service base URL without a trailing slash; "" when unset.
 * A bare "host:port" gets http:// — fetch() would otherwise read "host:" as the scheme.
 */
export function storiesServiceUrl(importer: Pick<StoryImporter, "serviceUrl">): string {
  const url = importer.serviceUrl.trim().replace(/\/$/, "");
  return url && !/^https?:\/\//i.test(url) ? `http://${url}` : url;
}

/** Headers for a call to the importer's service: the shared secret, when one is set. */
export function storiesServiceHeaders(importer: Pick<StoryImporter, "serviceSecret">): Record<string, string> {
  const secret = importer.serviceSecret.trim();
  return secret ? { "x-stories-secret": secret } : {};
}

type RunKind = "stories" | "tracking";

/** Roll the importer's next stories run: today if its window is still ahead, otherwise tomorrow. */
async function planNextRun(importer: StoryImporter, from: Date): Promise<Date> {
  const window = parseWindow(importer.runWindow);
  let at = randomTimeInWindow(from, window);
  if (at.getTime() <= from.getTime()) {
    const tomorrow = new Date(from);
    tomorrow.setDate(tomorrow.getDate() + 1);
    at = randomTimeInWindow(tomorrow, window);
  }
  await db.update(storyImporters).set({ nextRunAt: at }).where(eq(storyImporters.id, importer.id));
  return at;
}

/** Whether a run PRM minted for the importer is still going, as far as PRM knows: its manifest hasn't closed it and its token is live. */
async function hasRunInFlight(importerId: string, now: Date): Promise<boolean> {
  const [row] = await db
    .select({ id: storyScrapeRuns.id })
    .from(storyScrapeRuns)
    .where(and(eq(storyScrapeRuns.importerId, importerId), inArray(storyScrapeRuns.status, ["starting", "running"]), gt(storyScrapeRuns.tokenExpiresAt, now)))
    .limit(1);
  return Boolean(row);
}

/** The importer's last run that got as far as the scraper (not a PRM-side skip / unreachable). */
async function lastScraperRun(importerId: string) {
  const [row] = await db
    .select({ status: storyScrapeRuns.status, startedAt: storyScrapeRuns.startedAt })
    .from(storyScrapeRuns)
    .where(and(
      eq(storyScrapeRuns.importerId, importerId),
      inArray(storyScrapeRuns.status, ["running", "completed", "needs_login", "checkpoint", "no_username", "rate_limited", "parse_failed", "error"]),
    ))
    .orderBy(desc(storyScrapeRuns.startedAt))
    .limit(1);
  return row;
}

export type RunStart = { runId: string; status: string; error: string | null; username: string | null };

/**
 * Mint a run and ask the importer's service to start it. Returns the run's
 * status after the service answered (or failed to). Safe to call from the
 * settings page's "Run now" and from the nightly tick alike; each passes its
 * own "Unseen only" setting.
 */
export async function triggerStoriesRun(importer: StoryImporter, unseenOnly: boolean): Promise<RunStart> {
  // One queued stories run per importer is enough: a second request joins it.
  const [queued] = await db
    .select({ id: storyScrapeRuns.id })
    .from(storyScrapeRuns)
    .where(and(eq(storyScrapeRuns.importerId, importer.id), eq(storyScrapeRuns.kind, "stories"), eq(storyScrapeRuns.status, "queued")))
    .limit(1);
  if (queued) return { runId: queued.id, status: "queued", error: null, username: null };
  if (await hasRunInFlight(importer.id, new Date())) {
    const runId = crypto.randomUUID();
    await db.insert(storyScrapeRuns).values({ id: runId, importerId: importer.id, kind: "stories", status: "queued", startedAt: new Date(), counts: { unseenOnly } });
    log(`[Stories] ${importer.label}: stories run ${runId} queued behind the run in flight`);
    broadcastStoryRun();
    return { runId, status: "queued", error: null, username: null };
  }
  return startStoriesRun(importer, unseenOnly);
}

/**
 * Start a stories run (a fresh one, or the queued row `queuedId`). A service
 * busy with something PRM doesn't know about (a login window, a run from before
 * a restart) answers already_running: the run goes back in the queue and is
 * asked again shortly, rather than being dropped.
 */
async function startStoriesRun(importer: StoryImporter, unseenOnly: boolean, queuedId?: string): Promise<RunStart> {
  const result = await startRun(importer, "stories", () => ({ videos: importer.downloadVideos, unseenOnly }), queuedId);
  if (result.status !== "already_running") return result;
  await db
    .update(storyScrapeRuns)
    .set({ status: "queued", error: null, finishedAt: null, counts: { unseenOnly } })
    .where(eq(storyScrapeRuns.id, result.runId));
  broadcastStoryRun();
  kickManualTrackingJobs(BUSY_RETRY_MS);
  return { ...result, status: "queued", error: null };
}

/** Queued stories runs whose importer is free go now; one still busy stays queued for the next kick. */
async function startQueuedStoriesRuns(): Promise<void> {
  const queued = await db
    .select({ id: storyScrapeRuns.id, importerId: storyScrapeRuns.importerId, counts: storyScrapeRuns.counts })
    .from(storyScrapeRuns)
    .where(and(eq(storyScrapeRuns.kind, "stories"), eq(storyScrapeRuns.status, "queued")))
    .orderBy(storyScrapeRuns.startedAt);
  for (const run of queued) {
    const close = async (status: string, error: string) => {
      await db.update(storyScrapeRuns).set({ status, error, finishedAt: new Date() }).where(eq(storyScrapeRuns.id, run.id));
      broadcastStoryRun();
    };
    const [importer] = run.importerId ? await db.select().from(storyImporters).where(eq(storyImporters.id, run.importerId)) : [];
    if (!importer) {
      await close("error", "importer was removed while the run was queued");
      continue;
    }
    if (await hasRunInFlight(importer.id, new Date())) continue;
    if (await rateLimitedUntil(importer.id)) {
      await close("skipped", "rate limited on the previous run; backing off 48 h");
      continue;
    }
    await startStoriesRun(importer, Boolean((run.counts as { unseenOnly?: boolean } | null)?.unseenOnly), run.id);
  }
}

/** Stories runs changed (queued, started, finished, deleted): the task tracker refetches. */
export function broadcastStoryRun(): void {
  sseManager.broadcast("story_run.updated", {});
}

/**
 * A tracking run: put the claimed jobs under the freshly minted run, then ask
 * the service's POST /track to work them. A declined start releases them again.
 */
export async function triggerTrackingRun(importer: StoryImporter, jobs: ClaimedJob[], budgetMinutes: number): Promise<RunStart> {
  const ids = jobs.map((j) => j.id);
  let result: RunStart;
  try {
    result = await startRun(importer, "tracking", async (runId) => {
      await db.update(trackingJobs).set({ runId }).where(inArray(trackingJobs.id, ids));
      markClaimedJobsAttached(ids);
      return { jobs, budgetMinutes, posts: await postSettings() };
    });
  } catch (err) {
    await releaseTrackingJobs(jobs);
    throw err;
  } finally {
    markClaimedJobsAttached(ids);
  }
  if (result.status !== "running") await releaseTrackingJobs(jobs);
  return result;
}

async function startRun(
  importer: StoryImporter,
  kind: RunKind,
  extra: (runId: string) => Record<string, unknown> | Promise<Record<string, unknown>>,
  /** A queued run row to start in place of minting a new one. */
  queuedId?: string,
): Promise<RunStart> {
  const apiUrl = storiesServiceUrl(importer);
  const runId = queuedId ?? crypto.randomUUID();
  const token = crypto.randomBytes(32).toString("hex");
  const startedAt = new Date();
  const fields = {
    status: "starting",
    startedAt,
    tokenHash: hashToken(token),
    tokenExpiresAt: new Date(startedAt.getTime() + TOKEN_TTL_MS),
  };
  if (queuedId) {
    await db.update(storyScrapeRuns).set({ ...fields, counts: {}, error: null, finishedAt: null }).where(eq(storyScrapeRuns.id, runId));
  } else {
    await db.insert(storyScrapeRuns).values({ id: runId, importerId: importer.id, kind, ...fields });
  }
  if (kind === "stories") broadcastStoryRun();

  let status = "running";
  let error: string | null = null;
  let username: string | null = null;
  try {
    const payload = await extra(runId);
    if (!apiUrl) throw new Error("Stories service URL is not set");
    const res = await fetch(`${apiUrl}/${kind === "stories" ? "run" : "track"}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...storiesServiceHeaders(importer) },
      body: JSON.stringify({ runId, token, ...payload }),
      // The service opens Instagram before answering; give it time to load.
      signal: AbortSignal.timeout(120_000),
    });
    const body = (await res.json().catch(() => ({}))) as { ok?: boolean; reason?: string; username?: string; until?: string };
    if (!body.ok) {
      status = body.reason || `http_${res.status}`;
      // "paused": the service is still in its own rate-limit backoff, which can outlast ours by a run's length.
      error = `Stories service declined: ${status}${body.until ? ` until ${new Date(body.until).toLocaleString()}` : ""}`;
    } else if (typeof body.username === "string" && body.username) {
      username = body.username;
    }
  } catch (err) {
    status = "unreachable";
    error = err instanceof Error ? err.message : String(err);
  }

  if (status !== "running") {
    await db
      .update(storyScrapeRuns)
      .set({ status, error, finishedAt: new Date(), tokenHash: null, tokenExpiresAt: null })
      .where(eq(storyScrapeRuns.id, runId));
  } else {
    await db.update(storyScrapeRuns).set({ status, scrapedFrom: username }).where(eq(storyScrapeRuns.id, runId));
    if (username) await db.update(storyImporters).set({ lastUsername: username }).where(eq(storyImporters.id, importer.id));
  }
  if (kind === "stories") broadcastStoryRun();
  log(`[Stories] ${importer.label}: ${kind} run ${runId}: ${status}${username ? ` as @${username}` : ""}${error ? ` — ${error}` : ""}`);
  return { runId, status, error, username };
}

/** When the importer's rate-limit backoff ends — shared by both kinds, it is the same Instagram account — or null. */
export async function rateLimitedUntil(importerId: string): Promise<Date | null> {
  const last = await lastScraperRun(importerId);
  if (last?.status !== "rate_limited") return null;
  const until = new Date(last.startedAt.getTime() + RATE_LIMIT_BACKOFF_MS);
  return until.getTime() > Date.now() ? until : null;
}

/**
 * Whether this run should be skipped: the rate-limit backoff or the random day
 * off. Records a `skipped` run when it is.
 */
async function skipToday(importer: StoryImporter, kind: RunKind, now: Date): Promise<boolean> {
  let skipReason: string | null = null;
  if (await rateLimitedUntil(importer.id)) {
    skipReason = "rate limited on the previous run; backing off 48 h";
  } else if (Math.random() < importer.skipDayProbability) {
    skipReason = "random day off";
  }
  if (!skipReason) return false;
  await db.insert(storyScrapeRuns).values({ id: crypto.randomUUID(), importerId: importer.id, kind, status: "skipped", startedAt: now, finishedAt: now, error: skipReason });
  log(`[Stories] ${importer.label}: skipping ${kind}: ${skipReason}`);
  return true;
}

async function tickStories(importer: StoryImporter, now: Date): Promise<void> {
  const next = importer.nextRunAt;
  if (!next || Number.isNaN(next.getTime())) {
    const at = await planNextRun(importer, now);
    log(`[Stories] ${importer.label}: next run planned for ${at.toLocaleString()}`);
    return;
  }
  if (next.getTime() > now.getTime()) return;

  // Due. Plan the next one first so a crash below can't cause a double run.
  const nextDay = new Date(now);
  nextDay.setDate(nextDay.getDate() + Math.min(Math.max(importer.runEveryDays, 1), 30));
  nextDay.setHours(0, 0, 0, 0);
  const planned = await planNextRun(importer, nextDay);
  log(`[Stories] ${importer.label}: next run planned for ${planned.toLocaleString()}`);

  if (await skipToday(importer, "stories", now)) return;
  await triggerStoriesRun(importer, importer.unseenOnly);
}

/** The next hourly check: about an hour on, give or take five minutes. */
const inAboutAnHour = (now: Date) => new Date(now.getTime() + HOUR_MS + (Math.random() - 0.5) * 10 * 60_000);

/** When the quiet hours `now` sits in end, plus up to ten minutes. */
function quietHoursEnd(now: Date, [, end]: [number, number]): Date {
  const at = new Date(now);
  at.setHours(0, end + Math.floor(Math.random() * 10), 0, 0);
  if (at.getTime() <= now.getTime()) at.setDate(at.getDate() + 1);
  return at;
}

async function setNextCheck(importer: StoryImporter, at: Date): Promise<void> {
  await db.update(storyImporters).set({ nextTrackingRunAt: at }).where(eq(storyImporters.id, importer.id));
}

/**
 * Hourly tracking checks. About once an hour outside quiet hours: when at
 * least `trackingMinBatch` scheduled scans are due (or one has waited over a
 * day), claim up to `trackingMaxJobs` and start a run; otherwise wait for the
 * next check. A check inside quiet hours starts nothing and sleeps until they
 * end; that once-a-night check also rolls the random day off.
 */
async function tickTracking(importer: StoryImporter, now: Date): Promise<void> {
  if (!importer.trackingEnabled) return;
  const next = importer.nextTrackingRunAt;
  if (next && !Number.isNaN(next.getTime()) && next.getTime() > now.getTime()) return;

  const quiet = parseQuietHours(importer.trackingQuietHours);
  if (inQuietHours(now, quiet)) {
    const wake = quietHoursEnd(now, quiet);
    if (Math.random() < importer.skipDayProbability) {
      wake.setDate(wake.getDate() + 1);
      await db.insert(storyScrapeRuns).values({ id: crypto.randomUUID(), importerId: importer.id, kind: "tracking", status: "skipped", startedAt: now, finishedAt: now, error: "random day off" });
    }
    await setNextCheck(importer, wake);
    log(`[Stories] ${importer.label}: quiet hours; next tracking check ${wake.toLocaleString()}`);
    return;
  }
  const until = await rateLimitedUntil(importer.id);
  if (until) {
    await setNextCheck(importer, until);
    log(`[Stories] ${importer.label}: tracking waits for the rate-limit backoff (until ${until.toLocaleString()})`);
    return;
  }

  // Plan the next check first so a crash below can't cause a double run.
  await setNextCheck(importer, inAboutAnHour(now));
  if (await hasRunInFlight(importer.id, now)) return;
  const due = await dueNow();
  if (due.count === 0 || (due.count < importer.trackingMinBatch && !due.stale)) return;

  const jobs = await claimTrackingJobs(importer.id, importer.trackingMaxJobs);
  if (jobs.length === 0) return;
  let result: RunStart;
  try {
    // Whatever the run doesn't reach in its budget stays due for the next check.
    result = await triggerTrackingRun(importer, jobs, Math.min(Math.max(workMinutes(jobs), 15), HOURLY_BUDGET_MINUTES));
  } catch (err) {
    await releaseTrackingJobs(jobs).catch(() => {});
    throw err;
  }
  // Busy with a stories run or a login window: look again in a quarter of an hour.
  if (result.status === "already_running") await setNextCheck(importer, new Date(now.getTime() + 15 * 60_000));
}

/** The importer manual jobs go to: tracking-enabled first, then enabled, then any with a service URL. */
export async function manualImporter(): Promise<StoryImporter | null> {
  const importers = await db
    .select()
    .from(storyImporters)
    .orderBy(desc(storyImporters.trackingEnabled), desc(storyImporters.enabled), storyImporters.createdAt);
  return importers.find((i) => i.serviceUrl?.trim()) ?? importers[0] ?? null;
}

/**
 * Manual jobs don't wait for the morning when an importer can take them now: a
 * busy one answers already_running and the jobs simply wait for the run that
 * ends to kick them again. Each run takes at most `tracking_max_jobs`, so a
 * batch of hundreds drains as a chain of runs, one straight after another —
 * until the queue is empty, the service is unreachable (retried later), or
 * Instagram rate-limits the account (then nothing until the backoff ends).
 * Debounced so a burst of clicks on the account page becomes one run. While a
 * run PRM knows about is still going, the kick waits for its manifest (which
 * kicks again) rather than minting a run the service would only decline; if
 * the service declines anyway it is retried in a minute, never dropped — a
 * dropped kick is a batch stuck at "queued" with nothing left to wake it.
 */
let manualKick: NodeJS.Timeout | null = null;
export function kickManualTrackingJobs(delayMs = 250): void {
  if (manualKick) clearTimeout(manualKick);
  manualKick = setTimeout(() => {
    manualKick = null;
    (async () => {
      // A stories run queued behind the run that just ended goes before more tracking jobs.
      await startQueuedStoriesRuns();
      const importer = await manualImporter();
      if (!importer) return;
      const until = await rateLimitedUntil(importer.id);
      if (until) {
        log(`[Stories] ${importer.label}: manual jobs wait for the rate-limit backoff (until ${until.toLocaleString()})`);
        return;
      }
      if (await hasRunInFlight(importer.id, new Date())) return;
      const jobs = await claimTrackingJobs(importer.id, importer.trackingMaxJobs, { manualOnly: true });
      if (jobs.length === 0) return;
      let result: RunStart;
      try {
        result = await triggerTrackingRun(importer, jobs, manualBudgetMinutes(jobs));
      } catch (err) {
        await releaseTrackingJobs(jobs).catch(() => {});
        throw err;
      }
      if (result.status === "unreachable" || result.status === "paused") kickManualTrackingJobs(UNREACHABLE_RETRY_MS);
      else if (result.status === "already_running") kickManualTrackingJobs(BUSY_RETRY_MS);
    })().catch((err) => log(`[Stories] manual tracking run: ${err instanceof Error ? err.message : err}`));
  }, delayMs);
}

/** Settings page: start a tracking run now with whatever is due (plus queued manual jobs). */
export async function trackNow(importer: StoryImporter): Promise<RunStart & { jobs: number }> {
  const jobs = await claimTrackingJobs(importer.id, importer.trackingMaxJobs);
  if (jobs.length === 0) return { runId: "", status: "nothing_due", error: null, username: null, jobs: 0 };
  try {
    return { ...(await triggerTrackingRun(importer, jobs, manualBudgetMinutes(jobs))), jobs: jobs.length };
  } catch (err) {
    await releaseTrackingJobs(jobs).catch(() => {});
    throw err;
  }
}

/** A run just ended: whatever manual jobs are still queued go next. */
export function kickManualTrackingJobsAfterRun(): void {
  kickManualTrackingJobs();
}

/**
 * A run whose manifest never came (the service died mid-run) would otherwise
 * stay "running" forever, and with it its jobs — and no manifest means nothing
 * kicks the next manual run, so a draining batch would stall. Once the run's
 * token has expired the service can't deliver anyway: close it out. Also
 * releases any jobs orphaned between claiming and attaching to a run.
 */
async function reapStaleRuns(now: Date): Promise<void> {
  const stale = await db
    .update(storyScrapeRuns)
    .set({ status: "error", error: "no manifest before the run's token expired", finishedAt: now, tokenHash: null, tokenExpiresAt: null })
    .where(and(inArray(storyScrapeRuns.status, ["starting", "running"]), lt(storyScrapeRuns.tokenExpiresAt, now)))
    .returning({ id: storyScrapeRuns.id, kind: storyScrapeRuns.kind });
  for (const run of stale) {
    log(`[Stories] ${run.kind} run ${run.id} never finished; closing it out`);
    if (run.kind === "tracking") await failUnfinishedJobs(run.id, "error");
  }
  if (stale.some((r) => r.kind === "stories")) broadcastStoryRun();
  const orphans = await releaseOrphanedTrackingJobs();
  if (orphans > 0) log(`[Stories] released ${orphans} orphaned tracking job(s)`);
  if (stale.length || orphans > 0) kickManualTrackingJobsAfterRun();
}

/**
 * Stories (`enabled`) and tracking (`trackingEnabled`) are separate switches; an
 * importer ticks for whichever is on. Every importer is independent: a slow
 * service answering one must not hold up the others.
 */
async function tick(): Promise<void> {
  const now = new Date();
  await reapStaleRuns(now);
  const importers = await db.select().from(storyImporters).where(or(eq(storyImporters.enabled, true), eq(storyImporters.trackingEnabled, true)));
  // With nothing auto-tracking, keep due dates ahead of today.
  if (!importers.some((i) => i.trackingEnabled)) await rollForwardDueDates();
  if (importers.length === 0) return;
  const results = await Promise.allSettled(
    importers.map(async (i) => {
      if (i.enabled) await tickStories(i, now);
      await tickTracking(i, now);
    }),
  );
  results.forEach((r, idx) => {
    if (r.status === "rejected") log(`[Stories] ${importers[idx].label}: ${r.reason instanceof Error ? r.reason.message : r.reason}`);
  });
}

export function startStoriesScheduler(): void {
  const loop = async () => {
    try {
      await tick();
    } catch (err) {
      log(`[Stories] Scheduler error: ${err instanceof Error ? err.message : err}`);
    }
    setTimeout(loop, TICK_MS);
  };
  setTimeout(loop, 15_000);
  // Manual jobs queued before a restart lost their in-memory kick.
  kickManualTrackingJobs(15_000);
}

/** The run whose live token matches, or null. Used by the /api/v1/stories routes. */
export async function runForToken(token: string | undefined): Promise<{ id: string; importerId: string | null } | null> {
  if (!token) return null;
  const [row] = await db
    .select({ id: storyScrapeRuns.id, importerId: storyScrapeRuns.importerId })
    .from(storyScrapeRuns)
    .where(and(eq(storyScrapeRuns.tokenHash, hashToken(token)), gt(storyScrapeRuns.tokenExpiresAt, new Date())))
    .limit(1);
  return row ?? null;
}

