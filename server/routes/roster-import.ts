/**
 * Roster import demo (yearbook / playbill pages). The page is uploaded first via
 * POST /api/upload-image (prmLocation "roster_import"); these routes take its photoId.
 */
import type { Express } from "express";
import { z } from "zod";
import { AiConfigError } from "../ai/provider";
import { ComputeBusyError, ComputeUnreachableError, RecognitionRequestError } from "../recognition";
import { ROSTER_LAYOUTS, analyzeRoster, commitRoster, matchPerson, missingContext } from "../roster-import";

const contextSchema = z.object({
  school: z.string().optional(), yearbookYear: z.string().optional(), grade: z.string().optional(),
  branch: z.string().optional(), year: z.string().optional(), quarter: z.string().optional(), production: z.string().optional(),
});
const boxSchema = z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() });
const baseSchema = z.object({ photoId: z.string().min(1), layout: z.enum(ROSTER_LAYOUTS), context: contextSchema });

function sendError(res: any, error: any, fallback: string) {
  if (error instanceof z.ZodError) return res.status(400).json({ error: error.errors.map((e) => e.message).join("; ") });
  if (error instanceof AiConfigError) return res.status(400).json({ error: error.message });
  if (error instanceof RecognitionRequestError) return res.status(error.status).json({ error: error.message });
  if (error instanceof ComputeUnreachableError || error instanceof ComputeBusyError) return res.status(503).json({ error: error.message });
  console.error(fallback, error);
  res.status(500).json({ error: error?.message || fallback });
}

export function registerRoutes(app: Express) {
  app.post("/api/roster-import/analyze", async (req, res) => {
    try {
      const { photoId, layout, context } = baseSchema.parse(req.body);
      const missing = missingContext(layout, context);
      if (missing.length) return res.status(400).json({ error: `Missing: ${missing.join(", ")}` });
      res.json(await analyzeRoster(photoId, layout, context));
    } catch (error) {
      sendError(res, error, "Failed to analyze the page");
    }
  });

  app.post("/api/roster-import/match", async (req, res) => {
    try {
      const { layout, context, firstName, lastName } = baseSchema.omit({ photoId: true })
        .extend({ firstName: z.string(), lastName: z.string() }).parse(req.body);
      res.json(await matchPerson(layout, context, firstName, lastName));
    } catch (error) {
      sendError(res, error, "Failed to match the name");
    }
  });

  app.post("/api/roster-import/commit", async (req, res) => {
    try {
      const { photoId, layout, context, entries } = baseSchema.extend({
        entries: z.array(z.object({
          faceUuid: z.string().min(1),
          box: boxSchema,
          firstName: z.string().trim().min(1, "Every imported face needs a first name"),
          lastName: z.string(),
          bio: z.string().optional(),
          personId: z.string().nullable().optional(),
        })).min(1, "Nothing to import"),
      }).parse(req.body);
      const missing = missingContext(layout, context);
      if (missing.length) return res.status(400).json({ error: `Missing: ${missing.join(", ")}` });
      res.json(await commitRoster(photoId, layout, context, entries));
    } catch (error) {
      sendError(res, error, "Failed to import people");
    }
  });
}
