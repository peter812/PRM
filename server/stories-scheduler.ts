// Instagram stories: PRM owns the schedule, the prm-stories services do the
// watching. Each story_importers row is one service install (one Chrome
// profile, one Instagram login). Once a day, at a random minute inside the
// importer's evening window, PRM mints a run row plus a short-lived token and
// asks that service to start. The service confirms the token with
// GET /api/v1/stories/auth, opens Instagram to see whether the profile is still
// logged in, reports which @username it is logged in as, and answers before it
// begins; the stories themselves arrive later on the /api/v1/stories routes.
//
// Everything here is instance-wide (story_importers / app_settings), not per user.
import crypto from "crypto";
import { desc, eq, gt, inArray, and } from "drizzle-orm";
import { db } from "./db";
import { storage } from "./storage";
import { runAsSystem } from "./access";
import { log } from "./vite";
import { storyImporters, storyScrapeRuns, type StoryImporter } from "@shared/schema";

export const STORIES_IMAGE_STORAGE_KEY = "stories_image_storage"; // "local" | "s3" — global, applies to every importer

export const DEFAULT_WINDOW = "19:30-22:30";
const TOKEN_TTL_MS = 6 * 60 * 60 * 1000;
const RATE_LIMIT_BACKOFF_MS = 48 * 60 * 60 * 1000;
const TICK_MS = 60_000;

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

/** Roll the importer's next run time: today if the window is still ahead, otherwise tomorrow. */
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

/**
 * Mint a run and ask the importer's service to start it. Returns the run's
 * status after the service answered (or failed to). Safe to call from the
 * settings page's "Run now" and from the nightly tick alike.
 */
export async function triggerStoriesRun(importer: StoryImporter): Promise<{ runId: string; status: string; error: string | null; username: string | null }> {
  const apiUrl = storiesServiceUrl(importer);
  const runId = crypto.randomUUID();
  const token = crypto.randomBytes(32).toString("hex");
  const startedAt = new Date();
  await db.insert(storyScrapeRuns).values({
    id: runId,
    importerId: importer.id,
    status: "starting",
    startedAt,
    tokenHash: hashToken(token),
    tokenExpiresAt: new Date(startedAt.getTime() + TOKEN_TTL_MS),
  });

  let status = "running";
  let error: string | null = null;
  let username: string | null = null;
  try {
    if (!apiUrl) throw new Error("Stories service URL is not set");
    const res = await fetch(`${apiUrl}/run`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ runId, token, videos: importer.downloadVideos }),
      // The service opens Instagram before answering; give it time to load.
      signal: AbortSignal.timeout(120_000),
    });
    const body = (await res.json().catch(() => ({}))) as { ok?: boolean; reason?: string; username?: string };
    if (!body.ok) {
      status = body.reason || `http_${res.status}`;
      error = `Stories service declined: ${status}`;
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
  log(`[Stories] ${importer.label}: run ${runId}: ${status}${username ? ` as @${username}` : ""}${error ? ` — ${error}` : ""}`);
  return { runId, status, error, username };
}

async function tickImporter(importer: StoryImporter, now: Date): Promise<void> {
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

  const last = await lastScraperRun(importer.id);
  let skipReason: string | null = null;
  if (last?.status === "rate_limited" && now.getTime() - last.startedAt.getTime() < RATE_LIMIT_BACKOFF_MS) {
    skipReason = "rate limited on the previous run; backing off 48 h";
  } else if (Math.random() < importer.skipDayProbability) {
    skipReason = "random day off";
  }
  if (skipReason) {
    await db.insert(storyScrapeRuns).values({ id: crypto.randomUUID(), importerId: importer.id, status: "skipped", startedAt: now, finishedAt: now, error: skipReason });
    log(`[Stories] ${importer.label}: skipping tonight: ${skipReason}`);
    return;
  }
  await triggerStoriesRun(importer);
}

/** Every enabled importer is independent: a slow service answering one must not hold up the others. */
async function tick(): Promise<void> {
  const importers = await db.select().from(storyImporters).where(eq(storyImporters.enabled, true));
  if (importers.length === 0) return;
  const now = new Date();
  const results = await Promise.allSettled(importers.map((i) => tickImporter(i, now)));
  results.forEach((r, idx) => {
    if (r.status === "rejected") log(`[Stories] ${importers[idx].label}: ${r.reason instanceof Error ? r.reason.message : r.reason}`);
  });
}

export function startStoriesScheduler(): void {
  const loop = async () => {
    try {
      await runAsSystem(tick);
    } catch (err) {
      log(`[Stories] Scheduler error: ${err instanceof Error ? err.message : err}`);
    }
    setTimeout(loop, TICK_MS);
  };
  setTimeout(loop, 15_000);
}

/** The run whose live token matches, or null. Used by the /api/v1/stories routes. */
export async function runForToken(token: string | undefined): Promise<{ id: string } | null> {
  if (!token) return null;
  const [row] = await db
    .select({ id: storyScrapeRuns.id })
    .from(storyScrapeRuns)
    .where(and(eq(storyScrapeRuns.tokenHash, hashToken(token)), gt(storyScrapeRuns.tokenExpiresAt, new Date())))
    .limit(1);
  return row ?? null;
}

/** Where story images and videos go; "s3" or "local". */
export async function storiesStorageMode(): Promise<"s3" | "local"> {
  return (await storage.getAppSetting(STORIES_IMAGE_STORAGE_KEY)) === "s3" ? "s3" : "local";
}
