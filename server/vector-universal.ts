import { QdrantClient } from "@qdrant/js-client-rest";
import { sql, eq } from "drizzle-orm";
import { randomUUID } from "crypto";
import { db } from "./db";
import { storage } from "./storage";
import {
  people,
  groups,
  photos,
  notes,
  interactions,
  socialAccounts,
  dailyNotes,
  aiChats,
  type AiChatMessage,
} from "@shared/schema";
import { embedText, loadVectorConfig, getVectorSetting, setVectorSetting, type VectorConfig } from "./vector";

// ── Types ────────────────────────────────────────────────────────────────────

export type UniversalEntityType =
  | "person"
  | "group"
  | "image"
  | "note"
  | "interaction"
  | "social_account"
  | "daily_note"
  | "ai_chat";

export type UniversalSearchResult = {
  type: UniversalEntityType;
  entityId: string;
  title: string;
  snippet: string;
  score: number;
  createdAt?: string;
  meta?: Record<string, unknown>;
};

// ── Config ───────────────────────────────────────────────────────────────────

const DEFAULT_UNIVERSAL_COLLECTION = "prm_universal";

export async function loadUniversalVectorConfig() {
  const baseConfig = await loadVectorConfig();
  return {
    ...baseConfig,
    universalEnabled: (await getVectorSetting("vector_universal_enabled")) === "true",
    universalCollection:
      (await getVectorSetting("vector_universal_collection")) ?? DEFAULT_UNIVERSAL_COLLECTION,
  };
}

// ── Qdrant client (shared logic from vector.ts) ──────────────────────────────

function buildClient(cfg: VectorConfig): QdrantClient {
  if (!cfg.qdrantUrl) throw new Error("Qdrant URL is not configured.");
  let parsed: URL;
  try {
    parsed = new URL(cfg.qdrantUrl);
  } catch {
    throw new Error(`Invalid Qdrant URL: "${cfg.qdrantUrl}"`);
  }
  const isHttps = parsed.protocol === "https:";
  const defaultPort = isHttps ? 443 : 6333;
  const port = parsed.port ? parseInt(parsed.port, 10) : defaultPort;
  const prefix = parsed.pathname !== "/" ? parsed.pathname.replace(/\/$/, "") : undefined;
  return new QdrantClient({
    host: parsed.hostname,
    https: isHttps,
    port,
    ...(prefix ? { prefix } : {}),
    apiKey: cfg.qdrantApiKey || undefined,
    checkCompatibility: false,
  });
}

async function ensureCollection(client: QdrantClient, name: string, vectorSize: number): Promise<void> {
  try {
    await client.getCollection(name);
  } catch {
    await client.createCollection(name, {
      vectors: { size: vectorSize, distance: "Cosine" },
    });
  }
}

// ── Text composition per entity type ─────────────────────────────────────────

export function composeTextForEntity(type: UniversalEntityType, data: Record<string, any>): string {
  const truncate = (s: string, maxLen = 2000) => s.slice(0, maxLen);

  switch (type) {
    case "person": {
      const parts: string[] = [];
      const name = [data.firstName, data.lastName].filter(Boolean).join(" ");
      if (name) parts.push(name);
      if (data.company) parts.push(data.company);
      if (data.title) parts.push(data.title);
      if (data.tags && Array.isArray(data.tags) && data.tags.length > 0) {
        parts.push(data.tags.join(", "));
      }
      if (data.email) parts.push(data.email);
      if (data.phone) parts.push(data.phone);
      return truncate(parts.join(" | "));
    }

    case "group": {
      const parts: string[] = [];
      if (data.name) parts.push(data.name);
      if (data.type && Array.isArray(data.type) && data.type.length > 0) {
        parts.push(data.type.join(", "));
      }
      if (data.memberNames && Array.isArray(data.memberNames) && data.memberNames.length > 0) {
        parts.push("Members: " + data.memberNames.join(", "));
      }
      return truncate(parts.join(" | "));
    }

    case "image": {
      return truncate(data.imageDescription || "");
    }

    case "note": {
      return truncate(data.content || "");
    }

    case "interaction": {
      const parts: string[] = [];
      if (data.title) parts.push(data.title);
      if (data.description) parts.push(data.description);
      if (data.peopleNames && Array.isArray(data.peopleNames) && data.peopleNames.length > 0) {
        parts.push("People: " + data.peopleNames.join(", "));
      }
      if (data.typeName) parts.push("Type: " + data.typeName);
      return truncate(parts.join(" | "));
    }

    case "social_account": {
      const parts: string[] = [];
      if (data.username) parts.push(data.username);
      if (data.bio) parts.push(data.bio);
      if (data.nickname) parts.push(data.nickname);
      if (data.platformName) parts.push(data.platformName);
      return truncate(parts.join(" | "));
    }

    case "daily_note": {
      const parts: string[] = [];
      if (data.userTitle) parts.push(data.userTitle);
      if (data.body) parts.push(data.body);
      if (data.events && Array.isArray(data.events) && data.events.length > 0) {
        parts.push(data.events.map((e: any) => e.text).filter(Boolean).join("\n"));
      }
      return truncate(parts.join("\n\n").trim());
    }

    case "ai_chat": {
      const parts: string[] = [];
      if (data.title) parts.push(data.title);
      if (data.systemMessage) parts.push(data.systemMessage);
      if (data.messages && Array.isArray(data.messages)) {
        const msgTexts = (data.messages as AiChatMessage[])
          .map((m) => m.content)
          .filter(Boolean);
        parts.push(msgTexts.join("\n"));
      }
      return truncate(parts.join("\n\n").trim());
    }

    default:
      return "";
  }
}

// ── Get title for display ────────────────────────────────────────────────────

function getTitleForEntity(type: UniversalEntityType, data: Record<string, any>): string {
  switch (type) {
    case "person":
      return [data.firstName, data.lastName].filter(Boolean).join(" ") || "Unknown";
    case "group":
      return data.name || "Unnamed Group";
    case "image":
      return data.imageDescription?.slice(0, 60) || "Image";
    case "note":
      return data.content?.slice(0, 60) || "Note";
    case "interaction":
      return data.title || "Interaction";
    case "social_account":
      return data.username || "Account";
    case "daily_note":
      return data.userTitle || data.date || "Daily Note";
    case "ai_chat":
      return data.title || "Chat";
    default:
      return "Unknown";
  }
}

// ── Core operations ──────────────────────────────────────────────────────────

/**
 * Embeds and upserts an entity vector into the universal Qdrant collection.
 * Returns the point ID used.
 */
export async function upsertEntityVector(
  type: UniversalEntityType,
  entityId: string,
  data: Record<string, any>,
  existingVectorId?: string | null
): Promise<string> {
  const cfg = await loadUniversalVectorConfig();
  if (!cfg.universalEnabled) throw new Error("Universal vector storage is disabled.");
  if (!cfg.qdrantUrl) throw new Error("Qdrant URL is not configured.");

  const text = composeTextForEntity(type, data);
  if (!text) throw new Error(`No text to embed for ${type} ${entityId}`);

  const vector = await embedText(text, cfg.embeddingModel);
  const client = buildClient(cfg);
  await ensureCollection(client, cfg.universalCollection, vector.length);

  const pointId =
    existingVectorId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(existingVectorId)
      ? existingVectorId
      : randomUUID();

  const title = getTitleForEntity(type, data);
  const snippet = text.slice(0, 200);

  await client.upsert(cfg.universalCollection, {
    wait: true,
    points: [
      {
        id: pointId,
        vector,
        payload: {
          type,
          entity_id: entityId,
          title,
          snippet,
          created_at: data.createdAt ? new Date(data.createdAt).toISOString() : new Date().toISOString(),
          meta: data.meta || {},
        },
      },
    ],
  });

  // Update the vector_id and vector_synced_at on the source table
  const now = new Date();
  const tableMap: Record<UniversalEntityType, any> = {
    person: people,
    group: groups,
    image: photos,
    note: notes,
    interaction: interactions,
    social_account: socialAccounts,
    daily_note: dailyNotes,
    ai_chat: aiChats,
  };

  const table = tableMap[type];
  if (table) {
    await db
      .update(table)
      .set({ vectorId: pointId, vectorSyncedAt: now })
      .where(eq(table.id, entityId));
  }

  return pointId;
}

/**
 * Removes an entity's vector from the universal Qdrant collection.
 */
export async function deleteEntityVector(type: UniversalEntityType, vectorId: string | null | undefined): Promise<void> {
  if (!vectorId) return;
  const cfg = await loadUniversalVectorConfig();
  if (!cfg.qdrantUrl) return;
  try {
    const client = buildClient(cfg);
    await client.delete(cfg.universalCollection, { points: [vectorId], wait: true });
  } catch (err: any) {
    console.warn(`[vector-universal] deleteEntityVector(${type}, ${vectorId}) failed:`, err?.message ?? err);
  }
}

/**
 * Searches the universal collection with semantic similarity.
 */
export async function searchUniversal(
  query: string,
  limit = 20,
  typeFilter?: UniversalEntityType[]
): Promise<UniversalSearchResult[]> {
  const cfg = await loadUniversalVectorConfig();
  if (!cfg.universalEnabled) throw new Error("Universal vector storage is disabled.");

  const vector = await embedText(query, cfg.embeddingModel);
  const client = buildClient(cfg);
  await ensureCollection(client, cfg.universalCollection, vector.length);

  const filter = typeFilter && typeFilter.length > 0
    ? { must: [{ key: "type", match: { any: typeFilter } }] }
    : undefined;

  const result = await client.search(cfg.universalCollection, {
    vector,
    limit,
    with_payload: true,
    filter,
  });

  return result.map((r) => ({
    type: (r.payload?.type as UniversalEntityType) || "person",
    entityId: (r.payload?.entity_id as string) || "",
    title: (r.payload?.title as string) || "",
    snippet: (r.payload?.snippet as string) || "",
    score: r.score,
    createdAt: r.payload?.created_at as string | undefined,
    meta: (r.payload?.meta as Record<string, unknown>) || {},
  }));
}

/**
 * Fire-and-forget background sync for a single entity.
 * Failures are swallowed (logged) so vectorization never blocks CRUD.
 */
export function syncEntityInBackground(type: UniversalEntityType, entityId: string): void {
  void (async () => {
    try {
      const cfg = await loadUniversalVectorConfig();
      if (!cfg.universalEnabled || !cfg.qdrantUrl || !cfg.embeddingModel) return;

      const data = await loadEntityData(type, entityId);
      if (!data) return;

      await upsertEntityVector(type, entityId, data, data.vectorId);
    } catch (err: any) {
      console.warn("[vector-universal] background sync for " + type + "/" + entityId + " failed:", err?.message ?? err);
    }
  })();
}

/**
 * Loads entity data from the database for vectorization.
 */
async function loadEntityData(type: UniversalEntityType, entityId: string): Promise<Record<string, any> | null> {
  switch (type) {
    case "person": {
      const [row] = await db.select().from(people).where(eq(people.id, entityId));
      return row || null;
    }
    case "group": {
      const [row] = await db.select().from(groups).where(eq(groups.id, entityId));
      if (!row) return null;
      // Resolve member names
      let memberNames: string[] = [];
      if (row.members && row.members.length > 0) {
        const memberRows = await db.select({ firstName: people.firstName, lastName: people.lastName })
          .from(people)
          .where(sql`id = ANY(${row.members})`);
        memberNames = memberRows.map(m => `${m.firstName} ${m.lastName}`);
      }
      return { ...row, memberNames };
    }
    case "image": {
      const [row] = await db.select().from(photos).where(eq(photos.id, entityId));
      return row || null;
    }
    case "note": {
      const [row] = await db.select().from(notes).where(eq(notes.id, entityId));
      if (!row) return null;
      return { ...row, meta: { personId: row.personId } };
    }
    case "interaction": {
      const [row] = await db.select().from(interactions).where(eq(interactions.id, entityId));
      if (!row) return null;
      // Resolve people names
      let peopleNames: string[] = [];
      if (row.peopleIds && row.peopleIds.length > 0) {
        const peopleRows = await db.select({ firstName: people.firstName, lastName: people.lastName })
          .from(people)
          .where(sql`id = ANY(${row.peopleIds})`);
        peopleNames = peopleRows.map(p => `${p.firstName} ${p.lastName}`);
      }
      // Resolve type name
      let typeName = "";
      if (row.typeId) {
        const typeRow = await db.query.interactionTypes.findFirst({ where: (t, { eq }) => eq(t.id, row.typeId!) });
        typeName = typeRow?.name || "";
      }
      return { ...row, peopleNames, typeName };
    }
    case "social_account": {
      const [row] = await db.select().from(socialAccounts).where(eq(socialAccounts.id, entityId));
      if (!row) return null;
      // Get current profile for bio/nickname
      const profile = await db.query.socialProfileVersions.findFirst({
        where: (t, { eq, and }) => and(eq(t.socialAccountId, entityId), eq(t.isCurrent, true)),
      });
      // Get platform name
      let platformName = "";
      if (row.typeId) {
        const typeRow = await db.query.socialAccountTypes.findFirst({ where: (t, { eq }) => eq(t.id, row.typeId!) });
        platformName = typeRow?.name || "";
      }
      return {
        ...row,
        bio: profile?.bio || "",
        nickname: profile?.nickname || "",
        platformName,
      };
    }
    case "daily_note": {
      const full = await storage.getDailyNoteById(entityId);
      if (!full) return null;
      return { ...full };
    }
    case "ai_chat": {
      const [row] = await db.select().from(aiChats).where(eq(aiChats.id, entityId));
      return row || null;
    }
    default:
      return null;
  }
}

/**
 * Bulk sync all entities. Returns progress info.
 */
export async function bulkSyncAll(
  onProgress?: (processed: number, total: number, failed: number) => void
): Promise<{ processed: number; failed: number; total: number; errors: string[] }> {
  const cfg = await loadUniversalVectorConfig();
  if (!cfg.universalEnabled) throw new Error("Universal vector storage is disabled.");

  let processed = 0;
  let failed = 0;
  const errors: string[] = [];

  // Define all entity types and their tables
  const entitySources: { type: UniversalEntityType; table: any }[] = [
    { type: "person", table: people },
    { type: "group", table: groups },
    { type: "image", table: photos },
    { type: "note", table: notes },
    { type: "interaction", table: interactions },
    { type: "social_account", table: socialAccounts },
    { type: "daily_note", table: dailyNotes },
    { type: "ai_chat", table: aiChats },
  ];

  // Count total entities that need syncing
  let totalCount = 0;
  const entityIds: { type: UniversalEntityType; ids: string[] }[] = [];

  for (const { type, table } of entitySources) {
    const rows = await db
      .select({ id: table.id })
      .from(table)
      .where(sql`vector_synced_at IS NULL`);
    entityIds.push({ type, ids: rows.map((r: any) => r.id) });
    totalCount += rows.length;
  }

  // Process in sequence (throttled to avoid overwhelming Ollama)
  for (const { type, ids } of entityIds) {
    for (const id of ids) {
      try {
        const data = await loadEntityData(type, id);
        if (!data) continue;
        const text = composeTextForEntity(type, data);
        if (!text) continue;
        await upsertEntityVector(type, id, data, data.vectorId);
        processed++;
      } catch (e: any) {
        failed++;
        if (errors.length < 10) errors.push(`${type}/${id}: ${e?.message ?? String(e)}`);
      }
      if (onProgress) onProgress(processed + failed, totalCount, failed);
    }
  }

  return { processed, failed, total: totalCount, errors };
}

/**
 * Get the status of the universal vector collection.
 */
export async function getUniversalStatus(): Promise<{
  enabled: boolean;
  collectionReady: boolean;
  pointCount: number;
}> {
  const cfg = await loadUniversalVectorConfig();
  if (!cfg.universalEnabled || !cfg.qdrantUrl) {
    return { enabled: cfg.universalEnabled, collectionReady: false, pointCount: 0 };
  }
  try {
    const client = buildClient(cfg);
    const info = await client.getCollection(cfg.universalCollection);
    return {
      enabled: true,
      collectionReady: true,
      pointCount: info.points_count ?? 0,
    };
  } catch {
    return { enabled: cfg.universalEnabled, collectionReady: false, pointCount: 0 };
  }
}
