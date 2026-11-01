// The Faces page (face-review-plan.md §5): known identities — face groups
// already linked to a person and/or a social account — with search, merge,
// and the ability to pull a mistaken face back out of a group.
import type { Express } from "express";
import { inArray } from "drizzle-orm";
import { db } from "../db";
import { faces } from "@shared/schema";
import { requireAuth } from "../auth";
import { faceGroupUuid, getLikelySameFaces, identityIsVisible, knownFaceDetail, listKnownFaces } from "../faces";
import { dismissLikelySamePair } from "../face-lookalikes";
import { faceInReadablePhoto } from "./face-review";
import { disassociateFace, disassociateFaces, disassociateGroup, FaceMergeConflictError, mergeFaceGroups, RecognitionRequestError } from "../recognition";
import { getAccountFaceCounts, getAccountHolder, getLooseFaces, getPeopleSeen, getPersonSeenFaces, keepAutoFace, resolveOwnerConflict, setAccountHolderFace, type OwnerResolution } from "../account-faces";

export function registerFaces(app: Express) {
  // The social account page's Faces tab (account-faces-plan.md §4): its sidebar badge.
  app.get("/api/social-accounts/:id/faces/counts", requireAuth, async (req, res) => {
    try {
      const counts = await getAccountFaceCounts(req.params.id);
      if (!counts) return res.status(404).json({ error: "Social account not found" });
      res.json(counts);
    } catch (error) {
      console.error("Faces: account counts:", error);
      res.status(500).json({ error: "Failed to count account faces" });
    }
  });

  app.get("/api/social-accounts/:id/faces/holder", requireAuth, async (req, res) => {
    try {
      const holder = await getAccountHolder(req.params.id);
      if (!holder) return res.status(404).json({ error: "Social account not found" });
      res.json(holder);
    } catch (error) {
      console.error("Faces: account holder:", error);
      res.status(500).json({ error: "Failed to load the account holder's face" });
    }
  });

  app.post("/api/social-accounts/:id/faces/holder", requireAuth, async (req, res) => {
    try {
      const faceUuid = typeof req.body?.faceUuid === "string" ? req.body.faceUuid : undefined;
      if (!faceUuid) return res.status(400).json({ error: "faceUuid is required" });
      await setAccountHolderFace(req.params.id, faceUuid);
      res.json({ ok: true });
    } catch (error) {
      if (error instanceof RecognitionRequestError) return res.status(error.status).json({ error: error.message });
      console.error("Faces: set account holder face:", error);
      res.status(500).json({ error: "Failed to set the account holder's face" });
    }
  });

  // §2.3: the account's face vs its owner person's face.
  app.post("/api/social-accounts/:id/faces/owner", requireAuth, async (req, res) => {
    try {
      const actions: OwnerResolution[] = ["use-account", "use-owner", "merge", "keep-apart"];
      const action = actions.find((a) => a === req.body?.action);
      if (!action) return res.status(400).json({ error: `action must be one of ${actions.join(", ")}` });
      await resolveOwnerConflict(req.params.id, action);
      res.json({ ok: true });
    } catch (error) {
      if (error instanceof FaceMergeConflictError) return res.status(409).json({ error: error.message });
      if (error instanceof RecognitionRequestError) return res.status(error.status).json({ error: error.message });
      console.error("Faces: resolve account owner face:", error);
      res.status(500).json({ error: "Failed to resolve the owner's face" });
    }
  });

  // Other faces → People seen (§3.1), and one row's faces.
  app.get("/api/social-accounts/:id/faces/people", requireAuth, async (req, res) => {
    try {
      const people = await getPeopleSeen(req.params.id);
      if (!people) return res.status(404).json({ error: "Social account not found" });
      res.json({ people });
    } catch (error) {
      console.error("Faces: account people seen:", error);
      res.status(500).json({ error: "Failed to list people seen" });
    }
  });

  app.get("/api/social-accounts/:id/faces/people/:group", requireAuth, async (req, res) => {
    try {
      const faces = await getPersonSeenFaces(req.params.id, req.params.group);
      if (!faces) return res.status(404).json({ error: "Social account not found" });
      res.json({ faces });
    } catch (error) {
      console.error("Faces: account person seen faces:", error);
      res.status(500).json({ error: "Failed to load that person's faces" });
    }
  });

  // ?offset=&limit=&noise=1 — Other faces → loose faces (§3.3): in-scope open faces in no cluster.
  app.get("/api/social-accounts/:id/faces/loose", requireAuth, async (req, res) => {
    try {
      const offset = Math.max(Number(req.query.offset) || 0, 0);
      const limit = Math.min(Math.max(Number(req.query.limit) || 48, 1), 120);
      const loose = await getLooseFaces(req.params.id, offset, limit, req.query.noise === "1");
      if (!loose) return res.status(404).json({ error: "Social account not found" });
      res.json(loose);
    } catch (error) {
      console.error("Faces: account loose faces:", error);
      res.status(500).json({ error: "Failed to list loose faces" });
    }
  });

  // An auto-assigned face is right: keep it in its group as confirmed.
  app.post("/api/faces/keep", requireAuth, async (req, res) => {
    try {
      const faceUuids: string[] = Array.isArray(req.body?.faceUuids)
        ? req.body.faceUuids.filter((id: unknown): id is string => typeof id === "string" && id.length > 0)
        : typeof req.body?.faceUuid === "string"
          ? [req.body.faceUuid]
          : [];
      if (!faceUuids.length) return res.status(400).json({ error: "faceUuid or faceUuids is required" });
      const faceRows = await db.select({ id: faces.id, group: faces.personfaceUuid }).from(faces).where(inArray(faces.id, faceUuids));
      if (faceRows.length !== faceUuids.length || faceRows.some((r) => !r.group)) return res.status(404).json({ error: "Face not found" });
      const groups = Array.from(new Set(faceRows.map((r) => r.group).filter((g): g is string => !!g)));
      for (const group of groups) {
        if (!(await identityIsVisible(group))) return res.status(404).json({ error: "Face not found" });
      }
      if (!(await faceInReadablePhoto(faceUuids))) return res.status(404).json({ error: "Face not found" });
      await keepAutoFace(faceUuids);
      res.json({ ok: true });
    } catch (error) {
      console.error("Faces: keep auto face:", error);
      res.status(500).json({ error: "Failed to keep the face" });
    }
  });

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
      await dismissLikelySamePair(groupA, groupB);
      res.json({ ok: true });
    } catch (error) {
      console.error("Faces: dismiss likely same pair:", error);
      res.status(500).json({ error: "Failed to dismiss likely same pair" });
    }
  });

  app.get("/api/faces/:personfaceUuid", requireAuth, async (req, res) => {
    try {
      const cursor = typeof req.query.cursor === "string" ? req.query.cursor : undefined;
      const limit = req.query.limit ? Math.min(Math.max(Number(req.query.limit) || 15, 1), 100) : 15;
      const detail = await knownFaceDetail(req.params.personfaceUuid, { cursor, limit });
      if (!detail) return res.status(404).json({ error: "Identity not found" });
      res.json(detail);
    } catch (error) {
      console.error("Faces: identity detail:", error);
      res.status(500).json({ error: "Failed to load identity" });
    }
  });

  app.post("/api/faces/remove-from-group", requireAuth, async (req, res) => {
    try {
      const faceUuids: string[] = Array.isArray(req.body?.faceUuids)
        ? req.body.faceUuids.filter((id: unknown): id is string => typeof id === "string" && id.length > 0)
        : typeof req.body?.faceUuid === "string"
          ? [req.body.faceUuid]
          : [];
      if (!faceUuids.length) return res.status(400).json({ error: "faceUuid or faceUuids is required" });
      const faceRows = await db.select({ id: faces.id, group: faces.personfaceUuid }).from(faces).where(inArray(faces.id, faceUuids));
      if (faceRows.length !== faceUuids.length || faceRows.some((r) => !r.group)) return res.status(404).json({ error: "Face not found" });
      const groups = Array.from(new Set(faceRows.map((r) => r.group).filter((g): g is string => !!g)));
      for (const group of groups) {
        if (!(await identityIsVisible(group))) return res.status(404).json({ error: "Face not found" });
      }
      if (!(await faceInReadablePhoto(faceUuids))) return res.status(404).json({ error: "Face not found" });
      const result = await disassociateFaces(faceUuids);
      res.json({ ok: true, newGroupUuid: result.newGroupUuids[0], newGroupUuids: result.newGroupUuids, count: result.count });
    } catch (error) {
      if (error instanceof RecognitionRequestError) return res.status(error.status).json({ error: error.message });
      console.error("Faces: remove from group:", error);
      res.status(500).json({ error: "Failed to remove face from group" });
    }
  });

  app.post("/api/faces/remove-all-from-group", requireAuth, async (req, res) => {
    try {
      const personfaceUuid = typeof req.body?.personfaceUuid === "string" ? req.body.personfaceUuid : undefined;
      if (!personfaceUuid) return res.status(400).json({ error: "personfaceUuid is required" });
      if (!(await identityIsVisible(personfaceUuid))) return res.status(404).json({ error: "Identity not found" });
      res.json(await disassociateGroup(personfaceUuid));
    } catch (error) {
      if (error instanceof RecognitionRequestError) return res.status(error.status).json({ error: error.message });
      console.error("Faces: remove all from group:", error);
      res.status(500).json({ error: "Failed to unassociate faces" });
    }
  });

  app.post("/api/faces/merge",requireAuth, async (req, res) => {
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
