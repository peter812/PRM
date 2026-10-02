// OSINT scans, queued in the osint_scans table and fed to PRM-compute.
//
// Every scan PRM runs goes through the table: manual ones from the OSINT tool
// pages, and automatic ones for a "Me" user's network — whenever a social
// account owned by a Me person is added or updated, every account it follows is
// queued for a username scan on each enabled tool. The runner keeps a few scans
// in flight on PRM-compute and submits the next pending row as each finishes,
// so hundreds can be queued at once without flooding it. Each row records when
// it was sent, when it finished, and the result; results of scans of a known
// account or of a person's OSINT Runs target are also stored as an Insight.
// Accounts can also be queued in bulk by tracking level, and an optional
// yearly sweep rescans every account a tool hasn't checked in a year.
import { storage } from "./storage";
import { runAsSystem } from "./access";
import { log } from "./vite";
import { isOsintConfigured, loadOsintConfig, osintFetch, type OsintConfig } from "./osint-client";
import { OSINT_TOOLS, osintHits, type OsintTargetType } from "@shared/osint-tools";
import { INTEREST_LEVELS, type InterestLevel } from "@shared/interest-level";
import type { OsintScan } from "@shared/schema";

export const AUTO_SCAN_ENABLED_KEY = "osint_auto_scan_enabled";
export const AUTO_SCAN_TOOLS_KEY = "osint_auto_scan_tools";            // comma-separated tool slugs
export const YEARLY_SCAN_ENABLED_KEY = "osint_yearly_scan_enabled";

// An account already scanned by a tool this recently is not queued again automatically.
const RESCAN_AFTER_DAYS = 30;
// The same for a bulk queue by tracking level, and for the yearly sweep.
const LEVEL_RESCAN_AFTER_DAYS = 120;
const YEARLY_RESCAN_AFTER_DAYS = 365;
const YEARLY_CHECK_MS = 60 * 60 * 1000;
const MAX_ATTEMPTS = 3;
// PRM-compute runs 3 OSINT jobs at once by default (OSINT_MAX_CONCURRENT_JOBS).
const MAX_IN_FLIGHT = 3;
// PRM-compute allows 30 requests/min per key; polling 3 jobs every 10s stays well under.
const TICK_MS = 10_000;
// Measured from submission, so it includes any wait in PRM-compute's own queue.
const JOB_TIMEOUT_MS = 30 * 60 * 1000;

const errorMessage = (err: unknown) => err instanceof Error ? err.message : String(err);

/** The tools picked in OSINT settings; auto-scans and Run scan both use them. */
async function scanTools(): Promise<string[]> {
  const tools = await storage.getAppSetting(AUTO_SCAN_TOOLS_KEY);
  return (tools ?? "sherlock").split(",").map(t => t.trim()).filter(Boolean);
}

/** The tools to auto-scan with, or null unless auto-scans are on and PRM-compute is configured. */
async function autoScanTools(): Promise<string[] | null> {
  const [cfg, enabled, list] = await Promise.all([
    loadOsintConfig(),
    storage.getAppSetting(AUTO_SCAN_ENABLED_KEY),
    scanTools(),
  ]);
  return enabled === "true" && list.length && isOsintConfigured(cfg) ? list : null;
}

/**
 * Queue one target of a known owner — a social account's username or a
 * person's OSINT Runs entry — on every settings tool that accepts its type.
 * Returns how many scans were queued (tools already scanning it are skipped).
 */
export async function queueOsintScansForTarget(
  owner: { socialAccountId: string } | { personId: string },
  target: string,
  targetType: OsintTargetType,
  requestedByUserId: number,
): Promise<number> {
  const supported = new Set(OSINT_TOOLS.filter(t => t.supportedTargetTypes.includes(targetType)).map(t => t.name));
  let added = 0;
  for (const tool of (await scanTools()).filter(t => supported.has(t))) {
    if (await storage.createOsintScan({ ...owner, tool, target, targetType, options: {}, requestedByUserId })) added++;
  }
  if (added) wakeOsintRunner();
  return added;
}

/**
 * Queue scans for the accounts `socialAccountId` follows — all of them, or just
 * `onlyTargetIds` when the caller knows which follows are new. No-op unless the
 * account belongs to a Me person and auto-scans are on. Safe to call without
 * awaiting: it never throws.
 */
export async function queueOsintScansForMeAccount(socialAccountId: string, onlyTargetIds?: string[]): Promise<void> {
  if (onlyTargetIds && onlyTargetIds.length === 0) return;
  try {
    const tools = await autoScanTools();
    if (!tools) return;
    const userId = await storage.getMeUserIdForSocialAccount(socialAccountId);
    if (userId === null) return;
    const targets = onlyTargetIds ?? await storage.getFollowingIds(socialAccountId);
    const added = await storage.enqueueOsintScans(targets, tools, userId, RESCAN_AFTER_DAYS);
    if (added) {
      log(`[OsintScan] Queued ${added} scan(s) for the network of account ${socialAccountId}`);
      wakeOsintRunner();
    }
  } catch (err) {
    log(`[OsintScan] Failed to queue scans for ${socialAccountId}: ${errorMessage(err)}`);
  }
}

/** Queue every account the caller can see at `level` or above. Returns how many scans were queued. */
export async function queueOsintScansForLevel(level: InterestLevel, requestedByUserId: number): Promise<number> {
  const levels = INTEREST_LEVELS.slice(INTEREST_LEVELS.indexOf(level));
  const ids = await storage.getSocialAccountIdsAtLevels(levels);
  const added = await storage.enqueueOsintScans(ids, await scanTools(), requestedByUserId, LEVEL_RESCAN_AFTER_DAYS);
  if (added) wakeOsintRunner();
  return added;
}

/**
 * With the yearly sweep on, queue every account a tool hasn't scanned in a
 * year. Checked hourly; each pass only adds what has come due since the last.
 */
async function queueYearlyOsintScans(): Promise<void> {
  try {
    const [enabled, cfg] = await Promise.all([storage.getAppSetting(YEARLY_SCAN_ENABLED_KEY), loadOsintConfig()]);
    if (enabled !== "true" || !isOsintConfigured(cfg)) return;
    const ids = await storage.getSocialAccountIdsAtLevels();
    const added = await storage.enqueueOsintScans(ids, await scanTools(), null, YEARLY_RESCAN_AFTER_DAYS);
    if (added) {
      log(`[OsintScan] Yearly sweep queued ${added} scan(s)`);
      wakeOsintRunner();
    }
  } catch (err) {
    log(`[OsintScan] Yearly sweep failed: ${errorMessage(err)}`);
  }
}

/** Queue the network of every Me-owned account on the instance. */
export async function queueOsintScansForAllMeAccounts(): Promise<void> {
  for (const id of await storage.getMeOwnedSocialAccountIds()) {
    await queueOsintScansForMeAccount(id);
  }
}

// ── Runner ───────────────────────────────────────────────────────────────────

type ComputeJob = { id: string; status: "pending" | "running" | "done" | "error" | "cancelled"; error: string | null; result: any };

async function computeJson(cfg: OsintConfig, path: string, init?: RequestInit): Promise<ComputeJob> {
  const res = await osintFetch(cfg.apiUrl, cfg.apiKey, path, init);
  if (!res.ok) {
    throw Object.assign(new Error(`PRM-Compute returned ${res.status}: ${await res.text()}`), { status: res.status });
  }
  return res.json();
}

/** Cancel a scan: drop it from the queue, or stop it on PRM-compute if it was already sent. */
export async function cancelOsintScan(id: string): Promise<OsintScan | undefined> {
  const row = await storage.cancelOsintScan(id);
  if (row?.computeJobId) {
    const cfg = await loadOsintConfig();
    await computeJson(cfg, `/scans/${encodeURIComponent(row.computeJobId)}`, { method: "DELETE" }).catch(() => {});
  }
  return row;
}

/** Transient failures go back in the queue until the row runs out of attempts. */
async function retryOrFail(row: OsintScan, message: string, retry = true): Promise<void> {
  log(`[OsintScan] ${row.tool} ${row.target} attempt ${row.attempts} failed: ${message}`);
  const giveUp = !retry || row.attempts >= MAX_ATTEMPTS;
  await storage.updateOsintScan(row.id, {
    status: giveUp ? "failed" : "pending",
    error: message,
    computeJobId: null,
    completedAt: giveUp ? new Date() : null,
  });
}

async function recordResult(row: OsintScan, result: any): Promise<void> {
  const saved = await storage.updateOsintScan(row.id, { status: "done", result: result ?? null, error: null, completedAt: new Date() });
  if (!saved || !(row.socialAccountId || row.personId)) return;
  try {
    const account = row.socialAccountId ? await storage.getSocialAccountById(row.socialAccountId) : undefined;
    const person = row.personId ? await storage.getPersonById(row.personId) : undefined;
    const personId = row.personId ?? account?.ownerUuid;
    const hits = osintHits(result);
    // Attribute to entity owner if requestedByUserId is null (e.g. yearly sweep) to avoid leaking private insights
    const ownerUserId = row.requestedByUserId ?? account?.createdByUserId ?? person?.createdByUserId ?? null;
    await storage.createInsight({
      type: "osint",
      source: row.tool,
      rawText: [`${row.tool} found ${hits.length} account(s) for ${row.targetType === "username" ? "@" : ""}${row.target}`]
        .concat(hits.map(h => `• ${h.site}${h.url ? `: ${h.url}` : ""}`))
        .join("\n"),
      data: result ?? [],
      applicableSocialAccountIds: row.socialAccountId ? [row.socialAccountId] : [],
      applicablePeopleIds: personId ? [personId] : [],
      createdByUserId: ownerUserId,
      visibility: account?.visibility ?? person?.visibility ?? "public",
    });
  } catch (err) {
    log(`[OsintScan] Failed to create insight for scan ${row.id}: ${errorMessage(err)}`);
  }
}

/** Check one in-flight scan. Returns true while it is still running on PRM-compute. */
async function poll(cfg: OsintConfig, row: OsintScan): Promise<boolean> {
  const path = `/scans/${encodeURIComponent(row.computeJobId!)}`;
  const startTime = (row.startedAt ?? row.createdAt).getTime();
  if (Date.now() - startTime > JOB_TIMEOUT_MS) {
    await computeJson(cfg, path, { method: "DELETE" }).catch(() => {});
    await retryOrFail(row, "Scan timed out");
    return false;
  }
  try {
    const job = await computeJson(cfg, path);
    if (job.status === "pending" || job.status === "running") return true;
    if (job.status === "done") {
      await recordResult(row, job.result);
    } else if (job.status === "cancelled") {
      await storage.updateOsintScan(row.id, { status: "cancelled", completedAt: new Date() });
    } else {
      await retryOrFail(row, job.error ?? job.status, false);
    }
  } catch (err: any) {
    // PRM-compute unreachable: leave the row running and check again next tick.
    if (err?.status !== 404) return true;
    await retryOrFail(row, "PRM-Compute no longer has this job");
  }
  return false;
}

/** Hand one claimed row to PRM-compute. Returns false if it could not be sent. */
async function submit(cfg: OsintConfig, row: OsintScan): Promise<boolean> {
  try {
    const job = await computeJson(cfg, "/scans", {
      method: "POST",
      body: JSON.stringify({ tool: row.tool, target: row.target, target_type: row.targetType, options: row.options }),
    });
    const saved = await storage.updateOsintScan(row.id, { computeJobId: job.id });
    if (!saved) {
      // Scan was cancelled or modified while submission was in-flight; cancel on PRM-compute
      await computeJson(cfg, `/scans/${encodeURIComponent(job.id)}`, { method: "DELETE" }).catch(() => {});
      return false;
    }
    return true;
  } catch (err: any) {
    // A 4xx other than rate limiting means the request itself is bad (unknown tool, bad target).
    const rejected = err?.status >= 400 && err?.status < 500 && err?.status !== 429;
    await retryOrFail(row, errorMessage(err), !rejected);
    return false;
  }
}

/** Send pending scans to PRM-compute until MAX_IN_FLIGHT are running there. */
async function fill(cfg: OsintConfig, inFlight: number): Promise<void> {
  while (inFlight < MAX_IN_FLIGHT) {
    const row = await storage.claimNextOsintScan();
    if (!row || !await submit(cfg, row)) break;
    inFlight++;
  }
}

/** Check every running scan concurrently, then refill the free slots. */
async function tick(cfg: OsintConfig): Promise<void> {
  const running = await storage.getRunningOsintScans();
  const pollResults = await Promise.all(running.map(row => poll(cfg, row)));
  const inFlight = pollResults.filter(Boolean).length;
  await fill(cfg, inFlight);
}

// Runs one pass at a time, so a wake-up never overlaps the timed tick.
let lastRun: Promise<void> = Promise.resolve();
function runSerialized(pass: (cfg: OsintConfig) => Promise<void>): Promise<void> {
  lastRun = lastRun.then(() => runAsSystem(async () => {
    const cfg = await loadOsintConfig();
    if (isOsintConfigured(cfg)) await pass(cfg);
  })).catch(err => log(`[OsintScan] Runner error: ${errorMessage(err)}`));
  return lastRun;
}

/**
 * Send newly queued scans now instead of on the next tick. Only fills free
 * slots — polling stays on the timer to respect PRM-compute's rate limit.
 */
export function wakeOsintRunner(): void {
  void runSerialized(async cfg => fill(cfg, (await storage.getRunningOsintScans()).length));
}

export function startOsintScanRunner(): void {
  const loop = async () => {
    await runSerialized(tick);
    setTimeout(loop, TICK_MS);
  };
  const yearly = () => runAsSystem(queueYearlyOsintScans).finally(() => setTimeout(yearly, YEARLY_CHECK_MS));
  runAsSystem(() => storage.resetRunningOsintScans())
    .catch(err => log(`[OsintScan] Could not reset running rows: ${err}`))
    .finally(() => {
      setTimeout(loop, 10_000);
      setTimeout(yearly, 60_000);
    });
}
