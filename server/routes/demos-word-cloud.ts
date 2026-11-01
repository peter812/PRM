/**
 * Word cloud demo data: bio text from every visible social account, and the image
 * summary word counts (server/image-summary-word-cloud.ts), for the
 * client-side word cloud engine (client/src/lib/wordcloud) to render.
 */
import type { Express } from "express";
import { sql } from "drizzle-orm";
import { socialAccounts } from "@shared/schema";
import { db } from "../db";
import { getLatestRun, startRun } from "../image-summary-word-cloud";

import { requireAuth } from "../auth";

export function registerRoutes(app: Express) {
  // GET /api/demos/word-cloud/image-summaries — latest counting run's progress plus the last finished word counts
  app.get("/api/demos/word-cloud/image-summaries", requireAuth, async (_req, res) => {
    try {
      res.json(await getLatestRun());
    } catch (error) {
      console.error("Error loading image summary word cloud:", error);
      res.status(500).json({ error: "Failed to load image summary word counts" });
    }
  });

  // POST /api/demos/word-cloud/image-summaries/run — start counting every image summary (no-op while one is running)
  app.post("/api/demos/word-cloud/image-summaries/run", requireAuth, async (_req, res) => {
    try {
      res.json({ id: await startRun() });
    } catch (error) {
      console.error("Error starting image summary word count:", error);
      res.status(500).json({ error: "Failed to start word count" });
    }
  });

  // GET /api/demos/word-cloud/bios — visible social account bios, non-empty only
  app.get("/api/demos/word-cloud/bios", requireAuth, async (req, res) => {
    try {
      const limit = req.query.limit ? Math.min(Math.max(Number(req.query.limit) || 1000, 1), 2000) : 1000;
      const rows = await db
        .select({ bio: socialAccounts.bio })
        .from(socialAccounts)
        .where(
          sql`${socialAccounts.bio} IS NOT NULL AND ${socialAccounts.bio} != ''`,
        )
        .limit(limit);

      res.json({
        count: rows.length,
        text: rows.map((r) => r.bio).join("\n"),
      });
    } catch (error) {
      console.error("Error loading bio word cloud data:", error);
      res.status(500).json({ error: "Failed to load bios" });
    }
  });
}
