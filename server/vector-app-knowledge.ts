import { loadVectorConfig, embedText, buildClient, ensureCollection, getVectorSetting } from "./vector";
import { QdrantClient } from "@qdrant/js-client-rest";
import { randomUUID } from "crypto";
import { db } from "./db";
import { appKnowledge, people, socialAccounts, photos, dailyNotes, groups } from "@shared/schema";
import { eq, sql } from "drizzle-orm";
import fs from "fs";
import path from "path";
import Papa from "papaparse";

const APP_KNOWLEDGE_COLLECTION = "prm-app-knowledge";

/**
 * Re-reads the app knowledge CSV, chunks it by 120 words with 10 words overlap,
 * saves it to the PostgreSQL database, and starts background vectorization.
 */
export async function reindexAppKnowledge(): Promise<{ processed: number; failed: number }> {
  const cfg = await loadVectorConfig();
  if (!cfg.qdrantUrl) throw new Error("Qdrant URL is not configured.");

  const csvPath = path.resolve(process.cwd(), "prm-app-knowledge.csv");
  if (!fs.existsSync(csvPath)) {
    await fs.promises.writeFile(csvPath, "content\n", "utf8");
  }

  const csvText = await fs.promises.readFile(csvPath, "utf8");
  const parseResult = Papa.parse(csvText, { header: true, skipEmptyLines: true });
  
  const rows = parseResult.data as { content?: string }[];
  const allTexts = rows
    .map(r => r.content?.trim())
    .filter(Boolean) as string[];

  // 1. Delete all existing knowledge base chunks in postgres
  await db.delete(appKnowledge);

  // 2. Recreate Qdrant collection
  const client = buildClient(cfg);
  try {
    await client.deleteCollection(APP_KNOWLEDGE_COLLECTION);
  } catch (e) {
    // Ignore if not present
  }

  if (allTexts.length === 0) {
    return { processed: 0, failed: 0 };
  }

  // 3. Combine and chunk all text
  const fullText = allTexts.join("\n\n");
  const chunks = chunkText(fullText, 120, 10);

  // 4. Save to db first
  const inserted = [];
  for (const chunk of chunks) {
    const [row] = await db.insert(appKnowledge).values({ content: chunk }).returning();
    inserted.push(row);
  }

  // 5. Asynchronously embed & upsert to Qdrant
  void (async () => {
    let processedCount = 0;
    let failedCount = 0;
    for (const row of inserted) {
      try {
        const vector = await embedText(row.content, cfg.embeddingModel);
        await ensureCollection(client, APP_KNOWLEDGE_COLLECTION, vector.length);
        const pointId = randomUUID();

        await client.upsert(APP_KNOWLEDGE_COLLECTION, {
          wait: true,
          points: [
            {
              id: pointId,
              vector,
              payload: {
                content: row.content,
                dbId: row.id,
              },
            },
          ],
        });

        await db
          .update(appKnowledge)
          .set({ vectorId: pointId, vectorSyncedAt: new Date() })
          .where(eq(appKnowledge.id, row.id));

        processedCount++;
      } catch (err) {
        console.error(`[app-knowledge] Failed to vectorize chunk ${row.id}:`, err);
        failedCount++;
      }
    }
    console.log(`[app-knowledge] Background indexing complete. Vectorized: ${processedCount}, Failed: ${failedCount}`);
  })();

  return { processed: inserted.length, failed: 0 };
}

/**
 * Split text into chunks of `chunkSize` words, with `overlap` words from the previous chunk.
 */
function chunkText(text: string, chunkSize = 120, overlap = 10): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const chunks: string[] = [];
  let i = 0;
  while (i < words.length) {
    const chunkWords = words.slice(i, i + chunkSize);
    chunks.push(chunkWords.join(" "));
    if (i + chunkSize >= words.length) {
      break;
    }
    i += (chunkSize - overlap);
  }
  return chunks;
}

/**
 * Searches the app knowledge base collection with semantic similarity.
 */
export async function searchAppKnowledge(query: string, limit = 5): Promise<{ content: string; score: number }[]> {
  const cfg = await loadVectorConfig();
  if (!cfg.enabled) throw new Error("Vector storage is disabled.");
  const appEnabled = (await getVectorSetting("app_knowledge_enabled")) === "true";
  if (!appEnabled) return [];

  const vector = await embedText(query, cfg.embeddingModel);
  const client = buildClient(cfg);

  try {
    await client.getCollection(APP_KNOWLEDGE_COLLECTION);
  } catch (e) {
    // Collection doesn't exist yet
    return [];
  }

  const hits = await client.search(APP_KNOWLEDGE_COLLECTION, {
    vector,
    limit,
    with_payload: true,
  });

  return hits.map(h => ({
    content: (h.payload?.content as string) ?? "",
    score: h.score,
  }));
}

/**
 * Extracts and resolves custom links `"/{page}"{title}` from a block of text.
 * Returns an array of resolved raw URL, target URL (with UUIDs/queries if needed), and title.
 */
export async function resolveLinksInText(text: string): Promise<{ rawUrl: string; url: string; title: string }[]> {
  const regex = /"([^"]+)"\{([^}]+)\}/g;
  const matches: { rawUrl: string; title: string }[] = [];
  let match;
  while ((match = regex.exec(text)) !== null) {
    if (!matches.some(m => m.rawUrl === match![1] && m.title === match![2])) {
      matches.push({ rawUrl: match[1], title: match[2] });
    }
  }

  const resolved: { rawUrl: string; url: string; title: string }[] = [];

  for (const item of matches) {
    const rawUrl = item.rawUrl.trim();
    const title = item.title.trim();

    // Check if it's an object page that requires entity ID lookup
    if (rawUrl === "/person" || rawUrl === "/person/") {
      const person = await findPersonByName(title);
      if (person) {
        resolved.push({ rawUrl, url: `/person/${person.id}`, title });
      } else {
        resolved.push({ rawUrl, url: "/people", title });
      }
    } else if (rawUrl === "/social-accounts" || rawUrl === "/social-accounts/") {
      if (title.toLowerCase() !== "social accounts" && title.toLowerCase() !== "view social accounts" && title.toLowerCase() !== "social accounts page") {
        const sa = await db.query.socialAccounts.findFirst({
          where: eq(socialAccounts.username, title),
        });
        if (sa) {
          resolved.push({ rawUrl, url: `/social-accounts/${sa.id}`, title });
        } else {
          resolved.push({ rawUrl, url: "/social-accounts", title });
        }
      } else {
        resolved.push({ rawUrl, url: "/social-accounts", title });
      }
    } else if (rawUrl === "/image" || rawUrl === "/image/") {
      const photo = await db.query.photos.findFirst({
        where: sql`LOWER(${photos.imageDescription}) LIKE ${'%' + title.toLowerCase() + '%'}`,
      });
      if (photo) {
        resolved.push({ rawUrl, url: `/image/${photo.id}`, title });
      } else {
        resolved.push({ rawUrl, url: "/images", title });
      }
    } else if (rawUrl === "/daily-notes" || rawUrl === "/daily-notes/") {
      if (title.toLowerCase() !== "daily notes" && title.toLowerCase() !== "view daily notes" && !isNaN(Date.parse(title))) {
        const dn = await db.query.dailyNotes.findFirst({
          where: eq(dailyNotes.date, title),
        });
        if (dn) {
          resolved.push({ rawUrl, url: `/daily-notes/${dn.id}`, title });
        } else {
          resolved.push({ rawUrl, url: "/daily-notes", title });
        }
      } else {
        resolved.push({ rawUrl, url: "/daily-notes", title });
      }
    } else if (rawUrl === "/group" || rawUrl === "/group/") {
      const gp = await db.query.groups.findFirst({
        where: eq(groups.name, title),
      });
      if (gp) {
        resolved.push({ rawUrl, url: `/group/${gp.id}`, title });
      } else {
        resolved.push({ rawUrl, url: "/groups", title });
      }
    } else {
      // General page case
      resolved.push({ rawUrl, url: rawUrl, title });
    }
  }

  return resolved;
}

/**
 * Replaces the custom link formatting inside assistant text with standard clickable Markdown links.
 */
export function cleanRawLinks(text: string, resolvedLinks: { rawUrl: string; url: string; title: string }[]): string {
  let cleaned = text;
  for (const link of resolvedLinks) {
    const rawPattern = `"${link.rawUrl}"{${link.title}}`;
    cleaned = cleaned.split(rawPattern).join(`[${link.title}](${link.url})`);
  }
  return cleaned;
}

/**
 * Helper to look up a person by matching first name, last name, or combined full name.
 */
async function findPersonByName(name: string) {
  const parts = name.split(/\s+/).filter(Boolean);
  if (parts.length === 1) {
    return await db.query.people.findFirst({
      where: sql`LOWER(${people.firstName}) = ${parts[0].toLowerCase()} OR LOWER(${people.lastName}) = ${parts[0].toLowerCase()}`,
    });
  } else if (parts.length >= 2) {
    const first = parts[0].toLowerCase();
    const last = parts.slice(1).join(" ").toLowerCase();
    return await db.query.people.findFirst({
      where: sql`LOWER(${people.firstName}) = ${first} AND LOWER(${people.lastName}) = ${last}`,
    });
  }
  return null;
}
