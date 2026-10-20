import type { QdrantClient } from "@qdrant/js-client-rest";
import { sql, eq, inArray, type SQL } from "drizzle-orm";
import { randomUUID } from "crypto";
import { db } from "./db";
import { formatPersonName } from "@shared/person-name";
import { storage } from "./storage";
import {
  people,
  photos,
  notes,
  interactions,
  socialAccounts,
  socialAccountPosts,
  dailyNotes,
  aiChats,
} from "@shared/schema";
import { buildClient, embedText, ensureCollection, loadVectorConfig, getVectorSetting, runPool } from "./vector";
import { listStaleConversationIds, rechunkConversation } from "./message-chunks";

// ── Types ────────────────────────────────────────────────────────────────────

/** Entity types with one point per row; message chunks are managed by message-chunks.ts. */
export type RowEntityType =
  | "person"
  | "image"
  | "note"
  | "interaction"
  | "social_account"
  | "post"
  | "story"
  | "daily_note"
  | "ai_chat";

export type UniversalEntityType = RowEntityType | "message_chunk";

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

// ── Sources ──────────────────────────────────────────────────────────────────

/**
 * Every row-backed type: its table and which rows are eligible for a point.
 * A row that stops being eligible (summary cleared, description removed) has
 * its point removed on the next resync. Shared with the stats endpoint.
 */
export const UNIVERSAL_SOURCES: { type: RowEntityType; table: any; eligible: SQL }[] = [
  { type: "person", table: people, eligible: sql`TRUE` },
  { type: "image", table: photos, eligible: sql`image_description IS NOT NULL AND btrim(image_description) <> ''` },
  { type: "note", table: notes, eligible: sql`TRUE` },
  { type: "interaction", table: interactions, eligible: sql`TRUE` },
  { type: "social_account", table: socialAccounts, eligible: sql`ai_summary IS NOT NULL` },
  { type: "post", table: socialAccountPosts, eligible: sql`ai_summary IS NOT NULL AND post_type <> 'story'` },
  { type: "story", table: socialAccountPosts, eligible: sql`ai_summary IS NOT NULL AND post_type = 'story'` },
  { type: "daily_note", table: dailyNotes, eligible: sql`TRUE` },
  { type: "ai_chat", table: aiChats, eligible: sql`TRUE` },
];

const tableFor = (type: RowEntityType) => UNIVERSAL_SOURCES.find((s) => s.type === type)!.table;

/** Posts and stories share a table; a row's post_type decides which it is. */
const postEntityType = (postType: string | null | undefined): RowEntityType =>
  postType === "story" ? "story" : "post";

// ── Text composition per entity type ─────────────────────────────────────────

/** Account summaries were plain strings before AccountAiSummary. */
function accountSummaryText(summary: unknown): string {
  if (typeof summary === "string") return summary;
  return (summary as { profile?: string } | null)?.profile ?? "";
}

/** A post's overview, or its per-image descriptions when the overview is empty. */
function postSummaryText(summary: unknown): string {
  const s = summary as { overview?: string; images?: { description?: string }[] } | null;
  if (!s) return "";
  if (s.overview?.trim()) return s.overview;
  return (s.images ?? []).map((i) => i.description).filter(Boolean).join("\n");
}

function composeTextForEntity(type: RowEntityType, data: Record<string, any>): string {
  const truncate = (s: string, maxLen = 2000) => s.slice(0, maxLen);

  switch (type) {
    case "person": {
      const parts: string[] = [];
      const name = formatPersonName(data);
      if (name) parts.push(name);
      if (data.maidenName) parts.push(`née ${data.maidenName}`);
      if (data.company) parts.push(data.company);
      if (data.title) parts.push(data.title);
      if (data.tags && Array.isArray(data.tags) && data.tags.length > 0) {
        parts.push(data.tags.join(", "));
      }
      if (data.email) parts.push(data.email);
      if (data.phone) parts.push(data.phone);
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

    // Only summarized accounts get a point: the summary carries the content,
    // the handle and platform keep name searches working.
    case "social_account": {
      const summary = accountSummaryText(data.aiSummary).trim();
      if (!summary) return "";
      const header = [data.username, data.platformName].filter(Boolean).join(" | ");
      return truncate(header ? `${header}\n\n${summary}` : summary);
    }

    // Posts and stories embed their AI summary and nothing else.
    case "post":
    case "story": {
      return truncate(postSummaryText(data.aiSummary).trim());
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
        const msgTexts = (data.messages as any[])
          .filter((m) => m.role === "user" || m.role === "assistant")
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

function getTitleForEntity(type: RowEntityType, data: Record<string, any>): string {
  switch (type) {
    case "person":
      return formatPersonName(data) || "Unknown";
    case "image":
      return data.imageDescription?.slice(0, 60) || "Image";
    case "note":
      return data.content?.slice(0, 60) || "Note";
    case "interaction":
      return data.title || "Interaction";
    case "social_account":
      return data.username || "Account";
    case "post":
      return data.username ? `Post by @${data.username}` : "Post";
    case "story":
      return data.username ? `Story by @${data.username}` : "Story";
    case "daily_note":
      return data.userTitle || data.date || "Daily Note";
    case "ai_chat":
      return data.title || "Chat";
    default:
      return "Unknown";
  }
}

// ── Core operations ──────────────────────────────────────────────────────────

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Client for an enabled universal collection, or null when vectorization is off. */
async function universalClient(): Promise<{ client: QdrantClient; collection: string } | null> {
  const cfg = await loadUniversalVectorConfig();
  if (!cfg.universalEnabled || !cfg.qdrantUrl || !cfg.embeddingModel) return null;
  return { client: buildClient(cfg), collection: cfg.universalCollection };
}

// Filter deletes match on these payload keys; index them once per process.
let payloadIndexesReady = false;
async function ensurePayloadIndexes(client: QdrantClient, collection: string): Promise<void> {
  if (payloadIndexesReady) return;
  for (const field of ["type", "entity_id", "meta.conversation_id", "meta.socialAccountId"]) {
    await client.createPayloadIndex(collection, { field_name: field, field_schema: "keyword", wait: true });
  }
  payloadIndexesReady = true;
}

export type UniversalPoint = {
  id: string;
  type: UniversalEntityType;
  entityId: string;
  text: string;
  title: string;
  createdAt?: Date | string | null;
  meta?: Record<string, unknown>;
};

/** Embeds and upserts one point into the universal collection. */
export async function writeUniversalPoint(point: UniversalPoint): Promise<void> {
  const target = await universalClient();
  if (!target) throw new Error("Universal vector storage is disabled or not configured.");
  const vector = await embedText(point.text);
  await ensureCollection(target.client, target.collection, vector.length);
  await ensurePayloadIndexes(target.client, target.collection);
  await target.client.upsert(target.collection, {
    wait: true,
    points: [
      {
        id: point.id,
        vector,
        payload: {
          type: point.type,
          entity_id: point.entityId,
          title: point.title,
          snippet: point.text.slice(0, 200),
          created_at: point.createdAt ? new Date(point.createdAt).toISOString() : new Date().toISOString(),
          meta: point.meta ?? {},
        },
      },
    ],
  });
}

/** Removes every point matching a payload filter. No-op when vectorization is off. */
export async function deleteUniversalPointsWhere(match: Record<string, string>): Promise<void> {
  const target = await universalClient();
  if (!target) return;
  try {
    await target.client.delete(target.collection, {
      wait: true,
      filter: { must: Object.entries(match).map(([key, value]) => ({ key, match: { value } })) },
    });
  } catch (err: any) {
    // A collection that doesn't exist yet has nothing to delete.
    if (err?.status !== 404) throw err;
  }
}

/**
 * Removes entity vectors from the universal Qdrant collection by point id.
 */
export async function deleteEntityVector(
  type: UniversalEntityType,
  vectorId: string | string[] | null | undefined
): Promise<void> {
  if (!vectorId) return;
  const ids = Array.isArray(vectorId) ? vectorId : [vectorId];
  const validIds = ids.filter(Boolean) as string[];
  if (validIds.length === 0) return;

  const cfg = await loadUniversalVectorConfig();
  if (!cfg.qdrantUrl) return;
  try {
    const client = buildClient(cfg);
    await client.delete(cfg.universalCollection, { points: validIds, wait: true });
  } catch (err: any) {
    console.warn(`[vector-universal] deleteEntityVector(${type}, ${validIds.join(",")}) failed:`, err?.message ?? err);
  }
}

/** Lowest cosine score a search returns. Big message chunks score lower than short entities, so keep this loose. */
export const SEARCH_MIN_SCORE = 0.3;

/**
 * Searches the universal collection with semantic similarity.
 */
export async function searchUniversal(
  query: string,
  limit = 20,
  typeFilter?: UniversalEntityType[],
  minScore = SEARCH_MIN_SCORE
): Promise<UniversalSearchResult[]> {
  const cfg = await loadUniversalVectorConfig();
  if (!cfg.universalEnabled) throw new Error("Universal vector storage is disabled.");

  const vector = await embedText(query);
  const client = buildClient(cfg);
  await ensureCollection(client, cfg.universalCollection, vector.length);

  const mustConditions: any[] = [];
  if (typeFilter && typeFilter.length > 0) {
    mustConditions.push({ key: "type", match: { any: typeFilter } });
  }

  const filter = mustConditions.length > 0 ? { must: mustConditions } : undefined;

  const result = await client.search(cfg.universalCollection, {
    vector,
    limit,
    with_payload: true,
    filter,
    score_threshold: minScore,
  });

  const results = result.map((r) => ({
    type: (r.payload?.type as UniversalEntityType) || "person",
    entityId: (r.payload?.entity_id as string) || "",
    title: (r.payload?.title as string) || "",
    snippet: (r.payload?.snippet as string) || "",
    score: r.score,
    createdAt: r.payload?.created_at as string | undefined,
    meta: (r.payload?.meta as Record<string, unknown>) || {},
  }));
  await addPostThumbnails(results);
  return results;
}

/** Puts each post/story hit's first image in meta.thumbnailUrl, read fresh since CDN URLs change. */
async function addPostThumbnails(results: UniversalSearchResult[]): Promise<void> {
  const hits = results.filter((r) => r.type === "post" || r.type === "story");
  const ids = hits.map((r) => r.entityId).filter((id) => UUID_RE.test(id));
  if (ids.length === 0) return;
  const rows = await db
    .select({ id: socialAccountPosts.id, content: socialAccountPosts.content })
    .from(socialAccountPosts)
    .where(inArray(socialAccountPosts.id, ids));
  const firstImage = new Map<string, string>();
  for (const row of rows) {
    try {
      const images = row.content ? JSON.parse(row.content) : [];
      if (typeof images[0] === "string") firstImage.set(row.id, images[0]);
    } catch {}
  }
  for (const hit of hits) {
    const url = firstImage.get(hit.entityId);
    if (url) hit.meta = { ...hit.meta, thumbnailUrl: url };
  }
}

export type ResyncResult = "upserted" | "removed" | "disabled";

/**
 * Brings one entity's point in line with the database: deletes its old point,
 * then re-adds it if the row still exists and is eligible. Call after any
 * create, edit or delete. For posts the row's post_type picks post vs story.
 */
export async function resyncEntity(type: RowEntityType, entityId: string): Promise<ResyncResult> {
  if (!(await universalClient())) return "disabled";

  const data = await loadEntityData(type, entityId);
  const actualType = data && (type === "post" || type === "story") ? postEntityType(data.postType) : type;

  // Delete first so a point never outlives its row or eligibility — also
  // catches a post re-typed to a story, which keys on a different type.
  await deleteUniversalPointsWhere({ entity_id: entityId });

  const text = data ? composeTextForEntity(actualType, data).trim() : "";
  if (!data || !text) {
    if (data?.vectorId) {
      await db.update(tableFor(actualType)).set({ vectorId: null, vectorSyncedAt: null }).where(eq(tableFor(actualType).id, entityId));
    }
    return "removed";
  }

  const pointId = data.vectorId && UUID_RE.test(data.vectorId) ? data.vectorId : randomUUID();
  await writeUniversalPoint({
    id: pointId,
    type: actualType,
    entityId,
    text,
    title: getTitleForEntity(actualType, data),
    createdAt: data.postedAt ?? data.createdAt,
    meta: data.meta,
  });
  const table = tableFor(actualType);
  await db.update(table).set({ vectorId: pointId, vectorSyncedAt: new Date() }).where(eq(table.id, entityId));
  return "upserted";
}

/** Deletes one entity's point and clears its sync columns; the next Vectorize Everything re-adds it if still eligible. */
export async function removeEntityVector(type: RowEntityType, entityId: string): Promise<ResyncResult> {
  if (!(await universalClient())) return "disabled";
  await deleteUniversalPointsWhere({ entity_id: entityId });
  const table = tableFor(type);
  await db.update(table).set({ vectorId: null, vectorSyncedAt: null }).where(eq(table.id, entityId));
  return "removed";
}

/**
 * Fire-and-forget resyncEntity. Failures are logged so vectorization never
 * blocks CRUD; safe to call after a delete (the point is removed).
 */
export function syncEntityInBackground(type: RowEntityType, entityId: string): void {
  void resyncEntity(type, entityId).catch((err: any) => {
    console.warn("[vector-universal] background sync for " + type + "/" + entityId + " failed:", err?.message ?? err);
  });
}

/** Drops the points of every post and story of an account (call when the account is deleted). */
export function removeAccountPostVectorsInBackground(socialAccountId: string): void {
  void deleteUniversalPointsWhere({ "meta.socialAccountId": socialAccountId }).catch((err: any) => {
    console.warn(`[vector-universal] removing post vectors of account ${socialAccountId} failed:`, err?.message ?? err);
  });
}

/**
 * Loads entity data from the database for vectorization.
 */
async function loadEntityData(type: RowEntityType, entityId: string): Promise<Record<string, any> | null> {
  switch (type) {
    case "person": {
      const [row] = await db.select().from(people).where(eq(people.id, entityId));
      return row || null;
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
      let platformName = "";
      if (row.typeId) {
        const typeRow = await db.query.socialAccountTypes.findFirst({ where: (t, { eq }) => eq(t.id, row.typeId!) });
        platformName = typeRow?.name || "";
      }
      return { ...row, platformName };
    }
    case "post":
    case "story": {
      const [row] = await db
        .select({ post: socialAccountPosts, username: socialAccounts.username })
        .from(socialAccountPosts)
        .innerJoin(socialAccounts, eq(socialAccounts.id, socialAccountPosts.socialAccountId))
        .where(eq(socialAccountPosts.id, entityId));
      if (!row) return null;
      return {
        ...row.post,
        username: row.username,
        meta: { socialAccountId: row.post.socialAccountId, postType: row.post.postType },
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

export type BulkSyncProgress = {
  running: boolean;
  stopRequested: boolean;
  processed: number;
  failed: number;
  total: number;
  errors: string[];
  error: string | null;
  startedAt: string | null;
  finishedAt: string | null;
};

// Single in-process bulk job; the settings page polls it and can request a stop.
const bulkJob: BulkSyncProgress = {
  running: false, stopRequested: false, processed: 0, failed: 0, total: 0,
  errors: [], error: null, startedAt: null, finishedAt: null,
};

export function getBulkSyncProgress(): BulkSyncProgress {
  return { ...bulkJob, errors: [...bulkJob.errors] };
}

export function stopBulkSync(): boolean {
  if (!bulkJob.running) return false;
  bulkJob.stopRequested = true;
  return true;
}

/** Starts bulkSyncAll in the background. Returns false if a run is already active. */
export async function startBulkSync(): Promise<boolean> {
  if (bulkJob.running) return false;
  const cfg = await loadUniversalVectorConfig();
  if (!cfg.universalEnabled) throw new Error("Universal vector storage is disabled.");
  Object.assign(bulkJob, {
    running: true, stopRequested: false, processed: 0, failed: 0, total: 0,
    errors: [], error: null, startedAt: new Date().toISOString(), finishedAt: null,
  });
  void bulkSyncAll((processed, total, failed) => {
    Object.assign(bulkJob, { processed, total, failed });
  }, () => bulkJob.stopRequested)
    .then((r) => { bulkJob.errors = r.errors; })
    .catch((e: any) => { bulkJob.error = e?.message ?? String(e); })
    .finally(() => Object.assign(bulkJob, { running: false, finishedAt: new Date().toISOString() }));
  return true;
}

type BulkWork = { type: RowEntityType; id: string } | { type: "conversation"; id: string };

/**
 * Bulk sync: eligible rows not yet synced, rows holding a point they are no
 * longer eligible for, and conversations whose message chunks are stale.
 */
export async function bulkSyncAll(
  onProgress?: (processed: number, total: number, failed: number) => void,
  shouldStop?: () => boolean,
): Promise<{ processed: number; failed: number; total: number; errors: string[]; stopped: boolean }> {
  const cfg = await loadUniversalVectorConfig();
  if (!cfg.universalEnabled) throw new Error("Universal vector storage is disabled.");

  let processed = 0;
  let failed = 0;
  const errors: string[] = [];

  // Messages used to get one point each; they are chunked now.
  await deleteUniversalPointsWhere({ type: "message" });

  const work: BulkWork[] = [];
  for (const { type, table, eligible } of UNIVERSAL_SOURCES) {
    const rows = await db
      .select({ id: table.id })
      .from(table)
      .where(sql`(vector_synced_at IS NULL AND ${eligible}) OR (vector_id IS NOT NULL AND NOT (${eligible}))`);
    for (const r of rows as { id: string }[]) work.push({ type, id: r.id });
  }
  for (const id of await listStaleConversationIds()) work.push({ type: "conversation", id });

  const totalCount = work.length;
  if (onProgress) onProgress(0, totalCount, 0);

  // `embeddingConcurrency` requests in flight (match OLLAMA_NUM_PARALLEL).
  let done = 0;
  const finished = await runPool(work, cfg.embeddingConcurrency, async ({ type, id }) => {
    try {
      if (type === "conversation") await rechunkConversation(id);
      else await resyncEntity(type, id);
      processed++;
    } catch (e: any) {
      failed++;
      if (errors.length < 10) errors.push(`${type}/${id}: ${e?.message ?? String(e)}`);
    } finally {
      done++;
      if (onProgress) onProgress(done, totalCount, failed);
    }
  }, shouldStop);

  return { processed, failed, total: totalCount, errors, stopped: !finished };
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
