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
import {
  INSTAGRAM_TYPE_ID,
  faces,
  people,
  photos,
  socialAccountHistory,
  socialAccountPostTags,
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
    .where(eq(socialAccounts.id, accountId));
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
  if (myPosts.length) {
    const myPostTags = await db
      .select({ postId: socialAccountPostTags.postId, socialAccountId: socialAccountPostTags.socialAccountId })
      .from(socialAccountPostTags)
      .where(and(
        inArray(socialAccountPostTags.postId, myPosts.map((p) => p.id)),
        isNull(socialAccountPostTags.removedSeenAt),
      ));
    for (const tag of myPostTags) {
      const p = myPostById.get(tag.postId);
      if (!p) continue;
      const posters = postersOf(p);
      if (!posters.includes(tag.socialAccountId)) {
        add(`id:${tag.socialAccountId}`, `post:${p.id}:out`, { at: postAt(p), kind: postKind(p), dir: "out" });
      }
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
  const taggedMine = await db
    .select(postCols)
    .from(socialAccountPostTags)
    .innerJoin(socialAccountPosts, eq(socialAccountPosts.id, socialAccountPostTags.postId))
    .where(and(
      eq(socialAccountPostTags.socialAccountId, me.id),
      isNull(socialAccountPostTags.removedSeenAt),
      eq(socialAccountPosts.isDeleted, false),
    ));
  inPosts.push(...taggedMine);
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
  const accountCols = { id: socialAccounts.id, username: socialAccounts.username, nickname: socialAccounts.nickname, imageUrl: socialAccounts.imageUrl, typeId: socialAccounts.typeId };
  const byHandle = new Map<string, string>();
  const accounts = new Map<string, Connection["account"]>();
  if (handles.length) {
    const rows = await db
      .select(accountCols)
      .from(socialAccounts)
      .where(and(inArray(sql`lower(${socialAccounts.username})`, handles), or(eq(socialAccounts.typeId, INSTAGRAM_TYPE_ID), isNull(socialAccounts.typeId))));
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
    for (const { typeId, ...a } of await db.select(accountCols).from(socialAccounts).where(inArray(socialAccounts.id, unseen))) {
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

const PROMPT_KIND_LABEL: Record<ConnectionKind, string> = {
  comment: "comments",
  story_mention: "story mentions",
  post_mention: "post tags/faces",
  bio: "bio mentions",
};

const day = (iso: string) => iso.slice(0, 10);
const round = (n: number) => (n >= 10 ? Math.round(n) : Number(n.toFixed(1))).toString();

/** How to read the connections block, with the live weights, so the model knows what a strength number is worth. */
function connectionsGuide(w: ConnectionWeights): string {
  const kindWeights = CONNECTION_KINDS.map((k) => w[k]);
  const unit = kindWeights.reduce((a, b) => a + b, 0) / kindWeights.length;
  return [
    "How to read <connections_strongest_first> (the accounts this one interacts with most, strongest first):",
    "- in = what they did toward this account (commented on its posts; tagged, captioned or showed it in their posts or stories; named it in their bio). out = what this account did toward them.",
    "- Counts are interactions: one per post or story per direction. Many comments by one person on one post count once, and a post that both tags and shows someone counts once.",
    `- Strength = the sum over interactions of the kind's weight (comment ${w.comment}, story mention ${w.story_mention}, post tag/face ${w.post_mention}, bio mention ${w.bio}, ×${w.heartMultiplier} with a heart beside the handle) times recency: 1.0 today, falling evenly to 0.5 at two years old and staying there. A bio mention counts in full while it's in the bio and only starts aging once removed.`,
    `- So one interaction is worth ${round(unit / 2)}–${round(unit)}. Roughly: ${round(unit)} ≈ a single recent interaction, ${round(unit * 5)} ≈ a handful, ${round(unit * 20)}+ ≈ a steady, frequent relationship. Compare lines with each other rather than reading the number alone.`,
    "- A connection that is high but mostly one direction is one-sided (a fan, a brand, a place they promote); one with both directions is mutual. An old last date means the connection has faded.",
  ].join("\n");
}

/**
 * The account summary's view of its connections: a guide to the scores and one line per
 * strongest connection, with interaction counts rather than the tab's decayed per-kind values.
 */
export async function connectionsForPrompt(accountId: string, limit: number): Promise<{ guide: string; block: string; count: number }> {
  const result = await getConnections(accountId);
  const top = (result?.connections ?? []).slice(0, limit);
  const weights = result?.weights ?? (await connectionWeights());

  const ownerRows = top.length
    ? await db
        .select({ id: socialAccounts.id, firstName: people.firstName, lastName: people.lastName })
        .from(socialAccounts)
        .innerJoin(people, eq(people.id, socialAccounts.ownerUuid))
        .where(inArray(socialAccounts.id, top.map((c) => c.account.id)))
    : [];
  const ownerName = new Map(ownerRows.map((r) => [r.id, `${r.firstName} ${r.lastName ?? ""}`.trim()]));

  const lines = top.map((c) => {
    const owner = ownerName.get(c.account.id);
    const names = [c.account.nickname, owner && owner !== c.account.nickname ? `PRM: ${owner}` : null].filter(Boolean).join(", ");
    const counts = Object.fromEntries(CONNECTION_KINDS.map((k) => [k, 0])) as Record<ConnectionKind, number>;
    let inCount = 0;
    for (const e of c.events) {
      counts[e.kind]++;
      if (e.dir === "in") inCount++;
    }
    const kinds = CONNECTION_KINDS.filter((k) => counts[k] > 0).map((k) => `${PROMPT_KIND_LABEL[k]} ${counts[k]}`).join(", ");
    const bios = c.events.filter((e) => e.kind === "bio").map((e) => {
      const where = e.dir === "out" ? "in this account's bio" : "names this account in their bio";
      return `${where}${e.heart ? " with ♥" : ""} ${e.removedAt ? `until ${day(e.removedAt)}` : "now"}`;
    });
    return [
      `@${c.account.username}${names ? ` (${names})` : ""}`,
      `strength ${round(c.score)}`,
      `${inCount} in / ${c.events.length - inCount} out`,
      kinds,
      `last ${day(c.lastInteractionAt)}`,
      ...bios,
    ].join("; ");
  });

  return { guide: connectionsGuide(weights), block: lines.join("\n"), count: lines.length };
}

/** One pair of accounts that interact, `a < b`: what a did toward b and what b did toward a, both decayed to now. */
export type ConnectionPair = { a: string; b: string; ab: number; ba: number };

const NETWORK_TTL_MS = 5 * 60_000;
let networkCache: { at: number; weightsKey: string; pairs: ConnectionPair[] } | null = null;

/**
 * Every interacting pair in the instance, for the graph's Connections view. The
 * same signals and dedupe rules as getConnections, gathered for everyone in one
 * pass instead of from one account's side. Cached briefly because each graph
 * filter change asks again, and scores barely move in a few minutes.
 */
export async function getConnectionNetwork(): Promise<ConnectionPair[]> {
  const weights = await connectionWeights();
  const weightsKey = JSON.stringify(weights);
  if (networkCache && networkCache.weightsKey === weightsKey && Date.now() - networkCache.at < NETWORK_TTL_MS) {
    return networkCache.pairs;
  }

  const accounts = await db
    .select({ id: socialAccounts.id, username: socialAccounts.username, typeId: socialAccounts.typeId, bio: socialAccounts.bio, since: socialAccounts.internalAccountCreationDate })
    .from(socialAccounts);
  // An Instagram-typed row wins over an untyped one under the same name; other networks never match a handle.
  const byHandle = new Map<string, string>();
  for (const a of [...accounts].sort((x, y) => Number(y.typeId === INSTAGRAM_TYPE_ID) - Number(x.typeId === INSTAGRAM_TYPE_ID))) {
    if (a.typeId !== INSTAGRAM_TYPE_ID && a.typeId !== null) continue;
    const h = a.username.toLowerCase();
    if (!byHandle.has(h)) byHandle.set(h, a.id);
  }

  // Directed events keyed "from|to|dedupe key", first one wins.
  const events = new Map<string, { from: string; to: string; event: ConnectionEvent }>();
  const add = (from: string | undefined, to: string | undefined, key: string, event: ConnectionEvent) => {
    if (!from || !to || from === to) return;
    const k = `${from}|${to}|${key}`;
    if (!events.has(k)) events.set(k, { from, to, event });
  };

  // ── Posts and stories: tags and caption @handles ──
  const naming = await db
    .select(postCols)
    .from(socialAccountPosts)
    .where(or(sql`${socialAccountPosts.mentionedAccounts} IS NOT NULL`, sql`${socialAccountPosts.description} LIKE '%@%'`));
  for (const p of naming) {
    const mentioned = mentionedIn(p);
    if (!mentioned.size) continue;
    const event = { at: postAt(p), kind: postKind(p), dir: "out" as const };
    for (const h of mentioned) {
      for (const poster of postersOf(p)) add(poster, byHandle.get(h), `post:${p.id}`, event);
    }
  }

  // ── Tagged posts: explicit tags from the Tagged tab ──
  const tagRows = await db
    .select({
      taggedAccountId: socialAccountPostTags.socialAccountId,
      post: postCols,
    })
    .from(socialAccountPostTags)
    .innerJoin(socialAccountPosts, eq(socialAccountPosts.id, socialAccountPostTags.postId))
    .where(and(
      isNull(socialAccountPostTags.removedSeenAt),
      eq(socialAccountPosts.isDeleted, false),
    ));
  for (const r of tagRows) {
    const posters = postersOf(r.post);
    if (posters.includes(r.taggedAccountId)) continue;
    const event = { at: postAt(r.post), kind: postKind(r.post), dir: "out" as const };
    for (const poster of posters) {
      add(poster, r.taggedAccountId, `post:${r.post.id}`, event);
    }
  }

  // ── Faces in posts: the same event as a tag, so one per post either way ──
  const faceRows = await db
    .select({ prmLocation: photos.prmLocation, personfaceUuid: faces.personfaceUuid })
    .from(faces)
    .innerJoin(photos, eq(photos.id, faces.photoId))
    .where(and(sql`${faces.personfaceUuid} IS NOT NULL`, isNull(faces.dismissedAt), sql`${photos.prmLocation} LIKE 'post:%'`));
  if (faceRows.length) {
    const postIds = [...new Set(faceRows.map((r) => r.prmLocation.slice("post:".length)))];
    const posts = new Map((await db.select(postCols).from(socialAccountPosts).where(inArray(socialAccountPosts.id, postIds))).map((p) => [p.id, p]));
    const faceAccounts = await accountsForFaces([...new Set(faceRows.map((r) => r.personfaceUuid!))]);
    for (const r of faceRows) {
      const p = posts.get(r.prmLocation.slice("post:".length));
      if (!p) continue;
      const posters = postersOf(p);
      for (const id of faceAccounts.get(r.personfaceUuid!) ?? []) {
        if (posters.includes(id)) continue;
        for (const poster of posters) add(poster, id, `post:${p.id}`, { at: postAt(p), kind: postKind(p), dir: "out" });
      }
    }
  }

  // ── Comments: commenter → each poster, one per (commenter, post), earliest kept ──
  const comments = await db
    .select({ postId: socialPostComments.postId, username: socialPostComments.username, postedAt: socialPostComments.postedAt, createdAt: socialPostComments.createdAt, post: postCols })
    .from(socialPostComments)
    .innerJoin(socialAccountPosts, eq(socialAccountPosts.id, socialPostComments.postId))
    .where(sql`EXISTS (SELECT 1 FROM ${socialAccounts} WHERE lower(${socialAccounts.username}) = lower(${socialPostComments.username}))`)
    .orderBy(asc(socialPostComments.postedAt));
  for (const c of comments) {
    const from = byHandle.get(cleanHandle(c.username));
    const at = (c.postedAt ?? c.createdAt).toISOString();
    for (const poster of postersOf(c.post)) add(from, poster, `comment:${c.postId}`, { at, kind: "comment", dir: "out" });
  }

  // ── Bios: every handle a bio has ever named ──
  const withHandles = accounts.filter((a) => a.bio?.includes("@"));
  const pastNaming = await db
    .selectDistinct({ id: socialAccountHistory.socialAccountId })
    .from(socialAccountHistory)
    .where(sql`${socialAccountHistory.previousBio} LIKE '%@%'`);
  const bioIds = new Set([...withHandles.map((a) => a.id), ...pastNaming.map((r) => r.id)]);
  const changes = await bioChanges([...bioIds]);
  for (const a of accounts) {
    if (!bioIds.has(a.id)) continue;
    for (const [handle, m] of bioMentions(a, changes.get(a.id) ?? [])) {
      add(a.id, byHandle.get(handle), "bio", {
        at: m.at.toISOString(),
        kind: "bio",
        dir: "out",
        heart: m.heart,
        ...(m.removedAt ? { removedAt: m.removedAt.toISOString() } : {}),
      });
    }
  }

  // ── Score each pair ──
  const now = Date.now();
  const pairs = new Map<string, ConnectionPair>();
  for (const { from, to, event } of events.values()) {
    const [a, b] = from < to ? [from, to] : [to, from];
    const key = `${a}|${b}`;
    const pair = pairs.get(key) ?? { a, b, ab: 0, ba: 0 };
    const v = eventValue(event, weights, now);
    if (from === a) pair.ab += v;
    else pair.ba += v;
    pairs.set(key, pair);
  }
  const result = [...pairs.values()].filter((p) => p.ab + p.ba > 0);
  networkCache = { at: Date.now(), weightsKey, pairs: result };
  return result;
}
