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
  if (Number.isFinite(score) && score > 0 && score <= 1) {
    await storage.setAppSetting(LIKELY_SAME_MIN_SCORE_KEY, String(score));
    invalidateCandidatePairsCache();
  }
}

const AUTO_ASSIGN_MIN_SCORE_KEY = "face_auto_assign_min_score";
const AUTO_ASSIGN_MIN_SCORE_DEFAULT = 0.75;
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

const VERIFY_MIN_SCORE_KEY = "face_verify_min_score";
const VERIFY_MIN_SCORE_DEFAULT = 0.55;

/** Cosine similarity (0-1) from which a face below the auto-assign score is offered in the Verify tab instead. */
export async function getVerifyMinScore(): Promise<number> {
  const raw = Number(await storage.getAppSetting(VERIFY_MIN_SCORE_KEY));
  return Number.isFinite(raw) && raw > 0 && raw <= 1 ? raw : VERIFY_MIN_SCORE_DEFAULT;
}

export async function setVerifyMinScore(score: number): Promise<void> {
  if (Number.isFinite(score) && score > 0 && score <= 1) await storage.setAppSetting(VERIFY_MIN_SCORE_KEY, String(score));
}

const HONEYPOT_AUTO_KEY = "face_honeypot_auto";
const HONEYPOT_MIN_SCORE_KEY = "face_honeypot_min_score";
const HONEYPOT_MIN_SCORE_DEFAULT = 0.6;

/** Auto-assign sends faces that look like a honey pot face to the honey pot (honey-pot-plan.md §2.3). Off by default. */
export async function getHoneypotSettings(): Promise<{ auto: boolean; minScore: number }> {
  const raw = Number(await storage.getAppSetting(HONEYPOT_MIN_SCORE_KEY));
  return {
    auto: (await storage.getAppSetting(HONEYPOT_AUTO_KEY)) === "true",
    minScore: Number.isFinite(raw) && raw > 0 && raw <= 1 ? raw : HONEYPOT_MIN_SCORE_DEFAULT,
  };
}

export async function setHoneypotSettings(update: { auto?: unknown; minScore?: unknown }): Promise<void> {
  if (typeof update.auto === "boolean") await storage.setAppSetting(HONEYPOT_AUTO_KEY, String(update.auto));
  const score = Number(update.minScore);
  if (update.minScore !== undefined && Number.isFinite(score) && score > 0 && score <= 1) await storage.setAppSetting(HONEYPOT_MIN_SCORE_KEY, String(score));
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
  invalidateCandidatePairsCache();
}

/**
 * A rebuild loads every named face's embedding (seconds on a large library). `allowStale` (UI
 * reads) answers from the current centroids and rebuilds in the background; only a first build
 * is waited for.
 */
export async function ensureCentroids(opts?: { allowStale?: boolean }): Promise<void> {
  if (!dirty && centroids.size > 0 && Date.now() - builtAt <= CENTROID_MAX_AGE_MS) return;
  if (!rebuildPromise) {
    rebuildPromise = rebuildCentroids().finally(() => {
      rebuildPromise = null;
    });
  }
  if (opts?.allowStale && centroids.size > 0) {
    rebuildPromise.catch((err) => console.error("[FaceLookalikes] centroid rebuild failed:", err?.message ?? err));
    return;
  }
  return rebuildPromise;
}

async function rebuildCentroids(): Promise<void> {
  // Cleared up front so a change made while this runs marks the cache dirty again.
  dirty = false;
  try {
    await loadCentroids();
  } catch (err) {
    dirty = true;
    throw err;
  }
}

async function loadCentroids(): Promise<void> {
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
    const sums = new Map<string, { sum: Float64Array; count: number }>();
    for (const row of rows) {
      const group = row.personfaceUuid;
      const embedding = row.embedding;
      if (!group || !Array.isArray(embedding) || !embedding.length) continue;
      let acc = sums.get(group);
      if (!acc) {
        acc = { sum: new Float64Array(embedding.length), count: 0 };
        sums.set(group, acc);
      }
      const len = Math.min(embedding.length, acc.sum.length);
      for (let i = 0; i < len; i++) acc.sum[i] += embedding[i];
      acc.count++;
    }
    for (const [group, { sum, count }] of sums) {
      if (!count) continue;
      let normSq = 0;
      for (let i = 0; i < sum.length; i++) normSq += sum[i] * sum[i];
      const norm = Math.sqrt(normSq);
      if (!norm) continue;
      const invNorm = 1 / norm;
      const vec = new Float32Array(sum.length);
      for (let i = 0; i < sum.length; i++) vec[i] = sum[i] * invNorm;
      next.set(group, vec);
    }
  }
  centroids = next;
  builtAt = Date.now();
  invalidateCandidatePairsCache();
}

export type LookAlike = { personfaceUuid: string; score: number };

/**
 * Top 3 known identities (at or above the threshold) each of `faceUuids`
 * looks like, best first, excluding the face's own group and any identity the
 * user has said it isn't (face_pair_dismissals, written by ✕ / "Not them").
 * Rebuilds the centroid cache first when it's dirty or empty; `allowStale`
 * (UI reads) doesn't wait for that, see ensureCentroids.
 */
export async function lookAlikesFor(faceUuids: string[], opts?: { minScore?: number; allowStale?: boolean }): Promise<Map<string, LookAlike[]>> {
  const result = new Map<string, LookAlike[]>();
  if (!faceUuids.length) return result;
  await ensureCentroids({ allowStale: opts?.allowStale });
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
    result.set(row.id, topCentroids(embedding, threshold, (group) => group === ownGroup || rejected.has(`${ownGroup}:${group}`)));
  }
  return result;
}

/** Top 3 look-alikes for raw embeddings that aren't stored faces (PRM-VR recog mode), same order as given. */
export async function lookAlikesForEmbeddings(embeddings: number[][], minScore: number): Promise<LookAlike[][]> {
  await ensureCentroids();
  return embeddings.map((embedding) => topCentroids(embedding, minScore, () => false));
}

/** Top 3 centroids an L2-normalised embedding scores at least `threshold` against, best first. */
function topCentroids(embedding: number[], threshold: number, skip: (group: string) => boolean): LookAlike[] {
  const K = 3;
  const top: LookAlike[] = [];
  for (const [group, centroid] of centroids) {
    if (centroid.length !== embedding.length || skip(group)) continue;
    let dot = 0;
    for (let i = 0; i < embedding.length; i++) dot += embedding[i] * centroid[i];
    if (dot < threshold) continue;
    if (top.length === K && dot <= top[K - 1].score) continue;
    const entry: LookAlike = { personfaceUuid: group, score: dot };
    let pos = top.length;
    while (pos > 0 && top[pos - 1].score < dot) pos--;
    top.splice(pos, 0, entry);
    if (top.length > K) top.pop();
  }
  return top;
}

// ── Honey pot faces (honey-pot-plan.md §2.2) ─────────────────────────────────
// Each face a person put in the honey pot is matched on its own, not averaged: blurry
// crops of different people have nothing in common worth a centroid.

let honeypotDirty = true;
let honeypotFaces: Float32Array[] = [];

/** Call after faces enter or leave the honey pot as 'manual'. */
export function markHoneypotDirty(): void {
  honeypotDirty = true;
}

async function ensureHoneypotFaces(): Promise<void> {
  if (!honeypotDirty) return;
  honeypotDirty = false;
  try {
    const rows = await db.select({ embedding: faces.embedding }).from(faces).where(sql`${faces.honeypot} = 'manual'`);
    const next: Float32Array[] = [];
    for (const r of rows) {
      const e = r.embedding as number[] | null;
      if (!Array.isArray(e) || !e.length) continue;
      let normSq = 0;
      for (let i = 0; i < e.length; i++) normSq += e[i] * e[i];
      const norm = Math.sqrt(normSq);
      if (!norm) continue;
      const invNorm = 1 / norm;
      const vec = new Float32Array(e.length);
      for (let i = 0; i < e.length; i++) vec[i] = e[i] * invNorm;
      next.push(vec);
    }
    honeypotFaces = next;
  } catch (err) {
    honeypotDirty = true;
    throw err;
  }
}

/** Best similarity of each face (by embedding) to any manual honey pot face; faces with none aren't in the map. */
export async function honeypotScoresFor(rows: { id: string; embedding: unknown }[]): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  await ensureHoneypotFaces();
  if (!honeypotFaces.length) return result;
  for (const row of rows) {
    const embedding = row.embedding as number[] | null;
    if (!Array.isArray(embedding) || !embedding.length) continue;
    let best = -1;
    for (const hp of honeypotFaces) {
      if (hp.length !== embedding.length) continue;
      let dot = 0;
      for (let i = 0; i < embedding.length; i++) dot += embedding[i] * hp[i];
      if (dot > best) best = dot;
    }
    if (best > -1) result.set(row.id, best);
  }
  return result;
}

export type LikelySameCandidate = {
  groupA: string;
  groupB: string;
  score: number;
};

const CANDIDATE_PAIRS_MAX_AGE_MS = CENTROID_MAX_AGE_MS;
let cachedCandidatePairs: { pairs: LikelySameCandidate[]; threshold: number; builtAt: number } | null = null;
let inflightPairsPromise: Promise<LikelySameCandidate[]> | null = null;
let inflightPairsThreshold = 0;
let candidatePairsGeneration = 0;

function invalidateCandidatePairsCache(): void {
  candidatePairsGeneration++;
  cachedCandidatePairs = null;
}

function sliceCandidatePairs(pairs: LikelySameCandidate[], cachedThreshold: number, threshold: number, limit: number): LikelySameCandidate[] {
  const filtered = cachedThreshold === threshold ? pairs : pairs.filter((c) => c.score >= threshold);
  return filtered.slice(0, limit);
}

async function computeLikelySameCandidatePairs(threshold: number): Promise<LikelySameCandidate[]> {
  await ensureCentroids();
  if (centroids.size < 2) return [];

  // Load all dismissed pairs
  const dismissedRows = await db.select({ a: facePairDismissals.groupAUuid, b: facePairDismissals.groupBUuid }).from(facePairDismissals);
  const dismissedSet = new Set<string>();
  for (const r of dismissedRows) {
    const [minG, maxG] = r.a < r.b ? [r.a, r.b] : [r.b, r.a];
    dismissedSet.add(`${minG}:${maxG}`);
  }

  // Sort entries by UUID so gA < gB holds for all i < j, avoiding per-pair min/max sorting
  const entries = Array.from(centroids.entries()).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  const groups = entries.map((e) => e[0]);
  const vecs = entries.map((e) => e[1]);
  const candidates: LikelySameCandidate[] = [];
  const checkDismissals = dismissedSet.size > 0;

  for (let i = 0; i < groups.length; i++) {
    // Yield every 100 outer iterations so we don't lock Node's event loop
    if (i > 0 && i % 100 === 0) {
      await new Promise((resolve) => setImmediate(resolve));
    }
    const gA = groups[i];
    const cA = vecs[i];
    const len = cA.length;
    for (let j = i + 1; j < groups.length; j++) {
      const cB = vecs[j];
      if (cB.length !== len) continue;

      let dot = 0;
      for (let k = 0; k < len; k++) dot += cA[k] * cB[k];
      if (dot < threshold) continue;

      const gB = groups[j];
      if (checkDismissals && dismissedSet.has(`${gA}:${gB}`)) continue;
      candidates.push({ groupA: gA, groupB: gB, score: dot });
    }
  }

  candidates.sort((x, y) => y.score - x.score);
  return candidates;
}

/**
 * Searches pairwise cosine similarity across all known identity centroids,
 * returning candidates >= threshold, filtered by previously dismissed pairs.
 */
export async function findLikelySameCandidatePairs(opts?: { minScore?: number; limit?: number }): Promise<LikelySameCandidate[]> {
  const threshold = opts?.minScore ?? (await getLikelySameMinScore());
  const limit = opts?.limit ?? 50;

  if (
    !dirty &&
    cachedCandidatePairs &&
    cachedCandidatePairs.threshold <= threshold &&
    Date.now() - cachedCandidatePairs.builtAt <= CANDIDATE_PAIRS_MAX_AGE_MS &&
    Date.now() - builtAt <= CENTROID_MAX_AGE_MS
  ) {
    return sliceCandidatePairs(cachedCandidatePairs.pairs, cachedCandidatePairs.threshold, threshold, limit);
  }

  if (inflightPairsPromise && inflightPairsThreshold <= threshold) {
    const pairs = await inflightPairsPromise;
    return sliceCandidatePairs(pairs, inflightPairsThreshold, threshold, limit);
  }

  const gen = candidatePairsGeneration;
  const run = computeLikelySameCandidatePairs(threshold)
    .then((pairs) => {
      if (gen === candidatePairsGeneration && !dirty) {
        cachedCandidatePairs = { pairs, threshold, builtAt: Date.now() };
      }
      return pairs;
    })
    .finally(() => {
      if (inflightPairsPromise === run) {
        inflightPairsPromise = null;
      }
    });

  inflightPairsPromise = run;
  inflightPairsThreshold = threshold;
  const pairs = await run;
  return pairs.slice(0, limit);
}

/**
 * Records that groupA and groupB are NOT the same identity, so they are not recommended again.
 */
export async function dismissLikelySamePair(groupA: string, groupB: string): Promise<void> {
  const [minG, maxG] = groupA < groupB ? [groupA, groupB] : [groupB, groupA];
  await db
    .insert(facePairDismissals)
    .values({
      groupAUuid: minG,
      groupBUuid: maxG,
    })
    .onConflictDoNothing();
  invalidateCandidatePairsCache();
}
