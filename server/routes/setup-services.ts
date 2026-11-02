import type { Express } from "express";
import { storage } from "../storage";
import { listProviders, testProvider } from "../ai/provider";
import { checkPrmS3Health } from "../prm-s3";
import { db } from "../db";
import { sql, eq, or } from "drizzle-orm";
import { storyImporters } from "@shared/schema";
import { storiesServiceHeaders, storiesServiceUrl } from "../stories-scheduler";

interface ServiceHealthResult {
  ok: boolean;
  status: "online" | "degraded" | "offline" | "not_configured";
  message: string;
  details?: Record<string, any>;
}

async function checkS3(): Promise<ServiceHealthResult> {
  try {
    const s3Health = await checkPrmS3Health();
    return { ok: s3Health.ok, status: s3Health.ok ? "online" : "offline", message: s3Health.message };
  } catch (err: any) {
    return { ok: false, status: "offline", message: `PRM-S3 error: ${err.message}` };
  }
}

async function checkCompute(): Promise<ServiceHealthResult> {
  try {
    const apiUrl =
      (await storage.getAppSetting("prm_compute_api_url")) ||
      (await storage.getAppSetting("prm_face_api_url")) ||
      "";
    if (!apiUrl.trim()) {
      return { ok: false, status: "not_configured", message: "API URL not configured (default: http://localhost:8001)" };
    }
    const base = apiUrl.replace(/\/+$/, "");
    const resp = await fetch(`${base}/api/setup-status`, { signal: AbortSignal.timeout(4000) });
    if (!resp.ok) return { ok: false, status: "degraded", message: `PRM-Compute returned HTTP ${resp.status}` };
    const data = (await resp.json()) as { setup_completed?: boolean };
    return data.setup_completed
      ? { ok: true, status: "online", message: "PRM-Compute is online and configured" }
      : { ok: true, status: "degraded", message: "PRM-Compute online, API key setup required" };
  } catch (err: any) {
    return { ok: false, status: "offline", message: `Could not reach PRM-Compute: ${err.message}` };
  }
}

/**
 * Every enabled stories importer's service, via its POST /status; the worst one
 * decides. A service paused after an Instagram rate limit says until when.
 */
async function checkStories(): Promise<ServiceHealthResult> {
  const importers = await db.select().from(storyImporters).where(or(eq(storyImporters.enabled, true), eq(storyImporters.trackingEnabled, true)));
  if (importers.length === 0) return { ok: false, status: "not_configured", message: "No stories importer enabled" };
  const checks = await Promise.all(importers.map(async (importer): Promise<ServiceHealthResult> => {
    const label = importers.length > 1 ? `${importer.label}: ` : "";
    const apiUrl = storiesServiceUrl(importer);
    if (!apiUrl) return { ok: false, status: "not_configured", message: `${label}service URL not set` };
    try {
      const resp = await fetch(`${apiUrl}/status`, { method: "POST", headers: storiesServiceHeaders(importer), signal: AbortSignal.timeout(3000) });
      if (!resp.ok) return { ok: false, status: "degraded", message: `${label}service returned HTTP ${resp.status}` };
      const body = (await resp.json()) as { running?: boolean; pausedUntil?: string | null };
      if (body.pausedUntil) {
        return { ok: false, status: "degraded", message: `${label}paused: rate limit backoff until ${new Date(body.pausedUntil).toLocaleString()}` };
      }
      return { ok: true, status: "online", message: `${label}${body.running ? "online, running" : "online"}` };
    } catch (err: any) {
      return { ok: false, status: "offline", message: `${label}could not reach the service: ${err.message}` };
    }
  }));
  const rank = { offline: 0, degraded: 1, not_configured: 2, online: 3 };
  const worst = checks.reduce((a, b) => (rank[b.status] < rank[a.status] ? b : a));
  return { ...worst, message: checks.map((c) => c.message).join(" · ") };
}

export function registerSetupServicesRoutes(app: Express) {
  // The header's status dot: PRM itself (its database), S3, Compute, Stories.
  app.get("/api/status-dot", async (_req, res) => {
    const prm = db.execute(sql`select 1`).then(
      (): ServiceHealthResult => ({ ok: true, status: "online", message: "Online" }),
      (err: any): ServiceHealthResult => ({ ok: false, status: "degraded", message: `Database error: ${err.message}` }),
    );
    const stories = checkStories().catch((err: any): ServiceHealthResult => ({ ok: false, status: "offline", message: err.message }));
    const [p, s3, compute, st] = await Promise.all([prm, checkS3(), checkCompute(), stories]);
    res.json({ prm: p, s3, compute, stories: st });
  });

  // Aggregated health check for the sub-services
  app.get("/api/setup/services/health", async (req, res) => {
    try {
      const results: Record<string, ServiceHealthResult> = {
        s3: { ok: false, status: "offline", message: "Checking S3..." },
        compute: { ok: false, status: "not_configured", message: "Checking PRM-Compute..." },
        ai: { ok: false, status: "not_configured", message: "Checking AI providers..." },
        stories: { ok: false, status: "not_configured", message: "Checking PRM-stories..." },
      };

      // 1. PRM-S3 and 2. PRM Compute
      const s3Promise = checkS3().then((r) => (results.s3 = r));
      const computePromise = checkCompute().then((r) => (results.compute = r));

      // 3. AI providers (Ollama / OpenAI-compatible)
      const aiPromise = (async () => {
        try {
          const providers = await listProviders();
          if (providers.length === 0) {
            results.ai = {
              ok: false,
              status: "not_configured",
              message: "No AI provider configured (add one under Settings → Intelligence)",
            };
            return;
          }
          const checks = await Promise.all(providers.map(async (p) => ({ p, r: await testProvider(p) })));
          const online = checks.filter((c) => c.r.ok);
          results.ai = {
            ok: online.length > 0,
            status: online.length === checks.length ? "online" : online.length > 0 ? "degraded" : "offline",
            message: checks.map((c) => `${c.p.name}: ${c.r.ok ? `online (${c.r.modelCount} models)` : c.r.message}`).join(" · "),
            details: { providers: checks.length, online: online.length },
          };
        } catch (err: any) {
          results.ai = { ok: false, status: "offline", message: `Could not check AI providers: ${err.message}` };
        }
      })();

      // 4. PRM-stories
      const storiesPromise = checkStories()
        .catch((err: any): ServiceHealthResult => ({ ok: false, status: "offline", message: err.message }))
        .then((r) => (results.stories = r));

      await Promise.allSettled([s3Promise, computePromise, aiPromise, storiesPromise]);

      if (!req.isAuthenticated()) {
        for (const key of Object.keys(results)) {
          delete results[key].details;
        }
      }

      res.json(results);
    } catch (error: any) {
      console.error("Error checking services health:", error);
      res.status(500).json({ error: "Failed to test sub-services" });
    }
  });

  // Seed default starter pack for Data Types
  app.post("/api/setup/seed-data-types", async (req, res) => {
    try {
      const userCount = await storage.getUserCount();
      if (userCount > 0 && !req.isAuthenticated()) {
        return res.status(401).json({ error: "Authentication required" });
      }

      const existingRelTypes = await storage.getAllRelationshipTypes();
      const existingIntTypes = await storage.getAllInteractionTypes();
      const existingSocialTypes = await storage.getAllSocialAccountTypes();

      const created: { relationships: number; interactions: number; socialAccounts: number } = {
        relationships: 0,
        interactions: 0,
        socialAccounts: 0,
      };

      // 1. Relationship Types
      const defaultRelationships = [
        { name: "Friend", color: "#0284c7", value: 75, notes: "Close personal friend" },
        { name: "Family", color: "#e11d48", value: 90, notes: "Family member or relative" },
        { name: "Colleague", color: "#475569", value: 50, notes: "Work or professional colleague" },
        { name: "Partner", color: "#db2777", value: 100, notes: "Significant other or spouse" },
        { name: "Acquaintance", color: "#d97706", value: 30, notes: "Casual acquaintance" },
        { name: "Mentor", color: "#059669", value: 70, notes: "Mentor or advisor" },
      ];

      const existingRelNames = new Set(existingRelTypes.map((r) => r.name.toLowerCase()));
      for (const item of defaultRelationships) {
        if (!existingRelNames.has(item.name.toLowerCase())) {
          await storage.createRelationshipType(item);
          created.relationships++;
        }
      }

      // 2. Interaction Types
      const defaultInteractions = [
        { name: "In-Person Meeting", color: "#0284c7", value: 80, description: "Face-to-face meeting or hangout" },
        { name: "Coffee / Meal", color: "#d97706", value: 70, description: "Sharing a meal, drink, or coffee" },
        { name: "Phone / Video Call", color: "#059669", value: 60, description: "Voice or video conversation" },
        { name: "Text / Direct Message", color: "#7c3aed", value: 40, description: "Text messages, chat, or DMs" },
        { name: "Email", color: "#475569", value: 30, description: "Email correspondence" },
      ];

      const existingIntNames = new Set(existingIntTypes.map((i) => i.name.toLowerCase()));
      for (const item of defaultInteractions) {
        if (!existingIntNames.has(item.name.toLowerCase())) {
          await storage.createInteractionType(item);
          created.interactions++;
        }
      }

      // 3. Social Account Types
      const defaultSocials = [
        { name: "Instagram", color: "#e1306c" },
        { name: "LinkedIn", color: "#0a66c2" },
        { name: "X / Twitter", color: "#1da1f2" },
        { name: "GitHub", color: "#24292e" },
        { name: "Facebook", color: "#1877f2" },
        { name: "Bluesky", color: "#0284c7" },
      ];

      const existingSocialNames = new Set(existingSocialTypes.map((s) => s.name.toLowerCase()));
      for (const item of defaultSocials) {
        if (!existingSocialNames.has(item.name.toLowerCase())) {
          await storage.createSocialAccountType(item);
          created.socialAccounts++;
        }
      }

      res.json({
        success: true,
        created,
        totals: {
          relationships: existingRelTypes.length + created.relationships,
          interactions: existingIntTypes.length + created.interactions,
          socialAccounts: existingSocialTypes.length + created.socialAccounts,
        },
      });
    } catch (error: any) {
      console.error("Error seeding data types:", error);
      res.status(500).json({ error: error.message || "Failed to seed data types" });
    }
  });

  // Onboarding status endpoints
  app.get("/api/setup/onboarding-status", async (req, res) => {
    try {
      const completed = (await storage.getAppSetting("onboarding_completed")) === "true";
      const dismissed = (await storage.getAppSetting("onboarding_dismissed")) === "true";
      const currentStepRaw = await storage.getAppSetting("onboarding_step");
      const currentStep = currentStepRaw ? parseInt(currentStepRaw, 10) : 0;

      res.json({ completed, dismissed, currentStep });
    } catch (error: any) {
      res.status(500).json({ error: "Failed to read onboarding status" });
    }
  });

  app.post("/api/setup/onboarding-status", async (req, res) => {
    try {
      const userCount = await storage.getUserCount();
      if (userCount > 0 && !req.isAuthenticated()) {
        return res.status(401).json({ error: "Authentication required" });
      }

      const { completed, dismissed, currentStep } = req.body;
      if (typeof completed === "boolean") {
        await storage.setAppSetting("onboarding_completed", completed ? "true" : "false");
      }
      if (typeof dismissed === "boolean") {
        await storage.setAppSetting("onboarding_dismissed", dismissed ? "true" : "false");
      }
      if (typeof currentStep === "number") {
        await storage.setAppSetting("onboarding_step", currentStep.toString());
      }
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: "Failed to update onboarding status" });
    }
  });
}
