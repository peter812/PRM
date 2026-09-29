/**
 * Look-alikes: for a face that isn't identified, the known identities (named
 * people / social accounts) whose faces look most similar to it. See
 * face-review-plan.md §3.6.
 *
 * Centroids are held in memory and rebuilt lazily behind a dirty flag, never
 * on a timer. This file must not import recognition.ts — it's the other way
 * around (recognition.ts calls markFaceIdentitiesDirty after a connect,
 * disassociate or merge) — so the two never form an import cycle.
 */
import { and, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";
import { db } from "./db";
import { storage } from "./storage";
import { facePairDismissals, faces, people, socialAccounts } from "@shared/schema";

// ── Threshold setting ────────────────────────────────────────────────────────

const LOOKALIKE_MIN_SCORE_KEY = "face_lookalike_min_score";
const LOOKALIKE_MIN_SCORE_DEFAULT = 0.45;

/** Cosine similarity (0-1) a candidate must reach to be shown as a look-alike. */
export async function getLookalikeMinScore(): Promise<number> {
  const raw = Number(await storage.getAppSetting(LOOKALIKE_MIN_SCORE_KEY));
  return Number.isFinite(raw) && raw > 0 && raw <= 1 ? raw : LOOKALIKE_MIN_SCORE_DEFAULT;
}

export async function setLookalikeMinScore(score: number): Promise<void> {
  if (Number.isFinite(score) && score > 0 && score <= 1) await storage.setAppSetting(LOOKALIKE_MIN_SCORE_KEY, String(score));
}

const LIKELY_SAME_MIN_SCORE_KEY = "face_likely_same_min_score";
const LIKELY_SAME_MIN_SCORE_DEFAULT = 0.55;

/** Cosine similarity (0-1) threshold for the "Likely same" review flow. */
export async function getLikelySameMinScore(): Promise<number> {
  const raw = Number(await storage.getAppSetting(LIKELY_SAME_MIN_SCORE_KEY));
  return Number.isFinite(raw) && raw > 0 && raw <= 1 ? raw : LIKELY_SAME_MIN_SCORE_DEFAULT;
}

export async function setLikelySameMinScore(score: number): Promise<void> {
  if (Number.isFinite(score) && score > 0 && score <= 1) await storage.setAppSetting(LIKELY_SAME_MIN_SCORE_KEY, String(score));
}

const AUTO_ASSIGN_MIN_SCORE_KEY = "face_auto_assign_min_score";
const AUTO_ASSIGN_MIN_SCORE_DEFAULT = 0.55;
/** A top match this close to the runner-up is a coin toss, so it's left for review (face-review-plan.md §8.2). */
export const AUTO_ASSIGN_MIN_MARGIN = 0.01;

/** Cosine similarity (0-1) at which PRM assigns a face to its top look-alike without asking. */
export async function getAutoAssignMinScore(): Promise<number> {
  const raw = Number(await storage.getAppSetting(AUTO_ASSIGN_MIN_SCORE_KEY));
  return Number.isFinite(raw) && raw > 0 && raw <= 1 ? raw : AUTO_ASSIGN_MIN_SCORE_DEFAULT;
}

export async function setAutoAssignMinScore(score: number): Promise<void> {
  if (Number.isFinite(score) && score > 0 && score <= 1) await storage.setAppSetting(AUTO_ASSIGN_MIN_SCORE_KEY, String(score));
}

// ── Centroid cache ────────────────────────────────────────────────────────────

let dirty = true;
let centroids = new Map<string, Float32Array>();
/** Background recognition adds faces to known groups without marking dirty, so rebuild at least this often. */
const CENTROID_MAX_AGE_MS = 10 * 60 * 1000;
let builtAt = 0;
let rebuildPromise: Promise<void> | null = null;

/** Call after any connect, disassociate or merge that could change a group's membership or naming. */
export function markFaceIdentitiesDirty(): void {
  dirty = true;
}

export async function ensureCentroids(): Promise<void> {
  if (!dirty && centroids.size > 0 && Date.now() - builtAt <= CENTROID_MAX_AGE_MS) return;
  if (rebuildPromise) return rebuildPromise;
  rebuildPromise = rebuildCentroids().finally(() => {
    rebuildPromise = null;
  });
  return rebuildPromise;
}

async function rebuildCentroids(): Promise<void> {
  const rawRows = await db.execute(sql`
    SELECT f.personface_uuid AS "personfaceUuid", f.embedding
    FROM faces f
    WHERE f.personface_uuid IS NOT NULL
      AND f.dismissed_at IS NULL
      AND f.auto_match_score IS NULL -- unconfirmed guesses don't shape the identity they were guessed into
      AND f.embedding IS NOT NULL
      AND (
        EXISTS (SELECT 1 FROM people p WHERE p.personface_uuid = f.personface_uuid)
        OR EXISTS (SELECT 1 FROM social_accounts sa WHERE sa.personface_uuid = f.personface_uuid)
      )
  `);
  const rows = (rawRows as unknown as { rows: { personfaceUuid: string; embedding: number[] | null }[] }).rows;
  const next = new Map<string, Float32Array>();

  if (rows.length) {
    const sums = new Map<string, { sum: number[]; count: number }>();
    for (const row of rows) {
      const group = row.personfaceUuid;
      const embedding = row.embedding;
      if (!group || !Array.isArray(embedding) || !embedding.length) continue;
      let acc = sums.get(group);
      if (!acc) {
        acc = { sum: new Array(embedding.length).fill(0), count: 0 };
        sums.set(group, acc);
      }
      for (let i = 0; i < embedding.length && i < acc.sum.length; i++) acc.sum[i] += embedding[i];
      acc.count++;
    }
    for (const [group, { sum, count }] of sums) {
      if (!count) continue;
      const mean = sum.map((v) => v / count);
      const norm = Math.sqrt(mean.reduce((s, v) => s + v * v, 0));
      if (!norm) continue;
      next.set(group, Float32Array.from(mean.map((v) => v / norm)));
    }
  }
  centroids = next;
  dirty = false;
  builtAt = Date.now();
}

export type LookAlike = { personfaceUuid: string; score: number };

/**
 * Top 3 known identities (at or above the threshold) each of `faceUuids`
 * looks like, best first, excluding the face's own group and any identity the
 * user has said it isn't (face_pair_dismissals, written by ✕ / "Not them").
 * Rebuilds the centroid cache first when it's dirty or empty.
 */
export async function lookAlikesFor(faceUuids: string[], opts?: { minScore?: number }): Promise<Map<string, LookAlike[]>> {
  const result = new Map<string, LookAlike[]>();
  if (!faceUuids.length) return result;
  await ensureCentroids();
  if (!centroids.size) return result;

  const threshold = opts?.minScore ?? (await getLookalikeMinScore());
  const rows = await db
    .select({ id: faces.id, personfaceUuid: faces.personfaceUuid, embedding: faces.embedding })
    .from(faces)
    .where(inArray(faces.id, faceUuids));

  const ownGroups = Array.from(new Set(rows.map((r) => r.personfaceUuid).filter((g): g is string => !!g)));
  const rejected = new Set<string>();
  if (ownGroups.length) {
    const pairs = await db
      .select({ a: facePairDismissals.groupAUuid, b: facePairDismissals.groupBUuid })
      .from(facePairDismissals)
      .where(or(inArray(facePairDismissals.groupAUuid, ownGroups), inArray(facePairDismissals.groupBUuid, ownGroups)));
    for (const { a, b } of pairs) rejected.add(`${a}:${b}`).add(`${b}:${a}`);
  }

  for (const row of rows) {
    const embedding = row.embedding as number[] | null;
    if (!Array.isArray(embedding) || !embedding.length) continue;
    const ownGroup = row.personfaceUuid;
    const scored: LookAlike[] = [];
    for (const [group, centroid] of centroids) {
      if (group === ownGroup || centroid.length !== embedding.length || rejected.has(`${ownGroup}:${group}`)) continue;
      let dot = 0;
      for (let i = 0; i < embedding.length; i++) dot += embedding[i] * centroid[i];
      if (dot >= threshold) scored.push({ personfaceUuid: group, score: dot });
    }
    scored.sort((a, b) => b.score - a.score);
    result.set(row.id, scored.slice(0, 3));
  }
  return result;
}

export type LikelySameCandidate = {
  groupA: string;
  groupB: string;
  score: number;
};

/**
 * Searches pairwise cosine similarity across all known identity centroids,
 * returning candidates >= threshold, filtered by previously dismissed pairs.
 */
export async function findLikelySameCandidatePairs(opts?: { minScore?: number; limit?: number }): Promise<LikelySameCandidate[]> {
  await ensureCentroids();
  if (centroids.size < 2) return [];

  const threshold = opts?.minScore ?? (await getLikelySameMinScore());
  const limit = opts?.limit ?? 50;

  // Load all dismissed pairs
  const dismissedRows = await db.select({ a: facePairDismissals.groupAUuid, b: facePairDismissals.groupBUuid }).from(facePairDismissals);
  const dismissedSet = new Set<string>();
  for (const r of dismissedRows) {
    const [minG, maxG] = r.a < r.b ? [r.a, r.b] : [r.b, r.a];
    dismissedSet.add(`${minG}:${maxG}`);
  }

  const groupList = Array.from(centroids.keys());
  const candidates: LikelySameCandidate[] = [];

  for (let i = 0; i < groupList.length; i++) {
    // Yield every 100 iterations so we don't lock Node's event loop
    if (i > 0 && i % 100 === 0) {
      await new Promise((resolve) => setImmediate(resolve));
    }
    const gA = groupList[i];
    const cA = centroids.get(gA)!;
    for (let j = i + 1; j < groupList.length; j++) {
      const gB = groupList[j];
      const [minG, maxG] = gA < gB ? [gA, gB] : [gB, gA];
      if (dismissedSet.has(`${minG}:${maxG}`)) continue;

      const cB = centroids.get(gB)!;
      if (cA.length !== cB.length) continue;

      let dot = 0;
      for (let k = 0; k < cA.length; k++) dot += cA[k] * cB[k];
      if (dot >= threshold) {
        candidates.push({ groupA: gA, groupB: gB, score: dot });
      }
    }
  }

  candidates.sort((x, y) => y.score - x.score);
  return candidates.slice(0, limit);
}

/**
 * Records that groupA and groupB are NOT the same identity, so they are not recommended again.
 */
export async function dismissLikelySamePair(groupA: string, groupB: string, userId?: number): Promise<void> {
  const [minG, maxG] = groupA < groupB ? [groupA, groupB] : [groupB, groupA];
  await db
    .insert(facePairDismissals)
    .values({
      groupAUuid: minG,
      groupBUuid: maxG,
      userId: userId ?? null,
    })
    .onConflictDoNothing();
}
