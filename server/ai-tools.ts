/**
 * AI Tools Registry
 * -----------------
 * Single source of truth for the "skills" that the chat LLM can call. Each
 * entry drives:
 *   - the JSON schema sent to Ollama in the `tools: [...]` array
 *   - the icon + label rendered in the chat UI (icon-box above "Thinking")
 *   - the row shown in the Intelligence → Tools settings page
 *
 * Adding a new tool = one object literal here plus the matching handler.
 *
 * Handlers reuse the existing `storage` layer so we don't add new DB queries.
 * Each handler returns a small JSON-serializable payload (top-N results,
 * trimmed fields) so the model isn't overwhelmed and token cost stays low.
 */

import { db } from "./db";
import { storage } from "./storage";
import { interactions, interactionTypes, FAMILY_RELATIONSHIP_TYPES, FAMILY_RELATIONSHIP_LABELS, FAMILY_RELATIONSHIP_CATEGORIES, FAMILY_RELATIONSHIP_INVERSES, messages, people, socialAccounts, conversations } from "@shared/schema";
import { eq, and, sql } from "drizzle-orm";
import { searchUniversal } from "./vector-universal";
import { searchAppKnowledge } from "./vector-app-knowledge";
import { computeFamilyLabels } from "./family-relations-helper";


export type AiToolIcon =
  | "search"
  | "user"
  | "user-search"
  | "user-plus"
  | "user-pen"
  | "at-sign"
  | "at-sign-search"
  | "book"
  | "book-plus"
  | "notebook"
  | "notebook-pen"
  | "message-square"
  | "message-square-plus"
  | "pencil";

/**
 * High-level grouping shown in the Intelligence → Tools settings page. The
 * settings page renders one expandable card per category. Adding a new
 * category here requires adding a label in the settings page's
 * `CATEGORY_LABELS` map.
 */
export type AiToolCategory =
  | "people"
  | "notes"
  | "interactions"
  | "daily-notes"
  | "social-accounts"
  | "relationships"
  | "search"
  | "messages";

export interface AiToolJsonSchema {
  type: "object";
  properties: Record<string, unknown>;
  required?: string[];
}

export interface AiToolDefinition {
  /** Stable id sent to the LLM and stored as the tool key. */
  name: string;
  /** Human-readable label used in the settings page and chat tooltips. */
  label: string;
  /** Description sent to the LLM to help it decide when to call the tool. */
  description: string;
  /** Icon key the client maps to a Lucide icon. */
  icon: AiToolIcon;
  /**
   * High-level grouping for the settings page. Tools sharing a category
   * appear together inside a single expandable card.
   */
  category: AiToolCategory;
  /**
   * `true` if the tool mutates PRM data (create / update / delete). Write
   * tools are gated by the AI-tools execution mode (off / auth / open) and
   * require user approval when running in `auth` mode.
   */
  write?: boolean;
  /** JSON-schema for the arguments the LLM must produce. */
  parameters: AiToolJsonSchema;
  /** Async handler that performs the work and returns a small JSON payload. */
  handler: (args: Record<string, unknown>, ctx: AiToolContext) => Promise<AiToolResult>;
}

export interface AiToolContext {
  userId: number;
}

export interface AiToolResult {
  /** Short one-line summary shown in the UI. */
  summary: string;
  /** Full payload sent back to the LLM as the tool message content. */
  data: unknown;
}

/** Maximum number of results a search tool may return. Keeps prompts small. */
const MAX_SEARCH_RESULTS = 10;

function asString(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function trimPerson(p: any) {
  return {
    uuid: p.id,
    firstName: p.firstName ?? null,
    lastName: p.lastName ?? null,
    email: p.email ?? null,
    phone: p.phone ?? null,
    company: p.company ?? null,
    title: p.title ?? null,
    sex: p.sex ?? null,
    createdAt: p.createdAt ?? null,
  };
}

function trimSocialAccount(a: any) {
  const profile = a.currentProfile ?? {};
  const state = a.latestState ?? {};
  return {
    uuid: a.id,
    handle: profile.handle ?? a.username ?? null,
    displayName: profile.nickname ?? null,
    ownerUuid: a.ownerUuid ?? null,
    typeId: a.typeId ?? null,
    bio: profile.bio ? String(profile.bio).slice(0, 280) : null,
    accountUrl: profile.accountUrl ?? null,
    followerCount: state.followerCount ?? null,
    followingCount: state.followingCount ?? null,
    accountCreatedAt: a.internalAccountCreationDate ?? a.createdAt ?? null,
  };
}

function trimNote(n: any) {
  return {
    uuid: n.id,
    personId: n.personId ?? null,
    title: n.title ?? null,
    content: n.content ? String(n.content).slice(0, 500) : null,
    createdAt: n.createdAt ?? null,
  };
}

function trimDailyNote(n: any) {
  return {
    uuid: n.id,
    date: n.date ?? null,
    title: n.title ?? null,
    body: n.body ? String(n.body).slice(0, 800) : null,
  };
}

function trimInteraction(i: any) {
  return {
    uuid: i.id,
    typeId: i.typeId ?? null,
    typeName: i.type?.name ?? null,
    date: i.date ?? null,
    description: i.description ? String(i.description).slice(0, 400) : null,
    peopleIds: i.peopleIds ?? [],
    groupIds: i.groupIds ?? [],
  };
}

function trimRelationship(r: any) {
  return {
    uuid: r.id,
    fromPersonId: r.fromPersonId ?? null,
    toPersonId: r.toPersonId ?? null,
    typeId: r.typeId ?? null,
    typeName: r.type?.name ?? null,
    familyRelationshipType: r.familyRelationshipType ?? null,
    notes: r.notes ? String(r.notes).slice(0, 300) : null,
    relatedPersonName: r.toPerson
      ? `${r.toPerson.firstName ?? ""} ${r.toPerson.lastName ?? ""}`.trim()
      : null,
  };
}

function matchesQuery(haystack: string | null | undefined, q: string): boolean {
  if (!haystack) return false;
  return haystack.toLowerCase().includes(q.toLowerCase());
}

export const AI_TOOLS: AiToolDefinition[] = [
  {
    name: "person_search",
    label: "Person search",
    icon: "search",
    category: "people",
    description:
      "Search for people in the user's PRM by first name, last name, full name, email, company, or tags. Returns up to 10 matching people with their UUIDs. Supports full name queries like 'John Smith'. Use this when the user asks about a person but you don't yet know their UUID.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Free-text search query. Can be a first name, last name, full name (e.g. 'John Smith'), email, or company." },
      },
      required: ["query"],
    },
    handler: async (args) => {
      const query = asString(args.query).trim();
      if (!query) return { summary: "Empty query", data: { results: [] } };
      const people = await storage.getAllPeople(query);
      const results = people.slice(0, MAX_SEARCH_RESULTS).map(trimPerson);
      return { summary: `Found ${results.length} ${results.length === 1 ? "person" : "people"}`, data: { results } };
    },
  },
  {
    name: "person_pull",
    label: "Pull person account",
    icon: "user",
    category: "people",
    description:
      "Fetch a single person's full account by UUID, including their profile info, notes, interactions, relationships, and owned social accounts. Call this after person_search if you need the complete record. For partial data, use person_pull_flow or person_pull_relationships instead.",
    parameters: {
      type: "object",
      properties: {
        uuid: { type: "string", description: "UUID of the person to pull." },
      },
      required: ["uuid"],
    },
    handler: async (args) => {
      const uuid = asString(args.uuid).trim();
      if (!uuid) return { summary: "Missing UUID", data: { error: "uuid is required" } };
      const person = await storage.getPersonById(uuid);
      if (!person) return { summary: "Person not found", data: { error: "not_found" } };
      const ownedSocialAccounts = await storage.getSocialAccountsByOwner(uuid);
      return {
        summary: `Pulled ${person.firstName ?? ""} ${person.lastName ?? ""}`.trim() || "Pulled person",
        data: {
          ...trimPerson(person),
          notes: (person.notes ?? []).slice(0, 10).map(trimNote),
          interactions: (person.interactions ?? []).slice(0, 10).map(trimInteraction),
          relationships: (person.relationships ?? []).slice(0, 10).map(trimRelationship),
          socialAccounts: ownedSocialAccounts.map(trimSocialAccount),
        },
      };
    },
  },
  {
    name: "person_pull_flow",
    label: "Pull person flow",
    icon: "user",
    category: "people",
    description:
      "Fetch only the flow section (interactions and notes) for a person by UUID. Use this when you only need to see a person's activity timeline without their full profile or relationships.",
    parameters: {
      type: "object",
      properties: {
        uuid: { type: "string", description: "UUID of the person." },
      },
      required: ["uuid"],
    },
    handler: async (args) => {
      const uuid = asString(args.uuid).trim();
      if (!uuid) return { summary: "Missing UUID", data: { error: "uuid is required" } };
      const person = await storage.getPersonById(uuid);
      if (!person) return { summary: "Person not found", data: { error: "not_found" } };
      const personName = `${person.firstName ?? ""} ${person.lastName ?? ""}`.trim();
      return {
        summary: `Pulled flow for ${personName || "person"}`,
        data: {
          uuid: person.id,
          name: personName,
          notes: (person.notes ?? []).slice(0, 15).map(trimNote),
          interactions: (person.interactions ?? []).slice(0, 15).map(trimInteraction),
        },
      };
    },
  },
  {
    name: "person_pull_relationships",
    label: "Pull person relationships",
    icon: "user",
    category: "people",
    description:
      "Fetch only the relationships for a person by UUID. Optionally filter by relationship type name (e.g. 'Family', 'Best Friend', 'Friend', 'Acquaintance', 'Colleague'). Pass typeFilter='all' or omit it to get all relationships.",
    parameters: {
      type: "object",
      properties: {
        uuid: { type: "string", description: "UUID of the person." },
        typeFilter: {
          type: "string",
          description: "Optional relationship type name to filter by (e.g. 'Family', 'Best Friend', 'Friend', 'Acquaintance', 'Colleague'). Omit or pass 'all' to return all relationships.",
        },
      },
      required: ["uuid"],
    },
    handler: async (args) => {
      const uuid = asString(args.uuid).trim();
      if (!uuid) return { summary: "Missing UUID", data: { error: "uuid is required" } };
      const person = await storage.getPersonById(uuid);
      if (!person) return { summary: "Person not found", data: { error: "not_found" } };
      const personName = `${person.firstName ?? ""} ${person.lastName ?? ""}`.trim();

      let rels = person.relationships ?? [];
      const typeFilter = asString(args.typeFilter).trim().toLowerCase();
      if (typeFilter && typeFilter !== "all") {
        rels = rels.filter((r: any) => {
          const typeName = (r.type?.name ?? "").toLowerCase();
          const familyType = (r.familyRelationshipType ?? "").toLowerCase();
          return typeName.includes(typeFilter) || familyType.includes(typeFilter);
        });
      }

      const results = rels.slice(0, 20).map(trimRelationship);
      return {
        summary: `Found ${results.length} relationship${results.length === 1 ? "" : "s"} for ${personName || "person"}`,
        data: {
          uuid: person.id,
          name: personName,
          typeFilter: typeFilter || "all",
          relationships: results,
        },
      };
    },
  },
  {
    name: "social_account_search",
    label: "Social account search",
    icon: "search",
    category: "social-accounts",
    description:
      "Search social accounts (handles, display names) for a text query. Returns up to 10 matching accounts with their UUIDs.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Free-text search query (handle, display name, etc.)." },
      },
      required: ["query"],
    },
    handler: async (args) => {
      const query = asString(args.query).trim();
      if (!query) return { summary: "Empty query", data: { results: [] } };
      const accounts = await storage.getAllSocialAccounts(query);
      const results = accounts.slice(0, MAX_SEARCH_RESULTS).map(trimSocialAccount);
      return { summary: `Found ${results.length} social account${results.length === 1 ? "" : "s"}`, data: { results } };
    },
  },
  {
    name: "social_account_pull",
    label: "Pull social account",
    icon: "at-sign",
    category: "social-accounts",
    description:
      "Fetch a single social account in full by UUID. Returns handle, display name, bio, account URL, follower/following counts, account creation date, and the owner person (if any). Call this after social_account_search if you need the full record.",
    parameters: {
      type: "object",
      properties: {
        uuid: { type: "string", description: "UUID of the social account to pull." },
      },
      required: ["uuid"],
    },
    handler: async (args) => {
      const uuid = asString(args.uuid).trim();
      if (!uuid) return { summary: "Missing UUID", data: { error: "uuid is required" } };
      const account = await storage.getSocialAccountById(uuid);
      if (!account) return { summary: "Social account not found", data: { error: "not_found" } };
      const trimmed = trimSocialAccount(account);
      const owner = account.ownerUuid ? await storage.getPersonById(account.ownerUuid) : null;
      return {
        summary: `Pulled ${trimmed.handle ?? trimmed.displayName ?? "social account"}`,
        data: {
          ...trimmed,
          owner: owner ? trimPerson(owner) : null,
        },
      };
    },
  },
  {
    name: "daily_note_search",
    label: "Daily note search",
    icon: "search",
    category: "daily-notes",
    description:
      "Look up a daily note by UUID, by date (YYYY-MM-DD), or by free-text content match. Returns up to 10 matching daily notes.",
    parameters: {
      type: "object",
      properties: {
        uuid: { type: "string", description: "Optional UUID of a specific daily note." },
        date: { type: "string", description: "Optional ISO date (YYYY-MM-DD)." },
        query: { type: "string", description: "Optional free-text query to match against title/body." },
      },
    },
    handler: async (args) => {
      const uuid = asString(args.uuid).trim();
      if (uuid) {
        const note = await storage.getDailyNoteById(uuid);
        if (!note) return { summary: "Daily note not found", data: { error: "not_found" } };
        return { summary: `Pulled daily note ${note.date ?? ""}`.trim(), data: trimDailyNote(note) };
      }
      const date = asString(args.date).trim();
      if (date) {
        const note = await storage.getDailyNoteByDate(date);
        if (!note) return { summary: `No daily note for ${date}`, data: { results: [] } };
        return { summary: `Pulled daily note for ${date}`, data: { results: [trimDailyNote(note)] } };
      }
      const query = asString(args.query).trim();
      const all = await storage.listDailyNotes();
      const filtered = query
        ? all.filter((n: any) => matchesQuery(n.title, query) || matchesQuery(n.body, query))
        : all;
      const results = filtered.slice(0, MAX_SEARCH_RESULTS).map(trimDailyNote);
      return { summary: `Found ${results.length} daily note${results.length === 1 ? "" : "s"}`, data: { results } };
    },
  },
  {
    name: "note_search",
    label: "Note search",
    icon: "search",
    category: "notes",
    description:
      "Look up a person-attached note by UUID or by free-text content match. Returns up to 10 matching notes.",
    parameters: {
      type: "object",
      properties: {
        uuid: { type: "string", description: "Optional UUID of a specific note." },
        query: { type: "string", description: "Optional free-text query to match against title/content." },
      },
    },
    handler: async (args) => {
      const uuid = asString(args.uuid).trim();
      if (uuid) {
        const note = await storage.getNoteById(uuid);
        if (!note) return { summary: "Note not found", data: { error: "not_found" } };
        return { summary: "Pulled note", data: trimNote(note) };
      }
      const query = asString(args.query).trim();
      const all = await storage.getAllNotes();
      const filtered = query
        ? all.filter((n: any) => matchesQuery(n.title, query) || matchesQuery(n.content, query))
        : all;
      const results = filtered.slice(0, MAX_SEARCH_RESULTS).map(trimNote);
      return { summary: `Found ${results.length} note${results.length === 1 ? "" : "s"}`, data: { results } };
    },
  },
  {
    name: "interaction_search",
    label: "Interaction search",
    icon: "search",
    category: "interactions",
    description:
      "Look up an interaction by UUID or by free-text description match. Returns up to 10 matching interactions, newest first.",
    parameters: {
      type: "object",
      properties: {
        uuid: { type: "string", description: "Optional UUID of a specific interaction." },
        query: { type: "string", description: "Optional free-text query to match against description." },
      },
    },
    handler: async (args) => {
      const uuid = asString(args.uuid).trim();
      // Pull all interactions joined to types so we can return type names.
      const rows = await db
        .select()
        .from(interactions)
        .leftJoin(interactionTypes, eq(interactions.typeId, interactionTypes.id));
      const flattened = rows.map((row: any) => ({
        ...row.interactions,
        type: row.interaction_types ?? null,
      }));
      if (uuid) {
        const found = flattened.find((i: any) => i.id === uuid);
        if (!found) return { summary: "Interaction not found", data: { error: "not_found" } };
        return { summary: "Pulled interaction", data: trimInteraction(found) };
      }
      const query = asString(args.query).trim();
      const filtered = query
        ? flattened.filter((i: any) => matchesQuery(i.description, query))
        : flattened;
      filtered.sort((a: any, b: any) => new Date(b.date).getTime() - new Date(a.date).getTime());
      const results = filtered.slice(0, MAX_SEARCH_RESULTS).map(trimInteraction);
      return { summary: `Found ${results.length} interaction${results.length === 1 ? "" : "s"}`, data: { results } };
    },
  },
  {
    name: "super_search",
    label: "Super search",
    icon: "search",
    category: "search",
    description:
      "Perform a universal semantic/vector search across the entire PRM, covering all entity types (people, groups, images, notes, interactions, social accounts, daily notes, and AI chats). IMPORTANT: You should only call this tool if other specific search tools (like person_search, note_search, daily_note_search, interaction_search, or social_account_search) either yield no results or yield bad/unhelpful results.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Free-text semantic search query.",
        },
      },
      required: ["query"],
    },
    handler: async (args) => {
      const query = asString(args.query).trim();
      if (!query) return { summary: "Empty query", data: { results: [] } };
      try {
        const results = await searchUniversal(query, 10);
        return {
          summary: `Super search found ${results.length} result${results.length === 1 ? "" : "s"}`,
          data: { results },
        };
      } catch (error: any) {
        return {
          summary: "Super search failed",
          data: { error: error?.message || String(error) },
        };
      }
    },
  },
  {
    name: "read_messages",
    label: "Read messages",
    icon: "message-square",
    category: "messages",
    description:
      "Read historical message logs. You can filter by conversationId, startDate (YYYY-MM-DD), and endDate (YYYY-MM-DD) to query specific periods of chat history.",
    parameters: {
      type: "object",
      properties: {
        conversationId: { type: "string", description: "Optional UUID of a specific conversation thread." },
        startDate: { type: "string", description: "Optional start date filter (ISO format or YYYY-MM-DD)." },
        endDate: { type: "string", description: "Optional end date filter (ISO format or YYYY-MM-DD)." },
        limit: { type: "number", description: "Optional maximum messages to return (default 50, max 200)." },
        offset: { type: "number", description: "Optional pagination offset." },
      },
    },
    handler: async (args) => {
      const conversationId = asString(args.conversationId).trim();
      const startDateStr = asString(args.startDate).trim();
      const endDateStr = asString(args.endDate).trim();
      const limit = typeof args.limit === "number" ? Math.min(200, Math.max(1, args.limit)) : 50;
      const offset = typeof args.offset === "number" ? Math.max(0, args.offset) : 0;

      try {
        let query = db.select().from(messages);
        const conditions = [];

        if (conversationId) {
          conditions.push(eq(messages.conversationId, conversationId));
        }
        if (startDateStr) {
          conditions.push(sql`${messages.sentAt} >= ${new Date(startDateStr).toISOString()}`);
        }
        if (endDateStr) {
          conditions.push(sql`${messages.sentAt} <= ${new Date(endDateStr).toISOString()}`);
        }

        let whereQuery;
        if (conditions.length > 0) {
          whereQuery = query.where(and(...conditions));
        } else {
          whereQuery = query;
        }

        const rows = await whereQuery
          .orderBy(messages.sentAt)
          .limit(limit)
          .offset(offset);

        const results = [];
        for (const row of rows) {
          let senderName = "Unknown";
          if (row.senderPersonId) {
            const [p] = await db.select({ firstName: people.firstName, lastName: people.lastName })
              .from(people).where(eq(people.id, row.senderPersonId));
            if (p) senderName = `${p.firstName} ${p.lastName}`;
          } else if (row.senderSocialAccountId) {
            const [sa] = await db.select({ username: socialAccounts.username })
              .from(socialAccounts).where(eq(socialAccounts.id, row.senderSocialAccountId));
            if (sa) senderName = sa.username;
          } else if (row.metadata && typeof row.metadata === "object") {
            senderName = (row.metadata as any).senderName || "Unknown";
          }

          results.push({
            id: row.id,
            conversationId: row.conversationId,
            senderName,
            content: row.content,
            contentType: row.contentType,
            sentAt: row.sentAt,
          });
        }

        return {
          summary: `Read ${results.length} message${results.length === 1 ? "" : "s"}`,
          data: { results },
        };
      } catch (error: any) {
        return {
          summary: "Failed to read messages",
          data: { error: error?.message || String(error) },
        };
      }
    },
  },
  {
    name: "search_messages",
    label: "Search messages",
    icon: "search",
    category: "messages",
    description:
      "Search message logs by text content (substring or regex pattern), optionally filtering by conversation, date range, or fetching a count of messages chronologically backwards or forwards from a reference date. Optionally condenses findings via the LLM.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Optional text or regex pattern to search for in message content." },
        useRegex: { type: "boolean", description: "If true, treats the query as a regular expression pattern." },
        conversationId: { type: "string", description: "Optional UUID of a specific conversation thread." },
        startDate: { type: "string", description: "Optional start date filter (ISO format or YYYY-MM-DD)." },
        endDate: { type: "string", description: "Optional end date filter (ISO format or YYYY-MM-DD)." },
        refDate: { type: "string", description: "Optional reference date (ISO format or YYYY-MM-DD) to query messages relative to." },
        direction: { type: "string", enum: ["backwards", "forwards"], description: "Optional direction to fetch relative to refDate. Required if refDate is provided." },
        limit: { type: "number", description: "Optional maximum messages to return (default 50, max 200)." },
        offset: { type: "number", description: "Optional pagination offset." },
        summarizeFindings: { type: "boolean", description: "Optional. If true, condenses results into a summary utilizing the LLM." },
        highlightRequest: { type: "string", description: "Optional instructions or question for the summarizer when summarizeFindings is true." },
        includeIds: { type: "boolean", description: "Optional. If true (default), returns message and conversation UUIDs. Set to false to exclude them to save context token space." },
      },
    },
    handler: async (args) => {
      const textQuery = asString(args.query).trim();
      const useRegex = !!args.useRegex;
      const conversationId = asString(args.conversationId).trim();
      const startDateStr = asString(args.startDate).trim();
      const endDateStr = asString(args.endDate).trim();
      const refDateStr = asString(args.refDate).trim();
      const direction = asString(args.direction).trim();
      const limit = typeof args.limit === "number" ? Math.min(200, Math.max(1, args.limit)) : 50;
      const offset = typeof args.offset === "number" ? Math.max(0, args.offset) : 0;
      const summarizeFindings = !!args.summarizeFindings;
      const highlightRequest = asString(args.highlightRequest).trim();
      const includeIds = args.includeIds !== false;

      try {
        let queryBuilder = db.select().from(messages);
        const conditions = [];

        if (conversationId) {
          conditions.push(eq(messages.conversationId, conversationId));
        }
        if (startDateStr) {
          conditions.push(sql`${messages.sentAt} >= ${new Date(startDateStr).toISOString()}`);
        }
        if (endDateStr) {
          conditions.push(sql`${messages.sentAt} <= ${new Date(endDateStr).toISOString()}`);
        }
        if (textQuery) {
          if (useRegex) {
            conditions.push(sql`${messages.content} ~* ${textQuery}`);
          } else {
            conditions.push(sql`${messages.content} ILIKE ${`%${textQuery}%`}`);
          }
        }

        if (refDateStr && direction) {
          const refIso = new Date(refDateStr).toISOString();
          if (direction === "backwards") {
            conditions.push(sql`${messages.sentAt} <= ${refIso}`);
          } else {
            conditions.push(sql`${messages.sentAt} >= ${refIso}`);
          }
        }

        let whereQuery: any = conditions.length > 0 ? queryBuilder.where(and(...conditions)) : queryBuilder;

        // Order relative queries to fetch closest messages chronologically
        if (refDateStr && direction === "backwards") {
          whereQuery = whereQuery.orderBy(sql`${messages.sentAt} DESC`);
        } else {
          whereQuery = whereQuery.orderBy(sql`${messages.sentAt} ASC`);
        }

        const rows = await whereQuery.limit(limit).offset(offset);

        const results = [];
        for (const row of rows) {
          let senderName = "Unknown";
          if (row.senderPersonId) {
            const [p] = await db.select({ firstName: people.firstName, lastName: people.lastName })
              .from(people).where(eq(people.id, row.senderPersonId));
            if (p) senderName = `${p.firstName} ${p.lastName}`;
          } else if (row.senderSocialAccountId) {
            const [sa] = await db.select({ username: socialAccounts.username })
              .from(socialAccounts).where(eq(socialAccounts.id, row.senderSocialAccountId));
            if (sa) senderName = sa.username;
          } else if (row.metadata && typeof row.metadata === "object") {
            senderName = (row.metadata as any).senderName || "Unknown";
          }

          const msgObj: any = {
            senderName,
            content: row.content,
            contentType: row.contentType,
            sentAt: row.sentAt,
          };
          if (includeIds) {
            msgObj.id = row.id;
            msgObj.conversationId = row.conversationId;
          }
          results.push(msgObj);
        }

        // Sort chronologically ascending for readable presentation
        results.sort((a, b) => new Date(a.sentAt).getTime() - new Date(b.sentAt).getTime());

        if (summarizeFindings && results.length > 0) {
          const apiUrl = (await storage.getAppSetting("ollama_api_url")) ?? "";
          if (!apiUrl.trim()) {
            return {
              summary: `Found ${results.length} messages, but Ollama is not configured for summarization.`,
              data: { results },
            };
          }

          const base = apiUrl.replace(/\/+$/, "");
          const headers: Record<string, string> = { "Content-Type": "application/json" };
          const authRequired = (await storage.getAppSetting("ollama_auth_required")) === "true";
          if (authRequired) {
            const username = (await storage.getAppSetting("ollama_username")) ?? "";
            const password = (await storage.getAppSetting("ollama_password")) ?? "";
            headers["Authorization"] = "Basic " + Buffer.from(`${username}:${password}`).toString("base64");
          }

          const textModel = (await storage.getAppSetting("ollama_text_model")) ?? "";
          const model = textModel || ((await storage.getAppSetting("ollama_model")) ?? "") || "llava";

          const chatLog = results
            .map((r) => `[${r.sentAt ? new Date(r.sentAt).toLocaleString() : "Unknown"}] ${r.senderName}: ${r.content || ""}`)
            .join("\n");

          let promptContent = `Here is the message chain:\n\n${chatLog}\n\n`;
          if (highlightRequest) {
            promptContent += `Special Instructions: Please specifically highlight and answer the following details or question in your summary: "${highlightRequest}"`;
          } else {
            promptContent += `Please summarize the key takeaways of this message chain in a clean, concise manner.`;
          }

          const messagesPayload = [
            {
              role: "system",
              content: `You are an expert AI summarizer. Your task is to condense large conversation logs and chat history into short, high-density, accurate summaries. Focus on extracting key dates, facts, plans, and answers to any special highlight instructions, removing all filler and small talk.`,
            },
            {
              role: "user",
              content: promptContent,
            },
          ];

          const response = await fetch(`${base}/api/chat`, {
            method: "POST",
            headers,
            body: JSON.stringify({ model, messages: messagesPayload, stream: false }),
          });

          if (!response.ok) {
            const errText = await response.text();
            throw new Error(`Ollama summarization request failed (${response.status}): ${errText}`);
          }

          const responseData = (await response.json()) as { message?: { content?: string } };
          const summaryText = responseData.message?.content || "No summary was generated.";

          return {
            summary: `Summarized ${results.length} messages focusing on highlight instructions.`,
            data: {
              summary: summaryText,
              originalCount: results.length,
              highlightedDetails: highlightRequest || null,
            },
          };
        }

        return {
          summary: `Found ${results.length} message${results.length === 1 ? "" : "s"} matching criteria`,
          data: { results },
        };
      } catch (error: any) {
        return {
          summary: "Failed to search messages",
          data: { error: error?.message || String(error) },
        };
      }
    },
  },
  {
    name: "get_message_by_id",
    label: "Get message by ID",
    icon: "message-square",
    category: "messages",
    description:
      "Retrieve a specific message by its unique database ID, with option to fetch surrounding messages in the conversation to provide context.",
    parameters: {
      type: "object",
      properties: {
        messageId: { type: "string", description: "Required. The unique UUID of the target message." },
        contextCount: { type: "number", description: "Optional. Number of context messages to fetch relative to the message (default 0, max 100)." },
        contextDirection: {
          type: "string",
          enum: ["backwards", "forwards", "both"],
          description: "Optional. The direction to scan context messages relative to the target message. Required if contextCount > 0."
        },
      },
      required: ["messageId"],
    },
    handler: async (args) => {
      const messageId = asString(args.messageId).trim();
      const contextCount = typeof args.contextCount === "number" ? Math.min(100, Math.max(0, args.contextCount)) : 0;
      const contextDirection = asString(args.contextDirection).trim() || "both";

      if (!messageId) {
        return {
          summary: "Error: messageId is required.",
          data: { error: "messageId is required." },
        };
      }

      try {
        const [targetMsg] = await db.select().from(messages).where(eq(messages.id, messageId));
        if (!targetMsg) {
          return {
            summary: `Message ${messageId} not found`,
            data: { error: `Message with ID ${messageId} was not found.` },
          };
        }

        const helperMapSender = async (row: any) => {
          let senderName = "Unknown";
          if (row.senderPersonId) {
            const [p] = await db.select({ firstName: people.firstName, lastName: people.lastName })
              .from(people).where(eq(people.id, row.senderPersonId));
            if (p) senderName = `${p.firstName} ${p.lastName}`;
          } else if (row.senderSocialAccountId) {
            const [sa] = await db.select({ username: socialAccounts.username })
              .from(socialAccounts).where(eq(socialAccounts.id, row.senderSocialAccountId));
            if (sa) senderName = sa.username;
          } else if (row.metadata && typeof row.metadata === "object") {
            senderName = (row.metadata as any).senderName || "Unknown";
          }
          return {
            id: row.id,
            conversationId: row.conversationId,
            senderName,
            content: row.content,
            contentType: row.contentType,
            sentAt: row.sentAt,
          };
        };

        const targetResult = await helperMapSender(targetMsg);
        const results = [targetResult];

        if (contextCount > 0 && targetMsg.conversationId) {
          const targetSentAtIso = targetMsg.sentAt ? new Date(targetMsg.sentAt).toISOString() : new Date().toISOString();
          
          let backwardsRows: any[] = [];
          if (contextDirection === "backwards" || contextDirection === "both") {
            backwardsRows = await db.select()
              .from(messages)
              .where(
                and(
                  eq(messages.conversationId, targetMsg.conversationId),
                  sql`${messages.id} != ${targetMsg.id}`,
                  sql`${messages.sentAt} <= ${targetSentAtIso}`
                )
              )
              .orderBy(sql`${messages.sentAt} DESC`)
              .limit(contextCount);
          }

          let forwardsRows: any[] = [];
          if (contextDirection === "forwards" || contextDirection === "both") {
            forwardsRows = await db.select()
              .from(messages)
              .where(
                and(
                  eq(messages.conversationId, targetMsg.conversationId),
                  sql`${messages.id} != ${targetMsg.id}`,
                  sql`${messages.sentAt} >= ${targetSentAtIso}`
                )
              )
              .orderBy(sql`${messages.sentAt} ASC`)
              .limit(contextCount);
          }

          const allContextRows = [...backwardsRows, ...forwardsRows];
          
          // De-duplicate if same sentAt or boundaries overlap
          const seenIds = new Set<string>([targetMsg.id]);
          for (const row of allContextRows) {
            if (!seenIds.has(row.id)) {
              seenIds.add(row.id);
              const mapped = await helperMapSender(row);
              results.push(mapped);
            }
          }
        }

        // Sort chronologically ascending
        results.sort((a, b) => new Date(a.sentAt).getTime() - new Date(b.sentAt).getTime());

        return {
          summary: `Fetched message ${messageId} with ${results.length - 1} context messages`,
          data: {
            targetMessageId: messageId,
            messages: results,
          },
        };
      } catch (error: any) {
        return {
          summary: "Failed to fetch message by ID",
          data: { error: error?.message || String(error) },
        };
      }
    },
  },
  {
    name: "query_app_knowledge",
    label: "Search app knowledge base",
    icon: "book",
    category: "search",
    description:
      "Search the app's internal knowledge base for details, documentation, features, guides, or navigation paths of the PRM application itself. Use this tool when the user asks how the app works, what pages/features exist, or how to use a specific part of the app.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Semantic search query to look up details about the app itself.",
        },
      },
      required: ["query"],
    },
    handler: async (args) => {
      const query = asString(args.query).trim();
      if (!query) return { summary: "Empty query", data: { results: [] } };
      try {
        const results = await searchAppKnowledge(query, 5);
        return {
          summary: `App knowledge search found ${results.length} result${results.length === 1 ? "" : "s"}`,
          data: { results },
        };
      } catch (error: any) {
        return {
          summary: "App knowledge search failed",
          data: { error: error?.message || String(error) },
        };
      }
    },
  },

  // ── Write tools ─────────────────────────────────────────────────────────
  // The handlers below mutate PRM data. They are gated by the AI-tools
  // execution-mode setting (off / auth / open) defined in server/routes.ts.
  // In `auth` mode the streaming chat loop emits a `tool_approval_request`
  // event and waits for the user before invoking any of these handlers.

  {
    name: "create_person",
    label: "Create person",
    icon: "user-plus",
    category: "people",
    write: true,
    description:
      "Create a new person record in the PRM. Requires firstName and lastName. Returns the new person's UUID.",
    parameters: {
      type: "object",
      properties: {
        firstName: { type: "string", description: "Given / first name." },
        lastName: { type: "string", description: "Family / last name." },
        email: { type: "string", description: "Optional email address." },
        phone: { type: "string", description: "Optional phone number." },
        company: { type: "string", description: "Optional company / organization." },
        title: { type: "string", description: "Optional job title." },
      },
      required: ["firstName", "lastName"],
    },
    handler: async (args, ctx) => {
      const firstName = asString(args.firstName).trim();
      const lastName = asString(args.lastName).trim();
      if (!firstName || !lastName) {
        return { summary: "firstName and lastName are required", data: { error: "missing_required" } };
      }
      const person = await storage.createPerson({
        firstName,
        lastName,
        email: asString(args.email).trim() || null,
        phone: asString(args.phone).trim() || null,
        company: asString(args.company).trim() || null,
        title: asString(args.title).trim() || null,
        // Attribute to the user whose session invoked the AI, not to nobody —
        // otherwise every AI-created contact is permanently orphaned.
        createdByUserId: ctx.userId,
      } as any);
      return { summary: `Created ${firstName} ${lastName}`, data: trimPerson(person) };
    },
  },
  {
    name: "update_person",
    label: "Update person",
    icon: "user-pen",
    category: "people",
    write: true,
    description:
      "Update fields on an existing person identified by UUID. Only the fields supplied are changed; omit fields you don't want to touch.",
    parameters: {
      type: "object",
      properties: {
        uuid: { type: "string", description: "UUID of the person to update." },
        firstName: { type: "string" },
        lastName: { type: "string" },
        email: { type: "string" },
        phone: { type: "string" },
        company: { type: "string" },
        title: { type: "string" },
      },
      required: ["uuid"],
    },
    handler: async (args) => {
      const uuid = asString(args.uuid).trim();
      if (!uuid) return { summary: "Missing UUID", data: { error: "uuid is required" } };
      const patch: Record<string, unknown> = {};
      for (const k of ["firstName", "lastName", "email", "phone", "company", "title"]) {
        if (typeof args[k] === "string") patch[k] = (args[k] as string).trim() || null;
      }
      if (Object.keys(patch).length === 0) {
        return { summary: "No fields to update", data: { error: "no_fields" } };
      }
      const updated = await storage.updatePerson(uuid, patch as any);
      if (!updated) return { summary: "Person not found", data: { error: "not_found" } };
      return { summary: `Updated person ${uuid}`, data: trimPerson(updated) };
    },
  },
  {
    name: "create_note",
    label: "Create note",
    icon: "book-plus",
    category: "notes",
    write: true,
    description:
      "Create a note attached to a person. Requires personId (UUID) and content. Use person_search first if you don't have the UUID.",
    parameters: {
      type: "object",
      properties: {
        personId: { type: "string", description: "UUID of the person the note belongs to." },
        content: { type: "string", description: "Note body text." },
      },
      required: ["personId", "content"],
    },
    handler: async (args, ctx) => {
      const personId = asString(args.personId).trim();
      const content = asString(args.content);
      if (!personId || !content.trim()) {
        return { summary: "personId and content are required", data: { error: "missing_required" } };
      }
      // notes.user_id is NOT NULL — the note belongs to whoever asked for it.
      const note = await storage.createNote({ personId, content, userId: ctx.userId });
      return { summary: "Created note", data: trimNote(note) };
    },
  },
  {
    name: "create_interaction",
    label: "Create interaction",
    icon: "message-square-plus",
    category: "interactions",
    write: true,
    description:
      "Create an interaction between two or more people. Requires peopleIds (an array of at least 2 person UUIDs) and a date (ISO-8601). Optional: title, description, typeId.",
    parameters: {
      type: "object",
      properties: {
        peopleIds: {
          type: "array",
          items: { type: "string" },
          description: "UUIDs of the people involved (2 or more).",
        },
        date: { type: "string", description: "ISO-8601 date string for when the interaction occurred." },
        title: { type: "string", description: "Optional short title." },
        description: { type: "string", description: "Optional longer description." },
        typeId: { type: "string", description: "Optional interaction type UUID." },
      },
      required: ["peopleIds", "date"],
    },
    handler: async (args, ctx) => {
      const peopleIds = Array.isArray(args.peopleIds)
        ? (args.peopleIds as unknown[]).filter((v): v is string => typeof v === "string" && v.trim().length > 0)
        : [];
      if (peopleIds.length < 2) {
        return { summary: "At least 2 peopleIds are required", data: { error: "missing_required" } };
      }
      const dateStr = asString(args.date).trim();
      const date = dateStr ? new Date(dateStr) : null;
      if (!date || Number.isNaN(date.getTime())) {
        return { summary: "Invalid date", data: { error: "invalid_date" } };
      }
      const payload: Record<string, unknown> = { peopleIds, date, createdByUserId: ctx.userId };
      const title = asString(args.title).trim();
      if (title) payload.title = title;
      const description = asString(args.description).trim();
      if (description) payload.description = description;
      const typeId = asString(args.typeId).trim();
      if (typeId) payload.typeId = typeId;
      const created = await storage.createInteraction(payload as any);
      return { summary: "Created interaction", data: trimInteraction(created) };
    },
  },
  {
    name: "update_interaction",
    label: "Update interaction",
    icon: "pencil",
    category: "interactions",
    write: true,
    description:
      "Update an existing interaction identified by UUID. Only the fields supplied are changed.",
    parameters: {
      type: "object",
      properties: {
        uuid: { type: "string", description: "UUID of the interaction to update." },
        title: { type: "string" },
        description: { type: "string" },
        date: { type: "string", description: "ISO-8601 date string." },
        typeId: { type: "string" },
      },
      required: ["uuid"],
    },
    handler: async (args) => {
      const uuid = asString(args.uuid).trim();
      if (!uuid) return { summary: "Missing UUID", data: { error: "uuid is required" } };
      const patch: Record<string, unknown> = {};
      if (typeof args.title === "string") patch.title = args.title;
      if (typeof args.description === "string") patch.description = args.description;
      if (typeof args.typeId === "string") patch.typeId = args.typeId.trim() || null;
      if (typeof args.date === "string") {
        const d = new Date(args.date);
        if (Number.isNaN(d.getTime())) return { summary: "Invalid date", data: { error: "invalid_date" } };
        patch.date = d;
      }
      if (Object.keys(patch).length === 0) {
        return { summary: "No fields to update", data: { error: "no_fields" } };
      }
      const updated = await storage.updateInteraction(uuid, patch as any);
      if (!updated) return { summary: "Interaction not found", data: { error: "not_found" } };
      return { summary: `Updated interaction ${uuid}`, data: trimInteraction(updated) };
    },
  },
  {
    name: "create_daily_note",
    label: "Create daily note",
    icon: "notebook-pen",
    category: "daily-notes",
    write: true,
    description:
      "Create a daily note for a given ISO date (YYYY-MM-DD). The body is the freeform note content.",
    parameters: {
      type: "object",
      properties: {
        date: { type: "string", description: "ISO date (YYYY-MM-DD)." },
        userTitle: { type: "string", description: "Optional title." },
        body: { type: "string", description: "Note body text." },
      },
      required: ["date"],
    },
    handler: async (args, ctx) => {
      const date = asString(args.date).trim();
      if (!date) return { summary: "Missing date", data: { error: "date is required" } };
      const userTitle = asString(args.userTitle);
      const body = asString(args.body);
      // daily_notes.user_id is NOT NULL — daily notes are strictly per-user.
      const note = await storage.createDailyNote({ date, userTitle, body, userId: ctx.userId });
      return { summary: `Created daily note for ${date}`, data: trimDailyNote(note) };
    },
  },
  {
    name: "update_daily_note",
    label: "Update daily note",
    icon: "pencil",
    category: "daily-notes",
    write: true,
    description:
      "Update an existing daily note identified by UUID. Only fields supplied are changed.",
    parameters: {
      type: "object",
      properties: {
        uuid: { type: "string", description: "UUID of the daily note to update." },
        userTitle: { type: "string" },
        body: { type: "string" },
      },
      required: ["uuid"],
    },
    handler: async (args) => {
      const uuid = asString(args.uuid).trim();
      if (!uuid) return { summary: "Missing UUID", data: { error: "uuid is required" } };
      const patch: Record<string, unknown> = {};
      if (typeof args.userTitle === "string") patch.userTitle = args.userTitle;
      if (typeof args.body === "string") patch.body = args.body;
      if (Object.keys(patch).length === 0) {
        return { summary: "No fields to update", data: { error: "no_fields" } };
      }
      const updated = await storage.updateDailyNote(uuid, patch as any);
      if (!updated) return { summary: "Daily note not found", data: { error: "not_found" } };
      return { summary: `Updated daily note ${uuid}`, data: trimDailyNote(updated) };
    },
  },
  // ─── Relationship tools ─────────────────────────────────────────────────────
  {
    name: "get_relationship_types",
    label: "Get relationship types",
    icon: "user",
    category: "relationships",
    description:
      "Get all relationship types available in this PRM, including general types (Friend, Colleague, Family, etc.) and every family sub-type (spouse, child, ex_spouse, parent, sibling, etc.) with their labels, categories, and inverse types. Always call this before set_relationship so you know valid type IDs and family sub-types.",
    parameters: { type: "object", properties: {} },
    handler: async () => {
      const generalTypes = await storage.getAllRelationshipTypes();
      const familySubTypes = FAMILY_RELATIONSHIP_TYPES.map(value => ({
        value,
        label: FAMILY_RELATIONSHIP_LABELS[value] ?? value,
        category: FAMILY_RELATIONSHIP_CATEGORIES[value] ?? "other",
        inverse: FAMILY_RELATIONSHIP_INVERSES[value] ?? value,
      }));
      return {
        summary: `Found ${generalTypes.length} general types and ${familySubTypes.length} family sub-types`,
        data: { generalTypes, familySubTypes },
      };
    },
  },
  {
    name: "get_all_relationships",
    label: "Get all relationships",
    icon: "user",
    category: "relationships",
    description:
      "Get all relationships for a person by their UUID, in both directions (relationships they initiated and relationships targeting them).",
    parameters: {
      type: "object",
      properties: {
        personUuid: { type: "string", description: "UUID of the person whose relationships to fetch." },
      },
      required: ["personUuid"],
    },
    handler: async (args) => {
      const uuid = asString(args.personUuid).trim();
      if (!uuid) return { summary: "Missing personUuid", data: { error: "personUuid is required" } };
      const person = await storage.getPersonById(uuid);
      if (!person) return { summary: "Person not found", data: { error: "not_found" } };
      const personName = `${person.firstName ?? ""} ${person.lastName ?? ""}`.trim();
      const results = (person.relationships ?? []).map(trimRelationship);
      return {
        summary: `Found ${results.length} relationship${results.length === 1 ? "" : "s"} for ${personName || "person"}`,
        data: { uuid, name: personName, relationships: results },
      };
    },
  },
  {
    name: "get_relationships",
    label: "Get relationships by type",
    icon: "user",
    category: "relationships",
    description:
      "Get relationships for a person filtered by a relationship type name (e.g. 'Family', 'Friend') or family sub-type (e.g. 'spouse', 'child', 'ex_spouse'). Both the general type name and the family sub-type are checked (case-insensitive).",
    parameters: {
      type: "object",
      properties: {
        personUuid: { type: "string", description: "UUID of the person whose relationships to fetch." },
        type: { type: "string", description: "Relationship type name or family sub-type to filter by (e.g. 'Family', 'spouse', 'ex_spouse')." },
      },
      required: ["personUuid", "type"],
    },
    handler: async (args) => {
      const uuid = asString(args.personUuid).trim();
      const typeFilter = asString(args.type).trim().toLowerCase();
      if (!uuid) return { summary: "Missing personUuid", data: { error: "personUuid is required" } };
      if (!typeFilter) return { summary: "Missing type", data: { error: "type is required" } };
      const person = await storage.getPersonById(uuid);
      if (!person) return { summary: "Person not found", data: { error: "not_found" } };
      const personName = `${person.firstName ?? ""} ${person.lastName ?? ""}`.trim();
      const filtered = (person.relationships ?? []).filter((r: any) =>
        (r.type?.name ?? "").toLowerCase().includes(typeFilter) ||
        (r.familyRelationshipType ?? "").toLowerCase().includes(typeFilter)
      );
      const results = filtered.map(trimRelationship);
      return {
        summary: `Found ${results.length} '${typeFilter}' relationship${results.length === 1 ? "" : "s"} for ${personName || "person"}`,
        data: { uuid, name: personName, typeFilter, relationships: results },
      };
    },
  },
  {
    name: "family_tree_pull",
    label: "Pull family tree",
    icon: "user-search",
    category: "relationships",
    description:
      "Fetch a person's family tree by UUID: every relative reachable through parent/child and partnership links up to `depth` steps away (default 2, max 5). Returns each relative with a human-readable relationship label relative to that person (e.g. 'Mother', 'Grandson', 'Ex-Wife') plus the raw family edges. Use person_search first if you don't have the UUID.",
    parameters: {
      type: "object",
      properties: {
        uuid: { type: "string", description: "UUID of the person whose family tree to pull." },
        depth: { type: "number", description: "Optional traversal depth in relationship steps (1-5). Default 2. Use a higher depth for extended family (e.g. great-grandparents, cousins)." },
      },
      required: ["uuid"],
    },
    handler: async (args) => {
      const uuid = asString(args.uuid).trim();
      if (!uuid) return { summary: "Missing UUID", data: { error: "uuid is required" } };
      const person = await storage.getPersonById(uuid);
      if (!person) return { summary: "Person not found", data: { error: "not_found" } };
      const personName = `${person.firstName ?? ""} ${person.lastName ?? ""}`.trim();

      const rawDepth = typeof args.depth === "number" ? args.depth : Number(asString(args.depth));
      const depth = Number.isFinite(rawDepth) && rawDepth >= 1 ? Math.min(Math.floor(rawDepth), 5) : 2;

      const tree = await storage.getFamilyTree(uuid, depth);
      const labels = computeFamilyLabels(uuid, tree);
      const relatives = tree.people
        .filter((p) => p.id !== uuid)
        .map((p) => ({
          uuid: p.id,
          name: `${p.firstName ?? ""} ${p.lastName ?? ""}`.trim(),
          sex: p.sex ?? null,
          stepsAway: p.depth,
          relationshipLabel: labels.get(p.id) ?? "Extended Family",
        }));
      relatives.sort((a, b) => a.stepsAway - b.stepsAway || a.relationshipLabel.localeCompare(b.relationshipLabel));

      return {
        summary: `Found ${relatives.length} family member${relatives.length === 1 ? "" : "s"} for ${personName || "person"}`,
        data: {
          uuid,
          name: personName,
          depth,
          relatives,
          // Raw edges so the model can reason about exact structure if needed.
          relationships: tree.relationships,
        },
      };
    },
  },
  {
    name: "set_relationship",
    label: "Set relationship",
    icon: "user-plus",
    category: "relationships",
    write: true,
    description:
      "Create a relationship between two people. IMPORTANT: You must call get_relationship_types first to get the correct relationship type ID and valid family sub-types. For family relationships, supply both the Family type ID as relationshipTypeId and the appropriate familyRelationshipType sub-type (e.g. 'spouse', 'child', 'ex_spouse'). The system will automatically create the inverse relationship.",
    parameters: {
      type: "object",
      properties: {
        uuid1: { type: "string", description: "UUID of the first person (relationship FROM this person)." },
        uuid2: { type: "string", description: "UUID of the second person (relationship TO this person)." },
        relationshipTypeId: { type: "string", description: "ID of the relationship type (from get_relationship_types generalTypes)." },
        familyRelationshipType: {
          type: "string",
          description: "Optional family sub-type (e.g. 'spouse', 'child', 'parent', 'sibling', 'ex_spouse'). Required when the relationship type is 'Family'.",
        },
        notes: { type: "string", description: "Optional notes about the relationship." },
      },
      required: ["uuid1", "uuid2", "relationshipTypeId"],
    },
    handler: async (args) => {
      const uuid1 = asString(args.uuid1).trim();
      const uuid2 = asString(args.uuid2).trim();
      const typeId = asString(args.relationshipTypeId).trim();
      const familyRelType = asString(args.familyRelationshipType ?? "").trim() as (typeof FAMILY_RELATIONSHIP_TYPES)[number] | "";
      const notes = asString(args.notes ?? "").trim() || null;

      if (!uuid1 || !uuid2) return { summary: "Missing UUIDs", data: { error: "uuid1 and uuid2 are required" } };
      if (!typeId) return { summary: "Missing relationship type ID", data: { error: "relationshipTypeId is required — call get_relationship_types first" } };
      if (uuid1 === uuid2) return { summary: "Same person", data: { error: "Cannot create a relationship from a person to themselves" } };

      const [person1, person2, relType] = await Promise.all([
        storage.getPersonById(uuid1),
        storage.getPersonById(uuid2),
        storage.getRelationshipTypeById(typeId),
      ]);
      if (!person1) return { summary: "Person 1 not found", data: { error: `Person with UUID ${uuid1} not found` } };
      if (!person2) return { summary: "Person 2 not found", data: { error: `Person with UUID ${uuid2} not found` } };
      if (!relType) return { summary: "Relationship type not found", data: { error: `Relationship type ${typeId} not found — call get_relationship_types first` } };

      // Validate family sub-type if provided
      if (familyRelType && !(FAMILY_RELATIONSHIP_TYPES as readonly string[]).includes(familyRelType)) {
        return { summary: "Invalid family sub-type", data: { error: `'${familyRelType}' is not a valid family sub-type — call get_relationship_types to see all valid values` } };
      }

      const person1Name = `${person1.firstName ?? ""} ${person1.lastName ?? ""}`.trim();
      const person2Name = `${person2.firstName ?? ""} ${person2.lastName ?? ""}`.trim();

      if (familyRelType) {
        const cat = FAMILY_RELATIONSHIP_CATEGORIES[familyRelType];
        if (cat === "parent" || cat === "child") {
          const isParentRole = cat === "parent";
          const parentId = isParentRole ? uuid1 : uuid2;
          const childId = isParentRole ? uuid2 : uuid1;
          const lineageType = familyRelType.startsWith("step") ? "step" : "biological";

          const result = await storage.createLineage({
            parentId,
            childId,
            lineageType,
          });

          return {
            summary: `Created '${familyRelType}' family relationship from ${person1Name} to ${person2Name}`,
            data: {
              relationship: trimRelationship({
                id: `${result.id}_p`,
                fromPersonId: uuid1,
                toPersonId: uuid2,
                typeId,
                type: relType,
                familyRelationshipType: familyRelType,
                notes,
              }),
              inverseCreated: true,
              propagatedCount: 0,
            },
          };
        } else {
          let status: "married" | "partner" | "divorced" | "ex_partner" = "partner";
          if (familyRelType === "spouse") status = "married";
          else if (familyRelType === "ex_spouse") status = "divorced";

          const result = await storage.createPartnership({
            person1Id: uuid1,
            person2Id: uuid2,
            status,
          });

          return {
            summary: `Created '${familyRelType}' family relationship from ${person1Name} to ${person2Name}`,
            data: {
              relationship: trimRelationship({
                id: `${result.id}_s1`,
                fromPersonId: uuid1,
                toPersonId: uuid2,
                typeId,
                type: relType,
                familyRelationshipType: familyRelType,
                notes,
              }),
              inverseCreated: true,
              propagatedCount: 0,
            },
          };
        }
      }

      const relationship = await storage.createRelationship({ fromPersonId: uuid1, toPersonId: uuid2, typeId, notes });
      return {
        summary: `Created '${relType.name}' relationship from ${person1Name} to ${person2Name}`,
        data: { relationship: trimRelationship({ ...relationship, type: relType }) },
      };
    },
  },
];

export function getAiToolByName(name: string): AiToolDefinition | undefined {
  return AI_TOOLS.find((t) => t.name === name);
}

/** Public metadata shape — what the GET /api/ai-tools endpoint returns. */
export interface AiToolMetadata {
  name: string;
  label: string;
  description: string;
  icon: AiToolIcon;
  category: AiToolCategory;
  write: boolean;
}

export function listAiToolMetadata(): AiToolMetadata[] {
  return AI_TOOLS.map((t) => ({
    name: t.name,
    label: t.label,
    description: t.description,
    icon: t.icon,
    category: t.category,
    write: !!t.write,
  }));
}

/** Build the `tools` array Ollama expects for an /api/chat request. */
export function buildOllamaToolsArray(enabledNames: Set<string>): unknown[] {
  return AI_TOOLS.filter((t) => enabledNames.has(t.name)).map((t) => ({
    type: "function",
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    },
  }));
}
