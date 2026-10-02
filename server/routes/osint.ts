// OSINT integration route module - osint.ts
//
// Proxies the PRM-osint orchestration API (see PRM-osint/README.md) so the
// browser never sees the OSINT API key. Settings live in the shared app_settings
// store under the keys below; every request injects the key server-side.
//
// NOTE: The global "/api" auth gate lives in server/routes/auth-setup.ts, which
// is registered first and protects every /api route in all modules. The extra
// req.isAuthenticated() checks here mirror the PRM-Face integration.
import type { Express } from "express";
import { storage } from "../storage";
import { requireAdmin } from "../auth";
import {
  OSINT_ENABLED_KEY,
  OSINT_API_URL_KEY,
  OSINT_API_KEY_KEY,
  normalizeOsintUrl,
  loadOsintConfig as loadConfig,
  isOsintConfigured as isConfigured,
  osintFetch,
  type OsintConfig,
} from "../osint-client";
import { z } from "zod";
import { cancelOsintScan, queueOsintScansForAllMeAccounts, queueOsintScansForLevel, queueOsintScansForTarget, wakeOsintRunner } from "../osint-scan-queue";
import { INTEREST_LEVELS, type InterestLevel } from "@shared/interest-level";
import { OSINT_TOOLS, mergeOsintScans, type OsintResults, type OsintTargetType } from "@shared/osint-tools";
import { isAdminRole, type OsintScan } from "@shared/schema";

async function setOsintSetting(key: string, value: string): Promise<void> {
  await storage.setAppSetting(key, value);
}

export function registerRoutes(app: Express) {
  // ── Settings ──────────────────────────────────────────────────────────────
  app.get("/api/osint/settings", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ error: "Not authenticated" });
    try {
      const cfg = await loadConfig();
      res.json({ enabled: cfg.enabled, apiUrl: cfg.apiUrl, hasApiKey: !!cfg.apiKey });
    } catch (error) {
      console.error("Error fetching OSINT settings:", error);
      res.status(500).json({ error: "Failed to fetch settings" });
    }
  });

  app.post("/api/osint/settings", requireAdmin, async (req, res) => {
    const { enabled, apiUrl, apiKey } = req.body ?? {};
    try {
      if (typeof enabled === "boolean") {
        await setOsintSetting(OSINT_ENABLED_KEY, enabled ? "true" : "false");
      }
      if (typeof apiUrl === "string") {
        // Empty string clears the address; anything else must normalize to a
        // valid http(s) origin (path/slash/suffix stripped).
        if (apiUrl.trim() === "") {
          await setOsintSetting(OSINT_API_URL_KEY, "");
        } else {
          const normalized = normalizeOsintUrl(apiUrl);
          if (!normalized) {
            return res.status(400).json({
              error: "Invalid address. Use http(s)://<ip or host>(:port).",
            });
          }
          await setOsintSetting(OSINT_API_URL_KEY, normalized);
        }
      }
      // Only overwrite the key when a non-empty value is supplied, so saving the
      // form with a blank key field doesn't wipe an already-stored key.
      if (typeof apiKey === "string" && apiKey.trim()) {
        await setOsintSetting(OSINT_API_KEY_KEY, apiKey.trim());
      }
      res.json({ success: true });
    } catch (error) {
      console.error("Error saving OSINT settings:", error);
      res.status(500).json({ error: "Failed to save settings" });
    }
  });

  // Lightweight status the frontend uses to gate the demo pages/links. Returns
  // whether connectivity is enabled and fully configured — never the key.
  app.get("/api/osint/status", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ error: "Not authenticated" });
    try {
      const cfg = await loadConfig();
      res.json({ enabled: cfg.enabled, configured: isConfigured(cfg), hasApiUrl: !!cfg.apiUrl });
    } catch (error) {
      console.error("Error fetching OSINT status:", error);
      res.status(500).json({ error: "Failed to fetch status" });
    }
  });

  // Test connectivity. Uses values from the request body when provided (so the
  // user can test before saving), otherwise falls back to stored settings.
  app.post("/api/osint/test", requireAdmin, async (req, res) => {
    const stored = await loadConfig();
    // Stored address is already normalized; an unsaved one from the form is not.
    const apiUrl = (typeof req.body?.apiUrl === "string" && req.body.apiUrl.trim())
      ? normalizeOsintUrl(req.body.apiUrl)
      : stored.apiUrl;
    const apiKey = (typeof req.body?.apiKey === "string" && req.body.apiKey.trim())
      ? req.body.apiKey.trim()
      : stored.apiKey;

    if (!apiUrl) {
      return res.status(400).json({ error: "Invalid or missing address. Use http(s)://<ip or host>(:port)." });
    }
    if (!apiKey) return res.status(400).json({ error: "API key is not configured." });

    try {
      const response = await osintFetch(apiUrl, apiKey, "/tools", { method: "GET" }, 10000);
      if (!response.ok) {
        const body = await response.text();
        return res.status(response.status).json({
          ok: false,
          error: `PRM-Compute returned ${response.status}: ${body}`,
        });
      }
      const tools = await response.json();
      res.json({ ok: true, tools });
    } catch (error: any) {
      const msg = error?.name === "TimeoutError"
        ? "Connection timed out."
        : `Failed to contact PRM-Compute: ${error?.message ?? error}`;
      res.status(502).json({ ok: false, error: msg });
    }
  });

  // ── Scan proxy ────────────────────────────────────────────────────────────
  // Guard used by every proxy route below.
  async function requireConfigured(res: any): Promise<OsintConfig | null> {
    const cfg = await loadConfig();
    if (!isConfigured(cfg)) {
      res.status(400).json({ error: "PRM-Compute is not configured. Setup PRM-Compute first." });
      return null;
    }
    return cfg;
  }

  app.get("/api/osint/tools", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ error: "Not authenticated" });
    const cfg = await requireConfigured(res);
    if (!cfg) return;
    try {
      const response = await osintFetch(cfg.apiUrl, cfg.apiKey, "/tools", { method: "GET" });
      const body = await response.text();
      res.status(response.status).type("application/json").send(body);
    } catch (error: any) {
      res.status(502).json({ error: `Failed to contact PRM-Compute: ${error?.message ?? error}` });
    }
  });

  // Scans are queued in osint_scans and fed to PRM-compute by the runner
  // (osint-scan-queue.ts). Responses keep PRM-compute's job shape so the tool
  // pages can poll them the same way.
  const toJob = (row: OsintScan) => ({
    id: row.id,
    tool: row.tool,
    target: row.target,
    target_type: row.targetType,
    status: row.status === "failed" ? "error" : row.status,
    error: row.error,
    result: row.result,
    created_at: row.createdAt,
    started_at: row.startedAt,
    finished_at: row.completedAt,
  });

  const createScanSchema = z.object({
    tool: z.string().refine(t => OSINT_TOOLS.some(m => m.name === t), "Unsupported OSINT tool"),
    target_type: z.enum(["username", "email", "phone"]),
    target: z.string().trim().min(1).max(255).regex(/^[a-zA-Z0-9@._+\- ]+$/, "Invalid characters in target"),
    options: z.record(z.unknown()).optional().default({}),
  });

  app.post("/api/osint/scans", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ error: "Not authenticated" });
    const cfg = await requireConfigured(res);
    if (!cfg) return;
    const parsed = createScanSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid scan parameters" });
    }
    const { tool, target_type, options } = parsed.data;
    const target = target_type === "email" ? parsed.data.target.toLowerCase() : parsed.data.target;
    try {
      const row = await storage.createOsintScan({
        tool,
        target,
        targetType: target_type,
        options,
        requestedByUserId: req.user!.id,
      });
      if (!row) {
        return res.status(409).json({ error: "A live scan for this target and tool is already queued or running" });
      }
      wakeOsintRunner();
      res.status(202).json(toJob(row));
    } catch (error: any) {
      res.status(500).json({ error: `Failed to queue scan: ${error?.message ?? error}` });
    }
  });

  app.get("/api/osint/scans/:id", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ error: "Not authenticated" });
    const row = await storage.getOsintScan(req.params.id);
    if (!row) return res.status(404).json({ error: "Scan not found" });

    const isAdmin = isAdminRole(req.user!.role);
    const isOwner = row.requestedByUserId === req.user!.id;
    if (!isAdmin && !isOwner) {
      if (row.personId) {
        const person = await storage.getPersonById(row.personId);
        if (!person) return res.status(404).json({ error: "Scan not found" });
      } else if (row.socialAccountId) {
        const account = await storage.getSocialAccountById(row.socialAccountId);
        if (!account) return res.status(404).json({ error: "Scan not found" });
      } else {
        return res.status(403).json({ error: "Forbidden" });
      }
    }
    res.json(toJob(row));
  });

  app.delete("/api/osint/scans/:id", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ error: "Not authenticated" });
    const row = await storage.getOsintScan(req.params.id);
    if (!row) return res.status(404).json({ error: "Scan not found" });
    const isAdmin = isAdminRole(req.user!.role);
    const isOwner = row.requestedByUserId === req.user!.id;
    if (!isAdmin && !isOwner) {
      return res.status(403).json({ error: "You can only cancel your own scans" });
    }
    await cancelOsintScan(req.params.id);
    res.status(204).end();
  });

  // ── Results of known accounts and people ─────────────────────────────────
  // ?socialAccountIds=a,b → keyed by account id; ?personId=x → keyed by OSINT
  // Runs target. A target with no finished scan has no key (shown "unchecked").
  app.get("/api/osint/results", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ error: "Not authenticated" });
    try {
      const { personId, socialAccountIds } = req.query;
      let rows;
      if (typeof personId === "string") {
        if (!await storage.getPersonById(personId)) return res.status(404).json({ error: "Person not found" });
        rows = await storage.getLatestOsintScans({ personId });
      } else {
        const ids = String(socialAccountIds ?? "").split(",").filter(Boolean);
        const visible = (await storage.getSocialAccountsByIds(ids)).map(a => a.id);
        rows = await storage.getLatestOsintScans({ socialAccountIds: visible });
      }
      const byKey = new Map<string, typeof rows>();
      for (const row of rows) {
        const key = typeof personId === "string"
          ? (row.targetType === "email" ? row.target.toLowerCase() : row.target)
          : row.socialAccountId!;
        byKey.set(key, [...(byKey.get(key) ?? []), row]);
      }
      const results: Record<string, OsintResults> = {};
      byKey.forEach((scans, key) => { results[key] = mergeOsintScans(scans); });
      res.json(results);
    } catch (error: any) {
      res.status(500).json({ error: `Failed to load OSINT results: ${error?.message ?? error}` });
    }
  });

  // Run scan: { socialAccountId } scans the account's username; { personId,
  // target, targetType } scans one of the person's OSINT Runs targets.
  app.post("/api/osint/results", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ error: "Not authenticated" });
    if (!await requireConfigured(res)) return;
    const { socialAccountId, personId, target, targetType } = req.body ?? {};
    try {
      let queued: number;
      if (typeof socialAccountId === "string") {
        const account = await storage.getSocialAccountById(socialAccountId);
        if (!account) return res.status(404).json({ error: "Social account not found" });
        queued = await queueOsintScansForTarget({ socialAccountId }, account.username, "username", req.user!.id);
      } else if (typeof personId === "string" && typeof target === "string" && ["email", "phone", "username"].includes(targetType)) {
        const cleanTarget = targetType === "email" ? target.trim().toLowerCase() : target.trim();
        if (!cleanTarget) return res.status(400).json({ error: "Target cannot be empty" });
        const person = await storage.getPersonById(personId);
        if (!person) return res.status(404).json({ error: "Person not found" });

        // Validate that target exists on person to prevent arbitrary insight pollution
        const declared = new Set([
          ...(person.osintRuns?.emails ?? []),
          ...(person.osintRuns?.phones ?? []),
          ...(person.osintRuns?.usernames ?? []),
          person.email?.toLowerCase(),
          person.phone,
          ...(person.additionalEmails ?? []).map(e => e.toLowerCase()),
          ...(person.additionalPhones ?? []),
        ].filter(Boolean));
        if (!declared.has(cleanTarget)) {
          return res.status(400).json({ error: "Target is not registered for this person" });
        }
        queued = await queueOsintScansForTarget({ personId }, cleanTarget, targetType as OsintTargetType, req.user!.id);
      } else {
        return res.status(400).json({ error: "socialAccountId, or personId with target and targetType, is required" });
      }
      res.status(202).json({ queued });
    } catch (error: any) {
      res.status(500).json({ error: `Failed to queue scan: ${error?.message ?? error}` });
    }
  });

  // ── Auto-scan queue ───────────────────────────────────────────────────────
  app.get("/api/osint/scan-queue", requireAdmin, async (_req, res) => {
    try {
      const status = typeof _req.query.status === "string" && _req.query.status !== "all" ? _req.query.status : undefined;
      res.json(await storage.getOsintScans(status));
    } catch (error: any) {
      res.status(500).json({ error: `Failed to load scan queue: ${error?.message ?? error}` });
    }
  });

  // Queue the network of every Me-owned account (a one-time catch-up after
  // turning auto-scans on; new follows are queued as they happen).
  app.post("/api/osint/scan-queue/backfill", requireAdmin, async (_req, res) => {
    try {
      await queueOsintScansForAllMeAccounts();
      res.json(await storage.getOsintScans());
    } catch (error: any) {
      res.status(500).json({ error: `Failed to queue scans: ${error?.message ?? error}` });
    }
  });

  // Tracking page: every account the caller can see at { level } or above.
  app.post("/api/osint/scan-queue/level", requireAdmin, async (req, res) => {
    const level = req.body?.level;
    if (!INTEREST_LEVELS.includes(level) || level === "none") {
      return res.status(400).json({ error: "level must be a tracking level above none" });
    }
    if (!await requireConfigured(res)) return;
    try {
      res.status(202).json({ queued: await queueOsintScansForLevel(level as InterestLevel, req.user!.id) });
    } catch (error: any) {
      res.status(500).json({ error: `Failed to queue scans: ${error?.message ?? error}` });
    }
  });

  app.delete("/api/osint/scan-queue", requireAdmin, async (req, res) => {
    const status = String(req.query.status ?? "");
    if (!["pending", "done", "failed", "cancelled"].includes(status)) {
      return res.status(400).json({ error: "status must be pending, done, failed, or cancelled" });
    }
    try {
      res.json({ deleted: await storage.deleteOsintScans(status) });
    } catch (error: any) {
      res.status(500).json({ error: `Failed to clear scan queue: ${error?.message ?? error}` });
    }
  });
}
