/**
 * Roster import demo (yearbook / playbill pages). Analyze takes the page image
 * directly (multipart `image`); commit saves the reviewed faces as references.
 * Analyze with `dryRun=true` stores nothing anywhere and returns debug output;
 * `aiRefine=true` adds the grounded vision-model correction pass.
 */
import type { Express } from "express";
import multer from "multer";
import { z } from "zod";
import { AiConfigError } from "../ai/provider";
import { RecognitionRequestError } from "../recognition";
import { ROSTER_LAYOUTS, ROSTER_SUBTYPES, analyzeRoster, commitRoster } from "../roster-import";
import { sendReferenceError } from "./references";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

const locationSchema = z.object({ type: z.string().trim().min(1, "Location type is required") })
  .catchall(z.string().optional())
  .transform((loc) => Object.fromEntries(Object.entries(loc).map(([k, v]) => [k, v?.trim()]).filter(([, v]) => v)) as { type: string });

const commitSchema = z.object({
  location: locationSchema,
  entries: z.array(z.object({
    referenceUuid: z.string().min(1),
    cropUrl: z.string().min(1),
    name: z.string().optional(),
    role: z.string().optional(),
    bio: z.string().optional(),
  })),
  discard: z.array(z.string().min(1)).default([]),
});

function sendError(res: any, error: any, fallback: string) {
  if (error instanceof AiConfigError) return res.status(400).json({ error: error.message });
  if (error instanceof RecognitionRequestError) return res.status(error.status).json({ error: error.message });
  sendReferenceError(res, error, fallback);
}

export function registerRoutes(app: Express) {
  app.post("/api/roster-import/analyze", upload.single("image"), async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: "No page image uploaded" });
      const layout = z.enum(ROSTER_LAYOUTS).parse(req.body.layout);
      const subtypes = ROSTER_SUBTYPES[layout].map((s) => s.value);
      const subtype = z.string().refine((s) => subtypes.includes(s), `Subtype must be one of: ${subtypes.join(", ")}`)
        .parse(req.body.subtype || subtypes[0]);
      res.json(await analyzeRoster(req.file.buffer, layout, subtype, { dryRun: req.body.dryRun === "true", aiRefine: req.body.aiRefine === "true" }));
    } catch (error) {
      sendError(res, error, "Failed to analyze the page");
    }
  });

  app.post("/api/roster-import/commit", async (req, res) => {
    try {
      const { location, entries, discard } = commitSchema.parse(req.body);
      res.json({ saved: await commitRoster(location, entries, discard) });
    } catch (error) {
      sendError(res, error, "Failed to save references");
    }
  });
}
