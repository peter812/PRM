// The Faces page (face-review-plan.md §5): known identities — face groups
// already linked to a person and/or a social account — with search, merge,
// and the ability to pull a mistaken face back out of a group.
import type { Express } from "express";
import { requireAuth } from "../auth";
import { faceGroupUuid, getLikelySameFaces, identityIsVisible, knownFaceDetail, listKnownFaces } from "../faces";
import { dismissLikelySamePair } from "../face-lookalikes";
import { faceInReadablePhoto } from "./face-review";
import { disassociateFace, FaceMergeConflictError, mergeFaceGroups, RecognitionRequestError } from "../recognition";

export function registerFaces(app: Express) {
  app.get("/api/faces", requireAuth, async (req, res) => {
    try {
      const search = typeof req.query.search === "string" ? req.query.search : undefined;
      const sort = req.query.sort === "count" ? "count" : "recent";
      const cursor = typeof req.query.cursor === "string" ? req.query.cursor : undefined;
      const limit = req.query.limit ? Math.min(Math.max(Number(req.query.limit) || 20, 1), 100) : 20;
      const result = await listKnownFaces({ search, sort, cursor, limit });
      res.json(result);
    } catch (error) {
      console.error("Faces: list identities:", error);
      res.status(500).json({ error: "Failed to list faces" });
    }
  });

  app.get("/api/faces/likely-same", requireAuth, async (req, res) => {
    try {
      const limit = req.query.limit ? Math.min(Math.max(Number(req.query.limit) || 50, 1), 100) : 50;
      const pairs = await getLikelySameFaces({ limit });
      res.json({ pairs });
    } catch (error) {
      console.error("Faces: likely same identities:", error);
      res.status(500).json({ error: "Failed to get likely same faces" });
    }
  });

  app.post("/api/faces/likely-same/dismiss", requireAuth, async (req, res) => {
    try {
      const groupA = typeof req.body?.groupA === "string" ? req.body.groupA : undefined;
      const groupB = typeof req.body?.groupB === "string" ? req.body.groupB : undefined;
      if (!groupA || !groupB) return res.status(400).json({ error: "groupA and groupB are required" });
      await dismissLikelySamePair(groupA, groupB, req.user?.id);
      res.json({ ok: true });
    } catch (error) {
      console.error("Faces: dismiss likely same pair:", error);
      res.status(500).json({ error: "Failed to dismiss likely same pair" });
    }
  });

  app.get("/api/faces/:personfaceUuid", requireAuth, async (req, res) => {
    try {
      const detail = await knownFaceDetail(req.params.personfaceUuid);
      if (!detail) return res.status(404).json({ error: "Identity not found" });
      res.json(detail);
    } catch (error) {
      console.error("Faces: identity detail:", error);
      res.status(500).json({ error: "Failed to load identity" });
    }
  });

  app.post("/api/faces/remove-from-group", requireAuth, async (req, res) => {
    try {
      const faceUuid = typeof req.body?.faceUuid === "string" ? req.body.faceUuid : undefined;
      if (!faceUuid) return res.status(400).json({ error: "faceUuid is required" });
      const group = await faceGroupUuid(faceUuid);
      if (!group || !(await identityIsVisible(group)) || !(await faceInReadablePhoto(faceUuid))) return res.status(404).json({ error: "Face not found" });
      const result = await disassociateFace(faceUuid);
      res.json(result);
    } catch (error) {
      if (error instanceof RecognitionRequestError) return res.status(error.status).json({ error: error.message });
      console.error("Faces: remove from group:", error);
      res.status(500).json({ error: "Failed to remove face from group" });
    }
  });

  app.post("/api/faces/merge", requireAuth, async (req, res) => {
    try {
      const keep = typeof req.body?.keep === "string" ? req.body.keep : undefined;
      const merge = typeof req.body?.merge === "string" ? req.body.merge : undefined;
      if (!keep || !merge) return res.status(400).json({ error: "keep and merge are required" });
      if (keep === merge) return res.status(400).json({ error: "Cannot merge an identity with itself" });
      if (!(await identityIsVisible(keep)) || !(await identityIsVisible(merge))) {
        return res.status(404).json({ error: "Identity not found" });
      }
      await mergeFaceGroups(keep, merge);
      res.json({ ok: true });
    } catch (error) {
      if (error instanceof FaceMergeConflictError) return res.status(409).json({ error: error.message });
      if (error instanceof RecognitionRequestError) return res.status(error.status).json({ error: error.message });
      console.error("Faces: merge identities:", error);
      res.status(500).json({ error: "Failed to merge identities" });
    }
  });
}
