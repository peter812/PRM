// Account tracking (account-tracking-plan.md §4–5): what prm-stories delivers
// from a tracking run — profile info, follower/following lists, posts — and
// the session-side routes the account page uses to queue and list jobs.
//
// Service routes are authenticated with the run token, exactly like stories;
// a job id in the path must belong to that run. Results apply straight to the
// account: profile and follows go through applySnapshot so the history journal
// records them, posts keep the row shape the extension import used.
import type { Express, Request, Response } from "express";
import crypto from "crypto";
import multer from "multer";
import { and, asc, desc, eq, gt, gte, ilike, inArray, isNull, ne, notInArray, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { postedBy, storage } from "../storage";
import { requireAuth } from "../auth";
import { sseManager } from "../middleware/sse";
import { uploadImage, uploadMedia, uploadPostImage } from "../prm-s3";
import { syncEntityInBackground } from "../vector-universal";
import { photos, socialAccountPosts, socialPostComments, socialAccounts, storyImporters, storyScrapeRuns, trackingJobs, imageTaskGroups, instagramHighlights, instagramHighlightMemberships, nextHighlightColor, type SocialAccount, type TrackingJob, type HighlightWithStints } from "@shared/schema";
import { TRACKING_KINDS, type TrackingKind } from "@shared/interest-level";
import { generateDeterministicUuid } from "./social-media";
import { authedRun, existingStoryPks, runImageTaskGroup, storeStoryItem, storyPostId, storyUpload } from "./stories";
import { kickManualTrackingJobs, manualImporter, rateLimitedUntil } from "../stories-scheduler";
import { applySnapshot, recordPostsCapture, type CaptureScope } from "../social-account-history";
import { profileImageFromBuffer, classifyProfileImage, applyProfileImageVerdict, getImageDimensions, type ProfileImageOutcome } from "../profile-image";
import { resolveScrapedAccounts } from "../task-worker";
import { onPostAddedForSummary } from "../summary-queue";
import {
  INSTAGRAM_TYPE_ID,
  canRetry,
  cancelBatch,
  followingCounts,
  isDeferral,
  latestBatch,
  markChecked,
  queueAccountsRefresh,
  queueFollowingRefresh,
  queueManualJob,
  requeueJob,
  resolveMentionedAccounts,
  startTrackingJob,
  upcomingChecks,
} from "../tracking";
import { enqueueAutoRecognition } from "../recognition";
import { raiseIssue, resolveIssues } from "../account-issues";
import { recordPostsDeletedEvents } from "../events";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

export const postId = (pk: string) => generateDeterministicUuid(`instagram:post:${pk.trim()}`);

type ScrapedComment = { pk: string; username: string; text: string; createdAt: string; likeCount?: number | null };

/** Upsert a post's scraped comments, keyed on the Instagram comment id so re-scrapes refresh like counts. */
async function upsertComments(postId: string, comments: ScrapedComment[]) {
  if (!comments.length) return;
  await db
    .insert(socialPostComments)
    .values(comments.map((c) => ({
      postId,
      instagramCommentId: c.pk,
      username: c.username,
      text: c.text,
      likeCount: c.likeCount ?? 0,
      postedAt: new Date(c.createdAt),
    })))
    .onConflictDoUpdate({
      target: socialPostComments.instagramCommentId,
      set: {
        text: sql`excluded.text`,
        likeCount: sql`excluded.like_count`,
        username: sql`excluded.username`,
        updatedAt: new Date(),
      },
    });
}

const infoSchema = z.object({
  nickname: z.string().nullable().optional(),
  bio: z.string().nullable().optional(),
  accountUrl: z.string().nullable().optional(),
  externalImageUrl: z.string().nullable().optional(),
  reportedFollowersCount: z.number().int().nullable().optional(),
  reportedFollowingCount: z.number().int().nullable().optional(),
  reportedPostsCount: z.number().int().nullable().optional(),
  isPrivate: z.boolean().nullable().optional(),
  joinedAt: z.string().datetime().nullable().optional(),
  basedIn: z.string().nullable().optional(),
});

const followUser = z.object({ username: z.string().min(1), full_name: z.string().nullable().optional() });
const followsSchema = z.object({
  reported: z.object({ followers: z.number().int().nullable(), following: z.number().int().nullable() }),
  followers: z.array(followUser),
  following: z.array(followUser),
  complete: z.object({ followers: z.boolean(), following: z.boolean() }),
});

const postMetaSchema = z.object({
  pk: z.string().min(1),
  code: z.string().min(1),
  takenAt: z.string().datetime(),
  mediaType: z.number().int(), // 1 image, 2 video, 8 carousel
  caption: z.string().nullable().optional(),
  likeCount: z.number().int().nullable().optional(),
  /** The poster hid the like count. Missing on an older scraper: whatever the row already says. */
  likesHidden: z.boolean().optional(),
  commentCount: z.number().int().nullable().optional(),
  /** Per slide, in order: the tagged usernames (and size when known). */
  slides: z.array(z.object({ usertags: z.array(z.string()).default([]), width: z.number().nullable().optional(), height: z.number().nullable().optional() })),
  location: z.object({ pk: z.string().nullable().optional(), name: z.string() }).nullable().optional(),
  comments: z.array(z.object({ pk: z.string(), username: z.string(), text: z.string(), createdAt: z.string(), likeCount: z.number().int().nullable().optional() })).optional(),
  /** What this import holds: comments were fetched; the video itself was stored (not just its cover). */
  detail: z.object({ comments: z.boolean(), videoSupport: z.boolean() }),
  videoDuration: z.number().nullable().optional(),
  productType: z.string().nullable().optional(), // "clips" for reels, "feed" otherwise
  isPinned: z.boolean().optional(),
  music: z.record(z.unknown()).nullable().optional(),
  /** Instagram's listed author — the primary poster. Missing on an older scraper: the tracked account then. */
  author: z.string().min(1).optional(),
  coauthors: z.array(z.string()).optional(),
  /** The @username the scraper was logged in as — provenance, as on stories. */
  scrapedFrom: z.string().min(1),
});

const resultSchema = z.object({
  status: z.enum(["completed", "failed", "skipped"]),
  result: z.record(z.unknown()).optional(),
  error: z.string().nullable().optional(),
  /** posts: every pk the grid showed, so missing ones can be marked deleted. */
  seenPks: z.array(z.string()).optional(),
  /** The grid was walked to its end (else it stopped at the scan limit). */
  complete: z.boolean().optional(),
  /** takenAt of the last node scanned: an incomplete scan is authoritative only for posts newer than this. */
  oldestSeenAt: z.string().datetime().optional(),
  /** highlights: every set the profile showed; with `complete`, the missing ones were deleted. */
  seenHighlightIds: z.array(z.string()).optional(),
});

/** One highlight set as the profile shows it now. The cover fields the scraper also sends aren't kept. */
const highlightMetaSchema = z.object({
  highlightId: z.string().min(1),
  title: z.string().nullable().optional(),
  itemPks: z.array(z.string()),
});

type HighlightOutcome = "created" | "updated" | "unchanged";

/**
 * Record what a set holds now (pinned-stories-plan.md): the set itself (back
 * from deleted if it reappeared), a new stint per story that joined, the
 * position and confirmation of those still there, and a closed stint per story
 * that left. Timestamps are when PRM learned it, not when it happened.
 */
async function upsertHighlight(accountId: string, meta: z.infer<typeof highlightMetaSchema>): Promise<HighlightOutcome> {
  const now = new Date();
  const title = meta.title ?? null;
  const position = new Map<string, number>();
  for (const pk of meta.itemPks.map((p) => p.trim()).filter(Boolean)) if (!position.has(pk)) position.set(pk, position.size);

  return db.transaction(async (tx) => {
    let [set] = await tx
      .select()
      .from(instagramHighlights)
      .where(and(eq(instagramHighlights.socialAccountId, accountId), eq(instagramHighlights.instagramId, meta.highlightId)))
      .limit(1);
    let outcome: HighlightOutcome = "unchanged";
    if (!set) {
      const live = await tx
        .select({ color: instagramHighlights.color })
        .from(instagramHighlights)
        .where(and(eq(instagramHighlights.socialAccountId, accountId), isNull(instagramHighlights.deletedSeenAt)));
      [set] = await tx
        .insert(instagramHighlights)
        .values({ socialAccountId: accountId, instagramId: meta.highlightId, title, color: nextHighlightColor(live.map((l) => l.color)), firstSeenAt: now, lastSeenAt: now })
        .returning();
      outcome = "created";
    } else {
      if (set.title !== title || set.deletedSeenAt) outcome = "updated";
      await tx.update(instagramHighlights).set({ title, lastSeenAt: now, deletedSeenAt: null }).where(eq(instagramHighlights.id, set.id));
    }

    const open = await tx
      .select()
      .from(instagramHighlightMemberships)
      .where(and(eq(instagramHighlightMemberships.highlightId, set.id), isNull(instagramHighlightMemberships.leftSeenAt)));
    const openPks = new Set(open.map((m) => m.storyPk));
    const joined = [...position].filter(([pk]) => !openPks.has(pk));
    const left = open.filter((m) => !position.has(m.storyPk));
    const kept = open.filter((m) => position.has(m.storyPk));
    if (joined.length) {
      await tx.insert(instagramHighlightMemberships).values(joined.map(([storyPk, pos]) => ({ highlightId: set.id, storyPk, position: pos, placedSeenAt: now, lastConfirmedAt: now })));
    }
    if (left.length) {
      await tx
        .update(instagramHighlightMemberships)
        .set({ leftSeenAt: now, leftReason: "removed" })
        .where(inArray(instagramHighlightMemberships.id, left.map((m) => m.id)));
    }
    if (kept.length) {
      await tx.update(instagramHighlightMemberships).set({ lastConfirmedAt: now }).where(inArray(instagramHighlightMemberships.id, kept.map((m) => m.id)));
    }
    const moved = kept.filter((m) => m.position !== position.get(m.storyPk));
    for (const m of moved) {
      await tx.update(instagramHighlightMemberships).set({ position: position.get(m.storyPk)! }).where(eq(instagramHighlightMemberships.id, m.id));
    }
    if (outcome === "unchanged" && (joined.length || left.length || moved.length)) outcome = "updated";
    return outcome;
  });
}

/**
 * The running job for `:id` under the request's run, with its account, or null
 * with the error sent. `waiting` also accepts one still queued in the run — a
 * result for a job the run never started (budget, tripwire).
 */
async function jobFor(req: Request, res: Response, opts: { waiting?: boolean } = {}): Promise<{ job: TrackingJob; account: SocialAccount } | null> {
  const run = await authedRun(req, res);
  if (!run) return null;
  const [row] = await db
    .select({ job: trackingJobs, account: socialAccounts })
    .from(trackingJobs)
    .innerJoin(socialAccounts, eq(socialAccounts.id, trackingJobs.socialAccountId))
    .where(eq(trackingJobs.id, req.params.id))
    .limit(1);
  if (!row || row.job.runId !== run.id) {
    res.status(404).json({ error: "Job not found in this run" });
    return null;
  }
  if (row.job.status !== "running" && !(opts.waiting && row.job.status === "queued")) {
    res.status(409).json({ error: `Job is ${row.job.status}` });
    return null;
  }
  return row;
}

function storeMedia(buffer: Buffer, name: string, mime: string, kind: "image" | "video"): Promise<string> {
  return kind === "video" ? uploadMedia(buffer, name, mime) : uploadImage(buffer, name, mime);
}

/** The `meta` field of a multipart body, parsed against `schema`; null with a 400 sent when it isn't valid. */
function parseMeta<T extends z.ZodTypeAny>(req: Request, res: Response, schema: T): z.infer<T> | null {
  let raw: unknown;
  try {
    raw = JSON.parse(typeof req.body?.meta === "string" ? req.body.meta : "{}");
  } catch {
    res.status(400).json({ error: "meta is not valid JSON" });
    return null;
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid meta", issues: parsed.error.issues });
    return null;
  }
  return parsed.data;
}

/** Tagged handles to accounts per the Tracking page's mention settings; never fails the import that found them. */
export async function queueMentioned(handles: string[]): Promise<void> {
  try {
    if ((await resolveMentionedAccounts(handles))?.batch) kickManualTrackingJobs();
  } catch (err) {
    console.error("Tracking: mentioned accounts not resolved:", err);
  }
}

const fail = (res: Response, what: string, error: unknown) => {
  console.error(`Tracking: ${what}:`, error);
  res.status(500).json({ error: `Failed to ${what}` });
};

export function registerTracking(app: Express) {
  // ── Service side ──

  // The service is about to work this job: queued → running. 409 when it was
  // removed or is no longer waiting in this run, and the service skips it.
  app.post("/api/v1/tracking/jobs/:id/start", async (req, res) => {
    try {
      const run = await authedRun(req, res);
      if (!run) return;
      const job = await startTrackingJob(req.params.id, run.id);
      if (!job) return res.status(409).json({ error: "Job is not waiting in this run" });
      res.json({ ok: true });
    } catch (error) {
      fail(res, "start job", error);
    }
  });

  // Profile info: multipart `meta` JSON + optional `image` (the 1080p picture).
  app.post("/api/v1/tracking/jobs/:id/info", upload.single("image"), async (req, res) => {
    try {
      const ctx = await jobFor(req, res);
      if (!ctx) return;
      const meta = parseMeta(req, res, infoSchema);
      if (!meta) return;
      const { account } = ctx;

      let image: ProfileImageOutcome | undefined;
      if (req.file) {
        const fetched = await profileImageFromBuffer(req.file.buffer, req.file.mimetype, meta.externalImageUrl ?? undefined);
        const verdict = await classifyProfileImage(account, fetched);
        if (verdict.replace) {
          image = await applyProfileImageVerdict(account.id, account, fetched, verdict);
        }
      }
      await applySnapshot({
        socialAccountId: account.id,
        scope: "profile",
        profile: {
          nickname: meta.nickname,
          bio: meta.bio,
          accountUrl: meta.accountUrl,
          image,
          externalImageUrl: meta.externalImageUrl,
          reportedFollowersCount: meta.reportedFollowersCount,
          reportedFollowingCount: meta.reportedFollowingCount,
          ...(meta.joinedAt ? { joinedAt: new Date(meta.joinedAt) } : {}),
          // "Based in" fills an empty location; a location someone typed stays.
          ...(!account.location && meta.basedIn ? { location: meta.basedIn } : {}),
        },
        source: "prm-stories",
      });
      // Fields the journal doesn't track.
      await db
        .update(socialAccounts)
        .set({
          reportedPostsCount: meta.reportedPostsCount ?? account.reportedPostsCount,
          isPrivate: meta.isPrivate ?? account.isPrivate,
        })
        .where(eq(socialAccounts.id, account.id));
      if (meta.isPrivate === false) await resolveIssues(account.id, ["private"], "became_public");
      res.json({ ok: true, imageReplaced: Boolean(image), imageChange: image?.imageChange ?? null });
    } catch (error) {
      fail(res, "store profile info", error);
    }
  });

  // Follower and following lists, one blob. Only a complete direction is authoritative.
  app.post("/api/v1/tracking/jobs/:id/follows", async (req, res) => {
    try {
      const ctx = await jobFor(req, res);
      if (!ctx) return;
      const parsed = followsSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: "Invalid follows payload", issues: parsed.error.issues });
      const { reported, followers, following, complete } = parsed.data;
      const scope: CaptureScope =
        complete.followers && complete.following ? "both" : complete.followers ? "followers" : complete.following ? "following" : "profile";

      const followerRows = complete.followers ? followers : [];
      const followingRows = complete.following ? following : [];
      const resolved = await resolveScrapedAccounts([...followerRows, ...followingRows], INSTAGRAM_TYPE_ID, "prm-stories");
      const idsFor = (rows: { username: string }[]) => rows.map((r) => resolved.get(r.username.trim().toLowerCase())).filter((id): id is string => Boolean(id));
      const entry = await applySnapshot({
        socialAccountId: ctx.account.id,
        scope,
        followerIds: complete.followers ? idsFor(followerRows) : undefined,
        followingIds: complete.following ? idsFor(followingRows) : undefined,
        profile: { reportedFollowersCount: reported.followers ?? undefined, reportedFollowingCount: reported.following ?? undefined },
        source: "prm-stories",
      });
      res.json({
        ok: true,
        scope,
        followersAdded: entry.followersAdded,
        followersLost: entry.followersLost,
        followingAdded: entry.followingAdded,
        followingLost: entry.followingLost,
      });
    } catch (error) {
      fail(res, "store follows", error);
    }
  });

  // Which of these posts PRM already holds; the scraper imports only the rest.
  app.post("/api/v1/tracking/jobs/:id/posts/check", async (req, res) => {
    try {
      if (!(await jobFor(req, res))) return;
      const pks: string[] = Array.isArray(req.body?.pks) ? req.body.pks.map(String) : [];
      const rows = pks.length
        ? await db.select({ pk: socialAccountPosts.instagramPk }).from(socialAccountPosts).where(inArray(socialAccountPosts.instagramPk, pks))
        : [];
      res.json({ existing: rows.map((r) => r.pk) });
    } catch (error) {
      fail(res, "check posts", error);
    }
  });

  // One post: multipart `meta` JSON + `slide_<n>` images + optional `video`.
  // A post PRM already has (a redelivery) is updated in place; its slides stay.
  app.post("/api/v1/tracking/jobs/:id/posts", upload.any(), async (req, res) => {
    try {
      const ctx = await jobFor(req, res);
      if (!ctx) return;
      const meta = parseMeta(req, res, postMetaSchema);
      if (!meta) return;
      const files = (req.files ?? []) as Express.Multer.File[];
      const slides = files
        .filter((f) => /^slide_\d+$/.test(f.fieldname))
        .sort((a, b) => Number(a.fieldname.slice(6)) - Number(b.fieldname.slice(6)));
      const video = files.find((f) => f.fieldname === "video");
      const id = postId(meta.pk);

      const [existing] = await db.select().from(socialAccountPosts).where(eq(socialAccountPosts.id, id)).limit(1);
      if (!existing && slides.length === 0) return res.status(400).json({ error: "A new post needs at least one slide" });

      // A collab post is one row under its primary poster, with the other
      // posters alongside. Whichever collaborator's grid it came from, the
      // posters are resolved to accounts (created if PRM hasn't met them) and
      // the tracked account must be one of them.
      const author = (meta.author ?? ctx.account.username).trim().toLowerCase();
      const coauthorNames = (meta.coauthors ?? []).map((u) => u.trim().toLowerCase()).filter((u) => u && u !== author);
      const resolved = await resolveScrapedAccounts([author, ...coauthorNames].map((username) => ({ username })), INSTAGRAM_TYPE_ID, "prm-stories");
      const primaryId = resolved.get(author);
      if (!primaryId) return res.status(500).json({ error: `Could not resolve @${author}` });
      const coauthorAccountIds = [...new Set(coauthorNames.map((u) => resolved.get(u)).filter((v): v is string => Boolean(v)))];
      if (primaryId !== ctx.account.id && !coauthorAccountIds.includes(ctx.account.id)) {
        return res.status(409).json({ error: `Post belongs to @${author}, not the tracked account` });
      }
      await queueMentioned(meta.slides.flatMap((s) => s.usertags));

      const metadata: Record<string, unknown> = {
        ...((existing?.metadata as Record<string, unknown> | null) ?? {}),
        code: meta.code,
        detail: { comments: meta.detail.comments, videoSupport: Boolean(video) },
        mediaType: meta.mediaType,
        productType: meta.productType ?? null,
        isPinned: meta.isPinned ?? false,
        location: meta.location ?? null,
        music: meta.music ?? null,
        author,
        coauthors: coauthorNames,
        videoDuration: meta.videoDuration ?? null,
      };
      if (video) {
        try {
          metadata.videoUrl = await storeMedia(video.buffer, `${meta.pk}.mp4`, video.mimetype?.startsWith("video/") ? video.mimetype : "video/mp4", "video");
        } catch (err) {
          console.error(`Post ${meta.pk}: video not stored:`, err);
          metadata.detail = { comments: meta.detail.comments, videoSupport: false };
          metadata.videoError = err instanceof Error ? err.message : String(err);
        }
      }
      // Instagram leaks the real like_count even when the poster hid it; PRM stores only what a viewer sees.
      const likesHidden = meta.likesHidden ?? existing?.likesHidden ?? false;
      const shared = {
        description: meta.caption ?? existing?.description ?? null,
        likesHidden,
        likeCount: likesHidden ? 0 : meta.likeCount ?? existing?.likeCount ?? 0,
        commentCount: meta.commentCount ?? existing?.commentCount ?? 0,
        mentionedAccounts: JSON.stringify(meta.slides.map((s, i) => ({ imageIndex: i, accounts: s.usertags })).filter((m) => m.accounts.length)),
        socialAccountId: primaryId,
        coauthorAccountIds,
        metadata,
        scrapedFrom: meta.scrapedFrom,
        updatedAt: new Date(),
      };

      if (existing) {
        await db.update(socialAccountPosts).set(shared).where(eq(socialAccountPosts.id, id));
        await upsertComments(id, meta.comments ?? []);
        return res.json({ outcome: "updated", postId: id });
      }

      // Bytes go to storage first; the rows land together, so a failed insert
      // can't leave photos pointing at a post that doesn't exist. The post row
      // goes first so a duplicate (racing job) writes nothing instead of failing.
      const stored = await Promise.all(
        slides.map(async (slide, i) => {
          const fileHash = crypto.createHash("sha256").update(slide.buffer).digest("hex");
          let url = (await storage.getPhotoByFileHash(fileHash))?.location;
          if (!url) url = await uploadPostImage(slide.buffer, `${meta.pk}_${i}.jpg`, slide.mimetype || "image/jpeg");
          return { url, fileHash, dims: getImageDimensions(slide.buffer) };
        })
      );
      const photoIds = await db.transaction(async (tx) => {
        const [post] = await tx
          .insert(socialAccountPosts)
          .values({
            id,
            instagramPk: meta.pk,
            postType: meta.mediaType === 2 ? "video" : meta.mediaType === 8 ? "carousel" : "post",
            content: JSON.stringify(stored.map((s) => s.url)),
            postedAt: new Date(meta.takenAt),
            ...shared,
          })
          .onConflictDoNothing({ target: socialAccountPosts.id })
          .returning({ id: socialAccountPosts.id });
        if (!post) return null;
        const created = await tx
          .insert(photos)
          .values(stored.map(({ url, fileHash, dims }, i) => ({
            location: url,
            prmLocation: `post:${id}`,
            isSubImage: false,
            fileHash,
            // Measured from the stored file (face boxes use its pixels); Instagram's reported size is a fallback.
            widthPx: dims?.width ?? meta.slides[i]?.width ?? null,
            heightPx: dims?.height ?? meta.slides[i]?.height ?? null,
            ogMetadata: { source: "instagram-post", pk: meta.pk, code: meta.code, slide: i, takenAt: meta.takenAt },
          })))
          .returning({ id: photos.id });
        return created.map((p) => p.id);
      });
      if (!photoIds) return res.json({ outcome: "duplicate", postId: id });
      await upsertComments(id, meta.comments ?? []);
      for (const photoId of photoIds) syncEntityInBackground("image", photoId);
      const imageTaskGroupId = ctx.job.runId ? await runImageTaskGroup(ctx.job.runId, ctx.account.id, ctx.account.username ?? "", "tracking_job") : undefined;
      void enqueueAutoRecognition({ kind: "post", photoIds, videoPostId: metadata.videoUrl ? id : undefined, imageTaskGroupId, socialAccountId: primaryId });
      void onPostAddedForSummary(id, primaryId);
      res.status(201).json({ outcome: "stored", postId: id });
    } catch (error) {
      fail(res, "store post", error);
    }
  });

  // Highlights: which of these stories PRM already holds; the scraper downloads only the rest.
  app.post("/api/v1/tracking/jobs/:id/highlights/check", async (req, res) => {
    try {
      const ctx = await jobFor(req, res);
      if (!ctx) return;
      const pks: string[] = Array.isArray(req.body?.pks) ? req.body.pks.map((pk: unknown) => String(pk).trim()).filter(Boolean) : [];
      // A skipped account's stories are never stored, so all of them read as held and none download.
      res.json({ existing: ctx.account.skipStories ? pks : await existingStoryPks(pks) });
    } catch (error) {
      fail(res, "check highlight stories", error);
    }
  });

  // A highlighted story PRM didn't have: stored exactly as a story run's item.
  app.post("/api/v1/tracking/jobs/:id/highlights/items", storyUpload, async (req, res) => {
    const ctx = await jobFor(req, res);
    if (ctx) await storeStoryItem(req, res, { runId: ctx.job.runId, groupKind: "tracking_job" });
  });

  // One set as the profile shows it now: multipart `meta` (+ a `cover` file, ignored).
  app.post("/api/v1/tracking/jobs/:id/highlights", upload.any(), async (req, res) => {
    try {
      const ctx = await jobFor(req, res);
      if (!ctx) return;
      const meta = parseMeta(req, res, highlightMetaSchema);
      if (!meta) return;
      res.json({ outcome: await upsertHighlight(ctx.account.id, meta) });
    } catch (error) {
      fail(res, "store highlight", error);
    }
  });

  // The job is over. A completed check (or one Instagram can't do: private, gone)
  // stamps the account and rolls its due date; a failed or budget-cut one leaves it due.
  app.post("/api/v1/tracking/jobs/:id/result", async (req, res) => {
    try {
      const ctx = await jobFor(req, res, { waiting: true });
      if (!ctx) return;
      const parsed = resultSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: "Invalid result", issues: parsed.error.issues });
      const r = parsed.data;
      const { job, account } = ctx;
      const result: Record<string, unknown> = { ...(r.result ?? {}) };

      const reason = typeof result.reason === "string" ? result.reason : null;
      if (reason === "private") await db.update(socialAccounts).set({ isPrivate: true }).where(eq(socialAccounts.id, account.id));

      if (r.status === "completed" && job.kind === "posts") {
        // A post PRM holds that the grid no longer shows was deleted — within
        // what the scan measured. A complete walk measured everything; one that
        // stopped at the scan limit vouches only for posts newer than the last
        // node it saw, so older ones are out of range, not gone. Rows are never
        // deleted, only flagged. An empty grid on an account that claims posts
        // is a scan that broke, not a purge.
        const conditions: SQL[] = [
          eq(socialAccountPosts.socialAccountId, account.id),
          ne(socialAccountPosts.postType, "story"),
          eq(socialAccountPosts.isDeleted, false),
        ];
        if (r.seenPks?.length) conditions.push(notInArray(socialAccountPosts.instagramPk, r.seenPks));
        if (!r.complete) conditions.push(gt(socialAccountPosts.postedAt, new Date(r.oldestSeenAt ?? 0)));
        let deleted: string[] = [];
        if (!r.seenPks) {
          result.deletionsSkipped = "no_seen_pks";
        } else if (r.seenPks.length === 0 && account.reportedPostsCount !== 0) {
          result.deletionsSkipped = "empty_scan";
        } else if (!r.complete && !r.oldestSeenAt) {
          result.deletionsSkipped = "no_window";
        } else {
          const rows = await db
            .update(socialAccountPosts)
            .set({ isDeleted: true, updatedAt: new Date() })
            .where(and(...conditions))
            .returning({ id: socialAccountPosts.id });
          deleted = rows.map((p) => p.id);
          result.markedDeleted = deleted.length;
        }

        // Every post delivered under this job lands in the journal, as a follower
        // scrape does. The posts arrived one request at a time, so "this job's"
        // posts are the ones the account is on that were created since it started.
        const added = (
          await db
            .select({ id: socialAccountPosts.id })
            .from(socialAccountPosts)
            .where(and(postedBy(account.id), gte(socialAccountPosts.createdAt, job.startedAt ?? job.createdAt)))
            .orderBy(desc(socialAccountPosts.postedAt))
        ).map((p) => p.id);
        result.imported = added.length;
        await recordPostsCapture(account.id, { added, deleted }, "prm-stories");
        await recordPostsDeletedEvents(account, deleted);
      }

      if (r.status === "completed" && job.kind === "highlights" && r.complete && r.seenHighlightIds) {
        // A live set the profile no longer shows was deleted; its stories leave it with it.
        const now = new Date();
        const gone = await db
          .update(instagramHighlights)
          .set({ deletedSeenAt: now })
          .where(and(
            eq(instagramHighlights.socialAccountId, account.id),
            isNull(instagramHighlights.deletedSeenAt),
            r.seenHighlightIds.length ? notInArray(instagramHighlights.instagramId, r.seenHighlightIds) : undefined,
          ))
          .returning({ id: instagramHighlights.id });
        if (gone.length) {
          await db
            .update(instagramHighlightMemberships)
            .set({ leftSeenAt: now, leftReason: "set_deleted" })
            .where(and(inArray(instagramHighlightMemberships.highlightId, gone.map((g) => g.id)), isNull(instagramHighlightMemberships.leftSeenAt)));
        }
        result.setsDeleted = gone.length;
      }

      if (isDeferral(r.status, reason) && canRetry(job)) {
        // The run never really got to this job (budget, tripwire): back in the queue for the next one.
        await requeueJob(job.id);
      } else {
        await db
          .update(trackingJobs)
          .set({ status: r.status, result, error: r.error ?? null, finishedAt: new Date() })
          .where(eq(trackingJobs.id, job.id));
        sseManager.broadcast("tracking_job.updated", { id: job.id, status: r.status, action: "finished" });
      }
      if (r.status === "completed" || reason === "private" || reason === "not_found") {
        await markChecked(account.id, job.kind as TrackingKind);
      }
      // Issues (account-issues-plan.md §3): a wall opens one, a check that got through closes it.
      const kind = job.kind as TrackingKind;
      if (reason === "not_found") await raiseIssue(account.id, "not_found", { id: job.id, kind });
      else if (reason === "private" && kind !== "info") await raiseIssue(account.id, "private", { id: job.id, kind });
      else if (r.status === "completed") await resolveIssues(account.id, kind === "info" ? ["not_found"] : ["not_found", "private"], "recheck_ok");
      sseManager.broadcast("social_account.updated", { id: account.id });
      syncEntityInBackground("social_account", account.id);
      res.json({ ok: true });
    } catch (error) {
      fail(res, "finish job", error);
    }
  });

  // ── Session side ──

  // The account's highlight sets, deleted ones too, each with every stint and the story row it points at.
  app.get("/api/social-accounts/:id/highlights", requireAuth, async (req, res) => {
    try {
      const sets = await db
        .select()
        .from(instagramHighlights)
        .where(eq(instagramHighlights.socialAccountId, req.params.id))
        .orderBy(asc(instagramHighlights.firstSeenAt));
      const stints = sets.length
        ? await db
            .select()
            .from(instagramHighlightMemberships)
            .where(inArray(instagramHighlightMemberships.highlightId, sets.map((s) => s.id)))
            .orderBy(asc(instagramHighlightMemberships.placedSeenAt))
        : [];
      const out: HighlightWithStints[] = sets.map((set) => ({
        ...set,
        stints: stints.filter((m) => m.highlightId === set.id).map((m) => ({ ...m, postId: storyPostId(m.storyPk) })),
      }));
      res.json(out);
    } catch (error) {
      fail(res, "load highlights", error);
    }
  });

  app.patch("/api/instagram-highlights/:id", requireAuth, async (req, res) => {
    try {
      const parsed = z.object({ color: z.string().regex(/^#[0-9a-f]{6}$/i) }).strict().safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: "color must be a #rrggbb hex color" });
      const [row] = await db
        .update(instagramHighlights)
        .set({ color: parsed.data.color.toLowerCase() })
        .where(eq(instagramHighlights.id, req.params.id))
        .returning();
      if (!row) return res.status(404).json({ error: "Highlight not found" });
      res.json(row);
    } catch (error) {
      fail(res, "update highlight", error);
    }
  });

  app.post("/api/social-accounts/:id/tracking-jobs", requireAuth, async (req, res) => {
    try {
      const kind = req.body?.kind as TrackingKind;
      if (!TRACKING_KINDS.includes(kind)) return res.status(400).json({ error: "Unknown job kind" });
      const account = await storage.getSocialAccountById(req.params.id);
      if (!account) return res.status(404).json({ error: "Social account not found" });
      if (account.typeId !== INSTAGRAM_TYPE_ID) return res.status(400).json({ error: "Only Instagram accounts can be tracked" });
      const [open] = await db
        .select({ id: trackingJobs.id })
        .from(trackingJobs)
        .where(and(eq(trackingJobs.socialAccountId, account.id), eq(trackingJobs.kind, kind), inArray(trackingJobs.status, ["queued", "running"])))
        .limit(1);
      if (open) return res.status(409).json({ error: "That check is already queued" });
      const job = await queueManualJob(account.id, kind);
      kickManualTrackingJobs();
      res.status(201).json(job);
    } catch (error) {
      fail(res, "queue job", error);
    }
  });

  app.get("/api/social-accounts/:id/tracking-jobs", requireAuth, async (req, res) => {
    try {
      const account = await storage.getSocialAccountById(req.params.id);
      if (!account) return res.status(404).json({ error: "Social account not found" });
      res.json(await db.select().from(trackingJobs).where(eq(trackingJobs.socialAccountId, account.id)).orderBy(desc(trackingJobs.createdAt)).limit(20));
    } catch (error) {
      fail(res, "list jobs", error);
    }
  });

  // The background-tasks panel: running jobs, the next few waiting, and anything
  // that just finished so a tracked row can flip to its final status.
  // ?scheduled=0 leaves out the morning run's jobs.
  app.get("/api/tracking-jobs/current", requireAuth, async (req, res) => {
    try {
      const WAITING_SHOWN = 25;
      const originFilter = req.query.scheduled === "0" ? eq(trackingJobs.origin, "manual") : undefined;
      const cols = {
        id: trackingJobs.id,
        socialAccountId: trackingJobs.socialAccountId,
        username: socialAccounts.username,
        kind: trackingJobs.kind,
        origin: trackingJobs.origin,
        status: trackingJobs.status,
      };
      const list = (where: SQL | undefined, limit: number, order: SQL | typeof trackingJobs.createdAt = trackingJobs.createdAt) =>
        db.select(cols).from(trackingJobs)
          .innerJoin(socialAccounts, eq(socialAccounts.id, trackingJobs.socialAccountId))
          .where(and(where, originFilter))
          .orderBy(order)
          .limit(limit);
      const [running, waiting, finished, [{ waitingTotal }]] = await Promise.all([
        list(eq(trackingJobs.status, "running"), 100),
        list(eq(trackingJobs.status, "queued"), WAITING_SHOWN),
        list(gt(trackingJobs.finishedAt, new Date(Date.now() - 2 * 60_000)), 100, desc(trackingJobs.finishedAt)),
        db.select({ waitingTotal: sql<number>`count(*)::int` }).from(trackingJobs).where(and(eq(trackingJobs.status, "queued"), originFilter)),
      ]);
      res.json({ jobs: [...running, ...waiting, ...finished], waitingTotal });
    } catch (error) {
      fail(res, "list current jobs", error);
    }
  });

  app.delete("/api/social-accounts/:id/tracking-jobs/:jobId", requireAuth, async (req, res) => {
    try {
      const account = await storage.getSocialAccountById(req.params.id);
      if (!account) return res.status(404).json({ error: "Social account not found" });

      const [job] = await db
        .select()
        .from(trackingJobs)
        .where(and(eq(trackingJobs.id, req.params.jobId), eq(trackingJobs.socialAccountId, account.id)))
        .limit(1);
      if (!job) return res.status(404).json({ error: "Tracking job not found" });


      if (job.status !== "queued") {
        return res.status(400).json({ error: "Cannot delete a tracking job that is not queued" });
      }

      await db
        .delete(trackingJobs)
        .where(
          and(
            eq(trackingJobs.id, job.id),
            eq(trackingJobs.socialAccountId, account.id),
            eq(trackingJobs.status, "queued"),
          )
        );
      sseManager.broadcast("tracking_job.updated", { id: job.id, action: "cancelled" });
      res.json({ ok: true });
    } catch (error) {
      fail(res, "cancel job", error);
    }
  });

  // ── Tracking page: refresh everyone I follow ──

  // What the page shows: how many accounts the user follows, the latest batch's
  // progress, and whether anything stands in the queue's way right now.
  app.get("/api/tracking/following", requireAuth, async (req, res) => {
    try {
      const kind = (req.query.kind as TrackingKind) || "info";
      if (!TRACKING_KINDS.includes(kind)) return res.status(400).json({ error: "Unknown job kind" });
      const [counts, batch, importer] = await Promise.all([followingCounts(kind), latestBatch(), manualImporter()]);
      const [activeRun] = importer
        ? await db
            .select({ id: storyScrapeRuns.id, kind: storyScrapeRuns.kind, startedAt: storyScrapeRuns.startedAt })
            .from(storyScrapeRuns)
            .where(and(eq(storyScrapeRuns.importerId, importer.id), inArray(storyScrapeRuns.status, ["starting", "running"])))
            .orderBy(desc(storyScrapeRuns.startedAt))
            .limit(1)
        : [];
      res.json({
        ...counts,
        batch,
        importer: importer ? { id: importer.id, label: importer.label, maxJobs: importer.trackingMaxJobs, hasServiceUrl: Boolean(importer.serviceUrl?.trim()) } : null,
        activeRun: activeRun ?? null,
        rateLimitedUntil: importer ? await rateLimitedUntil(importer.id) : null,
      });
    } catch (error) {
      fail(res, "read tracking status", error);
    }
  });

  // Tracking page, "Next to get updated": what the next morning run would check.
  // With auto tracking off there is no run; show what a run a day from now would take.
  app.get("/api/tracking/upcoming", requireAuth, async (_req, res) => {
    try {
      const importers = await db.select().from(storyImporters).where(eq(storyImporters.trackingEnabled, true));
      const next = importers.sort((a, b) => (a.nextTrackingRunAt?.getTime() ?? 0) - (b.nextTrackingRunAt?.getTime() ?? 0))[0] ?? (await manualImporter());
      const trackingEnabled = Boolean(next?.trackingEnabled);
      const runAt = trackingEnabled ? (next!.nextTrackingRunAt ?? new Date()) : new Date(Date.now() + 86_400_000);
      const limit = next?.trackingMaxJobs ?? 40;
      res.json({
        trackingEnabled,
        runAt,
        importerLabel: next?.label ?? null,
        limit,
        checks: await upcomingChecks(runAt, limit),
      });
    } catch (error) {
      fail(res, "read upcoming checks", error);
    }
  });

  // One manual job per followed account, as a batch; accounts with that check already open are skipped.
  app.post("/api/tracking/following/refresh", requireAuth, async (req, res) => {
    try {
      const kind = (req.body?.kind as TrackingKind) || "info";
      if (!TRACKING_KINDS.includes(kind)) return res.status(400).json({ error: "Unknown job kind" });
      const queued = await queueFollowingRefresh(kind);
      if (queued.batch) kickManualTrackingJobs();
      res.status(queued.batch ? 201 : 200).json(queued);
    } catch (error) {
      fail(res, "queue batch", error);
    }
  });

  // The accounts list's selection: one manual job per chosen account, as a batch.
  app.post("/api/tracking/accounts/refresh", requireAuth, async (req, res) => {
    try {
      const kind = req.body?.kind as TrackingKind;
      if (!TRACKING_KINDS.includes(kind)) return res.status(400).json({ error: "Unknown job kind" });
      const ids = z.array(z.string().uuid()).min(1).max(1000).safeParse(req.body?.accountIds);
      if (!ids.success) return res.status(400).json({ error: "accountIds must be 1–1000 account ids" });
      const queued = await queueAccountsRefresh(kind, ids.data);
      if (queued.batch) kickManualTrackingJobs();
      res.status(queued.batch ? 201 : 200).json(queued);
    } catch (error) {
      fail(res, "queue batch", error);
    }
  });

  app.delete("/api/tracking/batches/:id/queued", requireAuth, async (req, res) => {
    try {
      res.json({ cancelled: await cancelBatch(req.params.id) });
    } catch (error) {
      fail(res, "cancel batch", error);
    }
  });

  // Social Tasks page: recent jobs, one row each, with the image group that job's
  // posts fed. ?q matches the username; ?kind and ?status narrow the list.
  app.get("/api/tracking/jobs", requireAuth, async (req, res) => {
    try {
      const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
      const kind = typeof req.query.kind === "string" ? req.query.kind : "";
      const status = typeof req.query.status === "string" ? req.query.status : "";
      const rows = await db
        .select({
          job: trackingJobs,
          username: socialAccounts.username,
          importerLabel: storyImporters.label,
          imageTaskGroupId: sql<string | null>`(select g.id from ${imageTaskGroups} g where g.social_run_id = ${trackingJobs.runId} and g.social_account_id = ${trackingJobs.socialAccountId} limit 1)`,
        })
        .from(trackingJobs)
        .innerJoin(socialAccounts, eq(socialAccounts.id, trackingJobs.socialAccountId))
        .leftJoin(storyImporters, eq(storyImporters.id, trackingJobs.importerId))
        .where(and(
          q ? ilike(socialAccounts.username, `%${q.replace(/^@/, "")}%`) : undefined,
          kind ? eq(trackingJobs.kind, kind) : undefined,
          status ? eq(trackingJobs.status, status) : undefined,
        ))
        .orderBy(desc(trackingJobs.createdAt))
        .limit(500);
      res.json(rows.map((r) => ({ ...r.job, username: r.username, importerLabel: r.importerLabel, imageTaskGroupId: r.imageTaskGroupId })));
    } catch (error) {
      fail(res, "list jobs", error);
    }
  });

  // Removes job rows only; what they saved stays. A running job is left alone
  // so its run can still report back.
  const deleteJobs = async (ids: string[]) => {
    const deleted = await db
      .delete(trackingJobs)
      .where(and(inArray(trackingJobs.id, ids), ne(trackingJobs.status, "running")))
      .returning({ id: trackingJobs.id });
    if (deleted.length > 0) {
      sseManager.broadcast("tracking_job.updated", { count: deleted.length, action: "deleted" });
    }
    return deleted;
  };

  app.delete("/api/tracking/jobs/:id", requireAuth, async (req, res) => {
    try {
      const deleted = await deleteJobs([req.params.id]);
      if (!deleted.length) return res.status(409).json({ error: "Job not found or still running" });
      res.json({ ok: true });
    } catch (error) {
      fail(res, "delete job", error);
    }
  });

  app.post("/api/tracking/jobs/bulk-delete", requireAuth, async (req, res) => {
    try {
      const ids = z.array(z.string()).min(1).max(1000).safeParse(req.body?.ids);
      if (!ids.success) return res.status(400).json({ error: "ids must be 1–1000 job ids" });
      res.json({ deletedCount: (await deleteJobs(ids.data)).length });
    } catch (error) {
      fail(res, "delete jobs", error);
    }
  });
}
