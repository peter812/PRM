// Generated route module - ai-vector.ts
import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "../storage";
import { db } from "../db";
import { interactions, relationshipTypes, interactionTypes, people, socialNetworkChanges, socialAccountPosts, socialAccounts, socialProfileVersions, aiChats, dailyNotes, sexGuessQueue, notes, groups, photos, appKnowledge, imageQuestions, faces, type SocialAccountWithCurrentProfile, type ExtensionSession, type AiChatMessage, type AiToolCallTrace } from "@shared/schema";
import { AI_TOOLS, getAiToolByName, listAiToolMetadata, buildOllamaToolsArray } from "../ai-tools";
import { generateFamilyTreeChanges, applyFamilyTreeChanges, type ProposedFamilyChange } from "../family-tree-ai";
import crypto from "crypto";
import { z } from "zod";
import { eq, sql, isNotNull, and, inArray, lt } from "drizzle-orm";
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
import { uploadImageToS3, deleteImageFromS3 } from "../s3";
import { uploadImageLocally, deleteImageLocally, getLocalImagePath, isLocalImageUrl } from "../local-storage";
import { hashPassword, requireAuth } from "../auth";
import { triggerTaskWorker, triggerImageTaskWorker, pauseTaskWorker, resumeTaskWorker, isTaskWorkerPaused } from "../task-worker";
import { scrypt, timingSafeEqual } from "crypto";
import { promisify } from "util";
import fs from "fs";
import path from "path";
import Papa from "papaparse";
import { sendApiError, ErrorCodes } from "../middleware/error-handler";
import { sseManager } from "../middleware/sse";
import {
  loadVectorConfig,
  setVectorSetting,
  getVectorSetting,
  testVectorConnection,
  upsertDailyNoteVector,
  deleteDailyNoteVector,
  syncDailyNoteInBackground,
  searchDailyNotes,
} from "../vector";
import {
  syncEntityInBackground,
  deleteEntityVector,
  searchUniversal,
  getUniversalStatus,
  bulkSyncAll,
  loadUniversalVectorConfig,
  type UniversalEntityType,
} from "../vector-universal";
import { reindexAppKnowledge, resolveLinksInText, cleanRawLinks } from "../vector-app-knowledge";


const scryptAsync = promisify(scrypt);

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

// Flag to track if user creation is allowed (only after database reset)
let isUserCreationAllowed = false;

// NOTE: The global "/api" auth gate (and its PUBLIC_API_PATHS allowlist) lives
// in server/routes/auth-setup.ts, which is registered first and protects every
// /api route in all modules. Do not add a separate allowlist here.



// Bridge old settings functions to centralized storage layer
async function getOllamaSetting(key: string): Promise<string | null> {
  return storage.getAppSetting(key);
}
async function setOllamaSetting(key: string, value: string): Promise<void> {
  await storage.setAppSetting(key, value);
}
async function getPrmFaceSetting(key: string): Promise<string | null> {
  return storage.getAppSetting(key);
}
async function setPrmFaceSetting(key: string, value: string): Promise<void> {
  await storage.setAppSetting(key, value);
}


export function registerRoutes(app: Express) {
    // ── PRM-Face integration ──────────────────────────────────────────────────
  
    async function getPrmFaceSetting(key: string): Promise<string | null> {
      const row = await db.query.appSettings?.findFirst({ where: (t, { eq }) => eq(t.key, key) });
      return row?.value ?? null;
    }
  
    async function setPrmFaceSetting(key: string, value: string): Promise<void> {
      await db.execute(
        sql`INSERT INTO app_settings (key, value) VALUES (${key}, ${value})
            ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`
      );
    }
  
    /** Strip any trailing slashes so URL + "/path" never produces a double-slash. */
    function prmBase(url: string) {
      return url.replace(/\/+$/, "");
    }
  
    app.get("/api/prm-face/settings", async (req, res) => {
      if (!req.isAuthenticated()) return res.status(401).json({ error: "Not authenticated" });
      try {
        const apiUrl = await getPrmFaceSetting("prm_face_api_url") ?? "";
        const apiKey = await getPrmFaceSetting("prm_face_api_key");
        res.json({ apiUrl, hasApiKey: !!apiKey });
      } catch (error) {
        console.error("Error fetching PRM-Face settings:", error);
        res.status(500).json({ error: "Failed to fetch settings" });
      }
    });
  
    app.get("/api/prm-face/reveal-key", async (req, res) => {
      if (!req.isAuthenticated()) return res.status(401).json({ error: "Not authenticated" });
      try {
        const apiKey = await getPrmFaceSetting("prm_face_api_key");
        if (!apiKey) return res.status(404).json({ error: "No API key configured." });
        res.json({ apiKey });
      } catch (error) {
        res.status(500).json({ error: "Failed to retrieve API key" });
      }
    });
  
    app.post("/api/prm-face/settings", async (req, res) => {
      if (!req.isAuthenticated()) return res.status(401).json({ error: "Not authenticated" });
      const { apiUrl } = req.body;
      if (typeof apiUrl !== "string" || !apiUrl.trim()) {
        return res.status(400).json({ error: "apiUrl is required" });
      }
      try {
        await setPrmFaceSetting("prm_face_api_url", apiUrl.trim());
        res.json({ success: true });
      } catch (error) {
        console.error("Error saving PRM-Face API URL:", error);
        res.status(500).json({ error: "Failed to save API URL" });
      }
    });
  
    app.post("/api/prm-face/generate-key", async (req, res) => {
      if (!req.isAuthenticated()) return res.status(401).json({ error: "Not authenticated" });
      const { setupCode, label } = req.body;
      if (!setupCode) return res.status(400).json({ error: "setupCode is required" });
  
      const apiUrl = await getPrmFaceSetting("prm_face_api_url");
      if (!apiUrl) return res.status(400).json({ error: "API URL is not configured" });
  
      try {
        const params = new URLSearchParams();
        params.append("setup_code", setupCode);
        params.append("label", label || "prm-app");
        params.append("database_url", process.env.DATABASE_URL || "");
        params.append("s3_endpoint", process.env.S3_ENDPOINT || "");
        params.append("s3_bucket", process.env.S3_BUCKET || "");
        params.append("s3_access_key", process.env.S3_ACCESS_KEY || "");
        params.append("s3_secret_key", process.env.S3_SECRET_KEY || "");
  
        const response = await fetch(`${prmBase(apiUrl)}/api/get-api-key`, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: params.toString(),
        });
  
        if (!response.ok) {
          const errBody = await response.text();
          return res.status(response.status).json({ error: `PRM-Face error: ${errBody}` });
        }
  
        const data = await response.json() as { api_key: string; key_id: string; message?: string };
        await setPrmFaceSetting("prm_face_api_key", data.api_key);
        await setPrmFaceSetting("prm_face_key_id", data.key_id);
  
        res.json({ success: true, message: "API key generated and stored successfully." });
      } catch (error: any) {
        console.error("Error generating PRM-Face API key:", error);
        res.status(500).json({ error: `Failed to contact PRM-Face server: ${error.message}` });
      }
    });

    app.get("/api/prm-face/config", async (req, res) => {
      if (!req.isAuthenticated()) return res.status(401).json({ error: "Not authenticated" });
      const apiUrl = await getPrmFaceSetting("prm_face_api_url");
      if (!apiUrl) return res.status(400).json({ error: "PRM-Face API URL is not configured." });
      const apiKey = await getPrmFaceSetting("prm_face_api_key");
      if (!apiKey) return res.status(400).json({ error: "PRM-Face API key is not configured." });

      try {
        const response = await fetch(`${prmBase(apiUrl)}/api/face/config`, {
          headers: { "x-api-key": apiKey },
          signal: AbortSignal.timeout(10000),
        });
        if (!response.ok) {
          const body = await response.text();
          return res.status(response.status).json({ error: `PRM-Face error: ${body}` });
        }
        res.json(await response.json());
      } catch (error: any) {
        res.status(500).json({ error: `Failed to contact PRM-Face: ${error.message}` });
      }
    });

    app.post("/api/prm-face/config", async (req, res) => {
      if (!req.isAuthenticated()) return res.status(401).json({ error: "Not authenticated" });
      const apiUrl = await getPrmFaceSetting("prm_face_api_url");
      if (!apiUrl) return res.status(400).json({ error: "PRM-Face API URL is not configured." });
      const apiKey = await getPrmFaceSetting("prm_face_api_key");
      if (!apiKey) return res.status(400).json({ error: "PRM-Face API key is not configured." });

      const { maxFaces, minFaceSize, sureness } = req.body;
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
          }),
          signal: AbortSignal.timeout(10000),
        });
        if (!response.ok) {
          const body = await response.text();
          return res.status(response.status).json({ error: `PRM-Face error: ${body}` });
        }
        res.json(await response.json());
      } catch (error: any) {
        res.status(500).json({ error: `Failed to contact PRM-Face: ${error.message}` });
      }
    });

    // Delete all recognition-pipeline images & faces and reset PRM-Face.
    // Wipes face crops + faces rows on the PRM-Face side, then deletes pipeline
    // photos (posts/interactions/notes — NOT profile avatars) and their S3
    // files locally, and strips every face association from people and posts.
    app.post("/api/prm-face/reset-images", async (req, res) => {
      if (!req.isAuthenticated()) return res.status(401).json({ error: "Not authenticated" });
      try {
        // 1. Reset PRM-Face (best-effort). If it isn't configured or is offline
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
            const response = await fetch(`${prmBase(apiUrl)}/api/face/reset-all`, {
              method: "POST",
              headers: { "x-api-key": apiKey },
            });
            if (response.ok) {
              faceService.ok = true;
              faceService.result = await response.json();
            } else {
              faceService.error = `PRM-Face error ${response.status}: ${await response.text()}`;
            }
          } catch (err: any) {
            faceService.error = `Failed to contact PRM-Face: ${err.message}`;
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

    async function getImageBuffer(location: string): Promise<Buffer> {
      if (isLocalImageUrl(location)) {
        const localPath = getLocalImagePath(location);
        if (!localPath) throw new Error("Invalid local image path");
        return fs.promises.readFile(localPath);
      } else {
        const response = await fetch(location);
        if (!response.ok) {
          throw new Error(`Failed to fetch image from ${location}: status ${response.status}`);
        }
        return Buffer.from(await response.arrayBuffer());
      }
    }

    async function describeImageWithOllama(photoId: string): Promise<string> {
      const [photo] = await db.select().from(photos).where(eq(photos.id, photoId));
      if (!photo) throw new Error("Photo not found");

      const apiUrl = (await getOllamaSetting("ollama_api_url")) ?? "";
      if (!apiUrl.trim()) throw new Error("No Ollama API URL configured");

      const model = (await getOllamaSetting("ollama_model")) ?? "llava";
      
      const faces = (photo.facialIds as any[]) || [];
      const resolvedFaces: string[] = [];
      for (const face of faces) {
        let name = "unknown person";
        if (face.personId) {
          const [person] = await db.select().from(people).where(eq(people.id, face.personId));
          if (person) {
            name = `${person.firstName} ${person.lastName}`;
          }
        }
        
        const coordStr = face.coordinates 
          ? `at bounds [x:${face.coordinates.x}, y:${face.coordinates.y}, w:${face.coordinates.w}, h:${face.coordinates.h}]`
          : "";
        resolvedFaces.push(`Face ${coordStr}: ${name}`);
      }

      let prompt = (await getOllamaSetting("ollama_prompt")) || "Describe what is happening in this image.";
      if (resolvedFaces.length > 0) {
        prompt += `\n\nFor context, the following people have been recognized in the image:\n${resolvedFaces.join("\n")}`;
      }

      console.log(`[Ollama Describe] prompt: ${prompt}`);

      const buffer = await getImageBuffer(photo.location);
      const imageBase64 = buffer.toString("base64");

      const base = apiUrl.replace(/\/+$/, "");
      const authRequired = (await getOllamaSetting("ollama_auth_required")) === "true";
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (authRequired) {
        const username = (await getOllamaSetting("ollama_username")) ?? "";
        const password = (await getOllamaSetting("ollama_password")) ?? "";
        headers["Authorization"] = "Basic " + Buffer.from(`${username}:${password}`).toString("base64");
      }

      const response = await fetch(`${base}/api/generate`, {
        method: "POST",
        headers,
        body: JSON.stringify({ model, prompt, images: [imageBase64], stream: false }),
        signal: AbortSignal.timeout(60000),
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Ollama API error (${response.status}): ${text}`);
      }

      const data = await response.json() as { response?: string };
      const description = data.response ?? "";

      await db.update(photos)
        .set({
          imageDescription: description,
          imageDescriptionAt: new Date(),
        })
        .where(eq(photos.id, photoId));

      return description;
    }

    app.post("/api/prm-face/img/add-interactive", upload.single("image"), async (req, res) => {
      if (!req.isAuthenticated()) return res.status(401).json({ error: "Not authenticated" });
      if (!req.file) return res.status(400).json({ error: "No image file provided" });

      try {
        let storageMode = "s3";
        if (req.user) {
          storageMode = await storage.getImageStorageMode(req.user.id);
        }

        let imageUrl: string;
        if (storageMode === "local") {
          imageUrl = await uploadImageLocally(
            req.file.buffer,
            req.file.originalname,
            req.file.mimetype
          );
        } else {
          imageUrl = await uploadImageToS3(
            req.file.buffer,
            req.file.originalname,
            req.file.mimetype
          );
        }

        const prmLocation = (req.body?.prmLocation as string) || "unknown";
        const photo = await storage.insertPhoto({ location: imageUrl, prmLocation, isSubImage: false });

        const apiUrl = await getPrmFaceSetting("prm_face_api_url");
        const apiKey = await getPrmFaceSetting("prm_face_api_key");

        let faceDetectionData: any = { faces_detected: 0, results: [] };
        if (apiUrl && apiKey) {
          try {
            const formData = new FormData();
            formData.append("image", new Blob([req.file.buffer], { type: req.file.mimetype }), req.file.originalname || "image.jpg");
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
              console.warn("PRM-Face img/add sync call failed with status:", response.status);
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
            userId: req.user?.id || null,
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
              console.warn("[PRM-Face] failed to assign face:", await assignRes.text());
            }
          } catch (assignErr: any) {
            console.warn("[PRM-Face] assign error:", assignErr.message);
          }
        }

        const pendingQuestions = await db.select()
          .from(imageQuestions)
          .where(and(eq(imageQuestions.photoId, question.photoId), eq(imageQuestions.status, "pending")));

        let descriptionGenerated = false;
        let description = "";
        if (pendingQuestions.length === 0) {
          const ollamaEnabled = (await getOllamaSetting("ollama_enabled")) === "true";
          if (ollamaEnabled) {
            try {
              description = await describeImageWithOllama(question.photoId);
              descriptionGenerated = true;
            } catch (ollamaErr: any) {
              console.error("Error auto-describing photo:", ollamaErr.message);
            }
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
      const { photoId, assignments, waitOllama } = req.body;
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
              userId: req.user?.id || null,
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
        if (waitOllama) {
          try {
            description = await describeImageWithOllama(photoId);
          } catch (err: any) {
            console.error("Error generating Ollama description:", err.message);
          }
        }

        res.json({ success: true, description });
      } catch (error: any) {
        console.error("Error saving photo assignments:", error);
        res.status(500).json({ error: error.message });
      }
    });

    app.post("/api/img/describe-llm", async (req, res) => {
      if (!req.isAuthenticated()) return res.status(401).json({ error: "Not authenticated" });
      const { photoId } = req.body;
      if (!photoId) return res.status(400).json({ error: "photoId is required" });

      try {
        const description = await describeImageWithOllama(photoId);
        res.json({ success: true, description });
      } catch (error: any) {
        console.error("Error describing image:", error);
        res.status(500).json({ error: error.message });
      }
    });
  
    app.post("/api/prm-face/test", async (req, res) => {
      if (!req.isAuthenticated()) return res.status(401).json({ error: "Not authenticated" });
  
      const apiUrl = await getPrmFaceSetting("prm_face_api_url");
      if (!apiUrl) return res.json({ ok: false, message: "API URL is not configured." });
  
      try {
        const response = await fetch(`${prmBase(apiUrl)}/api/setup-status`, {
          signal: AbortSignal.timeout(8000),
        });
        if (!response.ok) {
          return res.json({ ok: false, message: `PRM-Face responded with status ${response.status}.` });
        }
        const data = await response.json() as { setup_completed: boolean };
        const msg = data.setup_completed
          ? "PRM-Face is online and fully set up."
          : "PRM-Face is online but setup has not been completed yet — generate an API key first.";
        res.json({ ok: true, message: msg });
      } catch (error: any) {
        res.json({ ok: false, message: `Could not reach PRM-Face server: ${error.message}` });
      }
    });
  
    app.get("/api/prm-face/img/list", async (req, res) => {
      if (!req.isAuthenticated()) return res.status(401).json({ error: "Not authenticated" });
      const apiUrl = await getPrmFaceSetting("prm_face_api_url");
      if (!apiUrl) return res.status(400).json({ error: "PRM-Face API URL is not configured." });
      const apiKey = await getPrmFaceSetting("prm_face_api_key");
      if (!apiKey) return res.status(400).json({ error: "PRM-Face API key is not configured." });
      const { page = "1", page_size = "24" } = req.query as Record<string, string>;
      try {
        const response = await fetch(
          `${prmBase(apiUrl)}/api/img/list?page=${page}&page_size=${page_size}`,
          { headers: { "x-api-key": apiKey }, signal: AbortSignal.timeout(15000) }
        );
        if (!response.ok) {
          if (response.status === 404 || response.status === 405) {
            return res.status(401).json({ error: "API_KEY_INVALID" });
          }
          const body = await response.text();
          return res.status(response.status).json({ error: `PRM-Face error: ${body}` });
        }
        res.json(await response.json());
      } catch (error: any) {
        res.status(500).json({ error: `Failed to contact PRM-Face: ${error.message}` });
      }
    });
  
    app.get("/api/prm-face/img/detail", async (req, res) => {
      if (!req.isAuthenticated()) return res.status(401).json({ error: "Not authenticated" });
      const { uuid } = req.query as { uuid?: string };
      if (!uuid) return res.status(400).json({ error: "uuid is required" });
      const apiUrl = await getPrmFaceSetting("prm_face_api_url");
      if (!apiUrl) return res.status(400).json({ error: "PRM-Face API URL is not configured." });
      const apiKey = await getPrmFaceSetting("prm_face_api_key");
      if (!apiKey) return res.status(400).json({ error: "PRM-Face API key is not configured." });
      try {
        const response = await fetch(
          `${prmBase(apiUrl)}/api/img/get?uuid=${encodeURIComponent(uuid)}`,
          { headers: { "x-api-key": apiKey }, signal: AbortSignal.timeout(10000) }
        );
        if (!response.ok) {
          const body = await response.text();
          return res.status(response.status).json({ error: `PRM-Face error: ${body}` });
        }
        res.json(await response.json());
      } catch (error: any) {
        res.status(500).json({ error: `Failed to contact PRM-Face: ${error.message}` });
      }
    });
  
    app.get("/api/prm-face/img/detail-enriched", async (req, res) => {
      if (!req.isAuthenticated()) return res.status(401).json({ error: "Not authenticated" });
      const { uuid } = req.query as { uuid?: string };
      if (!uuid) return res.status(400).json({ error: "uuid is required" });
      const apiUrl = await getPrmFaceSetting("prm_face_api_url");
      if (!apiUrl) return res.status(400).json({ error: "PRM-Face API URL is not configured." });
      const apiKey = await getPrmFaceSetting("prm_face_api_key");
      if (!apiKey) return res.status(400).json({ error: "PRM-Face API key is not configured." });
      try {
        // 1. Fetch raw face detail from PRM-face
        const response = await fetch(
          `${prmBase(apiUrl)}/api/img/get?uuid=${encodeURIComponent(uuid)}`,
          { headers: { "x-api-key": apiKey }, signal: AbortSignal.timeout(10000) }
        );
        if (!response.ok) {
          const body = await response.text();
          return res.status(response.status).json({ error: `PRM-Face error: ${body}` });
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
              nickname: socialProfileVersions.nickname,
            })
            .from(socialAccounts)
            .leftJoin(socialProfileVersions,
              and(
                eq(socialProfileVersions.socialAccountId, socialAccounts.id),
                eq(socialProfileVersions.isCurrent, true)
              )
            )
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
        res.status(500).json({ error: `Failed to contact PRM-Face: ${error.message}` });
      }
    });
  
    app.post("/api/prm-face/face/assign-bulk", async (req, res) => {
      if (!req.isAuthenticated()) return res.status(401).json({ error: "Not authenticated" });
      const apiUrl = await getPrmFaceSetting("prm_face_api_url");
      if (!apiUrl) return res.status(400).json({ error: "PRM-Face API URL is not configured." });
      const apiKey = await getPrmFaceSetting("prm_face_api_key");
      if (!apiKey) return res.status(400).json({ error: "PRM-Face API key is not configured." });
      try {
        const response = await fetch(`${prmBase(apiUrl)}/api/face/assign-bulk`, {
          method: "POST",
          headers: { "x-api-key": apiKey, "Content-Type": "application/json" },
          body: JSON.stringify(req.body),
          signal: AbortSignal.timeout(15000),
        });
        if (!response.ok) {
          const body = await response.text();
          return res.status(response.status).json({ error: `PRM-Face error: ${body}` });
        }
        res.json(await response.json());
      } catch (error: any) {
        res.status(500).json({ error: `Failed to contact PRM-Face: ${error.message}` });
      }
    });
  
    app.get("/api/prm-face/face/list", async (req, res) => {
      if (!req.isAuthenticated()) return res.status(401).json({ error: "Not authenticated" });
      const apiUrl = await getPrmFaceSetting("prm_face_api_url");
      if (!apiUrl) return res.status(400).json({ error: "PRM-Face API URL is not configured." });
      const apiKey = await getPrmFaceSetting("prm_face_api_key");
      if (!apiKey) return res.status(400).json({ error: "PRM-Face API key is not configured." });
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
          return res.status(response.status).json({ error: `PRM-Face error: ${body}` });
        }
        res.json(await response.json());
      } catch (error: any) {
        res.status(500).json({ error: `Failed to contact PRM-Face: ${error.message}` });
      }
    });
  
    app.delete("/api/prm-face/img/delete", async (req, res) => {
      if (!req.isAuthenticated()) return res.status(401).json({ error: "Not authenticated" });
      const { image_uuid } = req.query as Record<string, string>;
      if (!image_uuid) return res.status(400).json({ error: "image_uuid is required." });
      const apiUrl = await getPrmFaceSetting("prm_face_api_url");
      if (!apiUrl) return res.status(400).json({ error: "PRM-Face API URL is not configured." });
      const apiKey = await getPrmFaceSetting("prm_face_api_key");
      if (!apiKey) return res.status(400).json({ error: "PRM-Face API key is not configured." });
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
          return res.status(response.status).json({ error: `PRM-Face error: ${body}` });
        }
        res.json(await response.json());
      } catch (error: any) {
        res.status(500).json({ error: `Failed to contact PRM-Face: ${error.message}` });
      }
    });
  
    app.post("/api/prm-face/img/add", upload.single("image"), async (req, res) => {
      if (!req.isAuthenticated()) return res.status(401).json({ error: "Not authenticated" });
      if (!req.file) return res.status(400).json({ error: "No image provided." });
      const apiUrl = await getPrmFaceSetting("prm_face_api_url");
      if (!apiUrl) return res.status(400).json({ error: "PRM-Face API URL is not configured." });
      const apiKey = await getPrmFaceSetting("prm_face_api_key");
      if (!apiKey) return res.status(400).json({ error: "PRM-Face API key is not configured." });
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
          return res.status(response.status).json({ error: `PRM-Face error: ${body}` });
        }
        res.json(await response.json());
      } catch (error: any) {
        res.status(500).json({ error: `Failed to contact PRM-Face: ${error.message}` });
      }
    });
  
    app.post("/api/prm-face/pickout-temp", upload.single("image"), async (req, res) => {
      if (!req.isAuthenticated()) return res.status(401).json({ error: "Not authenticated" });
      if (!req.file) return res.status(400).json({ error: "No image provided" });
  
      const apiUrl = await getPrmFaceSetting("prm_face_api_url");
      if (!apiUrl) return res.status(400).json({ error: "PRM-Face API URL is not configured." });
  
      const apiKey = await getPrmFaceSetting("prm_face_api_key");
      if (!apiKey) return res.status(400).json({ error: "PRM-Face API key is not configured. Generate one in Settings → Recognition." });
  
      try {
        const formData = new FormData();
        const blob = new Blob([req.file.buffer], { type: req.file.mimetype });
        formData.append("image", blob, req.file.originalname || "image.jpg");
  
        const response = await fetch(`${prmBase(apiUrl)}/api/img/temp-lookup`, {
          method: "POST",
          headers: { "X-API-Key": apiKey },
          body: formData,
          signal: AbortSignal.timeout(30000),
        });

        if (!response.ok) {
          const errBody = await response.text();
          return res.status(response.status).json({ error: `PRM-Face error: ${errBody}` });
        }

        const data = await response.json() as { faces_detected?: number; results?: any[]; faces?: any[] };
        // PRM-Face returns detected faces under `results`; the demo UI reads `faces`.
        const detectedFaces = data.results ?? data.faces ?? [];
        res.json({ faces_detected: data.faces_detected ?? detectedFaces.length, faces: detectedFaces });
      } catch (error: any) {
        console.error("Error calling PRM-Face pickout-temp:", error);
        res.status(500).json({ error: `Failed to contact PRM-Face server: ${error.message}` });
      }
    });
  
    app.post("/api/prm-face/save-with-assignments", upload.single("image"), async (req, res) => {
      if (!req.isAuthenticated()) return res.status(401).json({ error: "Not authenticated" });
      if (!req.file) return res.status(400).json({ error: "No image provided." });
  
      const apiUrl = await getPrmFaceSetting("prm_face_api_url");
      if (!apiUrl) return res.status(400).json({ error: "PRM-Face API URL is not configured." });
      const apiKey = await getPrmFaceSetting("prm_face_api_key");
      if (!apiKey) return res.status(400).json({ error: "PRM-Face API key is not configured." });
  
      let assignments: Array<{ face_index: number; person_uuid?: string; social_account_id?: string; is_social_account: boolean; label?: string }> = [];
      if (req.body.assignments) {
        try {
          assignments = JSON.parse(req.body.assignments);
        } catch {
          return res.status(400).json({ error: "Invalid assignments JSON." });
        }
      }
  
      try {
        // Step 1: Upload image to PRM-Face
        const formData = new FormData();
        formData.append("image", new Blob([req.file.buffer], { type: req.file.mimetype }), req.file.originalname || "image.jpg");
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
          return res.status(response.status).json({ error: `PRM-Face error: ${body}` });
        }
        const prmData = await response.json() as { image_uuid?: string; faces?: Array<{ face_uuid: string; face_index?: number }> };
  
        // Step 2: Map face_index → face_uuid from the img/add response
        const faces: Array<{ face_uuid: string; face_index?: number }> = prmData.faces ?? [];
        const faceByIndex = new Map<number, string>();
        faces.forEach((f, arrayIdx) => {
          const idx = f.face_index ?? arrayIdx;
          faceByIndex.set(idx, f.face_uuid);
        });
  
        // Step 3: Build bulk assign payload — person assignments only (not social accounts)
        const bulkAssignments = assignments
          .filter((a) => !a.is_social_account && a.person_uuid && faceByIndex.has(a.face_index))
          .map((a) => ({
            face_uuid: faceByIndex.get(a.face_index)!,
            person_uuid: a.person_uuid!,
            name: a.label ?? undefined,
          }));
  
        // Step 4: Persist the face-to-person links (non-fatal if it fails)
        if (bulkAssignments.length > 0) {
          try {
            const assignRes = await fetch(`${prmBase(apiUrl)}/api/face/assign-bulk`, {
              method: "POST",
              headers: { "x-api-key": apiKey, "Content-Type": "application/json" },
              body: JSON.stringify({ assignments: bulkAssignments }),
              signal: AbortSignal.timeout(15000),
            });
            if (!assignRes.ok) {
              const assignBody = await assignRes.text();
              console.warn("[PRM-Face] face/assign-bulk failed:", assignBody);
            }
          } catch (assignErr: any) {
            console.warn("[PRM-Face] face/assign-bulk error:", assignErr.message);
          }
        }
  
        res.json({ ...prmData, assignments });
      } catch (error: any) {
        res.status(500).json({ error: `Failed to contact PRM-Face: ${error.message}` });
      }
    });
  
    app.post("/api/prm-face/reset-all", async (req, res) => {
      if (!req.isAuthenticated()) return res.status(401).json({ error: "Not authenticated" });
  
      const apiUrl = await getPrmFaceSetting("prm_face_api_url");
      if (!apiUrl) return res.status(400).json({ error: "PRM-Face API URL is not configured." });
      const apiKey = await getPrmFaceSetting("prm_face_api_key");
      if (!apiKey) return res.status(400).json({ error: "PRM-Face API key is not configured." });
  
      try {
        const response = await fetch(`${prmBase(apiUrl)}/api/reset/all`, {
          method: "POST",
          headers: { "x-api-key": apiKey },
          signal: AbortSignal.timeout(30000),
        });
        if (!response.ok) {
          const body = await response.text();
          return res.status(response.status).json({ error: `PRM-Face error: ${body}` });
        }
        res.json({ ok: true });
      } catch (error: any) {
        res.status(500).json({ error: `Failed to contact PRM-Face: ${error.message}` });
      }
    });
  
    // ── Facial Intelligence feature flag ─────────────────────────────────────
  
    app.get("/api/prm-face/facial-intelligence", async (req, res) => {
      if (!req.isAuthenticated()) return res.status(401).json({ error: "Not authenticated" });
      try {
        const val = await getPrmFaceSetting("facial_intelligence_enabled");
        res.json({ enabled: val === "true" });
      } catch (error) {
        res.status(500).json({ error: "Failed to fetch setting" });
      }
    });
  
    app.post("/api/prm-face/facial-intelligence", async (req, res) => {
      if (!req.isAuthenticated()) return res.status(401).json({ error: "Not authenticated" });
      const { enabled } = req.body;
      if (typeof enabled !== "boolean") return res.status(400).json({ error: "enabled must be a boolean" });
      try {
        await setPrmFaceSetting("facial_intelligence_enabled", enabled ? "true" : "false");
        res.json({ success: true });
      } catch (error) {
        res.status(500).json({ error: "Failed to save setting" });
      }
    });
  
    // ── Person photos (gated by facial intelligence flag) ─────────────────────
  
    app.get("/api/prm-face/person-photos/:personUuid", async (req, res) => {
      if (!req.isAuthenticated()) return res.status(401).json({ error: "Not authenticated" });
  
      const enabled = await getPrmFaceSetting("facial_intelligence_enabled");
      if (enabled !== "true") return res.status(403).json({ error: "Facial intelligence features are disabled." });
  
      const { personUuid } = req.params;
      const apiUrl = await getPrmFaceSetting("prm_face_api_url");
      if (!apiUrl) return res.status(400).json({ error: "PRM-Face API URL is not configured." });
      const apiKey = await getPrmFaceSetting("prm_face_api_key");
      if (!apiKey) return res.status(400).json({ error: "PRM-Face API key is not configured." });
  
      const page = parseInt((req.query.page as string) ?? "1", 10);
      const pageSize = parseInt((req.query.page_size as string) ?? "24", 10);
  
      try {
        const response = await fetch(
          `${prmBase(apiUrl)}/api/face/list?page=${page}&page_size=${pageSize}&person_uuid=${encodeURIComponent(personUuid)}`,
          { headers: { "x-api-key": apiKey }, signal: AbortSignal.timeout(15000) }
        );
        if (!response.ok) {
          if (response.status === 401 || response.status === 404 || response.status === 405) {
            return res.status(401).json({ error: "API_KEY_INVALID" });
          }
          const body = await response.text();
          return res.status(response.status).json({ error: `PRM-Face error: ${body}` });
        }
  
        const data = await response.json() as {
          total?: number; page?: number; page_size?: number; total_pages?: number; faces?: any[];
        };
        const faces: any[] = data.faces ?? [];
  
        // Collect only images that contain at least one face belonging to the requested person
        const matchingImageUuids = new Set<string>(
          faces
            .filter(f => f.image_uuid && f.person_uuid === personUuid)
            .map(f => f.image_uuid)
        );
  
        // Group ALL faces on those images (so face_count is accurate), but skip images
        // that have no face linked to the requested person
        const imageMap = new Map<string, { image_uuid: string; faceUuids: string[] }>();
        for (const face of faces) {
          if (!face.image_uuid || !matchingImageUuids.has(face.image_uuid)) continue;
          if (!imageMap.has(face.image_uuid)) {
            imageMap.set(face.image_uuid, { image_uuid: face.image_uuid, faceUuids: [] });
          }
          if (face.face_uuid) imageMap.get(face.image_uuid)!.faceUuids.push(face.face_uuid);
        }
  
        const base = prmBase(apiUrl);
        const images = [...imageMap.values()].map(img => ({
          image_uuid: img.image_uuid,
          image_url: `${base}/img/${img.image_uuid}.jpg`,
          thumb_url: `${base}/img-sml/${img.image_uuid}.webp`,
          face_count: img.faceUuids.length,
        }));
  
        res.json({
          total: data.total ?? faces.length,
          page: data.page ?? page,
          page_size: data.page_size ?? pageSize,
          total_pages: data.total_pages ?? 1,
          images,
          api_url: base,
        });
      } catch (error: any) {
        res.status(500).json({ error: `Failed to contact PRM-Face: ${error.message}` });
      }
    });
  
    // ── Ollama AI Description ─────────────────────────────────────────────────
  
    async function getOllamaSetting(key: string): Promise<string | null> {
      const row = await db.query.appSettings?.findFirst({ where: (t, { eq }) => eq(t.key, key) });
      return row?.value ?? null;
    }
  
    async function setOllamaSetting(key: string, value: string): Promise<void> {
      await db.execute(
        sql`INSERT INTO app_settings (key, value) VALUES (${key}, ${value})
            ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`
      );
    }
  
    app.get("/api/ollama/settings", async (req, res) => {
      if (!req.isAuthenticated()) return res.status(401).json({ error: "Not authenticated" });
      try {
        const enabled = (await getOllamaSetting("ollama_enabled")) ?? "false";
        const apiUrl = (await getOllamaSetting("ollama_api_url")) ?? "";
        const authRequired = (await getOllamaSetting("ollama_auth_required")) ?? "false";
        const username = (await getOllamaSetting("ollama_username")) ?? "";
        const hasPassword = !!((await getOllamaSetting("ollama_password")));
        const model = (await getOllamaSetting("ollama_model")) ?? "";
        const textModel = (await getOllamaSetting("ollama_text_model")) ?? "";
        const prompt = (await getOllamaSetting("ollama_prompt")) ?? "";
        const eventsModel = (await getOllamaSetting("ollama_events_model")) ?? "";
        const eventsPrompt = (await getOllamaSetting("ollama_events_prompt")) ?? "";
        const familyTreeModel = (await getOllamaSetting("ollama_family_tree_model")) ?? "";
        const autoDescribeImages = (await getOllamaSetting("ollama_auto_describe_images")) ?? "false";
        const sexGuessModel = (await getOllamaSetting("ollama_sex_guess_model")) ?? "";
        res.json({ enabled: enabled === "true", apiUrl, authRequired: authRequired === "true", username, hasPassword, model, textModel, prompt, eventsModel, eventsPrompt, familyTreeModel, autoDescribeImages: autoDescribeImages === "true", sexGuessModel });
      } catch (error) {
        res.status(500).json({ error: "Failed to fetch Ollama settings" });
      }
    });
  
    app.post("/api/ollama/settings", async (req, res) => {
      if (!req.isAuthenticated()) return res.status(401).json({ error: "Not authenticated" });
      const { enabled, apiUrl, authRequired, username, password, model, textModel, prompt, eventsModel, eventsPrompt, familyTreeModel, autoDescribeImages, sexGuessModel } = req.body;
      try {
        if (typeof enabled === "boolean") await setOllamaSetting("ollama_enabled", String(enabled));
        if (typeof apiUrl === "string") await setOllamaSetting("ollama_api_url", apiUrl.trim());
        if (typeof authRequired === "boolean") await setOllamaSetting("ollama_auth_required", String(authRequired));
        if (typeof username === "string") await setOllamaSetting("ollama_username", username);
        if (typeof password === "string" && password.length > 0) await setOllamaSetting("ollama_password", password);
        if (typeof model === "string") await setOllamaSetting("ollama_model", model);
        if (typeof textModel === "string") await setOllamaSetting("ollama_text_model", textModel);
        if (typeof prompt === "string") await setOllamaSetting("ollama_prompt", prompt);
        if (typeof eventsModel === "string") await setOllamaSetting("ollama_events_model", eventsModel);
        if (typeof eventsPrompt === "string") await setOllamaSetting("ollama_events_prompt", eventsPrompt);
        if (typeof familyTreeModel === "string") await setOllamaSetting("ollama_family_tree_model", familyTreeModel);
        if (typeof autoDescribeImages === "boolean") await setOllamaSetting("ollama_auto_describe_images", String(autoDescribeImages));
        if (typeof sexGuessModel === "string") await setOllamaSetting("ollama_sex_guess_model", sexGuessModel);
        res.json({ success: true });
      } catch (error) {
        res.status(500).json({ error: "Failed to save Ollama settings" });
      }
    });
  
    app.get("/api/ollama/models", async (req, res) => {
      if (!req.isAuthenticated()) return res.status(401).json({ error: "Not authenticated" });
      try {
        const apiUrl = (await getOllamaSetting("ollama_api_url")) ?? "";
        if (!apiUrl.trim()) return res.json({ models: [] });
        const base = apiUrl.replace(/\/+$/, "");
        const authRequired = (await getOllamaSetting("ollama_auth_required")) === "true";
        const headers: Record<string, string> = {};
        if (authRequired) {
          const username = (await getOllamaSetting("ollama_username")) ?? "";
          const password = (await getOllamaSetting("ollama_password")) ?? "";
          headers["Authorization"] = "Basic " + Buffer.from(`${username}:${password}`).toString("base64");
        }
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 8000);
        try {
          const resp = await fetch(`${base}/api/tags`, { headers, signal: controller.signal });
          clearTimeout(timeout);
          if (!resp.ok) return res.json({ models: [] });
          const data = await resp.json() as { models?: { name: string; size: number; details?: { parameter_size?: string } }[] };
          const models = (data.models ?? []).map((m) => ({
            name: m.name,
            parameterSize: m.details?.parameter_size ?? null,
          }));
          res.json({ models });
        } catch {
          clearTimeout(timeout);
          res.json({ models: [] });
        }
      } catch (error: any) {
        res.status(500).json({ error: error.message });
      }
    });
  
    app.post("/api/ollama/test", async (req, res) => {
      if (!req.isAuthenticated()) return res.status(401).json({ error: "Not authenticated" });
      try {
        const apiUrl = (typeof req.body.apiUrl === "string" && req.body.apiUrl.trim())
          ? req.body.apiUrl.trim()
          : ((await getOllamaSetting("ollama_api_url")) ?? "");
        if (!apiUrl.trim()) return res.json({ ok: false, message: "No API URL configured." });
        const base = apiUrl.replace(/\/+$/, "");
        const authRequired = (typeof req.body.authRequired === "boolean")
          ? req.body.authRequired
          : ((await getOllamaSetting("ollama_auth_required")) === "true");
        const headers: Record<string, string> = {};
        if (authRequired) {
          const username = (typeof req.body.username === "string" ? req.body.username : null)
            ?? (await getOllamaSetting("ollama_username")) ?? "";
          const password = (typeof req.body.password === "string" && req.body.password.length > 0 ? req.body.password : null)
            ?? (await getOllamaSetting("ollama_password")) ?? "";
          headers["Authorization"] = "Basic " + Buffer.from(`${username}:${password}`).toString("base64");
        }
        const testUrl = `${base}/api/tags`;
        console.log(`[Ollama test] url=${testUrl} auth=${authRequired} hasAuthHeader=${!!headers["Authorization"]}`);
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 8000);
        try {
          const resp = await fetch(testUrl, { headers, signal: controller.signal });
          clearTimeout(timeout);
          if (resp.ok) {
            const data = await resp.json() as { models?: { name: string }[] };
            const count = data.models?.length ?? 0;
            res.json({ ok: true, message: `Connected. ${count} model${count !== 1 ? "s" : ""} available.` });
          } else {
            let detail = "";
            try {
              const body = await resp.text();
              if (body.trim()) detail = ` — ${body.trim().slice(0, 200)}`;
            } catch {}
            console.log(`[Ollama test] status=${resp.status}${detail}`);
            if (resp.status === 401) {
              res.json({ ok: false, message: `Authentication required (401). Check your username and password.` });
            } else if (resp.status === 403) {
              res.json({ ok: false, message: `Access denied (403). Credentials were sent but rejected by the server.${detail}` });
            } else {
              res.json({ ok: false, message: `Server responded with ${resp.status}${detail}` });
            }
          }
        } catch (err: any) {
          clearTimeout(timeout);
          if (err.name === "AbortError") {
            res.json({ ok: false, message: "Connection timed out after 8 seconds." });
          } else {
            res.json({ ok: false, message: `Connection failed: ${err.message}` });
          }
        }
      } catch (error: any) {
        res.status(500).json({ error: error.message });
      }
    });
  
    app.post("/api/ollama/describe", upload.single("image"), async (req, res) => {
      if (!req.isAuthenticated()) return res.status(401).json({ error: "Not authenticated" });
      try {
        const apiUrl = (await getOllamaSetting("ollama_api_url")) ?? "";
        if (!apiUrl.trim()) return res.status(400).json({ error: "No Ollama API URL configured." });
        const base = apiUrl.replace(/\/+$/, "");
        const authRequired = (await getOllamaSetting("ollama_auth_required")) === "true";
        const headers: Record<string, string> = { "Content-Type": "application/json" };
        if (authRequired) {
          const username = (await getOllamaSetting("ollama_username")) ?? "";
          const password = (await getOllamaSetting("ollama_password")) ?? "";
          headers["Authorization"] = "Basic " + Buffer.from(`${username}:${password}`).toString("base64");
        }
        if (!req.file) return res.status(400).json({ error: "No image provided." });
        const imageBase64 = req.file.buffer.toString("base64");
        const savedModel = (await getOllamaSetting("ollama_model")) ?? "";
        const model = (req.body.model as string | undefined) || savedModel || "llava";
        const savedPrompt = (await getOllamaSetting("ollama_prompt")) ?? "";
        const prompt = (req.body.prompt as string | undefined) || savedPrompt || "Return 2 sentences explaining what is happening in this image.";
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 60000);
        try {
          const resp = await fetch(`${base}/api/generate`, {
            method: "POST",
            headers,
            body: JSON.stringify({ model, prompt, images: [imageBase64], stream: false }),
            signal: controller.signal,
          });
          clearTimeout(timeout);
          if (!resp.ok) {
            const text = await resp.text();
            return res.status(502).json({ error: `Ollama returned ${resp.status}: ${text.slice(0, 200)}` });
          }
          const data = await resp.json() as { response?: string; error?: string };
          if (data.error) return res.status(502).json({ error: data.error });
          res.json({ description: data.response ?? "" });
        } catch (err: any) {
          clearTimeout(timeout);
          if (err.name === "AbortError") {
            res.status(504).json({ error: "Request timed out after 60 seconds." });
          } else {
            res.status(502).json({ error: `Failed to reach Ollama: ${err.message}` });
          }
        }
      } catch (error: any) {
        res.status(500).json({ error: error.message });
      }
    });
  
    // ── AI Chat (Ollama text chat) ────────────────────────────────────────────
  
    const DEFAULT_CHAT_MODEL = "llama3";
    const DEFAULT_PRM_SYSTEM_MESSAGE =
      "You are an intelligent assistant integrated with a Personal Relationship Manager (PRM). " +
      "You have access to tools that allow you to read live data from the PRM — including people, " +
      "social accounts, notes, interactions, and daily notes. When the user asks about a person, " +
      "their notes, relationships, social accounts, or any stored data, always call the appropriate " +
      "tool to look up the current information rather than guessing. Use person_search to find " +
      "someone by name, person_pull to get their full details (which returns up to 10 relationships/notes/interactions as a brief overview), " +
      "person_pull_relationships to get up to 20 relationships (ideal when specifically asked about siblings, friends, family, or colleagues), and the other available tools as " +
      "needed. Combine tool results with your own reasoning to give accurate, helpful answers. " +
      "Important note: You also have a super_search tool which performs a semantic search across the entire PRM. " +
      "You should only use this tool if other specific search tools (like person_search, note_search, daily_note_search, interaction_search, or social_account_search) yield no results or yield bad/unhelpful results. " +
      "You can send clickable links that will appear as buttons at the bottom of the chat bubble. " +
      "You must use this capability to link the user to relevant data profiles (people, social accounts, images, etc.) or to pages where they can manage settings, data types, or make changes. " +
      "To include a link, format it exactly as: \"URL\"{title} (for example, \"/person/some-uuid\"{John Doe} or \"https://instagram.com/jdoe\"{Instagram Profile}). " +
      "You can place these links inline in your text or at the end of your response. The system will automatically parse them, convert them to standard markdown links in your text, and display them as clickable buttons at the bottom of the chat bubble. " +
      "Always use the exact \"URL\"{title} format. Never write links as plain text or standard markdown. " +
      "Examples of internal links you can use: " +
      "- People: \"/person/UUID\"{Person Name} (or \"/person\"{Person Name} to resolve by name lookup) " +
      "- Social accounts: \"/social-accounts/UUID\"{Username} (or \"/social-accounts\"{Username} to resolve by username lookup) " +
      "- Images: \"/image/UUID\"{Image Description} " +
      "- Groups: \"/group/UUID\"{Group Name} " +
      "- Daily Notes: \"/daily-notes/UUID\"{Date} " +
      "- Settings: \"/settings/user\"{User Settings}, \"/settings/data-types\"{Data Types}, \"/settings/experimental\"{Experimental Settings}, \"/settings/import-export/application\"{Import/Export Application}. " +
      "Examples of external links you can use: \"https://example.com\"{Example website}. " +
      "Always include these links when discussing specific people, social accounts, images, or configuration pages so that the user can navigate to them directly.";
    const MAX_CHAT_TITLE_LENGTH = 60;
    const DEFAULT_EVENTS_SYSTEM_PROMPT = [
      "You extract a list of distinct events from a daily journal entry.",
      "An \"event\" is a concrete thing that happened that day: meetings, calls, meals, travel, milestones, decisions, conversations, or notable observations.",
      "Each event must be a short, standalone past-tense statement (one sentence, ideally under 120 characters).",
      "Do not include opinions, plans for the future, or generic reflections. Do not invent events that aren't supported by the text.",
      "Return strictly the JSON shape requested by the schema: { \"events\": [ { \"text\": string } ] }. If no events are present, return { \"events\": [] }.",
    ].join(" ");
  
    // Helper: build Ollama request headers (with optional basic auth)
    async function buildOllamaChatContext(): Promise<{ base: string; headers: Record<string, string> } | null> {
      const apiUrl = (await getOllamaSetting("ollama_api_url")) ?? "";
      if (!apiUrl.trim()) return null;
      const base = apiUrl.replace(/\/+$/, "");
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      const authRequired = (await getOllamaSetting("ollama_auth_required")) === "true";
      if (authRequired) {
        const username = (await getOllamaSetting("ollama_username")) ?? "";
        const password = (await getOllamaSetting("ollama_password")) ?? "";
        headers["Authorization"] = "Basic " + Buffer.from(`${username}:${password}`).toString("base64");
      }
      return { base, headers };
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
          return out;
        });
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
  
    /** Build the text payload sent to Ollama for a message that has file attachments. */
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
      const enabledRaw = await getOllamaSetting("ai_tools_enabled");
      const enabled = enabledRaw === null || enabledRaw === undefined ? true : enabledRaw === "true";
      const perToolRaw = await getOllamaSetting("ai_tools_per_tool");
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
      const modeRaw = await getOllamaSetting("ai_tools_execution_mode");
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
          await setOllamaSetting("ai_tools_enabled", String(req.body.enabled));
        }
        if (typeof req.body.executionMode === "string") {
          const mode = parseExecutionMode(req.body.executionMode);
          await setOllamaSetting("ai_tools_execution_mode", mode);
        }
        if (req.body.perTool && typeof req.body.perTool === "object") {
          const current = (await readAiToolSettings()).perTool;
          const patch = req.body.perTool as Record<string, unknown>;
          const next: Record<string, boolean> = { ...current };
          for (const k of Object.keys(patch)) {
            if (typeof patch[k] === "boolean") next[k] = patch[k] as boolean;
          }
          await setOllamaSetting("ai_tools_per_tool", JSON.stringify(next));
        }
        const settings = await readAiToolSettings();
        res.json(settings);
      } catch (error: any) {
        res.status(500).json({ error: error.message });
      }
    });
  
    // ── Tool-call approval bus ───────────────────────────────────────────────
    // When a write tool is invoked while executionMode === "auth", the
    // streaming chat loop registers a pending approval here keyed by id and
    // awaits the resulting promise. The client posts the user's decision to
    // POST /api/ai-tools/approvals/:id and the loop resumes.
    type ApprovalDecision = "accept" | "reject";
    const pendingApprovals = new Map<string, {
      userId: number;
      resolve: (decision: ApprovalDecision) => void;
    }>();
  
    function awaitApproval(id: string, userId: number): Promise<ApprovalDecision> {
      return new Promise((resolve) => {
        pendingApprovals.set(id, { userId, resolve });
      });
    }
  
    app.post("/api/ai-tools/approvals/:id", async (req, res) => {
      if (!req.isAuthenticated()) return res.status(401).json({ error: "Not authenticated" });
      const id = req.params.id;
      const decision = req.body?.decision === "accept" ? "accept"
        : req.body?.decision === "reject" ? "reject" : null;
      if (!decision) return res.status(400).json({ error: "decision must be 'accept' or 'reject'" });
      const pending = pendingApprovals.get(id);
      if (!pending) return res.status(404).json({ error: "approval_not_found" });
      if (pending.userId !== req.user!.id) return res.status(403).json({ error: "forbidden" });
      pendingApprovals.delete(id);
      pending.resolve(decision);
      res.json({ ok: true });
    });
  
    type StreamingToolLoopParams = {
      res: import("express").Response;
      ctx: { base: string; headers: Record<string, string> };
      model: string;
      /** Initial messages array (system + history + new user). */
      initialMessages: { role: string; content: string; tool_call_id?: string; name?: string }[];
      userId: number;
    };
  
    /**
     * Drives the multi-step tool-calling chat with Ollama, streaming each chunk
     * back to the client over the open SSE connection. Returns the final
     * assistant content + tool-call trace once the model produces a normal
     * answer (or the iteration cap is hit).
     */
    async function runStreamingChatWithTools(p: StreamingToolLoopParams): Promise<{
      assistantContent: string;
      toolCalls: AiToolCallTrace[];
      newMessages: any[];
    }> {
      const { res, ctx, model, userId } = p;
      const messages: any[] = [...p.initialMessages];
      const { names: toolNames, executionMode } = await activeToolNames();
      const tools = toolNames.size > 0 ? buildOllamaToolsArray(toolNames) : undefined;
      const toolTrace: AiToolCallTrace[] = [];
  
      const writeLine = (obj: unknown) => {
        res.write(JSON.stringify(obj) + "\n");
        (res as any).flush?.();
      };
  
      const MAX_ITERATIONS = 5;
      // Per-iteration timeout (5 minutes total budget for the whole loop).
      const overallController = new AbortController();
      const overallTimeout = setTimeout(() => overallController.abort(), 300000);
  
      try {
        for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
          // Per-iteration controller chained to the overall budget.
          const iterController = new AbortController();
          const onAbort = () => iterController.abort();
          overallController.signal.addEventListener("abort", onAbort);
  
          let ollamaResp: Response;
          try {
            ollamaResp = await fetch(`${ctx.base}/api/chat`, {
              method: "POST",
              headers: { ...ctx.headers, "Content-Type": "application/json" },
              body: JSON.stringify({ model, messages, stream: true, options: { num_predict: -1 }, ...(tools ? { tools } : {}) }),
              signal: iterController.signal,
            });
          } catch (err: any) {
            overallController.signal.removeEventListener("abort", onAbort);
            writeLine({ error: `Failed to reach Ollama: ${err.message}` });
            return { assistantContent: "", toolCalls: toolTrace, newMessages: messages.slice(p.initialMessages.length) };
          }
          if (!ollamaResp.ok) {
            overallController.signal.removeEventListener("abort", onAbort);
            const text = await ollamaResp.text();
            writeLine({ error: `Ollama returned ${ollamaResp.status}: ${text.slice(0, 200)}` });
            return { assistantContent: "", toolCalls: toolTrace, newMessages: messages.slice(p.initialMessages.length) };
          }
  
          const decoder = new TextDecoder();
          const reader = ollamaResp.body!.getReader();
          let lineBuffer = "";
          let assistantContentThisIter = "";
          let pendingToolCalls: any[] = [];
          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              lineBuffer += decoder.decode(value, { stream: true });
              const lines = lineBuffer.split("\n");
              lineBuffer = lines.pop() ?? "";
              for (const line of lines) {
                if (!line.trim()) continue;
                let parsed: any;
                try { parsed = JSON.parse(line); } catch { continue; }
                if (parsed?.error) {
                  writeLine({ error: parsed.error });
                  continue;
                }
                const msgPart = parsed?.message ?? {};
                if (Array.isArray(msgPart.tool_calls) && msgPart.tool_calls.length > 0) {
                  // Buffer tool calls — do NOT forward content chunks to the client
                  // for this iteration; they're internal model reasoning.
                  pendingToolCalls.push(...msgPart.tool_calls);
                } else if (typeof msgPart.content === "string" && msgPart.content.length > 0) {
                  // Forward only when there are no pending tool calls in this
                  // iteration. If the model later produces tool_calls in this
                  // same iteration, the partial text is dropped (Ollama doesn't
                  // mix them in practice).
                  assistantContentThisIter += msgPart.content;
                  writeLine(parsed);
                }
              }
            }
          } finally {
            reader.releaseLock();
            overallController.signal.removeEventListener("abort", onAbort);
          }
  
          if (pendingToolCalls.length === 0) {
            // Model produced its final answer — return.
            messages.push({
              role: "assistant",
              content: assistantContentThisIter,
            });
            return {
              assistantContent: assistantContentThisIter,
              toolCalls: toolTrace,
              newMessages: messages.slice(p.initialMessages.length),
            };
          }
  
          // Persist the assistant tool-call turn into the message list so
          // subsequent Ollama calls include it.
          messages.push({
            role: "assistant",
            content: assistantContentThisIter,
            tool_calls: pendingToolCalls,
          });
  
          // Execute each tool call, emit visualization events, and append the
          // resulting tool messages.
          for (const tc of pendingToolCalls) {
            const fn = tc?.function ?? {};
            const name = typeof fn.name === "string" ? fn.name : "";
            let rawArgs = fn.arguments;
            if (typeof rawArgs === "string") {
              try { rawArgs = JSON.parse(rawArgs); } catch { rawArgs = {}; }
            }
            const args = (rawArgs && typeof rawArgs === "object") ? rawArgs as Record<string, unknown> : {};
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
                tool_name: name,
                tool_call_id: tc?.id,
                content: JSON.stringify({ error: summary })
              });
              continue;
            }
            writeLine({ event: "tool_call", id, name: def.name, label: def.label, icon: def.icon, args });
            // Write tools are gated by the execution mode setting.
            if (def.write) {
              if (executionMode === "off") {
                const summary = "Write tools are disabled";
                writeLine({ event: "tool_result", id, ok: false, summary });
                toolTrace.push({ name: def.name, icon: def.icon, label: def.label, args, summary, ok: false });
                messages.push({
                  role: "tool",
                  name: def.name,
                  tool_name: def.name,
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
                const decision = await awaitApproval(id, userId);
                writeLine({ event: "tool_approval_decision", id, decision });
                if (decision === "reject") {
                  const summary = "Rejected by user";
                  writeLine({ event: "tool_result", id, ok: false, summary });
                  toolTrace.push({ name: def.name, icon: def.icon, label: def.label, args, summary, ok: false });
                  messages.push({
                    role: "tool",
                    name: def.name,
                    tool_name: def.name,
                    tool_call_id: tc?.id,
                    content: JSON.stringify({ error: "user_rejected" })
                  });
                  continue;
                }
              }
            }
            try {
              const result = await def.handler(args, { userId });
              writeLine({ event: "tool_result", id, ok: true, summary: result.summary });
              toolTrace.push({ name: def.name, icon: def.icon, label: def.label, args, summary: result.summary, ok: true });
              messages.push({
                role: "tool",
                name: def.name,
                tool_name: def.name,
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
                tool_name: def.name,
                tool_call_id: tc?.id,
                content: JSON.stringify({ error: summary })
              });
            }
          }
          // Loop continues; next /api/chat call will see the tool messages.
        }
  
        // Iteration cap hit — emit a synthetic final answer.
        const fallback = "I reached the tool-call limit before producing a final answer. Please refine your question.";
        writeLine({ message: { role: "assistant", content: fallback } });
        messages.push({
          role: "assistant",
          content: fallback,
        });
        return {
          assistantContent: fallback,
          toolCalls: toolTrace,
          newMessages: messages.slice(p.initialMessages.length),
        };
      } finally {
        clearTimeout(overallTimeout);
      }
    }
  
    // List all chats for the current user (most recently updated first)
    app.get("/api/ai-chats", async (req, res) => {
      if (!req.isAuthenticated()) return res.status(401).json({ error: "Not authenticated" });
      try {
        const rows = await db.query.aiChats.findMany({
          where: (t, { eq }) => eq(t.userId, req.user!.id),
          orderBy: (t, { desc }) => [desc(t.updatedAt)],
        });
        res.json(rows.map((r) => ({
          id: r.id,
          title: r.title,
          systemMessage: r.systemMessage,
          model: r.model,
          messageCount: Array.isArray(r.messages)
            ? (r.messages as any[]).filter(
                (m) => m.role === "user" || m.role === "assistant"
              ).length
            : 0,
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
          where: (t, { eq, and }) => and(eq(t.id, req.params.id), eq(t.userId, req.user!.id)),
        });
        if (!row) return res.status(404).json({ error: "Chat not found" });
        const clientMessages = (row.messages as any[]).filter(
          (m) => m.role === "user" || m.role === "assistant"
        );
        res.json({ ...row, messages: clientMessages });
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
        const [row] = await db.insert(aiChats).values({
          userId: req.user!.id,
          title,
          systemMessage,
          model,
          messages: [],
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
          where: (t, { eq, and }) => and(eq(t.id, req.params.id), eq(t.userId, req.user!.id)),
        });
        if (!existing) return res.status(404).json({ error: "Chat not found" });
        const patch: Record<string, unknown> = { updatedAt: new Date() };
        if (typeof req.body.title === "string") patch.title = req.body.title.trim() || "New chat";
        if (typeof req.body.systemMessage === "string") patch.systemMessage = req.body.systemMessage;
        if (typeof req.body.model === "string") patch.model = req.body.model;
        if (req.body.messages !== undefined) patch.messages = sanitizeChatMessages(req.body.messages);
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
          where: (t, { eq, and }) => and(eq(t.id, req.params.id), eq(t.userId, req.user!.id)),
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
          where: (t, { eq, and }) => and(eq(t.id, req.params.id), eq(t.userId, req.user!.id)),
        });
        if (!chat) return res.status(404).json({ error: "Chat not found" });
  
        const ctx = await buildOllamaChatContext();
        if (!ctx) return res.status(400).json({ error: "No Ollama API URL configured." });
  
        // Prefer the chat's per-conversation model when set, otherwise fall back to global settings.
        const chatModel = (chat.model ?? "").trim();
        const textModel = (await getOllamaSetting("ollama_text_model")) ?? "";
        const model = chatModel || textModel || ((await getOllamaSetting("ollama_model")) ?? "") || DEFAULT_CHAT_MODEL;
  
        const history = sanitizeChatMessages(chat.messages);
        const userMessage: AiChatMessage = hasAttachments
          ? { role: "user", content: message, attachments }
          : { role: "user", content: message };
  
        // Build the messages payload for Ollama, including the system message if present.
        const ollamaMessages: any[] = [];
        const systemMessage = chat.systemMessage?.trim();
        ollamaMessages.push({ role: "system", content: systemMessage || DEFAULT_PRM_SYSTEM_MESSAGE });
        for (const m of history) {
          if (m.role === "tool") {
            ollamaMessages.push({
              role: "tool",
              name: m.name,
              tool_name: m.tool_name || m.name,
              tool_call_id: m.tool_call_id,
              content: m.content
            });
          } else if (m.role === "assistant") {
            ollamaMessages.push({
              role: "assistant",
              content: m.content || "",
              ...(m.tool_calls ? { tool_calls: m.tool_calls } : {})
            });
          } else {
            ollamaMessages.push({ role: m.role, content: renderMessageWithAttachments(m) });
          }
        }
        ollamaMessages.push({ role: "user", content: renderMessageWithAttachments(userMessage) });
  
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 120000);
        let assistantContent = "";
        try {
          const resp = await fetch(`${ctx.base}/api/chat`, {
            method: "POST",
            headers: ctx.headers,
            body: JSON.stringify({ model, messages: ollamaMessages, stream: false, options: { num_predict: -1 } }),
            signal: controller.signal,
          });
          clearTimeout(timeout);
          if (!resp.ok) {
            const text = await resp.text();
            return res.status(502).json({ error: `Ollama returned ${resp.status}: ${text.slice(0, 200)}` });
          }
          const data = await resp.json() as { message?: { content?: string }; error?: string };
          if (data.error) return res.status(502).json({ error: data.error });
          assistantContent = data.message?.content ?? "";
        } catch (err: any) {
          clearTimeout(timeout);
          if (err.name === "AbortError") {
            return res.status(504).json({ error: "Request timed out after 120 seconds." });
          }
          return res.status(502).json({ error: `Failed to reach Ollama: ${err.message}` });
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
        const clientMessages = (updated.messages as any[]).filter(
          (m) => m.role === "user" || m.role === "assistant"
        );
        res.json({ chat: { ...updated, messages: clientMessages }, assistant: assistantMessage });
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
          where: (t, { eq, and }) => and(eq(t.id, req.params.id), eq(t.userId, req.user!.id)),
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
  
        const ctx = await buildOllamaChatContext();
        if (!ctx) return res.status(400).json({ error: "No Ollama API URL configured." });
  
        const chatModel = (chat.model ?? "").trim();
        const textModel = (await getOllamaSetting("ollama_text_model")) ?? "";
        const model = chatModel || textModel || ((await getOllamaSetting("ollama_model")) ?? "") || DEFAULT_CHAT_MODEL;
  
        const userMessage: AiChatMessage = hasAttachments
          ? { role: "user", content: message, attachments }
          : { role: "user", content: message };
  
        const ollamaMessages: { role: string; content: string }[] = [];
        const systemMessage = chat.systemMessage?.trim();
        ollamaMessages.push({ role: "system", content: systemMessage || DEFAULT_PRM_SYSTEM_MESSAGE });
        for (const m of trimmed) ollamaMessages.push({ role: m.role, content: renderMessageWithAttachments(m) });
        ollamaMessages.push({ role: "user", content: renderMessageWithAttachments(userMessage) });
  
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 120000);
        let assistantContent = "";
        try {
          const resp = await fetch(`${ctx.base}/api/chat`, {
            method: "POST",
            headers: ctx.headers,
            body: JSON.stringify({ model, messages: ollamaMessages, stream: false }),
            signal: controller.signal,
          });
          clearTimeout(timeout);
          if (!resp.ok) {
            const text = await resp.text();
            return res.status(502).json({ error: `Ollama returned ${resp.status}: ${text.slice(0, 200)}` });
          }
          const data = await resp.json() as { message?: { content?: string }; error?: string };
          if (data.error) return res.status(502).json({ error: data.error });
          assistantContent = data.message?.content ?? "";
        } catch (err: any) {
          clearTimeout(timeout);
          if (err.name === "AbortError") {
            return res.status(504).json({ error: "Request timed out after 120 seconds." });
          }
          return res.status(502).json({ error: `Failed to reach Ollama: ${err.message}` });
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
  
    // Streaming version of the message endpoint — forwards Ollama NDJSON tokens to the client
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
          where: (t, { eq, and }) => and(eq(t.id, req.params.id), eq(t.userId, req.user!.id)),
        });
        if (!chat) return res.status(404).json({ error: "Chat not found" });
  
        const ctx = await buildOllamaChatContext();
        if (!ctx) return res.status(400).json({ error: "No Ollama API URL configured." });
  
        const chatModel = (chat.model ?? "").trim();
        const textModel = (await getOllamaSetting("ollama_text_model")) ?? "";
        const model = chatModel || textModel || ((await getOllamaSetting("ollama_model")) ?? "") || DEFAULT_CHAT_MODEL;
  
        const history = sanitizeChatMessages(chat.messages);
        const userMessage: AiChatMessage = hasAttachments
          ? { role: "user", content: message, attachments }
          : { role: "user", content: message };
  
        const ollamaMessages: any[] = [];
        const systemMessage = chat.systemMessage?.trim();
        ollamaMessages.push({ role: "system", content: systemMessage || DEFAULT_PRM_SYSTEM_MESSAGE });
        for (const m of history) {
          if (m.role === "tool") {
            ollamaMessages.push({
              role: "tool",
              name: m.name,
              tool_name: m.tool_name || m.name,
              tool_call_id: m.tool_call_id,
              content: m.content
            });
          } else if (m.role === "assistant") {
            ollamaMessages.push({
              role: "assistant",
              content: m.content || "",
              ...(m.tool_calls ? { tool_calls: m.tool_calls } : {})
            });
          } else {
            ollamaMessages.push({ role: m.role, content: renderMessageWithAttachments(m) });
          }
        }
        ollamaMessages.push({ role: "user", content: renderMessageWithAttachments(userMessage) });
  
        // text/event-stream is understood by every reverse-proxy as "do not buffer";
        // flush headers immediately so the browser opens the stream before Ollama replies.
        res.setHeader("Content-Type", "text/event-stream");
        res.setHeader("Cache-Control", "no-cache");
        res.setHeader("Connection", "keep-alive");
        res.setHeader("X-Accel-Buffering", "no");
        res.flushHeaders();
  
        const { assistantContent, toolCalls, newMessages } = await runStreamingChatWithTools({
          res,
          ctx,
          model,
          initialMessages: ollamaMessages,
          userId: req.user!.id,
        });
  
        const resolvedLinks = await resolveLinksInText(assistantContent);
        const cleanedContent = cleanRawLinks(assistantContent, resolvedLinks);
        const assistantMessage: any = { role: "assistant", content: cleanedContent };
        if (toolCalls.length) assistantMessage.toolCalls = toolCalls;
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
        const clientMessages = (updated.messages as any[]).filter(
          (m) => m.role === "user" || m.role === "assistant"
        );
        res.write(JSON.stringify({ done: true, chat: { ...updated, messages: clientMessages } }) + "\n");
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
          where: (t, { eq, and }) => and(eq(t.id, req.params.id), eq(t.userId, req.user!.id)),
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
  
        const ctx = await buildOllamaChatContext();
        if (!ctx) return res.status(400).json({ error: "No Ollama API URL configured." });
  
        const chatModel = (chat.model ?? "").trim();
        const textModel = (await getOllamaSetting("ollama_text_model")) ?? "";
        const model = chatModel || textModel || ((await getOllamaSetting("ollama_model")) ?? "") || DEFAULT_CHAT_MODEL;
  
        const userMessage: AiChatMessage = hasAttachments
          ? { role: "user", content: message, attachments }
          : { role: "user", content: message };
  
        const ollamaMessages: any[] = [];
        const systemMessage = chat.systemMessage?.trim();
        ollamaMessages.push({ role: "system", content: systemMessage || DEFAULT_PRM_SYSTEM_MESSAGE });
        for (const m of trimmed) {
          if (m.role === "tool") {
            ollamaMessages.push({
              role: "tool",
              name: m.name,
              tool_name: m.tool_name || m.name,
              tool_call_id: m.tool_call_id,
              content: m.content
            });
          } else if (m.role === "assistant") {
            ollamaMessages.push({
              role: "assistant",
              content: m.content || "",
              ...(m.tool_calls ? { tool_calls: m.tool_calls } : {})
            });
          } else {
            ollamaMessages.push({ role: m.role, content: renderMessageWithAttachments(m) });
          }
        }
        ollamaMessages.push({ role: "user", content: renderMessageWithAttachments(userMessage) });
  
        res.setHeader("Content-Type", "text/event-stream");
        res.setHeader("Cache-Control", "no-cache");
        res.setHeader("Connection", "keep-alive");
        res.setHeader("X-Accel-Buffering", "no");
        res.flushHeaders();
  
        const { assistantContent, toolCalls, newMessages } = await runStreamingChatWithTools({
          res,
          ctx,
          model,
          initialMessages: ollamaMessages,
          userId: req.user!.id,
        });
  
        const resolvedLinks = await resolveLinksInText(assistantContent);
        const cleanedContent = cleanRawLinks(assistantContent, resolvedLinks);
        const assistantMessage: any = { role: "assistant", content: cleanedContent };
        if (toolCalls.length) assistantMessage.toolCalls = toolCalls;
        // links is compatible with JSONB message object
        if (resolvedLinks.length) assistantMessage.links = resolvedLinks.map(l => ({ url: l.url, title: l.title }));
        
        const intermediateMessages = newMessages.slice(0, -1);
        const updatedMessages = [...trimmed, userMessage, ...intermediateMessages, assistantMessage];
        const [updated] = await db.update(aiChats)
          .set({ messages: updatedMessages, updatedAt: new Date() })
          .where(eq(aiChats.id, chat.id))
          .returning();
        syncEntityInBackground("ai_chat", chat.id);
        const clientMessages = (updated.messages as any[]).filter(
          (m) => m.role === "user" || m.role === "assistant"
        );
        res.write(JSON.stringify({ done: true, chat: { ...updated, messages: clientMessages } }) + "\n");
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
          where: (t, { eq, and }) => and(eq(t.id, req.params.id), eq(t.userId, req.user!.id)),
        });
        if (!source) return res.status(404).json({ error: "Chat not found" });
        const newModel = typeof req.body.model === "string" ? req.body.model : (source.model ?? "");
        const baseTitle = source.title || "New chat";
        const branchedTitle = `${baseTitle} (branch)`.slice(0, MAX_CHAT_TITLE_LENGTH);
        const [row] = await db.insert(aiChats).values({
          userId: req.user!.id,
          title: branchedTitle,
          systemMessage: source.systemMessage,
          model: newModel,
          messages: sanitizeChatMessages(source.messages),
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
  
    // Use the configured Ollama text model + events prompt to extract a structured
    // list of events from a daily-note markdown body. Uses Ollama's `format` JSON
    // schema parameter to constrain the model to a deterministic shape.
    app.post("/api/daily-notes/generate-events", async (req, res) => {
      if (!req.isAuthenticated()) return res.status(401).json({ error: "Not authenticated" });
      try {
        const schema = z.object({ body: z.string() });
        const { body } = schema.parse(req.body);
        if (!body.trim()) return res.status(400).json({ error: "Body is empty." });
  
        const ctx = await buildOllamaChatContext();
        if (!ctx) return res.status(400).json({ error: "No Ollama API URL configured." });
  
        const eventsModel = ((await getOllamaSetting("ollama_events_model")) ?? "").trim();
        const fallbackTextModel = ((await getOllamaSetting("ollama_text_model")) ?? "").trim();
        const fallbackModel = ((await getOllamaSetting("ollama_model")) ?? "").trim();
        const model = eventsModel || fallbackTextModel || fallbackModel;
        if (!model) return res.status(400).json({ error: "No Ollama model configured for event extraction." });
  
        const customPrompt = ((await getOllamaSetting("ollama_events_prompt")) ?? "").trim();
        const systemPrompt = customPrompt || DEFAULT_EVENTS_SYSTEM_PROMPT;
  
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
  
        const ollamaMessages = [
          { role: "system", content: systemPrompt },
          { role: "user", content: body },
        ];
  
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 120000);
        try {
          const resp = await fetch(`${ctx.base}/api/chat`, {
            method: "POST",
            headers: ctx.headers,
            body: JSON.stringify({ model, messages: ollamaMessages, stream: false, format: responseFormat }),
            signal: controller.signal,
          });
          clearTimeout(timeout);
          if (!resp.ok) {
            const text = await resp.text();
            return res.status(502).json({ error: `Ollama returned ${resp.status}: ${text.slice(0, 200)}` });
          }
          const data = await resp.json() as { message?: { content?: string }; error?: string };
          if (data.error) return res.status(502).json({ error: data.error });
          const content = data.message?.content ?? "";
  
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
          clearTimeout(timeout);
          if (err.name === "AbortError") {
            return res.status(504).json({ error: "Request timed out after 120 seconds." });
          }
          return res.status(502).json({ error: `Failed to reach Ollama: ${err.message}` });
        }
      } catch (error: any) {
        res.status(400).json({ error: error.message });
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
          events: z.array(z.object({ text: z.string(), position: z.number().int() })).optional(),
          involvedParties: z.array(z.object({ partyType: z.enum(["person", "social_account", "group"]), refId: z.string() })).optional(),
          pin: z.string().optional(),
        });
        const parsed = schema.parse(req.body);
        const { events, involvedParties, pin: _pin, ...noteData } = parsed;
        if (Object.keys(noteData).length > 0) await storage.updateDailyNote(req.params.id, noteData);
        if (events !== undefined) await storage.replaceDailyNoteEvents(req.params.id, events);
        if (involvedParties !== undefined) await storage.replaceDailyNoteParties(req.params.id, involvedParties);
        // Add audit log for the edit
        await storage.addDailyNoteAuditLog(req.params.id, "edited", needsPin);
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
        });
      } catch (error: any) {
        res.status(500).json({ error: error.message });
      }
    });
  
    app.post("/api/vector/settings", async (req, res) => {
      if (!req.isAuthenticated()) return res.status(401).json({ error: "Not authenticated" });
      const { enabled, qdrantUrl, qdrantApiKey, collectionName, embeddingModel } = req.body ?? {};
      try {
        if (typeof enabled === "boolean") await setVectorSetting("vector_enabled", String(enabled));
        if (typeof qdrantUrl === "string") await setVectorSetting("vector_qdrant_url", qdrantUrl.trim());
        if (typeof qdrantApiKey === "string" && qdrantApiKey.length > 0) {
          await setVectorSetting("vector_qdrant_api_key", qdrantApiKey);
        }
        if (typeof collectionName === "string" && collectionName.trim().length > 0) {
          await setVectorSetting("vector_collection", collectionName.trim());
        }
        if (typeof embeddingModel === "string") {
          const previous = (await getVectorSetting("vector_embedding_model")) ?? "";
          await setVectorSetting("vector_embedding_model", embeddingModel);
          // If the embedding model changed, existing vectors are no longer valid.
          // Clear vector_synced_at so vectorize-all picks them up; the per-note
          // vector_id is preserved so re-embeds upsert in place.
          if (previous && previous !== embeddingModel) {
            await db.update(dailyNotes).set({ vectorSyncedAt: null });
          }
        }
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
  
    // List candidate embedding models from the configured Ollama instance.
    app.get("/api/vector/embedding-models", async (req, res) => {
      if (!req.isAuthenticated()) return res.status(401).json({ error: "Not authenticated" });
      try {
        const apiUrl = (await getOllamaSetting("ollama_api_url")) ?? "";
        if (!apiUrl.trim()) return res.json({ models: [] });
        const base = apiUrl.replace(/\/+$/, "");
        const authRequired = (await getOllamaSetting("ollama_auth_required")) === "true";
        const headers: Record<string, string> = {};
        if (authRequired) {
          const username = (await getOllamaSetting("ollama_username")) ?? "";
          const password = (await getOllamaSetting("ollama_password")) ?? "";
          headers["Authorization"] = "Basic " + Buffer.from(`${username}:${password}`).toString("base64");
        }
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 8000);
        try {
          const resp = await fetch(`${base}/api/tags`, { headers, signal: controller.signal });
          clearTimeout(timeout);
          if (!resp.ok) return res.json({ models: [] });
          const data = (await resp.json()) as { models?: { name: string; details?: { parameter_size?: string } }[] };
          const models = (data.models ?? []).map(m => ({
            name: m.name,
            parameterSize: m.details?.parameter_size ?? null,
          }));
          res.json({ models });
        } catch {
          clearTimeout(timeout);
          res.json({ models: [] });
        }
      } catch (error: any) {
        res.status(500).json({ error: error.message });
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
            await upsertDailyNoteVector(full);
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
        });
      } catch (error: any) {
        res.status(500).json({ error: error.message });
      }
    });

    app.post("/api/vector/universal/settings", async (req, res) => {
      if (!req.isAuthenticated()) return res.status(401).json({ error: "Not authenticated" });
      const { enabled, collectionName } = req.body ?? {};
      try {
        if (typeof enabled === "boolean") await setVectorSetting("vector_universal_enabled", String(enabled));
        if (typeof collectionName === "string" && collectionName.trim().length > 0) {
          await setVectorSetting("vector_universal_collection", collectionName.trim());
        }
        res.json({ success: true });
      } catch (error: any) {
        res.status(500).json({ error: error.message });
      }
    });

    // Universal semantic search
    app.post("/api/vector/universal/search", async (req, res) => {
      if (!req.isAuthenticated()) return res.status(401).json({ error: "Not authenticated" });
      const { query, limit, typeFilter } = req.body ?? {};
      if (!query || typeof query !== "string" || !query.trim()) {
        return res.status(400).json({ error: "Missing 'query' field." });
      }
      try {
        const results = await searchUniversal(
          query.trim(),
          Math.min(50, Math.max(1, limit || 20)),
          typeFilter as UniversalEntityType[] | undefined
        );
        res.json({ results });
      } catch (error: any) {
        res.status(500).json({ error: error.message });
      }
    });

    // Bulk vectorize all entities
    app.post("/api/vector/universal/vectorize-all", async (req, res) => {
      if (!req.isAuthenticated()) return res.status(401).json({ error: "Not authenticated" });
      try {
        const result = await bulkSyncAll();
        res.json({ ok: true, ...result });
      } catch (error: any) {
        res.status(500).json({ error: error.message });
      }
    });

    // Reset universal vector sync (clear vector_synced_at on all tables)
    app.post("/api/vector/universal/reset-sync", async (req, res) => {
      if (!req.isAuthenticated()) return res.status(401).json({ error: "Not authenticated" });
      try {
        await db.update(people).set({ vectorSyncedAt: null });
        await db.update(groups).set({ vectorSyncedAt: null });
        await db.update(photos).set({ vectorSyncedAt: null });
        await db.update(notes).set({ vectorSyncedAt: null });
        await db.update(interactions).set({ vectorSyncedAt: null });
        await db.update(socialAccounts).set({ vectorSyncedAt: null });
        await db.update(dailyNotes).set({ vectorSyncedAt: null });
        await db.update(aiChats).set({ vectorSyncedAt: null });
        res.json({ ok: true });
      } catch (error: any) {
        res.status(500).json({ error: error.message });
      }
    });

    // Stats for universal vectorization
    app.get("/api/vector/universal/stats", async (req, res) => {
      if (!req.isAuthenticated()) return res.status(401).json({ error: "Not authenticated" });
      try {
        const tables = [
          { name: "people", table: people },
          { name: "groups", table: groups },
          { name: "photos", table: photos },
          { name: "notes", table: notes },
          { name: "interactions", table: interactions },
          { name: "social_accounts", table: socialAccounts },
          { name: "daily_notes", table: dailyNotes },
          { name: "ai_chats", table: aiChats },
        ];
        const stats: Record<string, { total: number; vectorized: number }> = {};
        for (const { name, table } of tables) {
          const rows = await db
            .select({
              total: sql<number>`COUNT(*)::int`,
              vectorized: sql<number>`COUNT(*) FILTER (WHERE vector_synced_at IS NOT NULL)::int`,
            })
            .from(table);
          const r = rows[0] ?? { total: 0, vectorized: 0 };
          stats[name] = { total: r.total ?? 0, vectorized: r.vectorized ?? 0 };
        }
        res.json(stats);
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

      // Get LLM settings
      const sexGuessModel = (await getOllamaSetting("ollama_sex_guess_model")) ?? "";
      const textModel = sexGuessModel || ((await getOllamaSetting("ollama_text_model")) ?? "");
      if (!textModel) {
        return { generated: 0, error: "No text model configured. Set a Sex Guess model or Text model in Intelligence settings." };
      }

      const ctx = await buildOllamaChatContext();
      if (!ctx) {
        return { generated: 0, error: "Ollama API URL not configured." };
      }

      const prompt = `You are helping classify the sex of people in a personal relationship manager database. Based on their name and account information, guess whether each person is male or female.

For each person, provide your best guess. Respond with valid JSON only - an array of objects with these exact fields:
- "id": the person ID exactly as provided
- "sex": either "male" or "female"  
- "reasoning": a brief one-sentence explanation

People to classify:
${personContexts.join("\n")}

Respond with ONLY a JSON array, no other text.`;

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 60000);
      try {
        const resp = await fetch(`${ctx.base}/api/chat`, {
          method: "POST",
          headers: ctx.headers,
          body: JSON.stringify({
            model: textModel,
            messages: [{ role: "user", content: prompt }],
            stream: false,
          }),
          signal: controller.signal,
        });
        clearTimeout(timeout);

        if (!resp.ok) {
          const errText = await resp.text();
          return { generated: 0, error: `Ollama returned ${resp.status}: ${errText.slice(0, 200)}` };
        }

        const data = await resp.json() as { message?: { content?: string } };
        const content = data?.message?.content ?? "";

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
        clearTimeout(timeout);
        return { generated: 0, error: `Failed to reach Ollama: ${err.message}` };
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

    // Delete all AI chats
    app.delete("/api/ai-chats", async (req, res) => {
      if (!req.isAuthenticated()) return res.status(401).json({ error: "Not authenticated" });
      try {
        await db.delete(aiChats);
        res.json({ success: true });
      } catch (error: any) {
        console.error("Error deleting all chats:", error);
        res.status(500).json({ error: `Failed to delete chats: ${error.message}` });
      }
    });

    // ========================
    // New Face Recognition Proxy Endpoints
    // ========================

    // Single face-to-person manual assignment
    app.post("/api/prm-face/face/assign", async (req, res) => {
      if (!req.isAuthenticated()) return res.status(401).json({ error: "Not authenticated" });
      const apiUrl = await getPrmFaceSetting("prm_face_api_url");
      if (!apiUrl) return res.status(400).json({ error: "PRM-Face API URL is not configured." });
      const apiKey = await getPrmFaceSetting("prm_face_api_key");
      if (!apiKey) return res.status(400).json({ error: "PRM-Face API key is not configured." });

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
          return res.status(response.status).json({ error: `PRM-Face error: ${body}` });
        }
        res.json(await response.json());
      } catch (error: any) {
        res.status(500).json({ error: `Failed to contact PRM-Face: ${error.message}` });
      }
    });

    // Disassociate a face from its group (generates a new unique personface_uuid)
    app.post("/api/prm-face/face/disassociate", async (req, res) => {
      if (!req.isAuthenticated()) return res.status(401).json({ error: "Not authenticated" });
      const { faceUuid } = req.body;
      if (!faceUuid) {
        return res.status(400).json({ error: "faceUuid is required." });
      }

      try {
        const [face] = await db.select().from(faces).where(eq(faces.id, faceUuid));
        if (!face) {
          return res.status(404).json({ error: "Face not found." });
        }

        const newGroupUuid = crypto.randomUUID();

        await db.update(faces)
          .set({ personfaceUuid: newGroupUuid })
          .where(eq(faces.id, faceUuid));

        if (face.photoId) {
          const [photo] = await db.select().from(photos).where(eq(photos.id, face.photoId));
          if (photo && photo.facialIds) {
            let facialIds = (photo.facialIds as any[]) || [];
            let updated = false;
            facialIds = facialIds.map(fid => {
              if (fid.faceUuid === faceUuid) {
                updated = true;
                return {
                  ...fid,
                  personId: null,
                  socialAccountId: null
                };
              }
              return fid;
            });
            if (updated) {
              await db.update(photos)
                .set({ facialIds })
                .where(eq(photos.id, face.photoId));
            }
          }
        }

        res.json({ success: true, newGroupUuid });
      } catch (error: any) {
        console.error("Error in face/disassociate:", error);
        res.status(500).json({ error: error.message });
      }
    });

    // Connect a face group or face to a person or social account
    app.post("/api/prm-face/face/connect", async (req, res) => {
      if (!req.isAuthenticated()) return res.status(401).json({ error: "Not authenticated" });
      const { personfaceUuid, faceUuid, personId, socialAccountId } = req.body;

      if (!faceUuid && !personfaceUuid) {
        return res.status(400).json({ error: "faceUuid or personfaceUuid is required." });
      }

      try {
        let targetPersonfaceUuid = personfaceUuid;
        let resolvedPersonId = personId;

        if (!targetPersonfaceUuid && faceUuid) {
          const [f] = await db.select().from(faces).where(eq(faces.id, faceUuid));
          if (f) {
            targetPersonfaceUuid = f.personfaceUuid;
            if (!targetPersonfaceUuid) {
              targetPersonfaceUuid = crypto.randomUUID();
              await db.update(faces)
                .set({ personfaceUuid: targetPersonfaceUuid })
                .where(eq(faces.id, faceUuid));
            }
          }
        }

        if (!targetPersonfaceUuid) {
          targetPersonfaceUuid = crypto.randomUUID();
        }

        if (socialAccountId && !resolvedPersonId) {
          const [sa] = await db.select().from(socialAccounts).where(eq(socialAccounts.id, socialAccountId));
          if (sa) {
            if (sa.ownerUuid) {
              resolvedPersonId = sa.ownerUuid;
            } else {
              const nameParts = sa.username.trim().split(/\s+/);
              const firstName = nameParts[0] || "Social";
              const lastName = nameParts.slice(1).join(" ") || "User";
              
              const [newPerson] = await db.insert(people).values({
                firstName,
                lastName,
                userId: req.user?.id || null,
              }).returning();
              
              resolvedPersonId = newPerson.id;
              
              await db.update(socialAccounts)
                .set({ ownerUuid: resolvedPersonId })
                .where(eq(socialAccounts.id, socialAccountId));
            }
          }
        }

        if (!resolvedPersonId) {
          return res.status(400).json({ error: "Could not resolve personId." });
        }

        await db.update(people)
          .set({ personfaceUuid: targetPersonfaceUuid })
          .where(eq(people.id, resolvedPersonId));

        if (faceUuid) {
          await db.update(faces)
            .set({ personfaceUuid: targetPersonfaceUuid })
            .where(eq(faces.id, faceUuid));
        }

        const groupFaces = await db.select().from(faces).where(eq(faces.personfaceUuid, targetPersonfaceUuid));
        for (const gf of groupFaces) {
          if (gf.photoId) {
            const [photo] = await db.select().from(photos).where(eq(photos.id, gf.photoId));
            if (photo && photo.facialIds) {
              let facialIds = (photo.facialIds as any[]) || [];
              let updated = false;
              facialIds = facialIds.map(fid => {
                if (fid.faceUuid === gf.id) {
                  updated = true;
                  return {
                    ...fid,
                    personId: resolvedPersonId,
                    socialAccountId: socialAccountId || fid.socialAccountId || null,
                  };
                }
                return fid;
              });
              if (updated) {
                await db.update(photos)
                  .set({ facialIds })
                  .where(eq(photos.id, gf.photoId));
              }
            }
          }
        }

        const apiUrl = await getPrmFaceSetting("prm_face_api_url");
        const apiKey = await getPrmFaceSetting("prm_face_api_key");
        if (apiUrl && apiKey) {
          const [p] = await db.select().from(people).where(eq(people.id, resolvedPersonId));
          const displayName = p ? `${p.firstName} ${p.lastName}` : "User";

          for (const gf of groupFaces) {
            try {
              const params = new URLSearchParams();
              params.append("face_uuid", gf.id);
              params.append("person_uuid", resolvedPersonId);
              params.append("name", displayName);

              await fetch(`${prmBase(apiUrl)}/api/face/assign`, {
                method: "POST",
                headers: {
                  "x-api-key": apiKey,
                  "Content-Type": "application/x-www-form-urlencoded"
                },
                body: params.toString(),
                signal: AbortSignal.timeout(5000),
              });
            } catch (err: any) {
              console.warn(`[PRM-Face] failed to assign face ${gf.id}:`, err.message);
            }
          }
        }

        res.json({ success: true, personId: resolvedPersonId, personfaceUuid: targetPersonfaceUuid });
      } catch (error: any) {
        console.error("Error in face/connect:", error);
        res.status(500).json({ error: error.message });
      }
    });

    // Temp lookup (alias/duplicate of pickout-temp)
    app.post("/api/prm-face/img/temp-lookup", upload.single("image"), async (req, res) => {
      if (!req.isAuthenticated()) return res.status(401).json({ error: "Not authenticated" });
      if (!req.file) return res.status(400).json({ error: "No image provided" });
  
      const apiUrl = await getPrmFaceSetting("prm_face_api_url");
      if (!apiUrl) return res.status(400).json({ error: "PRM-Face API URL is not configured." });
  
      const apiKey = await getPrmFaceSetting("prm_face_api_key");
      if (!apiKey) return res.status(400).json({ error: "PRM-Face API key is not configured." });
  
      try {
        const formData = new FormData();
        const blob = new Blob([req.file.buffer], { type: req.file.mimetype });
        formData.append("image", blob, req.file.originalname || "image.jpg");
        if (req.body.max_faces) formData.append("max_faces", String(req.body.max_faces));
        if (req.body.limit) formData.append("limit", String(req.body.limit));
  
        const response = await fetch(`${prmBase(apiUrl)}/api/img/temp-lookup`, {
          method: "POST",
          headers: { "X-API-Key": apiKey },
          body: formData,
          signal: AbortSignal.timeout(30000),
        });
  
        if (!response.ok) {
          const errBody = await response.text();
          return res.status(response.status).json({ error: `PRM-Face error: ${errBody}` });
        }
  
        res.json(await response.json());
      } catch (error: any) {
        console.error("Error calling PRM-Face temp-lookup:", error);
        res.status(500).json({ error: `Failed to contact PRM-Face server: ${error.message}` });
      }
    });

    // Match image
    app.post("/api/prm-face/img/match", upload.single("image"), async (req, res) => {
      if (!req.isAuthenticated()) return res.status(401).json({ error: "Not authenticated" });
      if (!req.file) return res.status(400).json({ error: "No image provided." });

      const apiUrl = await getPrmFaceSetting("prm_face_api_url");
      if (!apiUrl) return res.status(400).json({ error: "PRM-Face API URL is not configured." });
      const apiKey = await getPrmFaceSetting("prm_face_api_key");
      if (!apiKey) return res.status(400).json({ error: "PRM-Face API key is not configured." });

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
          return res.status(response.status).json({ error: `PRM-Face error: ${body}` });
        }
        res.json(await response.json());
      } catch (error: any) {
        res.status(500).json({ error: `Failed to contact PRM-Face: ${error.message}` });
      }
    });

    // Create person record
    app.post("/api/prm-face/person/add", async (req, res) => {
      if (!req.isAuthenticated()) return res.status(401).json({ error: "Not authenticated" });
      const apiUrl = await getPrmFaceSetting("prm_face_api_url");
      if (!apiUrl) return res.status(400).json({ error: "PRM-Face API URL is not configured." });
      const apiKey = await getPrmFaceSetting("prm_face_api_key");
      if (!apiKey) return res.status(400).json({ error: "PRM-Face API key is not configured." });
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
          return res.status(response.status).json({ error: `PRM-Face error: ${body}` });
        }
        res.json(await response.json());
      } catch (error: any) {
        res.status(500).json({ error: `Failed to contact PRM-Face: ${error.message}` });
      }
    });

    // Merge person records
    app.post("/api/prm-face/person/merge", async (req, res) => {
      if (!req.isAuthenticated()) return res.status(401).json({ error: "Not authenticated" });
      const apiUrl = await getPrmFaceSetting("prm_face_api_url");
      if (!apiUrl) return res.status(400).json({ error: "PRM-Face API URL is not configured." });
      const apiKey = await getPrmFaceSetting("prm_face_api_key");
      if (!apiKey) return res.status(400).json({ error: "PRM-Face API key is not configured." });
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
          return res.status(response.status).json({ error: `PRM-Face error: ${body}` });
        }
        res.json(await response.json());
      } catch (error: any) {
        res.status(500).json({ error: `Failed to contact PRM-Face: ${error.message}` });
      }
    });

    // Delete person
    app.delete("/api/prm-face/person/remove", async (req, res) => {
      if (!req.isAuthenticated()) return res.status(401).json({ error: "Not authenticated" });
      const apiUrl = await getPrmFaceSetting("prm_face_api_url");
      if (!apiUrl) return res.status(400).json({ error: "PRM-Face API URL is not configured." });
      const apiKey = await getPrmFaceSetting("prm_face_api_key");
      if (!apiKey) return res.status(400).json({ error: "PRM-Face API key is not configured." });
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
          return res.status(response.status).json({ error: `PRM-Face error: ${body}` });
        }
        res.json(await response.json());
      } catch (error: any) {
        res.status(500).json({ error: `Failed to contact PRM-Face: ${error.message}` });
      }
    });

    // Get image info
    app.get("/api/prm-face/img/get", async (req, res) => {
      if (!req.isAuthenticated()) return res.status(401).json({ error: "Not authenticated" });
      const uuid = req.query.uuid as string;
      if (!uuid) return res.status(400).json({ error: "uuid is required." });
      const apiUrl = await getPrmFaceSetting("prm_face_api_url");
      if (!apiUrl) return res.status(400).json({ error: "PRM-Face API URL is not configured." });
      const apiKey = await getPrmFaceSetting("prm_face_api_key");
      if (!apiKey) return res.status(400).json({ error: "PRM-Face API key is not configured." });
      try {
        const response = await fetch(`${prmBase(apiUrl)}/api/img/get?uuid=${uuid}`, {
          headers: { "x-api-key": apiKey },
          signal: AbortSignal.timeout(15000),
        });
        if (!response.ok) {
          const body = await response.text();
          return res.status(response.status).json({ error: `PRM-Face error: ${body}` });
        }
        res.json(await response.json());
      } catch (error: any) {
        res.status(500).json({ error: `Failed to contact PRM-Face: ${error.message}` });
      }
    });

    // Get face details
    app.get("/api/prm-face/face/get", async (req, res) => {
      if (!req.isAuthenticated()) return res.status(401).json({ error: "Not authenticated" });
      const uuid = req.query.uuid as string;
      if (!uuid) return res.status(400).json({ error: "uuid is required." });
      const apiUrl = await getPrmFaceSetting("prm_face_api_url");
      if (!apiUrl) return res.status(400).json({ error: "PRM-Face API URL is not configured." });
      const apiKey = await getPrmFaceSetting("prm_face_api_key");
      if (!apiKey) return res.status(400).json({ error: "PRM-Face API key is not configured." });
      try {
        const response = await fetch(`${prmBase(apiUrl)}/api/face/get?uuid=${uuid}`, {
          headers: { "x-api-key": apiKey },
          signal: AbortSignal.timeout(15000),
        });
        if (!response.ok) {
          const body = await response.text();
          return res.status(response.status).json({ error: `PRM-Face error: ${body}` });
        }
        res.json(await response.json());
      } catch (error: any) {
        res.status(500).json({ error: `Failed to contact PRM-Face: ${error.message}` });
      }
    });

    // Get person info
    app.get("/api/prm-face/person/get", async (req, res) => {
      if (!req.isAuthenticated()) return res.status(401).json({ error: "Not authenticated" });
      const uuid = req.query.uuid as string;
      if (!uuid) return res.status(400).json({ error: "uuid is required." });
      const apiUrl = await getPrmFaceSetting("prm_face_api_url");
      if (!apiUrl) return res.status(400).json({ error: "PRM-Face API URL is not configured." });
      const apiKey = await getPrmFaceSetting("prm_face_api_key");
      if (!apiKey) return res.status(400).json({ error: "PRM-Face API key is not configured." });
      try {
        const response = await fetch(`${prmBase(apiUrl)}/api/person/get?uuid=${uuid}`, {
          headers: { "x-api-key": apiKey },
          signal: AbortSignal.timeout(15000),
        });
        if (!response.ok) {
          const body = await response.text();
          return res.status(response.status).json({ error: `PRM-Face error: ${body}` });
        }
        res.json(await response.json());
      } catch (error: any) {
        res.status(500).json({ error: `Failed to contact PRM-Face: ${error.message}` });
      }
    });

    // List named faces
    app.get("/api/prm-face/face/with-name", async (req, res) => {
      if (!req.isAuthenticated()) return res.status(401).json({ error: "Not authenticated" });
      const page = req.query.page || "1";
      const pageSize = req.query.page_size || req.query.pageSize || "25";
      const apiUrl = await getPrmFaceSetting("prm_face_api_url");
      if (!apiUrl) return res.status(400).json({ error: "PRM-Face API URL is not configured." });
      const apiKey = await getPrmFaceSetting("prm_face_api_key");
      if (!apiKey) return res.status(400).json({ error: "PRM-Face API key is not configured." });
      try {
        const response = await fetch(`${prmBase(apiUrl)}/api/face/with-name?page=${page}&page_size=${pageSize}`, {
          headers: { "x-api-key": apiKey },
          signal: AbortSignal.timeout(15000),
        });
        if (!response.ok) {
          const body = await response.text();
          return res.status(response.status).json({ error: `PRM-Face error: ${body}` });
        }
        res.json(await response.json());
      } catch (error: any) {
        res.status(500).json({ error: `Failed to contact PRM-Face: ${error.message}` });
      }
    });

    // List orphan faces
    app.get("/api/prm-face/face/without-name", async (req, res) => {
      if (!req.isAuthenticated()) return res.status(401).json({ error: "Not authenticated" });
      const page = req.query.page || "1";
      const pageSize = req.query.page_size || req.query.pageSize || "25";
      const apiUrl = await getPrmFaceSetting("prm_face_api_url");
      if (!apiUrl) return res.status(400).json({ error: "PRM-Face API URL is not configured." });
      const apiKey = await getPrmFaceSetting("prm_face_api_key");
      if (!apiKey) return res.status(400).json({ error: "PRM-Face API key is not configured." });
      try {
        const response = await fetch(`${prmBase(apiUrl)}/api/face/without-name?page=${page}&page_size=${pageSize}`, {
          headers: { "x-api-key": apiKey },
          signal: AbortSignal.timeout(15000),
        });
        if (!response.ok) {
          const body = await response.text();
          return res.status(response.status).json({ error: `PRM-Face error: ${body}` });
        }
        res.json(await response.json());
      } catch (error: any) {
        res.status(500).json({ error: `Failed to contact PRM-Face: ${error.message}` });
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
      if (!apiUrl) return res.status(400).json({ error: "PRM-Face API URL is not configured." });
      const apiKey = await getPrmFaceSetting("prm_face_api_key");
      if (!apiKey) return res.status(400).json({ error: "PRM-Face API key is not configured." });
      try {
        const response = await fetch(`${prmBase(apiUrl)}/api/person/${personUuid}/faces?page=${page}&page_size=${pageSize}&order=${order}`, {
          headers: { "x-api-key": apiKey },
          signal: AbortSignal.timeout(15000),
        });
        if (!response.ok) {
          const body = await response.text();
          return res.status(response.status).json({ error: `PRM-Face error: ${body}` });
        }
        res.json(await response.json());
      } catch (error: any) {
        res.status(500).json({ error: `Failed to contact PRM-Face: ${error.message}` });
      }
    });
}
