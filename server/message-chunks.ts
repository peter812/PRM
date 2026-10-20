import { createHash, randomUUID } from "crypto";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { db } from "./db";
import { storage } from "./storage";
import { conversations, conversationParticipants, messageChunks, messages, people, socialAccounts } from "@shared/schema";
import { formatPersonName } from "@shared/person-name";
import { getVectorSetting, setVectorSetting } from "./vector";
import { deleteUniversalPointsWhere, deleteEntityVector, loadUniversalVectorConfig, writeUniversalPoint } from "./vector-universal";

// Messages are vectorized as overlapping windows of a conversation instead of
// one point per message. A rebuild re-derives every chunk from the start of the
// conversation; chunking is deterministic, so unchanged chunks hash the same
// and keep their points — only chunks touched by an edit are re-embedded.

// ── Settings ─────────────────────────────────────────────────────────────────

export type ChunkSettings = { chunkChars: number; chunkOverlap: number };

const DEFAULT_CHUNK_CHARS = 10000;
const DEFAULT_CHUNK_OVERLAP = 500;
const MIN_CHUNK_CHARS = 500;
const MAX_CHUNK_CHARS = 50000;

export async function loadChunkSettings(): Promise<ChunkSettings> {
  const chars = parseInt((await getVectorSetting("vector_chunk_chars")) ?? "", 10);
  const overlap = parseInt((await getVectorSetting("vector_chunk_overlap")) ?? "", 10);
  return {
    chunkChars: Number.isFinite(chars) ? chars : DEFAULT_CHUNK_CHARS,
    chunkOverlap: Number.isFinite(overlap) ? overlap : DEFAULT_CHUNK_OVERLAP,
  };
}

/** Saves chunk settings; when they change, every conversation is marked stale for the next Vectorize Everything. */
export async function saveChunkSettings(patch: Partial<ChunkSettings>): Promise<ChunkSettings> {
  const current = await loadChunkSettings();
  const chunkChars = Math.round(patch.chunkChars ?? current.chunkChars);
  const chunkOverlap = Math.round(patch.chunkOverlap ?? current.chunkOverlap);
  if (!(chunkChars >= MIN_CHUNK_CHARS && chunkChars <= MAX_CHUNK_CHARS)) {
    throw new Error(`Chunk size must be between ${MIN_CHUNK_CHARS} and ${MAX_CHUNK_CHARS} characters.`);
  }
  if (!(chunkOverlap >= 0 && chunkOverlap <= chunkChars / 2)) {
    throw new Error("Overlap must be between 0 and half the chunk size.");
  }
  if (chunkChars === current.chunkChars && chunkOverlap === current.chunkOverlap) return current;
  await setVectorSetting("vector_chunk_chars", String(chunkChars));
  await setVectorSetting("vector_chunk_overlap", String(chunkOverlap));
  await db.update(conversations).set({ chunkedAt: null });
  return { chunkChars, chunkOverlap };
}

// ── Chunking ─────────────────────────────────────────────────────────────────

export type ChunkLine = { messageId: string; text: string; sentAt: Date | null };
export type ChunkSpan = { start: number; end: number }; // [start, end) into the lines

/**
 * Splits lines into windows of at most `chunkChars` characters (counting a
 * newline between lines). Each window after the first starts with the trailing
 * messages of the one before, the whole-message overlap nearest `chunkOverlap`.
 *
 * Every line lands in at least one window: windows are contiguous, each one
 * starts at or before the previous end, and each takes at least one new line.
 * A line longer than the budget becomes a window of its own.
 */
export function chunkLines(lines: { text: string }[], { chunkChars, chunkOverlap }: ChunkSettings): ChunkSpan[] {
  const len = lines.map((l) => l.text.length + 1);
  const spans: ChunkSpan[] = [];
  let start = 0;
  while (start < lines.length) {
    // `fresh` is the first line not covered by the previous window; always take it.
    const fresh = spans.length ? spans[spans.length - 1].end : start;
    let end = fresh + 1;
    let size = len.slice(start, end).reduce((a, b) => a + b, 0);
    while (end < lines.length && size + len[end] <= chunkChars) size += len[end++];
    spans.push({ start, end });
    if (end >= lines.length) break;

    // Next window's overlap: the trailing run of this window's lines whose size
    // is nearest the target, kept short enough that the next new line still fits.
    let next = end;
    let best = chunkOverlap; // distance for zero overlap
    let overlap = 0;
    for (let k = end - 1; k > start; k--) {
      overlap += len[k];
      if (overlap + len[end] > chunkChars) break;
      const dist = Math.abs(overlap - chunkOverlap);
      if (dist < best) { best = dist; next = k; }
      if (overlap >= chunkOverlap) break;
    }
    start = next;
  }
  return spans;
}

const stripHtml = (s: string) => s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

/** A conversation's messages as chronological lines: "[date] Sender: text". */
async function loadConversationLines(conversationId: string): Promise<ChunkLine[]> {
  const rows = await db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, conversationId))
    .orderBy(sql`${messages.sentAt} ASC NULLS LAST`, asc(messages.createdAt), asc(messages.id));

  const personIds = [...new Set(rows.map((r) => r.senderPersonId).filter(Boolean))] as string[];
  const accountIds = [...new Set(rows.map((r) => r.senderSocialAccountId).filter(Boolean))] as string[];
  const personNames = new Map(
    personIds.length
      ? (await db.select().from(people).where(inArray(people.id, personIds))).map((p) => [p.id, formatPersonName(p)])
      : [],
  );
  const accountNames = new Map(
    accountIds.length
      ? (await db.select({ id: socialAccounts.id, username: socialAccounts.username }).from(socialAccounts)
          .where(inArray(socialAccounts.id, accountIds))).map((a) => [a.id, `@${a.username}`])
      : [],
  );

  return rows.map((m) => {
    // Mirrors isSelfMessage on the client: no sender entity and no imported name = the me user.
    const sender =
      (m.senderPersonId && personNames.get(m.senderPersonId)) ||
      (m.senderSocialAccountId && accountNames.get(m.senderSocialAccountId)) ||
      (m.metadata as { senderName?: string } | null)?.senderName ||
      (m.senderPersonId || m.senderSocialAccountId ? "Unknown" : "Me");
    const body = m.content ? (m.contentType === "html" ? stripHtml(m.content) : m.content.trim()) : "";
    const date = m.sentAt ? m.sentAt.toISOString().slice(0, 16).replace("T", " ") : "undated";
    // Media-only messages still get a line so every message belongs to a chunk.
    return { messageId: m.id, sentAt: m.sentAt, text: `[${date}] ${sender}: ${body || "(media)"}` };
  });
}

// ── Rebuild ──────────────────────────────────────────────────────────────────

// One rebuild per conversation at a time; a request during a rebuild runs once after it.
const running = new Map<string, Promise<void>>();
const rerun = new Set<string>();

/**
 * Rebuilds a conversation's chunks and their points: unchanged chunks are
 * kept, changed ones re-embedded, vanished ones deleted. Marks the
 * conversation chunked only when every chunk embedded.
 */
export async function rechunkConversation(conversationId: string): Promise<void> {
  const active = running.get(conversationId);
  if (active) {
    rerun.add(conversationId);
    return active;
  }
  const job = (async () => {
    try {
      do {
        rerun.delete(conversationId);
        await rebuild(conversationId);
      } while (rerun.has(conversationId));
    } finally {
      running.delete(conversationId);
    }
  })();
  running.set(conversationId, job);
  return job;
}

async function rebuild(conversationId: string): Promise<void> {
  const startedAt = new Date();
  const [conversation] = await db.select().from(conversations).where(eq(conversations.id, conversationId));
  if (!conversation) {
    await deleteUniversalPointsWhere({ "meta.conversation_id": conversationId });
    return;
  }

  const settings = await loadChunkSettings();
  const lines = await loadConversationLines(conversationId);
  const header = `Conversation: ${conversation.title || conversation.channelType} (${conversation.channelType})`;
  const built = chunkLines(lines, settings).map(({ start, end }, seq) => {
    const slice = lines.slice(start, end);
    const text = `${header}\n${slice.map((l) => l.text).join("\n")}`;
    const messageIds = slice.map((l) => l.messageId);
    return {
      seq,
      messageIds,
      text,
      startAt: slice[0].sentAt,
      endAt: slice[slice.length - 1].sentAt,
      charCount: text.length,
      contentHash: createHash("sha1").update(messageIds.join(",")).update("\0").update(text).digest("hex"),
    };
  });

  const existing = await db.select().from(messageChunks).where(eq(messageChunks.conversationId, conversationId));
  const unclaimed = new Map(existing.filter((c) => c.vectorSyncedAt).map((c) => [c.contentHash, c]));
  let allEmbedded = true;

  for (const chunk of built) {
    const kept = unclaimed.get(chunk.contentHash);
    if (kept) {
      unclaimed.delete(chunk.contentHash);
      if (kept.seq !== chunk.seq) await db.update(messageChunks).set({ seq: chunk.seq }).where(eq(messageChunks.id, kept.id));
      continue;
    }
    const id = randomUUID();
    try {
      await writeUniversalPoint({
        id,
        type: "message_chunk",
        entityId: id,
        text: chunk.text,
        title: conversation.title ? `Messages: ${conversation.title}` : `Messages (${conversation.channelType})`,
        createdAt: chunk.startAt,
        meta: { conversation_id: conversationId, channelType: conversation.channelType, endAt: chunk.endAt },
      });
    } catch (err) {
      allEmbedded = false;
      console.warn(`[message-chunks] embedding chunk ${chunk.seq} of ${conversationId} failed:`, (err as Error)?.message ?? err);
      continue;
    }
    const { text: _text, ...row } = chunk;
    await db.insert(messageChunks).values({ id, conversationId, ...row, vectorSyncedAt: new Date() });
  }

  // Old chunks no longer produced, plus any row whose embed never finished.
  const stale = [...unclaimed.values(), ...existing.filter((c) => !c.vectorSyncedAt)].map((c) => c.id);
  if (stale.length) {
    await deleteEntityVector("message_chunk", stale);
    await db.delete(messageChunks).where(inArray(messageChunks.id, stale));
  }
  if (allEmbedded) {
    await db.update(conversations).set({ chunkedAt: startedAt }).where(eq(conversations.id, conversationId));
  }
}

/** Conversations never chunked, or holding a message added since the last rebuild. */
export async function listStaleConversationIds(): Promise<string[]> {
  const rows = await db.execute<{ id: string }>(sql`
    SELECT c.id FROM conversations c
    WHERE c.chunked_at IS NULL
       OR EXISTS (SELECT 1 FROM messages m WHERE m.conversation_id = c.id AND m.created_at > c.chunked_at)
  `);
  return rows.rows.map((r) => r.id);
}

// Imports add messages in bursts; wait for a quiet moment before rebuilding.
const REBUILD_DEBOUNCE_MS = 3000;
const timers = new Map<string, NodeJS.Timeout>();

/** Debounced background rebuild; call after a message in the conversation is created, edited or deleted. */
export function scheduleRechunk(conversationId: string): void {
  clearTimeout(timers.get(conversationId));
  timers.set(conversationId, setTimeout(() => {
    timers.delete(conversationId);
    void (async () => {
      const cfg = await loadUniversalVectorConfig();
      if (!cfg.universalEnabled || !cfg.qdrantUrl || !cfg.embeddingModel) return;
      await rechunkConversation(conversationId);
    })().catch((err: any) => {
      console.warn(`[message-chunks] rebuild of ${conversationId} failed:`, err?.message ?? err);
    });
  }, REBUILD_DEBOUNCE_MS));
}

/** Drops a deleted conversation's chunk points (its rows go with the cascade). */
export function removeConversationVectorsInBackground(conversationId: string): void {
  void deleteUniversalPointsWhere({ "meta.conversation_id": conversationId }).catch((err: any) => {
    console.warn(`[message-chunks] removing vectors of ${conversationId} failed:`, err?.message ?? err);
  });
}

/** Drops a conversation's chunk rows and points and marks it unchunked, so the next Vectorize Everything rebuilds it. */
export async function clearConversationChunks(conversationId: string): Promise<void> {
  await deleteUniversalPointsWhere({ "meta.conversation_id": conversationId });
  await db.delete(messageChunks).where(eq(messageChunks.conversationId, conversationId));
  await db.update(conversations).set({ chunkedAt: null }).where(eq(conversations.id, conversationId));
}

// ── Linking ──────────────────────────────────────────────────────────────────

export type ChunkLink = {
  conversationId: string;
  messageIds: string[];
  /** Messages after the chunk's first one: how far back the thread must page to show it. */
  newerCount: number;
  /** Profile page whose Messages tab shows the conversation. */
  href: string;
};

/**
 * Where a chunk link lands: the me user's page when they are in the chat,
 * else the first participant that is a person, else a participant account.
 */
export async function resolveChunkLink(chunkId: string): Promise<ChunkLink | null> {
  const [chunk] = await db.select().from(messageChunks).where(eq(messageChunks.id, chunkId));
  if (!chunk) return null;
  const { conversationId, messageIds } = chunk;

  // Same order the thread pane pages in (newest first, undated counted newest).
  const ordered = await db.select({ id: messages.id }).from(messages)
    .where(eq(messages.conversationId, conversationId))
    .orderBy(sql`${messages.sentAt} ASC NULLS LAST`, asc(messages.createdAt), asc(messages.id));
  const inChunk = new Set(messageIds);
  const firstIndex = ordered.findIndex((m) => inChunk.has(m.id));
  const newerCount = firstIndex < 0 ? 0 : ordered.length - firstIndex - 1;

  const participants = await db.select().from(conversationParticipants)
    .where(eq(conversationParticipants.conversationId, conversationId));
  const meId = await storage.getMePersonId();
  const meAccounts = new Set(await storage.getMeSocialAccountIds());
  const selfSent = (await db.execute<{ n: number }>(sql`
    SELECT count(*)::int AS n FROM messages
    WHERE conversation_id = ${conversationId} AND sender_person_id IS NULL AND sender_social_account_id IS NULL
      AND (metadata->>'senderName') IS NULL
  `)).rows[0]?.n > 0;
  const meInChat = selfSent || participants.some((p) =>
    (meId && p.personId === meId) || (p.socialAccountId && meAccounts.has(p.socialAccountId)));

  const query = `?tab=messages&conversation=${conversationId}&chunk=${chunkId}`;
  const person = participants.find((p) => p.personId && p.personId !== meId);
  const account = participants.find((p) => p.socialAccountId && !meAccounts.has(p.socialAccountId));
  const href = meInChat || (!person && !account)
    ? `/me${query}`
    : person ? `/person/${person.personId}${query}` : `/social-accounts/${account!.socialAccountId}${query}`;

  return { conversationId, messageIds, newerCount, href };
}
