// Events route module - events.ts
//
// Read access plus seen/acknowledged marking for the events table, and the
// Event Log demo's generate/clear endpoints. Producers live in ../events.ts;
// the AI-agent side is future work.
import type { Express } from "express";
import { desc, eq, sql } from "drizzle-orm";
import { events, type InsertEvent } from "@shared/schema";
import { db } from "../db";
import { requireAuth } from "../auth";
import { logEntry, nextStepsXml } from "../events";

const MARKS = { seen: "seenAt", acknowledged: "acknowledgedAt" } as const;

// Generic demo events: [type, title, subTitle, data, sub-events, nextSteps]
const DEMO_EVENTS: [string, string, string, unknown, [string, string, string][], string?][] = [
  ["instagram_post_deleted", "Instagram post deleted", "@jane.doe removed a post from 3 days ago",
    { postId: "demo-post-1", caption: "Sunset at the lake", postedAt: "3 days ago" }, [],
    nextStepsXml("Check whether the post was archived or deleted", "Keep the saved copy in post history")],
  ["unfollow", "3 unfollows", "@sam_k unfollowed 3 accounts you track", { username: "sam_k" }, [
    ["unfollow", "Unfollowed @alex.r", "No longer following"],
    ["unfollow", "Unfollowed @mia_lee", "No longer following"],
    ["unfollow", "Unfollowed @chris.b", "No longer following"],
  ], nextStepsXml("Review connection strength between @sam_k and each account")],
  ["bio_changed", "Bio changed", "@taylor.m updated their bio",
    { before: "Coffee & code", after: "Moved to Denver ☀️" }, []],
  ["profile_pic_changed", "Profile picture changed", "@jordan_p has a new profile picture", {}, []],
  ["follow", "New follows", "@jane.doe followed 2 new accounts", { username: "jane.doe" }, [
    ["follow", "Followed @river.k", "New follow"],
    ["follow", "Followed @dana.s", "New follow"],
  ]],
];

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

  // POST /api/demos/events/generate — insert the generic demo events (some with sub-events)
  app.post("/api/demos/events/generate", requireAuth, async (_req, res) => {
    try {
      let count = 0;
      await db.transaction(async (tx) => {
        for (const [type, title, subTitle, data, subs, nextSteps] of DEMO_EVENTS) {
          const [parent] = await tx
            .insert(events)
            .values({ type, title, subTitle, nextSteps, log: [logEntry("created", { data })] })
            .returning({ id: events.id });
          count++;
          if (subs.length === 0) continue;
          const children: InsertEvent[] = subs.map(([t, ti, st]) => ({
            type: t, title: ti, subTitle: st, parentEventId: parent.id, log: [logEntry("created")],
          }));
          await tx.insert(events).values(children);
          count += children.length;
        }
      });
      res.json({ created: count });
    } catch (error) {
      console.error("Error generating demo events:", error);
      res.status(500).json({ error: "Failed to generate events" });
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
