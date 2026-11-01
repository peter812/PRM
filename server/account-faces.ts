/**
 * The social account page's Faces tab (account-faces-plan.md): the account holder's own face
 * group, and every other face seen in the account's photos.
 */
import { and, eq, inArray, or, sql, type SQL } from "drizzle-orm";
import { db } from "./db";
import { facePairDismissals, faces, people, socialAccounts } from "@shared/schema";
import { normalizeBox, type FaceBox } from "./faces";
import { buildCropCache, buildIdentityCache } from "./face-review";
import { connectFace, faceGroupUnnamed, mergeFaceGroups, profilePhotos, RecognitionRequestError, relinkIdentity, type FacialId } from "./recognition";
import { markFaceIdentitiesDirty } from "./face-lookalikes";

/**
 * Subquery of face ids in this account's photos (§1): its profile images, its posts and stories
 * (author or coauthor), and other accounts' posts that tag it. Until tagged-posts-plan.md's link
 * table ships, "tags it" means the username is in `mentioned_accounts` (text, so matched rather
 * than cast: one malformed row can't fail the query).
 */
export function accountFaceScope(account: { id: string; username: string }): SQL {
  return sql`(SELECT face_id FROM ${accountFacePhotos(account)} scope)`;
}

/** accountFaceScope's rows with their photo: (face_id, loc, uploaded_at). A face can repeat (identical images). */
function accountFacePhotos(account: { id: string; username: string }): SQL {
  const handle = `"${account.username.toLowerCase()}"`;
  return sql`(
    SELECT fid->>'faceUuid' AS face_id, p.prm_location AS loc, p.uploaded_at FROM photos p, jsonb_array_elements(coalesce(p.facial_ids, '[]'::jsonb)) fid
    WHERE p.prm_location IN (
      SELECT ${`profile_image:${account.id}`}::text
      UNION SELECT 'post:' || sp.id FROM social_account_posts sp WHERE NOT sp.is_deleted AND (
        sp.social_account_id = ${account.id}
        OR sp.coauthor_account_ids @> ${JSON.stringify([account.id])}::jsonb
        OR position(${handle} in lower(coalesce(sp.mentioned_accounts, ''))) > 0)
    )
  )`;
}

/**
 * The tab's badge (§4). `unnamed`: open, unnamed faces in scope (quality noise excluded, as in
 * Face review). `needsLook` / `probably`: the holder group's auto-assigned and verify-tier faces,
 * wherever they are. `holder` / `total`: in-scope faces in the holder's group / in scope at all.
 */
export type AccountFaceCounts = { group: string | null; total: number; holder: number; unnamed: number; needsLook: number; probably: number };

/** The account's faces as a cluster scope (Other faces → clusters, §3.2); null when there's no such account. */
export async function accountScopeFor(accountId: string): Promise<SQL | null> {
  const account = await findAccount(accountId);
  return account && accountFaceScope(account);
}

async function findAccount(accountId: string) {
  const [account] = await db.select({
    id: socialAccounts.id, username: socialAccounts.username, group: socialAccounts.personfaceUuid, noFace: socialAccounts.noFace, ownerId: socialAccounts.ownerUuid,
  })
    .from(socialAccounts).where(eq(socialAccounts.id, accountId));
  return account ?? null;
}

export async function getAccountFaceCounts(accountId: string): Promise<AccountFaceCounts | null> {
  const account = await findAccount(accountId);
  if (!account) return null;
  const group = account.group;
  const [row] = (await db.execute<Omit<AccountFaceCounts, "group">>(sql`
    SELECT count(*)::int AS total,
      count(*) FILTER (WHERE ${group ? sql`faces.personface_uuid = ${group}` : sql`false`})::int AS holder,
      count(*) FILTER (WHERE faces.dismissed_at IS NULL AND (faces.noise_reason IS NULL OR faces.noise_reason = 'singleton')
        AND ${faceGroupUnnamed})::int AS unnamed,
      ${group ? sql`(SELECT count(*)::int FROM faces WHERE personface_uuid = ${group} AND auto_match_score IS NOT NULL)` : sql`0`} AS "needsLook",
      ${group ? sql`(SELECT count(*)::int FROM faces WHERE verify_personface_uuid = ${group} AND dismissed_at IS NULL AND ${faceGroupUnnamed})` : sql`0`} AS probably
    FROM faces WHERE faces.id IN ${accountFaceScope(account)}`)).rows;
  return { group, ...row };
}

// ── Account holder (§2) ───────────────────────────────────────────────────────

/** Where a face's photo is: this account's profile image, a post or story, a message, or anything else. */
export type HolderFaceSource = "profile" | "post" | "story" | "message" | "other";

export type HolderFace = {
  id: string; cropUrl: string; photoId: string | null; photoUrl: string | null;
  /** The face's box in that photo, in its natural pixels. */
  box: FaceBox | null; width: number | null; height: number | null;
  source: HolderFaceSource; postId: string | null; postAccountId: string | null; date: string | null;
  inScope: boolean;
  /** auto = PRM assigned it at `score` and nobody has confirmed it. */
  how: "confirmed" | "auto"; score: number | null;
};

export type ProfileCandidate = { photoId: string; photoUrl: string; current: boolean; faces: { id: string; cropUrl: string; label: string | null }[] };

/** The account's owner person and their face group, when the account has one (§2.3). */
export type HolderOwner = { personId: string; name: string; group: string | null; cropUrl: string | null; faceCount: number };
/**
 * §2.3: how the account's face and its owner's face disagree. "none" also covers no owner, a
 * no-face account, and a pair the user chose to leave different.
 */
export type OwnerConflict = "none" | "owner-has-none" | "account-has-none" | "differs";

export type AccountHolder = {
  group: string | null; noFace: boolean; username: string;
  owner: HolderOwner | null; conflict: OwnerConflict;
  faces: HolderFace[];
  /** Only while there is no group: the faces in this account's profile pictures, to pick from. */
  profileCandidates: ProfileCandidate[];
};

export async function getAccountHolder(accountId: string): Promise<AccountHolder | null> {
  const account = await findAccount(accountId);
  if (!account) return null;
  const owner = await holderOwner(account.ownerId);
  const out: AccountHolder = {
    group: account.group, noFace: account.noFace, username: account.username,
    owner, conflict: await ownerConflict(account, owner), faces: [], profileCandidates: [],
  };
  if (account.group) out.faces = await holderFaces(account as typeof account & { group: string });
  else out.profileCandidates = await profileCandidates(account.id);
  return out;
}

async function holderOwner(personId: string | null): Promise<HolderOwner | null> {
  if (!personId) return null;
  const [person] = await db.select({ id: people.id, firstName: people.firstName, lastName: people.lastName, group: people.personfaceUuid }).from(people).where(eq(people.id, personId));
  if (!person) return null;
  const [crops, [count]] = person.group
    ? await Promise.all([buildCropCache([person.group]), db.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM faces WHERE personface_uuid = ${person.group}`).then((r) => r.rows)])
    : [new Map<string, string>(), [{ n: 0 }]];
  return {
    personId: person.id, name: `${person.firstName} ${person.lastName}`.trim(), group: person.group,
    cropUrl: person.group ? crops.get(person.group) ?? null : null, faceCount: count?.n ?? 0,
  };
}

/** The face_pair_dismissals key for two groups (stored smaller uuid first). */
const pairKey = (x: string, y: string) => (x < y ? [x, y] : [y, x]) as [string, string];

async function ownerConflict(account: { group: string | null; noFace: boolean }, owner: HolderOwner | null): Promise<OwnerConflict> {
  if (!owner || account.noFace) return "none";
  if (!account.group) return owner.group ? "account-has-none" : "none";
  if (!owner.group) return "owner-has-none";
  if (owner.group === account.group) return "none";
  const [a, b] = pairKey(account.group, owner.group);
  const [kept] = await db.select({ a: facePairDismissals.groupAUuid }).from(facePairDismissals)
    .where(or(and(eq(facePairDismissals.groupAUuid, a), eq(facePairDismissals.groupBUuid, b)), and(eq(facePairDismissals.groupAUuid, b), eq(facePairDismissals.groupBUuid, a))));
  return kept ? "none" : "differs";
}

/**
 * Resolve §2.3. use-account: the owner takes the account's face. use-owner: the account takes the
 * owner's. merge: one group, the account's kept (mergeFaceGroups repoints both rows). keep-apart:
 * they are different faces; hides the banner and the Faces page's likely-same pair.
 */
export type OwnerResolution = "use-account" | "use-owner" | "merge" | "keep-apart";

export async function resolveOwnerConflict(accountId: string, action: OwnerResolution): Promise<void> {
  const account = await findAccount(accountId);
  if (!account) throw new RecognitionRequestError(404, "Social account not found.");
  const owner = await holderOwner(account.ownerId);
  if (!owner) throw new RecognitionRequestError(400, "This account has no owner.");
  const need = (g: string | null, what: string) => {
    if (!g) throw new RecognitionRequestError(409, `${what} has no face; reload.`);
    return g;
  };
  if (action === "use-account") return relinkIdentity({ personId: owner.personId }, need(account.group, "The account"));
  if (action === "use-owner") return relinkIdentity({ socialAccountId: account.id }, need(owner.group, owner.name));
  const [accountGroup, ownerGroup] = [need(account.group, "The account"), need(owner.group, owner.name)];
  if (action === "merge") return mergeFaceGroups(accountGroup, ownerGroup);
  const [a, b] = pairKey(accountGroup, ownerGroup);
  await db.insert(facePairDismissals).values({ groupAUuid: a, groupBUuid: b }).onConflictDoNothing();
}

/** Every face in the holder's group, newest first. */
function holderFaces(account: { id: string; username: string; group: string }): Promise<HolderFace[]> {
  return faceRows(account, sql`f.personface_uuid = ${account.group}`);
}

/**
 * Faces matching `where` (on `faces f`), newest first. Each one's photo comes from facial_ids
 * (identical images share faces), preferring a full image over a sub-image.
 */
async function faceRows(account: { id: string; username: string }, where: SQL, page?: { offset: number; limit: number }): Promise<HolderFace[]> {
  const rows = (await db.execute<{
    id: string; crop: string; score: number | null; photo_id: string | null; photo_url: string | null; loc: string | null;
    coords: unknown; width: number | null; height: number | null;
    post_id: string | null; post_type: string | null; post_account: string | null; date: string | null; in_scope: boolean;
  }>(sql`
    SELECT f.id, f.s3_url AS crop, f.auto_match_score AS score, p.id AS photo_id, p.location AS photo_url, p.prm_location AS loc,
      p.coords, p.width_px AS width, p.height_px AS height,
      sp.id AS post_id, sp.post_type, sp.social_account_id AS post_account,
      coalesce(sp.posted_at, p.uploaded_at, f.created_at) AS date,
      f.id IN ${accountFaceScope(account)} AS in_scope
    FROM faces f
    LEFT JOIN LATERAL (
      SELECT p.id, p.location, p.prm_location, p.uploaded_at, p.width_px, p.height_px,
        (SELECT e->'coordinates' FROM jsonb_array_elements(p.facial_ids) e WHERE e->>'faceUuid' = f.id LIMIT 1) AS coords
      FROM photos p
      WHERE p.facial_ids @> jsonb_build_array(jsonb_build_object('faceUuid', f.id))
      ORDER BY p.is_sub_image, p.uploaded_at DESC LIMIT 1
    ) p ON true
    LEFT JOIN social_account_posts sp ON p.prm_location LIKE 'post:%' AND sp.id = substring(p.prm_location from 6)
    WHERE ${where}
    ORDER BY date DESC NULLS LAST, f.id ${page ? sql`LIMIT ${page.limit} OFFSET ${page.offset}` : sql``}`)).rows;
  return rows.map((r) => ({
    id: r.id, cropUrl: r.crop, photoId: r.photo_id, photoUrl: r.photo_url,
    box: normalizeBox(r.coords), width: r.width, height: r.height,
    source: r.loc === `profile_image:${account.id}` ? "profile"
      : r.post_id ? (r.post_type === "story" ? "story" : "post")
      : r.loc?.startsWith("message:") ? "message" : "other",
    postId: r.post_id, postAccountId: r.post_account,
    date: r.date ? new Date(r.date).toISOString() : null,
    inScope: r.in_scope,
    how: r.score === null ? "confirmed" : "auto", score: r.score,
  }));
}

/** The current profile picture first, then earlier ones; each with the faces found in it. */
async function profileCandidates(accountId: string): Promise<ProfileCandidate[]> {
  const { current, previous } = await profilePhotos(accountId);
  const list = (current ? [current, ...previous] : previous).filter((p) => ((p.facialIds as FacialId[] | null) ?? []).length > 0);
  const faceIds = list.flatMap((p) => (p.facialIds as FacialId[]).flatMap((f) => (f.faceUuid ? [f.faceUuid] : [])));
  if (!faceIds.length) return [];
  const rows = (await db.execute<{ id: string; crop: string; label: string | null }>(sql`
    SELECT f.id, f.s3_url AS crop,
      coalesce((SELECT '@' || sa.username FROM social_accounts sa WHERE sa.personface_uuid = f.personface_uuid LIMIT 1),
        (SELECT p.first_name || ' ' || p.last_name FROM people p WHERE p.personface_uuid = f.personface_uuid LIMIT 1)) AS label
    FROM faces f WHERE f.id IN (${sql.join(faceIds.map((id) => sql`${id}`), sql`, `)})`)).rows;
  const byId = new Map(rows.map((r) => [r.id, r]));
  return list.map((p) => ({
    photoId: p.id, photoUrl: p.location, current: p === current,
    faces: (p.facialIds as FacialId[]).flatMap((f) => {
      const r = f.faceUuid ? byId.get(f.faceUuid) : undefined;
      return r ? [{ id: r.id, cropUrl: r.crop, label: r.label }] : [];
    }),
  }));
}

/** "This is @username": the face (and its whole group) becomes the account's face. */
export async function setAccountHolderFace(accountId: string, faceUuid: string): Promise<void> {
  const account = await findAccount(accountId);
  if (!account) throw new RecognitionRequestError(404, "Social account not found.");
  await connectFace({ faceUuid, socialAccountId: accountId });
}

/** Confirm an auto-assigned face where it is: it stays in its group and stops being "auto". */
export async function keepAutoFace(faceUuid: string | string[]): Promise<void> {
  const ids = Array.isArray(faceUuid) ? faceUuid : [faceUuid];
  if (!ids.length) return;
  await db.update(faces).set({ autoMatchScore: null }).where(inArray(faces.id, ids));
  markFaceIdentitiesDirty();
}

// ── Other faces: People seen (§3.1) ──────────────────────────────────────────

/** Where an in-scope face came from: the account's profile image, its own post or story, or a post that tags it. */
export type ScopeSource = "profile" | "post" | "story" | "tagged";

export type PersonSeen = {
  group: string; label: string; personId: string | null; socialAccountId: string | null; cropUrl: string | null;
  count: number; auto: number; sources: Partial<Record<ScopeSource, number>>; lastSeen: string | null;
};

/** One row per named group seen in this account, other than the account's own; most seen first. */
export async function getPeopleSeen(accountId: string): Promise<PersonSeen[] | null> {
  const account = await findAccount(accountId);
  if (!account) return null;
  const rows = (await db.execute<{ group: string; count: number; auto: number; profile: number; post: number; story: number; tagged: number; last_seen: string | null }>(sql`
    WITH seen AS (
      SELECT DISTINCT ON (scope.face_id) scope.face_id,
        CASE WHEN scope.loc = ${`profile_image:${account.id}`} THEN 'profile'
          WHEN sp.social_account_id = ${account.id} OR sp.coauthor_account_ids @> ${JSON.stringify([account.id])}::jsonb
            THEN CASE WHEN sp.post_type = 'story' THEN 'story' ELSE 'post' END
          ELSE 'tagged' END AS source,
        coalesce(sp.posted_at, scope.uploaded_at) AS date
      FROM ${accountFacePhotos(account)} scope
      LEFT JOIN social_account_posts sp ON scope.loc LIKE 'post:%' AND sp.id = substring(scope.loc from 6)
      ORDER BY scope.face_id, date DESC NULLS LAST
    )
    SELECT faces.personface_uuid AS "group", count(*)::int AS count,
      count(*) FILTER (WHERE faces.auto_match_score IS NOT NULL)::int AS auto,
      count(*) FILTER (WHERE seen.source = 'profile')::int AS profile, count(*) FILTER (WHERE seen.source = 'post')::int AS post,
      count(*) FILTER (WHERE seen.source = 'story')::int AS story, count(*) FILTER (WHERE seen.source = 'tagged')::int AS tagged,
      max(seen.date) AS last_seen
    FROM faces JOIN seen ON seen.face_id = faces.id
    WHERE faces.personface_uuid IS NOT NULL AND faces.personface_uuid IS DISTINCT FROM ${account.group} AND NOT (${faceGroupUnnamed})
    GROUP BY faces.personface_uuid ORDER BY count DESC, last_seen DESC NULLS LAST`)).rows;
  const groups = rows.map((r) => r.group);
  const [ids, crops] = await Promise.all([buildIdentityCache(groups), buildCropCache(groups)]);
  return rows.flatMap((r) => {
    const id = ids.get(r.group);
    if (!id) return [];
    const sources = Object.fromEntries((["profile", "post", "story", "tagged"] as const).filter((k) => r[k] > 0).map((k) => [k, r[k]]));
    return [{
      group: r.group, label: id.label, personId: id.personId ?? null, socialAccountId: id.socialAccountId ?? null, cropUrl: crops.get(r.group) ?? null,
      count: r.count, auto: r.auto, sources, lastSeen: r.last_seen ? new Date(r.last_seen).toISOString() : null,
    }];
  });
}

/** One People seen row expanded: that group's faces in this account. */
export async function getPersonSeenFaces(accountId: string, group: string): Promise<HolderFace[] | null> {
  const account = await findAccount(accountId);
  if (!account) return null;
  return faceRows(account, sql`f.personface_uuid = ${group} AND f.id IN ${accountFaceScope(account)}`);
}

// ── Other faces: loose faces (§3.3) ──────────────────────────────────────────

/** An open face (on `faces f`): not skipped, in a photo, in no named group. */
const openLooseFace = sql`f.dismissed_at IS NULL AND f.photo_id IS NOT NULL AND f.cluster_id IS NULL
  AND NOT EXISTS (SELECT 1 FROM people WHERE people.personface_uuid = f.personface_uuid)
  AND NOT EXISTS (SELECT 1 FROM social_accounts sa WHERE sa.personface_uuid = f.personface_uuid)`;
/** Noise the clustering run set aside as unusable; "singleton" is just a face with no match yet. */
const isNoise = sql`f.noise_reason IS NOT NULL AND f.noise_reason <> 'singleton'`;

/**
 * In-scope open faces in no cluster (new since the last run, singletons, or noise), newest first.
 * Noise is left out unless `noise`; `noiseCount` says how many that hides.
 */
export async function getLooseFaces(accountId: string, offset: number, limit: number, noise: boolean): Promise<{ faces: HolderFace[]; nextOffset: number | null; noiseCount: number } | null> {
  const account = await findAccount(accountId);
  if (!account) return null;
  const scope = accountFaceScope(account);
  const [list, [count]] = await Promise.all([
    faceRows(account, sql`f.id IN ${scope} AND ${openLooseFace} ${noise ? sql`` : sql`AND NOT (${isNoise})`}`, { offset, limit: limit + 1 }),
    db.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM faces f WHERE f.id IN ${scope} AND ${openLooseFace} AND ${isNoise}`).then((r) => r.rows),
  ]);
  return { faces: list.slice(0, limit), nextOffset: list.length > limit ? offset + limit : null, noiseCount: count.n };
}
