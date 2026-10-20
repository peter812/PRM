/**
 * Face review's Verify tab (face-clustering-plan.md §4): per named identity, the faces auto-assign
 * thinks are probably them but didn't move (`verify_personface_uuid`), plus the faces it did move
 * under an older, looser bar that nobody has confirmed (`auto_match_score` below today's
 * auto-assign score). Confirm names the selected faces; the rest are never offered again.
 */
import { and, eq, inArray, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import { db } from "./db";
import { facePairDismissals, faces } from "@shared/schema";
import { connectFaces, disassociateFace, faceGroupUnnamed, RecognitionRequestError } from "./recognition";
import { getAutoAssignMinScore } from "./face-lookalikes";
import { buildCropCache, buildIdentityCache } from "./face-review";

export type VerifyIdentity = { group: string; label: string; cropUrl: string | null; pending: number; unconfirmed: number };
export type VerifyFace = { id: string; cropUrl: string; score: number };
export type VerifyGroup = VerifyIdentity & { pendingFaces: VerifyFace[]; unconfirmedFaces: VerifyFace[] };

/** A verify-tier face: still open (not dismissed, not named meanwhile). */
const pendingFor = (group?: string) =>
  and(group ? eq(faces.verifyPersonfaceUuid, group) : isNotNull(faces.verifyPersonfaceUuid), isNull(faces.dismissedAt), faceGroupUnnamed);
/** A face auto-assigned below today's bar, still unconfirmed. */
const unconfirmedFor = (minScore: number, group?: string) =>
  and(group ? eq(faces.personfaceUuid, group) : isNotNull(faces.personfaceUuid), isNotNull(faces.autoMatchScore), lt(faces.autoMatchScore, minScore), isNull(faces.dismissedAt));

/** Identities with something to verify, most first. */
export async function listVerifyIdentities(): Promise<VerifyIdentity[]> {
  const minScore = await getAutoAssignMinScore();
  const [pending, unconfirmed] = await Promise.all([
    db.select({ group: faces.verifyPersonfaceUuid, n: sql<number>`count(*)::int` }).from(faces).where(pendingFor()).groupBy(faces.verifyPersonfaceUuid),
    db.select({ group: faces.personfaceUuid, n: sql<number>`count(*)::int` }).from(faces).where(unconfirmedFor(minScore)).groupBy(faces.personfaceUuid),
  ]);
  const counts = new Map<string, { pending: number; unconfirmed: number }>();
  for (const r of pending) counts.set(r.group!, { pending: r.n, unconfirmed: 0 });
  for (const r of unconfirmed) counts.set(r.group!, { pending: counts.get(r.group!)?.pending ?? 0, unconfirmed: r.n });
  const groups = Array.from(counts.keys());
  const [identities, crops] = await Promise.all([buildIdentityCache(groups), buildCropCache(groups)]);
  return groups
    .filter((g) => identities.has(g))
    .map((g) => ({ group: g, label: identities.get(g)!.label, cropUrl: crops.get(g) ?? null, ...counts.get(g)! }))
    .sort((a, b) => b.pending + b.unconfirmed - (a.pending + a.unconfirmed));
}

/** One identity's faces to verify, best score first; null when it isn't a named identity. */
export async function getVerifyGroup(group: string): Promise<VerifyGroup | null> {
  const identity = (await buildIdentityCache([group])).get(group);
  if (!identity) return null;
  const minScore = await getAutoAssignMinScore();
  const [pendingFaces, unconfirmedFaces, crops] = await Promise.all([
    db.select({ id: faces.id, cropUrl: faces.s3Url, score: faces.verifyScore }).from(faces).where(pendingFor(group)).orderBy(sql`${faces.verifyScore} DESC`),
    db.select({ id: faces.id, cropUrl: faces.s3Url, score: faces.autoMatchScore }).from(faces).where(unconfirmedFor(minScore, group)).orderBy(sql`${faces.autoMatchScore} DESC`),
    buildCropCache([group]),
  ]);
  const scored = (rows: { id: string; cropUrl: string; score: number | null }[]) => rows.map((r) => ({ ...r, score: r.score ?? 0 }));
  return {
    group,
    label: identity.label,
    cropUrl: crops.get(group) ?? null,
    pending: pendingFaces.length,
    unconfirmed: unconfirmedFaces.length,
    pendingFaces: scored(pendingFaces),
    unconfirmedFaces: scored(unconfirmedFaces),
  };
}

/**
 * Confirm Verify picks for `group`: `confirm` faces are named as it (connectFaces, which also clears
 * an unconfirmed face's `auto_match_score`); `reject` faces are recorded as "not them" so neither
 * look-alikes nor auto-assign offer it again (face-review-plan.md §8.4). Every face must still be on
 * this identity's Verify list, else 409.
 */
export async function confirmVerify(group: string, confirm: string[], reject: string[]): Promise<{ confirmed: number; rejected: number }> {
  const identity = (await buildIdentityCache([group])).get(group);
  if (!identity) throw new RecognitionRequestError(404, "This identity is gone.");
  const ids = [...confirm, ...reject];
  if (!ids.length) return { confirmed: 0, rejected: 0 };
  const minScore = await getAutoAssignMinScore();
  const rows = await db
    .select({ id: faces.id, personfaceUuid: faces.personfaceUuid })
    .from(faces)
    .where(and(inArray(faces.id, ids), or(pendingFor(group), unconfirmedFor(minScore, group))));
  if (rows.length !== new Set(ids).size) throw new RecognitionRequestError(409, "This list changed; reload it.");
  const groupOf = new Map(rows.map((r) => [r.id, r.personfaceUuid]));

  if (confirm.length) await connectFaces(confirm, { personId: identity.personId, socialAccountId: identity.socialAccountId });
  for (const id of reject) {
    const own = groupOf.get(id);
    // Auto-assigned into the group: pull it out (disassociateFace records the dismissal itself).
    if (own === group) {
      await disassociateFace(id);
      continue;
    }
    // A verify pick: dismiss its own group against the identity. An orphan first gets a group of its own.
    const faceGroup = own ?? (await disassociateFace(id)).newGroupUuid;
    const [a, b] = faceGroup < group ? [faceGroup, group] : [group, faceGroup];
    await db.transaction(async (tx) => {
      await tx.insert(facePairDismissals).values({ groupAUuid: a, groupBUuid: b }).onConflictDoNothing();
      await tx.update(faces).set({ verifyPersonfaceUuid: null, verifyScore: null }).where(eq(faces.id, id));
    });
  }
  return { confirmed: confirm.length, rejected: reject.length };
}
