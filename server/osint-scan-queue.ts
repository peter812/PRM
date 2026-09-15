// Automatic OSINT scans of a "Me" user's network.
//
// Whenever a social account owned by a Me person is added or updated, every
// account it follows is queued for a username scan on each enabled PRM-osint
// tool. A runner drains that queue one row at a time on a slow interval so the
// OSINT endpoint is never hammered, and stores each result as an Insight.
import { storage } from "./storage";
import { runAsSystem } from "./access";
import { log } from "./vite";
import { isOsintConfigured, loadOsintConfig, osintFetch, type OsintConfig } from "./osint-client";

export const AUTO_SCAN_ENABLED_KEY = "osint_auto_scan_enabled";
export const AUTO_SCAN_TOOLS_KEY = "osint_auto_scan_tools";            // comma-separated tool slugs
export const AUTO_SCAN_INTERVAL_KEY = "osint_auto_scan_interval_seconds";

const DEFAULT_INTERVAL_SECONDS = 180;
// An account already scanned by a tool this recently is not queued again automatically.
const RESCAN_AFTER_DAYS = 30;
const MAX_ATTEMPTS = 3;
const POLL_MS = 5000;
const JOB_TIMEOUT_MS = 10 * 60 * 1000;

async function loadAutoScanSettings() {
  const [enabled, tools, interval] = await Promise.all([
    storage.getAppSetting(AUTO_SCAN_ENABLED_KEY),
    storage.getAppSetting(AUTO_SCAN_TOOLS_KEY),
    storage.getAppSetting(AUTO_SCAN_INTERVAL_KEY),
  ]);
  return {
    enabled: enabled === "true",
    tools: (tools ?? "sherlock").split(",").map(t => t.trim()).filter(Boolean),
    intervalMs: Math.max(60, parseInt(interval ?? "", 10) || DEFAULT_INTERVAL_SECONDS) * 1000,
  };
}

/** Both switches on, and something to run. */
async function autoScanReady(): Promise<{ cfg: OsintConfig; tools: string[]; intervalMs: number } | null> {
  const [cfg, settings] = await Promise.all([loadOsintConfig(), loadAutoScanSettings()]);
  if (!settings.enabled || !settings.tools.length || !isOsintConfigured(cfg)) return null;
  return { cfg, ...settings };
}

/**
 * Queue scans for the accounts `socialAccountId` follows — all of them, or just
 * `onlyTargetIds` when the caller knows which follows are new. No-op unless the
 * account belongs to a Me person and auto-scans are on. Safe to call without
 * awaiting: it never throws.
 */
export async function queueOsintScansForMeAccount(socialAccountId: string, onlyTargetIds?: string[]): Promise<void> {
  try {
    const ready = await autoScanReady();
    if (!ready) return;
    const userId = await storage.getMeUserIdForSocialAccount(socialAccountId);
    if (userId === null) return;
    const targets = onlyTargetIds ?? await storage.getFollowingIds(socialAccountId);
    const added = await storage.enqueueOsintScans(targets, ready.tools, userId, RESCAN_AFTER_DAYS);
    if (added) log(`[OsintScan] Queued ${added} scan(s) for the network of account ${socialAccountId}`);
  } catch (err) {
    log(`[OsintScan] Failed to queue scans for ${socialAccountId}: ${err instanceof Error ? err.message : err}`);
  }
}

/** Queue the network of every Me-owned account on the instance. */
export async function queueOsintScansForAllMeAccounts(): Promise<void> {
  for (const id of await storage.getMeOwnedSocialAccountIds()) {
    await queueOsintScansForMeAccount(id);
  }
}

// ── Runner ───────────────────────────────────────────────────────────────────

type OsintJob = { id: string; status: "pending" | "running" | "done" | "error" | "cancelled"; error: string | null; result: any };

async function osintJson(cfg: OsintConfig, path: string, init?: RequestInit): Promise<OsintJob> {
  const res = await osintFetch(cfg.apiUrl, cfg.apiKey, path, init);
  if (!res.ok) throw new Error(`PRM-osint returned ${res.status}: ${await res.text()}`);
  return res.json();
}

/** Submit one scan and wait for it to finish. */
async function runOsintJob(cfg: OsintConfig, tool: string, username: string): Promise<OsintJob> {
  let job = await osintJson(cfg, "/scans", {
    method: "POST",
    body: JSON.stringify({ tool, target: username, target_type: "username", options: {} }),
  });
  const deadline = Date.now() + JOB_TIMEOUT_MS;
  while (job.status === "pending" || job.status === "running") {
    if (Date.now() > deadline) throw new Error("Scan timed out");
    await new Promise(r => setTimeout(r, POLL_MS));
    job = await osintJson(cfg, `/scans/${encodeURIComponent(job.id)}`);
  }
  return job;
}

/** The tools each expose their hits under one of these keys (see osint-demo.tsx). */
function osintHits(result: any): any[] {
  const list = result?.sites ?? result?.platforms ?? result?.modules;
  return Array.isArray(list) ? list : [];
}

async function processOne(cfg: OsintConfig): Promise<void> {
  const row = await storage.claimNextOsintScan();
  if (!row) return;
  try {
    const job = await runOsintJob(cfg, row.tool, row.username);
    if (job.status !== "done") {
      await storage.updateOsintScan(row.id, { status: "failed", error: job.error ?? job.status, completedAt: new Date() });
      return;
    }
    const account = await storage.getSocialAccountById(row.socialAccountId);
    const hits = osintHits(job.result);
    await storage.createInsight({
      type: "osint",
      source: row.tool,
      rawText: [`${row.tool} found ${hits.length} account(s) for @${row.username}`]
        .concat(hits.map(h => `• ${h.site ?? h.platform ?? h.name ?? "?"}${h.url ? `: ${h.url}` : ""}`))
        .join("\n"),
      data: job.result ?? [],
      applicableSocialAccountIds: [row.socialAccountId],
      applicablePeopleIds: account?.ownerUuid ? [account.ownerUuid] : [],
      createdByUserId: row.requestedByUserId,
      visibility: account?.visibility ?? "public",
    });
    await storage.updateOsintScan(row.id, { status: "done", completedAt: new Date() });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log(`[OsintScan] ${row.tool} @${row.username} attempt ${row.attempts} failed: ${message}`);
    // Transient failures (endpoint down, timeout) get retried on a later tick.
    const giveUp = row.attempts >= MAX_ATTEMPTS;
    await storage.updateOsintScan(row.id, { status: giveUp ? "failed" : "pending", error: message, completedAt: giveUp ? new Date() : null });
  }
}

export function startOsintScanRunner(): void {
  const tick = async () => {
    let intervalMs = DEFAULT_INTERVAL_SECONDS * 1000;
    try {
      await runAsSystem(async () => {
        const ready = await autoScanReady();
        if (!ready) return;
        intervalMs = ready.intervalMs;
        await processOne(ready.cfg);
      });
    } catch (err) {
      log(`[OsintScan] Runner error: ${err instanceof Error ? err.message : err}`);
    }
    setTimeout(tick, intervalMs);
  };
  runAsSystem(() => storage.resetRunningOsintScans())
    .catch(err => log(`[OsintScan] Could not reset running rows: ${err}`))
    .finally(() => setTimeout(tick, 10_000));
}
