// Events route module - events.ts
//
// Read access plus seen/acknowledged marking for the events table, and the
// Event Log demo's clear endpoint. Producers live in ../events.ts;
// the AI-agent side is future work.
import type { Express } from "express";
import { desc, eq, sql } from "drizzle-orm";
import { events } from "@shared/schema";
import { db } from "../db";
import { requireAuth } from "../auth";
import { logEntry } from "../events";

const MARKS = { seen: "seenAt", acknowledged: "acknowledgedAt" } as const;

export function registerRoutes(app: Express) {
  // GET /api/events — every event, newest first; the client nests sub-events under parentEventId
  app.get("/api/events", requireAuth, async (_req, res) => {
    try {
      res.json(await db.select().from(events).orderBy(desc(events.createdAt)));
    } catch (error) {
      console.error("Error fetching events:", error);
      res.status(500).json({ error: "Failed to fetch events" });
    }
  });

  // PATCH /api/events/:id/seen | /acknowledged — first mark wins; later calls are no-ops
  app.patch("/api/events/:id/:mark", requireAuth, async (req, res) => {
    const field = MARKS[req.params.mark as keyof typeof MARKS];
    if (!field) return res.status(404).json({ error: "Unknown mark" });
    try {
      const entry = JSON.stringify([logEntry(req.params.mark)]);
      const [row] = await db
        .update(events)
        .set({
          [field]: sql`now()`,
          updatedAt: sql`now()`,
          log: sql`${events.log} || ${entry}::jsonb`,
        })
        .where(sql`${events.id} = ${req.params.id} AND ${events[field]} IS NULL`)
        .returning();
      if (row) return res.json(row);
      const [existing] = await db.select().from(events).where(eq(events.id, req.params.id));
      if (!existing) return res.status(404).json({ error: "Event not found" });
      res.json(existing);
    } catch (error) {
      console.error("Error marking event:", error);
      res.status(500).json({ error: "Failed to mark event" });
    }
  });

  // DELETE /api/demos/events — wipe the table so the demo can start over
  app.delete("/api/demos/events", requireAuth, async (_req, res) => {
    try {
      await db.delete(events);
      res.status(204).end();
    } catch (error) {
      console.error("Error clearing events:", error);
      res.status(500).json({ error: "Failed to clear events" });
    }
  });
}
