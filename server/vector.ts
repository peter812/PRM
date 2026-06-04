import { QdrantClient } from "@qdrant/js-client-rest";
import { sql, eq } from "drizzle-orm";
import { randomUUID } from "crypto";
import { db } from "./db";
import { dailyNotes, type DailyNoteWithDetails } from "@shared/schema";

// ── Settings helpers (key/value app_settings, mirrors getOllamaSetting) ─────

export async function getVectorSetting(key: string): Promise<string | null> {
  const row = await db.query.appSettings?.findFirst({ where: (t, { eq }) => eq(t.key, key) });
  return row?.value ?? null;
}

export async function setVectorSetting(key: string, value: string): Promise<void> {
  await db.execute(
    sql`INSERT INTO app_settings (key, value) VALUES (${key}, ${value})
        ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`
  );
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

// ── Ollama settings (read-only — owned by routes.ts) ─────────────────────────
// Reuse the same app_settings keys the Intelligence settings page writes.

async function getOllamaSetting(key: string): Promise<string | null> {
  const row = await db.query.appSettings?.findFirst({ where: (t, { eq }) => eq(t.key, key) });
  return row?.value ?? null;
}

async function getOllamaAuthHeaders(): Promise<Record<string, string>> {
  const headers: Record<string, string> = {};
  const authRequired = (await getOllamaSetting("ollama_auth_required")) === "true";
  if (authRequired) {
    const username = (await getOllamaSetting("ollama_username")) ?? "";
    const password = (await getOllamaSetting("ollama_password")) ?? "";
    headers["Authorization"] = "Basic " + Buffer.from(`${username}:${password}`).toString("base64");
  }
  return headers;
}

async function getOllamaBase(): Promise<string> {
  const apiUrl = (await getOllamaSetting("ollama_api_url")) ?? "";
  return apiUrl.replace(/\/+$/, "");
}

// ── Embeddings (Ollama /api/embeddings) ──────────────────────────────────────

export async function embedText(text: string, model?: string): Promise<number[]> {
  const base = await getOllamaBase();
  if (!base) throw new Error("Ollama API URL is not configured. Configure it on the Intelligence settings page.");
  const cfg = await loadVectorConfig();
  const useModel = model || cfg.embeddingModel;
  if (!useModel) throw new Error("No embedding model selected. Choose one on the Vector Storage settings page.");
  const headers: Record<string, string> = { "Content-Type": "application/json", ...(await getOllamaAuthHeaders()) };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  try {
    const resp = await fetch(`${base}/api/embeddings`, {
      method: "POST",
      headers,
      body: JSON.stringify({ model: useModel, prompt: text }),
      signal: controller.signal,
    });
    if (!resp.ok) {
      const body = await resp.text();
      throw new Error(`Ollama embeddings failed (${resp.status}): ${body.slice(0, 200)}`);
    }
    const data = (await resp.json()) as { embedding?: number[] };
    if (!Array.isArray(data.embedding) || data.embedding.length === 0) {
      throw new Error("Ollama returned an empty embedding. The selected model may not support embeddings.");
    }
    return data.embedding;
  } finally {
    clearTimeout(timeout);
  }
}

// ── Qdrant client ────────────────────────────────────────────────────────────

function buildClient(cfg: VectorConfig): QdrantClient {
  if (!cfg.qdrantUrl) throw new Error("Qdrant URL is not configured.");
  return new QdrantClient({
    url: cfg.qdrantUrl,
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

// ── Public operations ────────────────────────────────────────────────────────

export type VectorSearchHit = {
  id: string | number;
  score: number;
  payload: Record<string, unknown>;
};

export function composeDailyNoteText(note: DailyNoteWithDetails): string {
  const parts: string[] = [];
  if (note.userTitle) parts.push(note.userTitle);
  if (note.body) parts.push(note.body);
  if (note.events && note.events.length > 0) {
    parts.push(note.events.map(e => e.text).filter(Boolean).join("\n"));
  }
  return parts.join("\n\n").trim();
}

/**
 * Embeds a daily note and upserts it into Qdrant. On success, persists
 * `vector_id` and `vector_synced_at` on the daily_notes row so subsequent
 * edits update the same point instead of creating duplicates.
 */
export async function upsertDailyNoteVector(note: DailyNoteWithDetails): Promise<string> {
  const cfg = await loadVectorConfig();
  if (!cfg.enabled) throw new Error("Vector storage is disabled.");
  const text = composeDailyNoteText(note);
  if (!text) throw new Error("Daily note has no text to embed.");

  const vector = await embedText(text, cfg.embeddingModel);
  const client = buildClient(cfg);
  await ensureCollection(client, cfg.collectionName, vector.length);

  // Reuse existing vector id if we have one; otherwise mint a fresh UUID.
  // Qdrant point IDs must be either an unsigned integer or a UUID.
  const pointId = note.vectorId && /^[0-9a-f-]{36}$/i.test(note.vectorId) ? note.vectorId : randomUUID();

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
  const vector = await embedText(query, cfg.embeddingModel);
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
        const v = await embedText("PRM vector connectivity probe", cfg.embeddingModel);
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
    return { ok: false, message: `Qdrant connection failed: ${err?.message ?? err}` };
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
      // Pull full details (events, parties) via a fresh query to avoid an import cycle.
      const { storage } = await import("./storage");
      const full = await storage.getDailyNoteById(noteId);
      if (!full) return;
      await upsertDailyNoteVector(full);
    } catch (err: any) {
      console.warn(`[vector] background sync for ${noteId} failed:`, err?.message ?? err);
    }
  })();
}
