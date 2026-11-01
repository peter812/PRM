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
import fs from "fs/promises";
import path from "path";
import multer from "multer";
import { and, asc, desc, eq, gt, gte, ilike, inArray, isNotNull, isNull, ne, notInArray, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { postedBy, storage } from "../storage";
import { requireAuth } from "../auth";
import { sseManager } from "../middleware/sse";
import { uploadImage, uploadMedia, uploadPostImage } from "../prm-s3";
import { syncEntityInBackground } from "../vector-universal";
import { photos, socialAccountPosts, socialAccountPostTags, socialPostComments, socialAccounts, storyImporters, storyScrapeRuns, trackingJobs, imageTaskGroups, instagramHighlights, instagramHighlightMemberships, nextHighlightColor, type SocialAccount, type TrackingJob, type HighlightWithStints } from "@shared/schema";
import { TRACKING_KINDS, type TrackingKind } from "@shared/interest-level";
import { generateDeterministicUuid } from "./social-media";
import { authedRun, existingStoryPks, ingestStoryItem, runImageTaskGroup, storeStoryItem, storyMetaSchema, storyPostId, storyUpload, type Upload } from "./stories";
import { kickManualTrackingJobs, manualImporter, rateLimitedUntil } from "../stories-scheduler";
import { applySnapshot, recordPostsCapture, type CaptureScope } from "../social-account-history";
import { profileImageFromBuffer, classifyProfileImage, applyProfileImageVerdict, getImageDimensions, type ProfileImageOutcome } from "../profile-image";
import { queueSocialProfileImage, resolveScrapedAccounts } from "../task-worker";
import { onPostAddedForSummary } from "../summary-queue";
import {
  INSTAGRAM_TYPE_ID,
  MAX_JOB_ATTEMPTS,
  canRetry,
  cancelBatch,
  followingCounts,
  isDeferral,
  latestBatch,
  markChecked,
  markScanned,
  type Section,
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
  /** Tagged jobs: the poster as the Tagged tab lists them, so a new account gets a name and an LQ picture. */
  poster: z.object({ username: z.string().min(1), fullName: z.string().nullable().optional(), profilePicUrl: z.string().url().nullable().optional() }).optional(),
  /** The @username the scraper was logged in as — provenance, as on stories. */
  scrapedFrom: z.string().min(1),
});

const resultSchema = z.object({
  status: z.enum(["completed", "failed", "skipped"]),
  result: z.record(z.unknown()).optional(),
  error: z.string().nullable().optional(),
  /** posts: every pk the grid showed, so missing ones can be marked deleted. tagged: every pk the Tagged tab showed. */
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
export async function upsertHighlight(accountId: string, meta: z.infer<typeof highlightMetaSchema>): Promise<HighlightOutcome> {
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
    if (moved.length === 1) {
      const m = moved[0];
      await tx.update(instagramHighlightMemberships).set({ position: position.get(m.storyPk)! }).where(eq(instagramHighlightMemberships.id, m.id));
    } else if (moved.length > 1) {
      const records = moved.map((m) => ({ id: m.id, pos: position.get(m.storyPk)! }));
      await tx.execute(sql`
        UPDATE instagram_highlight_memberships AS m
        SET position = v.pos
        FROM jsonb_to_recordset(${JSON.stringify(records)}::jsonb) AS v(id varchar, pos integer)
        WHERE m.id = v.id
      `);
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

/** A core's refusal; the service routes answer it with `status`. */
export class IngestError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

/** Profile info: the journal snapshot, the picture when it beats the one held, and the fields the journal doesn't track. */
export async function applyInfo(account: SocialAccount, meta: z.infer<typeof infoSchema>, file: Upload | null) {
  let image: ProfileImageOutcome | undefined;
  if (file) {
    const fetched = await profileImageFromBuffer(file.buffer, file.mimetype ?? "image/jpeg", meta.externalImageUrl ?? undefined);
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
  return { imageReplaced: Boolean(image), imageChange: image?.imageChange ?? null };
}

type PostOutcome = { outcome: "updated" | "duplicate" | "stored"; postId: string };

/**
 * One post. A post PRM already has (a redelivery) is updated in place; its
 * slides stay. With `taggedAccountId` the post came from that account's
 * Tagged tab: it is stored under its poster, who need not be tracked.
 */
export async function applyPost(
  ctx: { job: TrackingJob; account: SocialAccount },
  meta: z.infer<typeof postMetaSchema>,
  slides: Upload[],
  video: Upload | null,
  opts: { taggedAccountId?: string } = {},
): Promise<PostOutcome> {
  const id = postId(meta.pk);

  const [existing] = await db.select().from(socialAccountPosts).where(eq(socialAccountPosts.id, id)).limit(1);
  if (!existing && slides.length === 0) throw new IngestError(400, "A new post needs at least one slide");

  // A collab post is one row under its primary poster, with the other
  // posters alongside. Whichever collaborator's grid it came from, the
  // posters are resolved to accounts (created if PRM hasn't met them) and
  // the tracked account must be one of them — unless it was only tagged.
  // New posters start at the default level (none) and aren't otherwise queued.
  const tagged = Boolean(opts.taggedAccountId);
  const author = (meta.author ?? meta.poster?.username ?? ctx.account.username).trim().toLowerCase();
  const coauthorNames = (meta.coauthors ?? []).map((u) => u.trim().toLowerCase()).filter((u) => u && u !== author);
  const rows = [{ username: author, full_name: meta.poster?.fullName }, ...coauthorNames.map((username) => ({ username }))];
  const resolved = await resolveScrapedAccounts(rows, INSTAGRAM_TYPE_ID, tagged ? "prm-stories tagged" : "prm-stories");
  const primaryId = resolved.get(author);
  if (!primaryId) throw new IngestError(500, `Could not resolve @${author}`);
  const coauthorAccountIds = [...new Set(coauthorNames.map((u) => resolved.get(u)).filter((v): v is string => Boolean(v)))];
  if (!tagged && primaryId !== ctx.account.id && !coauthorAccountIds.includes(ctx.account.id)) {
    throw new IngestError(409, `Post belongs to @${author}, not the tracked account`);
  }
  if (tagged && meta.poster?.profilePicUrl) await queuePosterImage(primaryId, meta.poster.profilePicUrl);
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
    return { outcome: "updated", postId: id };
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
  if (!photoIds) return { outcome: "duplicate", postId: id };
  await upsertComments(id, meta.comments ?? []);
  for (const photoId of photoIds) syncEntityInBackground("image", photoId);
  const imageTaskGroupId = ctx.job.runId ? await runImageTaskGroup(ctx.job.runId, ctx.account.id, ctx.account.username ?? "", "tracking_job") : undefined;
  void enqueueAutoRecognition({ kind: "post", photoIds, videoPostId: metadata.videoUrl ? id : undefined, imageTaskGroupId, socialAccountId: primaryId });
  void onPostAddedForSummary(id, primaryId);
  return { outcome: "stored", postId: id };
}

/** A poster with no picture yet gets the LQ one the Tagged tab showed; one that has a picture keeps it. */
async function queuePosterImage(accountId: string, url: string): Promise<void> {
  const [poster] = await db.select({ imageUrl: socialAccounts.imageUrl }).from(socialAccounts).where(eq(socialAccounts.id, accountId)).limit(1);
  if (poster && !poster.imageUrl) await queueSocialProfileImage(accountId, url);
}

/** Link posts to the account whose Tagged tab showed them; a link seen again is live again. */
async function linkTagged(accountId: string, postIds: string[]): Promise<number> {
  if (!postIds.length) return 0;
  const rows = await db
    .insert(socialAccountPostTags)
    .values(postIds.map((postId) => ({ postId, socialAccountId: accountId })))
    .onConflictDoUpdate({ target: [socialAccountPostTags.postId, socialAccountPostTags.socialAccountId], set: { lastSeenAt: sql`now()`, removedSeenAt: null } })
    .returning({ postId: socialAccountPostTags.postId });
  return rows.length;
}

/**
 * After a tagged job, whatever its status: every post the tab showed that PRM
 * holds is linked (imports were linked as they landed; held ones only here).
 * A complete walk that showed something also marks the links it no longer
 * showed as removed; an incomplete or empty one vouches for nothing missing.
 */
async function applyTaggedSection(account: SocialAccount, r: { status: string; seenPks?: string[]; complete?: boolean }): Promise<Record<string, unknown>> {
  if (!r.seenPks) return { removalsSkipped: "no_seen_pks" };
  const held = r.seenPks.length
    ? await db.select({ id: socialAccountPosts.id }).from(socialAccountPosts).where(inArray(socialAccountPosts.instagramPk, r.seenPks))
    : [];
  const ids = held.map((p) => p.id);
  const out: Record<string, unknown> = { linked: await linkTagged(account.id, ids) };
  if (r.status !== "completed" || !r.complete) out.removalsSkipped = "incomplete";
  else if (!ids.length) out.removalsSkipped = "empty_scan";
  else {
    const removed = await db
      .update(socialAccountPostTags)
      .set({ removedSeenAt: new Date() })
      .where(and(eq(socialAccountPostTags.socialAccountId, account.id), isNull(socialAccountPostTags.removedSeenAt), notInArray(socialAccountPostTags.postId, ids)))
      .returning({ postId: socialAccountPostTags.postId });
    out.markedRemoved = removed.length;
  }
  return out;
}

type PostsSection = { seenPks?: string[]; complete?: boolean; oldestSeenAt?: string };

/**
 * After a completed posts scan: flag what the grid no longer shows as deleted
 * and journal what this job added and deleted. Returns counts for the result.
 */
export async function applyPostsSection(job: TrackingJob, account: SocialAccount, r: PostsSection): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
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
    out.deletionsSkipped = "no_seen_pks";
  } else if (r.seenPks.length === 0 && account.reportedPostsCount !== 0) {
    out.deletionsSkipped = "empty_scan";
  } else if (!r.complete && !r.oldestSeenAt) {
    out.deletionsSkipped = "no_window";
  } else {
    const rows = await db
      .update(socialAccountPosts)
      .set({ isDeleted: true, updatedAt: new Date() })
      .where(and(...conditions))
      .returning({ id: socialAccountPosts.id });
    deleted = rows.map((p) => p.id);
    out.markedDeleted = deleted.length;
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
  out.imported = added.length;
  await recordPostsCapture(account.id, { added, deleted }, "prm-stories");
  await recordPostsDeletedEvents(account, deleted);
  return out;
}

/** After a complete highlights read: flag the live sets the profile no longer shows as deleted. Returns how many. */
export async function applyHighlightsSection(account: SocialAccount, seenHighlightIds: string[]): Promise<number> {
  // A live set the profile no longer shows was deleted; its stories leave it with it.
  const now = new Date();
  const gone = await db
    .update(instagramHighlights)
    .set({ deletedSeenAt: now })
    .where(and(
      eq(instagramHighlights.socialAccountId, account.id),
      isNull(instagramHighlights.deletedSeenAt),
      seenHighlightIds.length ? notInArray(instagramHighlights.instagramId, seenHighlightIds) : undefined,
    ))
    .returning({ id: instagramHighlights.id });
  if (gone.length) {
    await db
      .update(instagramHighlightMemberships)
      .set({ leftSeenAt: now, leftReason: "set_deleted" })
      .where(and(inArray(instagramHighlightMemberships.highlightId, gone.map((g) => g.id)), isNull(instagramHighlightMemberships.leftSeenAt)));
  }
  return gone.length;
}

const fail = (res: Response, what: string, error: unknown) => {
  if (error instanceof IngestError) return res.status(error.status).json({ error: error.message });
  console.error(`Tracking: ${what}:`, error);
  res.status(500).json({ error: `Failed to ${what}` });
};

// ── Scans (account-scan-plan.md §5): one bundle per job, ingested from disk ──

/** Received bundles, one dir per job, until their ingest ends. */
const SCANS_DIR = path.join(process.cwd(), "uploads", "tracking-scans");
// Files stream to disk, so the cap is only a sanity bound: a full scan of 150
// posts with carousels and videos plus highlights runs to many hundreds.
const MAX_SCAN_FILES = 5000;

const sectionBase = { status: z.enum(["completed", "failed", "skipped"]), reason: z.string().optional(), error: z.string().optional() };
const scanManifestSchema = z.object({
  status: z.enum(["completed", "failed"]),
  error: z.string().nullable().optional(),
  sections: z.object({
    info: z.object({ ...sectionBase, meta: infoSchema.optional(), image: z.string().optional() }),
    posts: z.object({
      ...sectionBase,
      mode: z.enum(["recent", "full"]),
      escalated: z.enum(["deleted", "gap"]).optional(),
      seenPks: z.array(z.string()).default([]),
      complete: z.boolean().default(false),
      oldestSeenAt: z.string().datetime().optional(),
      items: z.array(z.unknown()).default([]),
    }).optional(),
    highlights: z.object({
      ...sectionBase,
      seenHighlightIds: z.array(z.string()).default([]),
      complete: z.boolean().default(false),
      items: z.array(z.unknown()).default([]),
      sets: z.array(z.unknown()).default([]),
    }).optional(),
  }),
  result: z.record(z.unknown()).default({}),
});
// Items are checked one by one at ingest, so one bad item costs that item, not the scan.
const scanPostItem = z.object({ meta: postMetaSchema, slides: z.array(z.string()), video: z.string().optional() });
// Lazy: stories.ts and this file import each other, so storyMetaSchema may not exist yet at load.
const scanStoryItem = z.object({ meta: z.lazy(() => storyMetaSchema), image: z.string(), video: z.string().optional() });
const scanSetItem = z.object({ meta: highlightMetaSchema, cover: z.string().optional() });

/** A bundle path (posts/<pk>/slide_0.jpg) under `dir`; refuses anything that would leave it. */
function inside(dir: string, rel: string): string {
  if (!/^[\w.-]+(\/[\w.-]+)*$/.test(rel) || rel.split("/").some((s) => s === "." || s === "..")) {
    throw new IngestError(400, `Bad bundle path: ${rel}`);
  }
  return path.join(dir, rel);
}

/** The multipart bundle onto disk under `dir`, each file at its field name's path. */
function receiveBundle(req: Request, res: Response, dir: string): Promise<void> {
  const save = multer({
    storage: multer.diskStorage({
      destination: (_req, file, cb) => {
        let target: string;
        try {
          target = path.dirname(inside(dir, file.fieldname));
        } catch (err) {
          return cb(err as Error, "");
        }
        fs.mkdir(target, { recursive: true }).then(() => cb(null, target), (err) => cb(err, ""));
      },
      filename: (_req, file, cb) => cb(null, path.basename(file.fieldname)),
    }),
    limits: { fileSize: 50 * 1024 * 1024, files: MAX_SCAN_FILES, fieldSize: 50 * 1024 * 1024 },
  }).any();
  return new Promise((resolve, reject) =>
    save(req, res, (err: unknown) => {
      if (err instanceof multer.MulterError) reject(new IngestError(err.code === "LIMIT_FILE_SIZE" ? 413 : 400, err.message));
      else if (err) reject(err);
      else resolve();
    }),
  );
}

/** Answer once the request body has been read off the socket, so the sender sees the answer, not a reset. */
function answerAfterBody(req: Request, res: Response, status: number, body: object) {
  if (req.readableEnded) return res.status(status).json(body);
  req.on("error", () => {}); // a sender that hangs up mid-body gets no answer; nothing to do
  req.on("end", () => res.status(status).json(body));
  req.resume();
}

type SectionState = { status: "completed" | "failed" | "skipped"; reason?: string; error?: string };
const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));
const DECIDED = new Set(["private", "not_found"]);
/** Jobs whose ingest is running in this process; a second call for one returns at once. */
const ingesting = new Set<string>();
/** Bundles still uploading at boot can only be this process's own. */
const BOOT_AT = Date.now();

/**
 * Apply a received bundle (§5.2): each section through the same cores the
 * per-call routes use, then the account's stamps, issues and retries, and the
 * job's end. Every step is an upsert or a diff, so re-running it after a
 * restart is safe. The bundle dir is removed when it ends, whatever happened.
 */
export async function ingestScan(jobId: string): Promise<void> {
  if (ingesting.has(jobId)) return;
  ingesting.add(jobId);
  const dir = path.join(SCANS_DIR, jobId);
  let job: TrackingJob | undefined;
  try {
    const [row] = await db
      .select({ job: trackingJobs, account: socialAccounts })
      .from(trackingJobs)
      .innerJoin(socialAccounts, eq(socialAccounts.id, trackingJobs.socialAccountId))
      .where(eq(trackingJobs.id, jobId))
      .limit(1);
    if (!row || row.job.status !== "running") return;
    job = row.job;
    let account = row.account;

    let manifest: z.infer<typeof scanManifestSchema>;
    try {
      manifest = scanManifestSchema.parse(JSON.parse(await fs.readFile(path.join(dir, "manifest.json"), "utf8")));
    } catch (err) {
      await endScanJob(job, account, "failed", {}, `Bundle unreadable: ${errorText(err)}`);
      return;
    }
    const { info, posts, highlights } = manifest.sections;
    const read = async (rel: string): Promise<Upload> => ({
      buffer: await fs.readFile(inside(dir, rel)),
      mimetype: rel.endsWith(".mp4") ? "video/mp4" : "image/jpeg",
    });
    const readOptional = (rel?: string) => (rel ? read(rel) : Promise.resolve(null));
    const result: Record<string, unknown> = { ...manifest.result };
    const sections: Partial<Record<Section, SectionState>> = {};
    let errors = 0;
    const itemFailed = (what: string, err: unknown) => {
      errors++;
      console.error(`Tracking scan ${jobId}: ${what}:`, err);
    };
    // A core that throws on the section as a whole fails the section, not the job.
    const sectionFailed = (s: SectionState, err: unknown) => {
      console.error(`Tracking scan ${jobId}:`, err);
      Object.assign(s, { status: "failed", error: errorText(err) });
    };

    const infoState: SectionState = (sections.info = { status: info.status, reason: info.reason, error: info.error });
    if (info.status === "completed" && info.meta) {
      try {
        result.info = await applyInfo(account, info.meta, await readOptional(info.image));
      } catch (err) {
        sectionFailed(infoState, err);
      }
    }
    // The posts pass reads the posts count info just stored.
    [account] = await db.select().from(socialAccounts).where(eq(socialAccounts.id, account.id));

    if (posts) {
      const s: SectionState = (sections.posts = { status: posts.status, reason: posts.reason, error: posts.error });
      const counts: Record<string, unknown> = { mode: posts.mode, escalated: posts.escalated, stored: 0, updated: 0, duplicate: 0 };
      for (const raw of posts.items) {
        const parsed = scanPostItem.safeParse(raw);
        if (!parsed.success) {
          itemFailed("bad post item", parsed.error.message);
          continue;
        }
        const item = parsed.data;
        try {
          const out = await applyPost({ job, account }, item.meta, await Promise.all(item.slides.map(read)), await readOptional(item.video));
          counts[out.outcome] = (counts[out.outcome] as number) + 1;
        } catch (err) {
          itemFailed(`post ${item.meta.pk}`, err);
        }
      }
      if (s.status === "completed") {
        try {
          Object.assign(counts, await applyPostsSection(job, account, posts));
        } catch (err) {
          sectionFailed(s, err);
        }
      }
      result.posts = counts;
    }

    if (highlights) {
      const s: SectionState = (sections.highlights = { status: highlights.status, reason: highlights.reason, error: highlights.error });
      const counts: Record<string, number> = {};
      const count = (outcome: string) => (counts[outcome] = (counts[outcome] ?? 0) + 1);
      for (const raw of highlights.items) {
        const parsed = scanStoryItem.safeParse(raw);
        if (!parsed.success) {
          itemFailed("bad highlight story item", parsed.error.message);
          continue;
        }
        const item = parsed.data;
        try {
          count((await ingestStoryItem(item.meta, await read(item.image), await readOptional(item.video), { runId: job.runId, groupKind: "tracking_job", account })).outcome);
        } catch (err) {
          itemFailed(`highlight story ${item.meta.storyPk}`, err);
        }
      }
      for (const raw of highlights.sets) {
        const parsed = scanSetItem.safeParse(raw);
        if (!parsed.success) {
          itemFailed("bad highlight set", parsed.error.message);
          continue;
        }
        const set = parsed.data;
        try {
          count(`set_${await upsertHighlight(account.id, set.meta)}`);
        } catch (err) {
          itemFailed(`highlight ${set.meta.highlightId}`, err);
        }
      }
      if (s.status === "completed" && highlights.complete) {
        try {
          counts.setsDeleted = await applyHighlightsSection(account, highlights.seenHighlightIds);
        } catch (err) {
          sectionFailed(s, err);
        }
      }
      result.highlights = counts;
    }

    // The account: section stamps, the scan's due date, issues.
    const states = Object.entries(sections) as [Section, SectionState][];
    // A private or gone account settles the scan, but only info learned anything: posts and
    // highlights stay unchecked until a scan actually reads them.
    const decided = (s: SectionState) => s.status === "completed" || DECIDED.has(s.reason ?? "");
    for (const [kind, s] of states) if (s.status === "completed" || (kind === "info" && decided(s))) await markChecked(account.id, kind);
    if (states.some(([, s]) => decided(s))) {
      await markScanned(account.id);
    } else {
      // If the scan failed or was skipped without any completed or decided section:
      // Don't leave scanDueAt overdue (<= now()), otherwise the scheduler immediately re-claims
      // the account in an infinite loop every run.
      // After MAX_JOB_ATTEMPTS consecutive failed scans, call markScanned to advance by normal cadence.
      // Otherwise, back off scanDueAt by at least 1 day so it doesn't spin on every tick.
      const recentScans = await db
        .select({ status: trackingJobs.status })
        .from(trackingJobs)
        .where(and(
          eq(trackingJobs.socialAccountId, account.id),
          eq(trackingJobs.kind, "scan"),
          ne(trackingJobs.id, job.id),
        ))
        .orderBy(desc(trackingJobs.createdAt))
        .limit(MAX_JOB_ATTEMPTS - 1);

      let priorConsecutiveFailures = 0;
      for (const s of recentScans) {
        if (s.status === "failed") priorConsecutiveFailures++;
        else break;
      }

      if (priorConsecutiveFailures + 1 >= MAX_JOB_ATTEMPTS) {
        await markScanned(account.id);
      } else if (account.interestLevel !== "none") {
        const retryDue = new Date(Date.now() + 24 * 60 * 60 * 1000);
        if (!account.scanDueAt || account.scanDueAt <= new Date()) {
          await db.update(socialAccounts).set({ scanDueAt: retryDue }).where(eq(socialAccounts.id, account.id));
        }
      }
    }
    const reasons = new Set(states.map(([, s]) => s.reason));
    const issueJob = { id: job.id, kind: "scan" as TrackingKind };
    if (reasons.has("private")) {
      await db.update(socialAccounts).set({ isPrivate: true }).where(eq(socialAccounts.id, account.id));
      await raiseIssue(account.id, "private", issueJob);
    }
    if (reasons.has("not_found")) await raiseIssue(account.id, "not_found", issueJob);
    if (infoState.status === "completed") await resolveIssues(account.id, ["not_found"], "recheck_ok");
    if (states.some(([kind, s]) => kind !== "info" && s.status === "completed")) await resolveIssues(account.id, ["not_found", "private"], "recheck_ok");

    // A section that ran out of budget is retried on its own, now.
    // Unrecoverable section failures are not auto-spawned as manual jobs to prevent retry loops.
    const retry = states.filter(([, s]) => s.status === "skipped" && s.reason === "budget").map(([kind]) => kind);
    if (retry.length) {
      const open = await db
        .select({ kind: trackingJobs.kind })
        .from(trackingJobs)
        .where(and(eq(trackingJobs.socialAccountId, account.id), inArray(trackingJobs.kind, retry), inArray(trackingJobs.status, ["queued", "running"])));
      const queued = retry.filter((kind) => !open.some((o) => o.kind === kind));
      for (const kind of queued) await queueManualJob(account.id, kind);
      if (queued.length) kickManualTrackingJobs();
      result.retries = queued;
    }
    result.sections = sections;
    if (errors) result.errors = errors;

    const anyCompleted = states.some(([, s]) => s.status === "completed");
    const wall = !anyCompleted && DECIDED.has(infoState.reason ?? "") ? infoState.reason : null;
    if (wall) result.reason = wall;
    const firstError = states.map(([, s]) => s.error).find(Boolean) ?? manifest.error ?? null;
    await endScanJob(job, account, anyCompleted ? "completed" : wall ? "skipped" : "failed", result, anyCompleted ? null : firstError);
  } catch (err) {
    console.error(`Tracking scan ${jobId}: ingest failed:`, err);
    if (job) {
      await db
        .update(trackingJobs)
        .set({ status: "failed", error: `Ingest failed: ${errorText(err)}`, finishedAt: new Date() })
        .where(and(eq(trackingJobs.id, job.id), eq(trackingJobs.status, "running")))
        .catch((e) => console.error(`Tracking scan ${jobId}: job not failed:`, e));
    }
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
    ingesting.delete(jobId);
  }
}

async function endScanJob(job: TrackingJob, account: SocialAccount, status: string, result: Record<string, unknown>, error: string | null) {
  await db
    .update(trackingJobs)
    .set({ status, result, error, finishedAt: new Date() })
    .where(and(eq(trackingJobs.id, job.id), eq(trackingJobs.status, "running")));
  sseManager.broadcast("tracking_job.updated", { id: job.id, status, action: "finished" });
  sseManager.broadcast("social_account.updated", { id: account.id });
  syncEntityInBackground("social_account", account.id);
}

/**
 * Boot sweep (§5.3): a bundle received before a restart finishes its ingest
 * now; a dir with no running job behind it (a half-received upload) goes.
 */
async function resumeScanIngests(): Promise<void> {
  const pending = await db
    .select({ id: trackingJobs.id })
    .from(trackingJobs)
    .where(and(eq(trackingJobs.status, "running"), isNotNull(trackingJobs.scanReceivedAt)));
  const keep = new Set(pending.map((j) => j.id));
  for (const entry of await fs.readdir(SCANS_DIR).catch(() => [] as string[])) {
    if (keep.has(entry)) continue;
    const full = path.join(SCANS_DIR, entry);
    // An upload that began after boot is in flight, not left over.
    if (entry.endsWith(".part") && ((await fs.stat(full).catch(() => null))?.mtimeMs ?? 0) >= BOOT_AT) continue;
    await fs.rm(full, { recursive: true, force: true });
  }
  for (const { id } of pending) await ingestScan(id);
}

export function registerTracking(app: Express) {
  void resumeScanIngests().catch((err) => console.error("Tracking: scan ingests not resumed:", err));

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
      res.json({ ok: true, ...(await applyInfo(ctx.account, meta, req.file ?? null)) });
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

  // Which of these posts PRM already holds, from any account; the scraper
  // imports only the rest. A tagged job's held posts are linked by /result.
  app.post(["/api/v1/tracking/jobs/:id/posts/check", "/api/v1/tracking/jobs/:id/tagged/check"], async (req, res) => {
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
  // On /tagged (tagged-posts-plan.md) it is stored under its poster and linked
  // to the tracked account, whose Tagged tab showed it.
  app.post(["/api/v1/tracking/jobs/:id/posts", "/api/v1/tracking/jobs/:id/tagged"], upload.any(), async (req, res) => {
    try {
      const ctx = await jobFor(req, res);
      if (!ctx) return;
      const meta = parseMeta(req, res, postMetaSchema);
      if (!meta) return;
      const tagged = req.path.endsWith("/tagged");
      const files = (req.files ?? []) as Express.Multer.File[];
      const slides = files
        .filter((f) => /^slide_\d+$/.test(f.fieldname))
        .sort((a, b) => Number(a.fieldname.slice(6)) - Number(b.fieldname.slice(6)));
      const stored = await applyPost(ctx, meta, slides, files.find((f) => f.fieldname === "video") ?? null, tagged ? { taggedAccountId: ctx.account.id } : {});
      if (tagged) await linkTagged(ctx.account.id, [stored.postId]);
      res.status(stored.outcome === "stored" ? 201 : 200).json(stored);
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
    if (ctx) await storeStoryItem(req, res, { runId: ctx.job.runId, groupKind: "tracking_job", account: ctx.account });
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

  // A scan's whole bundle (§3.2): onto disk, 202, then ingested in the background.
  // The token is checked before the body is read, so no route-level multer.
  app.post("/api/v1/tracking/jobs/:id/scan", async (req, res) => {
    let incoming: string | null = null;
    try {
      const run = await authedRun(req, res);
      if (!run) return;
      const [job] = await db.select().from(trackingJobs).where(eq(trackingJobs.id, req.params.id)).limit(1);
      if (!job || job.runId !== run.id) return answerAfterBody(req, res, 404, { error: "Job not found in this run" });
      // A retry after a lost answer: PRM has this job's bundle already.
      if (job.scanReceivedAt) return answerAfterBody(req, res, 200, { received: true, duplicate: true });
      if (job.status !== "running" || job.kind !== "scan") return answerAfterBody(req, res, 409, { error: `Job is ${job.status} ${job.kind}` });

      incoming = path.join(SCANS_DIR, `${job.id}.${crypto.randomUUID()}.part`);
      // A bundle with no files never makes the dir through multer.
      await fs.mkdir(incoming, { recursive: true });
      await receiveBundle(req, res, incoming);
      if (typeof req.body?.manifest !== "string") throw new IngestError(400, "manifest missing");
      await fs.writeFile(path.join(incoming, "manifest.json"), req.body.manifest);

      const [claimed] = await db
        .update(trackingJobs)
        .set({ scanReceivedAt: new Date() })
        .where(and(eq(trackingJobs.id, job.id), eq(trackingJobs.status, "running"), isNull(trackingJobs.scanReceivedAt)))
        .returning({ id: trackingJobs.id });
      if (!claimed) {
        // A racing copy won, or the run ended while this one uploaded.
        const [now] = await db.select({ scanReceivedAt: trackingJobs.scanReceivedAt, status: trackingJobs.status }).from(trackingJobs).where(eq(trackingJobs.id, job.id));
        return now?.scanReceivedAt ? res.json({ received: true, duplicate: true }) : res.status(409).json({ error: `Job is ${now?.status ?? "gone"}` });
      }
      const final = path.join(SCANS_DIR, job.id);
      try {
        await fs.rm(final, { recursive: true, force: true });
        await fs.rename(incoming, final);
      } catch (err) {
        await db.update(trackingJobs).set({ scanReceivedAt: null }).where(eq(trackingJobs.id, job.id));
        throw err;
      }
      incoming = null;
      res.status(202).json({ received: true });
      void ingestScan(job.id);
    } catch (error) {
      fail(res, "receive scan", error);
    } finally {
      if (incoming) await fs.rm(incoming, { recursive: true, force: true }).catch(() => {});
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

      if (r.status === "completed" && job.kind === "posts") Object.assign(result, await applyPostsSection(job, account, r));
      if (job.kind === "tagged") Object.assign(result, await applyTaggedSection(account, r));
      if (r.status === "completed" && job.kind === "highlights" && r.complete && r.seenHighlightIds) {
        result.setsDeleted = await applyHighlightsSection(account, r.seenHighlightIds);
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
        if (job.kind === "scan") await markScanned(account.id);
        else await markChecked(account.id, job.kind as Section);
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

  // Tracking page, "Next to get updated": what a run started now would check
  // (exactly what "Run tracking now" claims). The next scheduled run is reported
  // alongside; it takes these plus whatever comes due before it.
  app.get("/api/tracking/upcoming", requireAuth, async (_req, res) => {
    try {
      const importers = await db.select().from(storyImporters).where(eq(storyImporters.trackingEnabled, true));
      const next = importers.sort((a, b) => (a.nextTrackingRunAt?.getTime() ?? 0) - (b.nextTrackingRunAt?.getTime() ?? 0))[0] ?? (await manualImporter());
      const trackingEnabled = Boolean(next?.trackingEnabled);
      const limit = next?.trackingMaxJobs ?? 40;
      res.json({
        trackingEnabled,
        runAt: trackingEnabled ? next!.nextTrackingRunAt : null,
        importerLabel: next?.label ?? null,
        limit,
        checks: await upcomingChecks(limit),
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
  // so its run can still report back. No ids means every job.
  const deleteJobs = async (ids?: string[]) => {
    const deleted = await db
      .delete(trackingJobs)
      .where(and(ids ? inArray(trackingJobs.id, ids) : undefined, ne(trackingJobs.status, "running")))
      .returning({ id: trackingJobs.id });
    if (deleted.length > 0) {
      sseManager.broadcast("tracking_job.updated", { count: deleted.length, action: "deleted" });
    }
    return deleted;
  };

  app.delete("/api/tracking/jobs", requireAuth, async (_req, res) => {
    try {
      res.json({ deletedCount: (await deleteJobs()).length });
    } catch (error) {
      fail(res, "delete all jobs", error);
    }
  });

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
