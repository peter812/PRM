/**
 * Known faces (face-review-plan.md §5): face groups (personface_uuid) that
 * are already linked to a person and/or a social account. One row per group
 * — the "identity" the Faces page lists and lets you browse, merge, or
 * pull a face out of. Groups with no person and no account belong to Face
 * review instead (server/face-review.ts) and never appear here.
 */
import { eq, inArray, sql } from "drizzle-orm";
import { db } from "./db";
import { faces, people, photos, socialAccounts } from "@shared/schema";
import { visibleShared } from "./access";
import { resolvePhotoSource, type ResolvedPhotoSource } from "./photo-source";
import { findLikelySameCandidatePairs, type LikelySameCandidate } from "./face-lookalikes";
import { photosContainingFaces } from "./recognition";

export type KnownFaceAccount = { id: string; username: string; nickname: string | null; imageUrl: string | null };
export type KnownFacePerson = { id: string; name: string };

export type KnownFaceListItem = {
  personfaceUuid: string;
  cropUrl: string | null;
  person: KnownFacePerson | null;
  people: KnownFacePerson[];
  accounts: KnownFaceAccount[];
  photoCount: number;
  lastSeenAt: string | null;
};

export type ListKnownFacesResult = { items: KnownFaceListItem[]; nextCursor: string | null };

export type FaceBox = { x: number; y: number; w: number; h: number };

export type KnownFaceDetailPhoto = {
  photoId: string;
  imageUrl: string;
  width: number | null;
  height: number | null;
  faces: { faceUuid: string; box: FaceBox | null; autoMatchScore: number | null }[];
  uploadedAt: string | null;
  source: ResolvedPhotoSource | null;
};

export type KnownFaceDetail = { header: KnownFaceListItem; photos: KnownFaceDetailPhoto[] };

const DEFAULT_LIMIT = 60;

/** True when the caller can see the person or social account linked to this face group. */
export async function identityIsVisible(personfaceUuid: string): Promise<boolean> {
  const personVis = visibleShared(people.visibility, people.createdByUserId) ?? sql`true`;
  const acctVis = visibleShared(socialAccounts.visibility, socialAccounts.createdByUserId) ?? sql`true`;
  const result = await db.execute(sql`
    SELECT (
      EXISTS (SELECT 1 FROM people WHERE people.personface_uuid = ${personfaceUuid} AND (${personVis}))
      OR EXISTS (SELECT 1 FROM social_accounts WHERE social_accounts.personface_uuid = ${personfaceUuid} AND (${acctVis}))
    ) AS visible
  `);
  const rows = (result as unknown as { rows: { visible: boolean }[] }).rows;
  return !!rows[0]?.visible;
}

/** The face group a face belongs to, or null if the face doesn't exist. */
export async function faceGroupUuid(faceUuid: string): Promise<string | null> {
  const [row] = await db.select({ personfaceUuid: faces.personfaceUuid }).from(faces).where(eq(faces.id, faceUuid));
  return row?.personfaceUuid ?? null;
}

type IdentityRow = {
  personfaceUuid: string;
  people: Array<{ id: string; name: string | null }> | null;
  accounts: KnownFaceAccount[] | null;
  photoCount: number | string | null;
  lastSeenAt: string | Date | null;
  cropUrl: string | null;
};

async function queryIdentities(opts: {
  search?: string;
  sort: "recent" | "count";
  offset: number;
  limit: number;
  onlyGroup?: string;
  onlyGroups?: string[];
}): Promise<KnownFaceListItem[]> {
  const personVis = visibleShared(people.visibility, people.createdByUserId) ?? sql`true`;
  const acctVis = visibleShared(socialAccounts.visibility, socialAccounts.createdByUserId) ?? sql`true`;
  const term = opts.search?.trim();
  const like = term ? `%${term.replace(/[%_\\]/g, (c) => `\\${c}`)}%` : null;

  const searchClause = like
    ? sql`AND (
        EXISTS (
          SELECT 1 FROM people WHERE people.personface_uuid = g.group_uuid AND (${personVis})
            AND (people.first_name ILIKE ${like} OR people.last_name ILIKE ${like}
              OR (people.first_name || ' ' || people.last_name) ILIKE ${like})
        )
        OR EXISTS (
          SELECT 1 FROM social_accounts WHERE social_accounts.personface_uuid = g.group_uuid AND (${acctVis})
            AND (social_accounts.username ILIKE ${like} OR social_accounts.nickname ILIKE ${like})
        )
      )`
    : sql``;

  const groupFilterClause = opts.onlyGroups?.length
    ? sql`AND g.group_uuid IN ${opts.onlyGroups}`
    : opts.onlyGroup
      ? sql`AND g.group_uuid = ${opts.onlyGroup}`
      : sql``;
  const sortExpr = opts.sort === "count" ? sql`fa.photo_count` : sql`fa.last_seen_at`;

  const result = await db.execute(sql`
    WITH groups AS (
      SELECT DISTINCT personface_uuid AS group_uuid FROM people WHERE personface_uuid IS NOT NULL AND (${personVis})
      UNION
      SELECT DISTINCT personface_uuid AS group_uuid FROM social_accounts WHERE personface_uuid IS NOT NULL AND (${acctVis})
    ),
    people_agg AS (
      SELECT personface_uuid AS group_uuid,
        json_agg(json_build_object(
          'id', id,
          'name', NULLIF(trim(both from concat_ws(' ', first_name, last_name)), '')
        ) ORDER BY created_at ASC) AS people
      FROM people
      WHERE personface_uuid IS NOT NULL AND (${personVis})
      GROUP BY personface_uuid
    ),
    account_agg AS (
      SELECT personface_uuid AS group_uuid,
        json_agg(json_build_object('id', id, 'username', username, 'nickname', nickname, 'imageUrl', image_url) ORDER BY created_at ASC) AS accounts
      FROM social_accounts
      WHERE personface_uuid IS NOT NULL AND (${acctVis})
      GROUP BY personface_uuid
    ),
    face_agg AS (
      SELECT f.personface_uuid AS group_uuid,
        COUNT(DISTINCT f.photo_id) AS photo_count,
        MAX(COALESCE(p.uploaded_at, f.created_at)) AS last_seen_at
      FROM faces f
      LEFT JOIN photos p ON p.id = f.photo_id
      WHERE f.personface_uuid IS NOT NULL
      GROUP BY f.personface_uuid
    ),
    crop AS (
      SELECT g.group_uuid,
        COALESCE(
          (SELECT f.s3_url FROM faces f
            JOIN photos ph ON ph.id = f.photo_id
            JOIN social_accounts sa ON sa.personface_uuid = g.group_uuid
            WHERE f.personface_uuid = g.group_uuid
              AND ph.prm_location = 'profile_image:' || sa.id
              AND ph.location = sa.image_url
            ORDER BY f.created_at DESC LIMIT 1),
          (SELECT f2.s3_url FROM faces f2 WHERE f2.personface_uuid = g.group_uuid ORDER BY f2.created_at DESC LIMIT 1)
        ) AS crop_url
      FROM groups g
    )
    SELECT g.group_uuid AS "personfaceUuid",
      COALESCE(pa.people, '[]'::json) AS people,
      COALESCE(aa.accounts, '[]'::json) AS accounts,
      COALESCE(fa.photo_count, 0)::int AS "photoCount",
      fa.last_seen_at AS "lastSeenAt",
      c.crop_url AS "cropUrl"
    FROM groups g
    LEFT JOIN people_agg pa ON pa.group_uuid = g.group_uuid
    LEFT JOIN account_agg aa ON aa.group_uuid = g.group_uuid
    LEFT JOIN face_agg fa ON fa.group_uuid = g.group_uuid
    LEFT JOIN crop c ON c.group_uuid = g.group_uuid
    WHERE true
      ${groupFilterClause}
      ${searchClause}
    ORDER BY ${sortExpr} DESC NULLS LAST, g.group_uuid DESC
    LIMIT ${opts.limit} OFFSET ${opts.offset}
  `);

  const rows = (result as unknown as { rows: IdentityRow[] }).rows;
  return rows.map((r) => {
    const peopleList = (r.people ?? []).map((p) => ({
      id: p.id,
      name: p.name || "Unnamed",
    }));
    return {
      personfaceUuid: r.personfaceUuid,
      cropUrl: r.cropUrl ?? null,
      person: peopleList[0] ?? null,
      people: peopleList,
      accounts: r.accounts ?? [],
      photoCount: Number(r.photoCount ?? 0),
      lastSeenAt: r.lastSeenAt ? new Date(r.lastSeenAt).toISOString() : null,
    };
  });
}

/** One row per known identity (a face group linked to a person and/or a social account). */
export async function listKnownFaces(opts: {
  search?: string;
  sort: "recent" | "count";
  cursor?: string;
  limit?: number;
}): Promise<ListKnownFacesResult> {
  const limit = Math.min(Math.max(opts.limit ?? DEFAULT_LIMIT, 1), 200);
  const offset = opts.cursor ? Math.max(parseInt(opts.cursor, 10) || 0, 0) : 0;
  const items = await queryIdentities({ search: opts.search, sort: opts.sort, offset, limit });
  const nextCursor = items.length === limit ? String(offset + limit) : null;
  return { items, nextCursor };
}

/** Coordinates are stored as `{ x, y, w, h }`, but tolerate a corner-pair shape too. */
function normalizeBox(raw: unknown): FaceBox | null {
  if (!raw || typeof raw !== "object") return null;
  const b = raw as Record<string, unknown>;
  const x = Number(b.x ?? b.left ?? b.x1);
  const y = Number(b.y ?? b.top ?? b.y1);
  let w = Number(b.w ?? b.width);
  let h = Number(b.h ?? b.height);
  if (!Number.isFinite(w) && Number.isFinite(Number(b.x2))) w = Number(b.x2) - x;
  if (!Number.isFinite(h) && Number.isFinite(Number(b.y2))) h = Number(b.y2) - y;
  if (![x, y, w, h].every(Number.isFinite)) return null;
  return { x, y, w, h };
}

/** The identity's header (same shape as a list row) plus every photo it appears in. */
export async function knownFaceDetail(personfaceUuid: string): Promise<KnownFaceDetail | null> {
  const [header] = await queryIdentities({ sort: "recent", offset: 0, limit: 1, onlyGroup: personfaceUuid });
  if (!header) return null;

  const faceRows = await db
    .select({ id: faces.id, coordinates: faces.coordinates, autoMatchScore: faces.autoMatchScore })
    .from(faces)
    .where(eq(faces.personfaceUuid, personfaceUuid));
  const faceById = new Map(faceRows.map((f) => [f.id, f]));

  // By facial_ids rather than faces.photo_id: identical images share their faces.
  const pairs = await photosContainingFaces(faceRows.map((f) => f.id));
  const photoIds = Array.from(new Set(pairs.map((p) => p.photoId)));
  const photoRows = photoIds.length ? await db.select().from(photos).where(inArray(photos.id, photoIds)) : [];
  const photoById = new Map(photoRows.map((p) => [p.id, p]));

  const byPhoto = new Map<string, typeof faceRows>();
  for (const { photoId, faceUuid } of pairs) {
    const f = faceById.get(faceUuid);
    if (!f || !photoById.has(photoId)) continue;
    const bucket = byPhoto.get(photoId);
    if (bucket) bucket.push(f);
    else byPhoto.set(photoId, [f]);
  }

  const entries = await Promise.all(
    Array.from(byPhoto.entries()).map(async ([photoId, group]) => {
      const photo = photoById.get(photoId)!;
      const source = await resolvePhotoSource(photo);
      return {
        photoId,
        imageUrl: photo.location,
        width: photo.widthPx,
        height: photo.heightPx,
        faces: group.map((f) => ({ faceUuid: f.id, box: normalizeBox(f.coordinates), autoMatchScore: f.autoMatchScore })),
        uploadedAt: photo.uploadedAt ? new Date(photo.uploadedAt).toISOString() : null,
        source,
      };
    }),
  );

  // A null source means the photo's owning entity isn't visible to the caller
  // (resolvePhotoSource already applies the same access rules) — drop the
  // photo entirely rather than leaking its imageUrl with just the source hidden.
  const visible = entries.filter((e) => e.source !== null);
  visible.sort((a, b) => (b.uploadedAt ?? "").localeCompare(a.uploadedAt ?? ""));

  return { header, photos: visible };
}

export type LikelySamePairResult = {
  groupA: KnownFaceListItem;
  groupB: KnownFaceListItem;
  score: number;
};

/**
 * Returns candidate pairs of faces that are likely the same identity,
 * with full KnownFaceListItem metadata for both faces, sorted by similarity score descending.
 */
export async function getLikelySameFaces(opts?: { limit?: number; minScore?: number }): Promise<LikelySamePairResult[]> {
  const candidates = await findLikelySameCandidatePairs(opts);
  if (!candidates.length) return [];

  const allGroups = Array.from(new Set(candidates.flatMap((c) => [c.groupA, c.groupB])));
  const items = await queryIdentities({
    sort: "recent",
    offset: 0,
    limit: allGroups.length,
    onlyGroups: allGroups,
  });
  const itemMap = new Map<string, KnownFaceListItem>(items.map((i) => [i.personfaceUuid, i]));

  const results: LikelySamePairResult[] = [];
  for (const c of candidates) {
    const itemA = itemMap.get(c.groupA);
    const itemB = itemMap.get(c.groupB);
    if (itemA && itemB) {
      results.push({ groupA: itemA, groupB: itemB, score: c.score });
    }
  }
  return results;
}
