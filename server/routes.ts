import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { db } from "./db";
import { interactions, relationshipTypes, interactionTypes, people, socialNetworkChanges, type SocialAccountWithCurrentProfile, type ExtensionSession } from "@shared/schema";
import crypto from "crypto";
import { z } from "zod";
import { eq, sql, isNotNull } from "drizzle-orm";
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
} from "@shared/schema";
import multer from "multer";
import { uploadImageToS3, deleteImageFromS3 } from "./s3";
import { uploadImageLocally, deleteImageLocally, getLocalImagePath, isLocalImageUrl } from "./local-storage";
import { hashPassword } from "./auth";
import { triggerTaskWorker } from "./task-worker";
import { scrypt, timingSafeEqual } from "crypto";
import { promisify } from "util";
import Papa from "papaparse";
import { sendApiError, ErrorCodes } from "./middleware/error-handler";
import { sseManager } from "./middleware/sse";

const scryptAsync = promisify(scrypt);

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

// Flag to track if user creation is allowed (only after database reset)
let isUserCreationAllowed = false;

export async function registerRoutes(app: Express): Promise<Server> {
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

      res.json({ imageUrl });
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

        try {
          await storage.createNoteWithId({ id, personId, content, imageUrl: imageUrl || null });
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

      const accountId = req.body.accountId as string;
      const importType = req.body.importType as "followers" | "following";
      const forceUpdateImages = req.body.forceUpdateImages === "true";

      if (!accountId) {
        return res.status(400).json({ error: "Account ID is required" });
      }

      if (!importType || !["followers", "following"].includes(importType)) {
        return res.status(400).json({ error: "Import type must be 'followers' or 'following'" });
      }

      // Get the target account (WE/US)
      const targetAccount = await storage.getSocialAccountById(accountId);
      if (!targetAccount) {
        return res.status(404).json({ error: "Target social account not found" });
      }

      // Parse CSV file with semicolon delimiter
      const csvText = req.file.buffer.toString("utf-8");
      const parseResult = Papa.parse(csvText, {
        header: true,
        skipEmptyLines: true,
        delimiter: ";",
        transformHeader: (header: string) => header.trim().replace(/"/g, ""),
      });

      if (parseResult.errors.length > 0) {
        console.warn("CSV parsing warnings (skipping bad rows):", parseResult.errors.length, "errors");
      }

      const rows = parseResult.data as any[];

      if (rows.length === 0) {
        return res.status(400).json({ error: "CSV file contains no data" });
      }

      let importedCount = 0;
      let updatedCount = 0;
      const processedAccountIds: string[] = [];

      // Get the Instagram social account type
      const instagramType = await storage.getSocialAccountTypeByName("instagram");
      const instagramTypeId = instagramType?.id || null;

      // Get all existing social accounts for username lookup
      const allAccounts = await storage.getAllSocialAccounts();
      const accountsByUsername = new Map(allAccounts.map(a => [a.username.toLowerCase(), a]));

      const mutualFollowIds: string[] = [];

      for (const row of rows) {
        const username = (row.username || row["username"] || "").toString().trim().replace(/"/g, "");
        const fullName = (row.full_name || row["full_name"] || "").toString().trim().replace(/"/g, "");
        const instagramId = (row.id || row["id"] || "").toString().trim().replace(/"/g, "");
        const profilePicUrl = (row.profile_pic_url || row["profile_pic_url"] || "").toString().trim().replace(/"/g, "");
        const followedByViewer = (row.followed_by_viewer || row["followed_by_viewer"] || "").toString().toLowerCase() === "true";

        if (!username) continue;

        let existingAccount = accountsByUsername.get(username.toLowerCase());

        if (existingAccount) {
          if (fullName && existingAccount.currentProfile?.nickname !== fullName) {
            await storage.createProfileVersion({
              socialAccountId: existingAccount.id,
              nickname: fullName,
              accountUrl: existingAccount.currentProfile?.accountUrl || null,
              imageUrl: existingAccount.currentProfile?.imageUrl || null,
              isCurrent: true,
            });
            updatedCount++;
          }

          if (profilePicUrl && (!existingAccount.currentProfile?.imageUrl || forceUpdateImages)) {
            const currentProfile = await storage.getCurrentProfileVersion(existingAccount.id);
            await storage.createTask({
              type: "get_img",
              status: "pending",
              payload: JSON.stringify({
                socialAccountId: existingAccount.id,
                profileVersionId: currentProfile?.id || null,
                imageUrl: profilePicUrl,
              }),
            });
          }

          processedAccountIds.push(existingAccount.id);
        } else {
          const newAccount = await storage.createSocialAccount({
            username,
            ownerUuid: null,
            typeId: instagramTypeId,
            internalAccountCreationType: `${targetAccount.username} import`,
          });

          const currentProfile = await storage.getCurrentProfileVersion(newAccount.id);
          if (currentProfile) {
            await storage.updateProfileVersion(currentProfile.id, {
              nickname: fullName || null,
              accountUrl: `https://instagram.com/${username}`,
            });
          }
          
          if (profilePicUrl) {
            await storage.createTask({
              type: "get_img",
              status: "pending",
              payload: JSON.stringify({
                socialAccountId: newAccount.id,
                profileVersionId: currentProfile?.id || null,
                imageUrl: profilePicUrl,
              }),
            });
          }

          accountsByUsername.set(username.toLowerCase(), newAccount);
          processedAccountIds.push(newAccount.id);
          importedCount++;
        }

        if (followedByViewer) {
          const importedAccountId = accountsByUsername.get(username.toLowerCase())?.id;
          if (importedAccountId) {
            mutualFollowIds.push(importedAccountId);
          }
        }
      }

      // Build network state for the target account
      const existingState = await storage.getNetworkState(accountId);
      const existingFollowers = existingState?.followers || [];
      const existingFollowing = existingState?.following || [];

      let newFollowers: string[];
      let newFollowing: string[];

      if (importType === "followers") {
        newFollowers = Array.from(new Set([...existingFollowers, ...processedAccountIds]));
        newFollowing = Array.from(new Set([...existingFollowing, ...mutualFollowIds]));
      } else {
        newFollowing = Array.from(new Set([...existingFollowing, ...processedAccountIds]));
        newFollowers = Array.from(new Set([...existingFollowers, ...mutualFollowIds]));
      }

      await storage.upsertNetworkState({
        socialAccountId: accountId,
        followerCount: newFollowers.length,
        followingCount: newFollowing.length,
        followers: newFollowers,
        following: newFollowing,
      });

      const skippedRows = parseResult.errors.length;

      triggerTaskWorker();

      res.json({
        success: true,
        imported: importedCount,
        updated: updatedCount,
        total: processedAccountIds.length,
        skippedRows,
      });
    } catch (error) {
      console.error("Error importing Instagram data:", error);
      res.status(500).json({ error: "Failed to import Instagram data" });
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
      const { resetDatabase } = await import("./db-init");
      
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
        });
      }

      const options = {
        includePeople: parsed.data.includePeople !== 'false',
        includeGroups: parsed.data.includeGroups !== 'false',
        includeInteractions: parsed.data.includeInteractions !== 'false',
        includeNotes: parsed.data.includeNotes !== 'false',
        includeSocialProfiles: parsed.data.includeSocialProfiles !== 'false',
      };

      const results = await storage.megaSearch(query, options);

      res.json(results);
    } catch (error) {
      console.error("Error mega searching:", error);
      res.status(500).json({ error: "Failed to search" });
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

      // Generate a new 4-digit code
      const code = String(Math.floor(1000 + Math.random() * 9000));
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

  // Graph endpoint - optimized for minimal data transfer
  app.get("/api/graph", async (req, res) => {
    try {
      const graphData = await storage.getGraphData();
      res.json(graphData);
    } catch (error) {
      console.error("Error fetching graph data:", error);
      res.status(500).json({ error: "Failed to fetch graph data" });
    }
  });

  // People endpoints
  app.get("/api/people", async (req, res) => {
    try {
      const includeRelationships = req.query.includeRelationships === 'true';
      
      if (includeRelationships) {
        const people = await storage.getAllPeopleWithRelationships();
        res.json(people);
      } else {
        const people = await storage.getAllPeople();
        res.json(people);
      }
    } catch (error) {
      console.error("Error fetching people:", error);
      res.status(500).json({ error: "Failed to fetch people" });
    }
  });

  app.get("/api/people/paginated", async (req, res) => {
    try {
      const offset = parseInt(req.query.offset as string) || 0;
      const limit = parseInt(req.query.limit as string) || 30;
      const sortByElo = req.query.sortByElo === "true";
      
      // Get ME user's person ID to filter relationships
      const userId = req.user?.id;
      let mePersonId: string | undefined;
      if (userId) {
        const mePerson = await storage.getMePerson(userId);
        mePersonId = mePerson?.id;
      }
      
      const people = await storage.getPeoplePaginated(offset, limit, mePersonId, sortByElo);
      res.json(people);
    } catch (error) {
      console.error("Error fetching paginated people:", error);
      res.status(500).json({ error: "Failed to fetch people" });
    }
  });

  app.get("/api/people/elo/pair", async (req, res) => {
    try {
      const pair = await storage.getRandomPeoplePair();
      if (pair.length < 2) {
        return res.status(400).json({ error: "Not enough people to compare" });
      }
      res.json(pair);
    } catch (error) {
      console.error("Error fetching ELO pair:", error);
      res.status(500).json({ error: "Failed to fetch random pair" });
    }
  });

  app.post("/api/people/elo/vote", async (req, res) => {
    try {
      const { winnerId, loserId } = req.body;
      if (!winnerId || !loserId) {
        return res.status(400).json({ error: "winnerId and loserId are required" });
      }
      if (winnerId === loserId) {
        return res.status(400).json({ error: "Cannot vote for the same person" });
      }
      const result = await storage.updateEloScores(winnerId, loserId);
      res.json(result);
    } catch (error) {
      console.error("Error updating ELO scores:", error);
      res.status(500).json({ error: "Failed to update ELO scores" });
    }
  });

  app.get("/api/people/search", async (req, res) => {
    try {
      const query = req.query.q as string | undefined;
      const creationStartDate = req.query.creation_start_date as string | undefined;
      const creationStopDate = req.query.creation_stop_date as string | undefined;
      const connectedToMe = req.query.connected_to_me as string | undefined;
      
      if (!query) {
        return res.status(400).json({ error: "Search query parameter 'q' is required" });
      }

      let people = await storage.getAllPeople(query);
      
      // Filter by creation date range
      if (creationStartDate) {
        const startTimestamp = new Date(creationStartDate).getTime();
        people = people.filter(p => new Date(p.createdAt).getTime() >= startTimestamp);
      }
      
      if (creationStopDate) {
        const stopTimestamp = new Date(creationStopDate).getTime();
        people = people.filter(p => new Date(p.createdAt).getTime() <= stopTimestamp);
      }
      
      // Filter by connection to ME user
      if (connectedToMe === 'true') {
        const userId = req.user?.id;
        if (userId) {
          const mePerson = await storage.getMePerson(userId);
          if (mePerson) {
            // Get all relationships involving the ME user
            const allRelationships = await storage.getAllRelationships();
            const meRelationships = allRelationships.filter(
              rel => rel.fromPersonId === mePerson.id || rel.toPersonId === mePerson.id
            );
            const connectedPersonIds = new Set(
              meRelationships.map(rel => 
                rel.fromPersonId === mePerson.id ? rel.toPersonId : rel.fromPersonId
              )
            );
            
            people = people.filter(p => connectedPersonIds.has(p.id));
          }
        }
      }

      res.json(people);
    } catch (error) {
      console.error("Error searching people:", error);
      res.status(500).json({ error: "Failed to search people" });
    }
  });

  app.get("/api/people/:id", async (req, res) => {
    try {
      const id = req.params.id;
      const person = await storage.getPersonById(id);
      if (!person) {
        return res.status(404).json({ error: "Person not found" });
      }

      res.json(person);
    } catch (error) {
      console.error("Error fetching person:", error);
      res.status(500).json({ error: "Failed to fetch person" });
    }
  });

  // Flow endpoint - unified timeline for notes, interactions, and messages
  app.get("/api/people/:id/flow", async (req, res) => {
    try {
      const id = req.params.id;
      const limit = parseInt(req.query.limit as string) || 20;
      const cursor = req.query.cursor as string | undefined;

      const flowData = await storage.getFlowData(id, limit, cursor);
      res.json(flowData);
    } catch (error) {
      console.error("Error fetching flow data:", error);
      res.status(500).json({ error: "Failed to fetch flow data" });
    }
  });

  app.post("/api/people", async (req, res) => {
    try {
      const validatedData = insertPersonSchema.parse(req.body);
      
      // Check for duplicate names
      const allPeople = await storage.getAllPeople();
      const duplicate = allPeople.find(p => 
        p.firstName.toLowerCase() === validatedData.firstName.toLowerCase() && 
        p.lastName.toLowerCase() === validatedData.lastName.toLowerCase()
      );
      
      if (duplicate) {
        return res.status(400).json({ 
          error: "A person with this name already exists" 
        });
      }
      
      const person = await storage.createPerson(validatedData);
      res.status(201).json(person);
    } catch (error) {
      console.error("Error creating person:", error);
      res.status(400).json({ error: "Failed to create person" });
    }
  });

  app.patch("/api/people/:id", async (req, res) => {
    try {
      const id = req.params.id;
      const validatedData = insertPersonSchema.partial().parse(req.body);
      const person = await storage.updatePerson(id, validatedData);

      if (!person) {
        return res.status(404).json({ error: "Person not found" });
      }

      if (!person.imageUrl && validatedData.socialAccountUuids) {
        const uuids = validatedData.socialAccountUuids;
        for (const uuid of uuids) {
          const account = await storage.getSocialAccountById(uuid);
          if (account?.currentProfile?.imageUrl) {
            const updated = await storage.updatePerson(id, { imageUrl: account.currentProfile.imageUrl });
            if (updated) {
              return res.json(updated);
            }
            break;
          }
        }
      }

      res.json(person);
    } catch (error) {
      console.error("Error updating person:", error);
      res.status(400).json({ error: "Failed to update person" });
    }
  });

  app.delete("/api/people/:id", async (req, res) => {
    try {
      const id = req.params.id;
      await storage.deletePerson(id);
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting person:", error);
      res.status(500).json({ error: "Failed to delete person" });
    }
  });

  // Notes endpoints
  app.get("/api/notes", async (req, res) => {
    try {
      const personId = req.query.personId as string | undefined;
      
      // If personId is provided, get notes for that person only
      if (personId) {
        const person = await storage.getPersonById(personId);
        if (!person) {
          return res.status(404).json({ error: "Person not found" });
        }
        return res.json(person.notes || []);
      }
      
      // Otherwise, get all notes across all people
      const allPeople = await storage.getAllPeople();
      const allNotes: any[] = [];
      
      for (const person of allPeople) {
        const personWithDetails = await storage.getPersonById(person.id);
        if (personWithDetails?.notes) {
          allNotes.push(...personWithDetails.notes.map(note => ({
            ...note,
            personId: person.id,
            personName: `${person.firstName} ${person.lastName}`,
          })));
        }
      }
      
      // Sort by creation date, newest first
      allNotes.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      
      res.json(allNotes);
    } catch (error) {
      console.error("Error fetching notes:", error);
      res.status(500).json({ error: "Failed to fetch notes" });
    }
  });

  app.get("/api/notes/:id", async (req, res) => {
    try {
      const id = req.params.id;
      const note = await storage.getNoteById(id);
      
      if (!note) {
        return res.status(404).json({ error: "Note not found" });
      }
      
      res.json(note);
    } catch (error) {
      console.error("Error fetching note:", error);
      res.status(500).json({ error: "Failed to fetch note" });
    }
  });

  app.post("/api/notes", async (req, res) => {
    try {
      const validatedData = insertNoteSchema.parse(req.body);
      const note = await storage.createNote(validatedData);
      res.status(201).json(note);
    } catch (error) {
      console.error("Error creating note:", error);
      res.status(400).json({ error: "Failed to create note" });
    }
  });

  app.delete("/api/notes/:id", async (req, res) => {
    try {
      const id = req.params.id;
      await storage.deleteNote(id);
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting note:", error);
      res.status(500).json({ error: "Failed to delete note" });
    }
  });

  // Interactions endpoints
  app.get("/api/interactions", async (req, res) => {
    try {
      const { personId, groupId, isgroup, startDate, endDate, start_date, end_date, count_limit, date_back } = req.query;
      
      // Get all interactions
      const allInteractions = await db
        .select()
        .from(interactions)
        .leftJoin(interactionTypes, eq(interactions.typeId, interactionTypes.id));
      
      let filteredInteractions = allInteractions;
      
      // Filter by person or group ID
      if (personId) {
        filteredInteractions = filteredInteractions.filter(row => 
          row.interactions.peopleIds.includes(personId as string)
        );
      } else if (groupId) {
        filteredInteractions = filteredInteractions.filter(row => 
          row.interactions.groupIds?.includes(groupId as string)
        );
      } else if (isgroup !== undefined) {
        // If isgroup flag is provided without specific ID
        if (isgroup === 'true') {
          filteredInteractions = filteredInteractions.filter(row => 
            row.interactions.groupIds && row.interactions.groupIds.length > 0
          );
        } else {
          filteredInteractions = filteredInteractions.filter(row => 
            !row.interactions.groupIds || row.interactions.groupIds.length === 0
          );
        }
      }
      
      // Apply date filters (support both formats)
      const startDateParam = startDate || start_date || date_back;
      const endDateParam = endDate || end_date;
      
      if (startDateParam) {
        const startTimestamp = new Date(startDateParam as string).getTime();
        filteredInteractions = filteredInteractions.filter(row => 
          new Date(row.interactions.date).getTime() >= startTimestamp
        );
      }
      
      if (endDateParam) {
        const endTimestamp = new Date(endDateParam as string).getTime();
        filteredInteractions = filteredInteractions.filter(row => 
          new Date(row.interactions.date).getTime() <= endTimestamp
        );
      }
      
      // Sort by date, newest first
      filteredInteractions.sort((a, b) => 
        new Date(b.interactions.date).getTime() - new Date(a.interactions.date).getTime()
      );
      
      // Apply count limit if provided
      if (count_limit) {
        const limit = parseInt(count_limit as string);
        if (!isNaN(limit) && limit > 0) {
          filteredInteractions = filteredInteractions.slice(0, limit);
        }
      }
      
      // Format the response
      const result = filteredInteractions.map(row => ({
        ...row.interactions,
        type: row.interaction_types ? {
          id: row.interaction_types.id,
          name: row.interaction_types.name,
          color: row.interaction_types.color,
          value: row.interaction_types.value,
        } : null,
      }));
      
      res.json(result);
    } catch (error) {
      console.error("Error fetching interactions:", error);
      res.status(500).json({ error: "Failed to fetch interactions" });
    }
  });

  app.post("/api/interactions", async (req, res) => {
    try {
      const validatedData = insertInteractionSchema.parse(req.body);
      const interaction = await storage.createInteraction(validatedData);
      res.status(201).json(interaction);
    } catch (error) {
      console.error("Error creating interaction:", error);
      res.status(400).json({ error: "Failed to create interaction" });
    }
  });

  app.patch("/api/interactions/:id", async (req, res) => {
    try {
      const id = req.params.id;
      const validatedData = insertInteractionSchema.partial().parse(req.body);
      const interaction = await storage.updateInteraction(id, validatedData);

      if (!interaction) {
        return res.status(404).json({ error: "Interaction not found" });
      }

      res.json(interaction);
    } catch (error) {
      console.error("Error updating interaction:", error);
      res.status(400).json({ error: "Failed to update interaction" });
    }
  });

  app.delete("/api/interactions/:id", async (req, res) => {
    try {
      const id = req.params.id;
      
      // Get interaction to check for image
      const [interaction] = await db.select().from(interactions).where(eq(interactions.id, id));
      
      // Delete image from S3 if it exists
      if (interaction?.imageUrl) {
        try {
          await deleteImageFromS3(interaction.imageUrl);
        } catch (error) {
          console.error("Error deleting interaction image from S3:", error);
          // Continue with deletion even if S3 deletion fails
        }
      }
      
      await storage.deleteInteraction(id);
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting interaction:", error);
      res.status(500).json({ error: "Failed to delete interaction" });
    }
  });

  // Relationships endpoints
  app.get("/api/relationships/:personId", async (req, res) => {
    try {
      const { personId } = req.params;
      const { count_limit, value_limit } = req.query;
      
      // Get the person with all relationships
      const person = await storage.getPersonById(personId);
      if (!person) {
        return res.status(404).json({ error: "Person not found" });
      }
      
      // Get all relationships where this person is involved
      let allRelationships = person.relationships || [];
      
      // Apply value_limit filter if provided
      if (value_limit) {
        const valueThreshold = parseInt(value_limit as string);
        if (!isNaN(valueThreshold)) {
          allRelationships = allRelationships.filter(rel => {
            const relValue = rel.type?.value ?? 0;
            return relValue >= valueThreshold;
          });
        }
      }
      
      // Sort by relationship value (highest first), then by creation date
      allRelationships.sort((a, b) => {
        const aValue = a.type?.value ?? 0;
        const bValue = b.type?.value ?? 0;
        if (bValue !== aValue) {
          return bValue - aValue;
        }
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      });
      
      // Apply count_limit if provided
      if (count_limit) {
        const limit = parseInt(count_limit as string);
        if (!isNaN(limit) && limit > 0) {
          allRelationships = allRelationships.slice(0, limit);
        }
      }
      
      res.json(allRelationships);
    } catch (error) {
      console.error("Error fetching relationships:", error);
      res.status(500).json({ error: "Failed to fetch relationships" });
    }
  });

  app.post("/api/relationships", async (req, res) => {
    try {
      const validatedData = insertRelationshipSchema.parse(req.body);
      const relationship = await storage.createRelationship(validatedData);
      res.status(201).json(relationship);
    } catch (error) {
      console.error("Error creating relationship:", error);
      res.status(400).json({ error: "Failed to create relationship" });
    }
  });

  app.patch("/api/relationships/:id", async (req, res) => {
    try {
      const id = req.params.id;
      const validatedData = insertRelationshipSchema.partial().parse(req.body);
      const relationship = await storage.updateRelationship(id, validatedData);

      if (!relationship) {
        return res.status(404).json({ error: "Relationship not found" });
      }

      res.json(relationship);
    } catch (error) {
      console.error("Error updating relationship:", error);
      res.status(400).json({ error: "Failed to update relationship" });
    }
  });

  app.delete("/api/relationships/:id", async (req, res) => {
    try {
      const id = req.params.id;
      await storage.deleteRelationship(id);
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting relationship:", error);
      res.status(500).json({ error: "Failed to delete relationship" });
    }
  });

  // Groups endpoints
  app.get("/api/groups", async (req, res) => {
    try {
      const groups = await storage.getAllGroups();
      res.json(groups);
    } catch (error) {
      console.error("Error fetching groups:", error);
      res.status(500).json({ error: "Failed to fetch groups" });
    }
  });

  app.get("/api/groups/:id", async (req, res) => {
    try {
      const id = req.params.id;
      const group = await storage.getGroupById(id);
      if (!group) {
        return res.status(404).json({ error: "Group not found" });
      }
      res.json(group);
    } catch (error) {
      console.error("Error fetching group:", error);
      res.status(500).json({ error: "Failed to fetch group" });
    }
  });

  app.post("/api/groups", async (req, res) => {
    try {
      const validatedData = insertGroupSchema.parse(req.body);
      const group = await storage.createGroup(validatedData);
      res.status(201).json(group);
    } catch (error) {
      console.error("Error creating group:", error);
      res.status(400).json({ error: "Failed to create group" });
    }
  });

  app.patch("/api/groups/:id", async (req, res) => {
    try {
      const id = req.params.id;
      const validatedData = insertGroupSchema.partial().parse(req.body);
      const group = await storage.updateGroup(id, validatedData);

      if (!group) {
        return res.status(404).json({ error: "Group not found" });
      }

      res.json(group);
    } catch (error) {
      console.error("Error updating group:", error);
      res.status(400).json({ error: "Failed to update group" });
    }
  });

  app.delete("/api/groups/:id", async (req, res) => {
    try {
      const id = req.params.id;
      await storage.deleteGroup(id);
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting group:", error);
      res.status(500).json({ error: "Failed to delete group" });
    }
  });

  // Group notes endpoints
  app.get("/api/group-notes/:groupId", async (req, res) => {
    try {
      const { groupId } = req.params;
      const { count_limit, date_back } = req.query;
      
      // Get the group with all notes
      const group = await storage.getGroupById(groupId);
      if (!group) {
        return res.status(404).json({ error: "Group not found" });
      }
      
      let groupNotesList = group.notes || [];
      
      // Apply date filter if provided
      if (date_back) {
        const dateBackTimestamp = new Date(date_back as string).getTime();
        groupNotesList = groupNotesList.filter((note: any) => 
          new Date(note.createdAt).getTime() >= dateBackTimestamp
        );
      }
      
      // Sort by creation date, newest first
      groupNotesList.sort((a: any, b: any) => 
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
      
      // Apply count limit if provided
      if (count_limit) {
        const limit = parseInt(count_limit as string);
        if (!isNaN(limit) && limit > 0) {
          groupNotesList = groupNotesList.slice(0, limit);
        }
      }
      
      res.json(groupNotesList);
    } catch (error) {
      console.error("Error fetching group notes:", error);
      res.status(500).json({ error: "Failed to fetch group notes" });
    }
  });

  app.post("/api/group-notes", async (req, res) => {
    try {
      const validatedData = insertGroupNoteSchema.parse(req.body);
      const groupNote = await storage.createGroupNote(validatedData);
      res.status(201).json(groupNote);
    } catch (error) {
      console.error("Error creating group note:", error);
      res.status(400).json({ error: "Failed to create group note" });
    }
  });

  app.delete("/api/group-notes/:id", async (req, res) => {
    try {
      const id = req.params.id;
      await storage.deleteGroupNote(id);
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting group note:", error);
      res.status(500).json({ error: "Failed to delete group note" });
    }
  });

  // Social graph endpoint
  app.post("/api/social-graph", async (req, res) => {
    try {
      const settings = req.body as {
        hideOrphans?: boolean;
        minConnections?: number;
        limitExtras?: boolean;
        maxExtras?: number;
        highlightedAccountId?: string | null;
        mode?: 'default' | 'blob' | 'single-highlight' | 'multi-highlight';
        blobMergeMultiplier?: number;
        singleHighlightAccountId?: string | null;
        singleShowFriendLinks?: boolean;
        singleRemoveExtras?: boolean;
        multiHighlightAccountIds?: string[];
      };

      const graphData = await storage.getSocialGraph({
        hideOrphans: settings.hideOrphans ?? true,
        minConnections: settings.minConnections ?? 0,
        limitExtras: settings.limitExtras ?? true,
        maxExtras: settings.maxExtras ?? 20,
        highlightedAccountId: settings.highlightedAccountId ?? null,
        mode: settings.mode ?? 'default',
        blobMergeMultiplier: settings.blobMergeMultiplier ?? 0.5,
        singleHighlightAccountId: settings.singleHighlightAccountId ?? null,
        singleShowFriendLinks: settings.singleShowFriendLinks ?? true,
        singleRemoveExtras: settings.singleRemoveExtras ?? false,
        multiHighlightAccountIds: settings.multiHighlightAccountIds ?? [],
      });

      res.json(graphData);
    } catch (error) {
      console.error("Error computing social graph:", error);
      res.status(500).json({ error: "Failed to compute social graph" });
    }
  });

  // Social accounts endpoints
  app.get("/api/social-accounts", async (req, res) => {
    try {
      const searchQuery = req.query.search as string | undefined;
      const typeId = req.query.typeId as string | undefined;
      const accounts = await storage.getAllSocialAccounts(searchQuery, typeId);
      res.json(accounts);
    } catch (error) {
      console.error("Error fetching social accounts:", error);
      res.status(500).json({ error: "Failed to fetch social accounts" });
    }
  });

  app.post("/api/social-accounts/by-ids", async (req, res) => {
    try {
      const { ids } = req.body;
      if (!Array.isArray(ids)) {
        return res.status(400).json({ error: "ids must be an array" });
      }
      const accounts = await storage.getSocialAccountsByIds(ids);
      res.json(accounts);
    } catch (error) {
      console.error("Error fetching social accounts by ids:", error);
      res.status(500).json({ error: "Failed to fetch social accounts" });
    }
  });

  app.get("/api/social-accounts/paginated", async (req, res) => {
    try {
      const offset = Math.max(0, parseInt(req.query.offset as string) || 0);
      const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 30));
      const searchQuery = req.query.search as string | undefined;
      const typeId = req.query.typeId as string | undefined;
      const followsYou = req.query.followsYou === "true";

      let followsAccountIds: string[] | undefined;

      if (followsYou) {
        const userId = req.user?.id;
        if (userId) {
          const mePerson = await storage.getMePerson(userId);
          if (mePerson && mePerson.socialAccountUuids && mePerson.socialAccountUuids.length > 0) {
            followsAccountIds = mePerson.socialAccountUuids;
          } else {
            res.json([]);
            return;
          }
        } else {
          res.json([]);
          return;
        }
      }

      const accounts = await storage.getSocialAccountsPaginated({
        offset,
        limit,
        searchQuery: searchQuery || undefined,
        typeId: typeId || undefined,
        followsAccountIds,
      });
      res.json(accounts);
    } catch (error) {
      console.error("Error fetching paginated social accounts:", error);
      res.status(500).json({ error: "Failed to fetch social accounts" });
    }
  });

  app.get("/api/social-accounts/export-xml", async (req, res) => {
    try {
      const ids = req.query.ids as string | undefined;
      const includeHistory = req.query.includeHistory === "true";

      const allSocialAccountTypes = await storage.getAllSocialAccountTypes();

      const escapeXml = (str: any): string => {
        if (str === null || str === undefined) return "";
        return String(str)
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")
          .replace(/"/g, "&quot;")
          .replace(/'/g, "&apos;");
      };

      const arrayToXml = (arr: any[], itemName: string): string => {
        if (!arr || arr.length === 0) return "";
        return arr.map(item => `<${itemName}>${escapeXml(item)}</${itemName}>`).join("");
      };

      let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
      xml += '<social_accounts_export>\n';

      const typeIdsUsed = new Set<string>();
      const accounts: SocialAccountWithCurrentProfile[] = [];

      if (ids) {
        const accountIds = ids.split(",").map(id => id.trim()).filter(Boolean);
        for (const id of accountIds) {
          const account = await storage.getSocialAccountById(id);
          if (account) {
            accounts.push(account);
            if (account.typeId) typeIdsUsed.add(account.typeId);
          }
        }
      } else {
        const allAccounts = await storage.getAllSocialAccounts();
        for (const account of allAccounts) {
          accounts.push(account);
          if (account.typeId) typeIdsUsed.add(account.typeId);
        }
      }

      const allNetworkStates = await storage.getAllNetworkStates();
      const networkStateMap = new Map(allNetworkStates.map(s => [s.socialAccountId, s]));

      xml += '  <social_account_types>\n';
      for (const type of allSocialAccountTypes) {
        if (typeIdsUsed.has(type.id)) {
          xml += '    <social_account_type>\n';
          xml += `      <id>${escapeXml(type.id)}</id>\n`;
          xml += `      <name>${escapeXml(type.name)}</name>\n`;
          xml += `      <color>${escapeXml(type.color)}</color>\n`;
          xml += `      <created_at>${escapeXml(type.createdAt)}</created_at>\n`;
          xml += '    </social_account_type>\n';
        }
      }
      xml += '  </social_account_types>\n';

      xml += '  <social_accounts>\n';
      for (const account of accounts) {
        const accountState = account.latestState || networkStateMap.get(account.id);
        xml += '    <social_account>\n';
        xml += `      <id>${escapeXml(account.id)}</id>\n`;
        xml += `      <username>${escapeXml(account.username)}</username>\n`;
        xml += `      <nickname>${escapeXml(account.currentProfile?.nickname || "")}</nickname>\n`;
        xml += `      <account_url>${escapeXml(account.currentProfile?.accountUrl || "")}</account_url>\n`;
        xml += `      <owner_uuid>${escapeXml(account.ownerUuid || "")}</owner_uuid>\n`;
        xml += `      <type_id>${escapeXml(account.typeId || "")}</type_id>\n`;
        xml += `      <image_url>${escapeXml(account.currentProfile?.imageUrl || "")}</image_url>\n`;
        xml += `      <notes></notes>\n`;
        xml += `      <following>${arrayToXml(accountState?.following || [], "account_id")}</following>\n`;
        xml += `      <followers>${arrayToXml(accountState?.followers || [], "account_id")}</followers>\n`;
        xml += `      <created_at>${escapeXml(account.createdAt)}</created_at>\n`;
        xml += '    </social_account>\n';
      }
      xml += '  </social_accounts>\n';

      if (includeHistory) {
        xml += '  <social_profile_versions>\n';
        for (const account of accounts) {
          const versions = await storage.getProfileVersions(account.id);
          for (const version of versions) {
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
        }
        xml += '  </social_profile_versions>\n';

        xml += '  <social_network_snapshots>\n';
        for (const account of accounts) {
          const state = await storage.getNetworkState(account.id);
          if (state) {
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
        }
        xml += '  </social_network_snapshots>\n';

        xml += '  <social_network_changes>\n';
        for (const account of accounts) {
          const changes = await storage.getNetworkChanges(account.id);
          for (const change of changes) {
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
        }
        xml += '  </social_network_changes>\n';
      }

      xml += '</social_accounts_export>\n';

      const filename = ids
        ? `social_accounts_export.xml`
        : `social_accounts_export_all.xml`;
      res.setHeader("Content-Type", "application/xml");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.send(xml);
    } catch (error) {
      console.error("Error exporting social accounts XML:", error);
      res.status(500).json({ error: "Failed to export social accounts" });
    }
  });

  app.post("/api/social-accounts/import-xml", upload.single("xml"), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "No XML file provided" });
      }

      const xmlText = req.file.buffer.toString("utf-8");

      const parseXmlTag = (tagName: string, text: string): string => {
        const regex = new RegExp(`<${tagName}>(.*?)</${tagName}>`, "s");
        const match = text.match(regex);
        return match ? match[1] : "";
      };

      const parseAllTags = (tagName: string, text: string): string[] => {
        const regex = new RegExp(`<${tagName}>(.*?)</${tagName}>`, "gs");
        const matches: string[] = [];
        let match;
        while ((match = regex.exec(text)) !== null) {
          matches.push(match[1]);
        }
        return matches;
      };

      const parseXmlArray = (parentTag: string, childTag: string, text: string): string[] => {
        const parentContent = parseXmlTag(parentTag, text);
        if (!parentContent) return [];
        return parseAllTags(childTag, parentContent);
      };

      const unescapeXml = (str: string): string => {
        return str
          .replace(/&apos;/g, "'")
          .replace(/&quot;/g, '"')
          .replace(/&gt;/g, ">")
          .replace(/&lt;/g, "<")
          .replace(/&amp;/g, "&");
      };

      const importedCounts = { socialAccountTypes: 0, socialAccounts: 0, profileVersions: 0, networkChanges: 0 };
      const skippedCounts = { socialAccountTypes: 0, socialAccounts: 0 };
      const failedCounts = { socialAccountTypes: 0, socialAccounts: 0 };
      const importedAccountIds = new Set<string>();

      const socialAccountTypeBlocks = parseAllTags("social_account_type", xmlText);
      for (const block of socialAccountTypeBlocks) {
        try {
          const id = unescapeXml(parseXmlTag("id", block));
          const name = unescapeXml(parseXmlTag("name", block));
          const color = unescapeXml(parseXmlTag("color", block));

          if (!id || !name || !color) {
            failedCounts.socialAccountTypes++;
            continue;
          }

          const existing = await storage.getSocialAccountTypeById(id);
          if (existing) {
            skippedCounts.socialAccountTypes++;
            continue;
          }

          await storage.createSocialAccountTypeWithId({ id, name, color });
          importedCounts.socialAccountTypes++;
        } catch (error) {
          console.error("Error importing social account type:", error);
          failedCounts.socialAccountTypes++;
        }
      }

      const socialAccountBlocks = parseAllTags("social_account", xmlText);
      for (const block of socialAccountBlocks) {
        try {
          const id = unescapeXml(parseXmlTag("id", block));
          const username = unescapeXml(parseXmlTag("username", block));

          if (!id || !username) {
            failedCounts.socialAccounts++;
            continue;
          }

          const nickname = unescapeXml(parseXmlTag("nickname", block));
          const accountUrl = unescapeXml(parseXmlTag("account_url", block));
          const ownerUuid = unescapeXml(parseXmlTag("owner_uuid", block));
          const typeId = unescapeXml(parseXmlTag("type_id", block));
          const imageUrl = unescapeXml(parseXmlTag("image_url", block));
          const following = parseXmlArray("following", "account_id", block);
          const followers = parseXmlArray("followers", "account_id", block);

          const existing = await storage.getSocialAccountById(id);
          if (existing) {
            skippedCounts.socialAccounts++;
            importedAccountIds.add(id);
            continue;
          }

          const created = await storage.createSocialAccountWithId({
            id,
            username,
            ownerUuid: ownerUuid || null,
            typeId: typeId || null,
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
              followers: followers.map((f: string) => unescapeXml(f)),
              following: following.map((f: string) => unescapeXml(f)),
            });
          }

          importedCounts.socialAccounts++;
          importedAccountIds.add(id);
        } catch (error) {
          console.error("Error importing social account:", error);
          failedCounts.socialAccounts++;
        }
      }

      const profileVersionBlocks = parseAllTags("social_profile_version", xmlText);
      for (const block of profileVersionBlocks) {
        try {
          const socialAccountId = unescapeXml(parseXmlTag("social_account_id", block));
          const pvNickname = unescapeXml(parseXmlTag("nickname", block));
          const pvBio = unescapeXml(parseXmlTag("bio", block));
          const pvAccountUrl = unescapeXml(parseXmlTag("account_url", block));
          const pvImageUrl = unescapeXml(parseXmlTag("image_url", block));
          const pvExternalImageUrl = unescapeXml(parseXmlTag("external_image_url", block));
          const pvIsCurrent = parseXmlTag("is_current", block) === "true";

          if (!socialAccountId || !importedAccountIds.has(socialAccountId)) continue;

          await storage.createProfileVersion({
            socialAccountId,
            nickname: pvNickname || null,
            bio: pvBio || null,
            accountUrl: pvAccountUrl || null,
            imageUrl: pvImageUrl || null,
            externalImageUrl: pvExternalImageUrl || null,
            isCurrent: pvIsCurrent,
          });
          importedCounts.profileVersions++;
        } catch (error) {
          console.error("Error importing profile version:", error);
        }
      }

      const snapshotBlocks = parseAllTags("social_network_snapshot", xmlText);
      for (const block of snapshotBlocks) {
        try {
          const socialAccountId = unescapeXml(parseXmlTag("social_account_id", block));
          const followerCount = parseInt(parseXmlTag("follower_count", block)) || 0;
          const followingCount = parseInt(parseXmlTag("following_count", block)) || 0;
          const snFollowers = parseXmlArray("followers", "account_id", block);
          const snFollowing = parseXmlArray("following", "account_id", block);

          if (!socialAccountId || !importedAccountIds.has(socialAccountId)) continue;

          await storage.upsertNetworkState({
            socialAccountId,
            followerCount,
            followingCount,
            followers: snFollowers,
            following: snFollowing,
          });
        } catch (error) {
          console.error("Error importing network snapshot:", error);
        }
      }

      const networkChangeBlocks = parseAllTags("social_network_change", xmlText);
      for (const block of networkChangeBlocks) {
        try {
          const socialAccountId = unescapeXml(parseXmlTag("social_account_id", block));
          const changeType = unescapeXml(parseXmlTag("change_type", block));
          const direction = unescapeXml(parseXmlTag("direction", block));
          const targetAccountId = unescapeXml(parseXmlTag("target_account_id", block));
          const detectedAtStr = unescapeXml(parseXmlTag("detected_at", block));
          const batchId = unescapeXml(parseXmlTag("batch_id", block));

          if (!socialAccountId || !importedAccountIds.has(socialAccountId)) continue;
          if (!changeType || !direction || !targetAccountId) continue;

          await db.insert(socialNetworkChanges).values({
            socialAccountId,
            changeType,
            direction,
            targetAccountId,
            detectedAt: detectedAtStr ? new Date(detectedAtStr) : new Date(),
            batchId: batchId || null,
          });
          importedCounts.networkChanges++;
        } catch (error) {
          console.error("Error importing network change:", error);
        }
      }

      res.json({
        imported: importedCounts,
        skipped: skippedCounts,
        failed: failedCounts,
      });
    } catch (error) {
      console.error("Error importing social accounts XML:", error);
      res.status(500).json({ error: "Failed to import social accounts" });
    }
  });

  app.get("/api/social-accounts/:id", async (req, res) => {
    try {
      const account = await storage.getSocialAccountById(req.params.id);
      if (!account) {
        return res.status(404).json({ error: "Social account not found" });
      }
      res.json(account);
    } catch (error) {
      console.error("Error fetching social account:", error);
      res.status(500).json({ error: "Failed to fetch social account" });
    }
  });

  app.post("/api/social-accounts", async (req, res) => {
    try {
      const validatedData = insertSocialAccountSchema.parse(req.body);
      const account = await storage.createSocialAccount(validatedData);
      sseManager.broadcast("social_account.created", { id: account.id, username: account.username });
      res.status(201).json(account);
    } catch (error) {
      console.error("Error creating social account:", error);
      res.status(400).json({ error: "Failed to create social account" });
    }
  });

  app.patch("/api/social-accounts/:id", async (req, res) => {
    try {
      const id = req.params.id;
      const body = req.body;

      const registryFields: Record<string, any> = {};
      if (body.username !== undefined) registryFields.username = body.username;
      if (body.ownerUuid !== undefined) registryFields.ownerUuid = body.ownerUuid;
      if (body.typeId !== undefined) registryFields.typeId = body.typeId;
      if (body.internalAccountCreationType !== undefined) registryFields.internalAccountCreationType = body.internalAccountCreationType;
      if (body.lastScrapedAt !== undefined) registryFields.lastScrapedAt = body.lastScrapedAt;

      if (Object.keys(registryFields).length > 0) {
        await storage.updateSocialAccount(id, registryFields);
      }

      const profileFields: Record<string, any> = {};
      if (body.nickname !== undefined) profileFields.nickname = body.nickname;
      if (body.accountUrl !== undefined) profileFields.accountUrl = body.accountUrl;
      if (body.imageUrl !== undefined) profileFields.imageUrl = body.imageUrl;
      if (body.bio !== undefined) profileFields.bio = body.bio;

      if (Object.keys(profileFields).length > 0) {
        const currentProfile = await storage.getCurrentProfileVersion(id);
        if (currentProfile) {
          await storage.updateProfileVersion(currentProfile.id, profileFields);
        } else {
          await storage.createProfileVersion({
            socialAccountId: id,
            isCurrent: true,
            ...profileFields,
          });
        }
      }

      const account = await storage.getSocialAccountById(id);
      if (!account) {
        return res.status(404).json({ error: "Social account not found" });
      }

      sseManager.broadcast("social_account.updated", { id });
      res.json(account);
    } catch (error) {
      console.error("Error updating social account:", error);
      res.status(400).json({ error: "Failed to update social account" });
    }
  });

  app.delete("/api/social-accounts/delete-all", async (req, res) => {
    try {
      const count = await storage.deleteAllSocialAccounts();
      res.json({ success: true, deleted: count });
    } catch (error) {
      console.error("Error deleting all social accounts:", error);
      res.status(500).json({ error: "Failed to delete all social accounts" });
    }
  });

  app.delete("/api/social-accounts/:id", async (req, res) => {
    try {
      const id = req.params.id;
      await storage.deleteSocialAccount(id);
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting social account:", error);
      res.status(500).json({ error: "Failed to delete social account" });
    }
  });

  // Get accounts that follow a specific account (from network state)
  app.get("/api/social-accounts/:id/followers", async (req, res) => {
    try {
      const { id } = req.params;
      const state = await storage.getNetworkState(id);
      
      if (!state || !state.followers || state.followers.length === 0) {
        return res.json([]);
      }

      const followerAccounts = [];
      for (const followerId of state.followers) {
        const account = await storage.getSocialAccountById(followerId);
        if (account) {
          followerAccounts.push(account);
        }
      }
      
      res.json(followerAccounts);
    } catch (error) {
      console.error("Error fetching followers:", error);
      res.status(500).json({ error: "Failed to fetch followers" });
    }
  });

  // Profile versions and network snapshots endpoints
  app.get("/api/social-accounts/:id/profile-versions", async (req, res) => {
    try {
      const { id } = req.params;
      const versions = await storage.getProfileVersions(id);
      res.json(versions);
    } catch (error) {
      console.error("Error fetching profile versions:", error);
      res.status(500).json({ error: "Failed to fetch profile versions" });
    }
  });

  app.get("/api/social-accounts/:id/network-changes", async (req, res) => {
    try {
      const { id } = req.params;
      const limit = req.query.limit ? parseInt(req.query.limit as string) : undefined;
      const changes = await storage.getNetworkChanges(id, limit);
      res.json(changes);
    } catch (error) {
      console.error("Error fetching network changes:", error);
      res.status(500).json({ error: "Failed to fetch network changes" });
    }
  });

  app.get("/api/social-accounts/:id/network-state", async (req, res) => {
    try {
      const { id } = req.params;
      const state = await storage.getNetworkState(id);
      res.json(state);
    } catch (error) {
      console.error("Error fetching network state:", error);
      res.status(500).json({ error: "Failed to fetch network state" });
    }
  });

  app.post("/api/social-accounts/:id/network-state", async (req, res) => {
    try {
      const { id } = req.params;
      const account = await storage.getSocialAccountById(id);
      if (!account) {
        return res.status(404).json({ error: "Social account not found" });
      }

      const oldState = await storage.getNetworkState(id);
      const oldFollowers = new Set(oldState?.followers || []);
      const oldFollowing = new Set(oldState?.following || []);
      const newFollowers = new Set<string>(req.body.followers || []);
      const newFollowing = new Set<string>(req.body.following || []);

      const batchId = crypto.randomUUID();
      const changes: { socialAccountId: string; changeType: string; direction: string; targetAccountId: string; batchId: string }[] = [];

      for (const f of Array.from(newFollowers)) {
        if (!oldFollowers.has(f)) {
          changes.push({ socialAccountId: id, changeType: 'follow', direction: 'follower', targetAccountId: f, batchId });
        }
      }
      for (const f of Array.from(oldFollowers)) {
        if (!newFollowers.has(f)) {
          changes.push({ socialAccountId: id, changeType: 'unfollow', direction: 'follower', targetAccountId: f, batchId });
        }
      }
      for (const f of Array.from(newFollowing)) {
        if (!oldFollowing.has(f)) {
          changes.push({ socialAccountId: id, changeType: 'follow', direction: 'following', targetAccountId: f, batchId });
        }
      }
      for (const f of Array.from(oldFollowing)) {
        if (!newFollowing.has(f)) {
          changes.push({ socialAccountId: id, changeType: 'unfollow', direction: 'following', targetAccountId: f, batchId });
        }
      }

      if (changes.length > 0) {
        await storage.recordNetworkChanges(changes);
      }

      const state = await storage.upsertNetworkState({
        socialAccountId: id,
        followerCount: newFollowers.size,
        followingCount: newFollowing.size,
        followers: Array.from(newFollowers),
        following: Array.from(newFollowing),
      });
      res.status(201).json(state);
    } catch (error) {
      console.error("Error updating network state:", error);
      res.status(500).json({ error: "Failed to update network state" });
    }
  });

  // Social account types endpoints
  app.get("/api/social-account-types", async (req, res) => {
    try {
      const types = await storage.getAllSocialAccountTypes();
      res.json(types);
    } catch (error) {
      console.error("Error fetching social account types:", error);
      res.status(500).json({ error: "Failed to fetch social account types" });
    }
  });

  app.get("/api/social-account-types/:id", async (req, res) => {
    try {
      const id = req.params.id;
      const type = await storage.getSocialAccountTypeById(id);

      if (!type) {
        return res.status(404).json({ error: "Social account type not found" });
      }

      res.json(type);
    } catch (error) {
      console.error("Error fetching social account type:", error);
      res.status(500).json({ error: "Failed to fetch social account type" });
    }
  });

  app.post("/api/social-account-types", async (req, res) => {
    try {
      const validatedData = insertSocialAccountTypeSchema.parse(req.body);
      const type = await storage.createSocialAccountType(validatedData);
      res.status(201).json(type);
    } catch (error) {
      console.error("Error creating social account type:", error);
      res.status(400).json({ error: "Failed to create social account type" });
    }
  });

  app.patch("/api/social-account-types/:id", async (req, res) => {
    try {
      const id = req.params.id;
      const validatedData = insertSocialAccountTypeSchema.partial().parse(req.body);
      const type = await storage.updateSocialAccountType(id, validatedData);

      if (!type) {
        return res.status(404).json({ error: "Social account type not found" });
      }

      res.json(type);
    } catch (error) {
      console.error("Error updating social account type:", error);
      res.status(400).json({ error: "Failed to update social account type" });
    }
  });

  app.delete("/api/social-account-types/:id", async (req, res) => {
    try {
      const id = req.params.id;
      await storage.deleteSocialAccountType(id);
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting social account type:", error);
      res.status(500).json({ error: "Failed to delete social account type" });
    }
  });

  // Relationship types endpoints
  app.get("/api/relationship-types", async (req, res) => {
    try {
      const relationshipTypes = await storage.getAllRelationshipTypes();
      res.json(relationshipTypes);
    } catch (error) {
      console.error("Error fetching relationship types:", error);
      res.status(500).json({ error: "Failed to fetch relationship types" });
    }
  });

  app.get("/api/relationship-types/:id", async (req, res) => {
    try {
      const id = req.params.id;
      const relationshipType = await storage.getRelationshipTypeById(id);

      if (!relationshipType) {
        return res.status(404).json({ error: "Relationship type not found" });
      }

      res.json(relationshipType);
    } catch (error) {
      console.error("Error fetching relationship type:", error);
      res.status(500).json({ error: "Failed to fetch relationship type" });
    }
  });

  app.post("/api/relationship-types", async (req, res) => {
    try {
      const validatedData = insertRelationshipTypeSchema.parse(req.body);
      const relationshipType = await storage.createRelationshipType(validatedData);
      res.status(201).json(relationshipType);
    } catch (error) {
      console.error("Error creating relationship type:", error);
      res.status(400).json({ error: "Failed to create relationship type" });
    }
  });

  app.patch("/api/relationship-types/:id", async (req, res) => {
    try {
      const id = req.params.id;
      const validatedData = insertRelationshipTypeSchema.partial().parse(req.body);
      const relationshipType = await storage.updateRelationshipType(id, validatedData);

      if (!relationshipType) {
        return res.status(404).json({ error: "Relationship type not found" });
      }

      res.json(relationshipType);
    } catch (error) {
      console.error("Error updating relationship type:", error);
      res.status(400).json({ error: "Failed to update relationship type" });
    }
  });

  app.delete("/api/relationship-types/:id", async (req, res) => {
    try {
      const id = req.params.id;
      await storage.deleteRelationshipType(id);
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting relationship type:", error);
      res.status(500).json({ error: "Failed to delete relationship type" });
    }
  });

  // Interaction types endpoints
  app.get("/api/interaction-types", async (req, res) => {
    try {
      const interactionTypes = await storage.getAllInteractionTypes();
      res.json(interactionTypes);
    } catch (error) {
      console.error("Error fetching interaction types:", error);
      res.status(500).json({ error: "Failed to fetch interaction types" });
    }
  });

  app.get("/api/interaction-types/:id", async (req, res) => {
    try {
      const id = req.params.id;
      const interactionType = await storage.getInteractionTypeById(id);

      if (!interactionType) {
        return res.status(404).json({ error: "Interaction type not found" });
      }

      res.json(interactionType);
    } catch (error) {
      console.error("Error fetching interaction type:", error);
      res.status(500).json({ error: "Failed to fetch interaction type" });
    }
  });

  app.post("/api/interaction-types", async (req, res) => {
    try {
      const validatedData = insertInteractionTypeSchema.parse(req.body);
      const interactionType = await storage.createInteractionType(validatedData);
      res.status(201).json(interactionType);
    } catch (error) {
      console.error("Error creating interaction type:", error);
      res.status(400).json({ error: "Failed to create interaction type" });
    }
  });

  app.patch("/api/interaction-types/:id", async (req, res) => {
    try {
      const id = req.params.id;
      const validatedData = insertInteractionTypeSchema.partial().parse(req.body);
      const interactionType = await storage.updateInteractionType(id, validatedData);

      if (!interactionType) {
        return res.status(404).json({ error: "Interaction type not found" });
      }

      res.json(interactionType);
    } catch (error) {
      console.error("Error updating interaction type:", error);
      res.status(400).json({ error: "Failed to update interaction type" });
    }
  });

  app.delete("/api/interaction-types/:id", async (req, res) => {
    try {
      const id = req.params.id;
      await storage.deleteInteractionType(id);
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting interaction type:", error);
      res.status(500).json({ error: "Failed to delete interaction type" });
    }
  });

  app.get("/api/account-matching/next", async (req, res) => {
    try {
      const skipParam = req.query.skip as string | undefined;
      const skipIds = skipParam ? skipParam.split(",").filter(Boolean) : [];

      const allPeople = await storage.getAllPeople();
      const unmatchedPerson = allPeople.find(
        (p) =>
          (!p.socialAccountUuids || p.socialAccountUuids.length === 0) &&
          p.noSocialMedia === 0 &&
          !skipIds.includes(p.id)
      );

      if (!unmatchedPerson) {
        return res.json({ person: null, candidates: [] });
      }

      const fullName = `${unmatchedPerson.firstName} ${unmatchedPerson.lastName}`.toLowerCase();
      const firstName = unmatchedPerson.firstName.toLowerCase();
      const lastName = unmatchedPerson.lastName.toLowerCase();

      const allAccounts = await storage.getAllSocialAccounts();
      const unownedAccounts = allAccounts.filter((a) => !a.ownerUuid);

      const scored = unownedAccounts.map((account) => {
        let score = 0;
        const username = (account.username || "").toLowerCase();
        const nickname = (account.currentProfile?.nickname || "").toLowerCase();

        if (nickname === fullName || username === fullName.replace(/\s+/g, "")) {
          score += 100;
        }
        if (nickname.includes(firstName) || username.includes(firstName)) {
          score += 40;
        }
        if (nickname.includes(lastName) || username.includes(lastName)) {
          score += 40;
        }
        if (nickname.includes(fullName) || username.includes(fullName.replace(/\s+/g, ""))) {
          score += 60;
        }
        const nameParts = fullName.split(" ");
        for (const part of nameParts) {
          if (part.length > 2 && (username.includes(part) || nickname.includes(part))) {
            score += 20;
          }
        }

        return { account, score };
      });

      scored.sort((a, b) => b.score - a.score);
      const candidates = scored.filter((s) => s.score > 0).slice(0, 8);

      if (candidates.length < 5) {
        const remaining = unownedAccounts
          .filter((a) => !candidates.find((c) => c.account.id === a.id))
          .slice(0, 8 - candidates.length);
        for (const account of remaining) {
          candidates.push({ account, score: 0 });
        }
      }

      const accountTypes = await storage.getAllSocialAccountTypes();
      const candidatesWithType = candidates.slice(0, 8).map((c) => ({
        ...c.account,
        typeName: accountTypes.find((t) => t.id === c.account.typeId)?.name || null,
        typeColor: accountTypes.find((t) => t.id === c.account.typeId)?.color || null,
        matchScore: c.score,
      }));

      res.json({ person: unmatchedPerson, candidates: candidatesWithType });
    } catch (error) {
      console.error("Error getting account matching data:", error);
      res.status(500).json({ error: "Failed to get account matching data" });
    }
  });

  app.post("/api/account-matching/connect", async (req, res) => {
    try {
      const connectSchema = z.object({
        personId: z.string().min(1),
        socialAccountIds: z.array(z.string()).min(1),
      });
      const { personId, socialAccountIds } = connectSchema.parse(req.body);

      const person = await storage.getPersonById(personId);
      if (!person) {
        return res.status(404).json({ error: "Person not found" });
      }

      const currentUuids = person.socialAccountUuids || [];
      const combined = [...currentUuids, ...socialAccountIds];
      const newUuids = combined.filter((v, i) => combined.indexOf(v) === i);

      await storage.updatePerson(personId, { socialAccountUuids: newUuids });

      for (const accountId of socialAccountIds) {
        await storage.updateSocialAccount(accountId, { ownerUuid: personId });
      }

      if (!person.imageUrl) {
        for (const accountId of socialAccountIds) {
          const account = await storage.getSocialAccountById(accountId);
          if (account?.currentProfile?.imageUrl) {
            await storage.updatePerson(personId, { imageUrl: account.currentProfile.imageUrl });
            break;
          }
        }
      }

      res.json({ success: true });
    } catch (error) {
      console.error("Error connecting accounts:", error);
      res.status(500).json({ error: "Failed to connect accounts" });
    }
  });

  app.post("/api/image-pass-in", async (req, res) => {
    try {
      const allPeople = await storage.getAllPeople();
      const peopleWithoutImages = allPeople.filter(p => !p.imageUrl);

      let updated = 0;
      let skipped = 0;
      let noSocialAccount = 0;
      const updates: { personId: string; personName: string; imageUrl: string }[] = [];

      for (const person of peopleWithoutImages) {
        const socialUuids = person.socialAccountUuids || [];
        if (socialUuids.length === 0) {
          noSocialAccount++;
          continue;
        }

        let foundImage: string | null = null;
        for (const uuid of socialUuids) {
          const account = await storage.getSocialAccountById(uuid);
          if (account?.currentProfile?.imageUrl) {
            foundImage = account.currentProfile.imageUrl;
            break;
          }
        }

        if (foundImage) {
          await storage.updatePerson(person.id, { imageUrl: foundImage });
          updates.push({
            personId: person.id,
            personName: `${person.firstName} ${person.lastName}`.trim(),
            imageUrl: foundImage,
          });
          updated++;
        } else {
          skipped++;
        }
      }

      res.json({
        totalPeopleWithoutImages: peopleWithoutImages.length,
        updated,
        skipped,
        noSocialAccount,
        updates,
      });
    } catch (error) {
      console.error("Error in image pass-in:", error);
      res.status(500).json({ error: "Failed to process image pass-in" });
    }
  });

  app.post("/api/account-matching/ignore", async (req, res) => {
    try {
      const ignoreSchema = z.object({ personId: z.string().min(1) });
      const { personId } = ignoreSchema.parse(req.body);

      await storage.updatePerson(personId, { noSocialMedia: 1 });
      res.json({ success: true });
    } catch (error) {
      console.error("Error ignoring person:", error);
      res.status(500).json({ error: "Failed to update person" });
    }
  });

  // Task management routes
  app.get("/api/tasks", async (req, res) => {
    try {
      const limit = req.query.limit ? parseInt(req.query.limit as string) : 100;
      const status = req.query.status as string | undefined;
      let taskList;
      if (status) {
        taskList = await storage.getTasksByStatus(status);
      } else {
        taskList = await storage.getAllTasks(limit);
      }
      res.json(taskList);
    } catch (error) {
      console.error("Error fetching tasks:", error);
      res.status(500).json({ error: "Failed to fetch tasks" });
    }
  });

  app.get("/api/tasks/social-accounts-brief", async (req, res) => {
    try {
      const accounts = await storage.getAllSocialAccounts();
      const brief = accounts.map(a => ({
        id: a.id,
        username: a.username,
        nickname: a.currentProfile?.nickname || null,
      }));
      res.json(brief);
    } catch (error) {
      console.error("Error fetching brief accounts:", error);
      res.status(500).json({ error: "Failed to fetch accounts" });
    }
  });

  app.get("/api/tasks/:id", async (req, res) => {
    try {
      const task = await storage.getTaskById(req.params.id);
      if (!task) {
        return res.status(404).json({ error: "Task not found" });
      }
      res.json(task);
    } catch (error) {
      console.error("Error fetching task:", error);
      res.status(500).json({ error: "Failed to fetch task" });
    }
  });

  app.delete("/api/tasks/:id", async (req, res) => {
    try {
      const task = await storage.getTaskById(req.params.id);
      if (!task) {
        return res.status(404).json({ error: "Task not found" });
      }
      if (task.status !== "pending" && task.status !== "in_progress") {
        return res.status(400).json({ error: "Can only cancel pending or running tasks" });
      }
      const updated = await storage.updateTaskStatus(req.params.id, "cancelled", "Cancelled by user");
      res.json(updated);
    } catch (error) {
      console.error("Error cancelling task:", error);
      res.status(500).json({ error: "Failed to cancel task" });
    }
  });

  app.post("/api/tasks/refresh-follower-count/:socialAccountId", async (req, res) => {
    try {
      const { socialAccountId } = req.params;
      const account = await storage.getSocialAccountById(socialAccountId);
      if (!account) {
        return res.status(404).json({ error: "Social account not found" });
      }
      const task = await storage.createTask({
        type: "refresh_follower_count",
        status: "pending",
        payload: JSON.stringify({ socialAccountId }),
      });
      triggerTaskWorker();
      res.json(task);
    } catch (error) {
      console.error("Error creating refresh task:", error);
      res.status(500).json({ error: "Failed to create refresh task" });
    }
  });

  app.post("/api/tasks/mass-refresh-follower-count", async (req, res) => {
    try {
      const task = await storage.createTask({
        type: "mass_refresh_follower_count",
        status: "pending",
        payload: JSON.stringify({}),
      });
      triggerTaskWorker();
      res.json(task);
    } catch (error) {
      console.error("Error creating mass refresh task:", error);
      res.status(500).json({ error: "Failed to create mass refresh task" });
    }
  });

  // Image storage settings
  app.get("/api/image-storage/mode", async (req, res) => {
    if (!req.isAuthenticated() || !req.user) {
      return res.status(401).json({ error: "Not authenticated" });
    }
    try {
      const mode = await storage.getImageStorageMode(req.user.id);
      const hasS3Creds = !!(process.env.S3_ENDPOINT && process.env.S3_ACCESS_KEY && process.env.S3_SECRET_KEY && process.env.S3_BUCKET);
      res.json({ mode, hasS3Creds });
    } catch (error) {
      console.error("Error getting image storage mode:", error);
      res.status(500).json({ error: "Failed to get image storage mode" });
    }
  });

  app.put("/api/image-storage/mode", async (req, res) => {
    if (!req.isAuthenticated() || !req.user) {
      return res.status(401).json({ error: "Not authenticated" });
    }
    try {
      const { mode } = req.body;
      if (mode !== "s3" && mode !== "local") {
        return res.status(400).json({ error: "Invalid storage mode. Must be 's3' or 'local'" });
      }
      await storage.setImageStorageMode(req.user.id, mode);
      res.json({ success: true, mode });
    } catch (error) {
      console.error("Error setting image storage mode:", error);
      res.status(500).json({ error: "Failed to set image storage mode" });
    }
  });

  app.post("/api/image-storage/transfer-to-local", async (req, res) => {
    if (!req.isAuthenticated() || !req.user) {
      return res.status(401).json({ error: "Not authenticated" });
    }
    try {
      const task = await storage.createTask({
        type: "transfer_images_to_local",
        status: "pending",
        payload: JSON.stringify({ userId: req.user.id }),
      });
      triggerTaskWorker();
      res.json(task);
    } catch (error) {
      console.error("Error creating transfer to local task:", error);
      res.status(500).json({ error: "Failed to create transfer task" });
    }
  });

  app.post("/api/image-storage/transfer-to-s3", async (req, res) => {
    if (!req.isAuthenticated() || !req.user) {
      return res.status(401).json({ error: "Not authenticated" });
    }
    try {
      const task = await storage.createTask({
        type: "transfer_images_to_s3",
        status: "pending",
        payload: JSON.stringify({ userId: req.user.id }),
      });
      triggerTaskWorker();
      res.json(task);
    } catch (error) {
      console.error("Error creating transfer to S3 task:", error);
      res.status(500).json({ error: "Failed to create transfer task" });
    }
  });

  app.get("/api/image-storage/stats", async (req, res) => {
    if (!req.isAuthenticated() || !req.user) {
      return res.status(401).json({ error: "Not authenticated" });
    }
    try {
      const allUrls = await storage.getAllImageUrls();
      const localCount = allUrls.filter(u => isLocalImageUrl(u.url)).length;
      const s3Count = allUrls.filter(u => !isLocalImageUrl(u.url)).length;
      res.json({ total: allUrls.length, local: localCount, s3: s3Count });
    } catch (error) {
      console.error("Error getting image stats:", error);
      res.status(500).json({ error: "Failed to get image stats" });
    }
  });

  // ========================
  // V1 API Endpoints
  // ========================

  // --- Upgrade #9: Health Check with Service Details ---
  app.get("/api/v1/ping", (_req, res) => {
    res.json({
      status: "ok",
      version: "1.4.0",
      features: [
        "social-account-search",
        "bulk-lookup",
        "sse-events",
        "rate-limiting",
        "etag-caching",
        "structured-errors",
        "compression",
      ],
      timestamp: new Date().toISOString(),
    });
  });

  // --- Upgrade #1: Social Account Search Endpoint ---
  app.post("/api/v1/social-accounts/search", async (req, res) => {
    try {
      const { username, platform } = req.body;
      const page = Math.max(1, parseInt(req.body.page as string) || parseInt(req.query.page as string) || 1);
      const perPage = Math.min(100, Math.max(1, parseInt(req.body.per_page as string) || parseInt(req.query.per_page as string) || 20));

      if (!username || typeof username !== "string") {
        return sendApiError(res, 400, ErrorCodes.VALIDATION_ERROR, "The 'username' field is required and must be a string.", {}, (req as any).requestId);
      }

      const { results, total } = await storage.searchSocialAccountsByUsername({
        username: username.trim(),
        platform: platform ? String(platform).trim() : undefined,
        page,
        perPage,
      });

      res.json({
        results,
        total,
        page,
        per_page: perPage,
      });
    } catch (error) {
      console.error("Error searching social accounts:", error);
      sendApiError(res, 500, ErrorCodes.INTERNAL_ERROR, "Failed to search social accounts.", {}, (req as any).requestId);
    }
  });

  // --- Upgrade #5: Bulk Social Account Lookup Endpoint ---
  app.post("/api/v1/social-accounts/bulk", async (req, res) => {
    try {
      const { usernames } = req.body;

      if (!Array.isArray(usernames)) {
        return sendApiError(res, 400, ErrorCodes.VALIDATION_ERROR, "The 'usernames' field must be an array of {username, platform} objects.", {}, (req as any).requestId);
      }

      if (usernames.length > 50) {
        return sendApiError(res, 400, ErrorCodes.BULK_LIMIT_EXCEEDED, "Maximum 50 lookups per request.", { limit: 50, received: usernames.length }, (req as any).requestId);
      }

      // Validate each entry
      for (const entry of usernames) {
        if (!entry.username || typeof entry.username !== "string" || !entry.platform || typeof entry.platform !== "string") {
          return sendApiError(res, 400, ErrorCodes.VALIDATION_ERROR, "Each entry must have 'username' (string) and 'platform' (string) fields.", {}, (req as any).requestId);
        }
      }

      const result = await storage.bulkLookupSocialAccounts(usernames);
      res.json(result);
    } catch (error) {
      console.error("Error in bulk social account lookup:", error);
      sendApiError(res, 500, ErrorCodes.INTERNAL_ERROR, "Failed to perform bulk lookup.", {}, (req as any).requestId);
    }
  });

  // --- Upgrade #6: PATCH for Partial Social Account Updates (v1 route) ---
  app.patch("/api/v1/social-accounts/:id", async (req, res) => {
    try {
      const id = req.params.id;
      const body = req.body;

      // Check account exists
      const existing = await storage.getSocialAccountById(id);
      if (!existing) {
        return sendApiError(res, 404, ErrorCodes.SOCIAL_ACCOUNT_NOT_FOUND, `No social account found with ID '${id}'.`, {}, (req as any).requestId);
      }

      // Update registry fields
      const registryFields: Record<string, any> = {};
      if (body.username !== undefined) registryFields.username = body.username;
      if (body.ownerUuid !== undefined) registryFields.ownerUuid = body.ownerUuid;
      if (body.typeId !== undefined) registryFields.typeId = body.typeId;
      if (body.internalAccountCreationType !== undefined) registryFields.internalAccountCreationType = body.internalAccountCreationType;
      if (body.lastScrapedAt !== undefined) registryFields.lastScrapedAt = body.lastScrapedAt;

      if (Object.keys(registryFields).length > 0) {
        await storage.updateSocialAccount(id, registryFields);
      }

      // Update profile fields
      const profileFields: Record<string, any> = {};
      if (body.nickname !== undefined) profileFields.nickname = body.nickname;
      if (body.accountUrl !== undefined) profileFields.accountUrl = body.accountUrl;
      if (body.imageUrl !== undefined) profileFields.imageUrl = body.imageUrl;
      if (body.bio !== undefined) profileFields.bio = body.bio;

      if (Object.keys(profileFields).length > 0) {
        const currentProfile = await storage.getCurrentProfileVersion(id);
        if (currentProfile) {
          await storage.updateProfileVersion(currentProfile.id, profileFields);
        } else {
          await storage.createProfileVersion({
            socialAccountId: id,
            isCurrent: true,
            ...profileFields,
          });
        }
      }

      // Broadcast SSE event
      sseManager.broadcast("social_account.updated", { id });

      const account = await storage.getSocialAccountById(id);
      res.json(account);
    } catch (error) {
      console.error("Error updating social account:", error);
      sendApiError(res, 500, ErrorCodes.INTERNAL_ERROR, "Failed to update social account.", {}, (req as any).requestId);
    }
  });

  // --- Upgrade #2: Pagination on list endpoints (v1 url-list) ---
  app.get("/api/v1/url-list", async (req, res) => {
    try {
      const page = Math.max(1, parseInt(req.query.page as string) || 1);
      const perPage = Math.min(100, Math.max(1, parseInt(req.query.per_page as string) || 20));
      const offset = (page - 1) * perPage;
      const searchQuery = req.query.search as string | undefined;
      const typeId = req.query.typeId as string | undefined;

      const accounts = await storage.getSocialAccountsPaginated({
        offset,
        limit: perPage,
        searchQuery: searchQuery || undefined,
        typeId: typeId || undefined,
      });

      // Get total count for pagination metadata
      const allAccounts = await storage.getAllSocialAccounts(searchQuery, typeId);
      const total = allAccounts.length;

      res.json({
        results: accounts,
        total,
        page,
        per_page: perPage,
      });
    } catch (error) {
      console.error("Error fetching v1 url-list:", error);
      sendApiError(res, 500, ErrorCodes.INTERNAL_ERROR, "Failed to fetch URL list.", {}, (req as any).requestId);
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

  const httpServer = createServer(app);
  return httpServer;
}
