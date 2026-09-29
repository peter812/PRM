// Connection strength (connection-strength-plan.md): everything one account did
// with each other account and everything they did back, as dated events. Scoring
// and decay live in @shared/connection-strength so the Connections tab's graphs
// use the very same math.
//
// Computed per request for one account: its posts, the posts that tag, caption
// or show it, the comments either way, and the bios naming it. Small at the 10k
// ceiling, so there's no table to keep fresh and scores age on their own.
import { and, asc, eq, inArray, isNull, ne, or, sql } from "drizzle-orm";
import { db } from "./db";
import { storage } from "./storage";
import { visibleShared } from "./access";
import {
  INSTAGRAM_TYPE_ID,
  faces,
  people,
  photos,
  socialAccountHistory,
  socialAccountPosts,
  socialAccounts,
  socialPostComments,
} from "@shared/schema";
import {
  CONNECTION_KINDS,
  CONNECTION_STRENGTH_KEY,
  eventValue,
  extractHandles,
  parseConnectionWeights,
  type ConnectionEvent,
  type ConnectionKind,
  type ConnectionWeights,
} from "@shared/connection-strength";

export type Connection = {
  account: { id: string; username: string; nickname: string | null; imageUrl: string | null };
  score: number;
  in: number;
  out: number;
  byKind: Record<ConnectionKind, number>;
  lastInteractionAt: string;
  events: ConnectionEvent[];
};

export type ConnectionsResult = { since: string; weights: ConnectionWeights; connections: Connection[] };

export async function connectionWeights(): Promise<ConnectionWeights> {
  return parseConnectionWeights(await storage.getAppSetting(CONNECTION_STRENGTH_KEY));
}

const postCols = {
  id: socialAccountPosts.id,
  socialAccountId: socialAccountPosts.socialAccountId,
  coauthorAccountIds: socialAccountPosts.coauthorAccountIds,
  postType: socialAccountPosts.postType,
  postedAt: socialAccountPosts.postedAt,
  createdAt: socialAccountPosts.createdAt,
  mentionedAccounts: socialAccountPosts.mentionedAccounts,
  description: socialAccountPosts.description,
};
type Post = Pick<typeof socialAccountPosts.$inferSelect, keyof typeof postCols>;

const postAt = (p: Post) => (p.postedAt ?? p.createdAt).toISOString();
const postKind = (p: Post): ConnectionKind => (p.postType === "story" ? "story_mention" : "post_mention");
const postersOf = (p: Post) => [p.socialAccountId, ...(p.coauthorAccountIds ?? [])];
const cleanHandle = (raw: unknown) => String(raw ?? "").trim().replace(/^@/, "").toLowerCase();
const likeEscape = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

/** Photo tags plus caption @handles. */
function mentionedIn(p: Post): Set<string> {
  const out = new Set(extractHandles(p.description).keys());
  if (p.mentionedAccounts) {
    try {
      for (const group of JSON.parse(p.mentionedAccounts) as { accounts?: unknown[] }[]) {
        for (const a of group.accounts ?? []) {
          const h = cleanHandle(a);
          if (h) out.add(h);
        }
      }
    } catch {}
  }
  return out;
}

/** personface_uuid → the account ids behind it: set on the account, or on the person owning it. */
async function accountsForFaces(personfaces: string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (!personfaces.length) return out;
  const rows = await db
    .select({ id: socialAccounts.id, direct: socialAccounts.personfaceUuid, viaPerson: people.personfaceUuid })
    .from(socialAccounts)
    .leftJoin(people, eq(people.id, socialAccounts.ownerUuid))
    .where(or(inArray(socialAccounts.personfaceUuid, personfaces), inArray(people.personfaceUuid, personfaces)));
  for (const r of rows) {
    for (const pf of new Set([r.direct, r.viaPerson])) {
      if (pf && personfaces.includes(pf)) out.set(pf, [...(out.get(pf) ?? []), r.id]);
    }
  }
  return out;
}

/** (postId, personface) for every identified, undismissed face in these posts' photos. */
async function facesInPosts(postIds: string[]) {
  if (!postIds.length) return [];
  const rows = await db
    .select({ prmLocation: photos.prmLocation, personfaceUuid: faces.personfaceUuid })
    .from(faces)
    .innerJoin(photos, eq(photos.id, faces.photoId))
    .where(and(
      inArray(photos.prmLocation, postIds.map((id) => `post:${id}`)),
      sql`${faces.personfaceUuid} IS NOT NULL`,
      isNull(faces.dismissedAt),
    ));
  return rows.map((r) => ({ postId: r.prmLocation.slice("post:".length), personfaceUuid: r.personfaceUuid! }));
}

type BioMention = { at: Date; removedAt?: Date; heart: boolean };

/**
 * Each handle a bio has ever named: when it first appeared, when it came down
 * (absent while it's still there), and whether a heart sat beside it last time.
 * Bio versions come from the history journal: each entry's previous_bio is the
 * bio that held until that entry.
 */
function bioMentions(
  account: { bio: string | null; since: Date },
  changes: { detectedAt: Date; previousBio: string | null }[],
): Map<string, BioMention> {
  const versions: { text: string | null; from: Date; to: Date | null }[] = [];
  let from = account.since;
  for (const c of changes) {
    versions.push({ text: c.previousBio, from, to: c.detectedAt });
    from = c.detectedAt;
  }
  versions.push({ text: account.bio, from, to: null });

  const out = new Map<string, BioMention>();
  for (const v of versions) {
    for (const [handle, { heart }] of extractHandles(v.text)) {
      const seen = out.get(handle);
      out.set(handle, { at: seen?.at ?? v.from, removedAt: v.to ?? undefined, heart });
    }
  }
  return out;
}

/** Bio change entries, oldest first, grouped by account. */
async function bioChanges(accountIds: string[]) {
  const out = new Map<string, { detectedAt: Date; previousBio: string | null }[]>();
  if (!accountIds.length) return out;
  const rows = await db
    .select({ id: socialAccountHistory.socialAccountId, detectedAt: socialAccountHistory.detectedAt, previousBio: socialAccountHistory.previousBio })
    .from(socialAccountHistory)
    .where(and(inArray(socialAccountHistory.socialAccountId, accountIds), sql`'bio' = ANY(${socialAccountHistory.profileFieldsChanged})`))
    .orderBy(asc(socialAccountHistory.detectedAt));
  for (const r of rows) out.set(r.id, [...(out.get(r.id) ?? []), r]);
  return out;
}

/** Undefined when the account is out of the caller's sight. */
export async function getConnections(accountId: string): Promise<ConnectionsResult | undefined> {
  const [me] = await db
    .select()
    .from(socialAccounts)
    .where(and(eq(socialAccounts.id, accountId), visibleShared(socialAccounts.visibility, socialAccounts.createdByUserId)));
  if (!me) return undefined;
  const myHandle = me.username.toLowerCase();
  const weights = await connectionWeights();

  // Events land here keyed by the other side: "id:<account id>" or "h:<handle>"
  // until handles resolve. `key` dedupes, e.g. one event per post however many
  // times the post tags, captions and shows the same person.
  const raw: { other: string; key: string; event: ConnectionEvent }[] = [];
  const add = (other: string, key: string, event: ConnectionEvent) => raw.push({ other, key, event });

  const myFaces = [me.personfaceUuid];
  if (me.ownerUuid) {
    const [owner] = await db.select({ pf: people.personfaceUuid }).from(people).where(eq(people.id, me.ownerUuid));
    myFaces.push(owner?.pf ?? null);
  }
  const myPersonfaces = [...new Set(myFaces.filter((pf): pf is string => Boolean(pf)))];

  // ── Out: my posts and stories, who they tag, caption and show ──
  const myPosts = await db
    .select(postCols)
    .from(socialAccountPosts)
    .where(or(eq(socialAccountPosts.socialAccountId, me.id), sql`${socialAccountPosts.coauthorAccountIds} @> ${JSON.stringify([me.id])}::jsonb`));
  for (const p of myPosts) {
    for (const h of mentionedIn(p)) add(`h:${h}`, `post:${p.id}:out`, { at: postAt(p), kind: postKind(p), dir: "out" });
  }
  const myPostById = new Map(myPosts.map((p) => [p.id, p]));
  const facesInMine = await facesInPosts(myPosts.map((p) => p.id));
  const faceAccounts = await accountsForFaces([...new Set(facesInMine.map((f) => f.personfaceUuid))]);
  for (const f of facesInMine) {
    const p = myPostById.get(f.postId)!;
    const posters = postersOf(p);
    for (const id of faceAccounts.get(f.personfaceUuid) ?? []) {
      if (!posters.includes(id)) add(`id:${id}`, `post:${p.id}:out`, { at: postAt(p), kind: postKind(p), dir: "out" });
    }
  }

  // ── In: comments on my posts ──
  if (myPosts.length) {
    const comments = await db
      .select({ postId: socialPostComments.postId, username: socialPostComments.username, postedAt: socialPostComments.postedAt, createdAt: socialPostComments.createdAt })
      .from(socialPostComments)
      .where(and(inArray(socialPostComments.postId, myPosts.map((p) => p.id)), ne(sql`lower(${socialPostComments.username})`, myHandle)))
      .orderBy(asc(socialPostComments.postedAt));
    for (const c of comments) {
      add(`h:${cleanHandle(c.username)}`, `comment:${c.postId}:in`, { at: (c.postedAt ?? c.createdAt).toISOString(), kind: "comment", dir: "in" });
    }
  }

  // ── Out: my comments on other people's posts ──
  const myComments = await db
    .select({ post: postCols, postedAt: socialPostComments.postedAt, createdAt: socialPostComments.createdAt })
    .from(socialPostComments)
    .innerJoin(socialAccountPosts, eq(socialAccountPosts.id, socialPostComments.postId))
    .where(eq(sql`lower(${socialPostComments.username})`, myHandle))
    .orderBy(asc(socialPostComments.postedAt));
  for (const c of myComments) {
    for (const id of postersOf(c.post)) {
      if (id !== me.id) add(`id:${id}`, `comment:${c.post.id}:out`, { at: (c.postedAt ?? c.createdAt).toISOString(), kind: "comment", dir: "out" });
    }
  }

  // ── In: others' posts and stories that tag, caption or show me ──
  const handleLike = `%${likeEscape(myHandle)}%`;
  const naming = await db
    .select(postCols)
    .from(socialAccountPosts)
    .where(or(
      sql`lower(${socialAccountPosts.mentionedAccounts}) LIKE ${`%"${likeEscape(myHandle)}"%`}`,
      sql`${socialAccountPosts.description} ILIKE ${`%@${likeEscape(myHandle)}%`}`,
    ));
  const inPosts = naming.filter((p) => mentionedIn(p).has(myHandle));
  if (myPersonfaces.length) {
    const showing = await db
      .selectDistinct({ prmLocation: photos.prmLocation })
      .from(faces)
      .innerJoin(photos, eq(photos.id, faces.photoId))
      .where(and(inArray(faces.personfaceUuid, myPersonfaces), isNull(faces.dismissedAt), sql`${photos.prmLocation} LIKE 'post:%'`));
    const ids = showing.map((r) => r.prmLocation.slice("post:".length));
    if (ids.length) inPosts.push(...(await db.select(postCols).from(socialAccountPosts).where(inArray(socialAccountPosts.id, ids))));
  }
  for (const p of inPosts) {
    const posters = postersOf(p);
    if (posters.includes(me.id)) continue;
    for (const id of posters) add(`id:${id}`, `post:${p.id}:in`, { at: postAt(p), kind: postKind(p), dir: "in" });
  }

  // ── Bios: who mine names (out), and whose names me (in) ──
  const since = me.joinedAt ?? me.internalAccountCreationDate;
  const bioLike = `%@${likeEscape(myHandle)}%`;
  const [nowNaming, onceNaming] = await Promise.all([
    db.select({ id: socialAccounts.id }).from(socialAccounts).where(sql`${socialAccounts.bio} ILIKE ${bioLike}`),
    db.selectDistinct({ id: socialAccountHistory.socialAccountId }).from(socialAccountHistory).where(sql`${socialAccountHistory.previousBio} ILIKE ${bioLike}`),
  ]);
  const namerIds = [...new Set([...nowNaming, ...onceNaming].map((r) => r.id))].filter((id) => id !== me.id);
  const namerRows = namerIds.length
    ? await db
        .select({ id: socialAccounts.id, bio: socialAccounts.bio, since: socialAccounts.internalAccountCreationDate })
        .from(socialAccounts)
        .where(inArray(socialAccounts.id, namerIds))
    : [];
  const changes = await bioChanges([me.id, ...namerRows.map((r) => r.id)]);
  const bioEvent = (m: BioMention, dir: "in" | "out"): ConnectionEvent => ({
    at: m.at.toISOString(),
    kind: "bio",
    dir,
    heart: m.heart,
    ...(m.removedAt ? { removedAt: m.removedAt.toISOString() } : {}),
  });
  for (const [handle, m] of bioMentions({ bio: me.bio, since: me.internalAccountCreationDate }, changes.get(me.id) ?? [])) {
    if (handle !== myHandle) add(`h:${handle}`, "bio:out", bioEvent(m, "out"));
  }
  for (const r of namerRows) {
    const m = bioMentions(r, changes.get(r.id) ?? []).get(myHandle);
    if (m) add(`id:${r.id}`, "bio:in", bioEvent(m, "in"));
  }

  // ── Resolve handles, drop what the caller can't see, dedupe, score ──
  const handles = [...new Set(raw.filter((r) => r.other.startsWith("h:")).map((r) => r.other.slice(2)))];
  const ids = [...new Set(raw.filter((r) => r.other.startsWith("id:")).map((r) => r.other.slice(3)))];
  const visible = visibleShared(socialAccounts.visibility, socialAccounts.createdByUserId);
  const accountCols = { id: socialAccounts.id, username: socialAccounts.username, nickname: socialAccounts.nickname, imageUrl: socialAccounts.imageUrl, typeId: socialAccounts.typeId };
  const byHandle = new Map<string, string>();
  const accounts = new Map<string, Connection["account"]>();
  if (handles.length) {
    const rows = await db
      .select(accountCols)
      .from(socialAccounts)
      .where(and(inArray(sql`lower(${socialAccounts.username})`, handles), or(eq(socialAccounts.typeId, INSTAGRAM_TYPE_ID), isNull(socialAccounts.typeId)), visible));
    // An Instagram-typed row wins over an untyped one under the same name.
    rows.sort((a, b) => Number(b.typeId === INSTAGRAM_TYPE_ID) - Number(a.typeId === INSTAGRAM_TYPE_ID));
    for (const { typeId, ...a } of rows) {
      const h = a.username.toLowerCase();
      if (!byHandle.has(h)) byHandle.set(h, a.id);
      accounts.set(a.id, a);
    }
  }
  const unseen = ids.filter((id) => !accounts.has(id));
  if (unseen.length) {
    for (const { typeId, ...a } of await db.select(accountCols).from(socialAccounts).where(and(inArray(socialAccounts.id, unseen), visible))) {
      accounts.set(a.id, a);
    }
  }

  const grouped = new Map<string, Map<string, ConnectionEvent>>();
  for (const r of raw) {
    const otherId = r.other.startsWith("h:") ? byHandle.get(r.other.slice(2)) : r.other.slice(3);
    if (!otherId || otherId === me.id || !accounts.has(otherId)) continue;
    const events = grouped.get(otherId) ?? new Map<string, ConnectionEvent>();
    if (!events.has(r.key)) events.set(r.key, r.event);
    grouped.set(otherId, events);
  }

  const now = Date.now();
  const connections: Connection[] = [];
  for (const [otherId, eventMap] of grouped) {
    const events = [...eventMap.values()].sort((a, b) => a.at.localeCompare(b.at));
    const byKind = Object.fromEntries(CONNECTION_KINDS.map((k) => [k, 0])) as Record<ConnectionKind, number>;
    let inScore = 0;
    let outScore = 0;
    for (const e of events) {
      const v = eventValue(e, weights, now);
      byKind[e.kind] += v;
      if (e.dir === "in") inScore += v;
      else outScore += v;
    }
    connections.push({
      account: accounts.get(otherId)!,
      score: inScore + outScore,
      in: inScore,
      out: outScore,
      byKind,
      lastInteractionAt: events[events.length - 1].at,
      events,
    });
  }
  connections.sort((a, b) => b.score - a.score);

  const earliest = connections.reduce((min, c) => (c.events[0].at < min ? c.events[0].at : min), since.toISOString());
  return { since: earliest, weights, connections };
}
