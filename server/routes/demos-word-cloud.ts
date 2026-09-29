/**
 * Word cloud demo data: bio text from every visible social account, for the
 * client-side word cloud engine (client/src/lib/wordcloud) to render.
 */
import type { Express } from "express";
import { sql } from "drizzle-orm";
import { socialAccounts } from "@shared/schema";
import { db } from "../db";
import { visibleShared } from "../access";

import { requireAuth } from "../auth";

export function registerRoutes(app: Express) {
  // GET /api/demos/word-cloud/bios — visible social account bios, non-empty only
  app.get("/api/demos/word-cloud/bios", requireAuth, async (req, res) => {
    try {
      const limit = req.query.limit ? Math.min(Math.max(Number(req.query.limit) || 1000, 1), 2000) : 1000;
      const rows = await db
        .select({ bio: socialAccounts.bio })
        .from(socialAccounts)
        .where(
          sql`${socialAccounts.bio} IS NOT NULL AND ${socialAccounts.bio} != '' AND (${
            visibleShared(socialAccounts.visibility, socialAccounts.createdByUserId) ?? sql`true`
          })`,
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
