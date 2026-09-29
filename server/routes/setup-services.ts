import type { Express } from "express";
import { storage } from "../storage";
import { checkPrmS3Health } from "../prm-s3";
import { testVectorConnection, getVectorSetting } from "../vector";

interface ServiceHealthResult {
  ok: boolean;
  status: "online" | "degraded" | "offline" | "not_configured";
  message: string;
  details?: Record<string, any>;
}

function isSafeServiceUrl(urlStr: string): boolean {
  try {
    const u = new URL(urlStr);
    if (u.protocol !== "http:" && u.protocol !== "https:") return false;
    const host = u.hostname.toLowerCase();
    // Block cloud metadata services and link-local addresses
    if (
      host === "169.254.169.254" ||
      host === "metadata.google.internal" ||
      host === "metadata.azure.com" ||
      host.endsWith(".internal")
    ) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

export function registerSetupServicesRoutes(app: Express) {
  // Aggregated health check for all 5 sub-services
  app.get("/api/setup/services/health", async (req, res) => {
    try {
      const results: Record<string, ServiceHealthResult> = {
        s3: { ok: false, status: "offline", message: "Checking S3..." },
        compute: { ok: false, status: "not_configured", message: "Checking PRM-Compute..." },
        ollama: { ok: false, status: "not_configured", message: "Checking Ollama..." },
        vector: { ok: false, status: "not_configured", message: "Checking Vector DB..." },
        whisper: { ok: false, status: "not_configured", message: "Checking Whisper..." },
      };

      // 1. PRM-S3
      const s3Promise = (async () => {
        try {
          const s3Health = await checkPrmS3Health();
          results.s3 = {
            ok: s3Health.ok,
            status: s3Health.ok ? "online" : "offline",
            message: s3Health.message,
          };
        } catch (err: any) {
          results.s3 = {
            ok: false,
            status: "offline",
            message: `PRM-S3 error: ${err.message}`,
          };
        }
      })();

      // 2. PRM-Compute / PRM-Face
      const computePromise = (async () => {
        try {
          const apiUrl =
            (await storage.getAppSetting("prm_compute_api_url")) ||
            (await storage.getAppSetting("prm_face_api_url")) ||
            "";
          if (!apiUrl.trim()) {
            results.compute = {
              ok: false,
              status: "not_configured",
              message: "API URL not configured (default: http://localhost:8001)",
            };
            return;
          }
          const base = apiUrl.replace(/\/+$/, "");
          const resp = await fetch(`${base}/api/setup-status`, {
            signal: AbortSignal.timeout(4000),
          });
          if (resp.ok) {
            const data = (await resp.json()) as { setup_completed?: boolean };
            const isReady = !!data.setup_completed;
            results.compute = {
              ok: true,
              status: isReady ? "online" : "degraded",
              message: isReady
                ? "PRM-Compute is online and configured"
                : "PRM-Compute online, API key setup required",
            };
          } else {
            results.compute = {
              ok: false,
              status: "degraded",
              message: `PRM-Compute returned HTTP ${resp.status}`,
            };
          }
        } catch (err: any) {
          results.compute = {
            ok: false,
            status: "offline",
            message: `Could not reach PRM-Compute: ${err.message}`,
          };
        }
      })();

      // 3. Ollama
      const ollamaPromise = (async () => {
        try {
          const enabled = (await storage.getAppSetting("ollama_enabled")) === "true";
          const apiUrl = (await storage.getAppSetting("ollama_api_url")) || "";
          if (!apiUrl.trim()) {
            results.ollama = {
              ok: false,
              status: "not_configured",
              message: "Ollama URL not configured (default: http://localhost:11434)",
            };
            return;
          }
          const base = apiUrl.replace(/\/+$/, "");
          const authRequired = (await storage.getAppSetting("ollama_auth_required")) === "true";
          const headers: Record<string, string> = {};
          if (authRequired) {
            const u = (await storage.getAppSetting("ollama_username")) || "";
            const p = (await storage.getAppSetting("ollama_password")) || "";
            headers["Authorization"] = `Basic ${Buffer.from(`${u}:${p}`).toString("base64")}`;
          }

          const resp = await fetch(`${base}/api/tags`, {
            headers,
            signal: AbortSignal.timeout(4000),
          });
          if (resp.ok) {
            const data = (await resp.json()) as { models?: any[] };
            const modelCount = data.models?.length ?? 0;
            results.ollama = {
              ok: true,
              status: modelCount > 0 ? "online" : "degraded",
              message: modelCount > 0
                ? `Ollama online (${modelCount} model${modelCount === 1 ? "" : "s"} installed)`
                : "Ollama online, but no models installed yet (run: ollama pull llama3)",
              details: { modelsCount: modelCount, enabled },
            };
          } else {
            results.ollama = {
              ok: false,
              status: "degraded",
              message: `Ollama returned HTTP ${resp.status}`,
              details: { enabled },
            };
          }
        } catch (err: any) {
          results.ollama = {
            ok: false,
            status: "offline",
            message: `Could not reach Ollama: ${err.message}`,
          };
        }
      })();

      // 4. Qdrant / Vector
      const vectorPromise = (async () => {
        try {
          const enabled = (await storage.getAppSetting("vector_enabled")) === "true";
          const qdrantUrl = (await getVectorSetting("qdrant_url")) || "";
          if (!qdrantUrl.trim()) {
            results.vector = {
              ok: false,
              status: "not_configured",
              message: "Qdrant URL not configured (default: http://localhost:6333)",
            };
            return;
          }
          const res = await testVectorConnection();
          results.vector = {
            ok: res.ok,
            status: res.ok ? "online" : "offline",
            message: res.message,
            details: { enabled },
          };
        } catch (err: any) {
          results.vector = {
            ok: false,
            status: "offline",
            message: `Qdrant connection error: ${err.message}`,
          };
        }
      })();

      // 5. Whisper
      const whisperPromise = (async () => {
        try {
          const apiUrl =
            (await storage.getAppSetting("whisper_api_url")) ||
            process.env.WHISPER_API_URL ||
            "http://localhost:8000";
          const base = apiUrl.replace(/\/+$/, "");
          
          let ok = false;
          let message = "";
          
          try {
            const resp = await fetch(`${base}/health`, { signal: AbortSignal.timeout(3000) });
            if (resp.ok) {
              ok = true;
              message = "Whisper transcription service is online";
            }
          } catch {
            try {
              const resp2 = await fetch(`${base}/v1/models`, { signal: AbortSignal.timeout(3000) });
              if (resp2.ok) {
                ok = true;
                message = "Whisper transcription service is online (/v1/models)";
              }
            } catch {
              try {
                const resp3 = await fetch(`${base}/`, { signal: AbortSignal.timeout(2000) });
                if (resp3.status < 500) {
                  ok = true;
                  message = `Whisper service reachable (HTTP ${resp3.status})`;
                }
              } catch (e: any) {
                message = e.message;
              }
            }
          }

          results.whisper = {
            ok,
            status: ok ? "online" : "offline",
            message: ok ? message : `Could not reach Whisper at ${apiUrl}`,
            details: { apiUrl },
          };
        } catch (err: any) {
          results.whisper = {
            ok: false,
            status: "offline",
            message: `Whisper error: ${err.message}`,
          };
        }
      })();

      await Promise.allSettled([s3Promise, computePromise, ollamaPromise, vectorPromise, whisperPromise]);

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

  // Dedicated Whisper test endpoint
  app.post("/api/whisper/test", async (req, res) => {
    try {
      const userCount = await storage.getUserCount();
      if (userCount > 0 && !req.isAuthenticated()) {
        return res.status(401).json({ error: "Authentication required" });
      }

      const inputUrl = req.body?.apiUrl;
      if (inputUrl && !isSafeServiceUrl(inputUrl)) {
        return res.status(400).json({ ok: false, message: "Invalid or restricted service URL." });
      }

      const apiUrl =
        inputUrl ||
        (await storage.getAppSetting("whisper_api_url")) ||
        process.env.WHISPER_API_URL ||
        "http://localhost:8000";

      if (!isSafeServiceUrl(apiUrl)) {
        return res.status(400).json({ ok: false, message: "Invalid or restricted service URL." });
      }
      const base = apiUrl.replace(/\/+$/, "");

      try {
        const resp = await fetch(`${base}/health`, { signal: AbortSignal.timeout(4000) });
        if (resp.ok) {
          return res.json({ ok: true, message: "Whisper service is online and healthy." });
        }
      } catch {}

      try {
        const resp = await fetch(`${base}/v1/models`, { signal: AbortSignal.timeout(4000) });
        if (resp.ok) {
          return res.json({ ok: true, message: "Whisper service is online (OpenAI-compatible)." });
        }
      } catch {}

      try {
        const resp = await fetch(`${base}/`, { signal: AbortSignal.timeout(3000) });
        if (resp.status < 500) {
          return res.json({ ok: true, message: `Whisper service reachable (HTTP ${resp.status}).` });
        }
      } catch (err: any) {
        return res.json({ ok: false, message: `Could not connect to Whisper: ${err.message}` });
      }

      res.json({ ok: false, message: `Could not reach Whisper service at ${apiUrl}.` });
    } catch (error: any) {
      res.status(500).json({ ok: false, message: error.message });
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
