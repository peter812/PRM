// Generated route module - people-groups.ts
import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "../storage";
import { db } from "../db";
import { interactions, relationshipTypes, interactionTypes, people, socialNetworkChanges, socialAccountPosts, socialAccounts, socialProfileVersions, aiChats, dailyNotes, notes, groups, type SocialAccountWithCurrentProfile, type ExtensionSession, type AiChatMessage, type AiToolCallTrace } from "@shared/schema";
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
  deriveLineageRole,
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
import { syncEntityInBackground, deleteEntityVector } from "../vector-universal";

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


async function buildOllamaChatContext(): Promise<{ base: string; headers: Record<string, string> } | null> {
  const apiUrl = (await storage.getAppSetting("ollama_api_url")) ?? "";
  if (!apiUrl.trim()) return null;
  const base = apiUrl.replace(/\/+$/, "");
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const authRequired = (await storage.getAppSetting("ollama_auth_required")) === "true";
  if (authRequired) {
    const username = (await storage.getAppSetting("ollama_username")) ?? "";
    const password = (await storage.getAppSetting("ollama_password")) ?? "";
    headers["Authorization"] = "Basic " + Buffer.from(`${username}:${password}`).toString("base64");
  }
  return { base, headers };
}


export function registerRoutes(app: Express) {
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
  
    app.get("/api/people/me-person", async (req, res) => {
      if (!req.isAuthenticated()) return res.status(401).json({ error: "Not authenticated" });
      try {
        const mePerson = await storage.getMePerson(req.user!.id);
        if (!mePerson) return res.status(404).json({ error: "ME person not found" });
        res.json({ uuid: mePerson.id, name: (mePerson as any).name });
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    });
  
    app.get("/api/people/paginated", async (req, res) => {
      try {
        const offset = parseInt(req.query.offset as string) || 0;
        const limit = parseInt(req.query.limit as string) || 30;
        const sortBy = (req.query.sortBy as string) || 'relationship';
        
        // Get ME user's person ID to filter relationships
        const userId = req.user?.id;
        let mePersonId: string | undefined;
        if (userId) {
          const mePerson = await storage.getMePerson(userId);
          mePersonId = mePerson?.id;
        }
        
        const people = await storage.getPeoplePaginated(offset, limit, mePersonId, sortBy);
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

    app.patch("/api/people/:id/elo-rankable", async (req, res) => {
      try {
        const id = req.params.id;
        const { eloRankable } = req.body;
        if (typeof eloRankable !== "number" || (eloRankable !== 0 && eloRankable !== 1)) {
          return res.status(400).json({ error: "eloRankable must be 0 or 1" });
        }
        const person = await storage.updatePerson(id, { eloRankable });
        if (!person) {
          return res.status(404).json({ error: "Person not found" });
        }
        res.json(person);
      } catch (error) {
        console.error("Error updating ELO rankable status:", error);
        res.status(500).json({ error: "Failed to update ELO rankable status" });
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
  
        res.json(people.map(p => ({ uuid: p.id, name: `${p.firstName} ${p.lastName}`.trim() })));
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
        syncEntityInBackground("person", person.id);
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
                syncEntityInBackground("person", id);
                return res.json(updated);
              }
              break;
            }
          }
        }
  
        syncEntityInBackground("person", id);
        res.json(person);
      } catch (error) {
        console.error("Error updating person:", error);
        res.status(400).json({ error: "Failed to update person" });
      }
    });
  
    app.delete("/api/people/:id", async (req, res) => {
      try {
        const id = req.params.id;
        // Collect vector IDs for cascaded child entities before deletion
        const [personRow] = await db.select({ vectorId: people.vectorId }).from(people).where(eq(people.id, id));
        const childNotes = await db.select({ vectorId: notes.vectorId }).from(notes).where(eq(notes.personId, id));
        await storage.deletePerson(id);
        // Remove vectors asynchronously
        if (personRow?.vectorId) void deleteEntityVector("person", personRow.vectorId);
        const childNoteVectorIds = childNotes.map((n) => n.vectorId).filter(Boolean) as string[];
        if (childNoteVectorIds.length > 0) {
          void deleteEntityVector("note", childNoteVectorIds);
        }
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
        syncEntityInBackground("note", note.id);
        res.status(201).json(note);
      } catch (error) {
        console.error("Error creating note:", error);
        res.status(400).json({ error: "Failed to create note" });
      }
    });
  
    app.delete("/api/notes/:id", async (req, res) => {
      try {
        const id = req.params.id;
        const [noteRow] = await db.select({ vectorId: notes.vectorId }).from(notes).where(eq(notes.id, id));
        await storage.deleteNote(id);
        if (noteRow?.vectorId) void deleteEntityVector("note", noteRow.vectorId);
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
        syncEntityInBackground("interaction", interaction.id);
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
  
        syncEntityInBackground("interaction", id);
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
        
        const vectorIdToDelete = interaction?.vectorId ?? null;
        await storage.deleteInteraction(id);
        if (vectorIdToDelete) void deleteEntityVector("interaction", vectorIdToDelete);
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
  
    // Returns this person's relationships grouped by relationship type, sorted
    // by the type's value (highest first), with empty groups omitted. Provides
    // all data the Relationships tab needs in a single API call.
    app.get("/api/people/:personId/relationships-grouped", async (req, res) => {
      try {
        const { personId } = req.params;
  
        const person = await storage.getPersonById(personId);
        if (!person) {
          return res.status(404).json({ error: "Person not found" });
        }
  
        const rels = person.relationships || [];
  
        type GroupedRel = {
          id: string;
          notes: string | null;
          toPerson: {
            id: string;
            firstName: string;
            lastName: string;
            imageUrl: string | null;
            company: string | null;
            title: string | null;
          };
        };
  
        type Group = {
          type: {
            id: string | null;
            name: string;
            color: string;
            value: number;
          };
          relationships: GroupedRel[];
        };
  
        const groupsMap = new Map<string, Group>();
  
        for (const rel of rels) {
          const typeKey = rel.type?.id ?? "__untyped__";
          const typeName = rel.type?.name ?? "Other";
          const typeColor = rel.type?.color ?? "#6b7280";
          const typeValue = rel.type?.value ?? 0;
  
          if (!groupsMap.has(typeKey)) {
            groupsMap.set(typeKey, {
              type: {
                id: rel.type?.id ?? null,
                name: typeName,
                color: typeColor,
                value: typeValue,
              },
              relationships: [],
            });
          }
  
          groupsMap.get(typeKey)!.relationships.push({
            id: rel.id,
            notes: rel.notes ?? null,
            toPerson: {
              id: rel.toPerson.id,
              firstName: rel.toPerson.firstName,
              lastName: rel.toPerson.lastName,
              imageUrl: rel.toPerson.imageUrl ?? null,
              company: rel.toPerson.company ?? null,
              title: rel.toPerson.title ?? null,
            },
          });
        }
  
        const groups = Array.from(groupsMap.values())
          .filter((g) => g.relationships.length > 0)
          .sort((a, b) => {
            if (b.type.value !== a.type.value) {
              return b.type.value - a.type.value;
            }
            return a.type.name.localeCompare(b.type.name);
          });
  
        // Sort chips within each group alphabetically for stable display.
        for (const group of groups) {
          group.relationships.sort((a, b) => {
            const an = `${a.toPerson.firstName} ${a.toPerson.lastName}`.trim();
            const bn = `${b.toPerson.firstName} ${b.toPerson.lastName}`.trim();
            return an.localeCompare(bn);
          });
        }
  
        res.json({ groups });
      } catch (error) {
        console.error("Error fetching grouped relationships:", error);
        res.status(500).json({ error: "Failed to fetch relationships" });
      }
    });
  
    app.post("/api/relationships", async (req, res) => {
      try {
        const validatedData = insertRelationshipSchema.parse(req.body);
  
        if (validatedData.familyRelationshipType) {
          return res.status(400).json({ error: "Family relationship types must use dedicated family endpoints" });
        }
  
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
  
        const existingRel = await storage.getRelationshipById(id);
        if (!existingRel) {
          return res.status(404).json({ error: "Relationship not found" });
        }
  
        if (validatedData.familyRelationshipType || existingRel.familyRelationshipType) {
          return res.status(400).json({ error: "Family relationships cannot be modified via generic endpoints" });
        }
  
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
  
    app.delete("/api/relationships/family", async (req, res) => {
      try {
        if (!req.isAuthenticated()) {
          return res.status(401).json({ error: "Not authenticated" });
        }
        const count = await storage.deleteAllFamilyRelationships();
        res.json({ success: true, deleted: count });
      } catch (error) {
        console.error("Error deleting all family relationships:", error);
        res.status(500).json({ error: "Failed to delete all family relationships" });
      }
    });
  
    app.delete("/api/relationships/:id", async (req, res) => {
      try {
        const id = req.params.id;

        // Check if this is a family tree synthesized lineage ID
        if (id.endsWith("_p") || id.endsWith("_c")) {
          const actualId = id.slice(0, -2);
          await storage.deleteLineage(actualId);
          return res.json({ success: true });
        }

        // Check if this is a family tree synthesized partnership ID
        if (id.endsWith("_s1") || id.endsWith("_s2")) {
          const actualId = id.slice(0, -3);
          await storage.deletePartnership(actualId);
          return res.json({ success: true });
        }

        const rel = await storage.getRelationshipById(id);
        if (rel && rel.familyRelationshipType) {
          const inverse = await storage.findFamilyRelationship(rel.toPersonId, rel.fromPersonId);
          if (inverse) {
            await storage.deleteRelationship(inverse.id);
          }
        }
        await storage.deleteRelationship(id);
        res.json({ success: true });
      } catch (error) {
        console.error("Error deleting relationship:", error);
        res.status(500).json({ error: "Failed to delete relationship" });
      }
    });
  
    // Get family tree for a person
    app.get("/api/family-tree/:personId", async (req, res) => {
      try {
        const { personId } = req.params;
        const depth = Math.max(1, Math.min(parseInt((req.query.depth as string) ?? "6", 10) || 6, 10));
  
        const person = await storage.getPersonById(personId);
        if (!person) {
          return res.status(404).json({ error: "Person not found" });
        }
  
        const tree = await storage.getFamilyTree(personId, depth);
        res.json({ rootPersonId: personId, ...tree });
      } catch (error) {
        console.error("Error fetching family tree:", error);
        res.status(500).json({ error: "Failed to fetch family tree" });
      }
    });
  
    // Get suggested family connections for a person
    app.get("/api/family-tree/:personId/suggestions", async (req, res) => {
      try {
        const { personId } = req.params;
        const person = await storage.getPersonById(personId);
        if (!person) {
          return res.status(404).json({ error: "Person not found" });
        }
        const suggestions = await storage.getSuggestedFamilyConnections(personId);
        res.json({ suggestions });
      } catch (error) {
        console.error("Error fetching family suggestions:", error);
        res.status(500).json({ error: "Failed to fetch family suggestions" });
      }
    });
  
    // ── Family Tree AI ─────────────────────────────────────────────────────
    // Generate proposed relationship changes from a natural-language prompt.
    app.post("/api/family-tree/ai/generate", async (req, res) => {
      if (!req.isAuthenticated()) return res.status(401).json({ error: "Not authenticated" });
      try {
        const bodySchema = z.object({
          personId: z.string().min(1),
          prompt: z.string().min(1).max(8000),
          allowDeletions: z.boolean().optional(),
          askForChanges: z.boolean().optional(),
        });
        const body = bodySchema.parse(req.body);
  
        const ollamaEnabled = (await getOllamaSetting("ollama_enabled")) === "true";
        if (!ollamaEnabled) return res.status(400).json({ error: "AI is disabled in settings" });
  
        const ctx = await buildOllamaChatContext();
        if (!ctx) return res.status(400).json({ error: "Ollama API URL is not configured" });
  
        const familyTreeModel = ((await getOllamaSetting("ollama_family_tree_model")) ?? "").trim();
        const textModel = ((await getOllamaSetting("ollama_text_model")) ?? "").trim();
        const fallbackModel = ((await getOllamaSetting("ollama_model")) ?? "").trim();
        const model = familyTreeModel || textModel || fallbackModel;
        if (!model) return res.status(400).json({ error: "No AI model configured. Set one at Settings → Intelligence → Family Tree." });
  
        const result = await generateFamilyTreeChanges({
          personId: body.personId,
          prompt: body.prompt,
          allowDeletions: !!body.allowDeletions,
          askForChanges: !!body.askForChanges,
          ollama: ctx,
          model,
        });
        res.json(result);
      } catch (error: any) {
        console.error("Error generating family tree changes:", error);
        res.status(500).json({ error: error?.message ?? "Failed to generate changes" });
      }
    });
  
    // Apply a user-curated subset of changes from the previous step.
    app.post("/api/family-tree/ai/apply", async (req, res) => {
      if (!req.isAuthenticated()) return res.status(401).json({ error: "Not authenticated" });
      try {
        const changes = Array.isArray(req.body?.changes) ? req.body.changes : null;
        if (!changes) return res.status(400).json({ error: "changes must be an array" });
        // Trust the client object shape; applyFamilyTreeChanges re-validates each item.
        const result = await applyFamilyTreeChanges(changes as ProposedFamilyChange[]);
        res.json(result);
      } catch (error: any) {
        console.error("Error applying family tree changes:", error);
        res.status(500).json({ error: error?.message ?? "Failed to apply changes" });
      }
    });
  
    // Find people by last name (for family connection suggestions)
    app.get("/api/people/by-last-name/:lastName", async (req, res) => {
      try {
        const { lastName } = req.params;
        if (!lastName?.trim()) {
          return res.status(400).json({ error: "Last name is required" });
        }
        const found = await storage.getPeopleByLastName(lastName.trim());
        res.json({
          people: found.map(p => ({
            id: p.id,
            firstName: p.firstName,
            lastName: p.lastName,
            avatarUrl: p.imageUrl ?? null,
          })),
        });
      } catch (error) {
        console.error("Error fetching people by last name:", error);
        res.status(500).json({ error: "Failed to fetch people by last name" });
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
        syncEntityInBackground("group", group.id);
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
  
        syncEntityInBackground("group", id);
        res.json(group);
      } catch (error) {
        console.error("Error updating group:", error);
        res.status(400).json({ error: "Failed to update group" });
      }
    });
  
    app.delete("/api/groups/:id", async (req, res) => {
      try {
        const id = req.params.id;
        const [groupRow] = await db.select({ vectorId: groups.vectorId }).from(groups).where(eq(groups.id, id));
        await storage.deleteGroup(id);
        if (groupRow?.vectorId) void deleteEntityVector("group", groupRow.vectorId);
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
          view?: 'person' | 'social';
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
  
        if (settings.view === 'person') {
          const personGraph = await storage.getPersonGraph();
          return res.json(personGraph);
        }
  
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
  
}
