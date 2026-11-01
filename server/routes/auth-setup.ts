// Generated route module - auth-setup.ts
import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "../storage";
import { describePhotoInBackground } from "../ai/describe";
import { applyBigAccountRule } from "../tracking";
import { TRACKING_BIG_ACCOUNTS_NONE_KEY, TRACKING_MENTIONS_CREATE_KEY, TRACKING_MENTIONS_QUEUE_INFO_KEY } from "@shared/interest-level";
import { db } from "../db";
import { users, interactions, relationshipTypes, interactionTypes, people, socialNetworkChanges, socialAccountPosts, socialAccounts, aiChats, dailyNotes, lineage, partnerships, photos, dailyNoteEvents, dailyNoteInvolvedParties, dailyNoteAuditLogs, sexGuessQueue, appSettings, type SocialAccountWithCurrentProfile, type ExtensionSession, type AiChatMessage, type AiToolCallTrace } from "@shared/schema";
import crypto from "crypto";
import { z } from "zod";
import { eq, sql, isNotNull, and, inArray } from "drizzle-orm";
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
  type User,
} from "@shared/schema";
import multer from "multer";
import { Readable } from "stream";
import { deleteImageFromPrmS3, getPrmS3Config, presignPrmS3PublicUrl, PRM_S3_PRESIGN_WINDOW_SECONDS, uploadImage } from "../prm-s3";
import { withImageSize, isValidImageSize, type ImageSize } from "@shared/image-size";
import { hashPassword, requireAuth, publicUser, authenticateExtensionToken } from "../auth";
import { triggerTaskWorker, triggerImageTaskWorker, pauseTaskWorker, resumeTaskWorker, isTaskWorkerPaused, writeExportXmlToFile, executeImportXml } from "../task-worker";
import { syncEntityInBackground } from "../vector-universal";
import { getPrimaryAddress } from "../person-addresses";
import { scrypt, timingSafeEqual } from "crypto";
import { promisify } from "util";
import fs from "fs";
import path from "path";
import os from "os";
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

const scryptAsync = promisify(scrypt);

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

// Flag to track if user creation is allowed (only after database reset)
let isUserCreationAllowed = false;

// Endpoints under /api that intentionally do not require authentication.
// Paths are relative to the "/api" mount point (so "/setup/status" matches
// the route "/api/setup/status"). Everything not listed here is protected
// by the requireAuth gate installed at the top of registerRoutes().
const PUBLIC_API_PATHS: ReadonlySet<string> = new Set([
  "/setup/status",
  "/setup/initialize",
  "/setup/services/health",
  "/setup/onboarding-status",
  "/sso-config/status",
  "/sso/login",
  "/sso/callback",
  "/extension-auth/verify",
  "/extension-auth/ping",
  "/v1/ping",
  "/posts/instagram/import",
  "/v1/posts/import",
  "/v1/posts/check",
  "/posts/instagram/check",
  "/v1/tps/match",
  "/v1/tps/person-status",
  "/v1/tps/add",
  "/v1/tps/extract",
  "/v1/tps/people-search",
  "/v1/tps/link",
  "/v1/pending-imports",
  "/v1/scrape-results",
  "/v1/account-status",
]);

function isPublicApiPath(path: string, method?: string): boolean {
  // Setup mutations require authentication
  if (method === "POST" && (path === "/setup/onboarding-status" || path === "/setup/seed-data-types")) {
    return false;
  }
  if (PUBLIC_API_PATHS.has(path)) return true;
  if (path.startsWith("/v1/pending-imports")) return true;
  if (path.startsWith("/v1/scrape-results")) return true;
  if (path.startsWith("/v1/account-status")) return true;
  if (path.startsWith("/v1/stories")) return true;
  if (path.startsWith("/v1/tracking")) return true; // run-token auth in routes/tracking.ts
  return false;
}

export function registerRoutes(app: Express) {
    app.use("/api", (req, res, next) => {
      if (isPublicApiPath(req.path, req.method)) return next();
      return requireAuth(req, res, next);
    });
  
    // Serve PRM-S3 objects (authenticated): images, media, and the face crops
    // PRM-compute writes under faces/.
    // Proxy mode streams the object through this server over the internal
    // endpoint. In direct mode API responses already carry presigned public
    // URLs, so this route is only a safety net for stale clients: redirect
    // to the presigned URL rather than proxying the bytes.
    app.get("/api/prm-s3/:kind(images|profiles|posts|stories|media|faces|references)/:filename", async (req, res) => {
      if (!req.isAuthenticated()) {
        return res.status(401).json({ error: "Not authenticated" });
      }
      const s = typeof req.query.s === "string" ? req.query.s : undefined;
      if (s !== undefined && !isValidImageSize(s)) {
        return res.status(400).json({ error: "s must be one of 64, 128, 150, 160, 360, 480, 1080 or max" });
      }
      try {
        const safeName = path.basename(req.params.filename);
        const key = `${req.params.kind}/${safeName}`;
        const cfg = await getPrmS3Config();

        if (cfg.directDelivery) {
          const publicUrl = presignPrmS3PublicUrl(cfg, key);
          const redirectUrl = s ? withImageSize(publicUrl, s as ImageSize) : publicUrl;
          res.setHeader("Cache-Control", `private, max-age=${PRM_S3_PRESIGN_WINDOW_SECONDS - 600}`);
          return res.redirect(302, redirectUrl);
        }

        let internalUrl = presignPrmS3PublicUrl(cfg, key, { endpoint: cfg.endpoint });
        if (s) internalUrl = withImageSize(internalUrl, s as ImageSize);

        // Forward Range and conditional headers so seeks and revalidation
        // work through the proxy; PRM-S3 answers 206/304 itself.
        const headers: Record<string, string> = {};
        for (const h of ["range", "if-none-match", "if-modified-since"]) {
          const v = req.headers[h];
          if (typeof v === "string") headers[h] = v;
        }
        const s3Res = await fetch(internalUrl, { headers });
        if (!s3Res.ok && s3Res.status !== 304) {
          return res.status(s3Res.status).json({ error: "Object not found on PRM-S3" });
        }

        for (const h of ["ETag", "Content-Type", "Content-Length", "Content-Range", "Accept-Ranges", "Last-Modified"]) {
          const v = s3Res.headers.get(h);
          if (v) res.setHeader(h, v);
        }
        res.setHeader("Cache-Control", s3Res.headers.get("cache-control") || "public, max-age=86400");
        res.status(s3Res.status);

        if (s3Res.status !== 304 && s3Res.body) {
          Readable.fromWeb(s3Res.body as any).pipe(res);
        } else {
          res.end();
        }
      } catch (err: any) {
        res.status(404).json({ error: "Object not found on PRM-S3" });
      }
    });

    // Image upload endpoint
    app.post("/api/upload-image", upload.single("image"), async (req, res) => {
      try {
        if (!req.file) {
          return res.status(400).json({ error: "No image file provided" });
        }

        const imageUrl = await uploadImage(req.file.buffer, req.file.originalname, req.file.mimetype);
  
        // Register in photos table — callers pass prmLocation to identify where this image is used
        const prmLocation = (req.body?.prmLocation as string) || "unknown";
        let photoId: string | undefined;
        try {
          const photo = await storage.insertPhoto({ location: imageUrl, prmLocation, isSubImage: false });
          photoId = photo.id;
          syncEntityInBackground("image", photo.id);
        } catch (photoErr) {
          console.error("Warning: failed to register photo in photos table:", photoErr);
        }
  
        res.json({ imageUrl, photoId });
  
        // Fire-and-forget: auto-describe if enabled (never blocks the upload response)
        const capturedPhotoId = photoId;
        const capturedPrmLocation = prmLocation;
        ;(async () => {
          try {
            if (!capturedPhotoId) return;
            // Skip profile images
            if (
              capturedPrmLocation.startsWith("profile_image") ||
              capturedPrmLocation.startsWith("social_profile_image")
            ) return;
            if ((await storage.getAppSetting("ai_auto_describe_images")) !== "true") return;
            await describePhotoInBackground(capturedPhotoId);
          } catch (err) {
            console.error("[auto-describe] error:", err);
          }
        })();
      } catch (error) {
        console.error("Error uploading image:", error);
        res.status(500).json({ error: "Failed to upload image" });
      }
    });
  
    // Delete image endpoint
    app.delete("/api/delete-image", async (req, res) => {
      try {
        const { imageUrl } = req.body;
        if (!imageUrl) {
          return res.status(400).json({ error: "No image URL provided" });
        }
  
        await deleteImageFromPrmS3(imageUrl);
        res.json({ success: true });
      } catch (error) {
        console.error("Error deleting image:", error);
        res.status(500).json({ error: "Failed to delete image" });
      }
    });
  
    // CSV import endpoint
    app.post("/api/import-csv", upload.single("csv"), async (req, res) => {
      try {
        if (!req.file) {
          return res.status(400).json({ error: "No CSV file provided" });
        }
  
        // Parse CSV file
        const csvText = req.file.buffer.toString("utf-8");
        const parseResult = Papa.parse(csvText, {
          header: true,
          skipEmptyLines: true,
          transformHeader: (header: string) => header.trim(),
        });
  
        if (parseResult.errors.length > 0) {
          console.error("CSV parsing errors:", parseResult.errors);
          return res.status(400).json({ 
            error: "Failed to parse CSV file",
            details: parseResult.errors.map(e => e.message)
          });
        }
  
        const rows = parseResult.data as any[];
        
        // Skip first row as it's always an example/formatting row
        const dataRows = rows.slice(1);
  
        if (dataRows.length === 0) {
          return res.status(400).json({ error: "CSV file contains no data rows" });
        }
  
        // Process each row and create person records
        const createdPeople = [];
        const errors = [];
  
        for (let i = 0; i < dataRows.length; i++) {
          const row = dataRows[i];
          
          try {
            // Extract basic fields
            const firstName = row["First Name"]?.trim() || "";
            const lastName = row["Last Name"]?.trim() || "";
            
            if (!firstName && !lastName) {
              // Skip empty rows
              continue;
            }
  
            // Build notes from all other fields
            const noteParts: string[] = [];
  
            // Add middle name if present
            if (row["Middle Name"]?.trim()) {
              noteParts.push(`Middle Name: ${row["Middle Name"].trim()}`);
            }
  
            // Add nickname if present
            if (row["Nickname"]?.trim()) {
              noteParts.push(`Nickname: ${row["Nickname"].trim()}`);
            }
  
            // Add organization info
            if (row["Organization Name"]?.trim()) {
              noteParts.push(`Organization: ${row["Organization Name"].trim()}`);
            }
            if (row["Organization Title"]?.trim()) {
              noteParts.push(`Title: ${row["Organization Title"].trim()}`);
            }
            if (row["Organization Department"]?.trim()) {
              noteParts.push(`Department: ${row["Organization Department"].trim()}`);
            }
  
            // Add birthday
            if (row["Birthday"]?.trim()) {
              noteParts.push(`Birthday: ${row["Birthday"].trim()}`);
            }
  
            // Add existing notes
            if (row["Notes"]?.trim()) {
              noteParts.push(`Notes: ${row["Notes"].trim()}`);
            }
  
            // Add emails (skip first one as it goes to main email field)
            const email1 = row["E-mail 1 - Value"]?.trim();
            if (row["E-mail 2 - Value"]?.trim()) {
              const label = row["E-mail 2 - Label"]?.trim() || "Email";
              noteParts.push(`${label}: ${row["E-mail 2 - Value"].trim()}`);
            }
            if (row["E-mail 3 - Value"]?.trim()) {
              const label = row["E-mail 3 - Label"]?.trim() || "Email";
              noteParts.push(`${label}: ${row["E-mail 3 - Value"].trim()}`);
            }
  
            // Add phones (skip first one as it goes to main phone field)
            const phone1 = row["Phone 1 - Value"]?.trim();
            if (row["Phone 2 - Value"]?.trim()) {
              const label = row["Phone 2 - Label"]?.trim() || "Phone";
              noteParts.push(`${label}: ${row["Phone 2 - Value"].trim()}`);
            }
            if (row["Phone 3 - Value"]?.trim()) {
              const label = row["Phone 3 - Label"]?.trim() || "Phone";
              noteParts.push(`${label}: ${row["Phone 3 - Value"].trim()}`);
            }
            if (row["Phone 4 - Value"]?.trim()) {
              const label = row["Phone 4 - Label"]?.trim() || "Phone";
              noteParts.push(`${label}: ${row["Phone 4 - Value"].trim()}`);
            }
  
            // Add addresses
            if (row["Address 1 - Formatted"]?.trim()) {
              const label = row["Address 1 - Label"]?.trim() || "Address";
              noteParts.push(`${label}: ${row["Address 1 - Formatted"].trim()}`);
            }
            if (row["Address 2 - Formatted"]?.trim()) {
              const label = row["Address 2 - Label"]?.trim() || "Address";
              noteParts.push(`${label}: ${row["Address 2 - Formatted"].trim()}`);
            }
  
            // Add websites
            if (row["Website 1 - Value"]?.trim()) {
              const label = row["Website 1 - Label"]?.trim() || "Website";
              noteParts.push(`${label}: ${row["Website 1 - Value"].trim()}`);
            }
  
            // Add relations
            if (row["Relation 1 - Value"]?.trim()) {
              const label = row["Relation 1 - Label"]?.trim() || "Relation";
              noteParts.push(`${label}: ${row["Relation 1 - Value"].trim()}`);
            }
  
            // Add events
            if (row["Event 1 - Value"]?.trim()) {
              const label = row["Event 1 - Label"]?.trim() || "Event";
              noteParts.push(`${label}: ${row["Event 1 - Value"].trim()}`);
            }
  
            // Add labels/tags
            if (row["Labels"]?.trim()) {
              noteParts.push(`Labels: ${row["Labels"].trim()}`);
            }
  
            // Create person record
            const personData = {
              firstName: firstName || "Unknown",
              lastName: lastName || "Unknown",
              email: email1 || null,
              phone: phone1 || null,
              company: row["Organization Name"]?.trim() || null,
              title: row["Organization Title"]?.trim() || null,
              tags: row["Labels"]?.trim() ? row["Labels"].trim().split(/[,;]/).map((t: string) => t.trim()).filter(Boolean) : [],
            };
  
            const person = await storage.createPerson(personData);
  
            // Create a note if there's additional info
            if (noteParts.length > 0) {
              await storage.createNote({
                personId: person.id,
                content: noteParts.join("\n"),
              });
            }
  
            createdPeople.push(person);
          } catch (error) {
            console.error(`Error processing row ${i + 2}:`, error);
            errors.push({
              row: i + 2,
              data: row,
              error: error instanceof Error ? error.message : "Unknown error",
            });
          }
        }
  
        res.json({
          success: true,
          imported: createdPeople.length,
          errors: errors.length,
          errorDetails: errors.length > 0 ? errors : undefined,
        });
      } catch (error) {
        console.error("Error importing CSV:", error);
        res.status(500).json({ error: "Failed to import CSV" });
      }
    });
  
    // VCF (vCard) import endpoint
    app.post("/api/import-vcf", upload.single("vcf"), async (req, res) => {
      try {
        if (!req.file) {
          return res.status(400).json({ error: "No VCF file provided" });
        }
  
        const vcfText = req.file.buffer.toString("utf-8");
  
        // Unfold continued lines per vCard spec (lines starting with space/tab are continuations)
        const unfoldedText = vcfText.replace(/\r\n[ \t]/g, "").replace(/\n[ \t]/g, "");
  
        // Split into individual vCards
        const vCardBlocks = unfoldedText.split(/(?=BEGIN:VCARD)/i).filter(block =>
          block.trim().toUpperCase().startsWith("BEGIN:VCARD")
        );
  
        if (vCardBlocks.length === 0) {
          return res.status(400).json({ error: "No valid vCard entries found in file" });
        }
  
        const createdPeople = [];
        const errors: { index: number; name: string; error: string }[] = [];
  
        for (let i = 0; i < vCardBlocks.length; i++) {
          try {
            const block = vCardBlocks[i];
            const lines = block.split(/\r?\n/).filter(l => l.trim() !== "");
  
            let firstName = "";
            let lastName = "";
            let fullName = "";
            let email: string | null = null;
            let phone: string | null = null;
            let company: string | null = null;
            let title: string | null = null;
            const noteParts: string[] = [];
            const extraEmails: string[] = [];
            const extraPhones: string[] = [];
  
            for (const line of lines) {
              if (line.toUpperCase().startsWith("BEGIN:") || line.toUpperCase().startsWith("END:") || line.toUpperCase().startsWith("VERSION:")) {
                continue;
              }
  
              // Parse property name and value - handle item1.PROP style prefixes
              const colonIdx = line.indexOf(":");
              if (colonIdx === -1) continue;
  
              let propPart = line.substring(0, colonIdx);
              const value = line.substring(colonIdx + 1).trim();
  
              // Strip itemN. prefix (Apple format)
              propPart = propPart.replace(/^item\d+\./i, "");
  
              // Extract the base property name (before any ;params)
              const semiIdx = propPart.indexOf(";");
              const propName = (semiIdx === -1 ? propPart : propPart.substring(0, semiIdx)).toUpperCase();
              const params = semiIdx === -1 ? "" : propPart.substring(semiIdx + 1).toUpperCase();
  
              switch (propName) {
                case "N": {
                  const parts = value.split(";");
                  lastName = (parts[0] || "").trim();
                  firstName = (parts[1] || "").trim();
                  const middleName = (parts[2] || "").trim();
                  const prefix = (parts[3] || "").trim();
                  const suffix = (parts[4] || "").trim();
                  if (middleName) noteParts.push(`Middle Name: ${middleName}`);
                  if (prefix) noteParts.push(`Name Prefix: ${prefix}`);
                  if (suffix) noteParts.push(`Name Suffix: ${suffix}`);
                  break;
                }
                case "FN":
                  fullName = value;
                  break;
                case "TEL":
                  if (!phone) {
                    phone = value;
                  } else {
                    const telType = params.includes("CELL") ? "Cell" : params.includes("HOME") ? "Home Phone" : params.includes("WORK") ? "Work Phone" : "Phone";
                    extraPhones.push(`${telType}: ${value}`);
                  }
                  break;
                case "EMAIL":
                  if (!email) {
                    email = value;
                  } else {
                    const emailType = params.includes("HOME") ? "Home Email" : params.includes("WORK") ? "Work Email" : "Email";
                    extraEmails.push(`${emailType}: ${value}`);
                  }
                  break;
                case "ORG":
                  company = value.split(";")[0]?.trim() || null;
                  break;
                case "TITLE":
                  title = value || null;
                  break;
                case "BDAY": {
                  const bdayVal = value.replace(/^VALUE=date:/i, "");
                  noteParts.push(`Birthday: ${bdayVal}`);
                  break;
                }
                case "ADR": {
                  const addrParts = value.split(";").map(p => p.trim()).filter(Boolean);
                  if (addrParts.length > 0) {
                    const addrType = params.includes("HOME") ? "Home Address" : params.includes("WORK") ? "Work Address" : "Address";
                    noteParts.push(`${addrType}: ${addrParts.join(", ")}`);
                  }
                  break;
                }
                case "URL":
                  noteParts.push(`Website: ${value}`);
                  break;
                case "NOTE":
                  noteParts.push(`Notes: ${value}`);
                  break;
                case "NICKNAME":
                  noteParts.push(`Nickname: ${value}`);
                  break;
                case "ROLE":
                  noteParts.push(`Role: ${value}`);
                  break;
                case "CATEGORIES":
                  noteParts.push(`Categories: ${value}`);
                  break;
                case "X-SOCIALPROFILE":
                case "X-SOCIAL-PROFILE":
                  noteParts.push(`Social Profile: ${value}`);
                  break;
                case "X-ACTIVITY-ALERT":
                  noteParts.push(`Activity Alert: ${value}`);
                  break;
                case "PHOTO":
                  break;
                case "PRODID":
                case "REV":
                case "UID":
                case "X-ABADR":
                case "X-ABLABEL":
                case "X-ABUID":
                  break;
                default:
                  if (value && !propName.startsWith("X-AB")) {
                    noteParts.push(`${propName}: ${value}`);
                  }
                  break;
              }
            }
  
            // Fallback: if N field didn't give us names, parse FN
            if (!firstName && !lastName && fullName) {
              const fnParts = fullName.trim().split(/\s+/);
              if (fnParts.length >= 2) {
                firstName = fnParts[0];
                lastName = fnParts.slice(1).join(" ");
              } else {
                firstName = fullName;
              }
            }
  
            if (!firstName && !lastName) {
              errors.push({ index: i, name: "(empty)", error: "No name found in vCard entry" });
              continue;
            }
  
            // Append extra emails and phones to notes
            extraEmails.forEach(e => noteParts.push(e));
            extraPhones.forEach(p => noteParts.push(p));
  
            const personData = {
              firstName: firstName || "Unknown",
              lastName: lastName || "Unknown",
              email: email || null,
              phone: phone || null,
              company: company || null,
              title: title || null,
              tags: [],
            };
  
            const person = await storage.createPerson(personData);
  
            if (noteParts.length > 0) {
              await storage.createNote({
                personId: person.id,
                content: noteParts.join("\n"),
              });
            }
  
            createdPeople.push(person);
          } catch (error) {
            console.error(`Error processing vCard ${i + 1}:`, error);
            errors.push({
              index: i,
              name: `vCard ${i + 1}`,
              error: error instanceof Error ? error.message : "Unknown error",
            });
          }
        }
  
        res.json({
          success: true,
          imported: createdPeople.length,
          errors: errors.length,
          errorDetails: errors.length > 0 ? errors : undefined,
        });
      } catch (error) {
        console.error("Error importing VCF:", error);
        res.status(500).json({ error: "Failed to import VCF file" });
      }
    });
  
    // XML Export endpoint
    app.get("/api/export-xml", requireAuth, async (req, res) => {
      try {
        const includeHistory = req.query.includeHistory === "true";
        const includePostHistory = req.query.includePostHistory !== undefined
          ? req.query.includePostHistory === "true"
          : includeHistory;
        // Exported via a temp file: the full XML can exceed V8's maximum string length.
        const tmpPath = path.join(os.tmpdir(), `crm_export_${crypto.randomUUID()}.xml`);
        await writeExportXmlToFile(tmpPath, { includeHistory, includePostHistory });
        res.setHeader("Content-Type", "application/xml");
        res.download(tmpPath, `crm_export_${new Date().toISOString().split('T')[0]}.xml`, () => {
          fs.promises.unlink(tmpPath).catch(() => {});
        });
      } catch (error) {
        console.error("Error exporting XML:", error);
        res.status(500).json({ error: "Failed to export data" });
      }
    });
  
    // XML Import endpoint
    app.post("/api/import-xml", upload.single("xml"), async (req, res) => {
      try {
        if (!req.file) {
          return res.status(400).json({ error: "No XML file provided" });
        }
  
        if (!req.user) {
          return res.status(401).json({ error: "Not authenticated" });
        }
  
        const includeHistory = req.body?.includeHistory !== "false" && req.query.includeHistory !== "false";
        const includePostHistory = req.body?.includePostHistory !== "false" && req.query.includePostHistory !== "false";
        const result = await executeImportXml(req.file.buffer, { includeHistory, includePostHistory });
  
        res.json({
          success: true,
          ...result,
        });
      } catch (error) {
        console.error("Error importing XML:", error);
        res.status(500).json({ error: "Failed to import XML" });
      }
    });
  
    // Instagram Import endpoint (followers/following CSV)
    app.post("/api/import-instagram", upload.single("csv"), async (req, res) => {
      try {
        if (!req.file) {
          return res.status(400).json({ error: "No CSV file provided" });
        }
  
        const importType = req.body.importType as "followers" | "following";
        const forceUpdateImages = req.body.forceUpdateImages === "true";
        const usernameFromFilename = (req.body.username as string || "").trim();
        const explicitAccountId = (req.body.accountId as string || "").trim();
  
        if (!importType || !["followers", "following"].includes(importType)) {
          return res.status(400).json({ error: "Import type must be 'followers' or 'following'" });
        }
  
        if (!usernameFromFilename && !explicitAccountId) {
          return res.status(400).json({ error: "Could not determine target account: no username or account ID provided" });
        }
  
        let targetAccount: SocialAccountWithCurrentProfile | undefined;
  
        // Explicit accountId takes priority (manual override)
        if (explicitAccountId) {
          targetAccount = await storage.getSocialAccountById(explicitAccountId);
          if (!targetAccount) {
            return res.status(404).json({ error: "Selected account not found" });
          }
        } else {
          const INSTAGRAM_TYPE_ID = "00000000-0000-0000-0001-000000000001";
          const normalizedUsername = usernameFromFilename.toLowerCase();
  
          // Look up by username AND Instagram type to avoid matching accounts on other platforms
          const [existing] = await db
            .select()
            .from(socialAccounts)
            .where(
              and(
                eq(socialAccounts.username, normalizedUsername),
                eq(socialAccounts.typeId, INSTAGRAM_TYPE_ID)
              )
            )
            .limit(1);
  
          if (existing) {
            targetAccount = await storage.getSocialAccountById(existing.id);
          } else {
            // Auto-create the Instagram account
            targetAccount = await storage.createSocialAccount({
              username: normalizedUsername,
              typeId: INSTAGRAM_TYPE_ID,
              internalAccountCreationType: "auto-import",
            });
          }
        }
  
        if (!targetAccount) {
          return res.status(500).json({ error: "Failed to resolve target account" });
        }
  
        const csvText = req.file.buffer.toString("utf-8");
        const parseResult = Papa.parse(csvText, {
          header: true,
          skipEmptyLines: true,
          delimiter: ";",
          transformHeader: (header: string) => header.trim().replace(/"/g, ""),
        });
  
        const rows = parseResult.data as any[];
        if (rows.length === 0) {
          return res.status(400).json({ error: "CSV file contains no data" });
        }
  
        const task = await storage.createTask({
          type: "import_instagram",
          status: "pending",
          title: targetAccount.username,
          payload: JSON.stringify({
            accountId: targetAccount.id,
            targetAccountUsername: targetAccount.username,
            importType,
            forceUpdateImages,
            rows,
            skippedRows: parseResult.errors.length,
          }),
        });
  
        triggerTaskWorker();
  
        res.json({ taskId: task.id, total: rows.length, accountUsername: targetAccount.username });
      } catch (error) {
        console.error("Error queuing Instagram import:", error);
        res.status(500).json({ error: "Failed to start Instagram import" });
      }
    });
  
    // Database reset endpoint
    app.post("/api/reset-database", requireAuth, async (req, res) => {
      try {
        const { includeExamples } = req.body;
  
        // Import the resetDatabase function
        const { resetDatabase } = await import("../db-init");
        const { clearComputeReferencesForReset } = await import("../references");

        // Reference crops live in compute's store; clear them before the tables are dropped
        await clearComputeReferencesForReset();

        // Reset the database completely (no user preservation)
        await resetDatabase(null, includeExamples === true);
  
        // Enable user creation after reset
        isUserCreationAllowed = true;
  
        // Destroy the current session since all users are deleted
        req.logout((err) => {
          if (err) {
            console.error("Error logging out after reset:", err);
          }
          req.session.destroy((err) => {
            if (err) {
              console.error("Error destroying session after reset:", err);
            }
            res.json({ success: true, requiresLogin: true });
          });
        });
      } catch (error) {
        console.error("Error resetting database:", error);
        res.status(500).json({ error: "Failed to reset database" });
      }
    });
  
    // Setup endpoints
    app.get("/api/setup/status", async (req, res) => {
      try {
        // Prevent caching to ensure fresh user count check
        res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
        res.set('Pragma', 'no-cache');
        res.set('Expires', '0');
        
        const userCount = await storage.getUserCount();
        
        // Setup is needed if:
        // 1. No users exist (first time setup) OR
        // 2. User creation is explicitly allowed (after database reset)
        const isSetupNeeded = userCount === 0 || isUserCreationAllowed;
        
        res.json({ isSetupNeeded });
      } catch (error) {
        console.error("Error checking setup status:", error);
        res.status(500).json({ error: "Failed to check setup status" });
      }
    });
  
    app.post("/api/setup/initialize", async (req, res) => {
      let createdUser: User | null = null;
      try {
        const userCount = await storage.getUserCount();
        
        // Allow user creation only if:
        // 1. No users exist (first time setup) OR
        // 2. User creation is explicitly allowed (after database reset)
        if (userCount > 0 && !isUserCreationAllowed) {
          return res.status(400).json({ error: "User creation is disabled. Please use the existing account." });
        }
  
        const validatedData = insertUserSchema.parse({
          name: req.body.name,
          nickname: req.body.nickname,
          username: req.body.username,
          password: await hashPassword(req.body.password),
        });
  
        const user = await storage.createUser(validatedData);
        createdUser = user;
        
        // Create a person entry for the new user
        const [firstName, ...lastNameParts] = (user.name || user.username).split(' ');
        const lastName = lastNameParts.join(' ') || '';
        
        const mePerson = await storage.createPerson({
          firstName: firstName,
          lastName: lastName,
          email: '',
          phone: null,
          company: null,
          title: null,
          tags: [],
          imageUrl: null,
        });
        await storage.setMePersonId(mePerson.id);
        
        // Disable user creation now that an account has been created
        isUserCreationAllowed = false;
        
        // Log the user in automatically
        req.login(user, (err) => {
          if (err) {
            console.error("Error logging in after setup:", err);
            return res.status(500).json({ error: "Setup completed but login failed" });
          }
          res.status(201).json(publicUser(user));
        });
      } catch (error) {
        if (createdUser) {
          try {
            await storage.deleteUser(createdUser.id);
          } catch (cleanupError) {
            console.error("Error cleaning up user after failed setup:", cleanupError);
          }
        }
        console.error("Error initializing setup:", error);
        res.status(400).json({ error: "Failed to initialize setup" });
      }
    });
  
    // Search endpoint (legacy)
    app.get("/api/search", async (req, res) => {
      try {
        const query = req.query.q as string | undefined;
        
        if (!query) {
          return res.json({ people: [], groups: [] });
        }
  
        const [people, groups] = await Promise.all([
          storage.getAllPeople(query),
          storage.getAllGroups(query),
        ]);
  
        res.json({ people, groups });
      } catch (error) {
        console.error("Error searching:", error);
        res.status(500).json({ error: "Failed to search" });
      }
    });
  
    // Mega search endpoint with configurable result types
    app.get("/api/mega-search", async (req, res) => {
      try {
        const querySchema = z.object({
          q: z.string().optional(),
          includePeople: z.enum(['true', 'false']).optional(),
          includeGroups: z.enum(['true', 'false']).optional(),
          includeInteractions: z.enum(['true', 'false']).optional(),
          includeNotes: z.enum(['true', 'false']).optional(),
          includeSocialProfiles: z.enum(['true', 'false']).optional(),
          includeDailyNotes: z.enum(['true', 'false']).optional(),
          includeChats: z.enum(['true', 'false']).optional(),
        });
  
        const parsed = querySchema.safeParse(req.query);
        if (!parsed.success) {
          return res.status(400).json({ error: "Invalid query parameters" });
        }
  
        const { q: query } = parsed.data;
        
        if (!query) {
          return res.json({
            people: [],
            groups: [],
            interactions: [],
            notes: [],
            socialProfiles: [],
            dailyNotes: [],
            chats: [],
          });
        }
  
        const options = {
          includePeople: parsed.data.includePeople !== 'false',
          includeGroups: parsed.data.includeGroups !== 'false',
          includeInteractions: parsed.data.includeInteractions !== 'false',
          includeNotes: parsed.data.includeNotes !== 'false',
          includeSocialProfiles: parsed.data.includeSocialProfiles !== 'false',
          includeDailyNotes: parsed.data.includeDailyNotes !== 'false',
          includeChats: parsed.data.includeChats !== 'false',
        };
  
        const results = await storage.megaSearch(query, options);
  
        res.json(results);
      } catch (error) {
        console.error("Error mega searching:", error);
        res.status(500).json({ error: "Failed to search" });
      }
    });

    app.get("/api/uuid-lookup/:uuid", async (req, res) => {
      try {
        const uuid = req.params.uuid;
        // Validate UUID format
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        if (!uuidRegex.test(uuid)) {
          return res.status(400).json({ error: "Invalid UUID format" });
        }
        const result = await storage.lookupUuid(uuid);
        if (!result) {
          return res.status(404).json({ error: "UUID not found" });
        }
        res.json(result);
      } catch (error) {
        console.error("Error looking up UUID:", error);
        res.status(500).json({ error: "Failed to lookup UUID" });
      }
    });
  
    // User endpoints
    app.patch("/api/user", async (req, res) => {
      try {
        if (!req.user) {
          return res.status(401).json({ error: "Not authenticated" });
        }
  
        const { name, nickname, username, currentPassword, newPassword, ssoEmail } = req.body;
        const updateData: any = {};
  
        // Validate and add basic fields
        if (name !== undefined) updateData.name = name;
        if (nickname !== undefined) updateData.nickname = nickname;
        if (ssoEmail !== undefined) {
          // Validate email format if provided
          if (ssoEmail && typeof ssoEmail === 'string' && ssoEmail.trim()) {
            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            if (!emailRegex.test(ssoEmail.trim())) {
              return res.status(400).json({ error: "Invalid SSO email format" });
            }
            // Check if SSO email is already used by another user
            const existingUserWithSsoEmail = await storage.getUserBySsoEmail(ssoEmail.trim());
            if (existingUserWithSsoEmail && existingUserWithSsoEmail.id !== req.user.id) {
              return res.status(400).json({ error: "This SSO email is already associated with another account" });
            }
            updateData.ssoEmail = ssoEmail.trim();
          } else {
            updateData.ssoEmail = null;
          }
        }
        if (username !== undefined) {
          // Check if username is already taken by another user
          const existingUser = await storage.getUserByUsername(username);
          if (existingUser && existingUser.id !== req.user.id) {
            return res.status(400).json({ error: "Username already taken" });
          }
          updateData.username = username;
        }
  
        // Handle password change
        if (newPassword && currentPassword) {
          // Verify current password
          const user = await storage.getUser(req.user.id);
          if (!user) {
            return res.status(404).json({ error: "User not found" });
          }
  
          const [hashed, salt] = user.password.split(".");
          const hashedBuf = Buffer.from(hashed, "hex");
          const suppliedBuf = (await scryptAsync(currentPassword, salt, 64)) as Buffer;
          
          if (!timingSafeEqual(hashedBuf, suppliedBuf)) {
            return res.status(400).json({ error: "Current password is incorrect" });
          }
  
          // Hash new password
          updateData.password = await hashPassword(newPassword);
        } else if (newPassword || currentPassword) {
          return res.status(400).json({ error: "Both current and new password are required to change password" });
        }
  
        const updatedUser = await storage.updateUser(req.user.id, updateData);
        if (!updatedUser) {
          return res.status(404).json({ error: "User not found" });
        }
  
        // Sync name changes to the user's person entry
        if (updateData.name !== undefined) {
          const [firstName, ...lastNameParts] = (updateData.name || updatedUser.username).split(' ');
          const lastName = lastNameParts.join(' ') || '';
          
          await storage.updateMePerson({
            firstName: firstName,
            lastName: lastName,
          });
        }
  
        res.json(publicUser(updatedUser));
      } catch (error) {
        console.error("Error updating user:", error);
        res.status(400).json({ error: "Failed to update user" });
      }
    });

    app.get("/api/me", async (req, res) => {
      try {
        if (!req.user) {
          return res.status(401).json({ error: "Not authenticated" });
        }
  
        const mePerson = await storage.getMePerson();
        if (!mePerson) {
          return res.status(404).json({ error: "Person entry not found" });
        }
  
        res.json({ ...mePerson, primaryAddress: await getPrimaryAddress(mePerson.id) });
      } catch (error) {
        console.error("Error fetching me person:", error);
        res.status(500).json({ error: "Failed to fetch person entry" });
      }
    });
  
    // API Key endpoints
    app.get("/api/api-keys", async (req, res) => {
      try {
        if (!req.user) {
          return res.status(401).json({ error: "Not authenticated" });
        }
  
        const keys = await storage.getAllApiKeys(req.user.id);
        res.json(keys);
      } catch (error) {
        console.error("Error fetching API keys:", error);
        res.status(500).json({ error: "Failed to fetch API keys" });
      }
    });
  
    app.post("/api/api-keys", async (req, res) => {
      try {
        if (!req.user) {
          return res.status(401).json({ error: "Not authenticated" });
        }
  
        const { name, keyType } = req.body;
        if (!name || typeof name !== 'string') {
          return res.status(400).json({ error: "Name is required" });
        }
  
        // Validate keyType if provided
        const validKeyTypes = ['full', 'chrome'];
        if (keyType !== undefined && !validKeyTypes.includes(keyType)) {
          return res.status(400).json({ error: "Invalid key type. Must be 'full' or 'chrome'" });
        }
        const resolvedKeyType = validKeyTypes.includes(keyType) ? keyType : 'chrome';
  
        // Generate a random API key (32 bytes = 64 hex characters)
        const crypto = await import("crypto");
        const rawKey = crypto.randomBytes(32).toString('hex');
        
        // Hash the key for storage (like password hashing)
        const hashedKey = await hashPassword(rawKey);
  
        const validatedData = insertApiKeySchema.parse({
          userId: req.user.id,
          name,
          key: hashedKey,
          keyType: resolvedKeyType,
        });
  
        const apiKey = await storage.createApiKey({
          ...validatedData,
          keyType: resolvedKeyType,
        });
  
        // Return the raw key ONLY THIS ONE TIME (never stored/shown again)
        res.status(201).json({
          id: apiKey.id,
          name: apiKey.name,
          key: rawKey, // Show raw key only on creation
          keyType: apiKey.keyType,
          createdAt: apiKey.createdAt,
        });
      } catch (error) {
        console.error("Error creating API key:", error);
        res.status(400).json({ error: "Failed to create API key" });
      }
    });
  
    app.delete("/api/api-keys/:id", async (req, res) => {
      try {
        if (!req.user) {
          return res.status(401).json({ error: "Not authenticated" });
        }
  
        const id = req.params.id;
        
        // Verify the key belongs to the user
        const keys = await storage.getAllApiKeys(req.user.id);
        const keyToDelete = keys.find(k => k.id === id);
        
        if (!keyToDelete) {
          return res.status(404).json({ error: "API key not found" });
        }
  
        await storage.deleteApiKey(id);
        res.json({ success: true });
      } catch (error) {
        console.error("Error deleting API key:", error);
        res.status(500).json({ error: "Failed to delete API key" });
      }
    });
  
    // Chrome Extension Auth endpoints
  
    // Rate limiter specifically for code verification (stricter than global rate limiter)
    // Prevents brute-forcing the 4-digit code
    const verifyAttempts = new Map<string, { count: number; resetAt: number }>();
    const VERIFY_MAX_ATTEMPTS = 5; // 5 attempts per window
    const VERIFY_WINDOW_MS = 60 * 1000; // 1-minute window
  
    // Periodically clean up expired rate limit entries to prevent memory leaks
    setInterval(() => {
      const now = Date.now();
      for (const [key, value] of verifyAttempts) {
        if (now >= value.resetAt) {
          verifyAttempts.delete(key);
        }
      }
    }, 5 * 60 * 1000); // Clean up every 5 minutes
  
    // Generate or get current 4-digit auth code (requires session auth)
    app.get("/api/extension-auth/code", async (req, res) => {
      try {
        if (!req.user) {
          return res.status(401).json({ error: "Not authenticated" });
        }
  
        // Clean up expired codes
        await storage.deleteExpiredExtensionAuthCodes();
  
        // Check for existing valid code
        const existing = await storage.getExtensionAuthCode(req.user.id);
        if (existing && new Date(existing.expiresAt) > new Date()) {
          return res.json({
            code: existing.code,
            expiresAt: existing.expiresAt,
          });
        }
  
        // Generate a new 4-digit code using cryptographically secure random
        const code = String(crypto.randomInt(1000, 10000));
        const expiresAt = new Date(Date.now() + 60 * 1000); // 60 seconds from now
  
        const authCode = await storage.upsertExtensionAuthCode({
          userId: req.user.id,
          code,
          expiresAt,
        });
  
        res.json({
          code: authCode.code,
          expiresAt: authCode.expiresAt,
        });
      } catch (error) {
        console.error("Error generating extension auth code:", error);
        res.status(500).json({ error: "Failed to generate auth code" });
      }
    });
  
    // Verify 4-digit code from extension (no session auth required - this IS the auth)
    app.post("/api/extension-auth/verify", async (req, res) => {
      try {
        // Rate limit by IP to prevent brute-forcing the 4-digit code
        const clientIp = req.ip || req.socket.remoteAddress || "unknown";
        const now = Date.now();
        const attempt = verifyAttempts.get(clientIp);
  
        if (attempt && now < attempt.resetAt) {
          if (attempt.count >= VERIFY_MAX_ATTEMPTS) {
            return res.status(429).json({ error: "Too many attempts. Please wait and try again." });
          }
          attempt.count++;
        } else {
          verifyAttempts.set(clientIp, { count: 1, resetAt: now + VERIFY_WINDOW_MS });
        }
  
        const { code } = req.body;
        if (!code || typeof code !== "string" || !/^\d{4}$/.test(code)) {
          return res.status(400).json({ error: "A valid 4-digit code is required" });
        }
  
        // Clean up expired codes
        await storage.deleteExpiredExtensionAuthCodes();
  
        // Look up the code
        const authCode = await storage.getExtensionAuthCodeByCode(code);
        if (!authCode || new Date(authCode.expiresAt) <= new Date()) {
          return res.status(401).json({ error: "Invalid or expired code" });
        }
  
        // Generate a session token for the extension
        const rawToken = crypto.randomBytes(32).toString("hex");
        const hashedToken = crypto.createHash("sha256").update(rawToken).digest("hex");
  
        // Create the extension session
        const session = await storage.createExtensionSession({
          userId: authCode.userId,
          sessionToken: hashedToken,
          name: "Chrome Extension",
        });
  
        // Delete the used auth code explicitly to prevent reuse
        await storage.deleteExtensionAuthCodeByUserId(authCode.userId);
  
        res.status(201).json({
          sessionToken: rawToken, // Return raw token only once
          sessionId: session.id,
          createdAt: session.createdAt,
        });
      } catch (error) {
        console.error("Error verifying extension auth code:", error);
        res.status(500).json({ error: "Failed to verify auth code" });
      }
    });
  
    // List all extension sessions (requires session auth)
    app.get("/api/extension-sessions", async (req, res) => {
      try {
        if (!req.user) {
          return res.status(401).json({ error: "Not authenticated" });
        }
  
        const sessions = await storage.getAllExtensionSessions();
        // Don't return the hashed token
        const safeSessions = sessions.map(({ sessionToken, ...rest }) => rest);
        res.json(safeSessions);
      } catch (error) {
        console.error("Error fetching extension sessions:", error);
        res.status(500).json({ error: "Failed to fetch extension sessions" });
      }
    });
  
    // Delete/revoke an extension session (requires session auth)
    app.delete("/api/extension-sessions/:id", async (req, res) => {
      try {
        if (!req.user) {
          return res.status(401).json({ error: "Not authenticated" });
        }
  
        const id = req.params.id;
  
        // Verify the session exists
        const sessions = await storage.getAllExtensionSessions();
        const sessionToDelete = sessions.find((s) => s.id === id);
  
        if (!sessionToDelete) {
          return res.status(404).json({ error: "Extension session not found" });
        }
  
        await storage.deleteExtensionSession(id);
        res.json({ success: true });
      } catch (error) {
        console.error("Error deleting extension session:", error);
        res.status(500).json({ error: "Failed to delete extension session" });
      }
    });
  
    // Extension ping - update last accessed time (requires extension token auth)
    app.post("/api/extension-auth/ping", async (req, res) => {
      try {
        const token = req.headers["x-extension-token"] as string;
        if (!token) {
          return res.status(401).json({ error: "Extension token required" });
        }
  
        const matchedSession = await authenticateExtensionToken(token);
  
        if (!matchedSession) {
          return res.status(401).json({ error: "Invalid extension token" });
        }
  
        await storage.updateExtensionSessionLastAccessed(matchedSession.id);
        res.json({ success: true, lastAccessedAt: new Date().toISOString() });
      } catch (error) {
        console.error("Error processing extension ping:", error);
        res.status(500).json({ error: "Failed to process ping" });
      }
    });
  
    // SSO Config endpoints
    // Public endpoint to check if SSO is enabled (no auth required)
    app.get("/api/sso-config/status", async (req, res) => {
      try {
        // Check if any user has SSO enabled
        const allUsers = await storage.getAllUsers();
        let isEnabled = false;
        let isAutoSso = false;
        
        for (const user of allUsers) {
          const config = await storage.getSsoConfig(user.id);
          if (config && config.enabled === 1) {
            isEnabled = true;
            if (config.autoSso === 1) {
              isAutoSso = true;
            }
            break;
          }
        }
  
        res.json({ enabled: isEnabled ? 1 : 0, autoSso: isAutoSso ? 1 : 0 });
      } catch (error) {
        console.error("Error fetching SSO status:", error);
        res.status(500).json({ error: "Failed to fetch SSO status" });
      }
    });
  
    app.get("/api/sso-config", async (req, res) => {
      try {
        if (!req.user) {
          return res.status(401).json({ error: "Not authenticated" });
        }
  
        const config = await storage.getSsoConfig(req.user.id);
        if (!config) {
          return res.json(null);
        }
  
        // Don't send the client secret to the frontend (security)
        const { clientSecret, ...safeConfig } = config;
        res.json({ ...safeConfig, clientSecret: '********' });
      } catch (error) {
        console.error("Error fetching SSO config:", error);
        res.status(500).json({ error: "Failed to fetch SSO config" });
      }
    });
  
    app.post("/api/sso-config", async (req, res) => {
      try {
        if (!req.user) {
          return res.status(401).json({ error: "Not authenticated" });
        }
  
        const {
          enabled,
          autoSso,
          clientId,
          clientSecret,
          authUrl,
          tokenUrl,
          userInfoUrl,
          redirectUrl,
          logoutUrl,
          userIdentifier,
          scopes,
          authStyle,
        } = req.body;
  
        // Check if config already exists
        const existingConfig = await storage.getSsoConfig(req.user.id);
        
        // If clientSecret is empty or masked, keep the existing one
        let finalClientSecret = clientSecret;
        if ((!clientSecret || clientSecret === '********') && existingConfig) {
          finalClientSecret = existingConfig.clientSecret;
        }
        
        const configData = {
          userId: req.user.id,
          enabled: enabled ? 1 : 0,
          autoSso: autoSso ? 1 : 0,
          clientId,
          clientSecret: finalClientSecret,
          authUrl,
          tokenUrl,
          userInfoUrl,
          redirectUrl,
          logoutUrl: logoutUrl || null,
          userIdentifier: userIdentifier || 'email',
          scopes: scopes || 'openid',
          authStyle: authStyle || 'auto',
        };
  
        let config;
        if (existingConfig) {
          // Update existing config
          config = await storage.updateSsoConfig(req.user.id, configData);
        } else {
          // Create new config
          config = await storage.createSsoConfig(configData);
        }
  
        if (!config) {
          return res.status(500).json({ error: "Failed to save SSO config" });
        }
  
        // Don't send client secret back
        const { clientSecret: _, ...safeConfig } = config;
        res.json({ ...safeConfig, clientSecret: '********' });
      } catch (error) {
        console.error("Error saving SSO config:", error);
        res.status(500).json({ error: "Failed to save SSO config" });
      }
    });
  
    app.delete("/api/sso-config", async (req, res) => {
      try {
        if (!req.user) {
          return res.status(401).json({ error: "Not authenticated" });
        }
  
        await storage.deleteSsoConfig(req.user.id);
        res.json({ success: true });
      } catch (error) {
        console.error("Error deleting SSO config:", error);
        res.status(500).json({ error: "Failed to delete SSO config" });
      }
    });
  
    // SSO Login flow endpoints
    app.get("/api/sso/login", async (req, res) => {
      try {
        // Get the first enabled SSO config (system-wide)
        const allUsers = await storage.getAllUsers();
        let config = null;
        
        for (const user of allUsers) {
          const userConfig = await storage.getSsoConfig(user.id);
          if (userConfig && userConfig.enabled === 1) {
            config = userConfig;
            break;
          }
        }
  
        if (!config) {
          return res.status(400).json({ error: "SSO not configured or disabled" });
        }
  
        // Store state in session for CSRF protection
        const crypto = await import("crypto");
        const state = crypto.randomBytes(32).toString('hex');
        req.session.ssoState = state;

        // Store returnTo in session if valid relative URL
        if (typeof req.query.returnTo === "string") {
          const target = req.query.returnTo.trim();
          if (target.startsWith("/") && !target.startsWith("//") && !target.includes("\\")) {
            req.session.ssoReturnTo = target;
          } else {
            delete req.session.ssoReturnTo;
          }
        } else {
          delete req.session.ssoReturnTo;
        }
  
        // Build authorization URL
        const authParams = new URLSearchParams({
          client_id: config.clientId,
          redirect_uri: config.redirectUrl,
          response_type: 'code',
          scope: config.scopes,
          state: state,
        });
  
        const authUrl = `${config.authUrl}?${authParams.toString()}`;
        
        // Redirect directly instead of returning JSON
        res.redirect(authUrl);
      } catch (error) {
        console.error("Error initiating SSO login:", error);
        res.status(500).json({ error: "Failed to initiate SSO login" });
      }
    });
  
    app.get("/api/sso/callback", async (req, res) => {
      try {
        const { code, state } = req.query;
  
        // Verify state for CSRF protection
        if (!state || state !== req.session.ssoState) {
          return res.redirect('/?error=invalid_state');
        }
  
        // Get the first enabled SSO config (system-wide)
        const allUsers = await storage.getAllUsers();
        let config = null;
        
        for (const user of allUsers) {
          const userConfig = await storage.getSsoConfig(user.id);
          if (userConfig && userConfig.enabled === 1) {
            config = userConfig;
            break;
          }
        }
  
        if (!config) {
          return res.redirect('/?error=sso_disabled');
        }
  
        // Exchange code for token
        const tokenParams: any = {
          grant_type: 'authorization_code',
          code,
          redirect_uri: config.redirectUrl,
        };
  
        let tokenResponse;
        const axios = (await import("axios")).default;
  
        if (config.authStyle === 'in_header' || config.authStyle === 'auto') {
          // Try Basic Auth first
          try {
            const auth = Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64');
            tokenResponse = await axios.post(config.tokenUrl, new URLSearchParams(tokenParams), {
              headers: {
                'Authorization': `Basic ${auth}`,
                'Content-Type': 'application/x-www-form-urlencoded',
              },
            });
          } catch (error) {
            // If auto mode and header auth failed, try params
            if (config.authStyle === 'auto') {
              tokenParams.client_id = config.clientId;
              tokenParams.client_secret = config.clientSecret;
              tokenResponse = await axios.post(config.tokenUrl, new URLSearchParams(tokenParams), {
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
              });
            } else {
              throw error;
            }
          }
        } else {
          // in_params mode
          tokenParams.client_id = config.clientId;
          tokenParams.client_secret = config.clientSecret;
          tokenResponse = await axios.post(config.tokenUrl, new URLSearchParams(tokenParams), {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          });
        }
  
        const accessToken = tokenResponse.data.access_token;
        if (!accessToken) {
          return res.redirect('/login?error=no_access_token');
        }
  
        // Get user info
        const userInfoResponse = await axios.get(config.userInfoUrl, {
          headers: { 'Authorization': `Bearer ${accessToken}` },
        });
  
        const userInfo = userInfoResponse.data;
        const identifierValue = userInfo[config.userIdentifier];
  
        if (!identifierValue) {
          return res.redirect('/login?error=missing_identifier');
        }
  
        // Get user by SSO email
        const user = await storage.getUserBySsoEmail(identifierValue);
        if (!user) {
          return res.redirect('/?error=sso_email_not_found');
        }
  
        // Clean up session state
        delete req.session.ssoState;
  
        // Log the user in
        req.login(user, (err) => {
          if (err) {
            console.error("Error logging in after SSO:", err);
            return res.redirect('/?error=login_failed');
          }
          const returnTo = req.session.ssoReturnTo;
          delete req.session.ssoReturnTo;
          if (
            typeof returnTo === "string" &&
            returnTo.startsWith("/") &&
            !returnTo.startsWith("//") &&
            !returnTo.includes("\\")
          ) {
            return res.redirect(returnTo);
          }
          res.redirect('/');
        });
      } catch (error) {
        console.error("Error in SSO callback:", error);
        res.redirect('/?error=callback_failed');
      }
    });

    app.get("/api/settings", async (req, res) => {
      try {
        if (!req.user) {
          return res.status(401).json({ error: "Not authenticated" });
        }
        const keys = [
          "experimental_demos_enabled",
          "chrome_extension_id",
          "chrome_extension_max_records",
          "osint_auto_scan_enabled",
          "osint_auto_scan_tools",
          "osint_auto_scan_interval_seconds",
          "stories_enabled",
          "stories_api_url",
          "stories_run_window",
          "stories_run_every_days",
          "stories_skip_day_probability",
          "stories_next_run_at",
          "tracking_level_defaults",
          "tracking_skip_recent",
          TRACKING_BIG_ACCOUNTS_NONE_KEY,
          TRACKING_MENTIONS_CREATE_KEY,
          TRACKING_MENTIONS_QUEUE_INFO_KEY,
          "posts_comment_limit",
          "posts_scan_limit",
          "posts_download_videos",
          "connection_strength",
          "google_maps_api_key",
          "google_maps_map_id",
          "carto_api_key",
        ];
        const settings: Record<string, string | null> = {};
        for (const key of keys) {
          settings[key] = await storage.getAppSetting(key);
        }
        res.json(settings);
      } catch (error) {
        console.error("Error fetching settings:", error);
        res.status(500).json({ error: "Failed to fetch settings" });
      }
    });

    app.post("/api/settings", requireAuth, async (req, res) => {
      try {
        const { key, value } = req.body;
        if (!key || typeof value !== "string") {
          return res.status(400).json({ error: "Invalid key or value" });
        }
        await storage.setAppSetting(key, value);
        if (key === TRACKING_BIG_ACCOUNTS_NONE_KEY) await applyBigAccountRule();
        res.json({ success: true });
      } catch (error) {
        console.error("Error saving setting:", error);
        res.status(500).json({ error: "Failed to save setting" });
      }
    });

    app.get("/api/git/branch", async (req, res) => {
      try {
        if (!req.user) {
          return res.status(401).json({ error: "Not authenticated" });
        }
        let branch = "unknown";
        try {
          const headPath = path.join(process.cwd(), ".git", "HEAD");
          if (fs.existsSync(headPath)) {
            const headContent = fs.readFileSync(headPath, "utf-8").trim();
            if (headContent.startsWith("ref: ")) {
              branch = headContent.substring("ref: ".length).replace("refs/heads/", "");
            } else {
              // Detached head, return short SHA
              branch = headContent.substring(0, 7);
            }
          } else {
            // Fallback to git command if .git/HEAD isn't directly readable or doesn't exist
            const { execSync } = await import("child_process");
            branch = execSync("git rev-parse --abbrev-ref HEAD", { encoding: "utf8" }).trim();
          }
        } catch (gitError) {
          console.error("Error reading git branch:", gitError);
          try {
            const { execSync } = await import("child_process");
            branch = execSync("git rev-parse --abbrev-ref HEAD", { encoding: "utf8" }).trim();
          } catch (cmdError) {
            console.error("Error executing git command:", cmdError);
          }
        }
        res.json({ branch });
      } catch (error) {
        console.error("Error in /api/git/branch:", error);
        res.status(500).json({ error: "Failed to get git branch" });
      }
    });
  
}
