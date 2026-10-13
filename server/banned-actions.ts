/**
 * Per-account processing bans (social_accounts.banned_actions). Ingestion hooks
 * and bulk/backfill runs skip a banned account's content; manual runs don't.
 */
import { and, eq, inArray, isNotNull, sql, type SQL } from "drizzle-orm";
import { db } from "./db";
import { storage } from "./storage";
import { historicalAccountSummaries, imageTasks, photos, socialAccountPosts, socialAccounts, summaryJobs } from "@shared/schema";
import type { BannedAction } from "@shared/banned-actions";
// Only referenced inside functions, so the recognition -> banned-actions import
// cycle never reads them before they're initialised.
import { JOB_TASK_TYPE, dropPhotoFaces, type AutoRecognitionJob } from "./recognition";

export const BAN_FOR_JOB: Record<AutoRecognitionJob, BannedAction> = { face: "facial_scan", ocr: "ocr", transcribe: "transcribe" };

export async function bannedActions(accountId: string): Promise<string[]> {
  const [row] = await db.select({ bannedActions: socialAccounts.bannedActions }).from(socialAccounts).where(eq(socialAccounts.id, accountId));
  return row?.bannedActions ?? [];
}

/** SQL: the account with id `accountId` (an SQL expression) bans `action`. */
export const accountBans = (accountId: SQL, action: BannedAction) =>
  sql`EXISTS (SELECT 1 FROM ${socialAccounts} WHERE ${socialAccounts.id} = ${accountId} AND ${action} = ANY(${socialAccounts.bannedActions}))`;

/** SQL: photos rows that are the account's profile pictures or post/story images. */
const accountPhotos = (accountId: string) => sql`(${photos.prmLocation} = ${`profile_image:${accountId}`} OR ${photos.prmLocation} IN (
  SELECT 'post:' || ${socialAccountPosts.id} FROM ${socialAccountPosts} WHERE ${socialAccountPosts.socialAccountId} = ${accountId}
))`;

const scannedPhotos = (accountId: string, action: "facial_scan" | "ocr") =>
  and(accountPhotos(accountId), isNotNull(action === "facial_scan" ? photos.faceIdAt : photos.ocrAt));

/** How many existing results (faces, OCR runs, summaries, transcripts) a purge of `action` would delete. */
export async function banImpact(accountId: string, action: BannedAction): Promise<number> {
  const count = sql<number>`count(*)::int`;
  switch (action) {
    case "facial_scan": {
      const [row] = await db.select({ n: sql<number>`coalesce(sum(jsonb_array_length(coalesce(${photos.facialIds}, '[]'::jsonb))), 0)::int` })
        .from(photos).where(scannedPhotos(accountId, action));
      return row.n;
    }
    case "ocr": {
      const [row] = await db.select({ n: count }).from(photos).where(scannedPhotos(accountId, action));
      return row.n;
    }
    case "transcribe": {
      const [row] = await db.select({ n: count }).from(socialAccountPosts)
        .where(and(eq(socialAccountPosts.socialAccountId, accountId), isNotNull(socialAccountPosts.videoTranscriptAt)));
      return row.n;
    }
    case "summary": {
      const counts = await Promise.all([
        db.select({ n: count }).from(socialAccountPosts).where(and(eq(socialAccountPosts.socialAccountId, accountId), isNotNull(socialAccountPosts.aiSummary))),
        db.select({ n: count }).from(historicalAccountSummaries).where(eq(historicalAccountSummaries.socialAccountId, accountId)),
        db.select({ n: count }).from(socialAccounts).where(and(eq(socialAccounts.id, accountId), isNotNull(socialAccounts.aiSummary))),
      ]);
      return counts.reduce((sum, [row]) => sum + row.n, 0);
    }
  }
}

/**
 * Add or lift a ban. Banning cancels the account's queued jobs of that kind;
 * with `purge`, its existing results are deleted too.
 */
export async function setAccountBan(accountId: string, action: BannedAction, banned: boolean, purge: boolean): Promise<void> {
  await db.update(socialAccounts)
    .set({ bannedActions: sql`array_remove(${socialAccounts.bannedActions}, ${action})${banned ? sql` || ARRAY[${action}]::text[]` : sql``}` })
    .where(eq(socialAccounts.id, accountId));
  if (!banned) return;

  if (action === "summary") {
    await db.update(summaryJobs).set({ status: "cancelled", completedAt: new Date() })
      .where(and(eq(summaryJobs.socialAccountId, accountId), eq(summaryJobs.status, "pending")));
  } else {
    const job = (Object.keys(BAN_FOR_JOB) as AutoRecognitionJob[]).find((j) => BAN_FOR_JOB[j] === action)!;
    const target = job === "transcribe"
      ? sql`(${imageTasks.payload}::jsonb ->> 'postId') IN (SELECT ${socialAccountPosts.id} FROM ${socialAccountPosts} WHERE ${socialAccountPosts.socialAccountId} = ${accountId})`
      : inArray(imageTasks.photoId, db.select({ id: photos.id }).from(photos).where(accountPhotos(accountId)));
    const queued = await db.select({ id: imageTasks.id }).from(imageTasks)
      .where(and(eq(imageTasks.type, JOB_TASK_TYPE[job]), eq(imageTasks.status, "pending"), target));
    for (const t of queued) await storage.cancelImageTask(t.id);
  }
  if (!purge) return;

  switch (action) {
    case "facial_scan": {
      // One compute call per photo; a photo another photo's drop already cleared is skipped.
      const rows = await db.select({ id: photos.id }).from(photos)
        .where(and(scannedPhotos(accountId, action), sql`jsonb_array_length(coalesce(${photos.facialIds}, '[]'::jsonb)) > 0`));
      const cleared = new Set<string>();
      for (const { id } of rows) if (!cleared.has(id)) for (const p of await dropPhotoFaces(id)) cleared.add(p);
      break;
    }
    case "ocr":
      await db.update(photos).set({ ocrData: null, ocrAt: null }).where(scannedPhotos(accountId, action));
      break;
    case "transcribe":
      await db.update(socialAccountPosts).set({ videoTranscript: null, videoTranscriptAt: null })
        .where(and(eq(socialAccountPosts.socialAccountId, accountId), isNotNull(socialAccountPosts.videoTranscriptAt)));
      break;
    case "summary":
      await db.transaction(async (tx) => {
        await tx.update(socialAccountPosts).set({ aiSummary: null, aiSummaryAt: null, aiSummaryModel: null })
          .where(and(eq(socialAccountPosts.socialAccountId, accountId), isNotNull(socialAccountPosts.aiSummary)));
        await tx.delete(historicalAccountSummaries).where(eq(historicalAccountSummaries.socialAccountId, accountId));
        await tx.update(socialAccounts).set({
          aiSummary: null, aiSummaryGeneratedAt: null, aiSummaryInvalidated: false, aiSummaryInvalidatedAt: null, aiSummaryModel: null,
        }).where(eq(socialAccounts.id, accountId));
      });
      break;
  }
}
