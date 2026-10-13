/**
 * AI providers (Ollama / OpenAI-compatible endpoints) and the per-task
 * (provider, model) settings that point at them.
 */
import type { Express } from "express";
import multer from "multer";
import { z } from "zod";
import { eq, ne } from "drizzle-orm";
import { db } from "../db";
import { aiChats, aiProviders, type AiProvider } from "@shared/schema";
import { storage } from "../storage";
import {
  AI_TASK_KEYS,
  AiConfigError,
  adapterFor,
  getProvider,
  getTaskSelection,
  isExternalUrl,
  isMetadataUrl,
  listProviders,
  testProvider,
  type AiTask,
} from "../ai/provider";
import { describeImage } from "../ai/describe";
import { postJson } from "../ai/http";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

/** Tasks edited on the Intelligence settings page (embedding lives under /api/vector/settings). */
const SETTINGS_TASKS = ["vision", "text", "events", "sexGuess"] as const satisfies readonly AiTask[];

const providerFields = z.object({
  name: z.string().trim().min(1),
  kind: z.enum(["ollama", "openai"]),
  baseUrl: z.string().trim().url()
    .refine((u) => /^https?:\/\//i.test(u), "Base URL must start with http:// or https://")
    .refine((u) => !isMetadataUrl(u), "Cloud metadata addresses can't be used as an AI provider"),
  authType: z.enum(["none", "basic", "bearer"]).default("none"),
  username: z.string().default(""),
  secret: z.string().default(""),
  isDefault: z.boolean().optional(),
  isExternal: z.boolean().optional(),
});

const selectionSchema = z.object({ providerId: z.string().default(""), model: z.string().default("") });

/** Never send secrets to the client. */
function toDto(p: AiProvider) {
  const { secret, ...rest } = p;
  return { ...rest, hasSecret: !!secret };
}

async function setTaskSelection(task: AiTask, sel: { providerId: string; model: string }) {
  await storage.setAppSetting(AI_TASK_KEYS[task].provider, sel.providerId);
  await storage.setAppSetting(AI_TASK_KEYS[task].model, sel.model.trim());
}

async function makeDefault(id: string) {
  await db.transaction(async (tx) => {
    await tx.update(aiProviders).set({ isDefault: false }).where(ne(aiProviders.id, id));
    await tx.update(aiProviders).set({ isDefault: true }).where(eq(aiProviders.id, id));
  });
}

/** Base URLs compared the way requests are built (trimmed, no trailing slash). */
function sameBaseUrl(a: string, b: string): boolean {
  const norm = (u: string) => u.trim().replace(/\/+$/, "").toLowerCase();
  return norm(a) === norm(b);
}

/** Human-readable places that reference a provider by id. */
async function providerUsages(id: string): Promise<string[]> {
  const usages: string[] = [];
  for (const task of Object.keys(AI_TASK_KEYS) as AiTask[]) {
    const sel = await getTaskSelection(task);
    if (sel.providerId === id && sel.model) usages.push(`${AI_TASK_KEYS[task].label} model`);
  }
  const chats = await db.select({ id: aiChats.id }).from(aiChats).where(eq(aiChats.providerId, id));
  if (chats.length) usages.push(`${chats.length} AI chat${chats.length === 1 ? "" : "s"}`);
  return usages;
}

function sendError(res: import("express").Response, error: any) {
  if (error instanceof z.ZodError) return res.status(400).json({ error: error.errors.map((e) => e.message).join("; ") });
  res.status(error instanceof AiConfigError ? 400 : 500).json({ error: error?.message ?? String(error) });
}

export function registerRoutes(app: Express): void {
  // ── Providers ──────────────────────────────────────────────────────────────

  app.get("/api/ai/providers", async (_req, res) => {
    try {
      res.json((await listProviders()).map(toDto));
    } catch (error) {
      sendError(res, error);
    }
  });

  app.post("/api/ai/providers", async (req, res) => {
    try {
      const body = providerFields.parse(req.body);
      const isFirst = (await listProviders()).length === 0;
      const [row] = await db.insert(aiProviders).values({
        ...body,
        isDefault: false,
        isExternal: body.isExternal ?? isExternalUrl(body.baseUrl),
      }).returning();
      if (isFirst || body.isDefault) await makeDefault(row.id);
      res.status(201).json(toDto((await getProvider(row.id))!));
    } catch (error) {
      sendError(res, error);
    }
  });

  app.patch("/api/ai/providers/:id", async (req, res) => {
    try {
      const existing = await getProvider(req.params.id);
      if (!existing) return res.status(404).json({ error: "Provider not found" });
      const body = providerFields.partial().parse(req.body);
      const { isDefault, secret, ...rest } = body;
      const patch: Partial<AiProvider> = { ...rest };
      if (secret) patch.secret = secret; // blank = keep the stored secret
      if (patch.authType === "none") { patch.username = ""; patch.secret = ""; }
      if (body.baseUrl && body.isExternal === undefined) patch.isExternal = isExternalUrl(body.baseUrl);
      if (Object.keys(patch).length) await db.update(aiProviders).set(patch).where(eq(aiProviders.id, existing.id));
      if (isDefault) await makeDefault(existing.id);
      res.json(toDto((await getProvider(existing.id))!));
    } catch (error) {
      sendError(res, error);
    }
  });

  app.delete("/api/ai/providers/:id", async (req, res) => {
    try {
      const existing = await getProvider(req.params.id);
      if (!existing) return res.status(404).json({ error: "Provider not found" });
      const all = await listProviders();
      if (all.length <= 1) {
        return res.status(409).json({ error: "Add another provider before deleting the last one.", usages: [] });
      }
      if (existing.isDefault) {
        return res.status(409).json({ error: "Make another provider the default before deleting this one.", usages: [] });
      }
      const usages = await providerUsages(existing.id);
      if (usages.length) {
        return res.status(409).json({ error: `${existing.name} is still used by: ${usages.join(", ")}.`, usages });
      }
      await db.delete(aiProviders).where(eq(aiProviders.id, existing.id));
      res.json({ success: true });
    } catch (error) {
      sendError(res, error);
    }
  });

  // Test unsaved form values. With `id`, a blank secret falls back to the stored
  // one, but only for the saved base URL so the secret can't be sent elsewhere.
  app.post("/api/ai/providers/test", async (req, res) => {
    try {
      const saved = typeof req.body?.id === "string" ? await getProvider(req.body.id) : undefined;
      const body = providerFields.partial().parse(req.body);
      if (saved && !body.secret && saved.secret && body.baseUrl && !sameBaseUrl(body.baseUrl, saved.baseUrl)) {
        return res.status(400).json({ error: "Re-enter the secret to test a different base URL." });
      }
      const candidate = { ...saved, ...body, secret: body.secret || saved?.secret || "", name: body.name || saved?.name || "Provider" } as AiProvider;
      if (!candidate.baseUrl || !candidate.kind) return res.status(400).json({ error: "kind and baseUrl are required" });
      res.json(await testProvider(candidate));
    } catch (error) {
      sendError(res, error);
    }
  });

  app.get("/api/ai/providers/:id/models", async (req, res) => {
    try {
      const provider = await getProvider(req.params.id);
      if (!provider) return res.status(404).json({ error: "Provider not found" });
      res.json({ models: await adapterFor(provider).listModels(provider) });
    } catch (error: any) {
      res.status(502).json({ error: error?.message ?? String(error) });
    }
  });

  // Ollama /api/show, trimmed to the fields the params demo shows.
  app.get("/api/ai/providers/:id/show", async (req, res) => {
    try {
      const provider = await getProvider(req.params.id);
      if (!provider) return res.status(404).json({ error: "Provider not found" });
      if (provider.kind !== "ollama") return res.status(400).json({ error: "Only Ollama providers support /api/show" });
      const model = typeof req.query.model === "string" ? req.query.model.trim() : "";
      if (!model) return res.status(400).json({ error: "model is required" });
      const resp = await postJson(provider, "/api/show", { model }, AbortSignal.timeout(30000));
      const { capabilities, thinking, parameters, details } = (await resp.json()) as Record<string, unknown>;
      res.json({ capabilities, thinking, parameters, details });
    } catch (error: any) {
      res.status(502).json({ error: error?.message ?? String(error) });
    }
  });

  // ── Settings ───────────────────────────────────────────────────────────────

  app.get("/api/ai/settings", async (_req, res) => {
    try {
      const get = async (k: string) => (await storage.getAppSetting(k)) ?? "";
      const selections = Object.fromEntries(
        await Promise.all(SETTINGS_TASKS.map(async (t) => [t, await getTaskSelection(t)] as const)),
      );
      const whisperApiUrl = (await get("whisper_api_url")) || process.env.WHISPER_API_URL || "";
      const whisperModel = (await get("whisper_model")) || process.env.WHISPER_MODEL || "";
      // Dictation goes to PRM-Compute's built-in Whisper when it is connected,
      // else to the external OpenAI-compatible server above.
      const computeConnected = !!(await get("prm_face_api_url")) && !!(await get("prm_face_api_key"));
      res.json({
        enabled: (await get("ai_enabled")) === "true",
        autoDescribeImages: (await get("ai_auto_describe_images")) === "true",
        visionPrompt: await get("ai_vision_prompt"),
        eventsPrompt: await get("ai_events_prompt"),
        ...selections,
        whisperApiUrl,
        whisperModel,
        whisperSource: computeConnected ? "prm-compute" : whisperApiUrl.trim() ? "external" : null,
      });
    } catch (error) {
      sendError(res, error);
    }
  });

  app.post("/api/ai/settings", async (req, res) => {
    try {
      const body = z.object({
        enabled: z.boolean().optional(),
        autoDescribeImages: z.boolean().optional(),
        visionPrompt: z.string().optional(),
        eventsPrompt: z.string().optional(),
        whisperApiUrl: z.string().optional(),
        whisperModel: z.string().optional(),
        vision: selectionSchema.optional(),
        text: selectionSchema.optional(),
        events: selectionSchema.optional(),
        sexGuess: selectionSchema.optional(),
      }).parse(req.body ?? {});
      if (body.enabled !== undefined) await storage.setAppSetting("ai_enabled", String(body.enabled));
      if (body.autoDescribeImages !== undefined) await storage.setAppSetting("ai_auto_describe_images", String(body.autoDescribeImages));
      if (body.visionPrompt !== undefined) await storage.setAppSetting("ai_vision_prompt", body.visionPrompt);
      if (body.eventsPrompt !== undefined) await storage.setAppSetting("ai_events_prompt", body.eventsPrompt);
      if (body.whisperApiUrl !== undefined) await storage.setAppSetting("whisper_api_url", body.whisperApiUrl.trim());
      if (body.whisperModel !== undefined) await storage.setAppSetting("whisper_model", body.whisperModel.trim());
      for (const task of SETTINGS_TASKS) {
        const sel = body[task];
        if (sel) await setTaskSelection(task, sel);
      }
      res.json({ success: true });
    } catch (error) {
      sendError(res, error);
    }
  });


}
