/**
 * Face clustering (face-clustering-plan.md §6): group open, unnamed faces into
 * likely-same-person clusters on PRM-Compute, and flag faces too poor to be
 * worth asking about (faces.noise_reason).
 *
 * The run writes faces.cluster_id, faces.noise_reason and face_clusters (all
 * suggestion-only columns) and never touches personface_uuid, dismissed_at,
 * people or social accounts. The review half below (Face review's Clusters tab)
 * names clusters through connectFaces, so the identity model is unchanged.
 */
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "./db";
import { storage } from "./storage";
import { faceClusterRejections, faceClusters, facePairDismissals, faces, photos, socialAccountPosts, socialAccounts } from "@shared/schema";
import { log } from "./vite";
import { computeFetch, connectFaces, faceGroupUnnamed, getComputeConnection, RecognitionRequestError, type FacialId } from "./recognition";
import { lookAlikesFor } from "./face-lookalikes";
import { buildIdentityCache, photoSuggestions, type FaceReviewSuggestion } from "./face-review";

const MIN_SIMILARITY_KEY = "face_cluster_min_similarity";
const NOISE_MIN_CONF_KEY = "face_noise_min_conf";
const NOISE_MIN_SHARPNESS_KEY = "face_noise_min_sharpness";

const NOISE_MIN_PX = 30; // a face crop narrower than this (either side) is too small to recognise
const MIN_CLUSTER_SIZE = 3;
const NEIGHBOURS = 20;
const CANNOT_LINK_PER_GROUP = 20; // faces per group expanded into a dismissed pair's cannot-link list
const MONTAGE_SIZE = 16;
const QUALITY_REASONS = sql`('small', 'low_conf', 'blurry')`;

export type ClusteringSettings = { minSimilarity: number; noiseMinConf: number; noiseMinSharpness: number | null };

async function readNumber(key: string): Promise<number | null> {
  const raw = await storage.getAppSetting(key);
  const n = raw === null || raw === "" ? NaN : Number(raw);
  return Number.isFinite(n) ? n : null;
}

export async function getClusteringSettings(): Promise<ClusteringSettings> {
  const sharpness = await readNumber(NOISE_MIN_SHARPNESS_KEY);
  return {
    minSimilarity: (await readNumber(MIN_SIMILARITY_KEY)) ?? 0.5,
    // 0.85 (the plan's first guess) flags half of all faces; 0.7 flags the worst ~9%.
    noiseMinConf: (await readNumber(NOISE_MIN_CONF_KEY)) ?? 0.7,
    noiseMinSharpness: sharpness && sharpness > 0 ? sharpness : null, // off until a value is chosen
  };
}

export async function setClusteringSettings(update: { minSimilarity?: unknown; noiseMinConf?: unknown; noiseMinSharpness?: unknown }): Promise<void> {
  const sim = Number(update.minSimilarity);
  if (update.minSimilarity !== undefined && sim > 0 && sim <= 1) await storage.setAppSetting(MIN_SIMILARITY_KEY, String(sim));
  const conf = Number(update.noiseMinConf);
  if (update.noiseMinConf !== undefined && conf >= 0 && conf <= 1) await storage.setAppSetting(NOISE_MIN_CONF_KEY, String(conf));
  if (update.noiseMinSharpness !== undefined) {
    const sharp = update.noiseMinSharpness === null || update.noiseMinSharpness === "" ? 0 : Number(update.noiseMinSharpness);
    if (sharp >= 0) await storage.setAppSetting(NOISE_MIN_SHARPNESS_KEY, sharp > 0 ? String(sharp) : "");
  }
}

export type ClusteringSummary = {
  eligible: number;
  noise: Record<string, number>;
  clusters: number;
  clustered: number;
  singletons: number;
  top50Coverage: number; // share of eligible faces in the 50 largest clusters
  sizes: Record<string, number>; // cluster count per size bucket
  tookMs: number;
};

/** A face Face review could ask about: open, from a photo, in no named group. */
const open = sql`${faces.dismissedAt} IS NULL AND ${faces.photoId} IS NOT NULL AND ${faceGroupUnnamed}`;
// Text/jsonb values are checked before casting so one malformed row can't fail the run.
const confidence = sql`CASE WHEN ${faces.detectionConfidence} ~ '^[0-9]*\\.?[0-9]+$' THEN ${faces.detectionConfidence}::real END`;
const box = (side: "w" | "h") => sql`CASE WHEN jsonb_typeof(${faces.coordinates}->'${sql.raw(side)}') = 'number' THEN (${faces.coordinates}->>'${sql.raw(side)}')::real END`;

let running: Promise<ClusteringSummary> | null = null;

/** One run at a time; a second caller shares the running one. */
export function runFaceClustering(): Promise<ClusteringSummary> {
  running ??= clusterFaces().finally(() => {
    running = null;
  });
  return running;
}

async function clusterFaces(): Promise<ClusteringSummary> {
  const started = Date.now();
  const settings = await getClusteringSettings();

  // 1. Noise pre-filter: recompute the quality reason for open faces, and drop it from faces that are no longer open.
  const reason = sql`CASE
    WHEN LEAST(${box("w")}, ${box("h")}) < ${NOISE_MIN_PX} THEN 'small'
    WHEN ${confidence} < ${settings.noiseMinConf} THEN 'low_conf'
    WHEN ${settings.noiseMinSharpness}::real IS NOT NULL AND ${faces.sharpness} < ${settings.noiseMinSharpness}::real THEN 'blurry'
  END`;
  await db.execute(sql`
    WITH s AS (
      SELECT ${faces.id} AS id, CASE WHEN ${open} THEN ${reason} END AS reason
      FROM ${faces}
      WHERE ${faces.noiseReason} IN ${QUALITY_REASONS} OR (${open})
    )
    UPDATE faces SET noise_reason = s.reason FROM s
    WHERE faces.id = s.id AND faces.noise_reason IS DISTINCT FROM s.reason
      AND (s.reason IS NOT NULL OR faces.noise_reason IN ${QUALITY_REASONS})`);

  // 2. Eligible faces: open and not a quality reject ('singleton' was only last run's answer).
  const eligible = (
    await db.execute<{ id: string; grp: string | null }>(sql`
      SELECT ${faces.id} AS id, ${faces.personfaceUuid} AS grp FROM ${faces}
      WHERE ${open} AND (${faces.noiseReason} IS NULL OR ${faces.noiseReason} = 'singleton')`)
  ).rows;

  // 3. A dismissed pair of groups ("not the same person") must not meet in a cluster.
  const byGroup = new Map<string, string[]>();
  for (const f of eligible) {
    if (!f.grp) continue;
    const ids = byGroup.get(f.grp) ?? [];
    if (ids.length < CANNOT_LINK_PER_GROUP) byGroup.set(f.grp, [...ids, f.id]);
  }
  const cannotLink: [string, string][] = [];
  for (const d of await db.select().from(facePairDismissals)) {
    for (const x of byGroup.get(d.groupAUuid) ?? []) for (const y of byGroup.get(d.groupBUuid) ?? []) cannotLink.push([x, y]);
  }

  const response = await computeFetch(
    "/api/face/cluster",
    { face_ids: eligible.map((f) => f.id), cannot_link: cannotLink, min_similarity: settings.minSimilarity, k: NEIGHBOURS, min_cluster_size: MIN_CLUSTER_SIZE },
    300_000,
  );
  if (response.status === 404) throw new Error("PRM-Compute update required: it has no /api/face/cluster endpoint.");
  if (!response.ok) throw new Error(`PRM-Compute clustering failed (${response.status}): ${await response.text()}`);
  const result = (await response.json()) as { labels: Record<string, string | null>; medoids: Record<string, string> };

  // 4. Write the new run. Ids carry a run prefix so a stale id never matches a new cluster.
  const run = Date.now().toString(36);
  const rows = eligible.map((f) => ({ id: f.id, grp: f.grp, cluster: result.labels[f.id] ? `${run}-${result.labels[f.id]}` : null }));
  const medoids = Object.entries(result.medoids).map(([label, face]) => ({ cluster: `${run}-${label}`, face }));
  await db.transaction(async (tx) => {
    await tx.execute(sql`UPDATE faces SET cluster_id = NULL WHERE cluster_id IS NOT NULL`);
    await tx.execute(sql`UPDATE faces SET noise_reason = NULL WHERE noise_reason = 'singleton'`);
    // Guarded on what was read above: a face a person (or auto-assign) moved, dismissed or named meanwhile is skipped.
    await tx.execute(sql`
      UPDATE faces SET cluster_id = v.cluster, noise_reason = CASE WHEN v.cluster IS NULL THEN 'singleton' END
      FROM jsonb_to_recordset(${JSON.stringify(rows)}::jsonb) AS v(id text, grp text, cluster text)
      WHERE faces.id = v.id AND faces.personface_uuid IS NOT DISTINCT FROM v.grp
        AND faces.noise_reason IS NULL AND ${open}`);
    await tx.execute(sql`DELETE FROM face_clusters`);
    // The medoid falls back to the first montage face if the guard above left it out.
    await tx.execute(sql`
      INSERT INTO face_clusters (id, size, medoid_face_id, montage_face_ids)
      SELECT c.cluster_id, c.size, COALESCE(m.face, c.montage[1]), to_jsonb(c.montage[1:${sql.raw(String(MONTAGE_SIZE))}])
      FROM (
        SELECT cluster_id, count(*)::int AS size,
          array_agg(id ORDER BY (abs(yaw) <= 30) DESC NULLS LAST, sharpness DESC NULLS LAST, id) AS montage
        FROM faces WHERE cluster_id IS NOT NULL GROUP BY cluster_id
      ) c
      LEFT JOIN jsonb_to_recordset(${JSON.stringify(medoids)}::jsonb) AS m(cluster text, face text)
        ON m.cluster = c.cluster_id AND EXISTS (SELECT 1 FROM faces f WHERE f.id = m.face AND f.cluster_id = c.cluster_id)`);
  });

  // 5. Summary from what was actually written.
  const noiseRows = (await db.execute<{ reason: string; n: number }>(sql`
    SELECT noise_reason AS reason, count(*)::int AS n FROM faces WHERE noise_reason IS NOT NULL GROUP BY 1`)).rows;
  const sizes = (await db.execute<{ size: number }>(sql`SELECT size FROM face_clusters ORDER BY size DESC`)).rows.map((r) => r.size);
  const buckets: [number, string][] = [[500, "500+"], [100, "100-499"], [50, "50-99"], [20, "20-49"], [10, "10-19"], [5, "5-9"], [0, "3-4"]];
  const histogram: Record<string, number> = Object.fromEntries(buckets.map(([, name]) => [name, 0]).reverse());
  for (const s of sizes) histogram[buckets.find(([min]) => s >= min)![1]]++;
  const clustered = sizes.reduce((a, b) => a + b, 0);
  const summary: ClusteringSummary = {
    eligible: eligible.length,
    noise: Object.fromEntries(noiseRows.map((r) => [r.reason, r.n])),
    clusters: sizes.length,
    clustered,
    singletons: noiseRows.find((r) => r.reason === "singleton")?.n ?? 0,
    top50Coverage: eligible.length ? sizes.slice(0, 50).reduce((a, b) => a + b, 0) / eligible.length : 0,
    sizes: histogram,
    tookMs: Date.now() - started,
  };
  log(`[FaceCluster] ${JSON.stringify(summary)}`);
  return summary;
}

/** Daily run (15 minutes after start-up first); skipped while PRM-Compute isn't configured. */
export function startFaceClusteringScheduler(): void {
  const tick = async () => {
    if (!(await getComputeConnection())) return;
    await runFaceClustering().catch((err) => log(`[FaceCluster] scheduled run failed: ${err?.message ?? err}`));
  };
  setTimeout(tick, 15 * 60 * 1000);
  setInterval(tick, 24 * 60 * 60 * 1000);
}

// ── Review: suggestions and actions (face-clustering-plan.md §3.3, §3.4) ─────

const BANNER_MIN_SHARE = 0.85;
const BANNER_MIN_SOLO_POSTS = 5;

export type ClusterSuggestion = FaceReviewSuggestion & { photos: number; share: number; score?: number };
/** "Is this @x?": the owner's solo posts land here, or the account's profile picture is in the cluster. */
export type ClusterBanner = { suggestion: ClusterSuggestion; solo?: { hits: number; total: number } };
export type ClusterFace = { id: string; cropUrl: string };
export type ClusterCard = { id: string; size: number; faces: ClusterFace[]; suggestions: ClusterSuggestion[]; banner: ClusterBanner | null };

const identityKey = (s: { socialAccountId?: string; personId?: string }) => s.socialAccountId ?? s.personId ?? "";

export async function getClusterSummary() {
  const [row] = (await db.execute<{ clusters: number; faces: number; last_run_at: string | null }>(sql`
    SELECT count(DISTINCT cluster_id)::int AS clusters, count(cluster_id)::int AS faces,
      (SELECT max(created_at) FROM face_clusters) AS last_run_at
    FROM faces WHERE cluster_id IS NOT NULL`)).rows;
  const noise = (await db.execute<{ reason: string; n: number }>(sql`
    SELECT noise_reason AS reason, count(*)::int AS n FROM faces WHERE noise_reason IS NOT NULL AND ${open} GROUP BY 1`)).rows;
  return { clusters: row.clusters, faces: row.faces, noise: Object.fromEntries(noise.map((r) => [r.reason, r.n])), lastRunAt: row.last_run_at };
}

/** Largest clusters first, by live size (naming or dismissing faces shrinks a cluster until the next run). */
export async function listClusters(offset: number, limit: number): Promise<{ clusters: ClusterCard[]; nextOffset: number | null }> {
  const sizes = (await db.execute<{ id: string; size: number }>(sql`
    SELECT cluster_id AS id, count(*)::int AS size FROM faces WHERE cluster_id IS NOT NULL
    GROUP BY 1 ORDER BY 2 DESC, 1 LIMIT ${limit + 1} OFFSET ${offset}`)).rows;
  const page = sizes.slice(0, limit);
  const ids = page.map((c) => c.id);
  const [montages, suggestions] = await Promise.all([facesOfClusters(ids, true), clusterSuggestions(ids)]);
  return {
    clusters: page.map((c) => {
      const s = suggestions.get(c.id)!;
      return { id: c.id, size: c.size, faces: montages.get(c.id) ?? [], suggestions: s.suggestions.slice(0, 3), banner: s.banner };
    }),
    nextOffset: sizes.length > limit ? offset + limit : null,
  };
}

/** One cluster with every face it still holds; null once it's gone (named, dismissed or reclustered). */
export async function getCluster(id: string): Promise<ClusterCard | null> {
  const [all, suggestions] = await Promise.all([facesOfClusters([id], false), clusterSuggestions([id])]);
  const list = all.get(id);
  return list?.length ? { id, size: list.length, faces: list, ...suggestions.get(id)! } : null;
}

/** Faces still in each cluster: the montage only, or every face (montage faces first). */
async function facesOfClusters(ids: string[], montageOnly: boolean): Promise<Map<string, ClusterFace[]>> {
  const out = new Map<string, ClusterFace[]>();
  if (!ids.length) return out;
  const rows = (await db.execute<{ cluster: string; id: string; crop: string }>(sql`
    SELECT faces.cluster_id AS cluster, faces.id, faces.s3_url AS crop
    FROM faces LEFT JOIN face_clusters c ON c.id = faces.cluster_id
    LEFT JOIN LATERAL (SELECT m.ord FROM jsonb_array_elements_text(c.montage_face_ids) WITH ORDINALITY m(face, ord) WHERE m.face = faces.id) m ON true
    WHERE ${inArray(faces.clusterId, ids)} ${montageOnly ? sql`AND m.ord IS NOT NULL` : sql``}
    ORDER BY faces.cluster_id, m.ord NULLS LAST, faces.id`)).rows;
  for (const r of rows) out.set(r.cluster, [...(out.get(r.cluster) ?? []), { id: r.id, cropUrl: r.crop }]);
  return out;
}

/**
 * Ranked suggestions per cluster (§3.3): the per-photo Face review suggestions (owner, coauthors,
 * mentions, profile account, sender, participants) counted over the cluster's photos, plus the
 * named identity its medoid looks most like. A suggestion is dropped once half the cluster's
 * faces have been rejected for it.
 */
async function clusterSuggestions(ids: string[]): Promise<Map<string, { suggestions: ClusterSuggestion[]; banner: ClusterBanner | null }>> {
  const out = new Map<string, { suggestions: ClusterSuggestion[]; banner: ClusterBanner | null }>();
  if (!ids.length) return out;
  const faceRows = await db.select({ id: faces.id, cluster: faces.clusterId, photoId: faces.photoId }).from(faces).where(inArray(faces.clusterId, ids));
  const photoIds = Array.from(new Set(faceRows.map((f) => f.photoId).filter((p): p is string => !!p)));
  const photoRows = photoIds.length ? await db.select().from(photos).where(inArray(photos.id, photoIds)) : [];
  const photoById = new Map(photoRows.map((p) => [p.id, p]));
  const [byPhoto, rejections, medoids] = await Promise.all([
    photoSuggestions(photoRows),
    db.execute<{ cluster: string; identity: string; n: number }>(sql`
      SELECT faces.cluster_id AS cluster, r.identity_id AS identity, count(*)::int AS n
      FROM face_cluster_rejections r JOIN faces ON faces.id = r.face_id WHERE ${inArray(faces.clusterId, ids)} GROUP BY 1, 2`),
    db.select({ id: faceClusters.id, medoid: faceClusters.medoidFaceId }).from(faceClusters).where(inArray(faceClusters.id, ids)),
  ]);
  const lookAlikes = await lookAlikesFor(medoids.map((m) => m.medoid));
  const topLookAlike = (cluster: string) => lookAlikes.get(medoids.find((m) => m.id === cluster)?.medoid ?? "")?.[0];
  const lookAlikeIdentities = await buildIdentityCache(Array.from(new Set(ids.map(topLookAlike).filter((la) => !!la).map((la) => la!.personfaceUuid))));
  const rejected = new Map(rejections.rows.map((r) => [`${r.cluster}|${r.identity}`, r.n]));

  // Banner candidates are unlinked accounts; owners also need their solo-post totals.
  const accountIds = Array.from(new Set(Array.from(byPhoto.values()).flat().filter((s) => s.reason === "owner" || s.reason === "profile_account").map((s) => s.socialAccountId).filter((a): a is string => !!a)));
  const unlinked = accountIds.length
    ? (await db.select({ id: socialAccounts.id }).from(socialAccounts).where(and(inArray(socialAccounts.id, accountIds), isNull(socialAccounts.personfaceUuid)))).map((r) => r.id)
    : [];
  const soloTotals = new Map(unlinked.length ? (await db.execute<{ account: string; n: number }>(sql`
    SELECT social_account_posts.social_account_id AS account, count(*)::int AS n FROM social_account_posts
    JOIN photos p ON p.prm_location = 'post:' || social_account_posts.id
    WHERE ${inArray(socialAccountPosts.socialAccountId, unlinked)} AND jsonb_typeof(p.facial_ids) = 'array' AND jsonb_array_length(p.facial_ids) = 1
    GROUP BY 1`)).rows.map((r) => [r.account, r.n]) : []);

  for (const id of ids) {
    const members = faceRows.filter((f) => f.cluster === id);
    const clusterPhotos = Array.from(new Set(members.map((f) => f.photoId).filter((p): p is string => !!p)));
    const tally = new Map<string, { suggestion: FaceReviewSuggestion; photos: Set<string>; solo: number }>();
    for (const photoId of clusterPhotos) {
      const solo = ((photoById.get(photoId)?.facialIds ?? []) as FacialId[]).length === 1;
      for (const s of byPhoto.get(photoId) ?? []) {
        const t = tally.get(identityKey(s)) ?? { suggestion: s, photos: new Set<string>(), solo: 0 };
        t.photos.add(photoId);
        if (solo && s.reason === "owner") t.solo++;
        tally.set(identityKey(s), t);
      }
    }
    const keep = (s: { socialAccountId?: string; personId?: string }) => (rejected.get(`${id}|${identityKey(s)}`) ?? 0) * 2 < members.length;
    const suggestions: ClusterSuggestion[] = Array.from(tally.values())
      .map((t) => ({ ...t.suggestion, photos: t.photos.size, share: t.photos.size / (clusterPhotos.length || 1) }))
      .filter(keep)
      .sort((a, b) => b.photos - a.photos);

    const top = topLookAlike(id);
    const ident = top && lookAlikeIdentities.get(top.personfaceUuid);
    if (top && ident && keep(ident) && !suggestions.some((s) => identityKey(s) === identityKey(ident))) {
      suggestions.push({ ...ident, reason: "lookalike", photos: 0, share: 0, score: top.score });
    }

    // The solo-post banner wins over a profile-picture one.
    let banner: ClusterBanner | null = null;
    for (const s of suggestions) {
      if (!s.socialAccountId || !unlinked.includes(s.socialAccountId)) continue;
      const total = soloTotals.get(s.socialAccountId) ?? 0;
      const hits = tally.get(s.socialAccountId)?.solo ?? 0;
      if (s.reason === "owner" && total >= BANNER_MIN_SOLO_POSTS && hits / total >= BANNER_MIN_SHARE) {
        banner = { suggestion: s, solo: { hits, total } };
        break;
      }
      if (s.reason === "profile_account") banner ??= { suggestion: s };
    }
    out.set(id, { suggestions, banner });
  }
  return out;
}

/** `faceIds` (all the cluster's faces when omitted) must all still be in cluster `id`; else 409 so the client reloads. */
async function clusterFaceIds(id: string, faceIds?: string[]): Promise<string[]> {
  const live = new Set((await db.select({ id: faces.id }).from(faces).where(eq(faces.clusterId, id))).map((r) => r.id));
  const ids = faceIds ?? Array.from(live);
  if (!ids.length || ids.some((f) => !live.has(f))) throw new RecognitionRequestError(409, "This cluster changed; reload it.");
  return ids;
}

/** Name the cluster's faces (minus any the user excluded) as a person or account (§3.4). */
export async function nameCluster(id: string, faceIds: string[] | undefined, target: { personId?: string; socialAccountId?: string }) {
  return connectFaces(await clusterFaceIds(id, faceIds), target);
}

/** "No, not @x": remembered per face, so it survives reclustering. */
export async function rejectClusterSuggestion(id: string, identityId: string): Promise<void> {
  const ids = await clusterFaceIds(id);
  await db.insert(faceClusterRejections).values(ids.map((faceId) => ({ faceId, identityId }))).onConflictDoNothing();
}

/** Strangers: the existing "not someone I track" flag, undoable from the Dismissed filter. */
export async function dismissClusterFaces(id: string, faceIds?: string[]): Promise<{ dismissed: number }> {
  const ids = await clusterFaceIds(id, faceIds);
  await db.update(faces).set({ dismissedAt: new Date(), clusterId: null }).where(and(inArray(faces.id, ids), eq(faces.clusterId, id)));
  return { dismissed: ids.length };
}
