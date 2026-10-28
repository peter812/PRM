// Generated route module - people-groups.ts
import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "../storage";
import { db } from "../db";
import { interactions, relationshipTypes, interactionTypes, people, socialNetworkChanges, socialAccountPosts, socialAccounts, socialAccountHistory, photos, aiChats, dailyNotes, notes, groups, truePersonSearch, socialFollows, tasks, type Task, type SocialAccountWithCurrentProfile, type ExtensionSession, type AiChatMessage, type AiToolCallTrace } from "@shared/schema";
import crypto from "crypto";
import { z } from "zod";
import { eq, sql, isNotNull, and, inArray, desc } from "drizzle-orm";
import { computeFamilyLabels, FAMILY_LABEL_DEPTH } from "../family-relations-helper";
import { getPrimaryAddress } from "../person-addresses";
import { AiConfigError, asData, chat as aiChat, DATA_TAGS_NOTE, resolveModel } from "../ai/provider";
import {
  insertPersonSchema,
  insertSchoolingSchema,
  insertNoteSchema,
  insertInteractionSchema,
  insertInteractionTypeSchema,
  insertRelationshipSchema,
  insertRelationshipTypeSchema,
  insertGroupSchema,
  insertSubGroupSchema,
  insertGroupNoteSchema,
  getRandomSubGroupColor,
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
import { hashPassword, requireAuth } from "../auth";
import { deleteImageFromPrmS3, isPrmS3ImageUrl } from "../prm-s3";
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
import { autoPassInImageForPerson } from "../image-pass-in-utils";
import { getConnectionNetwork } from "../connection-strength";

const scryptAsync = promisify(scrypt);

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

// Flag to track if user creation is allowed (only after database reset)
let isUserCreationAllowed = false;

// NOTE: The global "/api" auth gate (and its PUBLIC_API_PATHS allowlist) lives
// in server/routes/auth-setup.ts, which is registered first and protects every
// /api route in all modules. Do not add a separate allowlist here.

// ── Potential-group explainer prompt ─────────────────────────────────────────

const GROUP_EXPLANATION_SCHEMA = {
  type: "object",
  properties: {
    explanation: { type: "string" },
    suggestedName: { type: "string" },
    outliers: {
      type: "array",
      items: { type: "object", properties: { username: { type: "string" }, reason: { type: "string" } }, required: ["username", "reason"] },
    },
  },
  required: ["explanation", "suggestedName", "outliers"],
};

const GROUP_EXPLAINER_SYSTEM = `You explain why a community-detection algorithm (Louvain) grouped a set of social media accounts together.
The graph combined these signals into weighted edges between accounts:
- mutualFollow: both accounts follow each other (strong, 3.5 per pair)
- oneWayFollow: one follows the other (1.0 per pair)
- coFollow: they follow many of the same accounts (shared audience/interests)
- coMention: they were tagged together in the same posts (2.5 per post)
- bio: their bios share uncommon keywords
Reply as JSON:
- explanation: 2-4 plain sentences on why these accounts form a group. Lead with the signals that carry the most weight and cite concrete evidence (shared follows, keywords, hub accounts). Don't restate raw percentages mechanically.
- suggestedName: a short, human group name (2-5 words) describing what the group likely is (e.g. "Denver climbing crew"). No @handles.
- outliers: for each account listed in weak_members, one short reason it fits the group weakly. Only use usernames from weak_members; return [] if there are none.
${DATA_TAGS_NOTE}`;

function buildGroupExplainerPrompt(group: any): string {
  const s = group.signals;
  const signalLines = Object.keys(s.sharePct)
    .map(sig => `- ${sig}: ${s.sharePct[sig]}% of internal weight (${s.pairCounts[sig]} pairs)`)
    .join("\n");
  const hubs = (group.memberPreviews ?? []).slice(0, 15)
    .map((m: any) => `@${m.username}${m.nickname ? ` (${m.nickname})` : ""}${m.bioSummary ? ` — ${m.bioSummary}` : ""}`)
    .join("\n");
  const follows = s.topSharedFollows.map((f: any) => `@${f.username} (followed by ${f.memberCount} members)`).join("\n") || "(none)";
  const keywords = s.keywordCounts.map((k: any) => `${k.keyword} (${k.memberCount} bios)`).join(", ") || "(none)";
  const pairs = s.topPairs.map((p: any) => `@${p.a} – @${p.b} (weight ${p.weight}, mostly ${p.dominant})`).join("\n") || "(none)";
  const weak = s.weakMembers.map((m: any) => `@${m.username} (${Math.round(m.fit * 100)}% of its connection weight is inside the group)`).join("\n") || "(none)";

  return `Group of ${group.memberCount} accounts, cohesion ${group.cohesionScore}% (share of members' connection weight that stays inside the group).

Signal breakdown:
${signalLines}

Shared bio keywords: ${asData("keywords", keywords)}

${asData("shared_follows", follows)}

Strongest pairs:
${asData("top_pairs", pairs)}

Most-connected members:
${asData("members", hubs)}

${asData("weak_members", weak)}`;
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
        const mePerson = await storage.getMePerson();
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
        const includeTps = req.query.includeTps === '1';
        const starredOnly = req.query.starred === 'true';

        // Get ME person ID to filter relationships
        const mePersonId = (await storage.getMePersonId()) ?? undefined;

        const people = await storage.getPeoplePaginated(offset, limit, mePersonId, sortBy, includeTps, starredOnly);
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

    app.get("/api/political-leaning/next", async (req, res) => {
      try {
        const exclude = String(req.query.exclude ?? "").split(",").filter(Boolean);
        const result = await storage.getRandomPersonWithoutPoliticalLeaning(exclude);
        res.json({ person: result.person ?? null, remainingCount: result.remainingCount });
      } catch (error) {
        console.error("Error picking next person without political leaning:", error);
        res.status(500).json({ error: "Failed to pick next person" });
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
          const meId = await storage.getMePersonId();
          if (meId) {
            // Get all relationships involving the ME user
            const allRelationships = await storage.getAllRelationships();
            const meRelationships = allRelationships.filter(
              rel => rel.fromPersonId === meId || rel.toPersonId === meId
            );
            const connectedPersonIds = new Set(
              meRelationships.map(rel => 
                rel.fromPersonId === meId ? rel.toPersonId : rel.fromPersonId
              )
            );
            
            people = people.filter(p => connectedPersonIds.has(p.id));
          }
        }
  
        res.json(people.map(p => ({
          id: p.id,
          uuid: p.id,
          name: `${p.firstName} ${p.lastName}`.trim(),
          firstName: p.firstName,
          lastName: p.lastName,
          imageUrl: p.imageUrl,
          title: p.title,
        })));
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
  
        res.json({ ...person, primaryAddress: await getPrimaryAddress(id) });
      } catch (error) {
        console.error("Error fetching person:", error);
        res.status(500).json({ error: "Failed to fetch person" });
      }
    });

    // TrueDB (TruePeopleSearch) records linked to this person, or empty array if none.
    app.get("/api/people/:id/true-person-search", async (req, res) => {
      try {
        const personId = req.params.id;
        const person = await storage.getPersonById(personId);
        
        let records = await db
          .select()
          .from(truePersonSearch)
          .where(eq(truePersonSearch.personId, personId))
          .orderBy(desc(truePersonSearch.importDate));

        if (records.length === 0 && person?.tpsId) {
          records = await db
            .select()
            .from(truePersonSearch)
            .where(eq(truePersonSearch.tpsId, person.tpsId))
            .orderBy(desc(truePersonSearch.importDate));
        }

        res.json(records);
      } catch (error) {
        console.error("Error fetching TrueDB entries:", error);
        res.status(500).json({ error: "Failed to fetch TrueDB entries" });
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
        const { schooling: schoolingData, ...personBody } = req.body;
        const validatedData = insertPersonSchema.parse(personBody);
        
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
        
        let person = await storage.createPerson(validatedData);
        // The create dialog uploads before the person exists; claim that upload
        // so the person page's "Choose image" dialog lists it as theirs.
        if (person.imageUrl) {
          await db.update(photos)
            .set({ prmLocation: `person_image:${person.id}` })
            .where(and(eq(photos.location, person.imageUrl), eq(photos.prmLocation, "unknown")));
        }
        
        if (schoolingData) {
          const validatedSchooling = insertSchoolingSchema.omit({ personId: true }).partial().parse(schoolingData);
          await storage.upsertSchooling({
            personId: person.id,
            highSchool: validatedSchooling.highSchool ?? null,
            colleges: validatedSchooling.colleges ?? [],
            additionalSchooling: validatedSchooling.additionalSchooling ?? [],
          });
        }

        if (validatedData.socialAccountUuids && validatedData.socialAccountUuids.length > 0) {
          await autoPassInImageForPerson(person.id);
        }
        
        const finalPerson = await storage.getPersonById(person.id) || person;
        res.status(201).json(finalPerson);
      } catch (error) {
        console.error("Error creating person:", error);
        res.status(400).json({ error: "Failed to create person" });
      }
    });
  
    app.patch("/api/people/:id", async (req, res) => {
      try {
        const id = req.params.id;
        const { schooling: schoolingData, ...personBody } = req.body;
        const validatedData = insertPersonSchema.partial().parse(personBody);

        // Auto-manage politicalUpdatedAt if political coordinates are touched
        if (personBody.politicalLeftRight !== undefined || personBody.politicalLibAuth !== undefined) {
          if (validatedData.politicalLeftRight === null && validatedData.politicalLibAuth === null) {
            validatedData.politicalUpdatedAt = null;
          } else if (validatedData.politicalUpdatedAt === undefined) {
            validatedData.politicalUpdatedAt = new Date();
          }
        }

        const person = await storage.updatePerson(id, validatedData);
  
        if (!person) {
          return res.status(404).json({ error: "Person not found" });
        }
  
        if (schoolingData) {
          const validatedSchooling = insertSchoolingSchema.omit({ personId: true }).partial().parse(schoolingData);
          await storage.upsertSchooling({
            personId: id,
            highSchool: validatedSchooling.highSchool ?? null,
            colleges: validatedSchooling.colleges ?? [],
            additionalSchooling: validatedSchooling.additionalSchooling ?? [],
          });
        }

        let finalPerson = await storage.getPersonById(id) || person;
        if (!finalPerson.imageUrl && validatedData.socialAccountUuids) {
          const didPass = await autoPassInImageForPerson(id);
          if (didPass) {
            finalPerson = await storage.getPersonById(id) || finalPerson;
          }
        }
  
        res.json(finalPerson);
      } catch (error) {
        console.error("Error updating person:", error);
        res.status(400).json({ error: "Failed to update person" });
      }
    });
  
    // What the person page's "Choose image" dialog offers: the user's own uploads
    // (deletable), then each linked account's current and past profile pictures.
    app.get("/api/people/:id/image-options", async (req, res) => {
      try {
        const person = await storage.getPersonById(req.params.id);
        if (!person) return res.status(404).json({ error: "Person not found" });
        const accountIds = person.socialAccountUuids ?? [];
        const [uploads, accounts, history] = await Promise.all([
          db.select({ id: photos.id, location: photos.location }).from(photos)
            .where(eq(photos.prmLocation, `person_image:${person.id}`))
            .orderBy(desc(photos.uploadedAt)),
          accountIds.length
            ? db.select({ id: socialAccounts.id, username: socialAccounts.username, imageUrl: socialAccounts.imageUrl })
                .from(socialAccounts).where(inArray(socialAccounts.id, accountIds))
            : [],
          accountIds.length
            ? db.select({ accountId: socialAccountHistory.socialAccountId, url: socialAccountHistory.previousImageUrl, date: socialAccountHistory.detectedAt })
                .from(socialAccountHistory)
                .where(and(inArray(socialAccountHistory.socialAccountId, accountIds), isNotNull(socialAccountHistory.previousImageUrl)))
                .orderBy(desc(socialAccountHistory.detectedAt))
            : [],
        ]);
        const usernames = new Map(accounts.map(a => [a.id, a.username]));
        const options: { url: string; source: "upload" | "current" | "previous"; photoId?: string; username?: string; date?: Date }[] = [];
        const seen = new Set<string>();
        const add = (o: (typeof options)[number]) => {
          if (!seen.has(o.url)) { seen.add(o.url); options.push(o); }
        };
        for (const p of uploads) add({ url: p.location, source: "upload", photoId: p.id });
        for (const a of accounts) if (a.imageUrl) add({ url: a.imageUrl, source: "current", username: a.username });
        for (const h of history) add({ url: h.url!, source: "previous", username: usernames.get(h.accountId), date: h.date });
        res.json(options);
      } catch (error) {
        console.error("Error fetching image options:", error);
        res.status(500).json({ error: "Failed to fetch image options" });
      }
    });

    app.delete("/api/people/created-past-24-hours", requireAuth, async (req, res) => {
      try {
        const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
        const result = await storage.deletePeopleCreatedSince(cutoff);
        res.json({ success: true, deleted: result.deleted });
      } catch (error) {
        console.error("Error deleting people created in past 24 hours:", error);
        res.status(500).json({ error: "Failed to delete people created in past 24 hours" });
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
        
        // Otherwise, get all notes across all people with a single SQL query
        const noteRows = await db
          .select({
            note: notes,
            firstName: people.firstName,
            lastName: people.lastName,
          })
          .from(notes)
          .innerJoin(people, eq(notes.personId, people.id))
          .orderBy(desc(notes.createdAt));

        const allNotes = noteRows.map(({ note, firstName, lastName }) => ({
          ...note,
          personId: note.personId,
          personName: `${firstName} ${lastName}`.trim(),
        }));

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
        
        // Get all interactions visible to user
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
        const interaction = await storage.createInteraction({
          ...validatedData,
        });
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
        
        // Delete image from PRM-S3 if it exists and is stored in PRM-S3
        if (interaction?.imageUrl && isPrmS3ImageUrl(interaction.imageUrl)) {
          try {
            await deleteImageFromPrmS3(interaction.imageUrl);
          } catch (error) {
            console.error("Error deleting interaction image from PRM-S3:", error);
            // Continue with deletion even if PRM-S3 deletion fails
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
          .filter((g) => g.relationships.length > 0);

        // Dynamically fetch and label family relationships
        try {
          const familyTree = await storage.getFamilyTree(personId, FAMILY_LABEL_DEPTH);
          const familyLabels = computeFamilyLabels(personId, familyTree);
          
          if (familyLabels.size > 0) {
            const familyRelationships = [];
            for (const [id, label] of familyLabels.entries()) {
              const fp = familyTree.people.find(p => p.id === id);
              if (!fp) continue;
              familyRelationships.push({
                id: `family_${id}`,
                notes: label,
                relationshipLabel: label,
                toPerson: {
                  id: fp.id,
                  firstName: fp.firstName,
                  lastName: fp.lastName ?? "",
                  imageUrl: fp.avatarUrl,
                  company: null,
                  title: null,
                },
              });
            }
            if (familyRelationships.length > 0) {
              groups.push({
                type: {
                  id: "family",
                  name: "Family",
                  color: "#ef4444",
                  value: 90,
                },
                relationships: familyRelationships,
              });
            }
          }
        } catch (err) {
          console.error("Error computing dynamic family relationships for grouped response:", err);
        }

        groups.sort((a, b) => {
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
  
        const relationship = await storage.createRelationship({
          ...validatedData,
        });
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
  
    // Totals shown on the homepage
    app.get("/api/home-counts", async (_req, res) => {
      try {
        const [[g], [sa]] = await Promise.all([
          db.select({ count: sql<number>`count(*)::int` }).from(groups),
          db.select({ count: sql<number>`count(*)::int` }).from(socialAccounts),
        ]);
        res.json({ groups: g.count, socialAccounts: sa.count });
      } catch (error) {
        console.error("Error fetching home counts:", error);
        res.status(500).json({ error: "Failed to fetch home counts" });
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

    app.get("/api/groups/:id/social-accounts", async (req, res) => {
      try {
        const id = req.params.id;
        const group = await storage.getGroupById(id);
        if (!group) {
          return res.status(404).json({ error: "Group not found" });
        }
        const accounts = await storage.getSocialAccountsByGroup(id);
        res.json(accounts);
      } catch (error) {
        console.error("Error fetching group social accounts:", error);
        res.status(500).json({ error: "Failed to fetch group social accounts" });
      }
    });
  
    app.post("/api/groups", async (req, res) => {
      try {
        const validatedData = insertGroupSchema.parse(req.body);
        const group = await storage.createGroup({
          ...validatedData,
        });
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

    // Sub groups endpoints
    app.get("/api/subgroups", async (req, res) => {
      try {
        const subGroupsList = await storage.getAllSubGroups();
        res.json(subGroupsList);
      } catch (error) {
        console.error("Error fetching all sub groups:", error);
        res.status(500).json({ error: "Failed to fetch sub groups" });
      }
    });

    app.get("/api/groups/:id/subgroups", async (req, res) => {
      try {
        const { id } = req.params;
        const subGroupsList = await storage.getSubGroupsByGroupId(id);
        res.json(subGroupsList);
      } catch (error) {
        console.error("Error fetching sub groups:", error);
        res.status(500).json({ error: "Failed to fetch sub groups" });
      }
    });

    app.post("/api/groups/:id/subgroups", async (req, res) => {
      try {
        const groupId = req.params.id;
        const parentGroup = await storage.getGroupById(groupId);
        if (!parentGroup) {
          return res.status(404).json({ error: "Group not found" });
        }
        const data = {
          ...req.body,
          groupId,
          color: req.body.color || getRandomSubGroupColor(),
        };
        const validatedData = insertSubGroupSchema.parse(data);
        const subGroup = await storage.createSubGroup(validatedData);
        res.status(201).json(subGroup);
      } catch (error) {
        console.error("Error creating sub group:", error);
        res.status(400).json({ error: "Failed to create sub group" });
      }
    });

    app.get("/api/subgroups/:id", async (req, res) => {
      try {
        const { id } = req.params;
        const subGroup = await storage.getSubGroupById(id);
        if (!subGroup) {
          return res.status(404).json({ error: "Sub group not found" });
        }
        res.json(subGroup);
      } catch (error) {
        console.error("Error fetching sub group:", error);
        res.status(500).json({ error: "Failed to fetch sub group" });
      }
    });

    app.patch("/api/subgroups/:id", async (req, res) => {
      try {
        const { id } = req.params;
        const validatedData = insertSubGroupSchema.partial().parse(req.body);
        const subGroup = await storage.updateSubGroup(id, validatedData);
        if (!subGroup) {
          return res.status(404).json({ error: "Sub group not found" });
        }
        res.json(subGroup);
      } catch (error) {
        console.error("Error updating sub group:", error);
        res.status(400).json({ error: "Failed to update sub group" });
      }
    });

    app.delete("/api/subgroups/:id", async (req, res) => {
      try {
        const { id } = req.params;
        await storage.deleteSubGroup(id);
        res.json({ success: true });
      } catch (error) {
        console.error("Error deleting sub group:", error);
        res.status(500).json({ error: "Failed to delete sub group" });
      }
    });

    app.get("/api/people/:id/subgroups", async (req, res) => {
      try {
        const { id } = req.params;
        const subGroupsList = await storage.getSubGroupsByPersonId(id);
        res.json(subGroupsList);
      } catch (error) {
        console.error("Error fetching person sub groups:", error);
        res.status(500).json({ error: "Failed to fetch person sub groups" });
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
          /** 'connections' draws who interacts (connection-strength-plan.md) instead of who follows. */
          edges?: 'follows' | 'connections';
          hideOrphans?: boolean;
          minConnections?: number;
          /** Connections view: drop pairs whose combined score is below this. */
          minConnectionStrength?: number;
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
  
        // Filtered before the graph is built, so orphans and minimum-connection
        // counts are judged on the links that will actually be drawn.
        const minStrength = settings.minConnectionStrength ?? 0;
        const connectionPairs = settings.edges === 'connections'
          ? (await getConnectionNetwork()).filter((p) => p.ab + p.ba >= minStrength)
          : undefined;

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
        }, connectionPairs);
  
        res.json(graphData);
      } catch (error) {
        console.error("Error computing social graph:", error);
        res.status(500).json({ error: "Failed to compute social graph" });
      }
    });

    // Recalculate crowd endpoint
    app.post("/api/groups/:id/calculate-crowd", async (req, res) => {
      try {
        const { id } = req.params;
        const group = await storage.getGroupById(id);
        if (!group) {
          return res.status(404).json({ error: "Group not found" });
        }
        if (!group.centerAccountId) {
          return res.status(400).json({ error: "No center account associated with this group." });
        }
        const task = await storage.createTask({
          type: "calculate_crowd",
          status: "pending",
          title: `Crowd for ${group.name}`,
          payload: JSON.stringify({ groupId: id }),
        });
        triggerTaskWorker();
        res.json({ taskId: task.id });
      } catch (error) {
        console.error("Error queueing crowd calculation:", error);
        res.status(500).json({ error: "Failed to queue crowd calculation" });
      }
    });

    // Get crowd members details and connection strength
    app.get("/api/groups/:id/crowd", async (req, res) => {
      try {
        const { id } = req.params;
        const group = await storage.getGroupById(id);
        if (!group) {
          return res.status(404).json({ error: "Group not found" });
        }
        
        const crowdMembers = group.crowdMembers || [];
        if (crowdMembers.length === 0 || !group.centerAccountId) {
          return res.json([]);
        }

        const F_center = new Set(await storage.getFollowerIds(group.centerAccountId));

        const crowdMode = group.crowdMode || "social_accounts";

        if (crowdMode === "social_accounts") {
          const accounts = await storage.getSocialAccountsByIds(crowdMembers);
          if (accounts.length === 0) {
            return res.json([]);
          }

          const memberSaIds = accounts.map(a => a.id);
          const followingMap = new Map<string, Set<string>>();
          const groupFollows = await db
            .select({ followerId: socialFollows.followerId, followedId: socialFollows.followedId })
            .from(socialFollows)
            .where(inArray(socialFollows.followerId, memberSaIds));
          for (const edge of groupFollows) {
            let followed = followingMap.get(edge.followerId);
            if (!followed) { followed = new Set(); followingMap.set(edge.followerId, followed); }
            followed.add(edge.followedId);
          }

          // Fetch owner people if linked
          const ownerIds = accounts.map(a => a.ownerUuid).filter(Boolean) as string[];
          const ownerPeopleMap = new Map<string, { id: string; firstName: string; lastName: string }>();
          if (ownerIds.length > 0) {
            const ownerPeople = await db.select().from(people).where(inArray(people.id, ownerIds));
            for (const op of ownerPeople) {
              ownerPeopleMap.set(op.id, { id: op.id, firstName: op.firstName, lastName: op.lastName });
            }
          }

          const results = accounts.map(a => {
            const followed = followingMap.get(a.id) || new Set<string>();
            let intersectionCount = 0;
            for (const f of F_center) {
              if (followed.has(f)) {
                intersectionCount++;
              }
            }

            const owner = a.ownerUuid ? ownerPeopleMap.get(a.ownerUuid) : null;

            return {
              id: a.id,
              entityType: "social_account" as const,
              username: a.username,
              platform: a.typeId || "Instagram",
              nickname: a.currentProfile?.nickname || null,
              imageUrl: a.currentProfile?.imageUrl || null,
              connectionStrength: intersectionCount,
              ownerPersonId: owner ? owner.id : null,
              ownerPersonName: owner ? `${owner.firstName} ${owner.lastName}` : null
            };
          });

          results.sort((a, b) => b.connectionStrength - a.connectionStrength);
          return res.json(results);
        }

        // Mode: person_profiles (legacy)
        const peopleList = await db.select().from(people).where(inArray(people.id, crowdMembers));
        const allSocialAccounts = await db.select().from(socialAccounts).where(inArray(socialAccounts.ownerUuid, crowdMembers));
        const memberSaIds = allSocialAccounts.map(sa => sa.id);
        const followingMap = new Map<string, Set<string>>();
        if (memberSaIds.length > 0) {
          const groupFollows = await db
            .select({ followerId: socialFollows.followerId, followedId: socialFollows.followedId })
            .from(socialFollows)
            .where(inArray(socialFollows.followerId, memberSaIds));
          for (const edge of groupFollows) {
            let followed = followingMap.get(edge.followerId);
            if (!followed) { followed = new Set(); followingMap.set(edge.followerId, followed); }
            followed.add(edge.followedId);
          }
        }

        const personSocialAccountsMap = new Map<string, string[]>();
        for (const sa of allSocialAccounts) {
          if (sa.ownerUuid) {
            if (!personSocialAccountsMap.has(sa.ownerUuid)) {
              personSocialAccountsMap.set(sa.ownerUuid, []);
            }
            personSocialAccountsMap.get(sa.ownerUuid)!.push(sa.id);
          }
        }

        const results = peopleList.map(p => {
          const saIds = personSocialAccountsMap.get(p.id) || [];
          const Following_P = new Set<string>();
          for (const saId of saIds) {
            const followed = followingMap.get(saId);
            if (followed) {
              for (const f of followed) {
                Following_P.add(f);
              }
            }
          }

          let intersectionCount = 0;
          for (const f of F_center) {
            if (Following_P.has(f)) {
              intersectionCount++;
            }
          }

          return {
            id: p.id,
            entityType: "person" as const,
            firstName: p.firstName,
            lastName: p.lastName,
            imageUrl: p.imageUrl,
            company: p.company,
            title: p.title,
            connectionStrength: intersectionCount
          };
        });

        results.sort((a, b) => b.connectionStrength - a.connectionStrength);
        res.json(results);
      } catch (error) {
        console.error("Error fetching group crowd details:", error);
        res.status(500).json({ error: "Failed to fetch group crowd details" });
      }
    });

    // Start connection analysis to find potential groups
    app.post("/api/potential-groups/analyze", async (req, res) => {
      try {
        const settings = req.body as {
          entityType: "people" | "social_accounts";
          strategy?: "hybrid" | "co_following" | "network_modularity" | "bio_keywords";
          minGroupSize?: number;
          maxGroupSize?: number;
          resolution?: number;
          minCohesion?: number;
          minDensityMultiplier?: number;
          linkDefinition?: "any" | "mutual" | "family";
          minPersonalConnections?: number;
        };
        if (!settings.entityType) {
          return res.status(400).json({ error: "entityType is required." });
        }
        settings.linkDefinition = settings.linkDefinition || "any";
        settings.strategy = settings.strategy || "hybrid";

        const task = await storage.createTask({
          type: "find_potential_groups",
          status: "pending",
          title: `Community detection: ${settings.entityType} (${settings.strategy})`,
          payload: JSON.stringify(settings),
        });
        triggerTaskWorker();
        res.json({ taskId: task.id });
      } catch (error) {
        console.error("Error queueing community detection:", error);
        res.status(500).json({ error: "Failed to queue community detection" });
      }
    });

    const toAnalysisResponse = (task: Task) => {
      let results = [];
      if (task.status === "completed" && task.result) {
        try {
          results = JSON.parse(task.result);
        } catch (e) {
          console.error("Error parsing task result:", e);
        }
      }
      return {
        taskId: task.id,
        status: task.status,
        progress: task.progress,
        progressMessage: task.progressMessage,
        settings: JSON.parse(task.payload),
        completedAt: task.completedAt,
        results,
      };
    };

    // Check task status & fetch community detection results
    app.get("/api/potential-groups/results/:taskId", async (req, res) => {
      try {
        const task = await storage.getTaskById(req.params.taskId);
        if (!task) {
          return res.status(404).json({ error: "Task not found" });
        }
        res.json(toAnalysisResponse(task));
      } catch (error) {
        console.error("Error fetching analysis results:", error);
        res.status(500).json({ error: "Failed to fetch analysis results" });
      }
    });

    // Most recent run (any status), so the page can restore it after a reload
    app.get("/api/potential-groups/latest", async (_req, res) => {
      try {
        const task = await storage.getLatestTaskByType("find_potential_groups");
        res.json(task ? toAnalysisResponse(task) : null);
      } catch (error) {
        console.error("Error fetching latest analysis:", error);
        res.status(500).json({ error: "Failed to fetch latest analysis" });
      }
    });

    // Read-modify-write one group inside a run's stored results. Re-reads right
    // before writing so concurrent updates to other groups aren't clobbered.
    const loadResultGroups = async (taskId: string) => {
      const task = await storage.getTaskById(taskId);
      return task?.result ? (JSON.parse(task.result) as any[]) : null;
    };
    const patchResultGroup = async (taskId: string, groupId: string, patch: Record<string, unknown>) => {
      const latest = await loadResultGroups(taskId);
      const target = latest?.find(g => g.id === groupId);
      if (!latest || !target) return;
      Object.assign(target, patch);
      await db.update(tasks).set({ result: JSON.stringify(latest) }).where(eq(tasks.id, taskId));
    };

    // Explain why a Smart Multi-Signal group clustered, from its recorded signals.
    // Generated on demand and saved back into the task result; ?regenerate=1 forces a new one.
    app.post("/api/potential-groups/results/:taskId/explain/:groupId", async (req, res) => {
      try {
        const { taskId, groupId } = req.params;
        const results = await loadResultGroups(taskId);
        const group = results?.find(g => g.id === groupId);
        if (!group) return res.status(404).json({ error: "Group not found" });
        if (!group.signals) return res.status(400).json({ error: "Explanations are only available for Smart Multi-Signal groups." });
        if (group.explanation && req.query.regenerate !== "1") return res.json(group.explanation);

        const resolved = await resolveModel("text");
        const { content } = await aiChat(resolved, {
          think: false,
          format: GROUP_EXPLANATION_SCHEMA,
          messages: [
            { role: "system", content: GROUP_EXPLAINER_SYSTEM },
            { role: "user", content: buildGroupExplainerPrompt(group) },
          ],
          signal: AbortSignal.timeout(120_000),
        });

        const parsed = JSON.parse(content || "{}");
        const weak = new Map<string, string>(group.signals.weakMembers.map((m: any) => [m.username.toLowerCase(), m.id]));
        const explanation = {
          explanation: String(parsed.explanation ?? "").trim(),
          suggestedName: String(parsed.suggestedName ?? "").trim().slice(0, 80),
          outliers: (Array.isArray(parsed.outliers) ? parsed.outliers : [])
            .map((o: any) => ({ username: String(o?.username ?? "").replace(/^@/, ""), reason: String(o?.reason ?? "").trim() }))
            .filter((o: any) => weak.has(o.username.toLowerCase()))
            .map((o: any) => ({ ...o, id: weak.get(o.username.toLowerCase())! })),
          model: resolved.model,
          generatedAt: new Date().toISOString(),
        };

        await patchResultGroup(taskId, groupId, { explanation });
        res.json(explanation);
      } catch (error: any) {
        console.error("Error explaining potential group:", error);
        if (error instanceof AiConfigError) return res.status(400).json({ error: error.message });
        res.status(500).json({ error: error?.message || "Failed to explain group" });
      }
    });

    // Resolve the selected member IDs into (person ids, social account ids).
    // For social accounts the linked owner is what goes in group/sub group members.
    const resolveMembers = async (members: string[], isSocial: boolean) => {
      if (!isSocial) return { personIds: members, accountIds: [] as string[] };
      if (members.length === 0) return { personIds: [] as string[], accountIds: [] as string[] };
      const linkedRows = await db
        .select({ ownerUuid: socialAccounts.ownerUuid })
        .from(socialAccounts)
        .where(inArray(socialAccounts.id, members));
      const personIds = Array.from(new Set(
        linkedRows.map((r) => r.ownerUuid).filter((id): id is string => Boolean(id))
      ));
      return { personIds, accountIds: members };
    };

    // Point the social accounts at the group (a social account belongs to one group).
    const linkAccountsToGroup = async (groupId: string, accountIds: string[]) => {
      if (accountIds.length === 0) return;
      await db
        .update(socialAccounts)
        .set({ groupId })
        .where(inArray(socialAccounts.id, accountIds));
    };

    const union = (a: string[] | null | undefined, b: string[]) => Array.from(new Set([...(a || []), ...b]));

    // Remember on the stored run which group a cluster went to, so it shows as accepted after a reload.
    type AcceptSource = { taskId?: string; resultId?: string };
    const markAccepted = async ({ taskId, resultId }: AcceptSource, accepted: { groupId: string; subGroupId?: string; name: string }) => {
      if (!taskId || !resultId) return;
      await patchResultGroup(taskId, resultId, { accepted: { ...accepted, at: new Date().toISOString() } });
    };

    // Promote potential group to actual group
    app.post("/api/potential-groups/create", async (req, res) => {
      try {
        const { name, color, members, entityType, taskId, resultId } = req.body as AcceptSource & {
          name: string;
          color: string;
          members: string[];
          entityType?: "people" | "social_accounts";
        };
        if (!name || !color) {
          return res.status(400).json({ error: "Name and color are required." });
        }

        const isSocial = entityType === "social_accounts";
        const { personIds, accountIds } = await resolveMembers(members || [], isSocial);

        const group = await storage.createGroup({
          name,
          color,
          members: personIds,
          crowdMembers: accountIds,
        });

        await linkAccountsToGroup(group.id, accountIds);
        await markAccepted({ taskId, resultId }, { groupId: group.id, name });

        res.json({ success: true, groupId: group.id });
      } catch (error) {
        console.error("Error creating group from analysis:", error);
        res.status(500).json({ error: "Failed to create group" });
      }
    });

    // Add a potential group's members to an existing group, optionally into a
    // sub group (existing by id, or a new one by name).
    app.post("/api/potential-groups/assign", async (req, res) => {
      try {
        const { groupId, subGroupId, newSubGroupName, members, entityType, taskId, resultId } = req.body as AcceptSource & {
          groupId: string;
          subGroupId?: string;
          newSubGroupName?: string;
          members: string[];
          entityType?: "people" | "social_accounts";
        };
        if (!groupId) {
          return res.status(400).json({ error: "Group is required." });
        }
        const group = await storage.getGroupById(groupId);
        if (!group) {
          return res.status(404).json({ error: "Group not found" });
        }

        const isSocial = entityType === "social_accounts";
        const { personIds, accountIds } = await resolveMembers(members || [], isSocial);

        await storage.updateGroup(groupId, {
          members: union(group.members, personIds),
          crowdMembers: union(group.crowdMembers, accountIds),
        });
        await linkAccountsToGroup(groupId, accountIds);

        let resultSubGroupId: string | undefined;
        let acceptedName = group.name;
        if (subGroupId) {
          const subGroup = await storage.getSubGroupById(subGroupId);
          if (!subGroup || subGroup.groupId !== groupId) {
            return res.status(404).json({ error: "Sub group not found in this group" });
          }
          await storage.updateSubGroup(subGroupId, { members: union(subGroup.members, personIds) });
          resultSubGroupId = subGroupId;
          acceptedName = `${group.name} / ${subGroup.name}`;
        } else if (newSubGroupName?.trim()) {
          const subGroup = await storage.createSubGroup({
            groupId,
            name: newSubGroupName.trim(),
            color: getRandomSubGroupColor(),
            members: personIds,
          });
          resultSubGroupId = subGroup.id;
          acceptedName = `${group.name} / ${subGroup.name}`;
        }
        await markAccepted({ taskId, resultId }, { groupId, subGroupId: resultSubGroupId, name: acceptedName });

        res.json({ success: true, groupId, subGroupId: resultSubGroupId });
      } catch (error) {
        console.error("Error assigning potential group:", error);
        res.status(500).json({ error: "Failed to add members to group" });
      }
    });

}
