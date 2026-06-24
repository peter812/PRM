// Generated route module - auth-setup.ts
import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "../storage";
import { db } from "../db";
import { interactions, relationshipTypes, interactionTypes, people, socialNetworkChanges, socialAccountPosts, socialAccounts, socialProfileVersions, aiChats, dailyNotes, type SocialAccountWithCurrentProfile, type ExtensionSession, type AiChatMessage, type AiToolCallTrace } from "@shared/schema";
import { AI_TOOLS, getAiToolByName, listAiToolMetadata, buildOllamaToolsArray } from "../ai-tools";
import { generateFamilyTreeChanges, applyFamilyTreeChanges, type ProposedFamilyChange } from "../family-tree-ai";
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
} from "@shared/schema";
import multer from "multer";
import { uploadImageToS3, deleteImageFromS3 } from "../s3";
import { uploadImageLocally, deleteImageLocally, getLocalImagePath, isLocalImageUrl } from "../local-storage";
import { hashPassword, requireAuth } from "../auth";
import { triggerTaskWorker, triggerImageTaskWorker, pauseTaskWorker, resumeTaskWorker, isTaskWorkerPaused } from "../task-worker";
import { syncEntityInBackground } from "../vector-universal";
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
  "/sso-config/status",
  "/sso/login",
  "/sso/callback",
  "/extension-auth/verify",
  "/extension-auth/ping",
  "/v1/ping",
  "/posts/instagram/import",
]);




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
    app.use("/api", (req, res, next) => {
      if (PUBLIC_API_PATHS.has(req.path)) return next();
      return requireAuth(req, res, next);
    });
  
    // Serve local images (authenticated)
    app.get("/api/images/:filename", (req, res) => {
      if (!req.isAuthenticated()) {
        return res.status(401).json({ error: "Not authenticated" });
      }
  
      const filePath = getLocalImagePath(req.params.filename);
      if (!filePath) {
        return res.status(404).json({ error: "Image not found" });
      }
  
      res.sendFile(filePath);
    });
  
    // Image upload endpoint
    app.post("/api/upload-image", upload.single("image"), async (req, res) => {
      try {
        if (!req.file) {
          return res.status(400).json({ error: "No image file provided" });
        }
  
        let storageMode = "s3";
        if (req.isAuthenticated() && req.user) {
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
        const capturedBuffer = req.file?.buffer;
        const capturedPhotoId = photoId;
        const capturedPrmLocation = prmLocation;
        ;(async () => {
          try {
            const autoDescribe = (await getOllamaSetting("ollama_auto_describe_images")) === "true";
            if (!autoDescribe) return;
            // Skip profile images
            if (
              capturedPrmLocation.startsWith("profile_image") ||
              capturedPrmLocation.startsWith("social_profile_image")
            ) return;
            if (!capturedPhotoId || !capturedBuffer) return;
            const ollamaEnabled = (await getOllamaSetting("ollama_enabled")) === "true";
            if (!ollamaEnabled) return;
            const apiUrl = (await getOllamaSetting("ollama_api_url")) ?? "";
            if (!apiUrl.trim()) return;
            const model = (await getOllamaSetting("ollama_model")) ?? "";
            if (!model.trim()) return;
            const base = apiUrl.replace(/\/+$/, "");
            const authRequired = (await getOllamaSetting("ollama_auth_required")) === "true";
            const headers: Record<string, string> = { "Content-Type": "application/json" };
            if (authRequired) {
              const uname = (await getOllamaSetting("ollama_username")) ?? "";
              const pwd = (await getOllamaSetting("ollama_password")) ?? "";
              headers["Authorization"] = "Basic " + Buffer.from(`${uname}:${pwd}`).toString("base64");
            }
            const savedPrompt = (await getOllamaSetting("ollama_prompt")) ?? "";
            const prompt = savedPrompt || "Return 2 sentences explaining what is happening in this image.";
            const imageBase64 = capturedBuffer.toString("base64");
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
              if (!resp.ok) return;
              const data = await resp.json() as { response?: string; error?: string };
              if (data.error || !data.response) return;
              await storage.updatePhotoMeta(capturedPhotoId, {
                imageDescription: data.response,
                imageDescriptionAt: new Date(),
              });
              syncEntityInBackground("image", capturedPhotoId);
            } catch {
              clearTimeout(timeout);
            }
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
  
        if (isLocalImageUrl(imageUrl)) {
          await deleteImageLocally(imageUrl);
        } else {
          await deleteImageFromS3(imageUrl);
        }
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
    app.get("/api/export-xml", async (req, res) => {
      try {
        if (!req.user) {
          return res.status(401).json({ error: "Not authenticated" });
        }
  
        const includeHistory = req.query.includeHistory === "true";
  
        // Fetch all data from database in parallel for better performance
        const [
          allUsers,
          allPeople,
          allRelationshipTypes,
          allRelationships,
          allInteractionTypes,
          allInteractions,
          allGroups,
          allNotes,
          allGroupNotes,
          allSocialAccounts,
          allSocialAccountTypes,
          allProfileVersions,
          allNetworkStates,
          mePersonResult,
        ] = await Promise.all([
          storage.getAllUsers(),
          storage.getAllPeople(),
          storage.getAllRelationshipTypes(),
          storage.getAllRelationships(),
          storage.getAllInteractionTypes(),
          storage.getAllInteractions(),
          storage.getAllGroups(),
          storage.getAllNotes(),
          storage.getAllGroupNotes(),
          storage.getAllSocialAccounts(),
          storage.getAllSocialAccountTypes(),
          storage.getAllProfileVersions(),
          storage.getAllNetworkStates(),
          db.select().from(people).where(isNotNull(people.userId)).limit(1),
        ]);
        
        const user = allUsers[0];
        const groups = allGroups;
        const mePersonId = mePersonResult[0]?.id || null;
        const ZERO_UUID = "00000000-0000-0000-0000-000000000000";
        
        // Filter out ME user from people export
        const peopleToExport = allPeople.filter(p => p.id !== mePersonId);
  
        // Helper function to escape XML special characters
        const escapeXml = (str: any): string => {
          if (str === null || str === undefined) return "";
          return String(str)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&apos;");
        };
  
        // Helper function to convert array to XML
        const arrayToXml = (arr: any[], itemName: string): string => {
          if (!arr || arr.length === 0) return "";
          return arr.map(item => `<${itemName}>${escapeXml(item)}</${itemName}>`).join("");
        };
  
        // Build XML document
        let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
        xml += '<crm_data>\n';
  
        // Export user profile
        xml += '  <user_profile>\n';
        xml += `    <name>${escapeXml(user?.name || "")}</name>\n`;
        xml += `    <nickname>${escapeXml(user?.nickname || "")}</nickname>\n`;
        xml += '  </user_profile>\n';
  
        // Export relationship types
        xml += '  <relationship_types>\n';
        for (const type of allRelationshipTypes) {
          xml += '    <relationship_type>\n';
          xml += `      <id>${escapeXml(type.id)}</id>\n`;
          xml += `      <name>${escapeXml(type.name)}</name>\n`;
          xml += `      <color>${escapeXml(type.color)}</color>\n`;
          xml += `      <value>${escapeXml(type.value)}</value>\n`;
          xml += `      <notes>${escapeXml(type.notes || "")}</notes>\n`;
          xml += `      <created_at>${escapeXml(type.createdAt)}</created_at>\n`;
          xml += '    </relationship_type>\n';
        }
        xml += '  </relationship_types>\n';
  
        // Export interaction types
        xml += '  <interaction_types>\n';
        for (const type of allInteractionTypes) {
          xml += '    <interaction_type>\n';
          xml += `      <id>${escapeXml(type.id)}</id>\n`;
          xml += `      <name>${escapeXml(type.name)}</name>\n`;
          xml += `      <color>${escapeXml(type.color)}</color>\n`;
          xml += `      <description>${escapeXml(type.description || "")}</description>\n`;
          xml += `      <value>${escapeXml(type.value)}</value>\n`;
          xml += `      <created_at>${escapeXml(type.createdAt)}</created_at>\n`;
          xml += '    </interaction_type>\n';
        }
        xml += '  </interaction_types>\n';
  
        // Export people (excluding ME user)
        xml += '  <people>\n';
        for (const person of peopleToExport) {
          xml += '    <person>\n';
          xml += `      <id>${escapeXml(person.id)}</id>\n`;
          xml += `      <first_name>${escapeXml(person.firstName)}</first_name>\n`;
          xml += `      <last_name>${escapeXml(person.lastName)}</last_name>\n`;
          xml += `      <email>${escapeXml(person.email || "")}</email>\n`;
          xml += `      <phone>${escapeXml(person.phone || "")}</phone>\n`;
          xml += `      <company>${escapeXml(person.company || "")}</company>\n`;
          xml += `      <title>${escapeXml(person.title || "")}</title>\n`;
          xml += `      <tags>${arrayToXml(person.tags || [], "tag")}</tags>\n`;
          xml += `      <image_url>${escapeXml(person.imageUrl || "")}</image_url>\n`;
          xml += `      <social_account_uuids>${arrayToXml(person.socialAccountUuids || [], "social_account_uuid")}</social_account_uuids>\n`;
          xml += `      <is_starred>${escapeXml(person.isStarred)}</is_starred>\n`;
          xml += `      <elo_score>${escapeXml(person.eloScore)}</elo_score>\n`;
          xml += `      <no_social_media>${escapeXml(person.noSocialMedia ?? 0)}</no_social_media>\n`;
          xml += `      <created_at>${escapeXml(person.createdAt)}</created_at>\n`;
          xml += '    </person>\n';
        }
        xml += '  </people>\n';
  
        // Export relationships (encode ME user UUID as all zeros)
        xml += '  <relationships>\n';
        for (const rel of allRelationships) {
          const fromPersonId = rel.fromPersonId === mePersonId ? ZERO_UUID : rel.fromPersonId;
          const toPersonId = rel.toPersonId === mePersonId ? ZERO_UUID : rel.toPersonId;
          
          xml += '    <relationship>\n';
          xml += `      <id>${escapeXml(rel.id)}</id>\n`;
          xml += `      <from_person_id>${escapeXml(fromPersonId)}</from_person_id>\n`;
          xml += `      <to_person_id>${escapeXml(toPersonId)}</to_person_id>\n`;
          xml += `      <type_id>${escapeXml(rel.typeId)}</type_id>\n`;
          xml += `      <notes>${escapeXml(rel.notes || "")}</notes>\n`;
          xml += `      <created_at>${escapeXml(rel.createdAt)}</created_at>\n`;
          xml += '    </relationship>\n';
        }
        xml += '  </relationships>\n';
  
        // Export groups (encode ME user UUID as all zeros in members)
        xml += '  <groups>\n';
        for (const group of groups) {
          const members = (group.members || []).map(memberId => 
            memberId === mePersonId ? ZERO_UUID : memberId
          );
          
          xml += '    <group>\n';
          xml += `      <id>${escapeXml(group.id)}</id>\n`;
          xml += `      <name>${escapeXml(group.name)}</name>\n`;
          xml += `      <color>${escapeXml(group.color)}</color>\n`;
          xml += `      <type>${arrayToXml(group.type || [], "group_type")}</type>\n`;
          xml += `      <members>${arrayToXml(members, "member_id")}</members>\n`;
          xml += `      <image_url>${escapeXml(group.imageUrl || "")}</image_url>\n`;
          xml += `      <created_at>${escapeXml(group.createdAt)}</created_at>\n`;
          xml += '    </group>\n';
        }
        xml += '  </groups>\n';
  
        // Export interactions (encode ME user UUID as all zeros in peopleIds)
        xml += '  <interactions>\n';
        for (const interaction of allInteractions) {
          const peopleIds = (interaction.peopleIds || []).map(personId => 
            personId === mePersonId ? ZERO_UUID : personId
          );
          
          xml += '    <interaction>\n';
          xml += `      <id>${escapeXml(interaction.id)}</id>\n`;
          xml += `      <type_id>${escapeXml(interaction.typeId)}</type_id>\n`;
          xml += `      <title>${escapeXml(interaction.title || "")}</title>\n`;
          xml += `      <date>${escapeXml(interaction.date)}</date>\n`;
          xml += `      <description>${escapeXml(interaction.description || "")}</description>\n`;
          xml += `      <image_url>${escapeXml(interaction.imageUrl || "")}</image_url>\n`;
          xml += `      <image_uuid>${escapeXml(interaction.imageUuid || "")}</image_uuid>\n`;
          xml += `      <people_ids>${arrayToXml(peopleIds, "person_id")}</people_ids>\n`;
          xml += `      <group_ids>${arrayToXml(interaction.groupIds || [], "group_id")}</group_ids>\n`;
          xml += `      <created_at>${escapeXml(interaction.createdAt)}</created_at>\n`;
          xml += '    </interaction>\n';
        }
        xml += '  </interactions>\n';
  
        // Export notes (exclude notes for ME user)
        xml += '  <notes>\n';
        for (const note of allNotes) {
          if (note.personId === mePersonId) continue; // Skip ME user's notes
          
          xml += '    <note>\n';
          xml += `      <id>${escapeXml(note.id)}</id>\n`;
          xml += `      <person_id>${escapeXml(note.personId)}</person_id>\n`;
          xml += `      <content>${escapeXml(note.content)}</content>\n`;
          xml += `      <image_url>${escapeXml(note.imageUrl || "")}</image_url>\n`;
          xml += `      <image_uuid>${escapeXml(note.imageUuid || "")}</image_uuid>\n`;
          xml += `      <created_at>${escapeXml(note.createdAt)}</created_at>\n`;
          xml += '    </note>\n';
        }
        xml += '  </notes>\n';
  
        // Export group notes
        xml += '  <group_notes>\n';
        for (const note of allGroupNotes) {
          xml += '    <group_note>\n';
          xml += `      <id>${escapeXml(note.id)}</id>\n`;
          xml += `      <group_id>${escapeXml(note.groupId)}</group_id>\n`;
          xml += `      <content>${escapeXml(note.content)}</content>\n`;
          xml += `      <created_at>${escapeXml(note.createdAt)}</created_at>\n`;
          xml += '    </group_note>\n';
        }
        xml += '  </group_notes>\n';
  
        const networkStateMap = new Map(allNetworkStates.map(s => [s.socialAccountId, s]));
  
        xml += '  <social_accounts>\n';
        for (const account of allSocialAccounts) {
          const ownerUuid = account.ownerUuid === mePersonId ? ZERO_UUID : account.ownerUuid;
          const accountState = networkStateMap.get(account.id);
          
          xml += '    <social_account>\n';
          xml += `      <id>${escapeXml(account.id)}</id>\n`;
          xml += `      <username>${escapeXml(account.username)}</username>\n`;
          xml += `      <nickname>${escapeXml(account.currentProfile?.nickname || "")}</nickname>\n`;
          xml += `      <account_url>${escapeXml(account.currentProfile?.accountUrl || "")}</account_url>\n`;
          xml += `      <owner_uuid>${escapeXml(ownerUuid || "")}</owner_uuid>\n`;
          xml += `      <type_id>${escapeXml(account.typeId || "")}</type_id>\n`;
          xml += `      <image_url>${escapeXml(account.currentProfile?.imageUrl || "")}</image_url>\n`;
          xml += `      <notes></notes>\n`;
          xml += `      <following>${arrayToXml(accountState?.following || [], "account_id")}</following>\n`;
          xml += `      <followers>${arrayToXml(accountState?.followers || [], "account_id")}</followers>\n`;
          xml += `      <internal_account_creation_date>${escapeXml(account.internalAccountCreationDate)}</internal_account_creation_date>\n`;
          xml += `      <internal_account_creation_type>${escapeXml(account.internalAccountCreationType)}</internal_account_creation_type>\n`;
          xml += `      <created_at>${escapeXml(account.createdAt)}</created_at>\n`;
          xml += '    </social_account>\n';
        }
        xml += '  </social_accounts>\n';
  
        // Export social account types
        xml += '  <social_account_types>\n';
        for (const type of allSocialAccountTypes) {
          xml += '    <social_account_type>\n';
          xml += `      <id>${escapeXml(type.id)}</id>\n`;
          xml += `      <name>${escapeXml(type.name)}</name>\n`;
          xml += `      <color>${escapeXml(type.color)}</color>\n`;
          xml += `      <created_at>${escapeXml(type.createdAt)}</created_at>\n`;
          xml += '    </social_account_type>\n';
        }
        xml += '  </social_account_types>\n';
  
        // Export social account posts (non-deleted)
        const allPosts = await storage.getAllPosts();
        xml += '  <social_account_posts>\n';
        for (const post of allPosts) {
          xml += '    <social_account_post>\n';
          xml += `      <id>${escapeXml(post.id)}</id>\n`;
          xml += `      <social_account_id>${escapeXml(post.socialAccountId)}</social_account_id>\n`;
          xml += `      <post_type>${escapeXml(post.postType)}</post_type>\n`;
          xml += `      <content>${escapeXml(post.content || "")}</content>\n`;
          xml += `      <description>${escapeXml(post.description || "")}</description>\n`;
          xml += `      <like_count>${escapeXml(post.likeCount)}</like_count>\n`;
          xml += `      <comment_count>${escapeXml(post.commentCount)}</comment_count>\n`;
          xml += `      <comments>${escapeXml(post.comments || "")}</comments>\n`;
          xml += `      <mentioned_accounts>${escapeXml(post.mentionedAccounts || "")}</mentioned_accounts>\n`;
          xml += `      <posted_at>${escapeXml(post.postedAt || "")}</posted_at>\n`;
          xml += `      <created_at>${escapeXml(post.createdAt)}</created_at>\n`;
          xml += '    </social_account_post>\n';
        }
        xml += '  </social_account_posts>\n';
  
        if (includeHistory) {
          // Export social profile versions
          xml += '  <social_profile_versions>\n';
          for (const version of allProfileVersions) {
            xml += '    <social_profile_version>\n';
            xml += `      <id>${escapeXml(version.id)}</id>\n`;
            xml += `      <social_account_id>${escapeXml(version.socialAccountId)}</social_account_id>\n`;
            xml += `      <nickname>${escapeXml(version.nickname || "")}</nickname>\n`;
            xml += `      <bio>${escapeXml(version.bio || "")}</bio>\n`;
            xml += `      <account_url>${escapeXml(version.accountUrl || "")}</account_url>\n`;
            xml += `      <image_url>${escapeXml(version.imageUrl || "")}</image_url>\n`;
            xml += `      <external_image_url>${escapeXml(version.externalImageUrl || "")}</external_image_url>\n`;
            xml += `      <is_current>${escapeXml(version.isCurrent)}</is_current>\n`;
            xml += `      <detected_at>${escapeXml(version.detectedAt)}</detected_at>\n`;
            xml += '    </social_profile_version>\n';
          }
          xml += '  </social_profile_versions>\n';
  
          // Export social network states (current snapshots)
          xml += '  <social_network_snapshots>\n';
          for (const state of allNetworkStates) {
            xml += '    <social_network_snapshot>\n';
            xml += `      <id>${escapeXml(state.id)}</id>\n`;
            xml += `      <social_account_id>${escapeXml(state.socialAccountId)}</social_account_id>\n`;
            xml += `      <follower_count>${escapeXml(state.followerCount)}</follower_count>\n`;
            xml += `      <following_count>${escapeXml(state.followingCount)}</following_count>\n`;
            xml += `      <followers>${arrayToXml(state.followers || [], "account_id")}</followers>\n`;
            xml += `      <following>${arrayToXml(state.following || [], "account_id")}</following>\n`;
            xml += `      <captured_at>${escapeXml(state.updatedAt)}</captured_at>\n`;
            xml += '    </social_network_snapshot>\n';
          }
          xml += '  </social_network_snapshots>\n';
  
          // Export social network changes
          const allNetworkChanges = await storage.getAllNetworkChanges();
          xml += '  <social_network_changes>\n';
          for (const change of allNetworkChanges) {
            xml += '    <social_network_change>\n';
            xml += `      <id>${escapeXml(change.id)}</id>\n`;
            xml += `      <social_account_id>${escapeXml(change.socialAccountId)}</social_account_id>\n`;
            xml += `      <change_type>${escapeXml(change.changeType)}</change_type>\n`;
            xml += `      <direction>${escapeXml(change.direction)}</direction>\n`;
            xml += `      <target_account_id>${escapeXml(change.targetAccountId)}</target_account_id>\n`;
            xml += `      <detected_at>${escapeXml(change.detectedAt)}</detected_at>\n`;
            xml += `      <batch_id>${escapeXml(change.batchId || "")}</batch_id>\n`;
            xml += '    </social_network_change>\n';
          }
          xml += '  </social_network_changes>\n';
        }
  
        xml += '</crm_data>';
  
        // Set headers for file download
        res.setHeader("Content-Type", "application/xml");
        res.setHeader("Content-Disposition", `attachment; filename="crm_export_${new Date().toISOString().split('T')[0]}.xml"`);
        res.send(xml);
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
  
        const xmlText = req.file.buffer.toString("utf-8");
  
        // Simple XML parser using regex (for basic XML structure)
        const parseXmlTag = (tagName: string, text: string): string => {
          const regex = new RegExp(`<${tagName}>(.*?)</${tagName}>`, 's');
          const match = text.match(regex);
          return match ? match[1].trim() : "";
        };
  
        const parseXmlArray = (containerTag: string, itemTag: string, text: string): string[] => {
          const containerContent = parseXmlTag(containerTag, text);
          if (!containerContent) return [];
          const itemRegex = new RegExp(`<${itemTag}>(.*?)</${itemTag}>`, 'gs');
          const matches = containerContent.matchAll(itemRegex);
          return Array.from(matches).map(m => m[1].trim());
        };
  
        const parseAllTags = (tagName: string, text: string): string[] => {
          const regex = new RegExp(`<${tagName}>(.*?)</${tagName}>`, 'gs');
          const matches = text.matchAll(regex);
          return Array.from(matches).map(m => m[1].trim());
        };
  
        const unescapeXml = (str: string): string => {
          return str
            .replace(/&amp;/g, "&")
            .replace(/&lt;/g, "<")
            .replace(/&gt;/g, ">")
            .replace(/&quot;/g, '"')
            .replace(/&apos;/g, "'");
        };
  
        // Get ME user's person ID for replacing all-zero UUIDs
        const mePersonResult = await db.select().from(people).where(isNotNull(people.userId)).limit(1);
        const mePersonId = mePersonResult[0]?.id || null;
        const ZERO_UUID = "00000000-0000-0000-0000-000000000000";
        
        // Helper function to replace zero UUIDs with ME user UUID
        const replaceZeroUUID = (uuid: string): string => {
          if (!mePersonId) return uuid;
          return uuid === ZERO_UUID ? mePersonId : uuid;
        };
  
        let importedCounts: Record<string, number> = {
          relationshipTypes: 0,
          interactionTypes: 0,
          people: 0,
          relationships: 0,
          groups: 0,
          interactions: 0,
          notes: 0,
          groupNotes: 0,
          socialAccounts: 0,
          socialAccountTypes: 0,
          posts: 0,
          messages: 0,
          networkChanges: 0,
        };
        
        let skippedCounts: Record<string, number> = {
          relationshipTypes: 0,
          interactionTypes: 0,
          people: 0,
          relationships: 0,
          interactions: 0,
          socialAccounts: 0,
          socialAccountTypes: 0,
          messages: 0,
        };
  
        // Get existing data to check for duplicates (by UUID)
        const existingRelationshipTypes = await storage.getAllRelationshipTypes();
        const existingInteractionTypes = await storage.getAllInteractionTypes();
        const existingPeople = await storage.getAllPeople();
        const existingRelationships = await storage.getAllRelationships();
        const existingInteractions = await storage.getAllInteractions();
        const existingSocialAccounts = await storage.getAllSocialAccounts();
        
        // Create UUID sets for fast lookup
        const existingRelationshipTypeUuids = new Set(existingRelationshipTypes.map(t => t.id));
        const existingInteractionTypeUuids = new Set(existingInteractionTypes.map(t => t.id));
        const existingRelationshipUuids = new Set(existingRelationships.map(r => r.id));
        const existingInteractionUuids = new Set(existingInteractions.map(i => i.id));
        const existingSocialAccountUuids = new Set(existingSocialAccounts.map(s => s.id));
  
        // Parse and import relationship types
        const relationshipTypeBlocks = parseAllTags("relationship_type", xmlText);
        for (const block of relationshipTypeBlocks) {
          const id = unescapeXml(parseXmlTag("id", block));
          const name = unescapeXml(parseXmlTag("name", block));
          const color = unescapeXml(parseXmlTag("color", block));
          const notes = unescapeXml(parseXmlTag("notes", block));
  
          // Check for duplicate by UUID
          if (existingRelationshipTypeUuids.has(id)) {
            skippedCounts.relationshipTypes++;
            continue; // Skip this duplicate
          }
  
          try {
            await db.insert(relationshipTypes).values({ id, name, color, notes: notes || null, value: 50 }).onConflictDoNothing();
            importedCounts.relationshipTypes++;
            existingRelationshipTypeUuids.add(id);
          } catch (error) {
            console.error(`Error importing relationship type ${id}:`, error);
          }
        }
  
        // Parse and import interaction types
        const interactionTypeBlocks = parseAllTags("interaction_type", xmlText);
        for (const block of interactionTypeBlocks) {
          const id = unescapeXml(parseXmlTag("id", block));
          const name = unescapeXml(parseXmlTag("name", block));
          const color = unescapeXml(parseXmlTag("color", block));
          const description = unescapeXml(parseXmlTag("description", block));
          const value = parseInt(parseXmlTag("value", block)) || 50;
  
          // Check for duplicate by UUID
          if (existingInteractionTypeUuids.has(id)) {
            skippedCounts.interactionTypes++;
            continue; // Skip this duplicate
          }
  
          try {
            await db.insert(interactionTypes).values({ id, name, color, description: description || null, value }).onConflictDoNothing();
            importedCounts.interactionTypes++;
            existingInteractionTypeUuids.add(id);
          } catch (error) {
            console.error(`Error importing interaction type ${id}:`, error);
          }
        }
  
        // Parse and import people
        // Create a map for fast lookup by firstName + UUID
        const existingPeopleMap = new Map<string, boolean>();
        for (const p of existingPeople) {
          existingPeopleMap.set(`${p.firstName.toLowerCase()}:${p.id}`, true);
        }
        
        const personBlocks = parseAllTags("person", xmlText);
        for (const block of personBlocks) {
          const id = unescapeXml(parseXmlTag("id", block));
          const firstName = unescapeXml(parseXmlTag("first_name", block));
          const lastName = unescapeXml(parseXmlTag("last_name", block));
          const email = unescapeXml(parseXmlTag("email", block));
          const phone = unescapeXml(parseXmlTag("phone", block));
          const company = unescapeXml(parseXmlTag("company", block));
          const title = unescapeXml(parseXmlTag("title", block));
          const tags = parseXmlArray("tags", "tag", block);
          const imageUrl = unescapeXml(parseXmlTag("image_url", block));
          const socialAccountUuids = parseXmlArray("social_account_uuids", "social_account_uuid", block);
          const isStarred = parseInt(parseXmlTag("is_starred", block)) || 0;
          const eloScore = parseInt(parseXmlTag("elo_score", block)) || 1200;
          const noSocialMedia = parseInt(parseXmlTag("no_social_media", block)) || 0;
  
          // Check for duplicate by First Name AND UUID
          const lookupKey = `${firstName.toLowerCase()}:${id}`;
          if (existingPeopleMap.has(lookupKey)) {
            skippedCounts.people++;
            continue; // Skip this duplicate
          }
  
          try {
            await storage.createPersonWithId({
              id,
              firstName,
              lastName,
              email: email || null,
              phone: phone || null,
              company: company || null,
              title: title || null,
              tags: tags.length > 0 ? tags : [],
              imageUrl: imageUrl || null,
              socialAccountUuids: socialAccountUuids.length > 0 ? socialAccountUuids : [],
              isStarred: isStarred,
              eloScore: eloScore,
              noSocialMedia: noSocialMedia,
            });
            importedCounts.people++;
            existingPeopleMap.set(lookupKey, true);
          } catch (error) {
            console.error(`Error importing person ${id}:`, error);
          }
        }
  
        // Parse and import groups
        const groupBlocks = parseAllTags("group", xmlText);
        for (const block of groupBlocks) {
          const id = unescapeXml(parseXmlTag("id", block));
          const name = unescapeXml(parseXmlTag("name", block));
          const color = unescapeXml(parseXmlTag("color", block));
          const type = parseXmlArray("type", "group_type", block);
          const members = parseXmlArray("members", "member_id", block);
          const imageUrl = unescapeXml(parseXmlTag("image_url", block));
  
          // Replace zero UUIDs with ME user UUID in members
          const processedMembers = members.map(memberId => replaceZeroUUID(memberId));
  
          try {
            await storage.createGroupWithId({
              id,
              name,
              color,
              type: type.length > 0 ? type : [],
              members: processedMembers.length > 0 ? processedMembers : [],
              imageUrl: imageUrl || null,
            });
            importedCounts.groups++;
          } catch (error) {
            console.error(`Error importing group ${id}:`, error);
          }
        }
  
        // Parse and import relationships
        const relationshipBlocks = parseAllTags("relationship", xmlText);
        for (const block of relationshipBlocks) {
          const id = unescapeXml(parseXmlTag("id", block));
          const fromPersonId = replaceZeroUUID(unescapeXml(parseXmlTag("from_person_id", block)));
          const toPersonId = replaceZeroUUID(unescapeXml(parseXmlTag("to_person_id", block)));
          const typeId = unescapeXml(parseXmlTag("type_id", block));
          const notes = unescapeXml(parseXmlTag("notes", block));
  
          // Check for duplicate by UUID
          if (existingRelationshipUuids.has(id)) {
            skippedCounts.relationships++;
            continue; // Skip this duplicate
          }
  
          try {
            await storage.createRelationshipWithId({
              id,
              fromPersonId,
              toPersonId,
              typeId,
              notes: notes || null,
            });
            importedCounts.relationships++;
            existingRelationshipUuids.add(id);
          } catch (error) {
            console.error(`Error importing relationship ${id}:`, error);
          }
        }
  
        // Parse and import interactions
        const interactionBlocks = parseAllTags("interaction", xmlText);
        for (const block of interactionBlocks) {
          const id = unescapeXml(parseXmlTag("id", block));
          const typeId = unescapeXml(parseXmlTag("type_id", block));
          const interactionTitle = unescapeXml(parseXmlTag("title", block));
          const date = unescapeXml(parseXmlTag("date", block));
          const description = unescapeXml(parseXmlTag("description", block));
          const imageUrl = unescapeXml(parseXmlTag("image_url", block));
          const imageUuid = unescapeXml(parseXmlTag("image_uuid", block));
          const peopleIds = parseXmlArray("people_ids", "person_id", block);
          const groupIds = parseXmlArray("group_ids", "group_id", block);
  
          // Check for duplicate by UUID
          if (existingInteractionUuids.has(id)) {
            skippedCounts.interactions++;
            continue; // Skip this duplicate
          }
  
          // Replace zero UUIDs with ME user UUID in peopleIds
          const processedPeopleIds = peopleIds.map(personId => replaceZeroUUID(personId));
  
          try {
            await storage.createInteractionWithId({
              id,
              typeId: typeId || undefined,
              title: interactionTitle || undefined,
              date: new Date(date),
              description: description || undefined,
              peopleIds: processedPeopleIds.length > 0 ? processedPeopleIds : [],
              groupIds: groupIds.length > 0 ? groupIds : [],
              imageUrl: imageUrl || undefined,
              imageUuid: imageUuid || undefined,
            });
            importedCounts.interactions++;
            existingInteractionUuids.add(id);
          } catch (error) {
            console.error(`Error importing interaction ${id}:`, error);
          }
        }
  
        // Parse and import notes
        const noteBlocks = parseAllTags("note", xmlText);
        for (const block of noteBlocks) {
          const id = unescapeXml(parseXmlTag("id", block));
          const personId = unescapeXml(parseXmlTag("person_id", block));
          const content = unescapeXml(parseXmlTag("content", block));
          const imageUrl = unescapeXml(parseXmlTag("image_url", block));
          const imageUuid = unescapeXml(parseXmlTag("image_uuid", block));
  
          try {
            await storage.createNoteWithId({ id, personId, content, imageUrl: imageUrl || null, imageUuid: imageUuid || null });
            importedCounts.notes++;
          } catch (error) {
            console.error(`Error importing note ${id}:`, error);
          }
        }
  
        // Parse and import group notes
        const groupNoteBlocks = parseAllTags("group_note", xmlText);
        for (const block of groupNoteBlocks) {
          const id = unescapeXml(parseXmlTag("id", block));
          const groupId = unescapeXml(parseXmlTag("group_id", block));
          const content = unescapeXml(parseXmlTag("content", block));
  
          try {
            await storage.createGroupNoteWithId({ id, groupId, content });
            importedCounts.groupNotes++;
          } catch (error) {
            console.error(`Error importing group note ${id}:`, error);
          }
        }
  
        // Parse and import social account types (before social accounts so typeId references work)
        const socialAccountTypeBlocks = parseAllTags("social_account_type", xmlText);
        const existingSocialAccountTypeUuids = new Set((await storage.getAllSocialAccountTypes()).map(t => t.id));
        for (const block of socialAccountTypeBlocks) {
          const id = unescapeXml(parseXmlTag("id", block));
          const name = unescapeXml(parseXmlTag("name", block));
          const color = unescapeXml(parseXmlTag("color", block));
  
          if (existingSocialAccountTypeUuids.has(id)) {
            skippedCounts.socialAccountTypes = (skippedCounts.socialAccountTypes || 0) + 1;
            continue;
          }
  
          try {
            await storage.createSocialAccountTypeWithId({ id, name, color });
            importedCounts.socialAccountTypes = (importedCounts.socialAccountTypes || 0) + 1;
            existingSocialAccountTypeUuids.add(id);
          } catch (error) {
            console.error(`Error importing social account type ${id}:`, error);
          }
        }
  
        // Parse and import social accounts
        const socialAccountBlocks = parseAllTags("social_account", xmlText);
        for (const block of socialAccountBlocks) {
          const id = unescapeXml(parseXmlTag("id", block));
          const username = unescapeXml(parseXmlTag("username", block));
          const nickname = unescapeXml(parseXmlTag("nickname", block));
          const accountUrl = unescapeXml(parseXmlTag("account_url", block));
          const ownerUuid = unescapeXml(parseXmlTag("owner_uuid", block));
          const typeId = unescapeXml(parseXmlTag("type_id", block));
          const imageUrl = unescapeXml(parseXmlTag("image_url", block));
          const following = parseXmlArray("following", "account_id", block);
          const followers = parseXmlArray("followers", "account_id", block);
          const internalAccountCreationDateStr = unescapeXml(parseXmlTag("internal_account_creation_date", block));
          const internalAccountCreationType = unescapeXml(parseXmlTag("internal_account_creation_type", block));
  
          if (existingSocialAccountUuids.has(id)) {
            skippedCounts.socialAccounts++;
            continue;
          }
  
          const processedOwnerUuid = replaceZeroUUID(ownerUuid);
  
          try {
            const created = await storage.createSocialAccountWithId({
              id,
              username,
              ownerUuid: processedOwnerUuid || null,
              typeId: typeId || null,
              internalAccountCreationType: internalAccountCreationType || "Import",
              internalAccountCreationDate: internalAccountCreationDateStr ? new Date(internalAccountCreationDateStr) : undefined,
            });
  
            if (nickname || accountUrl || imageUrl) {
              if (created.currentProfile) {
                await storage.updateProfileVersion(created.currentProfile.id, {
                  nickname: nickname || null,
                  accountUrl: accountUrl || null,
                  imageUrl: imageUrl || null,
                });
              }
            }
  
            if ((followers && followers.length > 0) || (following && following.length > 0)) {
              await storage.upsertNetworkState({
                socialAccountId: id,
                followerCount: followers.length,
                followingCount: following.length,
                followers: followers,
                following: following,
              });
            }
  
            importedCounts.socialAccounts++;
            existingSocialAccountUuids.add(id);
          } catch (error) {
            console.error(`Error importing social account ${id}:`, error);
          }
        }
  
        // Parse and import social profile versions (from new format exports)
        const profileVersionBlocks = parseAllTags("social_profile_version", xmlText);
        for (const block of profileVersionBlocks) {
          try {
            const id = unescapeXml(parseXmlTag("id", block));
            const socialAccountId = unescapeXml(parseXmlTag("social_account_id", block));
            const pvNickname = unescapeXml(parseXmlTag("nickname", block));
            const pvBio = unescapeXml(parseXmlTag("bio", block));
            const pvAccountUrl = unescapeXml(parseXmlTag("account_url", block));
            const pvImageUrl = unescapeXml(parseXmlTag("image_url", block));
            const pvExternalImageUrl = unescapeXml(parseXmlTag("external_image_url", block));
            const pvIsCurrent = parseXmlTag("is_current", block) === "true";
  
            if (!socialAccountId || !existingSocialAccountUuids.has(socialAccountId)) continue;
  
            await storage.createProfileVersion({
              socialAccountId,
              nickname: pvNickname || null,
              bio: pvBio || null,
              accountUrl: pvAccountUrl || null,
              imageUrl: pvImageUrl || null,
              externalImageUrl: pvExternalImageUrl || null,
              isCurrent: pvIsCurrent,
            });
          } catch (error) {
            console.error(`Error importing profile version:`, error);
          }
        }
  
        // Parse and import social network snapshots (from new format exports - treated as current state)
        const snapshotBlocks = parseAllTags("social_network_snapshot", xmlText);
        for (const block of snapshotBlocks) {
          try {
            const socialAccountId = unescapeXml(parseXmlTag("social_account_id", block));
            const followerCount = parseInt(parseXmlTag("follower_count", block)) || 0;
            const followingCount = parseInt(parseXmlTag("following_count", block)) || 0;
            const snFollowers = parseXmlArray("followers", "account_id", block);
            const snFollowing = parseXmlArray("following", "account_id", block);
  
            if (!socialAccountId || !existingSocialAccountUuids.has(socialAccountId)) continue;
  
            await storage.upsertNetworkState({
              socialAccountId,
              followerCount,
              followingCount,
              followers: snFollowers,
              following: snFollowing,
            });
          } catch (error) {
            console.error(`Error importing network snapshot:`, error);
          }
        }
  
        // Parse and import social network changes (from history-enabled exports)
        const networkChangeBlocksApp = parseAllTags("social_network_change", xmlText);
        for (const block of networkChangeBlocksApp) {
          try {
            const socialAccountId = unescapeXml(parseXmlTag("social_account_id", block));
            const changeType = unescapeXml(parseXmlTag("change_type", block));
            const direction = unescapeXml(parseXmlTag("direction", block));
            const targetAccountId = unescapeXml(parseXmlTag("target_account_id", block));
            const detectedAtStr = unescapeXml(parseXmlTag("detected_at", block));
            const batchId = unescapeXml(parseXmlTag("batch_id", block));
  
            if (!socialAccountId || !existingSocialAccountUuids.has(socialAccountId)) continue;
            if (!changeType || !direction || !targetAccountId) continue;
  
            await db.insert(socialNetworkChanges).values({
              socialAccountId,
              changeType,
              direction,
              targetAccountId,
              detectedAt: detectedAtStr ? new Date(detectedAtStr) : new Date(),
              batchId: batchId || null,
            });
            importedCounts.networkChanges = (importedCounts.networkChanges || 0) + 1;
          } catch (error) {
            console.error("Error importing network change:", error);
          }
        }
  
        // Parse and import social account posts
        const postBlocks = parseAllTags("social_account_post", xmlText);
        const existingPostIds = new Set((await db.select({ id: socialAccountPosts.id }).from(socialAccountPosts)).map(p => p.id));
        for (const block of postBlocks) {
          try {
            const id = unescapeXml(parseXmlTag("id", block));
            const postSocialAccountId = unescapeXml(parseXmlTag("social_account_id", block));
            const postType = unescapeXml(parseXmlTag("post_type", block)) || "post";
            const content = unescapeXml(parseXmlTag("content", block));
            const description = unescapeXml(parseXmlTag("description", block));
            const likeCount = parseInt(parseXmlTag("like_count", block)) || 0;
            const commentCount = parseInt(parseXmlTag("comment_count", block)) || 0;
            const comments = unescapeXml(parseXmlTag("comments", block));
            const mentionedAccounts = unescapeXml(parseXmlTag("mentioned_accounts", block));
            const postedAtStr = unescapeXml(parseXmlTag("posted_at", block));
            const createdAtStr = unescapeXml(parseXmlTag("created_at", block));
  
            if (!id || !postSocialAccountId) continue;
            if (existingPostIds.has(id)) continue;
            if (!existingSocialAccountUuids.has(postSocialAccountId)) continue;
  
            await db.insert(socialAccountPosts).values({
              id,
              socialAccountId: postSocialAccountId,
              postType,
              content: content || null,
              description: description || null,
              likeCount,
              commentCount,
              comments: comments || null,
              mentionedAccounts: mentionedAccounts || null,
              postedAt: postedAtStr ? new Date(postedAtStr) : null,
              createdAt: createdAtStr ? new Date(createdAtStr) : new Date(),
            }).onConflictDoNothing();
            existingPostIds.add(id);
            importedCounts.posts++;
          } catch (error) {
            console.error("Error importing social account post:", error);
          }
        }
  
        res.json({
          success: true,
          imported: importedCounts,
          skipped: skippedCounts,
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
    app.post("/api/reset-database", async (req, res) => {
      try {
        if (!req.isAuthenticated()) {
          return res.status(401).json({ error: "Unauthorized" });
        }
  
        const { includeExamples } = req.body;
  
        // Import the resetDatabase function
        const { resetDatabase } = await import("../db-init");
        
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
        
        // Create a person entry for the new user
        const [firstName, ...lastNameParts] = (user.name || user.username).split(' ');
        const lastName = lastNameParts.join(' ') || '';
        
        await storage.createPerson({
          userId: user.id,
          firstName: firstName,
          lastName: lastName,
          email: '',
          phone: null,
          company: null,
          title: null,
          tags: [],
          imageUrl: null,
        });
        
        // Disable user creation now that an account has been created
        isUserCreationAllowed = false;
        
        // Log the user in automatically
        req.login(user, (err) => {
          if (err) {
            console.error("Error logging in after setup:", err);
            return res.status(500).json({ error: "Setup completed but login failed" });
          }
          res.status(201).json(user);
        });
      } catch (error) {
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
          
          await storage.updateUserPerson(req.user.id, {
            firstName: firstName,
            lastName: lastName,
          });
        }
  
        res.json(updatedUser);
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
  
        const mePerson = await storage.getMePerson(req.user.id);
        if (!mePerson) {
          return res.status(404).json({ error: "Person entry not found" });
        }
  
        res.json(mePerson);
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
        const hashedToken = await hashPassword(rawToken);
  
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
  
        const sessions = await storage.getAllExtensionSessions(req.user.id);
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
  
        // Verify the session belongs to the user
        const sessions = await storage.getAllExtensionSessions(req.user.id);
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
  
        // Find the session by comparing the token hash against all sessions
        const allSessions = await storage.getAllExtensionSessionsAllUsers();
        let matchedSession: ExtensionSession | null = null;
  
        for (const session of allSessions) {
          try {
            const [hashed, salt] = session.sessionToken.split(".");
            const hashedBuf = Buffer.from(hashed, "hex");
            const suppliedBuf = (await scryptAsync(token, salt, 64)) as Buffer;
            if (timingSafeEqual(hashedBuf, suppliedBuf)) {
              matchedSession = session;
              break;
            }
          } catch {
            continue;
          }
        }
  
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
        // In a multi-user system, we can get any user's config since it's system-wide
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
        // Don't store userId yet - we'll determine it from OAuth response
  
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
          res.redirect('/');
        });
      } catch (error) {
        console.error("Error in SSO callback:", error);
        res.redirect('/?error=callback_failed');
      }
    });
  
}
