/**
 * Image summary word cloud demo: walks every post's AI summary in id order, tokenizes each
 * per-image description (a story's single overview stands in for its image) into one running
 * word count, and saves the top words with a finished timestamp. Filler words are kept here
 * and dropped by the page, so toggling them needs no rerun.
 */
import { and, desc, eq, gt, isNotNull, sql } from "drizzle-orm";
import { imageSummaryWordClouds, socialAccountPosts, type PostAiSummary } from "@shared/schema";
import { tokenize } from "@shared/word-tokenize";
import { db } from "./db";

const BATCH = 2000;
const KEEP_WORDS = 3000;
const EMPTY_STORY = "No visual or text content available to summarize.";

let activeRunId: string | null = null;

export async function getLatestRun() {
  const [row] = await db.select().from(imageSummaryWordClouds).orderBy(desc(imageSummaryWordClouds.startedAt)).limit(1);
  if (!row) return null;
  // A 'running' row this process isn't working on was cut off by a restart.
  const interrupted = row.status === "running" && row.id !== activeRunId;
  const [lastDone] = row.status === "done" ? [row] : await db.select().from(imageSummaryWordClouds)
    .where(eq(imageSummaryWordClouds.status, "done")).orderBy(desc(imageSummaryWordClouds.startedAt)).limit(1);
  const { words: _words, ...progress } = row;
  return { latest: { ...progress, status: interrupted ? "interrupted" : row.status }, lastDone: lastDone ?? null };
}

export async function startRun(): Promise<string> {
  if (activeRunId) return activeRunId;
  activeRunId = "starting"; // holds off a second click while the row is created
  let run;
  try {
    const [{ total }] = await db.select({ total: sql<number>`count(*)::int` }).from(socialAccountPosts)
      .where(isNotNull(socialAccountPosts.aiSummary));
    [run] = await db.insert(imageSummaryWordClouds).values({ status: "running", postsTotal: total }).returning();
  } catch (err) {
    activeRunId = null;
    throw err;
  }
  activeRunId = run.id;
  countAll(run.id).catch(async (err) => {
    console.error("Image summary word cloud run failed:", err);
    await db.update(imageSummaryWordClouds)
      .set({ status: "failed", finishedAt: new Date(), error: String(err?.message ?? err) })
      .where(eq(imageSummaryWordClouds.id, run.id));
  }).finally(() => { activeRunId = null; });
  return run.id;
}

async function countAll(runId: string) {
  const counts = new Map<string, number>();
  let lastId = "";
  let posts = 0, summaries = 0, words = 0;

  for (;;) {
    const rows = await db
      .select({ id: socialAccountPosts.id, postType: socialAccountPosts.postType, aiSummary: socialAccountPosts.aiSummary })
      .from(socialAccountPosts)
      .where(and(isNotNull(socialAccountPosts.aiSummary), gt(socialAccountPosts.id, lastId)))
      .orderBy(socialAccountPosts.id)
      .limit(BATCH);
    if (rows.length === 0) break;

    for (const row of rows) {
      const summary = row.aiSummary as PostAiSummary | null;
      const texts = summary?.images?.length
        ? summary.images.map((img) => img.description)
        : row.postType === "story" && summary?.overview && summary.overview !== EMPTY_STORY ? [summary.overview] : [];
      for (const text of texts) {
        if (!text) continue;
        summaries++;
        for (const word of tokenize(text)) {
          counts.set(word, (counts.get(word) ?? 0) + 1);
          words++;
        }
      }
    }
    posts += rows.length;
    lastId = rows[rows.length - 1].id;
    await db.update(imageSummaryWordClouds)
      .set({ postsProcessed: posts, summariesProcessed: summaries, wordsCounted: words })
      .where(eq(imageSummaryWordClouds.id, runId));
  }

  const top = Array.from(counts, ([text, count]) => ({ text, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, KEEP_WORDS);
  await db.update(imageSummaryWordClouds)
    .set({ status: "done", finishedAt: new Date(), postsTotal: posts, postsProcessed: posts, summariesProcessed: summaries, wordsCounted: words, words: top })
    .where(eq(imageSummaryWordClouds.id, runId));
}
