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

export type AiToolIcon =
  | "search"
  | "user"
  | "user-search"
  | "at-sign"
  | "at-sign-search"
  | "book"
  | "notebook"
  | "message-square";

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
    nickname: p.nickname ?? null,
    email: p.email ?? null,
    phone: p.phone ?? null,
  };
}

function trimSocialAccount(a: any) {
  const profile = a.currentProfile ?? {};
  return {
    uuid: a.id,
    handle: profile.handle ?? a.handle ?? null,
    displayName: profile.displayName ?? null,
    typeId: a.typeId ?? null,
    bio: profile.bio ? String(profile.bio).slice(0, 280) : null,
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

function matchesQuery(haystack: string | null | undefined, q: string): boolean {
  if (!haystack) return false;
  return haystack.toLowerCase().includes(q.toLowerCase());
}

export const AI_TOOLS: AiToolDefinition[] = [
  {
    name: "person_search",
    label: "Person search",
    icon: "search",
    description:
      "Search for people in the user's PRM by name, nickname, or other text. Returns up to 10 matching people with their UUIDs. Use this when the user asks about a person but you don't yet know their UUID.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Free-text search query for the person's name." },
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
    description:
      "Fetch a single person account in full (notes, interactions, relationships) by UUID. Call this after person_search if you need the full record.",
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
        },
      };
    },
  },
  {
    name: "social_account_search",
    label: "Social account search",
    icon: "search",
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
    description:
      "Fetch a single social account in full (current profile, latest state) by UUID. Call this after social_account_search if you need the full record.",
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
}

export function listAiToolMetadata(): AiToolMetadata[] {
  return AI_TOOLS.map((t) => ({ name: t.name, label: t.label, description: t.description, icon: t.icon }));
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
