// Face review queue routes (face-review-plan.md §3.2-§3.5). Queries live in
// ../face-review.ts; assign delegates straight to connectFace (../recognition.ts)
// so the merge/re-point logic stays in one place.
import type { Express, Response } from "express";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "../db";
import { requireAuth } from "../auth";
import { storage } from "../storage";
import { triggerImageTaskWorker } from "../task-worker";
import { faces, imageTasks, people, socialAccounts } from "@shared/schema";
import {
  autoAssignFaces, clearedSuggestions, connectFace, disassociateFace, photosContainingFaces, getComputeConnection, JOB_TASK_TYPE,
  RecognitionRequestError, FaceMergeConflictError, type FacialId,
} from "../recognition";
import {
  FACE_REVIEW_KINDS, type FaceReviewKind,
  getFaceReviewCounts, getFaceReviewQueue, getFaceReviewItem, getReadablePhoto, accountForHandle,
} from "../face-review";
import {
  runFaceClustering, getClusterSummary, listClusters, getCluster, nameCluster, rejectClusterSuggestion, dismissClusterFaces, identityKey,
} from "../face-clusters";
import { listVerifyIdentities, getVerifyGroup, confirmVerify } from "../face-verify";

const fail = (res: Response, what: string, error: unknown) => {
  if (error instanceof RecognitionRequestError) {
    return res.status(error.status).json({ error: error.message });
  }
  if (error instanceof FaceMergeConflictError) {
    return res.status(409).json({ error: error.message });
  }
  console.error(`Face review: ${what}:`, error);
  res.status(500).json({ error: `Failed to ${what}` });
};

function parseKind(raw: unknown): FaceReviewKind | null {
  return typeof raw === "string" && (FACE_REVIEW_KINDS as string[]).includes(raw) ? (raw as FaceReviewKind) : null;
}

/**
 * Every face must be listed in a readable photo's facial_ids (§3): `photoId` when given, else
 * any photo holding it. Checked against facial_ids, not faces.photo_id, since identical images
 * share their faces (photosContainingFaces).
 */
export async function faceInReadablePhoto(faceUuids: string | string[], photoId?: string): Promise<boolean> {
  const ids = typeof faceUuids === "string" ? [faceUuids] : faceUuids;
  if (!ids.length) return false;
  const candidates = photoId ? [photoId] : Array.from(new Set((await photosContainingFaces(ids)).map((r) => r.photoId)));
  const photos = await Promise.all(candidates.map((id) => getReadablePhoto(id)));
  for (const photo of photos) {
    if (!photo) continue;
    const held = new Set(((photo.facialIds ?? []) as FacialId[]).map((f) => f.faceUuid));
    if (ids.every((u) => held.has(u))) return true;
  }
  return false;
}

/** `faceUuids` (Skip all) or a single `faceUuid`, as a validated non-empty list, else null. */
function parseFaceUuids(body: { faceUuid?: unknown; faceUuids?: unknown }): string[] | null {
  const ids = Array.isArray(body.faceUuids) ? body.faceUuids : [body.faceUuid];
  return ids.length && ids.every((id) => typeof id === "string") ? (ids as string[]) : null;
}

/** An optional `faceIds` body field: absent, or a non-empty list of strings (else null). */
function parseOptionalIds(raw: unknown): string[] | undefined | null {
  if (raw === undefined) return undefined;
  return Array.isArray(raw) && raw.length && raw.every((id) => typeof id === "string") ? raw : null;
}

/** The assign target (a person or a social account) must exist. */
async function targetReadable(socialAccountId?: string, personId?: string): Promise<boolean> {
  if (socialAccountId) {
    const [row] = await db
      .select({ id: socialAccounts.id })
      .from(socialAccounts)
      .where(eq(socialAccounts.id, socialAccountId));
    if (!row) return false;
  }
  if (personId) {
    const [row] = await db
      .select({ id: people.id })
      .from(people)
      .where(eq(people.id, personId));
    if (!row) return false;
  }
  return Boolean(socialAccountId || personId);
}

export function registerFaceReview(app: Express) {
  // ?kind=story|profile|post|message (required), ?dismissed=1, ?noise=1, ?cursor=, ?limit=
  app.get("/api/face-review", requireAuth, async (req, res) => {
    try {
      const kind = parseKind(req.query.kind);
      if (!kind) return res.status(400).json({ error: "kind must be one of story, profile, post, message" });
      const dismissed = req.query.dismissed === "1" || req.query.dismissed === "true";
      const cursor = typeof req.query.cursor === "string" ? req.query.cursor : undefined;
      const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100);
      const page = await getFaceReviewQueue(kind, dismissed, req.query.noise === "1", cursor, limit);
      res.json(page);
    } catch (error) {
      fail(res, "load face review queue", error);
    }
  });

  // ?noise=1 counts the quality-noise faces too.
  app.get("/api/face-review/counts", requireAuth, async (req, res) => {
    try {
      res.json(await getFaceReviewCounts(req.query.noise === "1"));
    } catch (error) {
      fail(res, "count face review queue", error);
    }
  });

  // Run auto-assign over every open face now (§8.2); it also runs hourly and after each recognition.
  app.post("/api/face-review/auto-assign", requireAuth, async (_req, res) => {
    try {
      res.json(await autoAssignFaces());
    } catch (error) {
      fail(res, "auto-assign faces", error);
    }
  });

  // Cluster open faces now (face-clustering-plan.md §3.2); it also runs daily.
  app.post("/api/face-review/cluster", requireAuth, async (_req, res) => {
    try {
      res.json(await runFaceClustering());
    } catch (error: any) {
      console.error("Face review: cluster faces:", error);
      res.status(500).json({ error: error?.message ?? "Failed to cluster faces" }); // says when compute needs updating
    }
  });

  // ── Clusters tab (face-clustering-plan.md §3.3-§3.4, §5) ──
  app.get("/api/face-review/cluster-summary", requireAuth, async (_req, res) => {
    try {
      res.json(await getClusterSummary());
    } catch (error) {
      fail(res, "load cluster summary", error);
    }
  });

  // ?offset=&limit= — largest clusters first.
  app.get("/api/face-review/clusters", requireAuth, async (req, res) => {
    try {
      const offset = Math.max(Number(req.query.offset) || 0, 0);
      const limit = Math.min(Math.max(Number(req.query.limit) || 24, 1), 60);
      res.json(await listClusters(offset, limit));
    } catch (error) {
      fail(res, "load clusters", error);
    }
  });

  app.get("/api/face-review/clusters/:id", requireAuth, async (req, res) => {
    try {
      const cluster = await getCluster(req.params.id);
      if (!cluster) return res.status(404).json({ error: "This cluster is gone; it was named, dismissed or reclustered." });
      res.json(cluster);
    } catch (error) {
      fail(res, "load cluster", error);
    }
  });

  // { faceIds?, socialAccountId? | personId? | username? } — faceIds omitted names every face in the
  // cluster; a bare username (a mention with no account yet) gets its account created first.
  app.post("/api/face-review/clusters/:id/name", requireAuth, async (req, res) => {
    try {
      const { personId, username } = req.body ?? {};
      const socialAccountId = req.body?.socialAccountId ?? (!personId && typeof username === "string" ? await accountForHandle(username) : undefined);
      const faceIds = parseOptionalIds(req.body?.faceIds);
      if (faceIds === null) return res.status(400).json({ error: "faceIds must be a non-empty list" });
      res.json(await nameCluster(req.params.id, faceIds, { socialAccountId, personId }));
    } catch (error) {
      fail(res, "name cluster", error);
    }
  });

  // { socialAccountId | personId | username } — "No, not them" for a suggestion.
  app.post("/api/face-review/clusters/:id/reject", requireAuth, async (req, res) => {
    try {
      const identityId = identityKey(req.body ?? {});
      if (typeof identityId !== "string" || !identityId) return res.status(400).json({ error: "socialAccountId, personId or username is required" });
      await rejectClusterSuggestion(req.params.id, identityId);
      res.json({ ok: true });
    } catch (error) {
      fail(res, "reject cluster suggestion", error);
    }
  });

  // { faceIds? } — Strangers: dismiss the cluster's faces (all when faceIds is omitted).
  app.post("/api/face-review/clusters/:id/strangers", requireAuth, async (req, res) => {
    try {
      const faceIds = parseOptionalIds(req.body?.faceIds);
      if (faceIds === null) return res.status(400).json({ error: "faceIds must be a non-empty list" });
      res.json(await dismissClusterFaces(req.params.id, faceIds));
    } catch (error) {
      fail(res, "dismiss cluster faces", error);
    }
  });

  // ── Verify tab (face-clustering-plan.md §4) ──
  app.get("/api/face-review/verify", requireAuth, async (_req, res) => {
    try {
      res.json(await listVerifyIdentities());
    } catch (error) {
      fail(res, "load verify list", error);
    }
  });

  app.get("/api/face-review/verify/:group", requireAuth, async (req, res) => {
    try {
      const group = await getVerifyGroup(req.params.group);
      if (!group) return res.status(404).json({ error: "This identity is gone." });
      res.json(group);
    } catch (error) {
      fail(res, "load verify faces", error);
    }
  });

  // { confirm: faceIds, reject: faceIds } — Confirm all, minus the deselected faces.
  app.post("/api/face-review/verify/:group/confirm", requireAuth, async (req, res) => {
    try {
      const ids = (raw: unknown) => (raw === undefined || (Array.isArray(raw) && !raw.length) ? [] : parseOptionalIds(raw));
      const confirm = ids(req.body?.confirm);
      const reject = ids(req.body?.reject);
      if (!confirm || !reject) return res.status(400).json({ error: "confirm and reject must be lists of face ids" });
      res.json(await confirmVerify(req.params.group, confirm, reject));
    } catch (error) {
      fail(res, "confirm verify faces", error);
    }
  });

  // { faceUuid, photoId, kind, socialAccountId?, personId? } — same identity resolution as
  // /api/prm-face/face/connect (connectFace), returning the refreshed FaceReviewItem for the photo.
  app.post("/api/face-review/assign", requireAuth, async (req, res) => {
    try {
      const { faceUuid, photoId, kind, personId, username } = req.body ?? {};
      let { socialAccountId } = req.body ?? {};
      const k = parseKind(kind);
      if (typeof faceUuid !== "string" || typeof photoId !== "string" || !k) return res.status(400).json({ error: "faceUuid, photoId and kind are required" });
      if (!socialAccountId && !personId && typeof username !== "string") return res.status(400).json({ error: "socialAccountId, personId or username is required" });
      if (!(await faceInReadablePhoto(faceUuid, photoId))) return res.status(404).json({ error: "Photo not found" });
      // A mention with no account yet: create it, then name the face as it.
      if (!socialAccountId && !personId) socialAccountId = await accountForHandle(username);
      if (!(await targetReadable(socialAccountId, personId))) return res.status(404).json({ error: "Target not found" });
      await connectFace({ faceUuid, socialAccountId, personId });
      const item = await getFaceReviewItem(photoId, k);
      if (!item) return res.status(404).json({ error: "Photo not found" });
      res.json(item);
    } catch (error) {
      fail(res, "assign face", error);
    }
  });

  // ?photoId=&kind= — one photo's item, refetched after a re-scan replaces its faces.
  app.get("/api/face-review/item", requireAuth, async (req, res) => {
    try {
      const k = parseKind(req.query.kind);
      if (typeof req.query.photoId !== "string" || !k) return res.status(400).json({ error: "photoId and kind are required" });
      const item = await getFaceReviewItem(req.query.photoId, k);
      if (!item) return res.status(404).json({ error: "Photo not found" });
      res.json(item);
    } catch (error) {
      fail(res, "load face review item", error);
    }
  });

  // { photoId } — queue a from-scratch face scan (rescanPhotoFaces); answers { taskId } to follow
  // via /api/image-tasks/:id. A face task already pending or running for the photo is reused.
  app.post("/api/face-review/rescan", requireAuth, async (req, res) => {
    try {
      const { photoId } = req.body ?? {};
      if (typeof photoId !== "string") return res.status(400).json({ error: "photoId is required" });
      if (!(await getReadablePhoto(photoId))) return res.status(404).json({ error: "Photo not found" });
      if (!(await getComputeConnection())) return res.status(400).json({ error: "PRM Compute service is not configured." });
      const [live] = await db
        .select({ id: imageTasks.id })
        .from(imageTasks)
        .where(and(eq(imageTasks.photoId, photoId), eq(imageTasks.type, JOB_TASK_TYPE.face), inArray(imageTasks.status, ["pending", "in_progress"])));
      const task = live ?? (await storage.createImageTask({ type: JOB_TASK_TYPE.face, photoId, payload: JSON.stringify({ photoId, rescan: true }) }));
      triggerImageTaskWorker();
      res.json({ taskId: task.id });
    } catch (error) {
      fail(res, "queue face re-scan", error);
    }
  });

  // { faceUuid, photoId, kind } — the ✕ on a named face box (§8.4): unlink it from its identity
  // (remembered, so auto-assign won't re-pick it) and return the refreshed item.
  app.post("/api/face-review/unassign", requireAuth, async (req, res) => {
    try {
      const { faceUuid, photoId, kind } = req.body ?? {};
      const k = parseKind(kind);
      if (typeof faceUuid !== "string" || typeof photoId !== "string" || !k) return res.status(400).json({ error: "faceUuid, photoId and kind are required" });
      if (!(await faceInReadablePhoto(faceUuid, photoId))) return res.status(404).json({ error: "Photo not found" });
      await disassociateFace(faceUuid);
      const item = await getFaceReviewItem(photoId, k);
      if (!item) return res.status(404).json({ error: "Photo not found" });
      res.json(item);
    } catch (error) {
      fail(res, "remove face name", error);
    }
  });

  // { faceUuid | faceUuids, photoId, kind } — "not someone I track" (§3.4); faceUuids for Skip all.
  // /undismiss takes the same body and reverses it.
  for (const [path, dismissedAt] of [["dismiss", () => new Date()], ["undismiss", () => null]] as const) {
    app.post(`/api/face-review/${path}`, requireAuth, async (req, res) => {
      try {
        const { photoId, kind } = req.body ?? {};
        const ids = parseFaceUuids(req.body ?? {});
        const k = parseKind(kind);
        if (!ids || typeof photoId !== "string" || !k) return res.status(400).json({ error: "faceUuid (or faceUuids), photoId and kind are required" });
        if (!(await faceInReadablePhoto(ids, photoId))) return res.status(404).json({ error: "Photo not found" });
        await db.update(faces).set({ dismissedAt: dismissedAt(), ...clearedSuggestions }).where(inArray(faces.id, ids));
        const item = await getFaceReviewItem(photoId, k);
        if (!item) return res.status(404).json({ error: "Photo not found" });
        res.json(item);
      } catch (error) {
        fail(res, `${path} face`, error);
      }
    });
  }
}
