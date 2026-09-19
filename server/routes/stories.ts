/**
 * Ingest for the prm-stories scraper (see instagram-stories-plan.md).
 * A story becomes a social_account_posts row with postType "story" plus a
 * photos row. Stories from unknown accounts are not stored; the run log
 * records that they were seen. Stories are instance-wide: the scraper
 * authenticates with the run token PRM minted when it triggered the run
 * (server/stories-scheduler.ts), and everything runs as system.
 *
 * No analysis is attached yet (no vector sync, no face / LLM tasks) — that is
 * phase 2 and is deliberately switched off for now.
 */
import type { Express, Request, Response } from "express";
import crypto from "crypto";
import multer from "multer";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { storage } from "../storage";
import { requireAdmin } from "../auth";
import { runAsSystem } from "../access";
import { uploadImage, uploadMedia } from "../image-storage";
import { photos, socialAccountPosts, socialAccounts, storyImporters, storyScrapeRuns, isAdminRole, type StoryImporter } from "@shared/schema";
import { generateDeterministicUuid } from "./social-media";
import { DEFAULT_WINDOW, kickManualTrackingJobsAfterRun, runForToken, storiesServiceUrl, triggerStoriesRun } from "../stories-scheduler";
import { failUnfinishedJobs } from "../tracking";

const INSTAGRAM_TYPE_ID = "00000000-0000-0000-0001-000000000001";
// A story video (≤ 60 s) is usually 3–15 MB; the scraper skips anything over its own cap (50 MB by default).
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

export function storyPostId(storyPk: string): string {
  return generateDeterministicUuid(`instagram:story:${storyPk.trim()}`);
}

const storyMetaSchema = z.object({
  storyPk: z.string().min(1),
  username: z.string().min(1),
  /** The @username the scraper was logged in as — audit provenance, required. */
  scrapedFrom: z.string().min(1),
  takenAt: z.string().datetime(),
  accessibilityCaption: z.string().nullable().optional(),
  mentions: z.array(z.string()).default([]),
  width: z.number().nullable().optional(),
  height: z.number().nullable().optional(),
}).passthrough();

const runSchema = z.object({
  runId: z.string().min(1),
  status: z.string().min(1),
  startedAt: z.string().datetime(),
  finishedAt: z.string().datetime().nullable().optional(),
  counts: z.record(z.unknown()).default({}),
  items: z.array(z.unknown()).default([]),
  error: z.string().nullable().optional(),
  scrapedFrom: z.string().nullable().optional(),
});

const timeOfDay = /^\d{1,2}:\d{2}$/;
const importerPatchSchema = z.object({
  label: z.string().trim().min(1).max(80).optional(),
  serviceUrl: z.string().trim().max(500).optional(),
  enabled: z.boolean().optional(),
  runEveryDays: z.number().int().min(1).max(30).optional(),
  runWindow: z.string().refine((w) => {
    const [a, b] = w.split("-");
    return Boolean(a && b && timeOfDay.test(a) && timeOfDay.test(b) && a < b);
  }, "runWindow must be HH:MM-HH:MM with the end after the start").optional(),
  skipDayProbability: z.number().min(0).max(1).optional(),
  downloadVideos: z.boolean().optional(),
}).strict();

/** The importer for `:id`, or null with a 404 already sent. */
async function importerFor(req: Request, res: Response): Promise<StoryImporter | null> {
  const [importer] = await db.select().from(storyImporters).where(eq(storyImporters.id, req.params.id)).limit(1);
  if (!importer) res.status(404).json({ error: "Importer not found" });
  return importer ?? null;
}

const checkStoriesSchema = z.object({
  storyPks: z.array(z.string().min(1)).optional(),
  usernames: z.array(z.string().min(1)).optional(),
  items: z.array(z.object({
    storyPk: z.string().min(1),
    username: z.string().min(1).optional(),
  })).optional(),
}).refine(data => Boolean(data.storyPks?.length || data.items?.length || data.usernames?.length), {
  message: "At least one of storyPks, items, or usernames must be provided",
});

/** The run whose live token is on the request, or null with a 401 already sent. */
export async function authedRun(req: Request, res: Response): Promise<{ id: string } | null> {
  const token = req.headers["x-stories-token"];
  if (typeof token === "string") {
    const run = await runAsSystem(() => runForToken(token));
    if (run) return run;
  }
  if (req.isAuthenticated?.() && req.user && isAdminRole(req.user.role)) {
    return { id: "admin-session" };
  }
  res.status(401).json({ error: "Invalid or expired run token" });
  return null;
}

export function registerStories(app: Express) {
  // The scraper confirms a freshly received run token here before it starts.
  app.get("/api/v1/stories/auth", async (req, res) => {
    const run = await authedRun(req, res);
    if (run) res.json({ ok: true, runId: run.id });
  });

  // Pre-upload duplication & account check
  const checkStoriesHandler = async (req: Request, res: Response) => {
    try {
      if (!(await authedRun(req, res))) return;
      const parsed = checkStoriesSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid request", issues: parsed.error.issues });
      }

      const pksToCheck = Array.from(new Set([
        ...(parsed.data.storyPks ?? []),
        ...(parsed.data.items?.map(i => i.storyPk) ?? []),
      ].map(pk => pk.trim()).filter(Boolean)));

      const usernamesToCheck = Array.from(new Set([
        ...(parsed.data.usernames ?? []),
        ...(parsed.data.items?.map(i => i.username).filter((u): u is string => Boolean(u)) ?? []),
      ].map(u => u.trim().toLowerCase()).filter(Boolean)));

      await runAsSystem(async () => {
        let existingStoryPks: string[] = [];
        let missingAccountUsernames: string[] = [];

        if (pksToCheck.length > 0) {
          const idToPkMap = new Map<string, string>();
          for (const pk of pksToCheck) {
            idToPkMap.set(storyPostId(pk), pk);
          }
          const deterministicIds = Array.from(idToPkMap.keys());
          const existing = await db
            .select({ id: socialAccountPosts.id })
            .from(socialAccountPosts)
            .where(inArray(socialAccountPosts.id, deterministicIds));

          existingStoryPks = existing.map(e => idToPkMap.get(e.id)!).filter(Boolean);
        }

        if (usernamesToCheck.length > 0) {
          const existingAccounts = await db
            .select({ username: sql<string>`LOWER(${socialAccounts.username})` })
            .from(socialAccounts)
            .where(and(
              inArray(sql`LOWER(${socialAccounts.username})`, usernamesToCheck),
              eq(socialAccounts.typeId, INSTAGRAM_TYPE_ID),
            ));

          const foundSet = new Set(existingAccounts.map(a => a.username));
          missingAccountUsernames = usernamesToCheck.filter(u => !foundSet.has(u));
        }

        res.json({
          existingStoryPks,
          missingAccountUsernames,
        });
      });
    } catch (error) {
      console.error("Error checking story duplicates:", error);
      res.status(500).json({ error: "Failed to check duplicates" });
    }
  };

  app.post("/api/v1/stories/check", checkStoriesHandler);
  app.post("/api/v1/stories/runs/:runId/check", checkStoriesHandler);
  app.post("/api/stories/check", checkStoriesHandler);

  // One story: multipart `meta` (json string) + `image` (+ optional `video`, the mp4 of a video story).
  app.post("/api/v1/stories/runs/:runId/items", upload.fields([{ name: "image", maxCount: 1 }, { name: "video", maxCount: 1 }]), async (req, res) => {
    try {
      if (!(await authedRun(req, res))) return;
      const parsed = storyMetaSchema.safeParse(JSON.parse(req.body?.meta ?? "{}"));
      const files = (req.files ?? {}) as Record<string, Express.Multer.File[] | undefined>;
      const image = files.image?.[0];
      const video = files.video?.[0];
      if (!parsed.success || !image) {
        return res.status(400).json({ error: "meta json (with scrapedFrom) and image file are required", issues: parsed.success ? [] : parsed.error.issues });
      }
      const { storyPk, username, scrapedFrom, takenAt, accessibilityCaption, mentions, width, height, ...rest } = parsed.data;
      const cleanStoryPk = storyPk.trim();

      await runAsSystem(async () => {
        const [account] = await db
          .select({ id: socialAccounts.id })
          .from(socialAccounts)
          .where(and(eq(sql`LOWER(${socialAccounts.username})`, username.toLowerCase()), eq(socialAccounts.typeId, INSTAGRAM_TYPE_ID)))
          .limit(1);
        if (!account) return res.status(202).json({ outcome: "no_account" });

        const postId = storyPostId(cleanStoryPk);
        const [existing] = await db.select({ id: socialAccountPosts.id }).from(socialAccountPosts).where(eq(socialAccountPosts.id, postId)).limit(1);
        if (existing) return res.status(200).json({ outcome: "duplicate", postId });

        const buffer = image.buffer;
        const fileHash = crypto.createHash("sha256").update(buffer).digest("hex");
        let imageUrl = (await storage.getPhotoByFileHash(fileHash))?.location;
        if (!imageUrl) {
          imageUrl = await uploadImage(buffer, `${cleanStoryPk}.jpg`, image.mimetype || "image/jpeg");
        }

        // The video is a bonus on top of the cover frame: if storing it fails the story is still kept.
        const metadata: Record<string, unknown> = { ...rest };
        if (video) {
          try {
            const mime = video.mimetype?.startsWith("video/") ? video.mimetype : "video/mp4";
            metadata.videoUrl = await uploadMedia(video.buffer, `${cleanStoryPk}.mp4`, mime);
          } catch (err) {
            console.error(`Story ${cleanStoryPk}: video not stored:`, err);
            metadata.videoError = err instanceof Error ? err.message : String(err);
          }
        }

        // Ensure photos record for this story post exists (even if image file was deduped by fileHash)
        const [existingPhoto] = await db
          .select({ id: photos.id })
          .from(photos)
          .where(eq(photos.prmLocation, `post:${postId}`))
          .limit(1);

        if (!existingPhoto) {
          await storage.insertPhoto({
            location: imageUrl,
            prmLocation: `post:${postId}`,
            isSubImage: false,
            fileHash,
            widthPx: width ?? null,
            heightPx: height ?? null,
            ogMetadata: { source: "instagram-story", storyPk: cleanStoryPk, takenAt },
          });
        }

        const [inserted] = await db
          .insert(socialAccountPosts)
          .values({
            id: postId,
            socialAccountId: account.id,
            postType: "story",
            content: JSON.stringify([imageUrl]),
            description: accessibilityCaption ?? null,
            mentionedAccounts: mentions.length ? JSON.stringify([{ imageIndex: 0, accounts: mentions }]) : null,
            postedAt: new Date(takenAt),
            metadata,
            scrapedFrom,
          })
          .onConflictDoNothing({ target: socialAccountPosts.id })
          .returning({ id: socialAccountPosts.id });

        if (!inserted) {
          return res.status(200).json({ outcome: "duplicate", postId });
        }

        await db.update(socialAccounts).set({ lastScrapedAt: new Date() }).where(eq(socialAccounts.id, account.id));
        res.status(201).json({ outcome: "stored", postId });
      });
    } catch (error) {
      console.error("Error storing story:", error);
      res.status(500).json({ error: "Failed to store story" });
    }
  });

  // The run manifest, sent once everything above is done. The row already
  // exists (PRM minted it); this fills in the result. Idempotent.
  app.post("/api/v1/stories/runs", async (req, res) => {
    try {
      if (!(await authedRun(req, res))) return;
      const parsed = runSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: "Invalid run manifest", issues: parsed.error.issues });
      const m = parsed.data;
      const row = {
        status: m.status,
        startedAt: new Date(m.startedAt),
        finishedAt: m.finishedAt ? new Date(m.finishedAt) : null,
        counts: m.counts,
        items: m.items,
        error: m.error ?? null,
        ...(m.scrapedFrom ? { scrapedFrom: m.scrapedFrom } : {}),
      };
      // importer_id is not in `row`, so the upsert keeps the card PRM minted the run under.
      await db.insert(storyScrapeRuns).values({ id: m.runId, ...row }).onConflictDoUpdate({ target: storyScrapeRuns.id, set: row });
      res.status(201).json({ ok: true });
    } catch (error) {
      console.error("Error storing story run:", error);
      res.status(500).json({ error: "Failed to store run" });
    }
  });

  // Settings page: recent runs, newest first. Token columns never leave the server.
  app.get("/api/stories/runs", async (_req, res) => {
    try {
      const runs = await db
        .select({
          id: storyScrapeRuns.id,
          importerId: storyScrapeRuns.importerId,
          importerLabel: storyImporters.label,
          status: storyScrapeRuns.status,
          startedAt: storyScrapeRuns.startedAt,
          finishedAt: storyScrapeRuns.finishedAt,
          counts: storyScrapeRuns.counts,
          items: storyScrapeRuns.items,
          error: storyScrapeRuns.error,
          scrapedFrom: storyScrapeRuns.scrapedFrom,
        })
        .from(storyScrapeRuns)
        .leftJoin(storyImporters, eq(storyImporters.id, storyScrapeRuns.importerId))
        .orderBy(desc(storyScrapeRuns.startedAt))
        .limit(30);

      const allUsernames = new Set<string>();
      for (const run of runs) {
        const items = Array.isArray(run.items) ? (run.items as any[]) : [];
        for (const item of items) {
          if (item && typeof item.username === "string" && item.username.trim()) {
            allUsernames.add(item.username.trim().toLowerCase());
          }
        }
      }

      const accountMap = new Map<string, string>();
      if (allUsernames.size > 0) {
        const matchingAccounts = await db
          .select({
            id: socialAccounts.id,
            username: sql<string>`LOWER(${socialAccounts.username})`,
          })
          .from(socialAccounts)
          .where(
            and(
              inArray(sql`LOWER(${socialAccounts.username})`, Array.from(allUsernames)),
              eq(socialAccounts.typeId, INSTAGRAM_TYPE_ID)
            )
          );

        for (const acc of matchingAccounts) {
          accountMap.set(acc.username, acc.id);
        }
      }

      const enrichedRuns = runs.map((run) => {
        const items = Array.isArray(run.items) ? (run.items as any[]) : [];
        const enrichedItems = items.map((item) => {
          if (!item || typeof item !== "object") return item;
          const uname = typeof item.username === "string" ? item.username.trim().toLowerCase() : "";
          const accountId = uname ? (accountMap.get(uname) ?? null) : null;
          return {
            ...item,
            accountId,
          };
        });
        return {
          ...run,
          items: enrichedItems,
        };
      });

      res.json(enrichedRuns);
    } catch (error) {
      console.error("Error listing story runs:", error);
      res.status(500).json({ error: "Failed to list runs" });
    }
  });

  // Settings page: delete a single story run.
  app.delete("/api/stories/runs/:id", requireAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      await failUnfinishedJobs(id, "run_deleted");
      kickManualTrackingJobsAfterRun();
      const result = await db.delete(storyScrapeRuns).where(eq(storyScrapeRuns.id, id)).returning({ id: storyScrapeRuns.id });
      if (!result.length) {
        return res.status(404).json({ error: "Run not found" });
      }
      res.json({ ok: true, deletedId: id });
    } catch (error) {
      console.error("Error deleting story run:", error);
      res.status(500).json({ error: "Failed to delete run" });
    }
  });

  // Settings page: bulk delete story runs.
  app.post("/api/stories/runs/bulk-delete", requireAdmin, async (req, res) => {
    try {
      const bulkDeleteSchema = z.object({
        ids: z.array(z.string()).min(1),
      });
      const parsed = bulkDeleteSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid request, ids array required", issues: parsed.error.issues });
      }
      const { ids } = parsed.data;
      await Promise.all(ids.map((id) => failUnfinishedJobs(id, "run_deleted")));
      kickManualTrackingJobsAfterRun();
      const result = await db.delete(storyScrapeRuns).where(inArray(storyScrapeRuns.id, ids)).returning({ id: storyScrapeRuns.id });
      res.json({ ok: true, deletedCount: result.length });
    } catch (error) {
      console.error("Error bulk deleting story runs:", error);
      res.status(500).json({ error: "Failed to delete runs" });
    }
  });

  // ── Importers: one card per prm-stories install ──
  app.get("/api/stories/importers", async (_req, res) => {
    try {
      res.json(await db.select().from(storyImporters).orderBy(storyImporters.createdAt));
    } catch (error) {
      console.error("Error listing story importers:", error);
      res.status(500).json({ error: "Failed to list importers" });
    }
  });

  app.post("/api/stories/importers", requireAdmin, async (_req, res) => {
    try {
      const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(storyImporters);
      const [created] = await db.insert(storyImporters).values({ label: `Importer ${n + 1}`, runWindow: DEFAULT_WINDOW }).returning();
      res.status(201).json(created);
    } catch (error) {
      console.error("Error creating story importer:", error);
      res.status(500).json({ error: "Failed to create importer" });
    }
  });

  app.patch("/api/stories/importers/:id", requireAdmin, async (req, res) => {
    try {
      const parsed = importerPatchSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: "Invalid importer", issues: parsed.error.issues });
      const importer = await importerFor(req, res);
      if (!importer) return;
      const patch = parsed.data;
      // A new URL, window or cadence means the planned time no longer applies; the scheduler re-rolls it.
      const reschedule =
        (patch.serviceUrl !== undefined && patch.serviceUrl !== importer.serviceUrl) ||
        (patch.runWindow !== undefined && patch.runWindow !== importer.runWindow) ||
        (patch.runEveryDays !== undefined && patch.runEveryDays !== importer.runEveryDays);
      const [updated] = await db
        .update(storyImporters)
        .set({ ...patch, ...(reschedule ? { nextRunAt: null } : {}) })
        .where(eq(storyImporters.id, importer.id))
        .returning();
      res.json(updated);
    } catch (error) {
      console.error("Error updating story importer:", error);
      res.status(500).json({ error: "Failed to update importer" });
    }
  });

  // Runs keep their history; importer_id becomes null (ON DELETE SET NULL).
  app.delete("/api/stories/importers/:id", requireAdmin, async (req, res) => {
    try {
      const result = await db.delete(storyImporters).where(eq(storyImporters.id, req.params.id)).returning({ id: storyImporters.id });
      if (!result.length) return res.status(404).json({ error: "Importer not found" });
      res.json({ ok: true, deletedId: req.params.id });
    } catch (error) {
      console.error("Error deleting story importer:", error);
      res.status(500).json({ error: "Failed to delete importer" });
    }
  });

  // Settings page: have the importer's service open Instagram in a visible
  // Chrome window on its profile so a person can log in.
  app.post("/api/stories/importers/:id/login", requireAdmin, async (req, res) => {
    try {
      const importer = await importerFor(req, res);
      if (!importer) return;
      const apiUrl = storiesServiceUrl(importer);
      if (!apiUrl) return res.status(400).json({ ok: false, reason: "no_service_url" });
      const upstream = await fetch(`${apiUrl}/login`, { method: "POST", signal: AbortSignal.timeout(60_000) });
      const body = (await upstream.json().catch(() => ({}))) as { ok?: boolean; reason?: string };
      res.status(upstream.ok ? 200 : 409).json({ ok: Boolean(body.ok), reason: body.reason ?? null });
    } catch (error) {
      res.status(502).json({ ok: false, reason: "unreachable", error: error instanceof Error ? error.message : String(error) });
    }
  });

  // Settings page: trigger this importer's run outside its nightly window.
  app.post("/api/stories/importers/:id/run-now", requireAdmin, async (req, res) => {
    try {
      const importer = await importerFor(req, res);
      if (!importer) return;
      res.json(await runAsSystem(() => triggerStoriesRun(importer)));
    } catch (error) {
      console.error("Error triggering story run:", error);
      res.status(500).json({ error: "Failed to trigger run" });
    }
  });
}
