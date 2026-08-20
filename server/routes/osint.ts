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

const OSINT_ENABLED_KEY = "osint_enabled";
const OSINT_API_URL_KEY = "osint_api_url";
const OSINT_API_KEY_KEY = "osint_api_key";

async function getOsintSetting(key: string): Promise<string | null> {
  return storage.getAppSetting(key);
}
async function setOsintSetting(key: string, value: string): Promise<void> {
  await storage.setAppSetting(key, value);
}

/**
 * Normalize a user-entered address down to just `scheme://host(:port)` — no
 * path, query, hash, or trailing slash. So the user only has to type
 * `http(s)://{ip}(:port)` and pasting something like
 * `https://1.2.3.4:8000/api/v1/` still works. Returns null if it can't be
 * parsed into a valid http(s) origin.
 */
function normalizeOsintUrl(raw: string): string | null {
  let value = raw.trim();
  if (!value) return null;
  // Assume http:// when no scheme is given so the URL parser has something to chew on.
  if (!/^https?:\/\//i.test(value)) value = `http://${value}`;
  try {
    const u = new URL(value);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    if (!u.hostname) return null;
    // u.host includes the port when one was specified, and omits it otherwise.
    return `${u.protocol}//${u.host}`;
  } catch {
    return null;
  }
}

/** Strip trailing slashes so `base + "/path"` never produces a double slash. */
function osintBase(url: string): string {
  return url.replace(/\/+$/, "");
}

type OsintConfig = { enabled: boolean; apiUrl: string; apiKey: string };

async function loadConfig(): Promise<OsintConfig> {
  const [enabled, apiUrl, apiKey] = await Promise.all([
    getOsintSetting(OSINT_ENABLED_KEY),
    getOsintSetting(OSINT_API_URL_KEY),
    getOsintSetting(OSINT_API_KEY_KEY),
  ]);
  return {
    enabled: enabled === "true",
    // Normalize on read as well, so addresses stored before URL normalization
    // (or with a stray `/api/v1` path) still resolve to a clean origin and we
    // never build `.../api/v1/api/v1/...`.
    apiUrl: apiUrl ? (normalizeOsintUrl(apiUrl) ?? apiUrl) : "",
    apiKey: apiKey ?? "",
  };
}

/** True when connectivity is turned on and both address + key are present. */
function isConfigured(cfg: OsintConfig): boolean {
  return cfg.enabled && !!cfg.apiUrl && !!cfg.apiKey;
}

/** Call the PRM-osint API with the stored key injected. */
async function osintFetch(
  apiUrl: string,
  apiKey: string,
  path: string,
  init: RequestInit = {},
  timeoutMs = 15000,
): Promise<Response> {
  return fetch(`${osintBase(apiUrl)}/api/v1${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      ...(init.headers ?? {}),
    },
    signal: AbortSignal.timeout(timeoutMs),
  });
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

  app.post("/api/osint/settings", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ error: "Not authenticated" });
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
  app.post("/api/osint/test", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ error: "Not authenticated" });
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
          error: `PRM-osint returned ${response.status}: ${body}`,
        });
      }
      const tools = await response.json();
      res.json({ ok: true, tools });
    } catch (error: any) {
      const msg = error?.name === "TimeoutError"
        ? "Connection timed out."
        : `Failed to contact PRM-osint: ${error?.message ?? error}`;
      res.status(502).json({ ok: false, error: msg });
    }
  });

  // ── Scan proxy ────────────────────────────────────────────────────────────
  // Guard used by every proxy route below.
  async function requireConfigured(res: any): Promise<OsintConfig | null> {
    const cfg = await loadConfig();
    if (!isConfigured(cfg)) {
      res.status(400).json({ error: "PRM-osint connectivity is not enabled/configured." });
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
      res.status(502).json({ error: `Failed to contact PRM-osint: ${error?.message ?? error}` });
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
      res.status(502).json({ error: `Failed to contact PRM-osint: ${error?.message ?? error}` });
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
      res.status(502).json({ error: `Failed to contact PRM-osint: ${error?.message ?? error}` });
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
      res.status(502).json({ error: `Failed to contact PRM-osint: ${error?.message ?? error}` });
    }
  });
}
