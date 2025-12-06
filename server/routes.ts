import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { db } from "./db";
import { interactions, relationshipTypes, interactionTypes, people } from "@shared/schema";
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
} from "@shared/schema";
import multer from "multer";
import { uploadImageToS3, deleteImageFromS3 } from "./s3";
import { hashPassword } from "./auth";
import { scrypt, timingSafeEqual } from "crypto";
import { promisify } from "util";
import Papa from "papaparse";

const scryptAsync = promisify(scrypt);

const upload = multer({ storage: multer.memoryStorage() });

// Flag to track if user creation is allowed (only after database reset)
let isUserCreationAllowed = false;

export async function registerRoutes(app: Express): Promise<Server> {
  // Image upload endpoint
  app.post("/api/upload-image", upload.single("image"), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "No image file provided" });
      }

      const imageUrl = await uploadImageToS3(
        req.file.buffer,
        req.file.originalname,
        req.file.mimetype
      );

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

      await deleteImageFromS3(imageUrl);
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

  // XML Export endpoint
  app.get("/api/export-xml", async (req, res) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      // Fetch all data from database
      const [user] = await storage.getAllUsers();
      const allPeople = await storage.getAllPeople();
      const allRelationshipTypes = await storage.getAllRelationshipTypes();
      const allRelationships = await storage.getAllRelationships();
      const allInteractionTypes = await storage.getAllInteractionTypes();
      const allInteractions = await storage.getAllInteractions();
      const groups = await storage.getAllGroups();
      const allNotes = await storage.getAllNotes();
      const allGroupNotes = await storage.getAllGroupNotes();
      const allSocialAccounts = await storage.getAllSocialAccounts();
      
      // Find ME user's person ID
      const mePersonResult = await db.select().from(people).where(isNotNull(people.userId)).limit(1);
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

      // Export social accounts (encode ME user UUID as all zeros in ownerUuid)
      xml += '  <social_accounts>\n';
      for (const account of allSocialAccounts) {
        const ownerUuid = account.ownerUuid === mePersonId ? ZERO_UUID : account.ownerUuid;
        
        xml += '    <social_account>\n';
        xml += `      <id>${escapeXml(account.id)}</id>\n`;
        xml += `      <username>${escapeXml(account.username)}</username>\n`;
        xml += `      <account_url>${escapeXml(account.accountUrl)}</account_url>\n`;
        xml += `      <owner_uuid>${escapeXml(ownerUuid || "")}</owner_uuid>\n`;
        xml += `      <image_url>${escapeXml(account.imageUrl || "")}</image_url>\n`;
        xml += `      <notes>${escapeXml(account.notes || "")}</notes>\n`;
        xml += `      <following>${arrayToXml(account.following || [], "account_id")}</following>\n`;
        xml += `      <followers>${arrayToXml(account.followers || [], "account_id")}</followers>\n`;
        xml += `      <created_at>${escapeXml(account.createdAt)}</created_at>\n`;
        xml += '    </social_account>\n';
      }
      xml += '  </social_accounts>\n';

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

      let importedCounts = {
        relationshipTypes: 0,
        interactionTypes: 0,
        people: 0,
        relationships: 0,
        groups: 0,
        interactions: 0,
        notes: 0,
        groupNotes: 0,
        socialAccounts: 0,
      };
      
      let skippedCounts = {
        relationshipTypes: 0,
        interactionTypes: 0,
        people: 0,
        relationships: 0,
        interactions: 0,
        socialAccounts: 0,
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

      // Parse and import social accounts
      const socialAccountBlocks = parseAllTags("social_account", xmlText);
      for (const block of socialAccountBlocks) {
        const id = unescapeXml(parseXmlTag("id", block));
        const username = unescapeXml(parseXmlTag("username", block));
        const accountUrl = unescapeXml(parseXmlTag("account_url", block));
        const ownerUuid = unescapeXml(parseXmlTag("owner_uuid", block));
        const imageUrl = unescapeXml(parseXmlTag("image_url", block));
        const notes = unescapeXml(parseXmlTag("notes", block));
        const following = parseXmlArray("following", "account_id", block);
        const followers = parseXmlArray("followers", "account_id", block);

        // Check for duplicate by UUID
        if (existingSocialAccountUuids.has(id)) {
          skippedCounts.socialAccounts++;
          continue; // Skip this duplicate
        }

        // Replace zero UUID with ME user UUID in ownerUuid
        const processedOwnerUuid = replaceZeroUUID(ownerUuid);

        try {
          await storage.createSocialAccountWithId({
            id,
            username,
            accountUrl,
            ownerUuid: processedOwnerUuid || null,
            imageUrl: imageUrl || null,
            notes: notes || null,
            following: following.length > 0 ? following : [],
            followers: followers.length > 0 ? followers : [],
          });
          importedCounts.socialAccounts++;
          existingSocialAccountUuids.add(id);
        } catch (error) {
          console.error(`Error importing social account ${id}:`, error);
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

  // Search endpoint
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

      const { name } = req.body;
      if (!name || typeof name !== 'string') {
        return res.status(400).json({ error: "Name is required" });
      }

      // Generate a random API key (32 bytes = 64 hex characters)
      const crypto = await import("crypto");
      const rawKey = crypto.randomBytes(32).toString('hex');
      
      // Hash the key for storage (like password hashing)
      const hashedKey = await hashPassword(rawKey);

      const validatedData = insertApiKeySchema.parse({
        userId: req.user.id,
        name,
        key: hashedKey,
      });

      const apiKey = await storage.createApiKey(validatedData);

      // Return the raw key ONLY THIS ONE TIME (never stored/shown again)
      res.status(201).json({
        id: apiKey.id,
        name: apiKey.name,
        key: rawKey, // Show raw key only on creation
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
      
      // Get ME user's person ID to filter relationships
      const userId = req.user?.id;
      let mePersonId: string | undefined;
      if (userId) {
        const mePerson = await storage.getMePerson(userId);
        mePersonId = mePerson?.id;
      }
      
      const people = await storage.getPeoplePaginated(offset, limit, mePersonId);
      res.json(people);
    } catch (error) {
      console.error("Error fetching paginated people:", error);
      res.status(500).json({ error: "Failed to fetch people" });
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

  // Social accounts endpoints
  app.get("/api/social-accounts", async (req, res) => {
    try {
      const searchQuery = req.query.search as string | undefined;
      const accounts = await storage.getAllSocialAccounts(searchQuery);
      res.json(accounts);
    } catch (error) {
      console.error("Error fetching social accounts:", error);
      res.status(500).json({ error: "Failed to fetch social accounts" });
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
      res.status(201).json(account);
    } catch (error) {
      console.error("Error creating social account:", error);
      res.status(400).json({ error: "Failed to create social account" });
    }
  });

  app.patch("/api/social-accounts/:id", async (req, res) => {
    try {
      const id = req.params.id;
      const validatedData = insertSocialAccountSchema.partial().parse(req.body);
      const account = await storage.updateSocialAccount(id, validatedData);

      if (!account) {
        return res.status(404).json({ error: "Social account not found" });
      }

      res.json(account);
    } catch (error) {
      console.error("Error updating social account:", error);
      res.status(400).json({ error: "Failed to update social account" });
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

  // Social account follower/following management
  app.post("/api/social-accounts/:id/followers", async (req, res) => {
    try {
      const { id } = req.params;
      const { followerId } = req.body;
      
      if (!followerId) {
        return res.status(400).json({ error: "followerId is required" });
      }

      await storage.addFollower(id, followerId);
      res.json({ success: true });
    } catch (error) {
      console.error("Error adding follower:", error);
      res.status(500).json({ error: "Failed to add follower" });
    }
  });

  app.delete("/api/social-accounts/:id/followers/:followerId", async (req, res) => {
    try {
      const { id, followerId } = req.params;
      await storage.removeFollower(id, followerId);
      res.json({ success: true });
    } catch (error) {
      console.error("Error removing follower:", error);
      res.status(500).json({ error: "Failed to remove follower" });
    }
  });

  app.post("/api/social-accounts/:id/following", async (req, res) => {
    try {
      const { id } = req.params;
      const { followingId } = req.body;
      
      if (!followingId) {
        return res.status(400).json({ error: "followingId is required" });
      }

      await storage.addFollowing(id, followingId);
      res.json({ success: true });
    } catch (error) {
      console.error("Error adding following:", error);
      res.status(500).json({ error: "Failed to add following" });
    }
  });

  app.delete("/api/social-accounts/:id/following/:followingId", async (req, res) => {
    try {
      const { id, followingId } = req.params;
      await storage.removeFollowing(id, followingId);
      res.json({ success: true });
    } catch (error) {
      console.error("Error removing following:", error);
      res.status(500).json({ error: "Failed to remove following" });
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

  const httpServer = createServer(app);
  return httpServer;
}
