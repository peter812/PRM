import { QdrantClient } from "@qdrant/js-client-rest";
import { sql, eq } from "drizzle-orm";
import { randomUUID } from "crypto";
import { db } from "./db";
import { dailyNotes, type DailyNoteWithDetails } from "@shared/schema";
import { storage } from "./storage";
import { embed, resolveModel, type ResolvedModel } from "./ai/provider";

// ── Settings helpers (delegates to storage) ─────────────────────────────────

export async function getVectorSetting(key: string): Promise<string | null> {
  return storage.getAppSetting(key);
}

export async function setVectorSetting(key: string, value: string): Promise<void> {
  await storage.setAppSetting(key, value);
}

export type VectorConfig = {
  enabled: boolean;
  qdrantUrl: string;
  qdrantApiKey: string;
  collectionName: string;
  embeddingModel: string;
};

const DEFAULT_COLLECTION = "prm_daily_notes";

export async function loadVectorConfig(): Promise<VectorConfig> {
  return {
    enabled: (await getVectorSetting("vector_enabled")) === "true",
    qdrantUrl: (await getVectorSetting("vector_qdrant_url")) ?? "",
    qdrantApiKey: (await getVectorSetting("vector_qdrant_api_key")) ?? "",
    collectionName: (await getVectorSetting("vector_collection")) ?? DEFAULT_COLLECTION,
    embeddingModel: (await getVectorSetting("vector_embedding_model")) ?? "",
  };
}

// ── Embeddings ───────────────────────────────────────────────────────────────

/** Embed text with the configured embedding (provider, model). */
export async function embedText(text: string, model?: ResolvedModel): Promise<number[]> {
  return embed(model ?? await resolveModel("embedding"), text);
}

// ── Qdrant client ────────────────────────────────────────────────────────────

export function buildClient(cfg: VectorConfig): QdrantClient {
  if (!cfg.qdrantUrl) throw new Error("Qdrant URL is not configured.");
  // Parse the URL so we can pass host/port/https explicitly.
  // The @qdrant/js-client-rest `url` param defaults to port 6333 regardless
  // of the scheme, so HTTPS-on-443 URLs silently hit the wrong port.
  let parsed: URL;
  try {
    parsed = new URL(cfg.qdrantUrl);
  } catch {
    throw new Error(`Invalid Qdrant URL: "${cfg.qdrantUrl}"`);
  }
  const isHttps = parsed.protocol === "https:";
  const defaultPort = isHttps ? 443 : 6333;
  const port = parsed.port ? parseInt(parsed.port, 10) : defaultPort;
  // Include any sub-path prefix (e.g. https://host/qdrant → prefix "/qdrant")
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

/** Vector size of an existing collection, or null when it doesn't exist. */
async function collectionSize(client: QdrantClient, name: string): Promise<number | null> {
  try {
    const info = await client.getCollection(name);
    return (info.config?.params?.vectors as { size?: number } | undefined)?.size ?? null;
  } catch {
    return null;
  }
}

function dimensionMismatch(name: string, existing: number, model: number): string {
  return `Qdrant collection "${name}" holds ${existing}-dimension vectors, but the embedding model returns ${model}. ` +
    `Switch back to the previous embedding model, or delete the collection in Qdrant and run Vectorize all.`;
}

/** Create the collection if missing; refuse to write vectors of a different size into an existing one. */
export async function ensureCollection(client: QdrantClient, name: string, vectorSize: number): Promise<void> {
  const existing = await collectionSize(client, name);
  if (existing === null) {
    await client.createCollection(name, { vectors: { size: vectorSize, distance: "Cosine" } });
  } else if (existing !== vectorSize) {
    throw new Error(dimensionMismatch(name, existing, vectorSize));
  }
}

// ── Public operations ────────────────────────────────────────────────────────

export type VectorSearchHit = {
  id: string | number;
  score: number;
  payload: Record<string, unknown>;
};

function composeDailyNoteText(note: DailyNoteWithDetails): string {
  const parts: string[] = [];
  if (note.userTitle) parts.push(note.userTitle);
  if (note.body) parts.push(note.body);
  if (note.events && note.events.length > 0) {
    parts.push(note.events.map(e => e.text).filter(Boolean).join("\n"));
  }
  return parts.join("\n\n").trim();
}

/** Settings, embedding model and client loaded once for a batch of upserts. */
export type VectorRun = { cfg: VectorConfig; model: ResolvedModel; client: QdrantClient; collectionReady?: boolean };

export async function prepareVectorRun(): Promise<VectorRun> {
  const cfg = await loadVectorConfig();
  if (!cfg.enabled) throw new Error("Vector storage is disabled.");
  return { cfg, model: await resolveModel("embedding"), client: buildClient(cfg) };
}

/**
 * Embeds a daily note and upserts it into Qdrant. On success, persists
 * `vector_id` and `vector_synced_at` on the daily_notes row so subsequent
 * edits update the same point instead of creating duplicates.
 */
export async function upsertDailyNoteVector(note: DailyNoteWithDetails, run?: VectorRun): Promise<string> {
  const text = composeDailyNoteText(note);
  if (!text) throw new Error("Daily note has no text to embed.");
  run ??= await prepareVectorRun();
  const { cfg, client } = run;

  const vector = await embedText(text, run.model);
  if (!run.collectionReady) {
    await ensureCollection(client, cfg.collectionName, vector.length);
    run.collectionReady = true;
  }

  // Reuse existing vector id if we have one; otherwise mint a fresh UUID.
  // Qdrant point IDs must be either an unsigned integer or a UUID.
  const pointId =
    note.vectorId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(note.vectorId)
      ? note.vectorId
      : randomUUID();

  await client.upsert(cfg.collectionName, {
    wait: true,
    points: [
      {
        id: pointId,
        vector,
        payload: {
          dailyNoteId: note.id,
          date: note.date,
          userTitle: note.userTitle,
          eventCount: note.events?.length ?? 0,
        },
      },
    ],
  });

  await db
    .update(dailyNotes)
    .set({ vectorId: pointId, vectorSyncedAt: new Date() })
    .where(eq(dailyNotes.id, note.id));

  return pointId;
}

/** Removes a daily note's vector from Qdrant (no-op if not configured / not vectorized). */
export async function deleteDailyNoteVector(noteId: string, vectorId: string | null | undefined): Promise<void> {
  if (!vectorId) return;
  const cfg = await loadVectorConfig();
  if (!cfg.qdrantUrl) return; // silently skip when not configured
  try {
    const client = buildClient(cfg);
    await client.delete(cfg.collectionName, { points: [vectorId], wait: true });
  } catch (err: any) {
    // Collection may not exist yet, or the point may already be gone — log and continue.
    console.warn(`[vector] deleteDailyNoteVector(${noteId}) failed:`, err?.message ?? err);
  }
}

export async function searchDailyNotes(query: string, limit = 10): Promise<VectorSearchHit[]> {
  const cfg = await loadVectorConfig();
  if (!cfg.enabled) throw new Error("Vector storage is disabled.");
  const vector = await embedText(query);
  const client = buildClient(cfg);
  await ensureCollection(client, cfg.collectionName, vector.length);
  const result = await client.search(cfg.collectionName, { vector, limit, with_payload: true });
  return result.map(r => ({
    id: r.id as string | number,
    score: r.score,
    payload: (r.payload ?? {}) as Record<string, unknown>,
  }));
}

export async function testVectorConnection(): Promise<{ ok: boolean; message: string }> {
  const cfg = await loadVectorConfig();
  if (!cfg.qdrantUrl) return { ok: false, message: "Qdrant URL is not configured." };
  try {
    const client = buildClient(cfg);
    const collections = await client.getCollections();
    let embedMessage = "";
    if (cfg.embeddingModel) {
      try {
        const v = await embedText("PRM vector connectivity probe");
        const existing = await collectionSize(client, cfg.collectionName);
        if (existing !== null && existing !== v.length) {
          return { ok: false, message: dimensionMismatch(cfg.collectionName, existing, v.length) };
        }
        embedMessage = ` Embedding model OK (dim=${v.length}).`;
      } catch (e: any) {
        return { ok: false, message: `Qdrant reachable but embedding failed: ${e?.message ?? e}` };
      }
    }
    return {
      ok: true,
      message: `Connected to Qdrant. ${collections.collections.length} collection(s).${embedMessage}`,
    };
  } catch (err: any) {
    const msg = `Qdrant connection failed: ${err?.message ?? err}`;
    console.error("[vector] testVectorConnection error:", msg, err?.cause ?? "");
    return { ok: false, message: msg };
  }
}

/**
 * Fire-and-forget vector sync used from the existing daily-note REST handlers.
 * Failures are swallowed (logged) so vectorization issues never break note writes.
 */
export function syncDailyNoteInBackground(noteId: string): void {
  void (async () => {
    try {
      const cfg = await loadVectorConfig();
      if (!cfg.enabled || !cfg.qdrantUrl || !cfg.embeddingModel) return;
      const [row] = await db.select().from(dailyNotes).where(eq(dailyNotes.id, noteId));
      if (!row) return;
      const full = await storage.getDailyNoteById(noteId);
      if (!full) return;
      await upsertDailyNoteVector(full);
    } catch (err: any) {
      console.warn(`[vector] background sync for ${noteId} failed:`, err?.message ?? err);
    }
  })();
}
