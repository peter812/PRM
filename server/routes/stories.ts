/**
 * Ingest for the prm-stories scraper (see instagram-stories-plan.md).
 * A story becomes a social_account_posts row with postType "story" plus a
 * photos row. Stories from unknown accounts are not stored; the run log
 * records that they were seen. Stories are instance-wide: the scraper
 * authenticates with the run token PRM minted when it triggered the run
 * (server/stories-scheduler.ts), and everything runs as system. A token
 * writes only to runs of the importer it was minted for.
 */
import type { Express, Request, Response } from "express";
import crypto from "crypto";
import multer from "multer";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { storage } from "../storage";
import { requireAuth } from "../auth";
import { uploadStoryImage, uploadMedia, deleteImageFromPrmS3, deleteMediaFromPrmS3 } from "../prm-s3";
import { people, photos, socialAccountPosts, socialAccounts, storyImporters, storyScrapeRuns, imageTaskGroups, type SentNote, type StoryImporter, type StorySeenBy } from "@shared/schema";
import { formatPersonName } from "@shared/person-name";
import { generateDeterministicUuid } from "./social-media";
import { queueMentioned } from "./tracking";
import { DEFAULT_WINDOW, kickManualTrackingJobs, kickManualTrackingJobsAfterRun, runForToken, storiesServiceHeaders, storiesServiceUrl, trackNow, triggerStoriesRun } from "../stories-scheduler";
import { failUnfinishedJobs } from "../tracking";
import { enqueueAutoRecognition } from "../recognition";
import { getImageDimensions } from "../profile-image";
import { onPostAddedForSummary } from "../summary-queue";

const INSTAGRAM_TYPE_ID = "00000000-0000-0000-0001-000000000001";
// A story video (≤ 60 s) is usually 3–15 MB; the scraper skips anything over its own cap (50 MB by default).
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

export function storyPostId(storyPk: string): string {
  return generateDeterministicUuid(`instagram:story:${storyPk.trim()}`);
}

export const storyMetaSchema = z.object({
  storyPk: z.string().min(1),
  username: z.string().min(1),
  /** The @username the scraper was logged in as — audit provenance, required. */
  scrapedFrom: z.string().min(1),
  takenAt: z.string().datetime(),
  accessibilityCaption: z.string().nullable().optional(),
  mentions: z.array(z.string()).default([]),
  width: z.number().nullable().optional(),
  height: z.number().nullable().optional(),
}).passthrough();

const seenBySchema = z.object({
  storyPk: z.string().min(1),
  viewerCount: z.number().int().nonnegative(),
  viewers: z.array(z.object({
    pk: z.string().min(1),
    username: z.string().min(1),
    fullName: z.string().nullable(),
    liked: z.boolean(),
    reply: z.string().nullable(),
  })),
});

// One inbox note as prm-stories' deliverNotes sends it (inbox-notes-plan.md).
const noteSchema = z.object({
  noteId: z.string().min(1),
  text: z.string(),
  song: z.object({ title: z.string(), artist: z.string() }).nullable(),
  createdAt: z.string().datetime(),
  seenAt: z.string().datetime(),
  user: z.object({ pk: z.string(), username: z.string().min(1), fullName: z.string().nullable() }),
});

const runSchema = z.object({
  runId: z.string().min(1),
  status: z.string().min(1),
  startedAt: z.string().datetime(),
  finishedAt: z.string().datetime().nullable().optional(),
  counts: z.record(z.unknown()).default({}),
  items: z.array(z.unknown()).default([]),
  error: z.string().nullable().optional(),
  scrapedFrom: z.string().nullable().optional(),
});

const timeOfDay = /^\d{1,2}:\d{2}$/;
const timeWindow = (name: string) =>
  z.string().refine((w) => {
    const [a, b] = w.split("-");
    return Boolean(a && b && timeOfDay.test(a) && timeOfDay.test(b) && a < b);
  }, `${name} must be HH:MM-HH:MM with the end after the start`);
const importerPatchSchema = z.object({
  label: z.string().trim().min(1).max(80).optional(),
  serviceUrl: z.string().trim().max(500).optional(),
  serviceSecret: z.string().trim().min(1).max(500).optional(),
  enabled: z.boolean().optional(),
  runEveryDays: z.number().int().min(1).max(30).optional(),
  runWindow: timeWindow("runWindow").optional(),
  skipDayProbability: z.number().min(0).max(1).optional(),
  downloadVideos: z.boolean().optional(),
  unseenOnly: z.boolean().optional(),
  runNowUnseenOnly: z.boolean().optional(),
  trackingEnabled: z.boolean().optional(),
  trackingWindow: timeWindow("trackingWindow").optional(),
  trackingMaxJobs: z.number().int().min(1).max(500).optional(),
}).strict();

/** An importer as the settings pages see it: whether a secret is stored, never the secret. */
function publicImporter({ serviceSecret, ...importer }: StoryImporter) {
  return { ...importer, serviceSecretSet: serviceSecret !== "" };
}

/** The importer for `:id`, or null with a 404 already sent. */
async function importerFor(req: Request, res: Response): Promise<StoryImporter | null> {
  const [importer] = await db.select().from(storyImporters).where(eq(storyImporters.id, req.params.id)).limit(1);
  if (!importer) res.status(404).json({ error: "Importer not found" });
  return importer ?? null;
}

const checkStoriesSchema = z.object({
  storyPks: z.array(z.string().min(1)).optional(),
  usernames: z.array(z.string().min(1)).optional(),
  items: z.array(z.object({
    storyPk: z.string().min(1),
    username: z.string().min(1).optional(),
  })).optional(),
}).refine(data => Boolean(data.storyPks?.length || data.items?.length || data.usernames?.length), {
  message: "At least one of storyPks, items, or usernames must be provided",
});

/** The run whose live token is on the request, or null with a 401 already sent. */
export async function authedRun(req: Request, res: Response): Promise<{ id: string; importerId: string | null } | null> {
  const token = req.headers["x-stories-token"];
  const run = typeof token === "string" ? await runForToken(token) : null;
  if (!run) res.status(401).json({ error: "Invalid or expired run token" });
  return run;
}

/**
 * The token's run, when it may write to run `runId`: its own, or another of
 * the same importer's (a run left undelivered goes out with the next run's
 * token). `allowNew` lets the manifest create a run PRM never minted (the
 * service's `now` CLI). Null with the error sent otherwise.
 */
async function authedRunFor(req: Request, res: Response, runId: string, opts: { allowNew?: boolean } = {}) {
  const run = await authedRun(req, res);
  if (!run || run.id === runId) return run;
  const [target] = await db.select({ importerId: storyScrapeRuns.importerId }).from(storyScrapeRuns).where(eq(storyScrapeRuns.id, runId)).limit(1);
  if (target ? target.importerId === run.importerId : opts.allowNew) return run;
  res.status(403).json({ error: "This token can't write to that run" });
  return null;
}

/**
 * The image task group a run's photos are recognized under, made on first use.
 * A story run has one; a tracking run has one per account.
 */
export async function runImageTaskGroup(runId: string, accountId: string, username: string, kind: "story_run" | "tracking_job"): Promise<string> {
  const perAccount = kind === "tracking_job";
  const [existing] = await db
    .select({ id: imageTaskGroups.id })
    .from(imageTaskGroups)
    .where(and(eq(imageTaskGroups.socialRunId, runId), perAccount ? eq(imageTaskGroups.socialAccountId, accountId) : undefined))
    .limit(1);
  if (existing) return existing.id;
  const group = await storage.createImageTaskGroup({
    title: `${perAccount ? "Tracking" : "Story Run"} - @${username}`,
    kind,
    socialRunId: runId,
    socialAccountId: accountId,
  });
  return group.id;
}

/** Which of these story pks PRM already holds. */
export async function existingStoryPks(pks: string[]): Promise<string[]> {
  if (!pks.length) return [];
  const pkById = new Map(pks.map((pk) => [storyPostId(pk), pk]));
  const rows = await db.select({ id: socialAccountPosts.id }).from(socialAccountPosts).where(inArray(socialAccountPosts.id, [...pkById.keys()]));
  return rows.map((r) => pkById.get(r.id)!);
}

/** Multipart fields a story arrives in. */
export const storyUpload = upload.fields([{ name: "image", maxCount: 1 }, { name: "video", maxCount: 1 }]);

/** A received file: a multer upload, or one read back from disk. */
export type Upload = { buffer: Buffer; mimetype?: string };

export type StoryMeta = z.infer<typeof storyMetaSchema>;
export type StoryOutcome = { outcome: "no_account" | "skipped" | "duplicate" | "stored"; postId?: string };
/** A tracking job already holds the account its highlights belong to; a story run looks each item's up. */
type StoryRun = { runId: string | null; groupKind: "story_run" | "tracking_job"; account?: { id: string; skipStories: boolean } };

/**
 * Store one story, already authenticated by the caller: a story run's item, or
 * a highlight's item under a tracking job.
 */
export async function ingestStoryItem(meta: StoryMeta, image: Upload, video: Upload | null, run: StoryRun): Promise<StoryOutcome> {
  const { storyPk, username, scrapedFrom, takenAt, accessibilityCaption, mentions, width, height, ...rest } = meta;
  const cleanStoryPk = storyPk.trim();

  const [account] = run.account
    ? [run.account]
    : await db
        .select({ id: socialAccounts.id, skipStories: socialAccounts.skipStories })
        .from(socialAccounts)
        .where(and(eq(sql`LOWER(${socialAccounts.username})`, username.toLowerCase()), eq(socialAccounts.typeId, INSTAGRAM_TYPE_ID)))
        .limit(1);
  if (!account) return { outcome: "no_account" };
  if (account.skipStories) return { outcome: "skipped" };

  const postId = storyPostId(cleanStoryPk);
  const [existing] = await db.select({ id: socialAccountPosts.id }).from(socialAccountPosts).where(eq(socialAccountPosts.id, postId)).limit(1);
  if (existing) return { outcome: "duplicate", postId };

  const buffer = image.buffer;
  const fileHash = crypto.createHash("sha256").update(buffer).digest("hex");
  // Files go up first; whatever this request uploaded is removed again if a racing delivery wins the insert.
  const uploaded: { url: string; kind: "image" | "video" }[] = [];
  let imageUrl = (await storage.getPhotoByFileHash(fileHash))?.location;
  if (!imageUrl) {
    imageUrl = await uploadStoryImage(buffer, `${cleanStoryPk}.jpg`, image.mimetype || "image/jpeg");
    uploaded.push({ url: imageUrl, kind: "image" });
  }

  // The video is a bonus on top of the cover frame: if storing it fails the story is still kept.
  const metadata: Record<string, unknown> = { ...rest };
  if (video) {
    try {
      const mime = video.mimetype?.startsWith("video/") ? video.mimetype : "video/mp4";
      const videoUrl = await uploadMedia(video.buffer, `${cleanStoryPk}.mp4`, mime);
      metadata.videoUrl = videoUrl;
      uploaded.push({ url: videoUrl, kind: "video" });
    } catch (err) {
      console.error(`Story ${cleanStoryPk}: video not stored:`, err);
      metadata.videoError = err instanceof Error ? err.message : String(err);
    }
  }

  // The post row goes first so a duplicate writes nothing; the photo lands with it or not at all.
  // The stored file can be smaller than the size Instagram reports; face boxes use the file's pixels.
  const dims = getImageDimensions(buffer);
  const photoId = await db.transaction(async (tx) => {
    const [post] = await tx
      .insert(socialAccountPosts)
      .values({
        id: postId,
        instagramPk: cleanStoryPk,
        socialAccountId: account.id,
        postType: "story",
        // Every tracking-job story is a highlight item; a story run reads the live tray.
        captureType: run.groupKind === "tracking_job" ? "highlight" : "daily",
        content: JSON.stringify([imageUrl]),
        description: accessibilityCaption ?? null,
        mentionedAccounts: mentions.length ? JSON.stringify([{ imageIndex: 0, accounts: mentions }]) : null,
        postedAt: new Date(takenAt),
        metadata,
        scrapedFrom,
      })
      .onConflictDoNothing({ target: socialAccountPosts.id })
      .returning({ id: socialAccountPosts.id });
    if (!post) return null;
    const [photo] = await tx
      .insert(photos)
      .values({
        location: imageUrl,
        prmLocation: `post:${postId}`,
        isSubImage: false,
        fileHash,
        widthPx: dims?.width ?? width ?? null,
        heightPx: dims?.height ?? height ?? null,
        ogMetadata: { source: "instagram-story", storyPk: cleanStoryPk, takenAt },
      })
      .returning({ id: photos.id });
    return photo.id;
  });

  if (!photoId) {
    for (const f of uploaded) await (f.kind === "video" ? deleteMediaFromPrmS3(f.url) : deleteImageFromPrmS3(f.url)).catch(() => {});
    return { outcome: "duplicate", postId };
  }
  await queueMentioned(mentions);

  const imageTaskGroupId = run.runId ? await runImageTaskGroup(run.runId, account.id, username, run.groupKind) : undefined;
  await db.update(socialAccounts).set({ lastScrapedAt: new Date() }).where(eq(socialAccounts.id, account.id));
  void enqueueAutoRecognition({ kind: "story", photoIds: [photoId], videoPostId: metadata.videoUrl ? postId : undefined, imageTaskGroupId, socialAccountId: account.id });
  void onPostAddedForSummary(postId, account.id);
  return { outcome: "stored", postId };
}

const STORY_STATUS: Record<StoryOutcome["outcome"], number> = { no_account: 202, skipped: 202, duplicate: 200, stored: 201 };

/**
 * `ingestStoryItem` for a multipart request (`meta` + `image` + optional
 * `video`, parsed by `storyUpload`). Answers the request.
 */
export async function storeStoryItem(req: Request, res: Response, run: StoryRun): Promise<unknown> {
  try {
    let raw: unknown;
    try {
      raw = JSON.parse(req.body?.meta ?? "{}");
    } catch {
      return res.status(400).json({ error: "meta is not valid JSON" });
    }
    const parsed = storyMetaSchema.safeParse(raw);
    const files = (req.files ?? {}) as Record<string, Express.Multer.File[] | undefined>;
    const image = files.image?.[0];
    if (!parsed.success || !image) {
      return res.status(400).json({ error: "meta json (with scrapedFrom) and image file are required", issues: parsed.success ? [] : parsed.error.issues });
    }
    const { outcome, postId } = await ingestStoryItem(parsed.data, image, files.video?.[0] ?? null, run);
    res.status(STORY_STATUS[outcome]).json(postId ? { outcome, postId } : { outcome });
  } catch (error) {
    console.error("Error storing story:", error);
    res.status(500).json({ error: "Failed to store story" });
  }
}

export function registerStories(app: Express) {
  // The scraper confirms a freshly received run token here before it starts.
  app.get("/api/v1/stories/auth", async (req, res) => {
    const run = await authedRun(req, res);
    if (run) res.json({ ok: true, runId: run.id });
  });

  // A service just came up logged in: queued manual jobs needn't wait for the
  // unreachable retry. No token — the kick only starts what is already queued.
  app.post("/api/v1/stories/ready", (_req, res) => {
    kickManualTrackingJobs();
    res.json({ ok: true });
  });

  // Pre-upload duplication & account check
  app.post("/api/v1/stories/check", async (req, res) => {
    try {
      if (!(await authedRun(req, res))) return;
      const parsed = checkStoriesSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid request", issues: parsed.error.issues });
      }

      const pksToCheck = Array.from(new Set([
        ...(parsed.data.storyPks ?? []),
        ...(parsed.data.items?.map(i => i.storyPk) ?? []),
      ].map(pk => pk.trim()).filter(Boolean)));

      const usernamesToCheck = Array.from(new Set([
        ...(parsed.data.usernames ?? []),
        ...(parsed.data.items?.map(i => i.username).filter((u): u is string => Boolean(u)) ?? []),
      ].map(u => u.trim().toLowerCase()).filter(Boolean)));

      let missingAccountUsernames: string[] = [];

      if (usernamesToCheck.length > 0) {
        const existingAccounts = await db
          .select({ username: sql<string>`LOWER(${socialAccounts.username})` })
          .from(socialAccounts)
          .where(and(
            inArray(sql`LOWER(${socialAccounts.username})`, usernamesToCheck),
            eq(socialAccounts.typeId, INSTAGRAM_TYPE_ID),
            // A skipped account reads as unknown, so the scraper never downloads its stories.
            eq(socialAccounts.skipStories, false),
          ));

        const foundSet = new Set(existingAccounts.map(a => a.username));
        missingAccountUsernames = usernamesToCheck.filter(u => !foundSet.has(u));
      }

      res.json({
        existingStoryPks: await existingStoryPks(pksToCheck),
        missingAccountUsernames,
      });
    } catch (error) {
      console.error("Error checking story duplicates:", error);
      res.status(500).json({ error: "Failed to check duplicates" });
    }
  });

  // One story: multipart `meta` (json string) + `image` (+ optional `video`, the mp4 of a video story).
  app.post("/api/v1/stories/runs/:runId/items", storyUpload, async (req, res) => {
    if (await authedRunFor(req, res, req.params.runId)) await storeStoryItem(req, res, { runId: req.params.runId, groupKind: "story_run" });
  });

  // An own story's "Seen by" list (story-seen-by-plan.md). Merged into what's
  // stored, never replacing it: a later capture updates a viewer, and a viewer
  // only an earlier capture listed is kept. Only the run's own account's stories
  // take a list: nobody else's "Seen by" is visible to the scraper.
  app.post("/api/v1/stories/runs/:runId/seen-by", async (req, res) => {
    try {
      if (!(await authedRunFor(req, res, req.params.runId))) return;
      const parsed = seenBySchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: "Invalid request", issues: parsed.error.issues });
      const { storyPk, viewerCount, viewers } = parsed.data;
      const postId = storyPostId(storyPk);
      const [post] = await db
        .select({ seenBy: socialAccountPosts.seenBy, username: socialAccounts.username, scrapedFrom: storyScrapeRuns.scrapedFrom })
        .from(socialAccountPosts)
        .innerJoin(socialAccounts, eq(socialAccounts.id, socialAccountPosts.socialAccountId))
        .leftJoin(storyScrapeRuns, eq(storyScrapeRuns.id, req.params.runId))
        .where(eq(socialAccountPosts.id, postId));
      if (!post) return res.status(202).json({ outcome: "no_story" });
      if (!post.scrapedFrom || post.username?.toLowerCase() !== post.scrapedFrom.toLowerCase()) {
        return res.status(403).json({ outcome: "not_own_story", error: "Seen-by is only taken for the run's own account" });
      }
      const merged = new Map((post.seenBy?.viewers ?? []).map((v) => [v.pk, v]));
      for (const v of viewers) merged.set(v.pk, { ...v, reply: v.reply ?? merged.get(v.pk)?.reply ?? null });
      const seenBy: StorySeenBy = { capturedAt: new Date().toISOString(), viewerCount, viewers: [...merged.values()] };
      await db.update(socialAccountPosts).set({ seenBy, updatedAt: new Date() }).where(eq(socialAccountPosts.id, postId));
      res.json({ outcome: "stored", viewers: seenBy.viewers.length });
    } catch (error) {
      console.error("Error storing story seen-by:", error);
      res.status(500).json({ error: "Failed to store seen-by" });
    }
  });

  // An inbox note (inbox-notes-plan.md). Every sighting is kept: a note already
  // stored only gains this run's seenAt, and the Notes page collapses repeats.
  // An Instagram poster PRM doesn't track yet gets an account.
  app.post("/api/v1/stories/runs/:runId/notes", async (req, res) => {
    try {
      if (!(await authedRunFor(req, res, req.params.runId))) return;
      const parsed = noteSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: "Invalid request", issues: parsed.error.issues });
      const { user, seenAt, ...note } = parsed.data;
      const outcome = await db.transaction(async (tx) => {
        let created = false;
        const byName = sql`lower(${socialAccounts.username}) = ${user.username.toLowerCase()} AND ${socialAccounts.typeId} = ${INSTAGRAM_TYPE_ID}`;
        let [account] = await tx.select({ id: socialAccounts.id, sentNotes: socialAccounts.sentNotes }).from(socialAccounts).where(byName).limit(1).for("update");
        if (!account) {
          [account] = await tx.insert(socialAccounts)
            .values({ username: user.username, nickname: user.fullName, typeId: INSTAGRAM_TYPE_ID, internalAccountCreationType: "inbox notes", accountUrl: `https://instagram.com/${user.username}` })
            .returning({ id: socialAccounts.id, sentNotes: socialAccounts.sentNotes });
          created = true;
        }
        const notes = [...account.sentNotes];
        const i = notes.findIndex((n) => n.noteId === note.noteId);
        if (i < 0) notes.push({ ...note, seenAt: [seenAt] });
        else if (notes[i].seenAt.includes(seenAt)) return "seen_again"; // a retried delivery
        else notes[i] = { ...notes[i], seenAt: [...notes[i].seenAt, seenAt].sort() };
        await tx.update(socialAccounts).set({ sentNotes: notes }).where(eq(socialAccounts.id, account.id));
        return created ? "created_account" : i < 0 ? "stored" : "seen_again";
      });
      res.json({ outcome });
    } catch (error) {
      console.error("Error storing inbox note:", error);
      res.status(500).json({ error: "Failed to store note" });
    }
  });

  // Every stored inbox note, newest first, for the Notes page. (/api/notes is the person notes table.)
  // ?socialAccountId= narrows it to one account's notes, for that account's Notes tab.
  app.get("/api/inbox-notes", async (req, res) => {
    try {
      const accountId = typeof req.query.socialAccountId === "string" ? req.query.socialAccountId : null;
      const rows = await db
        .select({
          socialAccountId: socialAccounts.id,
          username: socialAccounts.username,
          imageUrl: socialAccounts.imageUrl,
          ownerUuid: socialAccounts.ownerUuid,
          firstName: people.firstName,
          lastName: people.lastName,
          nickname: people.nickname,
          sentNotes: socialAccounts.sentNotes,
        })
        .from(socialAccounts)
        .leftJoin(people, eq(people.id, socialAccounts.ownerUuid))
        .where(and(sql`jsonb_array_length(${socialAccounts.sentNotes}) > 0`, accountId ? eq(socialAccounts.id, accountId) : undefined));
      const notes = rows.flatMap(({ sentNotes, firstName, lastName, nickname, ...account }) =>
        sentNotes.map((n: SentNote) => ({ ...account, ownerName: account.ownerUuid ? formatPersonName({ firstName, lastName, nickname }) : null, ...n })));
      notes.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      res.json(notes);
    } catch (error) {
      console.error("Error listing inbox notes:", error);
      res.status(500).json({ error: "Failed to list notes" });
    }
  });

  // The run manifest, sent once everything above is done. The row already
  // exists (PRM minted it); this fills in the result. Idempotent.
  app.post("/api/v1/stories/runs", async (req, res) => {
    try {
      const parsed = runSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: "Invalid run manifest", issues: parsed.error.issues });
      const m = parsed.data;
      const run = await authedRunFor(req, res, m.runId, { allowNew: true });
      if (!run) return;
      const row = {
        status: m.status,
        startedAt: new Date(m.startedAt),
        finishedAt: m.finishedAt ? new Date(m.finishedAt) : null,
        counts: m.counts,
        items: m.items,
        error: m.error ?? null,
        ...(m.scrapedFrom ? { scrapedFrom: m.scrapedFrom } : {}),
      };
      // importer_id is not in `row`, so the upsert keeps the card PRM minted the run under; a new run takes the token's.
      await db.insert(storyScrapeRuns).values({ id: m.runId, importerId: run.importerId, ...row }).onConflictDoUpdate({ target: storyScrapeRuns.id, set: row });
      // The closing manifest follows every job's result: a tracking job still open was never reported (a start that failed, say).
      // Manual jobs queued while this run held the importer go next.
      if (m.finishedAt) {
        await failUnfinishedJobs(m.runId, m.status);
        kickManualTrackingJobsAfterRun();
      }
      res.status(201).json({ ok: true });
    } catch (error) {
      console.error("Error storing story run:", error);
      res.status(500).json({ error: "Failed to store run" });
    }
  });

  // Settings page: recent runs, newest first. Token columns never leave the server.
  app.get("/api/stories/runs", async (_req, res) => {
    try {
      const runs = await db
        .select({
          id: storyScrapeRuns.id,
          importerId: storyScrapeRuns.importerId,
          importerLabel: storyImporters.label,
          kind: storyScrapeRuns.kind,
          status: storyScrapeRuns.status,
          startedAt: storyScrapeRuns.startedAt,
          finishedAt: storyScrapeRuns.finishedAt,
          counts: storyScrapeRuns.counts,
          items: storyScrapeRuns.items,
          error: storyScrapeRuns.error,
          scrapedFrom: storyScrapeRuns.scrapedFrom,
        })
        .from(storyScrapeRuns)
        .leftJoin(storyImporters, eq(storyImporters.id, storyScrapeRuns.importerId))
        .orderBy(desc(storyScrapeRuns.startedAt))
        .limit(30);

      const allUsernames = new Set<string>();
      for (const run of runs) {
        const items = Array.isArray(run.items) ? (run.items as any[]) : [];
        for (const item of items) {
          if (item && typeof item.username === "string" && item.username.trim()) {
            allUsernames.add(item.username.trim().toLowerCase());
          }
        }
      }

      const accountMap = new Map<string, string>();
      if (allUsernames.size > 0) {
        const matchingAccounts = await db
          .select({
            id: socialAccounts.id,
            username: sql<string>`LOWER(${socialAccounts.username})`,
          })
          .from(socialAccounts)
          .where(
            and(
              inArray(sql`LOWER(${socialAccounts.username})`, Array.from(allUsernames)),
              eq(socialAccounts.typeId, INSTAGRAM_TYPE_ID)
            )
          );

        for (const acc of matchingAccounts) {
          accountMap.set(acc.username, acc.id);
        }
      }

      const runIds = runs.map((r) => r.id);
      const groupsForRuns = runIds.length > 0 ? await db
        .select({
          id: imageTaskGroups.id,
          socialRunId: imageTaskGroups.socialRunId,
          status: imageTaskGroups.status,
        })
        .from(imageTaskGroups)
        .where(inArray(imageTaskGroups.socialRunId, runIds)) : [];

      const groupMap = new Map<string, { id: string; status: string }>();
      for (const g of groupsForRuns) {
        if (g.socialRunId) groupMap.set(g.socialRunId, { id: g.id, status: g.status });
      }

      const enrichedRuns = runs.map((run) => {
        const items = Array.isArray(run.items) ? (run.items as any[]) : [];
        const enrichedItems = items.map((item) => {
          if (!item || typeof item !== "object") return item;
          const uname = typeof item.username === "string" ? item.username.trim().toLowerCase() : "";
          const accountId = uname ? (accountMap.get(uname) ?? null) : null;
          return {
            ...item,
            accountId,
          };
        });
        return {
          ...run,
          items: enrichedItems,
          imageTaskGroup: groupMap.get(run.id) ?? null,
        };
      });

      res.json(enrichedRuns);
    } catch (error) {
      console.error("Error listing story runs:", error);
      res.status(500).json({ error: "Failed to list runs" });
    }
  });

  // Settings page: delete a single story run.
  app.delete("/api/stories/runs/:id", requireAuth, async (req, res) => {
    try {
      const { id } = req.params;
      await failUnfinishedJobs(id, "run_deleted");
      kickManualTrackingJobsAfterRun();
      const result = await db.delete(storyScrapeRuns).where(eq(storyScrapeRuns.id, id)).returning({ id: storyScrapeRuns.id });
      if (!result.length) {
        return res.status(404).json({ error: "Run not found" });
      }
      res.json({ ok: true, deletedId: id });
    } catch (error) {
      console.error("Error deleting story run:", error);
      res.status(500).json({ error: "Failed to delete run" });
    }
  });

  // Settings page: bulk delete story runs.
  app.post("/api/stories/runs/bulk-delete", requireAuth, async (req, res) => {
    try {
      const bulkDeleteSchema = z.object({
        ids: z.array(z.string()).min(1),
      });
      const parsed = bulkDeleteSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid request, ids array required", issues: parsed.error.issues });
      }
      const { ids } = parsed.data;
      await Promise.all(ids.map((id) => failUnfinishedJobs(id, "run_deleted")));
      kickManualTrackingJobsAfterRun();
      const result = await db.delete(storyScrapeRuns).where(inArray(storyScrapeRuns.id, ids)).returning({ id: storyScrapeRuns.id });
      res.json({ ok: true, deletedCount: result.length });
    } catch (error) {
      console.error("Error bulk deleting story runs:", error);
      res.status(500).json({ error: "Failed to delete runs" });
    }
  });

  // ── Importers: one card per prm-stories install ──
  app.get("/api/stories/importers", requireAuth, async (_req, res) => {
    try {
      res.json((await db.select().from(storyImporters).orderBy(storyImporters.createdAt)).map(publicImporter));
    } catch (error) {
      console.error("Error listing story importers:", error);
      res.status(500).json({ error: "Failed to list importers" });
    }
  });

  app.post("/api/stories/importers", requireAuth, async (_req, res) => {
    try {
      const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(storyImporters);
      const [created] = await db.insert(storyImporters).values({ label: `Importer ${n + 1}`, runWindow: DEFAULT_WINDOW }).returning();
      res.status(201).json(publicImporter(created));
    } catch (error) {
      console.error("Error creating story importer:", error);
      res.status(500).json({ error: "Failed to create importer" });
    }
  });

  app.patch("/api/stories/importers/:id", requireAuth, async (req, res) => {
    try {
      const parsed = importerPatchSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: "Invalid importer", issues: parsed.error.issues });
      const importer = await importerFor(req, res);
      if (!importer) return;
      const patch = parsed.data;
      // A new URL, window or cadence means the planned time no longer applies; the scheduler re-rolls it.
      const reschedule =
        (patch.serviceUrl !== undefined && patch.serviceUrl !== importer.serviceUrl) ||
        (patch.runWindow !== undefined && patch.runWindow !== importer.runWindow) ||
        (patch.runEveryDays !== undefined && patch.runEveryDays !== importer.runEveryDays);
      // Same for tracking: a new window, or switching it on or off, drops the planned tracking run.
      const rescheduleTracking =
        (patch.trackingWindow !== undefined && patch.trackingWindow !== importer.trackingWindow) ||
        (patch.trackingEnabled !== undefined && patch.trackingEnabled !== importer.trackingEnabled);
      const [updated] = await db
        .update(storyImporters)
        .set({ ...patch, ...(reschedule ? { nextRunAt: null } : {}), ...(rescheduleTracking ? { nextTrackingRunAt: null } : {}) })
        .where(eq(storyImporters.id, importer.id))
        .returning();
      res.json(publicImporter(updated));
    } catch (error) {
      console.error("Error updating story importer:", error);
      res.status(500).json({ error: "Failed to update importer" });
    }
  });

  // Runs keep their history; importer_id becomes null (ON DELETE SET NULL).
  app.delete("/api/stories/importers/:id", requireAuth, async (req, res) => {
    try {
      const result = await db.delete(storyImporters).where(eq(storyImporters.id, req.params.id)).returning({ id: storyImporters.id });
      if (!result.length) return res.status(404).json({ error: "Importer not found" });
      res.json({ ok: true, deletedId: req.params.id });
    } catch (error) {
      console.error("Error deleting story importer:", error);
      res.status(500).json({ error: "Failed to delete importer" });
    }
  });

  // Settings page: have the importer's service open Instagram in a visible
  // Chrome window on its profile so a person can log in.
  app.post("/api/stories/importers/:id/login", requireAuth, async (req, res) => {
    try {
      const importer = await importerFor(req, res);
      if (!importer) return;
      const apiUrl = storiesServiceUrl(importer);
      if (!apiUrl) return res.status(400).json({ ok: false, reason: "no_service_url" });
      const upstream = await fetch(`${apiUrl}/login`, { method: "POST", headers: storiesServiceHeaders(importer), signal: AbortSignal.timeout(60_000) });
      const body = (await upstream.json().catch(() => ({}))) as { ok?: boolean; reason?: string };
      res.status(upstream.ok ? 200 : 409).json({ ok: Boolean(body.ok), reason: body.reason ?? null });
    } catch (error) {
      res.status(502).json({ ok: false, reason: "unreachable", error: error instanceof Error ? error.message : String(error) });
    }
  });

  // Settings page: which account the service's profile is logged in as now. A
  // re-login as another account otherwise only reaches PRM on the next run.
  app.post("/api/stories/importers/:id/whoami", requireAuth, async (req, res) => {
    const importer = await importerFor(req, res);
    if (!importer) return;
    let username: string | null = null;
    try {
      const apiUrl = storiesServiceUrl(importer);
      if (apiUrl) {
        const upstream = await fetch(`${apiUrl}/whoami`, { method: "POST", headers: storiesServiceHeaders(importer), signal: AbortSignal.timeout(5_000) });
        const body = (await upstream.json().catch(() => ({}))) as { username?: unknown };
        if (typeof body.username === "string" && body.username) username = body.username;
      }
      if (username && username !== importer.lastUsername) {
        await db.update(storyImporters).set({ lastUsername: username }).where(eq(storyImporters.id, importer.id));
      }
    } catch {
      // Service offline: keep showing the account from the last run.
    }
    res.json({ username: username ?? importer.lastUsername });
  });

  // Settings page: trigger this importer's run outside its nightly window.
  app.post("/api/stories/importers/:id/run-now", requireAuth, async (req, res) => {
    try {
      const importer = await importerFor(req, res);
      if (!importer) return;
      res.json(await triggerStoriesRun(importer, importer.runNowUnseenOnly));
    } catch (error) {
      console.error("Error triggering story run:", error);
      res.status(500).json({ error: "Failed to trigger run" });
    }
  });

  // Settings page: start a tracking run for this importer now.
  app.post("/api/stories/importers/:id/track-now", requireAuth, async (req, res) => {
    try {
      const importer = await importerFor(req, res);
      if (!importer) return;
      res.json(await trackNow(importer));
    } catch (error) {
      console.error("Error triggering tracking run:", error);
      res.status(500).json({ error: "Failed to trigger tracking run" });
    }
  });
}
