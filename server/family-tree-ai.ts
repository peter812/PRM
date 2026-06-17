/**
 * Family Tree AI — natural-language generation of relationship changes.
 *
 * Given a root person and a free-text prompt describing the family
 * ("I am Sam Smith, my brother is Mark Smith…"), this module asks an
 * Ollama LLM to:
 *
 *   1. Use a small set of read-only tools to discover existing people /
 *      relationships in the user's PRM.
 *   2. Emit a final JSON document describing the additions / edits /
 *      deletions needed to bring the database in line with the prompt.
 *
 * The output is **purely a proposal** — nothing is written until the
 * caller applies the (user-curated) subset of changes via
 * `applyFamilyTreeChanges`.
 */

import { storage } from "./storage";
import {
  FAMILY_RELATIONSHIP_TYPES,
  FAMILY_RELATIONSHIP_LABELS,
  FAMILY_RELATIONSHIP_INVERSES,
  type FamilyRelationshipType,
} from "@shared/schema";

// ────────────────────────────────────────────────────────────────────────────
// Public types
// ────────────────────────────────────────────────────────────────────────────

export type ProposedFamilyChange =
  | {
      kind: "add";
      fromPersonId: string;
      fromPersonName: string;
      familyRelationshipType: FamilyRelationshipType;
      // Existing target person (preferred) …
      toPersonId?: string;
      toPersonName?: string;
      // … or a new person the AI proposes to create.
      newPerson?: { firstName: string; lastName?: string };
      reason?: string;
    }
  | {
      kind: "edit";
      relationshipId: string;
      fromPersonId: string;
      fromPersonName: string;
      toPersonId: string;
      toPersonName: string;
      currentType: string;
      familyRelationshipType: FamilyRelationshipType;
      reason?: string;
    }
  | {
      kind: "delete";
      relationshipId: string;
      fromPersonId: string;
      fromPersonName: string;
      toPersonId: string;
      toPersonName: string;
      currentType: string;
      reason?: string;
    };

export interface GenerateFamilyChangesParams {
  /** Root person whose family the prompt is about. */
  personId: string;
  /** Free-text user prompt. */
  prompt: string;
  /** When false, the model is instructed not to propose deletions. */
  allowDeletions: boolean;
  /** When true, an extra "explain reasoning" pass is included. */
  askForChanges: boolean;
  /** Ollama connection. */
  ollama: { base: string; headers: Record<string, string> };
  /** Ollama model name. */
  model: string;
}

export interface GenerateFamilyChangesResult {
  changes: ProposedFamilyChange[];
  /** Free-text explanation from the model (if produced). */
  notes: string;
  /** Number of Ollama tool-call iterations consumed. */
  iterations: number;
}

// ────────────────────────────────────────────────────────────────────────────
// Ollama tools exposed to the model (read-only)
// ────────────────────────────────────────────────────────────────────────────

const FAMILY_TREE_TOOLS = [
  {
    type: "function",
    function: {
      name: "search_people",
      description:
        "Search the user's PRM for existing people by free-text name. Returns up to 10 matches with their UUIDs. Use this to resolve names mentioned in the prompt to existing person UUIDs.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Name fragment to search for." },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_family_relationships",
      description:
        "Return the existing family relationships for a person (both directions) so you can decide whether a change is an add, an edit, or a delete. Use the UUIDs returned for any edit or delete proposals.",
      parameters: {
        type: "object",
        properties: {
          personUuid: { type: "string", description: "UUID of the person." },
        },
        required: ["personUuid"],
      },
    },
  },
];

// ────────────────────────────────────────────────────────────────────────────
// Tool handlers
// ────────────────────────────────────────────────────────────────────────────

async function handleSearchPeople(args: Record<string, unknown>): Promise<unknown> {
  const query = typeof args.query === "string" ? args.query.trim() : "";
  if (!query) return { results: [] };
  const people = await storage.getAllPeople(query);
  return {
    results: people.slice(0, 10).map((p: any) => ({
      uuid: p.id,
      firstName: p.firstName ?? null,
      lastName: p.lastName ?? null,
    })),
  };
}

async function handleGetFamilyRelationships(args: Record<string, unknown>): Promise<unknown> {
  const uuid = typeof args.personUuid === "string" ? args.personUuid.trim() : "";
  if (!uuid) return { error: "personUuid is required" };
  const person = await storage.getPersonById(uuid);
  if (!person) return { error: "not_found" };

  const familyRels = (person.relationships ?? [])
    .filter((r: any) => r.familyRelationshipType)
    .map((r: any) => ({
      relationshipId: r.id,
      fromPersonUuid: r.fromPersonId,
      toPersonUuid: r.toPersonId,
      toPersonName: `${r.toPerson?.firstName ?? ""} ${r.toPerson?.lastName ?? ""}`.trim(),
      familyRelationshipType: r.familyRelationshipType,
    }));

  return {
    personUuid: person.id,
    name: `${person.firstName ?? ""} ${person.lastName ?? ""}`.trim(),
    relationships: familyRels,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Prompt assembly
// ────────────────────────────────────────────────────────────────────────────

function buildSystemPrompt(allowDeletions: boolean, askForChanges: boolean): string {
  const typeList = FAMILY_RELATIONSHIP_TYPES
    .filter(t => !t.includes("_or_"))
    .map(t => `"${t}"`)
    .join(", ");
  return [
    "You are a precise assistant that translates natural-language descriptions of a person's family into a structured set of relationship changes for a personal CRM.",
    "",
    "The user describes their family in free text. You must produce a JSON document of *proposed* changes. The user will review and apply them — never claim a change has been made.",
    "",
    "Available tools:",
    "  • search_people(query) — find existing people by name; returns UUIDs.",
    "  • get_family_relationships(personUuid) — list a person's current family relationships, including each relationship's UUID (use it for edits and deletions).",
    "",
    "Rules:",
    "  1. Always resolve people mentioned in the prompt to their UUIDs via search_people. If the search returns no results, you may propose creating a new person (see schema below).",
    "  2. Every family relationship in the database is directional (fromPerson → toPerson). When proposing a relationship, ALWAYS state it from the root person's perspective or another known person's perspective using the directional type (e.g. \"father\", \"brother\", \"mother\"). Do not invent new types.",
    "  3. The inverse direction is created automatically by the backend — DO NOT include both directions of the same relationship.",
    "  4. Before proposing an add, call get_family_relationships on the involved people and skip duplicates that already exist with the correct type.",
    "  5. If an existing family relationship has the wrong type, propose an edit (using its relationshipId), not a delete+add.",
    allowDeletions
      ? "  6. You MAY propose deletions when the prompt clearly states a relationship is wrong. Each delete must include the existing relationshipId."
      : "  6. You MUST NOT propose any deletions. Skip deletions even if a current relationship contradicts the prompt.",
    askForChanges
      ? "  7. After your tool calls, briefly explain your reasoning in the top-level \"notes\" field of the JSON."
      : "  7. Keep the top-level \"notes\" field empty or a single short sentence.",
    "",
    `Valid family relationship types: ${typeList}.`,
    "",
    "Final output: return ONLY a single JSON object (no markdown fences) matching exactly this schema:",
    "{",
    '  "notes": string,',
    '  "changes": [',
    "    // ADD an existing-to-existing relationship",
    '    { "kind": "add", "fromPersonId": "<uuid>", "toPersonId": "<uuid>", "familyRelationshipType": "<type>", "reason"?: string },',
    "    // ADD a relationship to a *new* person the AI proposes to create",
    '    { "kind": "add", "fromPersonId": "<uuid>", "newPerson": { "firstName": string, "lastName"?: string }, "familyRelationshipType": "<type>", "reason"?: string },',
    "    // EDIT the type of an existing relationship",
    '    { "kind": "edit", "relationshipId": "<uuid>", "familyRelationshipType": "<type>", "reason"?: string },',
    "    // DELETE an existing relationship (only if deletions are allowed)",
    '    { "kind": "delete", "relationshipId": "<uuid>", "reason"?: string }',
    "  ]",
    "}",
    "",
    "Do not write any prose outside the JSON. Do not include code fences.",
  ].join("\n");
}

function buildContextPrompt(args: {
  rootPerson: any;
  rootRelationships: Array<{
    relationshipId: string;
    toPersonUuid: string;
    toPersonName: string;
    familyRelationshipType: string;
  }>;
  userPrompt: string;
}): string {
  const { rootPerson, rootRelationships, userPrompt } = args;
  const name = `${rootPerson.firstName ?? ""} ${rootPerson.lastName ?? ""}`.trim() || "(unnamed)";
  const lines: string[] = [];
  lines.push(`Root person: ${name}`);
  lines.push(`Root person UUID: ${rootPerson.id}`);
  lines.push("");
  if (rootRelationships.length === 0) {
    lines.push("The root person has no existing family relationships.");
  } else {
    lines.push("Existing family relationships for the root person (all UUIDs included):");
    for (const r of rootRelationships) {
      const label = FAMILY_RELATIONSHIP_LABELS[r.familyRelationshipType] ?? r.familyRelationshipType;
      lines.push(
        `  • relationshipId=${r.relationshipId}: ${name} → ${r.toPersonName || "(unnamed)"} (${r.toPersonUuid}) as "${label}" [${r.familyRelationshipType}]`,
      );
    }
  }
  lines.push("");
  lines.push("User prompt:");
  lines.push(userPrompt.trim());
  lines.push("");
  lines.push("Produce the JSON described in the system prompt.");
  return lines.join("\n");
}

// ────────────────────────────────────────────────────────────────────────────
// JSON extraction (the model sometimes wraps it in fences or prose)
// ────────────────────────────────────────────────────────────────────────────

function extractJsonObject(text: string): unknown {
  if (!text) return null;
  // Strip fenced blocks first.
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fenceMatch?.[1] ?? text).trim();
  // Find the first '{' and try progressively shorter slices ending at the
  // last '}' until JSON.parse succeeds.
  const start = candidate.indexOf("{");
  if (start < 0) return null;
  for (let end = candidate.lastIndexOf("}"); end > start; end = candidate.lastIndexOf("}", end - 1)) {
    const slice = candidate.slice(start, end + 1);
    try { return JSON.parse(slice); } catch { /* keep looking */ }
  }
  return null;
}

// ────────────────────────────────────────────────────────────────────────────
// Validation / enrichment of proposed changes
// ────────────────────────────────────────────────────────────────────────────

function isFamilyType(v: unknown): v is FamilyRelationshipType {
  return typeof v === "string" && (FAMILY_RELATIONSHIP_TYPES as readonly string[]).includes(v);
}

async function enrichChanges(
  raw: unknown,
  allowDeletions: boolean,
): Promise<{ changes: ProposedFamilyChange[]; notes: string }> {
  const out: ProposedFamilyChange[] = [];
  if (!raw || typeof raw !== "object") return { changes: out, notes: "" };
  const obj = raw as Record<string, unknown>;
  const notes = typeof obj.notes === "string" ? obj.notes.slice(0, 2000) : "";
  const list = Array.isArray(obj.changes) ? obj.changes : [];

  // Local cache to avoid re-fetching the same person.
  const personCache = new Map<string, any>();
  async function fetchPerson(id: string): Promise<any | null> {
    if (personCache.has(id)) return personCache.get(id);
    const p = await storage.getPersonById(id);
    personCache.set(id, p ?? null);
    return p ?? null;
  }
  function nameOf(p: any | null): string {
    if (!p) return "";
    return `${p.firstName ?? ""} ${p.lastName ?? ""}`.trim();
  }

  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const it = item as Record<string, unknown>;
    const kind = it.kind;

    if (kind === "delete") {
      if (!allowDeletions) continue;
      const relationshipId = typeof it.relationshipId === "string" ? it.relationshipId : "";
      if (!relationshipId) continue;
      const rel = await storage.getRelationshipById(relationshipId);
      if (!rel || !rel.familyRelationshipType) continue;
      const [fromP, toP] = await Promise.all([fetchPerson(rel.fromPersonId), fetchPerson(rel.toPersonId)]);
      out.push({
        kind: "delete",
        relationshipId,
        fromPersonId: rel.fromPersonId,
        fromPersonName: nameOf(fromP),
        toPersonId: rel.toPersonId,
        toPersonName: nameOf(toP),
        currentType: rel.familyRelationshipType,
        reason: typeof it.reason === "string" ? it.reason : undefined,
      });
      continue;
    }

    if (kind === "edit") {
      const relationshipId = typeof it.relationshipId === "string" ? it.relationshipId : "";
      const newType = it.familyRelationshipType;
      if (!relationshipId || !isFamilyType(newType)) continue;
      const rel = await storage.getRelationshipById(relationshipId);
      if (!rel || !rel.familyRelationshipType) continue;
      if (rel.familyRelationshipType === newType) continue; // no-op
      const [fromP, toP] = await Promise.all([fetchPerson(rel.fromPersonId), fetchPerson(rel.toPersonId)]);
      out.push({
        kind: "edit",
        relationshipId,
        fromPersonId: rel.fromPersonId,
        fromPersonName: nameOf(fromP),
        toPersonId: rel.toPersonId,
        toPersonName: nameOf(toP),
        currentType: rel.familyRelationshipType,
        familyRelationshipType: newType,
        reason: typeof it.reason === "string" ? it.reason : undefined,
      });
      continue;
    }

    if (kind === "add") {
      const fromPersonId = typeof it.fromPersonId === "string" ? it.fromPersonId : "";
      const newType = it.familyRelationshipType;
      if (!fromPersonId || !isFamilyType(newType)) continue;
      const fromP = await fetchPerson(fromPersonId);
      if (!fromP) continue;

      // Existing target.
      const toPersonId = typeof it.toPersonId === "string" ? it.toPersonId : "";
      if (toPersonId) {
        if (toPersonId === fromPersonId) continue;
        const toP = await fetchPerson(toPersonId);
        if (!toP) continue;
        // Skip duplicates that already match exactly.
        const existing = await storage.findFamilyRelationship(fromPersonId, toPersonId);
        if (existing && existing.familyRelationshipType === newType) continue;
        out.push({
          kind: "add",
          fromPersonId,
          fromPersonName: nameOf(fromP),
          toPersonId,
          toPersonName: nameOf(toP),
          familyRelationshipType: newType,
          reason: typeof it.reason === "string" ? it.reason : undefined,
        });
        continue;
      }

      // New person target.
      const np = it.newPerson;
      if (np && typeof np === "object") {
        const firstName = typeof (np as any).firstName === "string" ? (np as any).firstName.trim() : "";
        const lastName = typeof (np as any).lastName === "string" ? (np as any).lastName.trim() : "";
        if (firstName) {
          out.push({
            kind: "add",
            fromPersonId,
            fromPersonName: nameOf(fromP),
            familyRelationshipType: newType,
            newPerson: { firstName, ...(lastName ? { lastName } : {}) },
            reason: typeof it.reason === "string" ? it.reason : undefined,
          });
        }
      }
    }
  }

  return { changes: out, notes };
}

// ────────────────────────────────────────────────────────────────────────────
// Main entry point
// ────────────────────────────────────────────────────────────────────────────

const MAX_ITERATIONS = 6;
const OVERALL_TIMEOUT_MS = 5 * 60 * 1000;

export async function generateFamilyTreeChanges(
  params: GenerateFamilyChangesParams,
): Promise<GenerateFamilyChangesResult> {
  const { personId, prompt, allowDeletions, askForChanges, ollama, model } = params;

  const rootPerson = await storage.getPersonById(personId);
  if (!rootPerson) throw new Error("Root person not found");

  const rootRelationships = ((rootPerson as any).relationships ?? [])
    .filter((r: any) => r.familyRelationshipType)
    .map((r: any) => ({
      relationshipId: r.id,
      toPersonUuid: r.toPersonId,
      toPersonName: `${r.toPerson?.firstName ?? ""} ${r.toPerson?.lastName ?? ""}`.trim(),
      familyRelationshipType: r.familyRelationshipType,
    }));

  const systemPrompt = buildSystemPrompt(allowDeletions, askForChanges);
  const userPrompt = buildContextPrompt({ rootPerson, rootRelationships, userPrompt: prompt });

  const messages: Array<Record<string, unknown>> = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt },
  ];

  const overall = new AbortController();
  const overallTimer = setTimeout(() => overall.abort(), OVERALL_TIMEOUT_MS);

  let finalText = "";
  let iter = 0;
  try {
    for (iter = 0; iter < MAX_ITERATIONS; iter++) {
      let resp: Response;
      try {
        resp = await fetch(`${ollama.base}/api/chat`, {
          method: "POST",
          headers: { ...ollama.headers, "Content-Type": "application/json" },
          body: JSON.stringify({
            model,
            messages,
            stream: false,
            tools: FAMILY_TREE_TOOLS,
          }),
          signal: overall.signal,
        });
      } catch (err: any) {
        throw new Error(`Failed to reach Ollama: ${err?.message ?? "unknown error"}`);
      }
      if (!resp.ok) {
        const text = await resp.text().catch(() => "");
        throw new Error(`Ollama returned ${resp.status}: ${text.slice(0, 200)}`);
      }
      const body = await resp.json().catch(() => null) as any;
      const message = body?.message ?? {};
      const toolCalls = Array.isArray(message.tool_calls) ? message.tool_calls : [];

      if (toolCalls.length === 0) {
        finalText = typeof message.content === "string" ? message.content : "";
        break;
      }

      // Persist the assistant tool-call turn.
      messages.push({
        role: "assistant",
        content: typeof message.content === "string" ? message.content : "",
        tool_calls: toolCalls,
      });

      for (const tc of toolCalls) {
        const fn = tc?.function ?? {};
        const name = typeof fn.name === "string" ? fn.name : "";
        let rawArgs: unknown = fn.arguments;
        if (typeof rawArgs === "string") {
          try { rawArgs = JSON.parse(rawArgs); } catch { rawArgs = {}; }
        }
        const args = (rawArgs && typeof rawArgs === "object" && !Array.isArray(rawArgs))
          ? (rawArgs as Record<string, unknown>)
          : {};
        let result: unknown;
        try {
          if (name === "search_people") result = await handleSearchPeople(args);
          else if (name === "get_family_relationships") result = await handleGetFamilyRelationships(args);
          else result = { error: `Unknown tool: ${name}` };
        } catch (err: any) {
          result = { error: err?.message ?? "tool failed" };
        }
        messages.push({ role: "tool", name, content: JSON.stringify(result) });
      }
    }
  } finally {
    clearTimeout(overallTimer);
  }

  if (!finalText) {
    return { changes: [], notes: "Model reached the tool-call limit without producing a final answer.", iterations: iter };
  }
  const parsed = extractJsonObject(finalText);
  const enriched = await enrichChanges(parsed, allowDeletions);
  return { changes: enriched.changes, notes: enriched.notes, iterations: iter };
}

// ────────────────────────────────────────────────────────────────────────────
// Applying changes
// ────────────────────────────────────────────────────────────────────────────

export interface ApplyFamilyTreeChangesResult {
  applied: number;
  failed: number;
  errors: Array<{ index: number; error: string }>;
}

/**
 * Apply a user-curated list of changes (subset of the proposal). Returns
 * a summary of how many succeeded.
 *
 * The caller is expected to have already filtered out any change the user
 * did not approve (i.e. checkbox unchecked in the UI).
 */
export async function applyFamilyTreeChanges(
  changes: ProposedFamilyChange[],
): Promise<ApplyFamilyTreeChangesResult> {
  const result: ApplyFamilyTreeChangesResult = { applied: 0, failed: 0, errors: [] };

  // Look up the "Family" relationship type once.
  const allTypes = await storage.getAllRelationshipTypes();
  const familyType = allTypes.find((t: any) => t.name?.toLowerCase() === "family");
  const familyTypeId = familyType?.id ?? null;

  for (let i = 0; i < changes.length; i++) {
    const change = changes[i];
    try {
      if (change.kind === "add") {
        let targetId = change.toPersonId;
        if (!targetId && change.newPerson) {
          // Create the new person first.
          const created = await storage.createPerson({
            firstName: change.newPerson.firstName,
            lastName: change.newPerson.lastName ?? "",
          } as any);
          targetId = created.id;
        }
        if (!targetId) throw new Error("Missing target person");
        if (targetId === change.fromPersonId) throw new Error("Cannot relate a person to themselves");

        const existing = await storage.findFamilyRelationship(change.fromPersonId, targetId);
        if (existing) {
          if (existing.familyRelationshipType !== change.familyRelationshipType) {
            // Treat as an edit instead of a duplicate insert.
            await storage.updateRelationship(existing.id, {
              familyRelationshipType: change.familyRelationshipType,
            });
            const inverseType = FAMILY_RELATIONSHIP_INVERSES[change.familyRelationshipType];
            if (inverseType) {
              const inverse = await storage.findFamilyRelationship(targetId, change.fromPersonId);
              if (inverse) {
                await storage.updateRelationship(inverse.id, {
                  familyRelationshipType: inverseType as FamilyRelationshipType,
                });
              }
            }
            await storage.propagateFamilyRelationship(existing.id);
          }
        } else {
          await storage.createFamilyRelationshipWithInverse({
            fromPersonId: change.fromPersonId,
            toPersonId: targetId,
            familyRelationshipType: change.familyRelationshipType,
            typeId: familyTypeId,
            notes: null,
          } as any);
        }
        result.applied++;
        continue;
      }

      if (change.kind === "edit") {
        const rel = await storage.getRelationshipById(change.relationshipId);
        if (!rel) throw new Error("Relationship not found");
        await storage.updateRelationship(change.relationshipId, {
          familyRelationshipType: change.familyRelationshipType,
        });
        const inverseType = FAMILY_RELATIONSHIP_INVERSES[change.familyRelationshipType];
        if (inverseType && rel.toPersonId && rel.fromPersonId) {
          const inverse = await storage.findFamilyRelationship(rel.toPersonId, rel.fromPersonId);
          if (inverse) {
            await storage.updateRelationship(inverse.id, {
              familyRelationshipType: inverseType as FamilyRelationshipType,
            });
          }
        }
        await storage.propagateFamilyRelationship(change.relationshipId);
        result.applied++;
        continue;
      }

      if (change.kind === "delete") {
        const rel = await storage.getRelationshipById(change.relationshipId);
        if (!rel) throw new Error("Relationship not found");
        if (rel.familyRelationshipType) {
          const inverse = await storage.findFamilyRelationship(rel.toPersonId, rel.fromPersonId);
          if (inverse) await storage.deleteRelationship(inverse.id);
        }
        await storage.deleteRelationship(change.relationshipId);
        result.applied++;
        continue;
      }
    } catch (err: any) {
      result.failed++;
      result.errors.push({ index: i, error: err?.message ?? "unknown error" });
    }
  }

  return result;
}
