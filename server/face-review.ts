/**
 * Face review queue: server/face-review.ts (face-review-plan.md §1, §3.1-§3.2,
 * §3.6). Builds the FaceReviewItem list per tab (story/profile/post/message)
 * plus its counts, reusing connectFace/disassociateFace (recognition.ts) and
 * lookAlikesFor/markFaceIdentitiesDirty (face-lookalikes.ts) rather than
 * reimplementing any of that.
 *
 * Item assembly is page-batched (review finding #5): every face/identity/
 * account/person lookup for a page of items runs as one query for the whole
 * page, not one per face/suggestion/look-alike.
 */
import { and, desc, eq, inArray, sql, type SQL } from "drizzle-orm";
import { db } from "./db";
import {
  faces, photos, people, socialAccounts, socialAccountPosts, messages, conversations, conversationParticipants,
  type Photo,
} from "@shared/schema";
import { profileLinkReason, type ProfileLinkReason, type FacialId } from "./recognition";
import { HQ_MIN_WIDTH } from "./profile-image";
import { lookAlikesFor, type LookAlike } from "./face-lookalikes";
import { visibleShared, canReadShared } from "./access";

export type FaceReviewKind = "story" | "profile" | "post" | "message";
export const FACE_REVIEW_KINDS: FaceReviewKind[] = ["story", "profile", "post", "message"];

// Mirrors the palette in client/src/components/face-box-overlay.tsx (FACE_COLORS) — kept as
// a small duplicate rather than a shared import, since that file is client-only (uses React).
const FACE_COLORS = ["#f43f5e", "#3b82f6", "#22c55e", "#f59e0b", "#a855f7", "#06b6d4", "#ec4899", "#84cc16"];
const faceColor = (index: number) => FACE_COLORS[index % FACE_COLORS.length];

export type FaceBox = { x: number; y: number; w: number; h: number };

export type FaceReviewSuggestion = {
  socialAccountId?: string;
  personId?: string;
  username?: string;
  imageUrl?: string | null;
  ownerName?: string | null;
  label: string;
  reason: "owner" | "coauthor" | "mentioned" | "profile_account" | "sender" | "participant";
};

export type FaceReviewFaceLookAlike = {
  personfaceUuid: string;
  score: number;
  socialAccountId?: string;
  personId?: string;
  label: string;
  cropUrl: string;
};

export type FaceReviewFace = {
  faceUuid: string;
  /** 1-based position among all faces in the photo — the number on its box, row and shortcut key. */
  number: number;
  box: FaceBox | null;
  cropUrl: string;
  color: string;
  identified: { socialAccountId?: string; personId?: string; label: string } | null;
  dismissed: boolean;
  /** Set when PRM auto-assigned this face (face-review-plan.md §8) and nobody has confirmed it. */
  autoMatchScore: number | null;
  lookAlikes: FaceReviewFaceLookAlike[];
};

export type FaceReviewItem = {
  photoId: string;
  imageUrl: string;
  width: number | null;
  height: number | null;
  kind: FaceReviewKind;
  postId?: string;
  slide?: number;
  messageId?: string;
  conversationId?: string;
  postedAt?: string;
  caption?: string;
  account: { id: string; username: string; imageUrl: string | null; ownerId: string | null; ownerName: string | null } | null;
  faces: FaceReviewFace[];
  suggestions: FaceReviewSuggestion[];
  profileLinkReason?: ProfileLinkReason;
};

export type FaceReviewCounts = Record<FaceReviewKind, number> & { total: number; dismissed: number };

// ── Face condition (§1) ──────────────────────────────────────────────────────

/**
 * True when `photos.facial_ids` has at least one entry that is unidentified
 * (personId and socialAccountId both null, and its face group isn't linked to
 * a person or account, re-checked live) and, per `dismissed`, either not
 * dismissed (the review queue) or dismissed (the Dismissed filter).
 */
function faceQualifies(dismissed: boolean): SQL {
  const dismissedClause = dismissed ? sql`f.dismissed_at IS NOT NULL` : sql`f.dismissed_at IS NULL`;
  return sql`EXISTS (
    SELECT 1 FROM jsonb_array_elements(${photos.facialIds}) AS fid
    JOIN faces f ON f.id = (fid->>'faceUuid')
    WHERE (fid->>'personId') IS NULL AND (fid->>'socialAccountId') IS NULL
      AND ${dismissedClause}
      AND NOT EXISTS (
        SELECT 1 FROM people p WHERE p.personface_uuid = f.personface_uuid
        UNION ALL
        SELECT 1 FROM social_accounts sa WHERE sa.personface_uuid = f.personface_uuid
      )
  )`;
}

const accountVisible = () => visibleShared(socialAccounts.visibility, socialAccounts.createdByUserId) ?? sql`true`;
const conversationVisible = () => visibleShared(conversations.visibility, conversations.createdByUserId) ?? sql`true`;

/** Full WHERE for one tab's queue/count query, including §3 visibility. */
function queueCondition(kind: FaceReviewKind, dismissed: boolean): SQL {
  if (kind === "profile") {
    // §1/§2: current picture, HQ, visible to the caller, and either (dismissed filter) a
    // dismissed face, or (default) an unidentified face while the account's own face isn't
    // in this photo yet — once it is, the photo leaves the tab (Q4).
    const base = [
      eq(photos.isSubImage, false),
      sql`${photos.widthPx} >= ${HQ_MIN_WIDTH}`,
      sql`jsonb_array_length(coalesce(${photos.facialIds}, '[]'::jsonb)) > 0`,
    ];
    if (!dismissed) {
      base.push(sql`EXISTS (
        SELECT 1 FROM ${socialAccounts}
        WHERE ${socialAccounts.id} = substring(${photos.prmLocation} from 15)
          AND ${socialAccounts.imageUrl} = ${photos.location}
          AND (${accountVisible()})
          AND (
            ${socialAccounts.personfaceUuid} IS NULL
            OR NOT EXISTS (
              SELECT 1 FROM jsonb_array_elements(${photos.facialIds}) AS fid
              JOIN faces f ON f.id = (fid->>'faceUuid')
              WHERE f.personface_uuid = ${socialAccounts.personfaceUuid}
            )
          )
      )`, faceQualifies(false));
    } else {
      base.push(
        sql`EXISTS (
          SELECT 1 FROM ${socialAccounts}
          WHERE ${socialAccounts.id} = substring(${photos.prmLocation} from 15)
            AND ${socialAccounts.imageUrl} = ${photos.location}
            AND (${accountVisible()})
        )`,
        faceQualifies(true),
      );
    }
    return and(sql`${photos.prmLocation} LIKE 'profile_image:%'`, ...base)!;
  }

  if (kind === "message") {
    return and(
      sql`${photos.prmLocation} LIKE 'message:%' AND EXISTS (
        SELECT 1 FROM ${messages}
        JOIN ${conversations} ON ${conversations.id} = ${messages.conversationId}
        WHERE ${messages.id} = substring(${photos.prmLocation} from 9)
          AND (${conversationVisible()})
      )`,
      sql`${photos.faceIdAt} IS NOT NULL`,
      faceQualifies(dismissed),
    )!;
  }

  // post + story both live under prm_location = 'post:<id>'; postType tells them apart.
  const isStory = kind === "story";
  return and(
    sql`${photos.prmLocation} LIKE 'post:%' AND EXISTS (
      SELECT 1 FROM ${socialAccountPosts}
      JOIN ${socialAccounts} ON ${socialAccounts.id} = ${socialAccountPosts.socialAccountId}
      WHERE ${socialAccountPosts.id} = substring(${photos.prmLocation} from 6)
        AND ${socialAccountPosts.postType} ${sql.raw(isStory ? "=" : "<>")} 'story'
        AND (${accountVisible()})
    )`,
    sql`${photos.faceIdAt} IS NOT NULL`,
    faceQualifies(dismissed),
  )!;
}

// ── Counts (§3.2) ─────────────────────────────────────────────────────────────

/** One query, one row, COUNT(*) FILTER per kind/dismissed combination (finding #6). */
export async function getFaceReviewCounts(): Promise<FaceReviewCounts> {
  const [row] = await db
    .select({
      story: sql<number>`count(*) FILTER (WHERE ${queueCondition("story", false)})::int`,
      profile: sql<number>`count(*) FILTER (WHERE ${queueCondition("profile", false)})::int`,
      post: sql<number>`count(*) FILTER (WHERE ${queueCondition("post", false)})::int`,
      message: sql<number>`count(*) FILTER (WHERE ${queueCondition("message", false)})::int`,
      storyDismissed: sql<number>`count(*) FILTER (WHERE ${queueCondition("story", true)})::int`,
      profileDismissed: sql<number>`count(*) FILTER (WHERE ${queueCondition("profile", true)})::int`,
      postDismissed: sql<number>`count(*) FILTER (WHERE ${queueCondition("post", true)})::int`,
      messageDismissed: sql<number>`count(*) FILTER (WHERE ${queueCondition("message", true)})::int`,
    })
    .from(photos);

  const story = row?.story ?? 0, profile = row?.profile ?? 0, post = row?.post ?? 0, message = row?.message ?? 0;
  const dismissed = (row?.storyDismissed ?? 0) + (row?.profileDismissed ?? 0) + (row?.postDismissed ?? 0) + (row?.messageDismissed ?? 0);
  return { story, profile, post, message, total: story + profile + post + message, dismissed };
}

// ── Queue (§3.1) ──────────────────────────────────────────────────────────────

export type FaceReviewPage = { items: FaceReviewItem[]; nextCursor: string | null };

function decodeCursor(cursor: string | undefined): { uploadedAt: Date; id: string } | null {
  if (!cursor) return null;
  const idx = cursor.lastIndexOf("_");
  if (idx < 0) return null;
  const iso = cursor.slice(0, idx);
  const id = cursor.slice(idx + 1);
  const date = new Date(iso);
  if (Number.isNaN(date.getTime()) || !id) return null;
  return { uploadedAt: date, id };
}
const encodeCursor = (p: Pick<Photo, "uploadedAt" | "id">) => `${p.uploadedAt.toISOString()}_${p.id}`;

export async function getFaceReviewQueue(kind: FaceReviewKind, dismissed: boolean, cursor: string | undefined, limit: number): Promise<FaceReviewPage> {
  const cur = decodeCursor(cursor);
  const conditions = [queueCondition(kind, dismissed)];
  if (cur) conditions.push(sql`(${photos.uploadedAt}, ${photos.id}) < (${cur.uploadedAt}, ${cur.id})`);

  const rows = await db
    .select()
    .from(photos)
    .where(and(...conditions))
    .orderBy(desc(photos.uploadedAt), desc(photos.id))
    .limit(limit + 1);

  const page = rows.slice(0, limit);
  const items = await buildItems(page, kind);

  return { items, nextCursor: rows.length > limit ? encodeCursor(page[page.length - 1]) : null };
}

/** A photo readable by the caller (§3's per-mutation check), or null (404). */
export async function getReadablePhoto(photoId: string): Promise<Photo | null> {
  const [photo] = await db.select().from(photos).where(eq(photos.id, photoId));
  if (!photo) return null;
  return (await photoReadable(photo)) ? photo : null;
}

async function photoReadable(photo: Photo): Promise<boolean> {
  const loc = photo.prmLocation ?? "";
  if (loc.startsWith("profile_image:")) {
    const accountId = loc.slice("profile_image:".length).trim();
    const [row] = await db
      .select({ visibility: socialAccounts.visibility, createdByUserId: socialAccounts.createdByUserId })
      .from(socialAccounts)
      .where(eq(socialAccounts.id, accountId));
    return row ? canReadShared(row) : false;
  }
  if (loc.startsWith("post:")) {
    const postId = loc.slice("post:".length).trim();
    const [row] = await db
      .select({ visibility: socialAccounts.visibility, createdByUserId: socialAccounts.createdByUserId })
      .from(socialAccountPosts)
      .innerJoin(socialAccounts, eq(socialAccounts.id, socialAccountPosts.socialAccountId))
      .where(eq(socialAccountPosts.id, postId));
    return row ? canReadShared(row) : false;
  }
  if (loc.startsWith("message:")) {
    const messageId = loc.slice("message:".length).trim();
    const [row] = await db
      .select({ visibility: conversations.visibility, createdByUserId: conversations.createdByUserId })
      .from(messages)
      .innerJoin(conversations, eq(conversations.id, messages.conversationId))
      .where(eq(messages.id, messageId));
    return row ? canReadShared(row) : false;
  }
  return false;
}

/** Refreshed single item, for after an assign/dismiss/undismiss (§3.3-§3.4). 404 (null) when unreadable. */
export async function getFaceReviewItem(photoId: string, kind: FaceReviewKind): Promise<FaceReviewItem | null> {
  const photo = await getReadablePhoto(photoId);
  if (!photo) return null;
  const [item] = await buildItems([photo], kind);
  return item ?? null;
}

// ── Page-level batching (finding #5) ─────────────────────────────────────────

const displayName = (p: { firstName: string; lastName: string } | null | undefined) =>
  p ? [p.firstName, p.lastName].filter(Boolean).join(" ").trim() || null : null;

type AccountInfo = { id: string; username: string; imageUrl: string | null; ownerId: string | null; ownerName: string | null };
type PersonInfo = { id: string; name: string | null };
type IdentityInfo = { personId?: string; socialAccountId?: string; label: string };

type PageCaches = {
  faceRowById: Map<string, typeof faces.$inferSelect>;
  lookAlikeMap: Map<string, LookAlike[]>;
  identityCache: Map<string, IdentityInfo>;
  cropCache: Map<string, string>;
  accountCache: Map<string, AccountInfo>;
  personCache: Map<string, PersonInfo>;
  postById: Map<string, typeof socialAccountPosts.$inferSelect>;
  messageById: Map<string, typeof messages.$inferSelect>;
  conversationById: Map<string, { title: string | null }>;
  participantsByConversation: Map<string, { personId: string | null; socialAccountId: string | null }[]>;
  mentionAccountIdByHandle: Map<string, string>;
};

/** Every known identity (person and/or account) for a batch of face groups, in two queries total. */
async function buildIdentityCache(personfaceUuids: string[]): Promise<Map<string, IdentityInfo>> {
  const map = new Map<string, IdentityInfo>();
  if (!personfaceUuids.length) return map;
  const personVis = visibleShared(people.visibility, people.createdByUserId) ?? sql`true`;
  const acctVis = accountVisible();

  const personRows = await db
    .select({ personfaceUuid: people.personfaceUuid, id: people.id, firstName: people.firstName, lastName: people.lastName })
    .from(people)
    .where(and(inArray(people.personfaceUuid, personfaceUuids), personVis));
  const accountRows = await db
    .select({ personfaceUuid: socialAccounts.personfaceUuid, id: socialAccounts.id, username: socialAccounts.username })
    .from(socialAccounts)
    .where(and(inArray(socialAccounts.personfaceUuid, personfaceUuids), acctVis));

  const personByGroup = new Map(personRows.filter((r) => r.personfaceUuid).map((r) => [r.personfaceUuid as string, r]));
  const accountByGroup = new Map<string, (typeof accountRows)[number]>();
  for (const r of accountRows) if (r.personfaceUuid && !accountByGroup.has(r.personfaceUuid)) accountByGroup.set(r.personfaceUuid, r);

  for (const uuid of personfaceUuids) {
    const person = personByGroup.get(uuid);
    const account = accountByGroup.get(uuid);
    if (!person && !account) continue;
    const label = person ? displayName(person) ?? `@${account?.username ?? ""}` : `@${account!.username}`;
    map.set(uuid, { personId: person?.id, socialAccountId: account?.id, label });
  }
  return map;
}

/** Newest face crop per group, one query for the whole batch. */
async function buildCropCache(personfaceUuids: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (!personfaceUuids.length) return map;
  const result = await db.execute(sql`
    SELECT DISTINCT ON (personface_uuid) personface_uuid, s3_url
    FROM faces WHERE ${inArray(faces.personfaceUuid, personfaceUuids)} ORDER BY personface_uuid, created_at DESC
  `);
  const rows = (result as unknown as { rows: { personface_uuid: string; s3_url: string }[] }).rows;
  for (const r of rows) map.set(r.personface_uuid, r.s3_url);
  return map;
}

async function buildAccountCache(ids: string[]): Promise<Map<string, AccountInfo>> {
  const map = new Map<string, AccountInfo>();
  if (!ids.length) return map;
  const rows = await db
    .select({
      id: socialAccounts.id,
      username: socialAccounts.username,
      imageUrl: socialAccounts.imageUrl,
      ownerId: socialAccounts.ownerUuid,
      ownerFirstName: people.firstName,
      ownerLastName: people.lastName,
    })
    .from(socialAccounts)
    .leftJoin(people, eq(people.id, socialAccounts.ownerUuid))
    .where(and(inArray(socialAccounts.id, ids), accountVisible()));
  for (const r of rows) {
    map.set(r.id, {
      id: r.id,
      username: r.username,
      imageUrl: r.imageUrl,
      ownerId: r.ownerId,
      ownerName: displayName(r.ownerFirstName != null ? { firstName: r.ownerFirstName, lastName: r.ownerLastName ?? "" } : null),
    });
  }
  return map;
}

async function buildPersonCache(ids: string[]): Promise<Map<string, PersonInfo>> {
  const map = new Map<string, PersonInfo>();
  if (!ids.length) return map;
  const personVis = visibleShared(people.visibility, people.createdByUserId) ?? sql`true`;
  const rows = await db.select({ id: people.id, firstName: people.firstName, lastName: people.lastName }).from(people).where(and(inArray(people.id, ids), personVis));
  for (const r of rows) map.set(r.id, { id: r.id, name: displayName(r) });
  return map;
}

function resolveSlide(photo: Photo, post: { content: string | null } | undefined): number | undefined {
  const ogSlide = (photo.ogMetadata as Record<string, unknown> | null)?.slide;
  if (typeof ogSlide === "number") return ogSlide;
  if (post?.content) {
    try {
      const urls = JSON.parse(post.content) as string[];
      const i = urls.indexOf(photo.location);
      if (i >= 0) return i;
    } catch { /* leave slide undefined */ }
  }
  return undefined;
}

function mentionedHandlesFor(photo: Photo, post: { mentionedAccounts: string | null } | undefined, slide: number | undefined): string[] {
  if (!post?.mentionedAccounts || slide === undefined) return [];
  try {
    const groups = JSON.parse(post.mentionedAccounts) as { imageIndex: number; accounts: string[] }[];
    return groups.find((g) => g.imageIndex === slide)?.accounts ?? [];
  } catch {
    return [];
  }
}

/** Everything item-building needs for a page of photos, fetched in a fixed, small number of queries. */
async function buildPageCaches(pagePhotos: Photo[], kind: FaceReviewKind): Promise<PageCaches> {
  const allFaceUuids = Array.from(
    new Set(pagePhotos.flatMap((p) => ((p.facialIds ?? []) as FacialId[]).map((f) => f.faceUuid).filter((u): u is string => !!u))),
  );
  const faceRows = allFaceUuids.length ? await db.select().from(faces).where(inArray(faces.id, allFaceUuids)) : [];
  const faceRowById = new Map(faceRows.map((f) => [f.id, f]));
  const lookAlikeMap = await lookAlikesFor(allFaceUuids);

  const identityUuids = new Set<string>();
  for (const f of faceRows) if (f.personfaceUuid) identityUuids.add(f.personfaceUuid);
  for (const list of lookAlikeMap.values()) for (const la of list) identityUuids.add(la.personfaceUuid);
  const [identityCache, cropCache] = await Promise.all([buildIdentityCache([...identityUuids]), buildCropCache([...identityUuids])]);

  const accountIds = new Set<string>();
  const personIds = new Set<string>();
  let postById = new Map<string, typeof socialAccountPosts.$inferSelect>();
  let messageById = new Map<string, typeof messages.$inferSelect>();
  let conversationById = new Map<string, { title: string | null }>();
  const participantsByConversation = new Map<string, { personId: string | null; socialAccountId: string | null }[]>();
  const mentionAccountIdByHandle = new Map<string, string>();

  if (kind === "profile") {
    for (const p of pagePhotos) {
      const id = p.prmLocation.slice("profile_image:".length).trim();
      if (id) accountIds.add(id);
    }
  } else if (kind === "post" || kind === "story") {
    const postIds = Array.from(new Set(pagePhotos.map((p) => p.prmLocation.slice("post:".length).trim()).filter(Boolean)));
    const rows = postIds.length ? await db.select().from(socialAccountPosts).where(inArray(socialAccountPosts.id, postIds)) : [];
    postById = new Map(rows.map((r) => [r.id, r]));
    for (const post of rows) {
      accountIds.add(post.socialAccountId);
      for (const co of post.coauthorAccountIds ?? []) accountIds.add(co);
    }
    const handleSet = new Set<string>();
    for (const photo of pagePhotos) {
      const post = postById.get(photo.prmLocation.slice("post:".length).trim());
      const slide = resolveSlide(photo, post);
      for (const h of mentionedHandlesFor(photo, post, slide)) handleSet.add(h.toLowerCase());
    }
    if (handleSet.size) {
      const rows2 = await db
        .select({ id: socialAccounts.id, username: socialAccounts.username })
        .from(socialAccounts)
        .where(and(inArray(sql`lower(${socialAccounts.username})`, Array.from(handleSet)), accountVisible()));
      for (const r of rows2) {
        accountIds.add(r.id);
        mentionAccountIdByHandle.set(r.username.toLowerCase(), r.id);
      }
    }
  } else if (kind === "message") {
    const messageIds = Array.from(new Set(pagePhotos.map((p) => p.prmLocation.slice("message:".length).trim()).filter(Boolean)));
    const rows = messageIds.length ? await db.select().from(messages).where(inArray(messages.id, messageIds)) : [];
    messageById = new Map(rows.map((r) => [r.id, r]));
    for (const m of rows) {
      if (m.senderSocialAccountId) accountIds.add(m.senderSocialAccountId);
      if (m.senderPersonId) personIds.add(m.senderPersonId);
    }
    const conversationIds = Array.from(new Set(rows.map((r) => r.conversationId)));
    if (conversationIds.length) {
      const convRows = await db.select({ id: conversations.id, title: conversations.title }).from(conversations).where(inArray(conversations.id, conversationIds));
      conversationById = new Map(convRows.map((r) => [r.id, { title: r.title }]));
      const partRows = await db
        .select({ conversationId: conversationParticipants.conversationId, personId: conversationParticipants.personId, socialAccountId: conversationParticipants.socialAccountId })
        .from(conversationParticipants)
        .where(and(inArray(conversationParticipants.conversationId, conversationIds), sql`${conversationParticipants.role} <> 'owner'`));
      for (const r of partRows) {
        const bucket = participantsByConversation.get(r.conversationId) ?? [];
        bucket.push({ personId: r.personId, socialAccountId: r.socialAccountId });
        participantsByConversation.set(r.conversationId, bucket);
        if (r.socialAccountId) accountIds.add(r.socialAccountId);
        if (r.personId) personIds.add(r.personId);
      }
    }
  }

  const [accountCache, personCache] = await Promise.all([buildAccountCache([...accountIds]), buildPersonCache([...personIds])]);

  return { faceRowById, lookAlikeMap, identityCache, cropCache, accountCache, personCache, postById, messageById, conversationById, participantsByConversation, mentionAccountIdByHandle };
}

// ── Item assembly (from caches — no per-item queries) ────────────────────────

/**
 * One suggestion per identity. Identities already on a face in this photo are kept (one person
 * can appear in a photo more than once); the page lists them last.
 */
function dedupeSuggestions(suggestions: FaceReviewSuggestion[]): FaceReviewSuggestion[] {
  const seen = new Set<string>();
  const out: FaceReviewSuggestion[] = [];
  for (const s of suggestions) {
    const key = s.socialAccountId ?? s.personId ?? s.label;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out;
}

function buildFacesFromCache(photo: Photo, caches: PageCaches): FaceReviewFace[] {
  const facialIds = (photo.facialIds ?? []) as FacialId[];
  const out: FaceReviewFace[] = [];
  let index = 0;
  for (const fid of facialIds) {
    if (!fid.faceUuid) continue;
    const row = caches.faceRowById.get(fid.faceUuid);
    if (!row) continue;
    const identified = row.personfaceUuid ? caches.identityCache.get(row.personfaceUuid) ?? null : null;

    const lookAlikes: FaceReviewFaceLookAlike[] = [];
    for (const la of caches.lookAlikeMap.get(row.id) ?? []) {
      const ident = caches.identityCache.get(la.personfaceUuid);
      const crop = caches.cropCache.get(la.personfaceUuid);
      if (ident && crop) lookAlikes.push({ personfaceUuid: la.personfaceUuid, score: la.score, ...ident, cropUrl: crop });
    }

    const box = (fid.coordinates ?? row.coordinates) as FaceBox | null;
    out.push({
      faceUuid: row.id,
      number: index + 1,
      box: box && typeof box.x === "number" ? { x: box.x, y: box.y, w: box.w, h: box.h } : null,
      cropUrl: row.s3Url,
      color: faceColor(index),
      identified,
      dismissed: !!row.dismissedAt,
      autoMatchScore: row.autoMatchScore,
      lookAlikes,
    });
    index++;
  }
  // Look-alikes of identities already on another face here stay: one person can be in a photo more than once.
  return out;
}

function toAccountShape(a: AccountInfo) {
  return { id: a.id, username: a.username, imageUrl: a.imageUrl, ownerId: a.ownerId, ownerName: a.ownerName };
}

function buildProfileItem(photo: Photo, caches: PageCaches): FaceReviewItem {
  const accountId = photo.prmLocation.slice("profile_image:".length).trim();
  const account = caches.accountCache.get(accountId) ?? null;
  const faceList = buildFacesFromCache(photo, caches);

  const suggestions: FaceReviewSuggestion[] = account
    ? [{ socialAccountId: account.id, username: account.username, imageUrl: account.imageUrl, ownerName: account.ownerName, label: `@${account.username}`, reason: "profile_account" }]
    : [];

  return {
    photoId: photo.id,
    imageUrl: photo.location,
    width: photo.widthPx,
    height: photo.heightPx,
    kind: "profile",
    account: account ? toAccountShape(account) : null,
    faces: faceList,
    suggestions: dedupeSuggestions(suggestions),
  };
}

function buildPostItem(photo: Photo, kind: "post" | "story", caches: PageCaches): FaceReviewItem {
  const postId = photo.prmLocation.slice("post:".length).trim();
  const post = caches.postById.get(postId);
  const account = post ? caches.accountCache.get(post.socialAccountId) ?? null : null;
  const faceList = buildFacesFromCache(photo, caches);
  const slide = resolveSlide(photo, post);

  const suggestions: FaceReviewSuggestion[] = [];
  if (account) suggestions.push({ socialAccountId: account.id, username: account.username, imageUrl: account.imageUrl, ownerName: account.ownerName, label: `@${account.username}`, reason: "owner" });
  if (post) {
    for (const coId of post.coauthorAccountIds ?? []) {
      const co = caches.accountCache.get(coId);
      if (co) suggestions.push({ socialAccountId: co.id, username: co.username, imageUrl: co.imageUrl, ownerName: co.ownerName, label: `@${co.username}`, reason: "coauthor" });
    }
    for (const handle of mentionedHandlesFor(photo, post, slide)) {
      const id = caches.mentionAccountIdByHandle.get(handle.toLowerCase());
      const acc = id ? caches.accountCache.get(id) : undefined;
      if (acc) suggestions.push({ socialAccountId: acc.id, username: acc.username, imageUrl: acc.imageUrl, ownerName: acc.ownerName, label: `@${acc.username}`, reason: "mentioned" });
    }
  }

  return {
    photoId: photo.id,
    imageUrl: photo.location,
    width: photo.widthPx,
    height: photo.heightPx,
    kind,
    postId: post?.id,
    slide,
    postedAt: post?.postedAt ? post.postedAt.toISOString() : undefined,
    caption: post?.description ?? undefined,
    account: account ? toAccountShape(account) : null,
    faces: faceList,
    suggestions: dedupeSuggestions(suggestions),
  };
}

function buildMessageItem(photo: Photo, caches: PageCaches): FaceReviewItem {
  const messageId = photo.prmLocation.slice("message:".length).trim();
  const message = caches.messageById.get(messageId);
  const faceList = buildFacesFromCache(photo, caches);

  const suggestions: FaceReviewSuggestion[] = [];
  if (message) {
    if (message.senderSocialAccountId) {
      const sender = caches.accountCache.get(message.senderSocialAccountId);
      if (sender) suggestions.push({ socialAccountId: sender.id, username: sender.username, imageUrl: sender.imageUrl, ownerName: sender.ownerName, label: `@${sender.username}`, reason: "sender" });
    } else if (message.senderPersonId) {
      const sender = caches.personCache.get(message.senderPersonId);
      if (sender) suggestions.push({ personId: sender.id, label: sender.name ?? "Sender", reason: "sender" });
    }
    for (const p of caches.participantsByConversation.get(message.conversationId) ?? []) {
      if (p.socialAccountId) {
        const acc = caches.accountCache.get(p.socialAccountId);
        if (acc) suggestions.push({ socialAccountId: acc.id, username: acc.username, imageUrl: acc.imageUrl, ownerName: acc.ownerName, label: `@${acc.username}`, reason: "participant" });
      } else if (p.personId) {
        const person = caches.personCache.get(p.personId);
        if (person) suggestions.push({ personId: person.id, label: person.name ?? "Participant", reason: "participant" });
      }
    }
  }

  const conversationTitle = message ? caches.conversationById.get(message.conversationId)?.title ?? undefined : undefined;

  return {
    photoId: photo.id,
    imageUrl: photo.location,
    width: photo.widthPx,
    height: photo.heightPx,
    kind: "message",
    messageId: message?.id,
    conversationId: message?.conversationId,
    postedAt: message?.sentAt ? message.sentAt.toISOString() : undefined,
    caption: conversationTitle,
    account: null,
    faces: faceList,
    suggestions: dedupeSuggestions(suggestions),
  };
}

async function buildItems(pagePhotos: Photo[], kind: FaceReviewKind): Promise<FaceReviewItem[]> {
  if (!pagePhotos.length) return [];
  const caches = await buildPageCaches(pagePhotos, kind);

  const items: FaceReviewItem[] = [];
  for (const photo of pagePhotos) {
    let item: FaceReviewItem;
    if (kind === "profile") {
      item = buildProfileItem(photo, caches);
      // §3.6/finding #10: read-only, cheap (replays stored facial_ids; only touches the
      // image when width/height are missing, which the profile queue condition rules out) —
      // computed per item, never batched images.
      item.profileLinkReason = (await profileLinkReason(photo)) ?? undefined;
    } else if (kind === "message") {
      item = buildMessageItem(photo, caches);
    } else {
      item = buildPostItem(photo, kind, caches);
    }
    items.push(item);
  }
  return items;
}
