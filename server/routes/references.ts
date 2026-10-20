/** References: list/filter, search by face, delete all. Created by the roster import (routes/roster-import.ts). */
import type { Express } from "express";
import multer from "multer";
import { z } from "zod";
import { ComputeBusyError, ComputeUnreachableError } from "../recognition";
import { deleteAllReferences, listReferences, searchReferences } from "../references";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

export function sendReferenceError(res: any, error: any, fallback: string) {
  if (error instanceof z.ZodError) return res.status(400).json({ error: error.errors.map((e) => e.message).join("; ") });
  if (error instanceof ComputeUnreachableError || error instanceof ComputeBusyError) return res.status(503).json({ error: error.message });
  console.error(fallback, error);
  res.status(500).json({ error: error?.message || fallback });
}

const listSchema = z.object({
  name: z.string().optional(),
  q: z.string().optional(),
  type: z.string().optional(),
  sort: z.enum(["newest", "oldest"]).optional(),
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(200).optional(),
});

const searchSchema = z.union([
  z.object({ faceUuid: z.string().min(1) }),
  z.object({ personId: z.string().min(1) }),
  z.object({ referenceId: z.string().min(1) }),
]);

export function registerRoutes(app: Express) {
  app.get("/api/references", async (req, res) => {
    try {
      res.json(await listReferences(listSchema.parse(req.query)));
    } catch (error) {
      sendReferenceError(res, error, "Failed to list references");
    }
  });

  /** Multipart `image`, or JSON { faceUuid } | { personId } | { referenceId }. */
  app.post("/api/references/search", upload.single("image"), async (req, res) => {
    try {
      const probe = req.file
        ? { image: req.file.buffer, mimeType: req.file.mimetype, fileName: req.file.originalname }
        : searchSchema.parse(req.body);
      res.json(await searchReferences(probe));
    } catch (error) {
      sendReferenceError(res, error, "Failed to search references");
    }
  });

  app.delete("/api/references/all", async (_req, res) => {
    try {
      res.json(await deleteAllReferences());
    } catch (error) {
      sendReferenceError(res, error, "Failed to delete references");
    }
  });
}
