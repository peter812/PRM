import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { db } from "./db";
import { interactions, relationshipTypes, interactionTypes } from "@shared/schema";
import { eq } from "drizzle-orm";
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
} from "@shared/schema";
import multer from "multer";
import { uploadImageToS3, deleteImageFromS3 } from "./s3";
import { hashPassword } from "./auth";
import { scrypt, timingSafeEqual } from "crypto";
import { promisify } from "util";
import Papa from "papaparse";

const scryptAsync = promisify(scrypt);

const upload = multer({ storage: multer.memoryStorage() });

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
      const people = await storage.getAllPeople();
      const relationshipTypes = await storage.getAllRelationshipTypes();
      const relationships = await storage.getAllRelationships();
      const interactionTypes = await storage.getAllInteractionTypes();
      const allInteractions = await storage.getAllInteractions();
      const groups = await storage.getAllGroups();
      const allNotes = await storage.getAllNotes();
      const allGroupNotes = await storage.getAllGroupNotes();

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
      for (const type of relationshipTypes) {
        xml += '    <relationship_type>\n';
        xml += `      <id>${escapeXml(type.id)}</id>\n`;
        xml += `      <name>${escapeXml(type.name)}</name>\n`;
        xml += `      <color>${escapeXml(type.color)}</color>\n`;
        xml += `      <notes>${escapeXml(type.notes || "")}</notes>\n`;
        xml += '    </relationship_type>\n';
      }
      xml += '  </relationship_types>\n';

      // Export interaction types
      xml += '  <interaction_types>\n';
      for (const type of interactionTypes) {
        xml += '    <interaction_type>\n';
        xml += `      <id>${escapeXml(type.id)}</id>\n`;
        xml += `      <name>${escapeXml(type.name)}</name>\n`;
        xml += `      <color>${escapeXml(type.color)}</color>\n`;
        xml += `      <description>${escapeXml(type.description || "")}</description>\n`;
        xml += `      <value>${escapeXml(type.value)}</value>\n`;
        xml += '    </interaction_type>\n';
      }
      xml += '  </interaction_types>\n';

      // Export people
      xml += '  <people>\n';
      for (const person of people) {
        xml += '    <person>\n';
        xml += `      <id>${escapeXml(person.id)}</id>\n`;
        xml += `      <first_name>${escapeXml(person.firstName)}</first_name>\n`;
        xml += `      <last_name>${escapeXml(person.lastName)}</last_name>\n`;
        xml += `      <email>${escapeXml(person.email || "")}</email>\n`;
        xml += `      <phone>${escapeXml(person.phone || "")}</phone>\n`;
        xml += `      <company>${escapeXml(person.company || "")}</company>\n`;
        xml += `      <title>${escapeXml(person.title || "")}</title>\n`;
        xml += `      <tags>${arrayToXml(person.tags || [], "tag")}</tags>\n`;
        xml += `      <created_at>${escapeXml(person.createdAt)}</created_at>\n`;
        xml += '    </person>\n';
      }
      xml += '  </people>\n';

      // Export relationships
      xml += '  <relationships>\n';
      for (const rel of relationships) {
        xml += '    <relationship>\n';
        xml += `      <id>${escapeXml(rel.id)}</id>\n`;
        xml += `      <from_person_id>${escapeXml(rel.fromPersonId)}</from_person_id>\n`;
        xml += `      <to_person_id>${escapeXml(rel.toPersonId)}</to_person_id>\n`;
        xml += `      <type_id>${escapeXml(rel.typeId)}</type_id>\n`;
        xml += `      <notes>${escapeXml(rel.notes || "")}</notes>\n`;
        xml += `      <created_at>${escapeXml(rel.createdAt)}</created_at>\n`;
        xml += '    </relationship>\n';
      }
      xml += '  </relationships>\n';

      // Export groups
      xml += '  <groups>\n';
      for (const group of groups) {
        xml += '    <group>\n';
        xml += `      <id>${escapeXml(group.id)}</id>\n`;
        xml += `      <name>${escapeXml(group.name)}</name>\n`;
        xml += `      <color>${escapeXml(group.color)}</color>\n`;
        xml += `      <type>${arrayToXml(group.type || [], "group_type")}</type>\n`;
        xml += `      <members>${arrayToXml(group.members || [], "member_id")}</members>\n`;
        xml += `      <created_at>${escapeXml(group.createdAt)}</created_at>\n`;
        xml += '    </group>\n';
      }
      xml += '  </groups>\n';

      // Export interactions
      xml += '  <interactions>\n';
      for (const interaction of allInteractions) {
        xml += '    <interaction>\n';
        xml += `      <id>${escapeXml(interaction.id)}</id>\n`;
        xml += `      <type_id>${escapeXml(interaction.typeId)}</type_id>\n`;
        xml += `      <date>${escapeXml(interaction.date)}</date>\n`;
        xml += `      <description>${escapeXml(interaction.description || "")}</description>\n`;
        xml += `      <people_ids>${arrayToXml(interaction.peopleIds || [], "person_id")}</people_ids>\n`;
        xml += `      <group_ids>${arrayToXml(interaction.groupIds || [], "group_id")}</group_ids>\n`;
        xml += `      <created_at>${escapeXml(interaction.createdAt)}</created_at>\n`;
        xml += '    </interaction>\n';
      }
      xml += '  </interactions>\n';

      // Export notes
      xml += '  <notes>\n';
      for (const note of allNotes) {
        xml += '    <note>\n';
        xml += `      <id>${escapeXml(note.id)}</id>\n`;
        xml += `      <person_id>${escapeXml(note.personId)}</person_id>\n`;
        xml += `      <content>${escapeXml(note.content)}</content>\n`;
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

      let importedCounts = {
        relationshipTypes: 0,
        interactionTypes: 0,
        people: 0,
        relationships: 0,
        groups: 0,
        interactions: 0,
        notes: 0,
        groupNotes: 0,
      };

      // Parse and import relationship types
      const relationshipTypeBlocks = parseAllTags("relationship_type", xmlText);
      for (const block of relationshipTypeBlocks) {
        const id = unescapeXml(parseXmlTag("id", block));
        const name = unescapeXml(parseXmlTag("name", block));
        const color = unescapeXml(parseXmlTag("color", block));
        const notes = unescapeXml(parseXmlTag("notes", block));

        try {
          await db.insert(relationshipTypes).values({ id, name, color, notes: notes || null, value: 50 }).onConflictDoNothing();
          importedCounts.relationshipTypes++;
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

        try {
          await db.insert(interactionTypes).values({ id, name, color, description: description || null, value }).onConflictDoNothing();
          importedCounts.interactionTypes++;
        } catch (error) {
          console.error(`Error importing interaction type ${id}:`, error);
        }
      }

      // Parse and import people
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
          });
          importedCounts.people++;
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

        try {
          await storage.createGroupWithId({
            id,
            name,
            color,
            type: type.length > 0 ? type : [],
            members: members.length > 0 ? members : [],
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
        const fromPersonId = unescapeXml(parseXmlTag("from_person_id", block));
        const toPersonId = unescapeXml(parseXmlTag("to_person_id", block));
        const typeId = unescapeXml(parseXmlTag("type_id", block));
        const notes = unescapeXml(parseXmlTag("notes", block));

        try {
          await storage.createRelationshipWithId({
            id,
            fromPersonId,
            toPersonId,
            typeId,
            notes: notes || null,
          });
          importedCounts.relationships++;
        } catch (error) {
          console.error(`Error importing relationship ${id}:`, error);
        }
      }

      // Parse and import interactions
      const interactionBlocks = parseAllTags("interaction", xmlText);
      for (const block of interactionBlocks) {
        const id = unescapeXml(parseXmlTag("id", block));
        const typeId = unescapeXml(parseXmlTag("type_id", block));
        const date = unescapeXml(parseXmlTag("date", block));
        const description = unescapeXml(parseXmlTag("description", block));
        const peopleIds = parseXmlArray("people_ids", "person_id", block);
        const groupIds = parseXmlArray("group_ids", "group_id", block);

        try {
          await storage.createInteractionWithId({
            id,
            typeId,
            date: new Date(date),
            description: description || null,
            peopleIds: peopleIds.length > 0 ? peopleIds : [],
            groupIds: groupIds.length > 0 ? groupIds : [],
            imageUrl: null, // Images are not imported
          });
          importedCounts.interactions++;
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

        try {
          await storage.createNoteWithId({ id, personId, content });
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

      res.json({
        success: true,
        imported: importedCounts,
      });
    } catch (error) {
      console.error("Error importing XML:", error);
      res.status(500).json({ error: "Failed to import XML" });
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
      res.json({ isSetupNeeded: userCount === 0 });
    } catch (error) {
      console.error("Error checking setup status:", error);
      res.status(500).json({ error: "Failed to check setup status" });
    }
  });

  app.post("/api/setup/initialize", async (req, res) => {
    try {
      const userCount = await storage.getUserCount();
      if (userCount > 0) {
        return res.status(400).json({ error: "Setup already completed" });
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

      const { name, nickname, username, currentPassword, newPassword } = req.body;
      const updateData: any = {};

      // Validate and add basic fields
      if (name !== undefined) updateData.name = name;
      if (nickname !== undefined) updateData.nickname = nickname;
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

  app.get("/api/people/search", async (req, res) => {
    try {
      const query = req.query.q as string | undefined;
      
      if (!query) {
        return res.status(400).json({ error: "Search query parameter 'q' is required" });
      }

      const people = await storage.getAllPeople(query);
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
