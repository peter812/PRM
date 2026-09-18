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
import { queueOsintScansForAllMeAccounts } from "../osint-scan-queue";

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

  app.post("/api/osint/scans", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ error: "Not authenticated" });
    const cfg = await requireConfigured(res);
    if (!cfg) return;
    const { tool, target, target_type, options } = req.body ?? {};
    try {
      const response = await osintFetch(cfg.apiUrl, cfg.apiKey, "/scans", {
        method: "POST",
        body: JSON.stringify({ tool, target, target_type, options: options ?? {} }),
      });
      const body = await response.text();
      res.status(response.status).type("application/json").send(body);
    } catch (error: any) {
      res.status(502).json({ error: `Failed to contact PRM-Compute: ${error?.message ?? error}` });
    }
  });

  app.get("/api/osint/scans/:id", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ error: "Not authenticated" });
    const cfg = await requireConfigured(res);
    if (!cfg) return;
    try {
      const response = await osintFetch(
        cfg.apiUrl,
        cfg.apiKey,
        `/scans/${encodeURIComponent(req.params.id)}`,
        { method: "GET" },
      );
      const body = await response.text();
      res.status(response.status).type("application/json").send(body);
    } catch (error: any) {
      res.status(502).json({ error: `Failed to contact PRM-Compute: ${error?.message ?? error}` });
    }
  });

  app.delete("/api/osint/scans/:id", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ error: "Not authenticated" });
    const cfg = await requireConfigured(res);
    if (!cfg) return;
    try {
      const response = await osintFetch(
        cfg.apiUrl,
        cfg.apiKey,
        `/scans/${encodeURIComponent(req.params.id)}`,
        { method: "DELETE" },
      );
      if (response.status === 204) return res.status(204).end();
      const body = await response.text();
      res.status(response.status).type("application/json").send(body);
    } catch (error: any) {
      res.status(502).json({ error: `Failed to contact PRM-Compute: ${error?.message ?? error}` });
    }
  });

  // ── Auto-scan queue ───────────────────────────────────────────────────────
  app.get("/api/osint/scan-queue", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ error: "Not authenticated" });
    try {
      res.json(await storage.getOsintScanQueue());
    } catch (error: any) {
      res.status(500).json({ error: `Failed to load scan queue: ${error?.message ?? error}` });
    }
  });

  // Queue the network of every Me-owned account (a one-time catch-up after
  // turning auto-scans on; new follows are queued as they happen).
  app.post("/api/osint/scan-queue/backfill", requireAdmin, async (_req, res) => {
    try {
      await queueOsintScansForAllMeAccounts();
      res.json(await storage.getOsintScanQueue());
    } catch (error: any) {
      res.status(500).json({ error: `Failed to queue scans: ${error?.message ?? error}` });
    }
  });

  app.delete("/api/osint/scan-queue", requireAdmin, async (req, res) => {
    const status = String(req.query.status ?? "");
    if (!["pending", "done", "failed"].includes(status)) {
      return res.status(400).json({ error: "status must be pending, done, or failed" });
    }
    try {
      res.json({ deleted: await storage.deleteOsintScans(status) });
    } catch (error: any) {
      res.status(500).json({ error: `Failed to clear scan queue: ${error?.message ?? error}` });
    }
  });
}
