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
import { interactions, interactionTypes } from "@shared/schema";
import { eq } from "drizzle-orm";
import { searchUniversal } from "./vector-universal";
import { searchAppKnowledge } from "./vector-app-knowledge";


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
  | "search";

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
      "Fetch a single person's full account by UUID, including their profile info, notes, interactions, and relationships. Call this after person_search if you need the complete record. For partial data, use person_pull_flow or person_pull_relationships instead.",
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
      return {
        summary: `Pulled ${person.firstName ?? ""} ${person.lastName ?? ""}`.trim() || "Pulled person",
        data: {
          ...trimPerson(person),
          notes: (person.notes ?? []).slice(0, 10).map(trimNote),
          interactions: (person.interactions ?? []).slice(0, 10).map(trimInteraction),
          relationships: (person.relationships ?? []).slice(0, 10).map(trimRelationship),
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
      "Fetch a single social account in full by UUID. Returns the account owner UUID, handle, display name, bio, account URL, follower/following counts, and account creation date. Call this after social_account_search if you need the full record.",
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
      return {
        summary: `Pulled ${trimmed.handle ?? trimmed.displayName ?? "social account"}`,
        data: trimmed,
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
    handler: async (args) => {
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
    handler: async (args) => {
      const personId = asString(args.personId).trim();
      const content = asString(args.content);
      if (!personId || !content.trim()) {
        return { summary: "personId and content are required", data: { error: "missing_required" } };
      }
      const note = await storage.createNote({ personId, content } as any);
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
    handler: async (args) => {
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
      const payload: Record<string, unknown> = { peopleIds, date };
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
    handler: async (args) => {
      const date = asString(args.date).trim();
      if (!date) return { summary: "Missing date", data: { error: "date is required" } };
      const userTitle = asString(args.userTitle);
      const body = asString(args.body);
      const note = await storage.createDailyNote({ date, userTitle, body } as any);
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
