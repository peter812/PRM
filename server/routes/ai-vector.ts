// Generated route module - ai-vector.ts
import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "../storage";
import { db } from "../db";
import { interactions, relationshipTypes, interactionTypes, people, socialNetworkChanges, socialAccountPosts, socialAccounts, aiChats, dailyNotes, sexGuessQueue, notes, photos, appKnowledge, imageQuestions, faces, messages, messageChunks, conversations, type SocialAccountWithCurrentProfile, type ExtensionSession, type AiChat, type AiChatContextEntity, type AiChatMessage, type AiToolCallTrace, type AiUserQuestion, type AiUserAnswer } from "@shared/schema";
import { AI_TOOLS, getAiToolByName, listAiToolMetadata, buildToolsArray } from "../ai-tools";
import { getPrompt } from "../prompts";
import { describePhoto } from "../ai/describe";
import { asData, DATA_TAGS_NOTE, resolveModel, chat as aiChat, adapterFor, AiConfigError, type ResolvedModel, type AiMessage, type AiToolCall } from "../ai/provider";
import crypto from "crypto";
import { z } from "zod";
import { eq, sql, isNotNull, and, inArray, lt, desc, or } from "drizzle-orm";
import {
  insertPersonSchema,
  insertNoteSchema,
  insertInteractionSchema,
  insertInteractionTypeSchema,
  insertRelationshipSchema,
  insertRelationshipTypeSchema,
  insertGroupSchema,
  insertGroupNoteSchema,
  insertUserSchema,
  insertApiKeySchema,
  insertSocialAccountSchema,
  insertSocialAccountTypeSchema,
  insertSocialAccountPostSchema,
  insertPhotoSchema,
  FAMILY_RELATIONSHIP_TYPES,
  FAMILY_RELATIONSHIP_LABELS,
  FAMILY_RELATIONSHIP_INVERSES,
  FAMILY_RELATIONSHIP_CATEGORIES,
  type FamilyRelationshipType,
} from "@shared/schema";
import multer from "multer";
import { fetchImageBuffer, uploadImage, syncFaceCropStorage } from "../prm-s3";
import {
  runFaceRecognition, runOcr, transcribeBuffer, ComputeUnreachableError, getComputeConnection,
  getAutoRecognitionSettings, setAutoRecognitionSettings, backfillCounts, runBackfill, associateProfileFaces,
  getComputeLanes, COMPUTE_LANE_KEYS, COMPUTE_LANE_MAX,
  connectFace, disassociateFace, RecognitionRequestError, FaceMergeConflictError,
  type AutoRecognitionKind, type AutoRecognitionJob, type ComputeLanes,
} from "../recognition";
import { hashPassword, requireAuth } from "../auth";
import { triggerTaskWorker, triggerImageTaskWorker, pauseTaskWorker, resumeTaskWorker, isTaskWorkerPaused, refreshImageLanes } from "../task-worker";
import { identityIsVisible, faceGroupUuid } from "../faces";
import { faceInReadablePhoto } from "./face-review";
import { scrypt, timingSafeEqual } from "crypto";
import { promisify } from "util";
import fs from "fs";
import path from "path";
import Papa from "papaparse";
import { sendApiError, ErrorCodes } from "../middleware/error-handler";
import { sseManager } from "../middleware/sse";
import {
  loadVectorConfig,
  clampConcurrency,
  buildClient,
  setVectorSetting,
  getVectorSetting,
  testVectorConnection,
  upsertDailyNoteVector,
  prepareVectorRun,
  deleteDailyNoteVector,
  syncDailyNoteInBackground,
  searchDailyNotes,
} from "../vector";
import {
  syncEntityInBackground,
  deleteEntityVector,
  searchUniversal,
  getUniversalStatus,
  startBulkSync,
  stopBulkSync,
  getBulkSyncProgress,
  loadUniversalVectorConfig,
  resyncEntity,
  removeEntityVector,
  UNIVERSAL_SOURCES,
  type RowEntityType,
  type UniversalEntityType,
} from "../vector-universal";
import { loadChunkSettings, saveChunkSettings, rechunkConversation, clearConversationChunks, resolveChunkLink } from "../message-chunks";
import { getClusteringSettings, setClusteringSettings } from "../face-clusters";
import { reindexAppKnowledge, resolveLinksInText, cleanRawLinks, APP_KNOWLEDGE_COLLECTION } from "../vector-app-knowledge";


const scryptAsync = promisify(scrypt);

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

// Flag to track if user creation is allowed (only after database reset)
let isUserCreationAllowed = false;

// NOTE: The global "/api" auth gate (and its PUBLIC_API_PATHS allowlist) lives
// in server/routes/auth-setup.ts, which is registered first and protects every
// /api route in all modules. Do not add a separate allowlist here.



// Bridge old settings functions to centralized storage layer
async function getPrmFaceSetting(key: string): Promise<string | null> {
  return storage.getAppSetting(key);
}
async function setPrmFaceSetting(key: string, value: string): Promise<void> {
  await storage.setAppSetting(key, value);
}


export function registerRoutes(app: Express) {
    // ── PRM Compute integration ──────────────────────────────────────────────────
  
    async function getPrmFaceSetting(key: string): Promise<string | null> {
      if (key === "prm_face_api_url" || key === "prm_compute_api_url") {
        const val = await storage.getAppSetting("prm_compute_api_url");
        if (val) return val;
        return storage.getAppSetting("prm_face_api_url");
      }
      if (key === "prm_face_api_key" || key === "prm_compute_api_key") {
        const val = await storage.getAppSetting("prm_compute_api_key");
        if (val) return val;
        return storage.getAppSetting("prm_face_api_key");
      }
      if (key === "prm_face_key_id" || key === "prm_compute_key_id") {
        const val = await storage.getAppSetting("prm_compute_key_id");
        if (val) return val;
        return storage.getAppSetting("prm_face_key_id");
      }
      return storage.getAppSetting(key);
    }
  
    async function setPrmFaceSetting(key: string, value: string): Promise<void> {
      await storage.setAppSetting(key, value);
      if (key === "prm_face_api_url") await storage.setAppSetting("prm_compute_api_url", value);
      if (key === "prm_compute_api_url") await storage.setAppSetting("prm_face_api_url", value);
      if (key === "prm_face_api_key") await storage.setAppSetting("prm_compute_api_key", value);
      if (key === "prm_compute_api_key") await storage.setAppSetting("prm_face_api_key", value);
      if (key === "prm_face_key_id") await storage.setAppSetting("prm_compute_key_id", value);
      if (key === "prm_compute_key_id") await storage.setAppSetting("prm_face_key_id", value);
    }
  
    /** Strip any trailing slashes so URL + "/path" never produces a double-slash. */
    function prmBase(url: string) {
      return url.replace(/\/+$/, "");
    }
  
    app.get(["/api/prm-face/settings", "/api/prm-compute/settings"], async (req, res) => {
      if (!req.isAuthenticated()) return res.status(401).json({ error: "Not authenticated" });
      try {
        const apiUrl = await getPrmFaceSetting("prm_compute_api_url") ?? "";
        const apiKey = await getPrmFaceSetting("prm_compute_api_key");
        res.json({ apiUrl, hasApiKey: !!apiKey });
      } catch (error) {
        console.error("Error fetching PRM-Compute settings:", error);
        res.status(500).json({ error: "Failed to fetch settings" });
      }
    });
  
    app.get(["/api/prm-face/reveal-key", "/api/prm-compute/reveal-key"], async (req, res) => {
      if (!req.isAuthenticated()) return res.status(401).json({ error: "Not authenticated" });
      try {
        const apiKey = await getPrmFaceSetting("prm_compute_api_key");
        if (!apiKey) return res.status(404).json({ error: "No API key configured." });
        res.json({ apiKey });
      } catch (error) {
        res.status(500).json({ error: "Failed to retrieve API key" });
      }
    });
  
    app.post(["/api/prm-face/settings", "/api/prm-compute/settings"], async (req, res) => {
      if (!req.isAuthenticated()) return res.status(401).json({ error: "Not authenticated" });
      const { apiUrl } = req.body;
      if (typeof apiUrl !== "string" || !apiUrl.trim()) {
        return res.status(400).json({ error: "apiUrl is required" });
      }
      try {
        await setPrmFaceSetting("prm_compute_api_url", apiUrl.trim());
        res.json({ success: true });
      } catch (error) {
        console.error("Error saving PRM-Compute API URL:", error);
        res.status(500).json({ error: "Failed to save API URL" });
      }
    });
  
    app.post(["/api/prm-face/generate-key", "/api/prm-compute/generate-key"], async (req, res) => {
      if (!req.isAuthenticated()) return res.status(401).json({ error: "Not authenticated" });
      const { setupCode, label } = req.body;
      if (!setupCode) return res.status(400).json({ error: "setupCode is required" });
  
      const apiUrl = await getPrmFaceSetting("prm_compute_api_url");
      if (!apiUrl) return res.status(400).json({ error: "API URL is not configured" });
  
      try {
        const params = new URLSearchParams();
        params.append("setup_code", setupCode);
        params.append("label", label || "prm-app");
  
        const response = await fetch(`${prmBase(apiUrl)}/api/get-api-key`, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: params.toString(),
        });
  
        if (!response.ok) {
          const errBody = await response.text();
          return res.status(response.status).json({ error: `PRM-Compute error: ${errBody}` });
        }
  
        const data = await response.json() as { api_key: string; key_id: string; message?: string };
        await setPrmFaceSetting("prm_compute_api_key", data.api_key);
        await setPrmFaceSetting("prm_compute_key_id", data.key_id);
        await syncFaceCropStorage();
  
        res.json({ success: true, message: "API key generated and stored successfully." });
      } catch (error: any) {
        console.error("Error generating PRM-Compute API key:", error);
        res.status(500).json({ error: `Failed to contact PRM-Compute server: ${error.message}` });
      }
    });

    app.get("/api/prm-face/config", async (req, res) => {
      if (!req.isAuthenticated()) return res.status(401).json({ error: "Not authenticated" });
      const apiUrl = await getPrmFaceSetting("prm_face_api_url");
      if (!apiUrl) return res.status(400).json({ error: "PRM Compute API URL is not configured." });
      const apiKey = await getPrmFaceSetting("prm_face_api_key");
      if (!apiKey) return res.status(400).json({ error: "PRM Compute API key is not configured." });

      try {
        const response = await fetch(`${prmBase(apiUrl)}/api/face/config`, {
          headers: { "x-api-key": apiKey },
          signal: AbortSignal.timeout(10000),
        });
        if (!response.ok) {
          const body = await response.text();
          return res.status(response.status).json({ error: `PRM Compute error: ${body}` });
        }
        res.json(await response.json());
      } catch (error: any) {
        res.status(500).json({ error: `Failed to contact PRM Compute: ${error.message}` });
      }
    });

    app.post("/api/prm-face/config", async (req, res) => {
      if (!req.isAuthenticated()) return res.status(401).json({ error: "Not authenticated" });
      const apiUrl = await getPrmFaceSetting("prm_face_api_url");
      if (!apiUrl) return res.status(400).json({ error: "PRM Compute API URL is not configured." });
      const apiKey = await getPrmFaceSetting("prm_face_api_key");
      if (!apiKey) return res.status(400).json({ error: "PRM Compute API key is not configured." });

      const { maxFaces, minFaceSize, sureness, detThreshold, excludeProfileFaces, maxYaw } = req.body;
      if (maxFaces === undefined || minFaceSize === undefined || sureness === undefined) {
        return res.status(400).json({ error: "maxFaces, minFaceSize, and sureness are required." });
      }

      try {
        const response = await fetch(`${prmBase(apiUrl)}/api/face/config`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": apiKey,
          },
          body: JSON.stringify({
            max_faces: Number(maxFaces),
            min_face_size: Number(minFaceSize),
            sureness: Number(sureness),
            ...(detThreshold !== undefined && { det_threshold: Number(detThreshold) }),
            ...(excludeProfileFaces !== undefined && { exclude_profile_faces: Boolean(excludeProfileFaces) }),
            ...(maxYaw !== undefined && { max_yaw: Number(maxYaw) }),
          }),
          signal: AbortSignal.timeout(10000),
        });
        if (!response.ok) {
          const body = await response.text();
          return res.status(response.status).json({ error: `PRM Compute error: ${body}` });
        }
        res.json(await response.json());
      } catch (error: any) {
        res.status(500).json({ error: `Failed to contact PRM Compute: ${error.message}` });
      }
    });

    // Measure head pose and sharpness for stored faces that predate them (one batch per call).
    app.post("/api/prm-face/backfill-pose", async (req, res) => {
      if (!req.isAuthenticated()) return res.status(401).json({ error: "Not authenticated" });
      const apiUrl = await getPrmFaceSetting("prm_face_api_url");
      if (!apiUrl) return res.status(400).json({ error: "PRM Compute API URL is not configured." });
      const apiKey = await getPrmFaceSetting("prm_face_api_key");
      if (!apiKey) return res.status(400).json({ error: "PRM Compute API key is not configured." });

      try {
        const response = await fetch(`${prmBase(apiUrl)}/api/face/backfill-pose`, {
          method: "POST",
          headers: { "x-api-key": apiKey },
          body: new URLSearchParams({ after: String(req.body?.after ?? ""), limit: "50" }),
          signal: AbortSignal.timeout(120000),
        });
        if (!response.ok) {
          const body = await response.text();
          return res.status(response.status).json({ error: `PRM Compute error: ${body}` });
        }
        res.json(await response.json());
      } catch (error: any) {
        res.status(500).json({ error: `Failed to contact PRM Compute: ${error.message}` });
      }
    });

    // OCR / Whisper model presets: list/download the "little" and "big"
    // models and pick which one /api/ocr and /api/whisper use. Thin proxies to
    // PRM-Compute's /api/{ocr,whisper}/models and /api/{ocr,whisper}/config.
    const proxyCompute = async (
      req: any,
      res: any,
      path: string,
      init: { method?: string; body?: unknown } = {},
    ) => {
      if (!req.isAuthenticated()) return res.status(401).json({ error: "Not authenticated" });
      const apiUrl = await getPrmFaceSetting("prm_face_api_url");
      if (!apiUrl) return res.status(400).json({ error: "PRM-Compute API URL is not configured." });
      const apiKey = await getPrmFaceSetting("prm_face_api_key");
      if (!apiKey) return res.status(400).json({ error: "PRM-Compute API key is not configured." });
      try {
        const response = await fetch(`${prmBase(apiUrl)}${path}`, {
          method: init.method ?? "GET",
          headers: { "x-api-key": apiKey, ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}) },
          body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
          signal: AbortSignal.timeout(10000),
        });
        if (!response.ok) {
          const body = await response.text();
          return res.status(response.status).json({ error: `PRM-Compute error: ${body}` });
        }
        res.json(await response.json());
      } catch (error: any) {
        res.status(500).json({ error: `Failed to contact PRM-Compute: ${error.message}` });
      }
    };

    for (const engine of ["ocr", "whisper"] as const) {
      app.get(`/api/prm-face/${engine}/models`, (req, res) => proxyCompute(req, res, `/api/${engine}/models`));
      app.post(`/api/prm-face/${engine}/models/:model/download`, (req, res) =>
        proxyCompute(req, res, `/api/${engine}/models/${encodeURIComponent(req.params.model)}/download`, { method: "POST" }),
      );
      app.get(`/api/prm-face/${engine}/config`, (req, res) => proxyCompute(req, res, `/api/${engine}/config`));
      app.post(`/api/prm-face/${engine}/config`, (req, res) => {
        const { model } = req.body ?? {};
        if (typeof model !== "string" || !model) return res.status(400).json({ error: "model is required." });
        return proxyCompute(req, res, `/api/${engine}/config`, { method: "POST", body: { model } });
      });
    }

    // Idle model unload: PRM owns the setting (app_settings, so PRM-Compute can
    // read it from the shared DB at startup); after a change PRM pings
    // POST /api/face/idle-unload/reload so the running server picks it up
    // without a restart. Both routes answer from the saved setting even when
    // compute is offline; `loaded` is the live list of presets in memory.
    const idleUnloadSetting = async () => ({
      enabled: (await storage.getAppSetting("compute_idle_unload_enabled")) === "true",
      minutes: Number(await storage.getAppSetting("compute_idle_unload_minutes")) || 10,
    });
    const computeJson = async (path: string, method: "GET" | "POST"): Promise<{ data?: any; computeError?: string }> => {
      const apiUrl = await getPrmFaceSetting("prm_face_api_url");
      const apiKey = await getPrmFaceSetting("prm_face_api_key");
      if (!apiUrl || !apiKey) return { computeError: "PRM-Compute is not configured." };
      try {
        const response = await fetch(`${prmBase(apiUrl)}${path}`, {
          method,
          headers: { "x-api-key": apiKey },
          signal: AbortSignal.timeout(10000),
        });
        if (!response.ok) return { computeError: `PRM-Compute error: ${await response.text()}` };
        return { data: await response.json() };
      } catch (error: any) {
        return { computeError: `Failed to contact PRM-Compute: ${error.message}` };
      }
    };
    const computeIdleUnload = async (path: string, method: "GET" | "POST") => {
      const { data, computeError } = await computeJson(path, method);
      return data ? { loaded: Array.isArray(data.loaded) ? data.loaded : [] } : { loaded: null, computeError };
    };

    app.get("/api/prm-face/idle-unload", async (req, res) => {
      if (!req.isAuthenticated()) return res.status(401).json({ error: "Not authenticated" });
      res.json({ ...(await idleUnloadSetting()), ...(await computeIdleUnload("/api/face/idle-unload", "GET")) });
    });

    app.post("/api/prm-face/idle-unload", async (req, res) => {
      if (!req.isAuthenticated()) return res.status(401).json({ error: "Not authenticated" });
      const { enabled, minutes } = req.body ?? {};
      if (typeof enabled !== "boolean") return res.status(400).json({ error: "enabled must be a boolean." });
      const mins = Number(minutes);
      if (!Number.isInteger(mins) || mins < 1 || mins > 24 * 60) {
        return res.status(400).json({ error: "minutes must be a whole number between 1 and 1440." });
      }
      await storage.setAppSetting("compute_idle_unload_enabled", enabled ? "true" : "false");
      await storage.setAppSetting("compute_idle_unload_minutes", String(mins));
      res.json({ ...(await idleUnloadSetting()), ...(await computeIdleUnload("/api/face/idle-unload/reload", "POST")) });
    });

    // Parallel processing lanes: same ownership as idle unload. After a save,
    // PRM-Compute resizes its limiters (POST /api/compute/lanes/reload) and the
    // task worker picks up the new limits. `status` is compute's live
    // running/waiting counts per engine, or null when it's offline.
    app.get("/api/prm-face/lanes", async (req, res) => {
      if (!req.isAuthenticated()) return res.status(401).json({ error: "Not authenticated" });
      const { data: status = null, computeError } = await computeJson("/api/compute/status", "GET");
      res.json({ lanes: await getComputeLanes(), max: COMPUTE_LANE_MAX, status, computeError });
    });

    app.post("/api/prm-face/lanes", async (req, res) => {
      if (!req.isAuthenticated()) return res.status(401).json({ error: "Not authenticated" });
      const keys = Object.keys(COMPUTE_LANE_KEYS) as (keyof ComputeLanes)[];
      const bad = keys.find((key) => {
        const n = req.body?.[key];
        return !Number.isInteger(n) || n < 1 || n > COMPUTE_LANE_MAX[key];
      });
      if (bad) return res.status(400).json({ error: `${bad} must be a whole number between 1 and ${COMPUTE_LANE_MAX[bad]}.` });
      await Promise.all(keys.map((key) => storage.setAppSetting(COMPUTE_LANE_KEYS[key], String(req.body[key]))));
      const { data: status = null, computeError } = await computeJson("/api/compute/lanes/reload", "POST");
      res.json({ lanes: await refreshImageLanes(), max: COMPUTE_LANE_MAX, status, computeError });
    });

    // Delete all recognition-pipeline images & faces and reset PRM Compute.
    // Wipes face crops + faces rows on the PRM Compute side, then deletes pipeline
    // photos (posts/interactions/notes — NOT profile avatars) and their S3
    // files locally, and strips every face association from people and posts.
    app.post("/api/prm-face/reset-images", async (req, res) => {
      if (!req.isAuthenticated()) return res.status(401).json({ error: "Not authenticated" });
      try {
        // 1. Reset PRM Compute (best-effort). If it isn't configured or is offline
        //    we still wipe the local pipeline, and report what happened.
        let faceService: { attempted: boolean; ok: boolean; result?: any; error?: string } = {
          attempted: false,
          ok: false,
        };
        const apiUrl = await getPrmFaceSetting("prm_face_api_url");
        const apiKey = await getPrmFaceSetting("prm_face_api_key");
        if (apiUrl && apiKey) {
          faceService.attempted = true;
          try {
            const response = await fetch(`${prmBase(apiUrl)}/api/face/delete-data`, {
              method: "POST",
              headers: { "x-api-key": apiKey },
            });
            if (response.ok) {
              faceService.ok = true;
              faceService.result = await response.json();
            } else {
              faceService.error = `PRM Compute error ${response.status}: ${await response.text()}`;
            }
          } catch (err: any) {
            faceService.error = `Failed to contact PRM Compute: ${err.message}`;
          }
        }

        // 2. Reset the local recognition pipeline (photos, faces, tasks,
        //    questions, and face associations).
        const local = await storage.resetImagePipeline();

        res.json({ success: true, local, faceService });
      } catch (error: any) {
        console.error("Error resetting images & faces:", error);
        res.status(500).json({ error: `Failed to reset images & faces: ${error.message}` });
      }
    });

    app.post("/api/prm-face/img/add-interactive", upload.single("image"), async (req, res) => {
      if (!req.isAuthenticated()) return res.status(401).json({ error: "Not authenticated" });
      if (!req.file) return res.status(400).json({ error: "No image file provided" });

      try {
        const imageUrl = await uploadImage(req.file.buffer, req.file.originalname, req.file.mimetype);

        const prmLocation = (req.body?.prmLocation as string) || "unknown";
        const photo = await storage.insertPhoto({ location: imageUrl, prmLocation, isSubImage: false });

        const apiUrl = await getPrmFaceSetting("prm_face_api_url");
        const apiKey = await getPrmFaceSetting("prm_face_api_key");

        let faceDetectionData: any = { faces_detected: 0, results: [] };
        if (apiUrl && apiKey) {
          try {
            const formData = new FormData();
            formData.append("image", new Blob([req.file.buffer], { type: req.file.mimetype }), req.file.originalname || "image.jpg");
            formData.append("photo_id", photo.id);
            formData.append("max_faces", "100");

            const response = await fetch(`${prmBase(apiUrl)}/api/img/add`, {
              method: "POST",
              headers: { "X-API-Key": apiKey },
              body: formData,
              signal: AbortSignal.timeout(30000),
            });
            if (response.ok) {
              const data = await response.json();
              const detectedFaces = data.results ?? data.faces ?? [];
              faceDetectionData = {
                faces_detected: data.faces_detected ?? detectedFaces.length,
                results: detectedFaces,
                faces: detectedFaces,
                image_uuid: data.image_uuid || data.query_image_uuid,
              };
            } else {
              console.warn("PRM Compute img/add sync call failed with status:", response.status);
            }
          } catch (err: any) {
            console.error("Error communicating with PRM-face for img/add:", err.message);
          }
        }

        res.json({
          imageUrl,
          photoId: photo.id,
          faceDetection: faceDetectionData
        });
      } catch (error: any) {
        console.error("Error in add-interactive upload:", error);
        res.status(500).json({ error: error.message });
      }
    });

    app.get("/api/image-questions/pending", async (req, res) => {
      if (!req.isAuthenticated()) return res.status(401).json({ error: "Not authenticated" });
      try {
        const questions = await db.select().from(imageQuestions).where(eq(imageQuestions.status, "pending"));
        res.json(questions);
      } catch (error: any) {
        res.status(500).json({ error: error.message });
      }
    });

    app.post("/api/image-questions/resolve", async (req, res) => {
      if (!req.isAuthenticated()) return res.status(401).json({ error: "Not authenticated" });
      const { questionId, resolution, personId, name } = req.body;
      if (!questionId || !resolution) {
        return res.status(400).json({ error: "questionId and resolution are required." });
      }

      try {
        const [question] = await db.select().from(imageQuestions).where(eq(imageQuestions.id, questionId));
        if (!question) return res.status(404).json({ error: "Question not found" });

        let resolvedPersonId: string | null = null;

        if (resolution === "create_person") {
          if (!name) return res.status(400).json({ error: "Name is required for create_person resolution." });
          
          const nameParts = name.trim().split(/\s+/);
          const firstName = nameParts[0];
          const lastName = nameParts.slice(1).join(" ") || "Person";

          const [newPerson] = await db.insert(people).values({
            firstName,
            lastName,
          }).returning();
          resolvedPersonId = newPerson.id;
        } else if (resolution === "known_person") {
          if (!personId) return res.status(400).json({ error: "personId is required for known_person resolution." });
          resolvedPersonId = personId;
        } else if (resolution === "unknown") {
          resolvedPersonId = null;
        } else {
          return res.status(400).json({ error: "Invalid resolution type." });
        }

        await db.update(imageQuestions)
          .set({
            status: "resolved",
            resolvedAs: resolution,
            resolvedPersonId,
            resolvedAt: new Date(),
          })
          .where(eq(imageQuestions.id, questionId));

        const [photo] = await db.select().from(photos).where(eq(photos.id, question.photoId));
        if (photo) {
          let facialIds = (photo.facialIds as any[]) || [];
          
          facialIds = facialIds.map(f => {
            if (f.faceUuid === question.faceUuid) {
              return { ...f, personId: resolvedPersonId };
            }
            return f;
          });

          await db.update(photos)
            .set({ facialIds })
            .where(eq(photos.id, question.photoId));
        }

        const apiUrl = await getPrmFaceSetting("prm_face_api_url");
        const apiKey = await getPrmFaceSetting("prm_face_api_key");
        if (apiUrl && apiKey && resolvedPersonId) {
          try {
            const [person] = await db.select().from(people).where(eq(people.id, resolvedPersonId));
            const displayName = person ? `${person.firstName} ${person.lastName}` : (name || "");
            
            const params = new URLSearchParams();
            params.append("face_uuid", question.faceUuid);
            params.append("person_uuid", resolvedPersonId);
            params.append("name", displayName);

            const assignRes = await fetch(`${prmBase(apiUrl)}/api/face/assign`, {
              method: "POST",
              headers: { 
                "x-api-key": apiKey,
                "Content-Type": "application/x-www-form-urlencoded"
              },
              body: params.toString(),
              signal: AbortSignal.timeout(10000),
            });
            if (!assignRes.ok) {
              console.warn("[PRM Compute] failed to assign face:", await assignRes.text());
            }
          } catch (assignErr: any) {
            console.warn("[PRM Compute] assign error:", assignErr.message);
          }
        }

        const pendingQuestions = await db.select()
          .from(imageQuestions)
          .where(and(eq(imageQuestions.photoId, question.photoId), eq(imageQuestions.status, "pending")));

        let descriptionGenerated = false;
        let description = "";
        if (pendingQuestions.length === 0) {
          try {
            description = await describePhoto(question.photoId);
            descriptionGenerated = true;
          } catch (aiErr: any) {
            console.error("Error auto-describing photo:", aiErr.message);
          }
        }

        res.json({
          success: true,
          resolvedPersonId,
          descriptionGenerated,
          description,
        });
      } catch (error: any) {
        console.error("Error resolving question:", error);
        res.status(500).json({ error: error.message });
      }
    });

    app.post("/api/prm-face/photo/save-assignments", async (req, res) => {
      if (!req.isAuthenticated()) return res.status(401).json({ error: "Not authenticated" });
      const { photoId, assignments, waitDescribe } = req.body;
      if (!photoId || !Array.isArray(assignments)) {
        return res.status(400).json({ error: "photoId and assignments array are required." });
      }

      try {
        const [photo] = await db.select().from(photos).where(eq(photos.id, photoId));
        if (!photo) return res.status(404).json({ error: "Photo not found." });

        const facialIds = [];
        const apiUrl = await getPrmFaceSetting("prm_face_api_url");
        const apiKey = await getPrmFaceSetting("prm_face_api_key");

        for (const ass of assignments) {
          const { faceUuid, subImageUrl, coordinates, personId, name, resolution, socialAccountId } = ass;
          
          let resolvedPersonId = personId || null;
          if (resolution === "create_person" && name) {
            const nameParts = name.trim().split(/\s+/);
            const firstName = nameParts[0];
            const lastName = nameParts.slice(1).join(" ") || "Person";
            const [newPerson] = await db.insert(people).values({
              firstName,
              lastName,
            }).returning();
            resolvedPersonId = newPerson.id;
          }

          facialIds.push({
            faceUuid,
            subImageUrl,
            coordinates,
            personId: resolvedPersonId,
            socialAccountId: socialAccountId || null,
          });

          if (apiUrl && apiKey && resolvedPersonId) {
            try {
              const [p] = await db.select().from(people).where(eq(people.id, resolvedPersonId));
              const dName = p ? `${p.firstName} ${p.lastName}` : (name || "");
              
              const params = new URLSearchParams();
              params.append("face_uuid", faceUuid);
              params.append("person_uuid", resolvedPersonId);
              params.append("name", dName);

              await fetch(`${prmBase(apiUrl)}/api/face/assign`, {
                method: "POST",
                headers: {
                  "x-api-key": apiKey,
                  "Content-Type": "application/x-www-form-urlencoded"
                },
                body: params.toString(),
                signal: AbortSignal.timeout(10000),
              });
            } catch (err: any) {
              console.warn("Error syncing face assignment to PRM-face:", err.message);
            }
          }
        }

        await db.update(photos)
          .set({
            facialIds,
            faceIdAt: new Date(),
          })
          .where(eq(photos.id, photoId));

        let description = "";
        if (waitDescribe) {
          try {
            description = await describePhoto(photoId);
          } catch (err: any) {
            console.error("Error generating AI description:", err.message);
          }
        }

        res.json({ success: true, description });
      } catch (error: any) {
        console.error("Error saving photo assignments:", error);
        res.status(500).json({ error: error.message });
      }
    });

    app.post("/api/photos/:id/run-face-recog", async (req, res) => {
      if (!req.isAuthenticated()) return res.status(401).json({ error: "Not authenticated" });
      const { id } = req.params;

      try {
        const [photo] = await db.select({ id: photos.id }).from(photos).where(eq(photos.id, id));
        if (!photo) return res.status(404).json({ error: "Photo not found." });
        if (!(await getComputeConnection())) return res.status(400).json({ error: "PRM Compute service is not configured." });

        const { facesDetected } = await runFaceRecognition(id);
        res.json({ success: true, facesDetected });
      } catch (error: any) {
        if (error instanceof ComputeUnreachableError) {
          return res.status(503).json({ error: `${error.message}. Please check that the microservice is online and running.` });
        }
        console.error("Error in run-face-recog endpoint:", error);
        res.status(500).json({ error: error.message });
      }
    });

    app.post("/api/img/describe-llm", async (req, res) => {
      if (!req.isAuthenticated()) return res.status(401).json({ error: "Not authenticated" });
      const { photoId } = req.body;
      if (!photoId) return res.status(400).json({ error: "photoId is required" });

      try {
        const description = await describePhoto(photoId);
        res.json({ success: true, description });
      } catch (error: any) {
        console.error("Error describing image:", error);
        res.status(500).json({ error: error.message });
      }
    });
  
    app.post(["/api/prm-face/test", "/api/prm-compute/test"], async (req, res) => {
      if (!req.isAuthenticated()) return res.status(401).json({ error: "Not authenticated" });
  
      const apiUrl = await getPrmFaceSetting("prm_compute_api_url");
      if (!apiUrl) return res.json({ ok: false, message: "API URL is not configured." });
  
      try {
        const response = await fetch(`${prmBase(apiUrl)}/api/setup-status`, {
          signal: AbortSignal.timeout(8000),
        });
        if (!response.ok) {
          return res.json({ ok: false, message: `PRM-Compute responded with status ${response.status}.` });
        }
        const data = await response.json() as { setup_completed: boolean };
        const msg = data.setup_completed
          ? "PRM-Compute is online and fully set up."
          : "PRM-Compute is online but setup has not been completed yet — generate an API key first.";
        res.json({ ok: true, message: msg });
      } catch (error: any) {
        res.json({ ok: false, message: `Could not reach PRM-Compute server: ${error.message}` });
      }
    });
  
    app.get("/api/prm-face/img/detail", async (req, res) => {
      if (!req.isAuthenticated()) return res.status(401).json({ error: "Not authenticated" });
      const { uuid } = req.query as { uuid?: string };
      if (!uuid) return res.status(400).json({ error: "uuid is required" });
      const apiUrl = await getPrmFaceSetting("prm_face_api_url");
      if (!apiUrl) return res.status(400).json({ error: "PRM Compute API URL is not configured." });
      const apiKey = await getPrmFaceSetting("prm_face_api_key");
      if (!apiKey) return res.status(400).json({ error: "PRM Compute API key is not configured." });
      try {
        const response = await fetch(
          `${prmBase(apiUrl)}/api/img/get?uuid=${encodeURIComponent(uuid)}`,
          { headers: { "x-api-key": apiKey }, signal: AbortSignal.timeout(10000) }
        );
        if (!response.ok) {
          const body = await response.text();
          return res.status(response.status).json({ error: `PRM Compute error: ${body}` });
        }
        res.json(await response.json());
      } catch (error: any) {
        res.status(500).json({ error: `Failed to contact PRM Compute: ${error.message}` });
      }
    });
  
    app.get("/api/prm-face/img/detail-enriched", async (req, res) => {
      if (!req.isAuthenticated()) return res.status(401).json({ error: "Not authenticated" });
      const { uuid } = req.query as { uuid?: string };
      if (!uuid) return res.status(400).json({ error: "uuid is required" });
      const apiUrl = await getPrmFaceSetting("prm_face_api_url");
      if (!apiUrl) return res.status(400).json({ error: "PRM Compute API URL is not configured." });
      const apiKey = await getPrmFaceSetting("prm_face_api_key");
      if (!apiKey) return res.status(400).json({ error: "PRM Compute API key is not configured." });
      try {
        // 1. Fetch raw face detail from PRM-face
        const response = await fetch(
          `${prmBase(apiUrl)}/api/img/get?uuid=${encodeURIComponent(uuid)}`,
          { headers: { "x-api-key": apiKey }, signal: AbortSignal.timeout(10000) }
        );
        if (!response.ok) {
          const body = await response.text();
          return res.status(response.status).json({ error: `PRM Compute error: ${body}` });
        }
        const detail: any = await response.json();
        const rawFaces: any[] = detail?.faces ?? [];
  
        // 2. Collect unique non-null person_uuids from PRM-face
        const assignedUuids = [...new Set(rawFaces.map((f: any) => f.person_uuid).filter(Boolean))] as string[];
  
        if (assignedUuids.length === 0) {
          // No assignments stored — return as-is with enriched nulls
          return res.json({
            ...detail,
            faces: rawFaces.map((f: any) => ({
              ...f,
              person_uuid: null,
              person_name: null,
              is_social: false,
              social_username: null,
              social_nickname: null,
            })),
          });
        }
  
        // 3. Batch-lookup in PRM people and social_accounts tables in parallel
        const [matchedPeople, matchedSocials] = await Promise.all([
          db.select({ id: people.id, firstName: people.firstName, lastName: people.lastName })
            .from(people)
            .where(inArray(people.id, assignedUuids)),
          db.select({
              id: socialAccounts.id,
              username: socialAccounts.username,
              nickname: socialAccounts.nickname,
            })
            .from(socialAccounts)
            .where(inArray(socialAccounts.id, assignedUuids)),
        ]);
  
        // 4. Build lookup maps
        const peopleMap = new Map(matchedPeople.map(p => [p.id, p]));
        const socialMap = new Map(matchedSocials.map(s => [s.id, s]));
  
        // 5. Enrich each face
        const enrichedFaces = rawFaces.map((f: any) => {
          const pUuid: string | null = f.person_uuid ?? null;
          if (!pUuid) {
            return { ...f, person_uuid: null, person_name: null, is_social: false, social_username: null, social_nickname: null };
          }
  
          const person = peopleMap.get(pUuid);
          if (person) {
            return {
              ...f,
              person_uuid: pUuid,
              person_name: `${person.firstName} ${person.lastName}`.trim(),
              is_social: false,
              social_username: null,
              social_nickname: null,
            };
          }
  
          const social = socialMap.get(pUuid);
          if (social) {
            return {
              ...f,
              person_uuid: pUuid,
              person_name: social.nickname ?? `@${social.username}`,
              is_social: true,
              social_username: social.username,
              social_nickname: social.nickname ?? null,
            };
          }
  
          // UUID stored in PRM-face but no longer exists in PRM — treat as orphan
          return { ...f, person_uuid: null, person_name: null, is_social: false, social_username: null, social_nickname: null };
        });
  
        res.json({ ...detail, faces: enrichedFaces });
      } catch (error: any) {
        res.status(500).json({ error: `Failed to contact PRM Compute: ${error.message}` });
      }
    });
  
    app.post("/api/prm-face/face/assign-bulk", async (req, res) => {
      if (!req.isAuthenticated()) return res.status(401).json({ error: "Not authenticated" });
      const apiUrl = await getPrmFaceSetting("prm_face_api_url");
      if (!apiUrl) return res.status(400).json({ error: "PRM Compute API URL is not configured." });
      const apiKey = await getPrmFaceSetting("prm_face_api_key");
      if (!apiKey) return res.status(400).json({ error: "PRM Compute API key is not configured." });
      try {
        const response = await fetch(`${prmBase(apiUrl)}/api/face/assign-bulk`, {
          method: "POST",
          headers: { "x-api-key": apiKey, "Content-Type": "application/json" },
          body: JSON.stringify(req.body),
          signal: AbortSignal.timeout(15000),
        });
        if (!response.ok) {
          const body = await response.text();
          return res.status(response.status).json({ error: `PRM Compute error: ${body}` });
        }
        res.json(await response.json());
      } catch (error: any) {
        res.status(500).json({ error: `Failed to contact PRM Compute: ${error.message}` });
      }
    });
  
    app.get("/api/prm-face/face/list", async (req, res) => {
      if (!req.isAuthenticated()) return res.status(401).json({ error: "Not authenticated" });
      const apiUrl = await getPrmFaceSetting("prm_face_api_url");
      if (!apiUrl) return res.status(400).json({ error: "PRM Compute API URL is not configured." });
      const apiKey = await getPrmFaceSetting("prm_face_api_key");
      if (!apiKey) return res.status(400).json({ error: "PRM Compute API key is not configured." });
      const { page = "1", page_size = "24" } = req.query as Record<string, string>;
      try {
        const response = await fetch(
          `${prmBase(apiUrl)}/api/face/list?page=${page}&page_size=${page_size}`,
          { headers: { "x-api-key": apiKey }, signal: AbortSignal.timeout(15000) }
        );
        if (!response.ok) {
          if (response.status === 401 || response.status === 404 || response.status === 405) {
            return res.status(401).json({ error: "API_KEY_INVALID" });
          }
          const body = await response.text();
          return res.status(response.status).json({ error: `PRM Compute error: ${body}` });
        }
        res.json(await response.json());
      } catch (error: any) {
        res.status(500).json({ error: `Failed to contact PRM Compute: ${error.message}` });
      }
    });
  
    app.delete("/api/prm-face/img/delete", async (req, res) => {
      if (!req.isAuthenticated()) return res.status(401).json({ error: "Not authenticated" });
      const { image_uuid } = req.query as Record<string, string>;
      if (!image_uuid) return res.status(400).json({ error: "image_uuid is required." });
      const apiUrl = await getPrmFaceSetting("prm_face_api_url");
      if (!apiUrl) return res.status(400).json({ error: "PRM Compute API URL is not configured." });
      const apiKey = await getPrmFaceSetting("prm_face_api_key");
      if (!apiKey) return res.status(400).json({ error: "PRM Compute API key is not configured." });
      try {
        const url = new URL(`${prmBase(apiUrl)}/api/img/delete`);
        url.searchParams.set("image_uuid", image_uuid);
        const response = await fetch(url.toString(), {
          method: "DELETE",
          headers: { "x-api-key": apiKey },
          signal: AbortSignal.timeout(15000),
        });
        if (!response.ok) {
          const body = await response.text();
          return res.status(response.status).json({ error: `PRM Compute error: ${body}` });
        }
        res.json(await response.json());
      } catch (error: any) {
        res.status(500).json({ error: `Failed to contact PRM Compute: ${error.message}` });
      }
    });
  
    app.post("/api/prm-face/img/add", upload.single("image"), async (req, res) => {
      if (!req.isAuthenticated()) return res.status(401).json({ error: "Not authenticated" });
      if (!req.file) return res.status(400).json({ error: "No image provided." });
      const apiUrl = await getPrmFaceSetting("prm_face_api_url");
      if (!apiUrl) return res.status(400).json({ error: "PRM Compute API URL is not configured." });
      const apiKey = await getPrmFaceSetting("prm_face_api_key");
      if (!apiKey) return res.status(400).json({ error: "PRM Compute API key is not configured." });
      try {
        const formData = new FormData();
        formData.append("image", new Blob([req.file.buffer], { type: req.file.mimetype }), req.file.originalname || "image.jpg");
        if (req.body.max_faces) formData.append("max_faces", String(req.body.max_faces));
        const response = await fetch(`${prmBase(apiUrl)}/api/img/add`, {
          method: "POST",
          headers: { "x-api-key": apiKey },
          body: formData,
          signal: AbortSignal.timeout(30000),
        });
        if (!response.ok) {
          if (response.status === 404 || response.status === 405) {
            return res.status(401).json({ error: "API_KEY_INVALID" });
          }
          const body = await response.text();
          return res.status(response.status).json({ error: `PRM Compute error: ${body}` });
        }
        res.json(await response.json());
      } catch (error: any) {
        res.status(500).json({ error: `Failed to contact PRM Compute: ${error.message}` });
      }
    });
  
    // "Delete Face Data" on Recognition Settings: wipe faces, crops and pending
    // questions on PRM-compute, then every local face association. Photos stay.
    app.post("/api/prm-face/delete-face-data", async (req, res) => {
      if (!req.isAuthenticated()) return res.status(401).json({ error: "Not authenticated" });
  
      const apiUrl = await getPrmFaceSetting("prm_face_api_url");
      if (!apiUrl) return res.status(400).json({ error: "PRM-Compute API URL is not configured." });
      const apiKey = await getPrmFaceSetting("prm_face_api_key");
      if (!apiKey) return res.status(400).json({ error: "PRM-Compute API key is not configured." });
  
      try {
        const response = await fetch(`${prmBase(apiUrl)}/api/face/delete-data`, {
          method: "POST",
          headers: { "x-api-key": apiKey },
          signal: AbortSignal.timeout(60000),
        });
        if (!response.ok) {
          const body = await response.text();
          return res.status(response.status).json({ error: `PRM-Compute error: ${body}` });
        }
        const compute = await response.json();
        const local = await storage.clearFaceData();
        res.json({ success: true, compute, local });
      } catch (error: any) {
        res.status(500).json({ error: `Failed to delete face data: ${error.message}` });
      }
    });
  
    // ── Automatic recognition on new stories / posts / profile images ────────

    app.get("/api/recognition/auto", async (req, res) => {
      if (!req.isAuthenticated()) return res.status(401).json({ error: "Not authenticated" });
      try {
        res.json({ ...(await getAutoRecognitionSettings()), clustering: await getClusteringSettings() });
      } catch (error) {
        res.status(500).json({ error: "Failed to fetch settings" });
      }
    });

    app.post("/api/recognition/auto", async (req, res) => {
      if (!req.isAuthenticated()) return res.status(401).json({ error: "Not authenticated" });
      try {
        await setAutoRecognitionSettings(req.body ?? {});
        if (req.body?.clustering) await setClusteringSettings(req.body.clustering);
        res.json({ ...(await getAutoRecognitionSettings()), clustering: await getClusteringSettings() });
      } catch (error) {
        res.status(500).json({ error: "Failed to save settings" });
      }
    });

    app.get("/api/recognition/auto/backfill-counts", async (req, res) => {
      if (!req.isAuthenticated()) return res.status(401).json({ error: "Not authenticated" });
      try {
        res.json(await backfillCounts());
      } catch (error: any) {
        console.error("Error counting recognition backfill:", error);
        res.status(500).json({ error: error.message });
      }
    });

    const backfillBody = z.object({
      kind: z.enum(["profile", "post", "story", "message"]),
      job: z.enum(["face", "ocr", "transcribe"]),
    });
    app.post("/api/recognition/auto/backfill", async (req, res) => {
      if (!req.isAuthenticated()) return res.status(401).json({ error: "Not authenticated" });
      const parsed = backfillBody.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: "kind and job are required" });
      try {
        const queued = await runBackfill(parsed.data.kind as AutoRecognitionKind, parsed.data.job as AutoRecognitionJob);
        res.json({ queued });
      } catch (error: any) {
        console.error("Error queueing recognition backfill:", error);
        res.status(500).json({ error: error.message });
      }
    });
  
    app.post("/api/recognition/auto/associate-profile-faces", async (req, res) => {
      if (!req.isAuthenticated()) return res.status(401).json({ error: "Not authenticated" });
      try {
        res.json(await associateProfileFaces());
      } catch (error: any) {
        console.error("Error associating profile faces:", error);
        res.status(500).json({ error: error.message });
      }
    });

    // ── Query photos containing a person (by face IDs and person UUID) ──────────
  
    app.get("/api/image/query-person", async (req, res) => {
      if (!req.isAuthenticated()) return res.status(401).json({ error: "Not authenticated" });
  
      const personUuid = (req.query.personUuid as string) || (req.query.person_uuid as string);
      if (!personUuid) {
        return res.status(400).json({ error: "personUuid is required" });
      }
  
      const page = parseInt((req.query.page as string) ?? "1", 10);
      const pageSize = parseInt((req.query.page_size as string) ?? "24", 10);
  
      try {
        // 1. Retrieve the local person record
        const [person] = await db.select().from(people).where(eq(people.id, personUuid));
        if (!person) {
          return res.status(404).json({ error: "Person not found." });
        }
  
        // 2. Gather face IDs associated with this person locally
        const personfaceUuids = [person.id];
        if (person.personfaceUuid) {
          personfaceUuids.push(person.personfaceUuid);
        }
  
        const personFaces = await db.select()
          .from(faces)
          .where(inArray(faces.personfaceUuid, personfaceUuids));
        const localFaceIds = personFaces.map(f => f.id);
  
        // 3. Gather face IDs from the external PRM Compute API if configured
        let apiFaceIds: string[] = [];
        const apiUrl = await getPrmFaceSetting("prm_face_api_url");
        const apiKey = await getPrmFaceSetting("prm_face_api_key");

        if (apiUrl && apiKey) {
          try {
            const response = await fetch(
              `${prmBase(apiUrl)}/api/face/list?page=${page}&page_size=${pageSize}&person_uuid=${encodeURIComponent(personUuid)}`,
              { headers: { "x-api-key": apiKey }, signal: AbortSignal.timeout(15000) }
            );
            if (response.ok) {
              const data = await response.json() as { faces?: any[] };
              const facesList = data.faces ?? [];
              apiFaceIds = facesList
                .filter(f => f.face_uuid && f.person_uuid === personUuid)
                .map(f => f.face_uuid);
            }
          } catch (err: any) {
            console.warn("[PRM Compute] failed to fetch faces from external API:", err.message);
          }
        }
  
        // 4. Combine and deduplicate face IDs
        const allFaceIds = [...new Set([...localFaceIds, ...apiFaceIds])];
  
        // 5. Build conditions to query the photos table
        const conditions = [];
        for (const fid of allFaceIds) {
          conditions.push(sql`${photos.faceUuids} @> ${JSON.stringify([{ faceUuid: fid }])}::jsonb`);
          conditions.push(sql`${photos.facialIds} @> ${JSON.stringify([{ faceUuid: fid }])}::jsonb`);
        }
        // Always include direct mapping to personUuid as a fallback/additional check
        conditions.push(sql`${photos.facialIds} @> ${JSON.stringify([{ personId: personUuid }])}::jsonb`);
  
        // 6. Query the photos table with pagination
        let total = 0;
        let pagedPhotos: any[] = [];
        if (conditions.length > 0) {
          const whereClause = or(...conditions);
  
          const countResult = await db
            .select({ count: sql<number>`count(*)::int` })
            .from(photos)
            .where(whereClause);
          total = countResult[0]?.count ?? 0;
  
          pagedPhotos = await db
            .select()
            .from(photos)
            .where(whereClause)
            .orderBy(desc(photos.uploadedAt))
            .limit(pageSize)
            .offset((page - 1) * pageSize);
        }
  
        // 7. Format the photos to match the expected frontend structure
        const images = pagedPhotos.map(photo => {
          const faceCount = Array.isArray(photo.faceUuids) ? photo.faceUuids.length : 0;
          return {
            image_uuid: photo.id,
            image_url: photo.location,
            thumb_url: photo.location,
            face_count: faceCount,
            post_id: photo.prmLocation.startsWith("post:") ? photo.prmLocation.slice("post:".length).trim() : null,
          };
        });
  
        res.json({
          total,
          page,
          page_size: pageSize,
          total_pages: Math.ceil(total / pageSize) || 1,
          images,
          api_url: apiUrl ? prmBase(apiUrl) : "",
        });
      } catch (error: any) {
        console.error("Error querying photos for person:", error);
        res.status(500).json({ error: `Failed to query photos: ${error.message}` });
      }
    });

  
    // ── AI Chat ────────────────────────────────────────────
  
    const MAX_CHAT_TITLE_LENGTH = 60;
    const MAX_CONTEXT_ENTITIES = 10;
  
    /** The chat's own (provider, model) when set, else the text model. */
    function resolveChatModel(chat: AiChat): Promise<ResolvedModel> {
      return resolveModel("text", { providerId: chat.providerId, model: chat.model });
    }

    /** System prompt + replayable history + the new user turn. */
    /** Pinned people/accounts are passed by reference; the model pulls the profile itself with its tools. */
    function renderContextEntities(entities: AiChatContextEntity[]): string {
      if (!entities.length) return "";
      const lines = entities.map((e) =>
        e.type === "person" ? `- Person: ${e.label} (uuid: ${e.id})` : `- Social account: ${e.label} (uuid: ${e.id})`);
      return "\n\nThis conversation is about the PRM records below. Before answering, fetch each profile with your tools " +
        "(person → person_pull, social account → get_social_account). Only pull posts, messages or relationships when the question needs them. " +
        `If those tools are unavailable, say so instead of guessing. ${DATA_TAGS_NOTE}\n${asData("pinned_records", lines.join("\n"))}`;
    }

    /** Resolve client-supplied { type, id } pins against the DB; unknown ids are dropped and labels come from the record. */
    async function resolveContextEntities(input: unknown): Promise<AiChatContextEntity[]> {
      if (!Array.isArray(input)) return [];
      const out: AiChatContextEntity[] = [];
      for (const e of input.slice(0, MAX_CONTEXT_ENTITIES)) {
        if (typeof e?.id !== "string" || out.some((o) => o.type === e.type && o.id === e.id)) continue;
        if (e.type === "person") {
          const p = await storage.getPersonById(e.id);
          if (p) out.push({ type: "person", id: p.id, label: `${p.firstName ?? ""} ${p.lastName ?? ""}`.trim() || "Unnamed person" });
        } else if (e.type === "social_account") {
          const a = await storage.getSocialAccountById(e.id);
          if (a) out.push({ type: "social_account", id: a.id, label: `@${a.username}` });
        }
      }
      return out;
    }

    async function buildChatMessages(chat: AiChat, history: any[], userMessage: AiChatMessage): Promise<AiMessage[]> {
      const baseSysMsg = (chat.systemMessage?.trim() || await getPrompt("chatSystem")) + renderContextEntities(chat.contextEntities ?? []);
      const out: AiMessage[] = [{ role: "system", content: chat.agentMode ? `${baseSysMsg}\n\n${await getPrompt("chatAgentic")}` : baseSysMsg }];
      for (const m of history) {
        if (m.role === "tool") {
          out.push({ role: "tool", name: m.tool_name || m.name, tool_call_id: m.tool_call_id, content: m.content });
        } else if (m.role === "assistant") {
          out.push({ role: "assistant", content: m.content || "", ...(m.tool_calls ? { tool_calls: m.tool_calls } : {}) });
        } else {
          out.push({ role: m.role, content: renderMessageWithAttachments(m) });
        }
      }
      out.push({ role: "user", content: renderMessageWithAttachments(userMessage) });
      return out;
    }

    function sendAiError(res: import("express").Response, err: any) {
      res.status(err instanceof AiConfigError ? 400 : 502).json({ error: err?.message ?? String(err) });
    }

    function sanitizeChatMessages(input: unknown): any[] {
      if (!Array.isArray(input)) return [];
      return input
        .filter((m) =>
          !!m && typeof m === "object" &&
          (m.role === "user" || m.role === "assistant" || m.role === "tool" || m.role === "system")
        )
        .map((m) => {
          if (m.role === "tool") {
            return {
              role: "tool",
              name: m.name,
              tool_name: m.tool_name,
              tool_call_id: m.tool_call_id,
              content: m.content || "",
            };
          }
          const out: any = { role: m.role, content: m.content || "" };
          const atts = sanitizeAttachments(m.attachments);
          if (atts.length) out.attachments = atts;
          const calls = sanitizeToolCalls(m.toolCalls);
          if (calls.length) out.toolCalls = calls;
          if (m.tool_calls) out.tool_calls = m.tool_calls;
          if (m.links) out.links = m.links;
          if (m.stopped) out.stopped = true;
          return out;
        });
    }
  
    /**
     * Messages the chat UI renders: user turns and final assistant answers. Intermediate
     * assistant turns that only carry `tool_calls` (usually empty content) stay in the DB
     * for model replay but would show up as empty bubbles.
     */
    function toClientMessages(messages: unknown): any[] {
      if (!Array.isArray(messages)) return [];
      return messages.filter(
        (m) => m?.role === "user" || (m?.role === "assistant" && !m.tool_calls?.length)
      );
    }

    function sanitizeToolCalls(input: unknown): AiToolCallTrace[] {
      if (!Array.isArray(input)) return [];
      return input
        .filter((c): c is Record<string, unknown> => !!c && typeof c === "object")
        .slice(0, 50)
        .map((c) => ({
          name: typeof c.name === "string" ? c.name.slice(0, 100) : "",
          icon: typeof c.icon === "string" ? c.icon.slice(0, 50) : "search",
          label: typeof c.label === "string" ? c.label.slice(0, 100) : "",
          args: (c.args && typeof c.args === "object" && !Array.isArray(c.args))
            ? (c.args as Record<string, unknown>)
            : {},
          summary: typeof c.summary === "string" ? c.summary.slice(0, 300) : "",
          ok: typeof c.ok === "boolean" ? c.ok : true,
        }))
        .filter((c) => c.name);
    }
  
    function sanitizeAttachments(input: unknown): { name: string; type: string; content: string }[] {
      if (!Array.isArray(input)) return [];
      const MAX_ATTACHMENT_BYTES = 256 * 1024; // 256 KB per attachment
      const MAX_ATTACHMENTS = 10;
      return input
        .filter((a): a is { name: unknown; type: unknown; content: unknown } =>
          !!a && typeof a === "object")
        .slice(0, MAX_ATTACHMENTS)
        .map((a) => {
          const name = typeof a.name === "string" ? a.name.slice(0, 200) : "attachment";
          const type = typeof a.type === "string" ? a.type.slice(0, 100) : "text/plain";
          const raw = typeof a.content === "string" ? a.content : "";
          const content = raw.length > MAX_ATTACHMENT_BYTES ? raw.slice(0, MAX_ATTACHMENT_BYTES) : raw;
          return { name, type, content };
        });
    }
  
    /** Build the text payload sent to the model for a message that has file attachments. */
    function renderMessageWithAttachments(message: AiChatMessage): string {
      if (!message.attachments || message.attachments.length === 0) return message.content;
      const parts: string[] = [];
      if (message.content && message.content.trim()) parts.push(message.content);
      for (const a of message.attachments) {
        parts.push(`\n--- Attached file: ${a.name} (${a.type}) ---\n${a.content}\n--- End of ${a.name} ---`);
      }
      return parts.join("\n");
    }
  
    // ── AI Tools (skills the chat LLM can invoke) ────────────────────────────
  
    /**
     * Execution mode for write tools:
     * - "off"  → write tools are never offered to the model (read-only).
     * - "auth" → write tools are offered, but every call must be approved by
     *            the user via a popup before the handler runs.
     * - "open" → write tools run with no approval (full autonomy).
     * The setting lives in app_settings under `ai_tools_execution_mode`.
     */
    type AiToolExecutionMode = "off" | "auth" | "open";
    function parseExecutionMode(v: unknown): AiToolExecutionMode {
      return v === "auth" || v === "open" ? v : "off";
    }
  
    /** Read the tool settings (master switch + per-tool toggles + write mode) from app_settings. */
    async function readAiToolSettings(): Promise<{
      enabled: boolean;
      perTool: Record<string, boolean>;
      executionMode: AiToolExecutionMode;
    }> {
      const enabledRaw = await storage.getAppSetting("ai_tools_enabled");
      const enabled = enabledRaw === null || enabledRaw === undefined ? true : enabledRaw === "true";
      const perToolRaw = await storage.getAppSetting("ai_tools_per_tool");
      let perTool: Record<string, boolean> = {};
      if (perToolRaw) {
        try {
          const parsed = JSON.parse(perToolRaw);
          if (parsed && typeof parsed === "object") {
            for (const k of Object.keys(parsed)) {
              perTool[k] = parsed[k] !== false;
            }
          }
        } catch { /* ignore */ }
      }
      // Default any unspecified tool to enabled.
      for (const t of AI_TOOLS) {
        if (!(t.name in perTool)) perTool[t.name] = true;
      }
      const modeRaw = await storage.getAppSetting("ai_tools_execution_mode");
      // Default to the most restrictive mode (off) so writes are opt-in.
      const executionMode = parseExecutionMode(modeRaw ?? "off");
      return { enabled, perTool, executionMode };
    }
  
    /** Compute the set of tool names that should be exposed for a given chat call. */
    async function activeToolNames(): Promise<{ names: Set<string>; executionMode: AiToolExecutionMode }> {
      const { enabled, perTool, executionMode } = await readAiToolSettings();
      if (!enabled) return { names: new Set(), executionMode };
      const names = new Set(
        AI_TOOLS
          // Hide write tools from the model entirely when writes are off.
          .filter((t) => (t.write ? executionMode !== "off" : true))
          .filter((t) => perTool[t.name])
          .map((t) => t.name),
      );
      return { names, executionMode };
    }
  
    app.get("/api/ai-tools", async (req, res) => {
      if (!req.isAuthenticated()) return res.status(401).json({ error: "Not authenticated" });
      res.json({ tools: listAiToolMetadata() });
    });
  
    app.get("/api/ai-tools/settings", async (req, res) => {
      if (!req.isAuthenticated()) return res.status(401).json({ error: "Not authenticated" });
      try {
        const settings = await readAiToolSettings();
        res.json(settings);
      } catch (error: any) {
        res.status(500).json({ error: error.message });
      }
    });
  
    app.post("/api/ai-tools/settings", async (req, res) => {
      if (!req.isAuthenticated()) return res.status(401).json({ error: "Not authenticated" });
      try {
        if (typeof req.body.enabled === "boolean") {
          await storage.setAppSetting("ai_tools_enabled", String(req.body.enabled));
        }
        if (typeof req.body.executionMode === "string") {
          const mode = parseExecutionMode(req.body.executionMode);
          await storage.setAppSetting("ai_tools_execution_mode", mode);
        }
        if (req.body.perTool && typeof req.body.perTool === "object") {
          const current = (await readAiToolSettings()).perTool;
          const patch = req.body.perTool as Record<string, unknown>;
          const next: Record<string, boolean> = { ...current };
          for (const k of Object.keys(patch)) {
            if (typeof patch[k] === "boolean") next[k] = patch[k] as boolean;
          }
          await storage.setAppSetting("ai_tools_per_tool", JSON.stringify(next));
        }
        const settings = await readAiToolSettings();
        res.json(settings);
      } catch (error: any) {
        res.status(500).json({ error: error.message });
      }
    });
  
    // ── Client reply bus ─────────────────────────────────────────────────────
    // The streaming chat loop sometimes has to wait on the user mid-turn: a
    // write-tool approval (executionMode === "auth") or an `ask_user` question
    // form. It registers a pending promise here keyed by id, emits a stream
    // event, and the client POSTs the reply to one of the endpoints below,
    // which resolves the promise so the loop resumes.
    type ApprovalDecision = "accept" | "reject";
    const pendingClientReplies = new Map<string, {
      resolve: (value: unknown) => void;
    }>();
  
    /** Wait for the client's reply to `id`; resolves with `onAbort` if the run is stopped first. */
    function awaitClientReply<T>(id: string, signal: AbortSignal, onAbort: T): Promise<T> {
      return new Promise((resolve) => {
        if (signal.aborted) return resolve(onAbort);
        const abort = () => {
          pendingClientReplies.delete(id);
          resolve(onAbort);
        };
        signal.addEventListener("abort", abort, { once: true });
        pendingClientReplies.set(id, {
          resolve: (value) => {
            signal.removeEventListener("abort", abort);
            resolve(value as T);
          },
        });
      });
    }

    // Chats with a tool loop in flight, keyed by chat id. POST /stop aborts the controller.
    const activeChatRuns = new Map<string, AbortController>();

    /** Register a run for `chatId`, or send 409 and return null if one is already in flight. */
    function claimChatRun(chatId: string, res: import("express").Response): AbortController | null {
      if (activeChatRuns.has(chatId)) {
        res.status(409).json({ error: "This chat is already responding." });
        return null;
      }
      const controller = new AbortController();
      activeChatRuns.set(chatId, controller);
      return controller;
    }

    app.post("/api/ai-chats/:id/stop", async (req, res) => {
      if (!req.isAuthenticated()) return res.status(401).json({ error: "Not authenticated" });
      const controller = activeChatRuns.get(req.params.id);
      if (!controller) return res.status(404).json({ error: "Chat is not running" });
      controller.abort();
      res.json({ stopped: true });
    });
  
    /** Look up + remove the pending reply for `id`, enforcing ownership. Sends the error response itself. */
    function takePendingReply(req: import("express").Request, res: import("express").Response) {
      const pending = pendingClientReplies.get(req.params.id);
      if (!pending) { res.status(404).json({ error: "request_not_found" }); return null; }
      pendingClientReplies.delete(req.params.id);
      return pending;
    }
  
    app.post("/api/ai-tools/approvals/:id", async (req, res) => {
      if (!req.isAuthenticated()) return res.status(401).json({ error: "Not authenticated" });
      const decision = req.body?.decision === "accept" ? "accept"
        : req.body?.decision === "reject" ? "reject" : null;
      if (!decision) return res.status(400).json({ error: "decision must be 'accept' or 'reject'" });
      const pending = takePendingReply(req, res);
      if (!pending) return;
      pending.resolve(decision);
      res.json({ ok: true });
    });
  
    /** Validate the `answers` body for an ask_user reply: null (skipped) or up to 3 primitive answers. */
    function sanitizeUserAnswers(raw: unknown): AiUserAnswer[] | null | undefined {
      if (raw === null) return null;
      if (!Array.isArray(raw)) return undefined;
      const out: AiUserAnswer[] = [];
      for (const a of raw.slice(0, 3)) {
        if (!a || typeof a !== "object") return undefined;
        const { question, type, answer } = a as Record<string, unknown>;
        if (typeof question !== "string" || typeof type !== "string") return undefined;
        if (!["true_false", "multiple_choice", "open_ended", "slider"].includes(type)) return undefined;
        if (answer !== null && !["boolean", "string", "number"].includes(typeof answer)) return undefined;
        out.push({
          question: question.slice(0, 300),
          type: type as AiUserAnswer["type"],
          answer: typeof answer === "string" ? answer.slice(0, 2000) : (answer as AiUserAnswer["answer"]),
        });
      }
      return out;
    }
  
    app.post("/api/ai-tools/questions/:id", async (req, res) => {
      if (!req.isAuthenticated()) return res.status(401).json({ error: "Not authenticated" });
      const answers = sanitizeUserAnswers(req.body?.answers);
      if (answers === undefined) return res.status(400).json({ error: "answers must be null or an array of {question,type,answer}" });
      const pending = takePendingReply(req, res);
      if (!pending) return;
      pending.resolve(answers);
      res.json({ ok: true });
    });
  
    type StreamingToolLoopParams = {
      res: import("express").Response;
      resolved: ResolvedModel;
      /** Initial messages array (system + history + new user). */
      initialMessages: AiMessage[];
      /** Aborted by POST /api/ai-chats/:id/stop. */
      stopSignal: AbortSignal;
    };

    /**
     * Drives the multi-step tool-calling chat, streaming each chunk
     * back to the client over the open SSE connection. Returns the final
     * assistant content + tool-call trace once the model produces a normal
     * answer (or the iteration cap is hit, or the user stops the run).
     */
    async function runStreamingChatWithTools(p: StreamingToolLoopParams): Promise<{
      assistantContent: string;
      toolCalls: AiToolCallTrace[];
      newMessages: any[];
      stopped: boolean;
    }> {
      const { res, resolved, stopSignal } = p;
      const messages: AiMessage[] = [...p.initialMessages];
      const { names: toolNames, executionMode } = await activeToolNames();
      const tools = toolNames.size > 0 ? buildToolsArray(toolNames) : undefined;
      const toolTrace: AiToolCallTrace[] = [];
  
      // Teach the model when/how to use ask_user, but only when it's offered.
      if (toolNames.has("ask_user") && messages[0]?.role === "system") {
        messages[0] = { ...messages[0], content: `${messages[0].content}\n\n${await getPrompt("chatAskUser")}` };
      }
  
      const writeLine = (obj: unknown) => {
        res.write(JSON.stringify(obj) + "\n");
        (res as any).flush?.();
      };
  
      const MAX_ITERATIONS = 30;
      // Per-iteration timeout (5 minutes total budget for the whole loop).
      // Time spent waiting on the user (approvals / questions) is excluded.
      const OVERALL_BUDGET_MS = 300000;
      let budgetRemainingMs = OVERALL_BUDGET_MS;
      let budgetStartedAt = Date.now();
      const overallController = new AbortController();
      let overallTimeout = setTimeout(() => overallController.abort(), budgetRemainingMs);
      const pauseBudget = () => {
        clearTimeout(overallTimeout);
        budgetRemainingMs = Math.max(0, budgetRemainingMs - (Date.now() - budgetStartedAt));
      };
      const resumeBudget = () => {
        budgetStartedAt = Date.now();
        overallTimeout = setTimeout(() => overallController.abort(), budgetRemainingMs);
      };
      // Stopping cancels any in-flight model stream the same way the budget timeout does.
      const onStop = () => overallController.abort();
      stopSignal.addEventListener("abort", onStop, { once: true });

      /** Push the final assistant turn and return. Every exit except a model error goes through here. */
      const finish = (content: string, stopped = false) => {
        messages.push({ role: "assistant", content });
        return {
          assistantContent: content,
          toolCalls: toolTrace,
          newMessages: messages.slice(p.initialMessages.length),
          stopped,
        };
      };

      // Identical (name + args) calls seen this run; the third repeat is refused
      // so a model stuck on the wrong tool can't burn the whole iteration cap.
      const MAX_IDENTICAL_CALLS = 2;
      const callCounts = new Map<string, number>();

      /** Wait for the client to answer (or skip) an ask_user form. Passed to tool handlers via ctx. */
      const askUser = async (questions: AiUserQuestion[]): Promise<AiUserAnswer[] | null> => {
        const id = `q_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
        writeLine({ event: "user_question_request", id, questions });
        pauseBudget();
        try {
          return await awaitClientReply<AiUserAnswer[] | null>(id, stopSignal, null);
        } finally {
          resumeBudget();
          writeLine({ event: "user_question_answered", id });
        }
      };
  
      try {
        for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
          // Per-iteration controller chained to the overall budget.
          const iterController = new AbortController();
          const onAbort = () => iterController.abort();
          overallController.signal.addEventListener("abort", onAbort);
  
          let assistantContentThisIter = "";
          const pendingToolCalls: AiToolCall[] = [];
          try {
            const stream = adapterFor(resolved.provider).chatStream(resolved.provider, {
              model: resolved.model,
              messages,
              tools,
              signal: iterController.signal,
            });
            for await (const chunk of stream) {
              if (chunk.toolCalls) {
                // Buffer tool calls; they're executed once the model's turn ends.
                pendingToolCalls.push(...chunk.toolCalls);
              } else if (chunk.content) {
                assistantContentThisIter += chunk.content;
                writeLine({ message: { role: "assistant", content: chunk.content } });
              }
            }
          } catch (err: any) {
            if (stopSignal.aborted) return finish(assistantContentThisIter, true);
            writeLine({ error: err?.message ?? String(err) });
            return { assistantContent: "", toolCalls: toolTrace, newMessages: messages.slice(p.initialMessages.length), stopped: false };
          } finally {
            overallController.signal.removeEventListener("abort", onAbort);
          }

          // Stopped mid-stream: keep the partial text, drop the half-formed tool calls.
          if (stopSignal.aborted) return finish(assistantContentThisIter, true);
          // Model produced its final answer — return.
          if (pendingToolCalls.length === 0) return finish(assistantContentThisIter);
  
          // Persist the assistant tool-call turn into the message list so
          // subsequent model calls include it.
          messages.push({
            role: "assistant",
            content: assistantContentThisIter,
            tool_calls: pendingToolCalls,
          });
  
          // Execute each tool call, emit visualization events, and append the
          // resulting tool messages.
          for (const tc of pendingToolCalls) {
            const name = tc.function?.name ?? "";
            const args = tc.function?.arguments ?? {};
            if (stopSignal.aborted) {
              // Every tool_call needs a matching tool message for the history to replay cleanly.
              messages.push({ role: "tool", name, tool_call_id: tc?.id, content: JSON.stringify({ error: "stopped_by_user" }) });
              continue;
            }
            const id = `tc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
            const def = getAiToolByName(name);
            if (!def || !toolNames.has(name)) {
              writeLine({ event: "tool_call", id, name, args, icon: "search", label: name });
              const summary = `Tool "${name}" is not available`;
              writeLine({ event: "tool_result", id, ok: false, summary });
              toolTrace.push({ name, icon: "search", label: name, args, summary, ok: false });
              messages.push({
                role: "tool",
                name,
                tool_call_id: tc?.id,
                content: JSON.stringify({ error: summary })
              });
              continue;
            }
            writeLine({ event: "tool_call", id, name: def.name, label: def.label, icon: def.icon, args });
            const callKey = `${def.name}:${JSON.stringify(args)}`;
            const priorCalls = callCounts.get(callKey) ?? 0;
            callCounts.set(callKey, priorCalls + 1);
            if (priorCalls >= MAX_IDENTICAL_CALLS) {
              const summary = `Skipped: already called ${priorCalls} times with the same arguments`;
              writeLine({ event: "tool_result", id, ok: false, summary });
              toolTrace.push({ name: def.name, icon: def.icon, label: def.label, args, summary, ok: false });
              messages.push({
                role: "tool",
                name: def.name,
                tool_call_id: tc?.id,
                content: JSON.stringify({ error: "Repeated identical call. Use the earlier result, try a different tool or arguments, or answer the user." })
              });
              continue;
            }
            // Write tools are gated by the execution mode setting.
            if (def.write) {
              if (executionMode === "off") {
                const summary = "Write tools are disabled";
                writeLine({ event: "tool_result", id, ok: false, summary });
                toolTrace.push({ name: def.name, icon: def.icon, label: def.label, args, summary, ok: false });
                messages.push({
                  role: "tool",
                  name: def.name,
                  tool_call_id: tc?.id,
                  content: JSON.stringify({ error: summary })
                });
                continue;
              }
              if (executionMode === "auth") {
                writeLine({
                  event: "tool_approval_request",
                  id,
                  name: def.name,
                  label: def.label,
                  icon: def.icon,
                  args,
                });
                pauseBudget();
                const decision = await awaitClientReply<ApprovalDecision>(id, stopSignal, "reject");
                resumeBudget();
                writeLine({ event: "tool_approval_decision", id, decision });
                if (decision === "reject") {
                  const summary = "Rejected by user";
                  writeLine({ event: "tool_result", id, ok: false, summary });
                  toolTrace.push({ name: def.name, icon: def.icon, label: def.label, args, summary, ok: false });
                  messages.push({
                    role: "tool",
                    name: def.name,
                    tool_call_id: tc?.id,
                    content: JSON.stringify({ error: "user_rejected" })
                  });
                  continue;
                }
              }
            }
            try {
              const result = await def.handler(args, { askUser, signal: stopSignal });
              writeLine({ event: "tool_result", id, ok: true, summary: result.summary });
              toolTrace.push({ name: def.name, icon: def.icon, label: def.label, args, summary: result.summary, ok: true });
              messages.push({
                role: "tool",
                name: def.name,
                tool_call_id: tc?.id,
                content: JSON.stringify(result.data)
              });
            } catch (err: any) {
              const summary = `Error: ${err?.message ?? "tool failed"}`;
              writeLine({ event: "tool_result", id, ok: false, summary });
              toolTrace.push({ name: def.name, icon: def.icon, label: def.label, args, summary, ok: false });
              messages.push({
                role: "tool",
                name: def.name,
                tool_call_id: tc?.id,
                content: JSON.stringify({ error: summary })
              });
            }
          }
          if (stopSignal.aborted) return finish("", true);
          // Loop continues; the next model call will see the tool messages.
        }

        // Iteration cap hit — emit a synthetic final answer.
        const fallback = "I reached the tool-call limit before producing a final answer. Please refine your question.";
        writeLine({ message: { role: "assistant", content: fallback } });
        return finish(fallback);
      } finally {
        clearTimeout(overallTimeout);
        stopSignal.removeEventListener("abort", onStop);
      }
    }
  
    // List all chats for the current user (most recently updated first)
    app.get("/api/ai-chats", async (req, res) => {
      if (!req.isAuthenticated()) return res.status(401).json({ error: "Not authenticated" });
      try {
        const rows = await db.query.aiChats.findMany({
          orderBy: (t, { desc }) => [desc(t.updatedAt)],
        });
        res.json(rows.map((r) => ({
          id: r.id,
          title: r.title,
          systemMessage: r.systemMessage,
          model: r.model,
          providerId: r.providerId,
          agentMode: r.agentMode,
          messageCount: toClientMessages(r.messages).length,
          createdAt: r.createdAt,
          updatedAt: r.updatedAt,
        })));
      } catch (error: any) {
        res.status(500).json({ error: error.message });
      }
    });
  
    // Get a single chat (with full message history)
    app.get("/api/ai-chats/:id", async (req, res) => {
      if (!req.isAuthenticated()) return res.status(401).json({ error: "Not authenticated" });
      try {
        const row = await db.query.aiChats.findFirst({
          where: (t, { eq }) => eq(t.id, req.params.id),
        });
        if (!row) return res.status(404).json({ error: "Chat not found" });
        res.json({ ...row, messages: toClientMessages(row.messages) });
      } catch (error: any) {
        res.status(500).json({ error: error.message });
      }
    });
  
    // Create a new chat
    app.post("/api/ai-chats", async (req, res) => {
      if (!req.isAuthenticated()) return res.status(401).json({ error: "Not authenticated" });
      try {
        const title = typeof req.body.title === "string" && req.body.title.trim() ? req.body.title.trim() : "New chat";
        const systemMessage = typeof req.body.systemMessage === "string" ? req.body.systemMessage : "";
        const model = typeof req.body.model === "string" ? req.body.model : "";
        const providerId = typeof req.body.providerId === "string" ? req.body.providerId : "";
        const agentMode = req.body.agentMode === true;
        const contextEntities = await resolveContextEntities(req.body.contextEntities);
        const [row] = await db.insert(aiChats).values({
          title,
          systemMessage,
          model,
          providerId,
          messages: [],
          agentMode,
          contextEntities,
        }).returning();
        syncEntityInBackground("ai_chat", row.id);
        res.status(201).json(row);
      } catch (error: any) {
        res.status(500).json({ error: error.message });
      }
    });
  
    // Update a chat (title, system message, and/or messages)
    app.patch("/api/ai-chats/:id", async (req, res) => {
      if (!req.isAuthenticated()) return res.status(401).json({ error: "Not authenticated" });
      try {
        const existing = await db.query.aiChats.findFirst({
          where: (t, { eq }) => eq(t.id, req.params.id),
        });
        if (!existing) return res.status(404).json({ error: "Chat not found" });
        const patch: Record<string, unknown> = { updatedAt: new Date() };
        if (typeof req.body.title === "string") patch.title = req.body.title.trim() || "New chat";
        if (typeof req.body.systemMessage === "string") patch.systemMessage = req.body.systemMessage;
        if (typeof req.body.model === "string") patch.model = req.body.model;
        if (typeof req.body.providerId === "string") patch.providerId = req.body.providerId;
        if (req.body.agentMode !== undefined) patch.agentMode = req.body.agentMode === true;
        if (req.body.messages !== undefined) patch.messages = sanitizeChatMessages(req.body.messages);
        if (req.body.contextEntities !== undefined) {
          if ((existing.messages as unknown[]).length > 0) return res.status(409).json({ error: "Context is locked after the first message" });
          patch.contextEntities = await resolveContextEntities(req.body.contextEntities);
        }
        const [row] = await db.update(aiChats).set(patch).where(eq(aiChats.id, req.params.id)).returning();
        syncEntityInBackground("ai_chat", req.params.id);
        res.json(row);
      } catch (error: any) {
        res.status(500).json({ error: error.message });
      }
    });
  
    // Delete a chat
    app.delete("/api/ai-chats/:id", async (req, res) => {
      if (!req.isAuthenticated()) return res.status(401).json({ error: "Not authenticated" });
      try {
        const existing = await db.query.aiChats.findFirst({
          where: (t, { eq }) => eq(t.id, req.params.id),
        });
        if (!existing) return res.status(404).json({ error: "Chat not found" });
        const vectorIdToDelete = existing.vectorId ?? null;
        await db.delete(aiChats).where(eq(aiChats.id, req.params.id));
        if (vectorIdToDelete) void deleteEntityVector("ai_chat", vectorIdToDelete);
        res.json({ success: true });
      } catch (error: any) {
        res.status(500).json({ error: error.message });
      }
    });

    // Delete all chats for the current user
    app.delete("/api/ai-chats", async (req, res) => {
      if (!req.isAuthenticated()) return res.status(401).json({ error: "Not authenticated" });
      try {
        const existing = await db.query.aiChats.findMany({
          columns: { id: true, vectorId: true },
        });
        await db.delete(aiChats);
        for (const row of existing) {
          if (row.vectorId) void deleteEntityVector("ai_chat", row.vectorId);
        }
        res.json({ success: true, deleted: existing.length });
      } catch (error: any) {
        res.status(500).json({ error: error.message });
      }
    });

    // Send a message in a chat and get the assistant reply (persists the conversation)
    app.post("/api/ai-chats/:id/message", async (req, res) => {
      if (!req.isAuthenticated()) return res.status(401).json({ error: "Not authenticated" });
      try {
        const message = req.body.message;
        const attachments = sanitizeAttachments(req.body.attachments);
        const hasAttachments = attachments.length > 0;
        if (typeof message !== "string" || (!message.trim() && !hasAttachments)) {
          return res.status(400).json({ error: "Message is required." });
        }
        const chat = await db.query.aiChats.findFirst({
          where: (t, { eq }) => eq(t.id, req.params.id),
        });
        if (!chat) return res.status(404).json({ error: "Chat not found" });
  
        const history = sanitizeChatMessages(chat.messages);
        const userMessage: AiChatMessage = hasAttachments
          ? { role: "user", content: message, attachments }
          : { role: "user", content: message };
  
        const aiMessages = await buildChatMessages(chat, history, userMessage);
        let assistantContent = "";
        try {
          const resolved = await resolveChatModel(chat);
          const result = await aiChat(resolved, { messages: aiMessages, signal: AbortSignal.timeout(120000) });
          assistantContent = result.content;
        } catch (err: any) {
          if (err?.name === "TimeoutError") return res.status(504).json({ error: "Request timed out after 120 seconds." });
          return sendAiError(res, err);
        }

        const resolvedLinks = await resolveLinksInText(assistantContent);
        const cleanedContent = cleanRawLinks(assistantContent, resolvedLinks);
        const assistantMessage: AiChatMessage = { role: "assistant", content: cleanedContent };
        if (resolvedLinks.length) {
          assistantMessage.links = resolvedLinks.map(l => ({ url: l.url, title: l.title }));
        }
        const updatedMessages = [...history, userMessage, assistantMessage];
  
        // Derive a title from the first user message if the chat is still untitled.
        const patch: Record<string, unknown> = { messages: updatedMessages, updatedAt: new Date() };
        if (!chat.title || chat.title === "New chat") {
          const titleSource = message.trim() || (hasAttachments ? attachments[0].name : "");
          if (titleSource) patch.title = titleSource.slice(0, MAX_CHAT_TITLE_LENGTH);
        }
        const [updated] = await db.update(aiChats).set(patch).where(eq(aiChats.id, chat.id)).returning();
        syncEntityInBackground("ai_chat", chat.id);
        res.json({ chat: { ...updated, messages: toClientMessages(updated.messages) }, assistant: assistantMessage });
      } catch (error: any) {
        res.status(500).json({ error: error.message });
      }
    });
  
    // Edit and re-run the most recent user prompt. Replaces the trailing user (and any
    // assistant reply that immediately follows it) with the new prompt and a fresh assistant reply.
    app.post("/api/ai-chats/:id/regenerate", async (req, res) => {
      if (!req.isAuthenticated()) return res.status(401).json({ error: "Not authenticated" });
      try {
        const message = req.body.message;
        const attachments = sanitizeAttachments(req.body.attachments);
        const hasAttachments = attachments.length > 0;
        if (typeof message !== "string" || (!message.trim() && !hasAttachments)) {
          return res.status(400).json({ error: "Message is required." });
        }
        const chat = await db.query.aiChats.findFirst({
          where: (t, { eq }) => eq(t.id, req.params.id),
        });
        if (!chat) return res.status(404).json({ error: "Chat not found" });
  
        const history = sanitizeChatMessages(chat.messages);
        // Drop the trailing assistant reply (if any) and the most recent user message.
        let trimmed = history.slice();
        if (trimmed.length > 0 && trimmed[trimmed.length - 1].role === "assistant") trimmed.pop();
        const lastUserIdx = (() => {
          for (let i = trimmed.length - 1; i >= 0; i--) if (trimmed[i].role === "user") return i;
          return -1;
        })();
        if (lastUserIdx === -1) {
          return res.status(400).json({ error: "No previous user message to edit." });
        }
        trimmed = trimmed.slice(0, lastUserIdx);
  
        const userMessage: AiChatMessage = hasAttachments
          ? { role: "user", content: message, attachments }
          : { role: "user", content: message };
  
        const aiMessages = await buildChatMessages(chat, trimmed, userMessage);
        let assistantContent = "";
        try {
          const resolved = await resolveChatModel(chat);
          const result = await aiChat(resolved, { messages: aiMessages, signal: AbortSignal.timeout(120000) });
          assistantContent = result.content;
        } catch (err: any) {
          if (err?.name === "TimeoutError") return res.status(504).json({ error: "Request timed out after 120 seconds." });
          return sendAiError(res, err);
        }

        const resolvedLinks = await resolveLinksInText(assistantContent);
        const cleanedContent = cleanRawLinks(assistantContent, resolvedLinks);
        const assistantMessage: AiChatMessage = { role: "assistant", content: cleanedContent };
        if (resolvedLinks.length) {
          assistantMessage.links = resolvedLinks.map(l => ({ url: l.url, title: l.title }));
        }
        const updatedMessages = [...trimmed, userMessage, assistantMessage];
        const [updated] = await db.update(aiChats)
          .set({ messages: updatedMessages, updatedAt: new Date() })
          .where(eq(aiChats.id, chat.id))
          .returning();
        syncEntityInBackground("ai_chat", chat.id);
        res.json({ chat: updated, assistant: assistantMessage });
      } catch (error: any) {
        res.status(500).json({ error: error.message });
      }
    });
  
    // Streaming version of the message endpoint — forwards model tokens as NDJSON to the client
    // in real time, then persists the fully assembled reply to the DB at the end.
    app.post("/api/ai-chats/:id/message/stream", async (req, res) => {
      if (!req.isAuthenticated()) return res.status(401).json({ error: "Not authenticated" });
      try {
        const message = req.body.message;
        const attachments = sanitizeAttachments(req.body.attachments);
        const hasAttachments = attachments.length > 0;
        if (typeof message !== "string" || (!message.trim() && !hasAttachments)) {
          return res.status(400).json({ error: "Message is required." });
        }
        const chat = await db.query.aiChats.findFirst({
          where: (t, { eq }) => eq(t.id, req.params.id),
        });
        if (!chat) return res.status(404).json({ error: "Chat not found" });
  
        let resolved: ResolvedModel;
        try {
          resolved = await resolveChatModel(chat);
        } catch (err) {
          return sendAiError(res, err);
        }

        const history = sanitizeChatMessages(chat.messages);
        const userMessage: AiChatMessage = hasAttachments
          ? { role: "user", content: message, attachments }
          : { role: "user", content: message };
  
        const aiMessages = await buildChatMessages(chat, history, userMessage);

        const run = claimChatRun(chat.id, res);
        if (!run) return;

        // text/event-stream is understood by every reverse-proxy as "do not buffer";
        // flush headers immediately so the browser opens the stream before the model replies.
        res.setHeader("Content-Type", "text/event-stream");
        res.setHeader("Cache-Control", "no-cache");
        res.setHeader("Connection", "keep-alive");
        res.setHeader("X-Accel-Buffering", "no");
        res.flushHeaders();

        const { assistantContent, toolCalls, newMessages, stopped } = await runStreamingChatWithTools({
          res,
          resolved,
          initialMessages: aiMessages,
          stopSignal: run.signal,
        }).finally(() => activeChatRuns.delete(chat.id));

        const resolvedLinks = await resolveLinksInText(assistantContent);
        const cleanedContent = cleanRawLinks(assistantContent, resolvedLinks);
        const assistantMessage: any = { role: "assistant", content: cleanedContent };
        if (toolCalls.length) assistantMessage.toolCalls = toolCalls;
        if (stopped) assistantMessage.stopped = true;
        // links is compatible with JSONB message object
        if (resolvedLinks.length) assistantMessage.links = resolvedLinks.map(l => ({ url: l.url, title: l.title }));
        
        const intermediateMessages = newMessages.slice(0, -1);
        const updatedMessages = [...history, userMessage, ...intermediateMessages, assistantMessage];
        const patch: Record<string, unknown> = { messages: updatedMessages, updatedAt: new Date() };
        if (!chat.title || chat.title === "New chat") {
          const titleSource = message.trim() || (hasAttachments ? attachments[0].name : "");
          if (titleSource) patch.title = titleSource.slice(0, MAX_CHAT_TITLE_LENGTH);
        }
        const [updated] = await db.update(aiChats).set(patch).where(eq(aiChats.id, chat.id)).returning();
        syncEntityInBackground("ai_chat", chat.id);
        res.write(JSON.stringify({ done: true, chat: { ...updated, messages: toClientMessages(updated.messages) } }) + "\n");
        res.end();
      } catch (error: any) {
        if (!res.headersSent) res.status(500).json({ error: error.message });
        else res.end();
      }
    });
  
    // Streaming version of the regenerate endpoint.
    app.post("/api/ai-chats/:id/regenerate/stream", async (req, res) => {
      if (!req.isAuthenticated()) return res.status(401).json({ error: "Not authenticated" });
      try {
        const message = req.body.message;
        const attachments = sanitizeAttachments(req.body.attachments);
        const hasAttachments = attachments.length > 0;
        if (typeof message !== "string" || (!message.trim() && !hasAttachments)) {
          return res.status(400).json({ error: "Message is required." });
        }
        const chat = await db.query.aiChats.findFirst({
          where: (t, { eq }) => eq(t.id, req.params.id),
        });
        if (!chat) return res.status(404).json({ error: "Chat not found" });
  
        const history = sanitizeChatMessages(chat.messages);
        let trimmed = history.slice();
        if (trimmed.length > 0 && trimmed[trimmed.length - 1].role === "assistant") trimmed.pop();
        const lastUserIdx = (() => {
          for (let i = trimmed.length - 1; i >= 0; i--) if (trimmed[i].role === "user") return i;
          return -1;
        })();
        if (lastUserIdx === -1) return res.status(400).json({ error: "No previous user message to edit." });
        trimmed = trimmed.slice(0, lastUserIdx);
  
        let resolved: ResolvedModel;
        try {
          resolved = await resolveChatModel(chat);
        } catch (err) {
          return sendAiError(res, err);
        }

        const userMessage: AiChatMessage = hasAttachments
          ? { role: "user", content: message, attachments }
          : { role: "user", content: message };
  
        const aiMessages = await buildChatMessages(chat, trimmed, userMessage);

        const run = claimChatRun(chat.id, res);
        if (!run) return;

        res.setHeader("Content-Type", "text/event-stream");
        res.setHeader("Cache-Control", "no-cache");
        res.setHeader("Connection", "keep-alive");
        res.setHeader("X-Accel-Buffering", "no");
        res.flushHeaders();

        const { assistantContent, toolCalls, newMessages, stopped } = await runStreamingChatWithTools({
          res,
          resolved,
          initialMessages: aiMessages,
          stopSignal: run.signal,
        }).finally(() => activeChatRuns.delete(chat.id));

        const resolvedLinks = await resolveLinksInText(assistantContent);
        const cleanedContent = cleanRawLinks(assistantContent, resolvedLinks);
        const assistantMessage: any = { role: "assistant", content: cleanedContent };
        if (toolCalls.length) assistantMessage.toolCalls = toolCalls;
        if (stopped) assistantMessage.stopped = true;
        // links is compatible with JSONB message object
        if (resolvedLinks.length) assistantMessage.links = resolvedLinks.map(l => ({ url: l.url, title: l.title }));
        
        const intermediateMessages = newMessages.slice(0, -1);
        const updatedMessages = [...trimmed, userMessage, ...intermediateMessages, assistantMessage];
        const [updated] = await db.update(aiChats)
          .set({ messages: updatedMessages, updatedAt: new Date() })
          .where(eq(aiChats.id, chat.id))
          .returning();
        syncEntityInBackground("ai_chat", chat.id);
        res.write(JSON.stringify({ done: true, chat: { ...updated, messages: toClientMessages(updated.messages) } }) + "\n");
        res.end();
      } catch (error: any) {
        if (!res.headersSent) res.status(500).json({ error: error.message });
        else res.end();
      }
    });
  
    // Branch off: duplicate an existing conversation (system message + history) into a
    // brand new chat, optionally swapping the model used for subsequent replies.
    app.post("/api/ai-chats/:id/branch", async (req, res) => {
      if (!req.isAuthenticated()) return res.status(401).json({ error: "Not authenticated" });
      try {
        const source = await db.query.aiChats.findFirst({
          where: (t, { eq }) => eq(t.id, req.params.id),
        });
        if (!source) return res.status(404).json({ error: "Chat not found" });
        const newModel = typeof req.body.model === "string" ? req.body.model : (source.model ?? "");
        const newProviderId = typeof req.body.providerId === "string" ? req.body.providerId : source.providerId;
        const baseTitle = source.title || "New chat";
        const branchedTitle = `${baseTitle} (branch)`.slice(0, MAX_CHAT_TITLE_LENGTH);
        const [row] = await db.insert(aiChats).values({
          title: branchedTitle,
          systemMessage: source.systemMessage,
          model: newModel,
          providerId: newProviderId,
          messages: sanitizeChatMessages(source.messages),
          agentMode: source.agentMode,
          contextEntities: source.contextEntities,
        }).returning();
        syncEntityInBackground("ai_chat", row.id);
        res.status(201).json(row);
      } catch (error: any) {
        res.status(500).json({ error: error.message });
      }
    });
  
    // Daily notes endpoints
    app.get("/api/daily-notes", async (req, res) => {
      try {
        const notes = await storage.listDailyNotes();
        res.json(notes);
      } catch (error: any) {
        res.status(500).json({ error: error.message });
      }
    });
  
    // Use the configured events model + prompt to extract a structured list of
    // events from a daily-note markdown body. A JSON schema constrains the model
    // to a deterministic shape.
    app.post("/api/daily-notes/generate-events", async (req, res) => {
      if (!req.isAuthenticated()) return res.status(401).json({ error: "Not authenticated" });
      try {
        const schema = z.object({ body: z.string() });
        const { body } = schema.parse(req.body);
        if (!body.trim()) return res.status(400).json({ error: "Body is empty." });
  
        let resolved: ResolvedModel;
        try {
          resolved = await resolveModel("events");
        } catch (err) {
          return sendAiError(res, err);
        }

        const systemPrompt = await getPrompt("dailyNoteEvents");
  
        // JSON schema constrains the model to return { events: [{ text: string }, ...] }
        const responseFormat = {
          type: "object",
          properties: {
            events: {
              type: "array",
              items: {
                type: "object",
                properties: { text: { type: "string" } },
                required: ["text"],
              },
            },
          },
          required: ["events"],
        };
  
        try {
          const { content } = await aiChat(resolved, {
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: body },
            ],
            format: responseFormat,
            signal: AbortSignal.timeout(120000),
          });

          let parsed: { events?: { text?: unknown }[] } = {};
          try {
            parsed = JSON.parse(content);
          } catch {
            return res.status(502).json({ error: "Model did not return valid JSON.", raw: content.slice(0, 500) });
          }
          const events = Array.isArray(parsed.events)
            ? parsed.events
                .map((e) => ({ text: typeof e?.text === "string" ? e.text.trim() : "" }))
                .filter((e) => e.text.length > 0)
            : [];
          res.json({ events });
        } catch (err: any) {
          if (err?.name === "TimeoutError") return res.status(504).json({ error: "Request timed out after 120 seconds." });
          return sendAiError(res, err);
        }
      } catch (error: any) {
        res.status(400).json({ error: error.message });
      }
    });
  
  
    // Transcribe a recorded audio clip to text. Uses PRM-Compute's built-in
    // Whisper (/api/whisper) when it is connected; otherwise forwards to a
    // configured OpenAI-compatible transcription endpoint (whisper.cpp
    // whisper-server, faster-whisper / speaches, etc.). That URL and model come
    // from Intelligence settings, else WHISPER_API_URL / WHISPER_MODEL (set by
    // docker-compose for the bundled speaches container).
    // Send an uploaded clip to PRM-Compute's Whisper. Resolves null when
    // PRM-Compute isn't connected; rejects with { status, error } otherwise.
    const transcribeWithCompute = async (
      file: Express.Multer.File,
      opts: { model?: string; language?: string } = {},
    ) => {
      if (!(await getComputeConnection())) return null;
      try {
        return await transcribeBuffer(file.buffer, file.mimetype || "audio/webm", file.originalname || "audio.webm", opts);
      } catch (err: any) {
        if (err instanceof ComputeUnreachableError && /timed out|TimeoutError/i.test(err.message)) {
          throw { status: 504, error: "Transcription timed out after 120 seconds." };
        }
        throw { status: 502, error: err.message };
      }
    };

    // Whisper demo: full PRM-Compute payload (segments, language, device) with
    // an optional model/language override. Requires PRM-Compute.
    app.post("/api/prm-face/whisper", upload.single("audio"), async (req, res) => {
      if (!req.isAuthenticated()) return res.status(401).json({ error: "Not authenticated" });
      if (!req.file) return res.status(400).json({ error: "No audio provided." });
      const model = typeof req.body?.model === "string" ? req.body.model : undefined;
      const language = typeof req.body?.language === "string" ? req.body.language : undefined;
      try {
        const started = Date.now();
        const result = await transcribeWithCompute(req.file, { model, language });
        if (!result) return res.status(400).json({ error: "PRM-Compute is not configured." });
        return res.json({ ...result, elapsedMs: Date.now() - started });
      } catch (err: any) {
        return res.status(err.status ?? 500).json({ error: err.error ?? err.message ?? "Transcription failed." });
      }
    });

    app.post("/api/daily-notes/transcribe", upload.single("audio"), async (req, res) => {
      if (!req.isAuthenticated()) return res.status(401).json({ error: "Not authenticated" });
      try {
        if (!req.file) return res.status(400).json({ error: "No audio provided." });

        try {
          const result = await transcribeWithCompute(req.file);
          if (result) return res.json({ text: result.text ?? "" });
        } catch (err: any) {
          return res.status(err.status ?? 502).json({ error: err.error ?? err.message });
        }

        const apiUrl = (await storage.getAppSetting("whisper_api_url")) || process.env.WHISPER_API_URL || "";
        if (!apiUrl.trim()) {
          return res.status(400).json({ error: "No speech-to-text available. Connect PRM-Compute in Recognition settings, or set a Whisper server URL in Intelligence settings." });
        }

        const base = apiUrl.replace(/\/+$/, "");
        const model = ((await storage.getAppSetting("whisper_model")) || process.env.WHISPER_MODEL || "").trim() || "whisper-1";

        const headers: Record<string, string> = {};
        const authRequired = (await storage.getAppSetting("whisper_auth_required")) === "true";
        if (authRequired) {
          const username = (await storage.getAppSetting("whisper_username")) ?? "";
          const password = (await storage.getAppSetting("whisper_password")) ?? "";
          headers["Authorization"] = "Basic " + Buffer.from(`${username}:${password}`).toString("base64");
        }

        // Build multipart body; do NOT set Content-Type manually so fetch adds the boundary.
        const form = new FormData();
        form.append(
          "file",
          new Blob([req.file.buffer], { type: req.file.mimetype || "audio/webm" }),
          req.file.originalname || "audio.webm",
        );
        form.append("model", model);
        form.append("response_format", "json");

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 120000);
        try {
          const resp = await fetch(`${base}/v1/audio/transcriptions`, {
            method: "POST",
            headers,
            body: form,
            signal: controller.signal,
          });
          clearTimeout(timeout);
          if (!resp.ok) {
            const text = await resp.text();
            return res.status(502).json({ error: `Whisper server returned ${resp.status}: ${text.slice(0, 200)}` });
          }
          const data = await resp.json() as { text?: string; error?: string };
          if (data.error) return res.status(502).json({ error: data.error });
          res.json({ text: data.text ?? "" });
        } catch (err: any) {
          clearTimeout(timeout);
          if (err.name === "AbortError") {
            return res.status(504).json({ error: "Transcription timed out after 120 seconds." });
          }
          return res.status(502).json({ error: `Failed to reach Whisper server: ${err.message}` });
        }
      } catch (error: any) {
        res.status(500).json({ error: error.message });
      }
    });

    app.get("/api/daily-notes/by-date/:date", async (req, res) => {
      try {
        const note = await storage.getDailyNoteByDate(req.params.date);
        if (!note) return res.status(404).json({ error: "Not found" });
        res.json(note);
      } catch (error: any) {
        res.status(500).json({ error: error.message });
      }
    });
  
    app.get("/api/daily-notes/:id", async (req, res) => {
      try {
        const note = await storage.getDailyNoteById(req.params.id);
        if (!note) return res.status(404).json({ error: "Not found" });
        res.json(note);
      } catch (error: any) {
        res.status(500).json({ error: error.message });
      }
    });
  
    app.post("/api/daily-notes", async (req, res) => {
      try {
        const schema = z.object({
          date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
          userTitle: z.string().default(""),
          body: z.string().default(""),
          status: z.enum(["finished", "unfinished"]).default("finished"),
          events: z.array(z.object({ text: z.string(), position: z.number().int() })).default([]),
          involvedParties: z.array(z.object({ partyType: z.enum(["person", "social_account", "group"]), refId: z.string() })).default([]),
        });
        const parsed = schema.parse(req.body);
        const { events, involvedParties, ...noteData } = parsed;
        const created = await storage.createDailyNote(noteData);
        if (events.length > 0) await storage.replaceDailyNoteEvents(created.id, events);
        if (involvedParties.length > 0) await storage.replaceDailyNoteParties(created.id, involvedParties);
        const full = await storage.getDailyNoteById(created.id);
        syncDailyNoteInBackground(created.id);
        syncEntityInBackground("daily_note", created.id);
        res.status(201).json(full);
      } catch (error: any) {
        res.status(400).json({ error: error.message });
      }
    });
  
    app.put("/api/daily-notes/:id", async (req, res) => {
      try {
        const existing = await storage.getDailyNoteById(req.params.id);
        if (!existing) return res.status(404).json({ error: "Not found" });

        // If the note is beyond the free edit window (>1 day), require PIN
        const needsPin = !existing.isEditable && existing.isLockedEditable;
        if (!existing.isEditable && !existing.isLockedEditable) {
          return res.status(403).json({ error: "This note is read-only (edit window has passed)" });
        }

        if (needsPin) {
          const { pin } = req.body;
          if (!pin) {
            return res.status(403).json({ error: "PIN required to edit this note", pinRequired: true });
          }
          // Verify PIN against stored hashed PIN
          const storedPin = await storage.getAppSetting("daily_notes_pin");
          if (!storedPin) {
            return res.status(403).json({ error: "No PIN has been set. Please set a PIN in settings first.", pinNotSet: true });
          }
          const [hashed, salt] = storedPin.split(".");
          const hashedBuf = Buffer.from(hashed, "hex");
          const suppliedBuf = (await scryptAsync(pin, salt, 64)) as Buffer;
          if (!timingSafeEqual(hashedBuf, suppliedBuf)) {
            return res.status(403).json({ error: "Incorrect PIN", pinIncorrect: true });
          }
        }
  
        const schema = z.object({
          userTitle: z.string().optional(),
          body: z.string().optional(),
          status: z.enum(["finished", "unfinished"]).optional(),
          events: z.array(z.object({ text: z.string(), position: z.number().int() })).optional(),
          involvedParties: z.array(z.object({ partyType: z.enum(["person", "social_account", "group"]), refId: z.string() })).optional(),
          pin: z.string().optional(),
          // Autosaves happen on every keystroke (debounced); they don't add audit-log
          // entries so the log isn't flooded with intermediate drafts.
          autosave: z.boolean().optional(),
        });
        const parsed = schema.parse(req.body);
        const { events, involvedParties, pin: _pin, autosave, ...noteData } = parsed;
        if (Object.keys(noteData).length > 0) await storage.updateDailyNote(req.params.id, noteData);
        if (events !== undefined) await storage.replaceDailyNoteEvents(req.params.id, events);
        if (involvedParties !== undefined) await storage.replaceDailyNoteParties(req.params.id, involvedParties);
        // Only record an audit-log entry for explicit saves, not intermediate autosaves.
        if (!autosave) await storage.addDailyNoteAuditLog(req.params.id, "edited", needsPin);
        const full = await storage.getDailyNoteById(req.params.id);
        syncDailyNoteInBackground(req.params.id);
        syncEntityInBackground("daily_note", req.params.id);
        res.json(full);
      } catch (error: any) {
        res.status(400).json({ error: error.message });
      }
    });
  
    app.delete("/api/daily-notes/:id", async (req, res) => {
      try {
        const existing = await storage.getDailyNoteById(req.params.id);
        if (!existing) return res.status(404).json({ error: "Not found" });
        if (!existing.isEditable) return res.status(403).json({ error: "This note is read-only (edit window has passed)" });
        const vectorIdToDelete = existing.vectorId ?? null;
        await storage.deleteDailyNote(req.params.id);
        if (vectorIdToDelete) {
          void deleteDailyNoteVector(req.params.id, vectorIdToDelete);
          void deleteEntityVector("daily_note", vectorIdToDelete);
        }
        res.json({ success: true });
      } catch (error: any) {
        res.status(500).json({ error: error.message });
      }
    });

    // ── Daily Notes PIN management ──────────────────────────────────────────
    app.get("/api/daily-notes-pin/status", async (req, res) => {
      if (!req.isAuthenticated()) return res.status(401).json({ error: "Not authenticated" });
      try {
        const storedPin = await storage.getAppSetting("daily_notes_pin");
        res.json({ pinSet: !!storedPin });
      } catch (error: any) {
        res.status(500).json({ error: error.message });
      }
    });

    app.post("/api/daily-notes-pin/set", async (req, res) => {
      if (!req.isAuthenticated()) return res.status(401).json({ error: "Not authenticated" });
      try {
        const schema = z.object({
          pin: z.string().min(4).max(8),
          currentPin: z.string().optional(),
        });
        const { pin, currentPin } = schema.parse(req.body);

        // If a PIN already exists, verify the current one before changing
        const existingPin = await storage.getAppSetting("daily_notes_pin");
        if (existingPin) {
          if (!currentPin) {
            return res.status(400).json({ error: "Current PIN required to change PIN" });
          }
          const [hashed, salt] = existingPin.split(".");
          const hashedBuf = Buffer.from(hashed, "hex");
          const suppliedBuf = (await scryptAsync(currentPin, salt, 64)) as Buffer;
          if (!timingSafeEqual(hashedBuf, suppliedBuf)) {
            return res.status(403).json({ error: "Current PIN is incorrect" });
          }
        }

        // Hash the new PIN
        const hashedPin = await hashPassword(pin);
        await storage.setAppSetting("daily_notes_pin", hashedPin);
        res.json({ success: true });
      } catch (error: any) {
        res.status(400).json({ error: error.message });
      }
    });

    app.post("/api/daily-notes-pin/verify", async (req, res) => {
      try {
        const schema = z.object({ pin: z.string() });
        const { pin } = schema.parse(req.body);
        const storedPin = await storage.getAppSetting("daily_notes_pin");
        if (!storedPin) {
          return res.status(400).json({ valid: false, error: "No PIN has been set" });
        }
        const [hashed, salt] = storedPin.split(".");
        const hashedBuf = Buffer.from(hashed, "hex");
        const suppliedBuf = (await scryptAsync(pin, salt, 64)) as Buffer;
        const valid = timingSafeEqual(hashedBuf, suppliedBuf);
        res.json({ valid });
      } catch (error: any) {
        res.status(400).json({ error: error.message });
      }
    });
  
    // ── Vector storage (Qdrant) ──────────────────────────────────────────────
  
    app.get("/api/vector/settings", async (req, res) => {
      if (!req.isAuthenticated()) return res.status(401).json({ error: "Not authenticated" });
      try {
        const cfg = await loadVectorConfig();
        res.json({
          enabled: cfg.enabled,
          qdrantUrl: cfg.qdrantUrl,
          hasApiKey: !!cfg.qdrantApiKey,
          collectionName: cfg.collectionName,
          embeddingModel: cfg.embeddingModel,
          embeddingProviderId: (await getVectorSetting("vector_embedding_provider")) ?? "",
          embeddingConcurrency: cfg.embeddingConcurrency,
        });
      } catch (error: any) {
        res.status(500).json({ error: error.message });
      }
    });
  
    app.post("/api/vector/settings", async (req, res) => {
      if (!req.isAuthenticated()) return res.status(401).json({ error: "Not authenticated" });
      const { enabled, qdrantUrl, qdrantApiKey, collectionName, embeddingModel, embeddingProviderId, embeddingConcurrency } = req.body ?? {};
      try {
        if (typeof enabled === "boolean") await setVectorSetting("vector_enabled", String(enabled));
        if (embeddingConcurrency !== undefined) {
          await setVectorSetting("vector_embedding_concurrency", String(clampConcurrency(embeddingConcurrency)));
        }
        if (typeof qdrantUrl === "string") await setVectorSetting("vector_qdrant_url", qdrantUrl.trim());
        if (typeof qdrantApiKey === "string" && qdrantApiKey.length > 0) {
          await setVectorSetting("vector_qdrant_api_key", qdrantApiKey);
        }
        if (typeof collectionName === "string" && collectionName.trim().length > 0) {
          await setVectorSetting("vector_collection", collectionName.trim());
        }
        // Vectors from a different (provider, model) pair aren't comparable.
        // Clear vector_synced_at so vectorize-all picks them up; the per-note
        // vector_id is preserved so re-embeds upsert in place.
        let embeddingChanged = false;
        for (const [key, value] of [
          ["vector_embedding_model", embeddingModel],
          ["vector_embedding_provider", embeddingProviderId],
        ] as const) {
          if (typeof value !== "string") continue;
          const previous = (await getVectorSetting(key)) ?? "";
          await setVectorSetting(key, value.trim());
          if (previous && previous !== value.trim()) embeddingChanged = true;
        }
        if (embeddingChanged) await db.update(dailyNotes).set({ vectorSyncedAt: null });
        res.json({ success: true });
      } catch (error: any) {
        res.status(500).json({ error: error.message });
      }
    });
  
    app.post("/api/vector/test", async (req, res) => {
      if (!req.isAuthenticated()) return res.status(401).json({ error: "Not authenticated" });
      try {
        const result = await testVectorConnection();
        res.json(result);
      } catch (error: any) {
        res.status(500).json({ ok: false, message: error.message });
      }
    });
  
    // Stats panel for the vector settings page.
    app.get("/api/vector/stats", async (req, res) => {
      if (!req.isAuthenticated()) return res.status(401).json({ error: "Not authenticated" });
      try {
        const rows = await db
          .select({
            total: sql<number>`COUNT(*)::int`,
            vectorized: sql<number>`COUNT(*) FILTER (WHERE vector_id IS NOT NULL)::int`,
            lastSyncedAt: sql<Date | null>`MAX(vector_synced_at)`,
          })
          .from(dailyNotes);
        const r = rows[0] ?? { total: 0, vectorized: 0, lastSyncedAt: null };
        res.json({
          totalNotes: r.total ?? 0,
          vectorized: r.vectorized ?? 0,
          missing: Math.max(0, (r.total ?? 0) - (r.vectorized ?? 0)),
          lastSyncedAt: r.lastSyncedAt,
        });
      } catch (error: any) {
        res.status(500).json({ error: error.message });
      }
    });
  
    // Manually vectorize a single daily note.
    app.post("/api/daily-notes/:id/vectorize", async (req, res) => {
      if (!req.isAuthenticated()) return res.status(401).json({ error: "Not authenticated" });
      try {
        const note = await storage.getDailyNoteById(req.params.id);
        if (!note) return res.status(404).json({ error: "Not found" });
        const pointId = await upsertDailyNoteVector(note);
        res.json({ ok: true, vectorId: pointId });
      } catch (error: any) {
        res.status(500).json({ error: error.message });
      }
    });
  
    // Backfill: vectorize every daily note that is missing a vector or whose
    // vector is stale (vector_synced_at is null).
    app.post("/api/daily-notes/vectorize-all", async (req, res) => {
      if (!req.isAuthenticated()) return res.status(401).json({ error: "Not authenticated" });
      try {
        const cfg = await loadVectorConfig();
        if (!cfg.enabled) return res.status(400).json({ error: "Vector storage is disabled." });
        const run = await prepareVectorRun();
        const rows = await db
          .select({ id: dailyNotes.id })
          .from(dailyNotes)
          .where(sql`vector_synced_at IS NULL`);
        let processed = 0;
        let failed = 0;
        const errors: string[] = [];
        for (const r of rows) {
          try {
            const full = await storage.getDailyNoteById(r.id);
            if (!full) continue;
            await upsertDailyNoteVector(full, run);
            processed++;
          } catch (e: any) {
            failed++;
            if (errors.length < 5) errors.push(e?.message ?? String(e));
          }
        }
        res.json({ ok: true, processed, failed, total: rows.length, errors });
      } catch (error: any) {
        res.status(500).json({ error: error.message });
      }
    });
  
    app.delete("/api/daily-notes/:id/vector", async (req, res) => {
      if (!req.isAuthenticated()) return res.status(401).json({ error: "Not authenticated" });
      try {
        const note = await storage.getDailyNoteById(req.params.id);
        if (!note) return res.status(404).json({ error: "Not found" });
        await deleteDailyNoteVector(note.id, note.vectorId ?? null);
        await db
          .update(dailyNotes)
          .set({ vectorId: null, vectorSyncedAt: null })
          .where(eq(dailyNotes.id, note.id));
        res.json({ ok: true });
      } catch (error: any) {
        res.status(500).json({ error: error.message });
      }
    });
  
    // Optional: semantic search endpoint over daily notes (no UI yet).
    app.get("/api/vector/search", async (req, res) => {
      if (!req.isAuthenticated()) return res.status(401).json({ error: "Not authenticated" });
      const q = (req.query.q as string | undefined)?.trim();
      const limit = Math.min(50, Math.max(1, parseInt((req.query.limit as string) ?? "10", 10) || 10));
      if (!q) return res.status(400).json({ error: "Missing query parameter 'q'." });
      try {
        const hits = await searchDailyNotes(q, limit);
        res.json({ hits });
      } catch (error: any) {
        res.status(500).json({ error: error.message });
      }
    });

    // ── Universal Vector Storage ─────────────────────────────────────────────

    // Status endpoint for the universal vector collection
    app.get("/api/vector/universal/status", async (req, res) => {
      if (!req.isAuthenticated()) return res.status(401).json({ error: "Not authenticated" });
      try {
        const status = await getUniversalStatus();
        res.json(status);
      } catch (error: any) {
        res.status(500).json({ error: error.message });
      }
    });

    // Get/set universal vector settings
    app.get("/api/vector/universal/settings", async (req, res) => {
      if (!req.isAuthenticated()) return res.status(401).json({ error: "Not authenticated" });
      try {
        const cfg = await loadUniversalVectorConfig();
        res.json({
          enabled: cfg.universalEnabled,
          collectionName: cfg.universalCollection,
          ...(await loadChunkSettings()),
        });
      } catch (error: any) {
        res.status(500).json({ error: error.message });
      }
    });

    app.post("/api/vector/universal/settings", async (req, res) => {
      if (!req.isAuthenticated()) return res.status(401).json({ error: "Not authenticated" });
      const { enabled, collectionName, chunkChars, chunkOverlap } = req.body ?? {};
      try {
        if (typeof enabled === "boolean") await setVectorSetting("vector_universal_enabled", String(enabled));
        if (typeof collectionName === "string" && collectionName.trim().length > 0) {
          await setVectorSetting("vector_universal_collection", collectionName.trim());
        }
        if (chunkChars !== undefined || chunkOverlap !== undefined) {
          await saveChunkSettings({ chunkChars, chunkOverlap });
        }
        res.json({ success: true });
      } catch (error: any) {
        res.status(400).json({ error: error.message });
      }
    });

    // Universal semantic search
    app.post("/api/vector/universal/search", async (req, res) => {
      if (!req.isAuthenticated()) return res.status(401).json({ error: "Not authenticated" });
      const { query, limit, typeFilter, minScore } = req.body ?? {};
      if (!query || typeof query !== "string" || !query.trim()) {
        return res.status(400).json({ error: "Missing 'query' field." });
      }
      try {
        const results = await searchUniversal(
          query.trim(),
          Math.min(100, Math.max(1, limit || 20)),
          typeFilter as UniversalEntityType[] | undefined,
          typeof minScore === "number" ? minScore : undefined
        );
        res.json({ results });
      } catch (error: any) {
        res.status(500).json({ error: error.message });
      }
    });

    // Bulk vectorize all entities. Runs in the background; poll /progress, cancel via /stop.
    app.post("/api/vector/universal/vectorize-all", async (req, res) => {
      if (!req.isAuthenticated()) return res.status(401).json({ error: "Not authenticated" });
      try {
        const started = await startBulkSync();
        if (!started) return res.status(409).json({ ...getBulkSyncProgress(), error: "A vectorize run is already in progress." });
        res.status(202).json({ ok: true, ...getBulkSyncProgress() });
      } catch (error: any) {
        res.status(500).json({ error: error.message });
      }
    });

    app.get("/api/vector/universal/progress", (req, res) => {
      if (!req.isAuthenticated()) return res.status(401).json({ error: "Not authenticated" });
      res.json(getBulkSyncProgress());
    });

    app.post("/api/vector/universal/stop", (req, res) => {
      if (!req.isAuthenticated()) return res.status(401).json({ error: "Not authenticated" });
      res.json({ ok: stopBulkSync(), ...getBulkSyncProgress() });
    });

    // Delete all vectors: drop the universal, daily-note and app-knowledge Qdrant
    // collections and clear vector_id / vector_synced_at everywhere.
    app.post("/api/vector/delete-all", async (req, res) => {
      if (!req.isAuthenticated()) return res.status(401).json({ error: "Not authenticated" });
      if (getBulkSyncProgress().running) {
        return res.status(409).json({ error: "Stop the running Vectorize Everything first." });
      }
      try {
        const cfg = await loadUniversalVectorConfig();
        const deleted: string[] = [];
        if (cfg.qdrantUrl) {
          const client = buildClient(cfg);
          const existing = new Set((await client.getCollections()).collections.map((c) => c.name));
          for (const name of new Set([cfg.universalCollection, cfg.collectionName, APP_KNOWLEDGE_COLLECTION])) {
            if (!existing.has(name)) continue;
            await client.deleteCollection(name);
            deleted.push(name);
          }
        }
        for (const table of [people, photos, notes, interactions, socialAccounts, socialAccountPosts, dailyNotes, aiChats, appKnowledge]) {
          await db.update(table).set({ vectorId: null, vectorSyncedAt: null });
        }
        await db.delete(messageChunks);
        await db.update(conversations).set({ chunkedAt: null });
        res.json({ ok: true, deletedCollections: deleted });
      } catch (error: any) {
        res.status(500).json({ error: error.message });
      }
    });

    // Reset vector sync (clear vector_synced_at on all entity tables + app knowledge)
    app.post("/api/vector/universal/reset-sync", async (req, res) => {
      if (!req.isAuthenticated()) return res.status(401).json({ error: "Not authenticated" });
      try {
        await db.update(people).set({ vectorSyncedAt: null });
        await db.update(photos).set({ vectorSyncedAt: null });
        await db.update(notes).set({ vectorSyncedAt: null });
        await db.update(interactions).set({ vectorSyncedAt: null });
        await db.update(socialAccounts).set({ vectorSyncedAt: null });
        await db.update(socialAccountPosts).set({ vectorSyncedAt: null });
        await db.update(dailyNotes).set({ vectorSyncedAt: null });
        await db.update(aiChats).set({ vectorSyncedAt: null });
        // Chunks whose text is unchanged keep their points on the rebuild.
        await db.update(conversations).set({ chunkedAt: null });
        // App knowledge stats count vector_id, so clear it too; Re-index rebuilds the collection.
        await db.update(appKnowledge).set({ vectorId: null, vectorSyncedAt: null });
        res.json({ ok: true });
      } catch (error: any) {
        res.status(500).json({ error: error.message });
      }
    });

    // Stats for universal vectorization
    app.get("/api/vector/universal/stats", async (req, res) => {
      if (!req.isAuthenticated()) return res.status(401).json({ error: "Not authenticated" });
      try {
        const stats: Record<string, { total: number; vectorized: number }> = {};
        for (const { type, table, eligible } of UNIVERSAL_SOURCES) {
          const rows = await db
            .select({
              total: sql<number>`COUNT(*)::int`,
              vectorized: sql<number>`COUNT(*) FILTER (WHERE vector_synced_at IS NOT NULL)::int`,
            })
            .from(table)
            .where(eligible);
          const r = rows[0] ?? { total: 0, vectorized: 0 };
          stats[type] = { total: r.total ?? 0, vectorized: r.vectorized ?? 0 };
        }
        // Conversations: vectorized once chunked with no message added since.
        const { rows: [conv] } = await db.execute<{ total: number; vectorized: number; chunks: number }>(sql`
          SELECT COUNT(*)::int AS total,
                 COUNT(*) FILTER (WHERE c.chunked_at IS NOT NULL AND NOT EXISTS (
                   SELECT 1 FROM messages m2 WHERE m2.conversation_id = c.id AND m2.created_at > c.chunked_at))::int AS vectorized,
                 (SELECT COUNT(*)::int FROM message_chunks) AS chunks
          FROM conversations c
          WHERE EXISTS (SELECT 1 FROM messages m WHERE m.conversation_id = c.id)
        `);
        stats.conversations = { total: conv?.total ?? 0, vectorized: conv?.vectorized ?? 0 };
        stats.message_chunks = { total: conv?.chunks ?? 0, vectorized: conv?.chunks ?? 0 };
        res.json(stats);
      } catch (error: any) {
        res.status(500).json({ error: error.message });
      }
    });

    // Re-embed one entity's point now (delete + re-add). `conversation` rebuilds its message chunks.
    const ROW_TYPES = new Set<string>(UNIVERSAL_SOURCES.map((s) => s.type));
    app.post("/api/vector/universal/:type/:id/resync", async (req, res) => {
      if (!req.isAuthenticated()) return res.status(401).json({ error: "Not authenticated" });
      const { type, id } = req.params;
      try {
        if (type === "conversation") {
          const cfg = await loadUniversalVectorConfig();
          if (!cfg.universalEnabled || !cfg.qdrantUrl || !cfg.embeddingModel) return res.json({ result: "disabled" });
          await rechunkConversation(id);
          return res.json({ result: "upserted" });
        }
        if (!ROW_TYPES.has(type)) return res.status(400).json({ error: `Unknown type '${type}'.` });
        res.json({ result: await resyncEntity(type as RowEntityType, id) });
      } catch (error: any) {
        res.status(500).json({ error: error.message });
      }
    });

    // Delete one entity's point. `conversation` drops all its message chunks.
    app.delete("/api/vector/universal/:type/:id", async (req, res) => {
      if (!req.isAuthenticated()) return res.status(401).json({ error: "Not authenticated" });
      const { type, id } = req.params;
      try {
        if (type === "conversation") {
          await clearConversationChunks(id);
          return res.json({ result: "removed" });
        }
        if (!ROW_TYPES.has(type)) return res.status(400).json({ error: `Unknown type '${type}'.` });
        res.json({ result: await removeEntityVector(type as RowEntityType, id) });
      } catch (error: any) {
        res.status(500).json({ error: error.message });
      }
    });

    // Where a message-chunk search hit links to: the chat page plus the chunk's messages.
    app.get("/api/message-chunks/:id", async (req, res) => {
      if (!req.isAuthenticated()) return res.status(401).json({ error: "Not authenticated" });
      try {
        const link = await resolveChunkLink(req.params.id);
        if (!link) return res.status(404).json({ error: "Chunk not found (the conversation may have been rechunked)." });
        res.json(link);
      } catch (error: any) {
        res.status(500).json({ error: error.message });
      }
    });

    // ── App Knowledge Base Storage ───────────────────────────────────────────

    app.get("/api/vector/app-knowledge/settings", async (req, res) => {
      if (!req.isAuthenticated()) return res.status(401).json({ error: "Not authenticated" });
      try {
        const enabled = (await getVectorSetting("app_knowledge_enabled")) === "true";
        res.json({ enabled });
      } catch (error: any) {
        res.status(500).json({ error: error.message });
      }
    });

    app.post("/api/vector/app-knowledge/settings", async (req, res) => {
      if (!req.isAuthenticated()) return res.status(401).json({ error: "Not authenticated" });
      const { enabled } = req.body ?? {};
      try {
        if (typeof enabled === "boolean") {
          const previous = (await getVectorSetting("app_knowledge_enabled")) === "true";
          await setVectorSetting("app_knowledge_enabled", String(enabled));
          
          if (enabled && !previous) {
            // Trigger async reindexing in background after the feature has been turned on
            void (async () => {
              try {
                await reindexAppKnowledge();
              } catch (err) {
                console.error("Background app knowledge ingestion failed:", err);
              }
            })();
          }
        }
        res.json({ success: true });
      } catch (error: any) {
        res.status(500).json({ error: error.message });
      }
    });

    app.get("/api/vector/app-knowledge/stats", async (req, res) => {
      if (!req.isAuthenticated()) return res.status(401).json({ error: "Not authenticated" });
      try {
        const rows = await db
          .select({
            total: sql<number>`COUNT(*)::int`,
            vectorized: sql<number>`COUNT(*) FILTER (WHERE vector_id IS NOT NULL)::int`,
            lastSyncedAt: sql<Date | null>`MAX(vector_synced_at)`,
          })
          .from(appKnowledge);
        const r = rows[0] ?? { total: 0, vectorized: 0, lastSyncedAt: null };
        res.json({
          totalChunks: r.total ?? 0,
          vectorized: r.vectorized ?? 0,
          missing: Math.max(0, (r.total ?? 0) - (r.vectorized ?? 0)),
          lastSyncedAt: r.lastSyncedAt,
        });
      } catch (error: any) {
        res.status(500).json({ error: error.message });
      }
    });

    app.post("/api/vector/app-knowledge/reindex", async (req, res) => {
      if (!req.isAuthenticated()) return res.status(401).json({ error: "Not authenticated" });
      try {
        void (async () => {
          try {
            await reindexAppKnowledge();
          } catch (err) {
            console.error("Background app knowledge reindexing failed:", err);
          }
        })();
        res.json({ ok: true, message: "Reindexing initiated in the background." });
      } catch (error: any) {
        res.status(500).json({ error: error.message });
      }
    });
  
    // --- Upgrade #7: SSE for Real-Time Updates ---
    app.get("/api/v1/events/stream", (req, res) => {
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.setHeader("X-Accel-Buffering", "no");
  
      const clientId = `sse_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
      sseManager.addClient(clientId, res);
  
      // Send initial connected event
      res.write(`event: connected\ndata: ${JSON.stringify({ clientId })}\n\n`);
  
      // Send keepalive every 30 seconds
      const keepalive = setInterval(() => {
        try {
          res.write(": keepalive\n\n");
        } catch {
          clearInterval(keepalive);
        }
      }, 30000);
  
      req.on("close", () => {
        clearInterval(keepalive);
        sseManager.removeClient(clientId);
      });
    });

    // ── Guess the Sex ──────────────────────────────────────────────────────────

    // Internal helper: generate sex guesses from LLM for people with unknown sex
    async function generateSexGuesses(): Promise<{ generated: number; error?: string }> {
      // 1. Find people whose sex is "unknown" and who don't already have a pending queue entry
      const unknownPeople = await db
        .select()
        .from(people)
        .where(eq(people.sex, "unknown"));

      if (unknownPeople.length === 0) {
        return { generated: 0 };
      }

      // Filter out people who already have unanswered queue entries
      const existingQueue = await db
        .select()
        .from(sexGuessQueue)
        .where(eq(sexGuessQueue.answered, 0));

      const queuedPersonIds = new Set(existingQueue.map((q) => q.personId));
      const candidates = unknownPeople.filter((p) => !queuedPersonIds.has(p.id));

      if (candidates.length === 0) {
        return { generated: 0 };
      }

      // Take up to 5 candidates per LLM call (larger batches cause truncation)
      const batch = candidates.slice(0, 5);

      // Build context for each person including their social accounts
      const personContexts: string[] = [];
      for (const person of batch) {
        let context = `Name: ${person.firstName} ${person.lastName}`;
        if (person.email) context += `, Email: ${person.email}`;
        if (person.company) context += `, Company: ${person.company}`;
        if (person.title) context += `, Title: ${person.title}`;
        if (person.tags && person.tags.length > 0) context += `, Tags: ${person.tags.join(", ")}`;

        // Get connected social accounts
        if (person.socialAccountUuids && person.socialAccountUuids.length > 0) {
          const accounts = await db
            .select()
            .from(socialAccounts)
            .where(inArray(socialAccounts.id, person.socialAccountUuids));
          if (accounts.length > 0) {
            const accountInfo = accounts.map((a) => a.username || "").filter(Boolean).join(", ");
            if (accountInfo) context += `, Social accounts: ${accountInfo}`;
          }
        }

        personContexts.push(`[ID: ${person.id}] ${context}`);
      }

      let resolved: ResolvedModel;
      try {
        resolved = await resolveModel("sexGuess");
      } catch (err: any) {
        return { generated: 0, error: err.message };
      }

      const prompt = `You are helping classify the sex of people in a personal relationship manager database. Based on their name and account information, guess whether each person is male or female.

For each person, provide your best guess. Respond with valid JSON only - an array of objects with these exact fields:
- "id": the person ID exactly as provided
- "sex": either "male" or "female"  
- "reasoning": a brief one-sentence explanation

${DATA_TAGS_NOTE}

People to classify:
${asData("people", personContexts.join("\n"))}

Respond with ONLY a JSON array, no other text.`;

      try {
        const { content } = await aiChat(resolved, {
          messages: [{ role: "user", content: prompt }],
          signal: AbortSignal.timeout(60000),
        });

        // Parse JSON response - try to extract array from response
        let guesses: Array<{ id: string; sex: string; reasoning: string }> = [];
        try {
          // Try direct parse first
          guesses = JSON.parse(content);
        } catch {
          // Try to extract JSON array from response
          const match = content.match(/\[[\s\S]*\]/);
          if (match) {
            guesses = JSON.parse(match[0]);
          }
        }

        if (!Array.isArray(guesses) || guesses.length === 0) {
          return { generated: 0, error: "LLM returned invalid response format." };
        }

        // Insert valid guesses into the queue
        let inserted = 0;
        const validPersonIds = new Set(batch.map((p) => p.id));
        for (const guess of guesses) {
          if (!guess.id || !validPersonIds.has(guess.id)) continue;
          const sex = guess.sex?.toLowerCase();
          if (sex !== "male" && sex !== "female") continue;

          await db.insert(sexGuessQueue).values({
            personId: guess.id,
            guessedSex: sex,
            reasoning: guess.reasoning || "No reasoning provided",
          });
          inserted++;
        }

        return { generated: inserted };
      } catch (err: any) {
        return { generated: 0, error: `AI request failed: ${err.message}` };
      }
    }

    // GET /api/guess-sex/queue - Get the current queue status and next guess
    app.get("/api/guess-sex/queue", async (req, res) => {
      if (!req.isAuthenticated()) return res.status(401).json({ error: "Not authenticated" });

      try {
        const now = new Date();
        const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

        // Clean up stale queue entries (older than 1 day and not snoozed) - revalidate against DB
        const staleEntries = await db
          .select()
          .from(sexGuessQueue)
          .where(and(eq(sexGuessQueue.answered, 0), lt(sexGuessQueue.dateAdded, oneDayAgo)));

        for (const entry of staleEntries) {
          // Skip entries that are still snoozed (don't touch them)
          if (entry.snoozedUntil && entry.snoozedUntil > now) continue;
          // Check if person's sex has been defined since the guess was queued
          const person = await db.select().from(people).where(eq(people.id, entry.personId));
          if (!person.length || (person[0].sex !== "unknown")) {
            // Person was already defined, skipped perm, or deleted — remove from queue
            await db.delete(sexGuessQueue).where(eq(sexGuessQueue.id, entry.id));
          } else {
            // Still valid, refresh the date and clear snooze
            await db.update(sexGuessQueue).set({ dateAdded: new Date(), snoozedUntil: null }).where(eq(sexGuessQueue.id, entry.id));
          }
        }

        // Get pending (unanswered, not currently snoozed) queue entries
        const allPending = await db
          .select()
          .from(sexGuessQueue)
          .where(eq(sexGuessQueue.answered, 0));

        // Filter out snoozed items and items for people whose sex is no longer 'unknown'
        const pending = allPending.filter(
          (e) => !e.snoozedUntil || e.snoozedUntil <= now
        );

        if (pending.length < 25) {
          // Loop generation until we hit 25 pending items or run out of candidates.
          // Each LLM call handles 5 names (larger batches truncate), so we may need
          // up to 5 passes to fill a 25-item queue.
          let lastError: string | undefined;
          let passes = 0;
          const MAX_PASSES = 5;
          while (passes < MAX_PASSES) {
            passes++;
            const result = await generateSexGuesses();
            if (result.error) { lastError = result.error; break; } // LLM error
            if (result.generated === 0) break; // no more candidates

            // Re-check how many active items we now have
            const nowPending = await db.select().from(sexGuessQueue).where(eq(sexGuessQueue.answered, 0));
            const nowActive = nowPending.filter((e) => !e.snoozedUntil || e.snoozedUntil <= now);
            if (nowActive.length >= 25) break; // target reached
          }

          // Fetch final pending list (with snooze filter)
          const allRefreshed = await db.select().from(sexGuessQueue).where(eq(sexGuessQueue.answered, 0));
          const refreshedPending = allRefreshed.filter((e) => !e.snoozedUntil || e.snoozedUntil <= now);

          if (refreshedPending.length === 0) {
            if (lastError) return res.json({ status: "error", error: lastError, queue: [] });
            return res.json({ status: "empty", queue: [], message: "No people with unknown sex found." });
          }

          const queueWithPeople = await Promise.all(
            refreshedPending.map(async (item) => {
              const person = await db.select().from(people).where(eq(people.id, item.personId));
              return { ...item, person: person[0] || null };
            })
          );
          const validQueue = queueWithPeople.filter((q) => q.person);
          return res.json({ status: "ready", queue: validQueue, ...(lastError ? { error: lastError } : {}) });
        }

        // Already have enough, return them with person details
        const queueWithPeople = await Promise.all(
          pending.map(async (item) => {
            const person = await db.select().from(people).where(eq(people.id, item.personId));
            return { ...item, person: person[0] || null };
          })
        );

        return res.json({ status: "ready", queue: queueWithPeople.filter((q) => q.person) });
      } catch (error: any) {
        console.error("Error fetching sex guess queue:", error);
        res.status(500).json({ error: "Failed to fetch sex guess queue" });
      }
    });

    // POST /api/guess-sex/prefetch - Generate more guesses, respond when done
    app.post("/api/guess-sex/prefetch", async (req, res) => {
      if (!req.isAuthenticated()) return res.status(401).json({ error: "Not authenticated" });
      try {
        const result = await generateSexGuesses();
        res.json({ success: true, generated: result.generated, error: result.error });
      } catch (err: any) {
        // Don't propagate — this is a best-effort background call
        res.json({ success: false, generated: 0, error: err.message });
      }
    });

    // POST /api/guess-sex/answer - Answer a guess (correct or incorrect)
    app.post("/api/guess-sex/answer", async (req, res) => {
      if (!req.isAuthenticated()) return res.status(401).json({ error: "Not authenticated" });

      const { queueItemId, correct } = req.body;
      if (!queueItemId || typeof correct !== "boolean") {
        return res.status(400).json({ error: "Missing queueItemId or correct fields" });
      }

      try {
        // Get the queue item
        const items = await db.select().from(sexGuessQueue).where(eq(sexGuessQueue.id, queueItemId));
        if (items.length === 0) {
          return res.status(404).json({ error: "Queue item not found" });
        }

        const item = items[0];

        // Determine the actual sex
        const actualSex = correct
          ? item.guessedSex
          : item.guessedSex === "male"
            ? "female"
            : "male";

        // Update the person's sex
        await db.update(people).set({ sex: actualSex }).where(eq(people.id, item.personId));

        // Mark queue item as answered
        await db.update(sexGuessQueue).set({ answered: 1 }).where(eq(sexGuessQueue.id, queueItemId));

        res.json({ success: true, personId: item.personId, sex: actualSex });
      } catch (error: any) {
        console.error("Error answering sex guess:", error);
        res.status(500).json({ error: "Failed to process answer" });
      }
    });

    // POST /api/guess-sex/skip-temp - Snooze this person for 1 day
    app.post("/api/guess-sex/skip-temp", async (req, res) => {
      if (!req.isAuthenticated()) return res.status(401).json({ error: "Not authenticated" });

      const { queueItemId } = req.body;
      if (!queueItemId) return res.status(400).json({ error: "Missing queueItemId" });

      try {
        const items = await db.select().from(sexGuessQueue).where(eq(sexGuessQueue.id, queueItemId));
        if (items.length === 0) return res.status(404).json({ error: "Queue item not found" });

        const snoozedUntil = new Date(Date.now() + 24 * 60 * 60 * 1000); // 1 day from now
        await db.update(sexGuessQueue).set({ snoozedUntil }).where(eq(sexGuessQueue.id, queueItemId));

        res.json({ success: true, snoozedUntil });
      } catch (error: any) {
        console.error("Error snoozing sex guess:", error);
        res.status(500).json({ error: "Failed to snooze item" });
      }
    });

    // POST /api/guess-sex/skip-perm - Permanently skip this person (mark sex as 'skipped')
    app.post("/api/guess-sex/skip-perm", async (req, res) => {
      if (!req.isAuthenticated()) return res.status(401).json({ error: "Not authenticated" });

      const { queueItemId } = req.body;
      if (!queueItemId) return res.status(400).json({ error: "Missing queueItemId" });

      try {
        const items = await db.select().from(sexGuessQueue).where(eq(sexGuessQueue.id, queueItemId));
        if (items.length === 0) return res.status(404).json({ error: "Queue item not found" });

        const item = items[0];

        // Mark person's sex as 'skipped' so they never appear in the guess queue again
        await db.update(people).set({ sex: "skipped" }).where(eq(people.id, item.personId));

        // Remove from queue
        await db.delete(sexGuessQueue).where(eq(sexGuessQueue.id, queueItemId));

        res.json({ success: true, personId: item.personId });
      } catch (error: any) {
        console.error("Error permanently skipping sex guess:", error);
        res.status(500).json({ error: "Failed to skip item" });
      }
    });

    // ========================
    // New AI Chat Endpoints
    // ========================

    // Clear messages for a specific chat
    app.post("/api/ai-chats/:id/clear", async (req, res) => {
      if (!req.isAuthenticated()) return res.status(401).json({ error: "Not authenticated" });
      try {
        const existing = await db.query.aiChats.findFirst({
          where: eq(aiChats.id, req.params.id)
        });
        if (!existing) return res.status(404).json({ error: "Chat not found" });

        await db
          .update(aiChats)
          .set({ messages: [] })
          .where(eq(aiChats.id, req.params.id));

        res.json({ success: true });
      } catch (error: any) {
        console.error("Error clearing chat messages:", error);
        res.status(500).json({ error: `Failed to clear chat: ${error.message}` });
      }
    });

    // ========================
    // New Face Recognition Proxy Endpoints
    // ========================

    // Single face-to-person manual assignment
    app.post("/api/prm-face/face/assign", async (req, res) => {
      if (!req.isAuthenticated()) return res.status(401).json({ error: "Not authenticated" });
      const apiUrl = await getPrmFaceSetting("prm_face_api_url");
      if (!apiUrl) return res.status(400).json({ error: "PRM Compute API URL is not configured." });
      const apiKey = await getPrmFaceSetting("prm_face_api_key");
      if (!apiKey) return res.status(400).json({ error: "PRM Compute API key is not configured." });

      const { face_uuid, person_uuid, name } = req.body;
      if (!face_uuid || !person_uuid) {
        return res.status(400).json({ error: "face_uuid and person_uuid are required." });
      }
      try {
        const response = await fetch(`${prmBase(apiUrl)}/api/face/assign`, {
          method: "POST",
          headers: { 
            "x-api-key": apiKey, 
            "Content-Type": "application/x-www-form-urlencoded" 
          },
          body: new URLSearchParams({ face_uuid, person_uuid, name: name || "" }).toString(),
          signal: AbortSignal.timeout(15000),
        });
        if (!response.ok) {
          const body = await response.text();
          return res.status(response.status).json({ error: `PRM Compute error: ${body}` });
        }
        res.json(await response.json());
      } catch (error: any) {
        res.status(500).json({ error: `Failed to contact PRM Compute: ${error.message}` });
      }
    });

    // Disassociate a face from its group (generates a new unique personface_uuid)
    app.post("/api/prm-face/face/disassociate", async (req, res) => {
      if (!req.isAuthenticated()) return res.status(401).json({ error: "Not authenticated" });
      const { faceUuid } = req.body;
      if (!faceUuid || typeof faceUuid !== "string") {
        return res.status(400).json({ error: "faceUuid is required." });
      }

      const group = await faceGroupUuid(faceUuid);
      if (!group || !(await identityIsVisible(group)) || !(await faceInReadablePhoto(faceUuid))) {
        return res.status(404).json({ error: "Face not found or inaccessible." });
      }

      try {
        const { newGroupUuid } = await disassociateFace(faceUuid);
        res.json({ success: true, newGroupUuid });
      } catch (error: any) {
        if (error instanceof RecognitionRequestError) return res.status(error.status).json({ error: error.message });
        console.error("Error in face/disassociate:", error);
        res.status(500).json({ error: "Failed to disassociate face." });
      }
    });

    // Connect a face group or face to a person or social account
    app.post("/api/prm-face/face/connect", async (req, res) => {
      if (!req.isAuthenticated()) return res.status(401).json({ error: "Not authenticated" });
      const { personfaceUuid, faceUuid, personId, socialAccountId } = req.body;

      if (!faceUuid && !personfaceUuid) {
        return res.status(400).json({ error: "faceUuid or personfaceUuid is required." });
      }

      if (!personId && !socialAccountId) {
        return res.status(400).json({ error: "personId or socialAccountId is required." });
      }

      if (faceUuid && typeof faceUuid === "string") {
        const group = await faceGroupUuid(faceUuid);
        if (!group || !(await identityIsVisible(group)) || !(await faceInReadablePhoto(faceUuid))) {
          return res.status(404).json({ error: "Face not found or inaccessible." });
        }
      } else if (personfaceUuid && typeof personfaceUuid === "string") {
        if (!(await identityIsVisible(personfaceUuid))) {
          return res.status(404).json({ error: "Face group not found or inaccessible." });
        }
      }

      if (personId && typeof personId === "string") {
        const [targetPerson] = await db
          .select({ id: people.id })
          .from(people)
          .where(eq(people.id, personId));
        if (!targetPerson) {
          return res.status(404).json({ error: "Person not found or inaccessible." });
        }
      }

      if (socialAccountId && typeof socialAccountId === "string") {
        const [targetAccount] = await db
          .select({ id: socialAccounts.id })
          .from(socialAccounts)
          .where(eq(socialAccounts.id, socialAccountId));
        if (!targetAccount) {
          return res.status(404).json({ error: "Social account not found or inaccessible." });
        }
      }

      try {
        const result = await connectFace({ faceUuid, personfaceUuid, personId, socialAccountId });
        res.json({ success: true, ...result });
      } catch (error: any) {
        if (error instanceof RecognitionRequestError) return res.status(error.status).json({ error: error.message });
        if (error instanceof FaceMergeConflictError) return res.status(409).json({ error: error.message });
        console.error("Error in face/connect:", error);
        res.status(500).json({ error: "Failed to connect face." });
      }
    });

    // Match image
    app.post("/api/prm-face/img/match", upload.single("image"), async (req, res) => {
      if (!req.isAuthenticated()) return res.status(401).json({ error: "Not authenticated" });
      if (!req.file) return res.status(400).json({ error: "No image provided." });

      const apiUrl = await getPrmFaceSetting("prm_face_api_url");
      if (!apiUrl) return res.status(400).json({ error: "PRM Compute API URL is not configured." });
      const apiKey = await getPrmFaceSetting("prm_face_api_key");
      if (!apiKey) return res.status(400).json({ error: "PRM Compute API key is not configured." });

      try {
        const formData = new FormData();
        formData.append("image", new Blob([req.file.buffer], { type: req.file.mimetype }), req.file.originalname || "image.jpg");
        if (req.body.max_faces) formData.append("max_faces", String(req.body.max_faces));
        if (req.body.limit) formData.append("limit", String(req.body.limit));

        const response = await fetch(`${prmBase(apiUrl)}/api/img/match`, {
          method: "POST",
          headers: { "x-api-key": apiKey },
          body: formData,
          signal: AbortSignal.timeout(30000),
        });
        if (!response.ok) {
          const body = await response.text();
          return res.status(response.status).json({ error: `PRM Compute error: ${body}` });
        }
        res.json(await response.json());
      } catch (error: any) {
        res.status(500).json({ error: `Failed to contact PRM Compute: ${error.message}` });
      }
    });

    // Create person record
    app.post("/api/prm-face/person/add", async (req, res) => {
      if (!req.isAuthenticated()) return res.status(401).json({ error: "Not authenticated" });
      const apiUrl = await getPrmFaceSetting("prm_face_api_url");
      if (!apiUrl) return res.status(400).json({ error: "PRM Compute API URL is not configured." });
      const apiKey = await getPrmFaceSetting("prm_face_api_key");
      if (!apiKey) return res.status(400).json({ error: "PRM Compute API key is not configured." });
      try {
        const formData = new FormData();
        if (req.body.name) formData.append("name", String(req.body.name));
        if (req.body.person_uuid) formData.append("person_uuid", String(req.body.person_uuid));
        
        const response = await fetch(`${prmBase(apiUrl)}/api/person/add`, {
          method: "POST",
          headers: { "x-api-key": apiKey },
          body: formData,
          signal: AbortSignal.timeout(15000),
        });
        if (!response.ok) {
          const body = await response.text();
          return res.status(response.status).json({ error: `PRM Compute error: ${body}` });
        }
        res.json(await response.json());
      } catch (error: any) {
        res.status(500).json({ error: `Failed to contact PRM Compute: ${error.message}` });
      }
    });

    // Merge person records
    app.post("/api/prm-face/person/merge", async (req, res) => {
      if (!req.isAuthenticated()) return res.status(401).json({ error: "Not authenticated" });
      const apiUrl = await getPrmFaceSetting("prm_face_api_url");
      if (!apiUrl) return res.status(400).json({ error: "PRM Compute API URL is not configured." });
      const apiKey = await getPrmFaceSetting("prm_face_api_key");
      if (!apiKey) return res.status(400).json({ error: "PRM Compute API key is not configured." });
      try {
        const formData = new FormData();
        formData.append("primary_person_uuid", String(req.body.primary_person_uuid));
        formData.append("secondary_person_uuid", String(req.body.secondary_person_uuid));
        const response = await fetch(`${prmBase(apiUrl)}/api/person/merge`, {
          method: "POST",
          headers: { "x-api-key": apiKey },
          body: formData,
          signal: AbortSignal.timeout(15000),
        });
        if (!response.ok) {
          const body = await response.text();
          return res.status(response.status).json({ error: `PRM Compute error: ${body}` });
        }
        res.json(await response.json());
      } catch (error: any) {
        res.status(500).json({ error: `Failed to contact PRM Compute: ${error.message}` });
      }
    });

    // Delete person
    app.delete("/api/prm-face/person/remove", async (req, res) => {
      if (!req.isAuthenticated()) return res.status(401).json({ error: "Not authenticated" });
      const apiUrl = await getPrmFaceSetting("prm_face_api_url");
      if (!apiUrl) return res.status(400).json({ error: "PRM Compute API URL is not configured." });
      const apiKey = await getPrmFaceSetting("prm_face_api_key");
      if (!apiKey) return res.status(400).json({ error: "PRM Compute API key is not configured." });
      try {
        const formData = new FormData();
        formData.append("person_uuid", String(req.body.person_uuid || req.query.person_uuid || req.body.personUuid));
        const response = await fetch(`${prmBase(apiUrl)}/api/person/remove`, {
          method: "DELETE",
          headers: { "x-api-key": apiKey },
          body: formData,
          signal: AbortSignal.timeout(15000),
        });
        if (!response.ok) {
          const body = await response.text();
          return res.status(response.status).json({ error: `PRM Compute error: ${body}` });
        }
        res.json(await response.json());
      } catch (error: any) {
        res.status(500).json({ error: `Failed to contact PRM Compute: ${error.message}` });
      }
    });

    // Get image info
    app.get("/api/prm-face/img/get", async (req, res) => {
      if (!req.isAuthenticated()) return res.status(401).json({ error: "Not authenticated" });
      const uuid = req.query.uuid as string;
      if (!uuid) return res.status(400).json({ error: "uuid is required." });
      const apiUrl = await getPrmFaceSetting("prm_face_api_url");
      if (!apiUrl) return res.status(400).json({ error: "PRM Compute API URL is not configured." });
      const apiKey = await getPrmFaceSetting("prm_face_api_key");
      if (!apiKey) return res.status(400).json({ error: "PRM Compute API key is not configured." });
      try {
        const response = await fetch(`${prmBase(apiUrl)}/api/img/get?uuid=${uuid}`, {
          headers: { "x-api-key": apiKey },
          signal: AbortSignal.timeout(15000),
        });
        if (!response.ok) {
          const body = await response.text();
          return res.status(response.status).json({ error: `PRM Compute error: ${body}` });
        }
        res.json(await response.json());
      } catch (error: any) {
        res.status(500).json({ error: `Failed to contact PRM Compute: ${error.message}` });
      }
    });

    // Get face details
    app.get("/api/prm-face/face/get", async (req, res) => {
      if (!req.isAuthenticated()) return res.status(401).json({ error: "Not authenticated" });
      const uuid = req.query.uuid as string;
      if (!uuid) return res.status(400).json({ error: "uuid is required." });
      const apiUrl = await getPrmFaceSetting("prm_face_api_url");
      if (!apiUrl) return res.status(400).json({ error: "PRM Compute API URL is not configured." });
      const apiKey = await getPrmFaceSetting("prm_face_api_key");
      if (!apiKey) return res.status(400).json({ error: "PRM Compute API key is not configured." });
      try {
        const response = await fetch(`${prmBase(apiUrl)}/api/face/get?uuid=${uuid}`, {
          headers: { "x-api-key": apiKey },
          signal: AbortSignal.timeout(15000),
        });
        if (!response.ok) {
          const body = await response.text();
          return res.status(response.status).json({ error: `PRM Compute error: ${body}` });
        }
        res.json(await response.json());
      } catch (error: any) {
        res.status(500).json({ error: `Failed to contact PRM Compute: ${error.message}` });
      }
    });

    // Get person info
    app.get("/api/prm-face/person/get", async (req, res) => {
      if (!req.isAuthenticated()) return res.status(401).json({ error: "Not authenticated" });
      const uuid = req.query.uuid as string;
      if (!uuid) return res.status(400).json({ error: "uuid is required." });
      const apiUrl = await getPrmFaceSetting("prm_face_api_url");
      if (!apiUrl) return res.status(400).json({ error: "PRM Compute API URL is not configured." });
      const apiKey = await getPrmFaceSetting("prm_face_api_key");
      if (!apiKey) return res.status(400).json({ error: "PRM Compute API key is not configured." });
      try {
        const response = await fetch(`${prmBase(apiUrl)}/api/person/get?uuid=${uuid}`, {
          headers: { "x-api-key": apiKey },
          signal: AbortSignal.timeout(15000),
        });
        if (!response.ok) {
          const body = await response.text();
          return res.status(response.status).json({ error: `PRM Compute error: ${body}` });
        }
        res.json(await response.json());
      } catch (error: any) {
        res.status(500).json({ error: `Failed to contact PRM Compute: ${error.message}` });
      }
    });

    // List named faces
    app.get("/api/prm-face/face/with-name", async (req, res) => {
      if (!req.isAuthenticated()) return res.status(401).json({ error: "Not authenticated" });
      const page = req.query.page || "1";
      const pageSize = req.query.page_size || req.query.pageSize || "25";
      const apiUrl = await getPrmFaceSetting("prm_face_api_url");
      if (!apiUrl) return res.status(400).json({ error: "PRM Compute API URL is not configured." });
      const apiKey = await getPrmFaceSetting("prm_face_api_key");
      if (!apiKey) return res.status(400).json({ error: "PRM Compute API key is not configured." });
      try {
        const response = await fetch(`${prmBase(apiUrl)}/api/face/with-name?page=${page}&page_size=${pageSize}`, {
          headers: { "x-api-key": apiKey },
          signal: AbortSignal.timeout(15000),
        });
        if (!response.ok) {
          const body = await response.text();
          return res.status(response.status).json({ error: `PRM Compute error: ${body}` });
        }
        res.json(await response.json());
      } catch (error: any) {
        res.status(500).json({ error: `Failed to contact PRM Compute: ${error.message}` });
      }
    });

    // Get person faces
    app.get("/api/prm-face/person/:personUuid/faces", async (req, res) => {
      if (!req.isAuthenticated()) return res.status(401).json({ error: "Not authenticated" });
      const { personUuid } = req.params;
      const page = req.query.page || "1";
      const pageSize = req.query.page_size || req.query.pageSize || "25";
      const order = req.query.order || "newest";
      const apiUrl = await getPrmFaceSetting("prm_face_api_url");
      if (!apiUrl) return res.status(400).json({ error: "PRM Compute API URL is not configured." });
      const apiKey = await getPrmFaceSetting("prm_face_api_key");
      if (!apiKey) return res.status(400).json({ error: "PRM Compute API key is not configured." });
      try {
        const response = await fetch(`${prmBase(apiUrl)}/api/person/${personUuid}/faces?page=${page}&page_size=${pageSize}&order=${order}`, {
          headers: { "x-api-key": apiKey },
          signal: AbortSignal.timeout(15000),
        });
        if (!response.ok) {
          const body = await response.text();
          return res.status(response.status).json({ error: `PRM Compute error: ${body}` });
        }
        res.json(await response.json());
      } catch (error: any) {
        res.status(500).json({ error: `Failed to contact PRM Compute: ${error.message}` });
      }
    });

    // OCR on an existing photo. PRM-Compute persists the result on the photos
    // row (ocr_data / ocr_at); this route only supplies the bytes and photo_id.
    app.post("/api/photos/:id/run-ocr", async (req, res) => {
      if (!req.isAuthenticated()) return res.status(401).json({ error: "Not authenticated" });
      const { id } = req.params;
      try {
        if (!(await getComputeConnection())) return res.status(400).json({ error: "PRM-Compute is not configured." });
        res.json(await runOcr(id, req.body ?? {}));
      } catch (error: any) {
        if (error instanceof ComputeUnreachableError) return res.status(503).json({ error: error.message });
        if (error.message === "Photo not found.") return res.status(404).json({ error: error.message });
        console.error("Error in run-ocr endpoint:", error);
        res.status(500).json({ error: error.message });
      }
    });
}
