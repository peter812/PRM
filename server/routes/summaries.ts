import type { Express } from "express";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { storage } from "../storage";
import {
  historicalAccountSummaries,
  socialAccountPosts,
  socialAccounts,
  summaryJobs,
} from "@shared/schema";
import { INTEREST_LEVELS, type InterestLevel } from "@shared/interest-level";
import {
  DEFAULT_ACCOUNT_PROMPT,
  DEFAULT_POST_MAX_WORDS,
  DEFAULT_POST_PROMPT,
  DEFAULT_SCENE_PROMPT,
  DEFAULT_STORY_PROMPT,
  SUMMARY_ACCOUNT_AUTO_ENABLED_KEY,
  SUMMARY_ACCOUNT_ENABLED_KEY,
  SUMMARY_ACCOUNT_NO_THINK_KEY,
  SUMMARY_ACCOUNT_PROMPT_KEY,
  SUMMARY_POST_AUTO_ENABLED_KEY,
  SUMMARY_POST_ENABLED_KEY,
  SUMMARY_POST_MAX_WORDS_KEY,
  SUMMARY_POST_NO_THINK_KEY,
  SUMMARY_POST_PROMPT_KEY,
  SUMMARY_SCENE_MODEL_KEY,
  SUMMARY_SCENE_NO_THINK_KEY,
  SUMMARY_SCENE_PROMPT_KEY,
  SUMMARY_SCENE_PROVIDER_KEY,
  SUMMARY_STORY_NO_THINK_KEY,
  SUMMARY_STORY_PROMPT_KEY,
  SUMMARY_TEXT_MODEL_KEY,
  SUMMARY_TEXT_PROVIDER_KEY,
  enqueueAccountSummariesForLevel,
  enqueueAccountSummary,
  enqueueAllHistoricalPosts,
  enqueueSummaryJob,
  loadSummarySettings,
  wakeSummaryRunner,
} from "../summary-queue";

const modelSelectionSchema = z.object({
  providerId: z.string().default(""),
  model: z.string().default(""),
});

const settingsPatchSchema = z.object({
  postEnabled: z.boolean().optional(),
  postAutoEnabled: z.boolean().optional(),
  accountEnabled: z.boolean().optional(),
  accountAutoEnabled: z.boolean().optional(),
  sceneModel: modelSelectionSchema.optional(),
  textModel: modelSelectionSchema.optional(),
  scenePrompt: z.string().max(20_000).optional(),
  postPrompt: z.string().max(20_000).optional(),
  postMaxWords: z.number().int().min(10).max(2_000).optional(),
  storyPrompt: z.string().max(20_000).optional(),
  accountPrompt: z.string().max(20_000).optional(),
  sceneNoThink: z.boolean().optional(),
  postNoThink: z.boolean().optional(),
  storyNoThink: z.boolean().optional(),
  accountNoThink: z.boolean().optional(),
});

// Manual runs respect the same enable toggles as auto-queueing.
async function summaryDisabled(kind: "post" | "account"): Promise<string | null> {
  const settings = await loadSummarySettings();
  const enabled = kind === "post" ? settings.postEnabled : settings.accountEnabled;
  return enabled ? null : `${kind === "post" ? "Post" : "Account"} summaries are disabled in settings`;
}

export function registerSummaryRoutes(app: Express) {
  app.get("/api/summary/settings", async (_req, res) => {
    try {
      const settings = await loadSummarySettings();
      res.json({
        ...settings,
        defaults: {
          scenePrompt: DEFAULT_SCENE_PROMPT,
          postPrompt: DEFAULT_POST_PROMPT,
          postMaxWords: DEFAULT_POST_MAX_WORDS,
          storyPrompt: DEFAULT_STORY_PROMPT,
          accountPrompt: DEFAULT_ACCOUNT_PROMPT,
        },
      });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : "Failed to load summary settings" });
    }
  });

  app.post("/api/summary/settings", async (req, res) => {
    try {
      const parsed = settingsPatchSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: "Invalid settings payload", issues: parsed.error.issues });
      const p = parsed.data;

      const ops: Promise<unknown>[] = [];
      if (p.postEnabled !== undefined) ops.push(storage.setAppSetting(SUMMARY_POST_ENABLED_KEY, String(p.postEnabled)));
      if (p.postAutoEnabled !== undefined) ops.push(storage.setAppSetting(SUMMARY_POST_AUTO_ENABLED_KEY, String(p.postAutoEnabled)));
      if (p.accountEnabled !== undefined) ops.push(storage.setAppSetting(SUMMARY_ACCOUNT_ENABLED_KEY, String(p.accountEnabled)));
      if (p.accountAutoEnabled !== undefined) ops.push(storage.setAppSetting(SUMMARY_ACCOUNT_AUTO_ENABLED_KEY, String(p.accountAutoEnabled)));
      if (p.sceneModel !== undefined) {
        ops.push(storage.setAppSetting(SUMMARY_SCENE_PROVIDER_KEY, p.sceneModel.providerId));
        ops.push(storage.setAppSetting(SUMMARY_SCENE_MODEL_KEY, p.sceneModel.model.trim()));
      }
      if (p.textModel !== undefined) {
        ops.push(storage.setAppSetting(SUMMARY_TEXT_PROVIDER_KEY, p.textModel.providerId));
        ops.push(storage.setAppSetting(SUMMARY_TEXT_MODEL_KEY, p.textModel.model.trim()));
      }
      // A prompt left at its default is stored empty, so later changes to the default still apply.
      const promptValue = (prompt: string, fallback: string) => (prompt.trim() === fallback ? "" : prompt);
      if (p.scenePrompt !== undefined) ops.push(storage.setAppSetting(SUMMARY_SCENE_PROMPT_KEY, promptValue(p.scenePrompt, DEFAULT_SCENE_PROMPT)));
      if (p.postPrompt !== undefined) ops.push(storage.setAppSetting(SUMMARY_POST_PROMPT_KEY, promptValue(p.postPrompt, DEFAULT_POST_PROMPT)));
      if (p.storyPrompt !== undefined) ops.push(storage.setAppSetting(SUMMARY_STORY_PROMPT_KEY, promptValue(p.storyPrompt, DEFAULT_STORY_PROMPT)));
      if (p.accountPrompt !== undefined) ops.push(storage.setAppSetting(SUMMARY_ACCOUNT_PROMPT_KEY, promptValue(p.accountPrompt, DEFAULT_ACCOUNT_PROMPT)));
      if (p.postMaxWords !== undefined) ops.push(storage.setAppSetting(SUMMARY_POST_MAX_WORDS_KEY, String(p.postMaxWords)));
      if (p.sceneNoThink !== undefined) ops.push(storage.setAppSetting(SUMMARY_SCENE_NO_THINK_KEY, String(p.sceneNoThink)));
      if (p.postNoThink !== undefined) ops.push(storage.setAppSetting(SUMMARY_POST_NO_THINK_KEY, String(p.postNoThink)));
      if (p.storyNoThink !== undefined) ops.push(storage.setAppSetting(SUMMARY_STORY_NO_THINK_KEY, String(p.storyNoThink)));
      if (p.accountNoThink !== undefined) ops.push(storage.setAppSetting(SUMMARY_ACCOUNT_NO_THINK_KEY, String(p.accountNoThink)));

      await Promise.all(ops);
      res.json(await loadSummarySettings());
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : "Failed to save summary settings" });
    }
  });

  // Optional ?kind=post|account and ?status= filters; counts follow the kind filter only.
  app.get("/api/summary-queue", async (req, res) => {
    try {
      const kind = typeof req.query.kind === "string" ? req.query.kind : undefined;
      const status = typeof req.query.status === "string" && req.query.status !== "all" ? req.query.status : undefined;
      const kindWhere = kind ? eq(summaryJobs.kind, kind) : undefined;

      const countRows = await db
        .select({ status: summaryJobs.status, n: sql<number>`count(*)::int` })
        .from(summaryJobs)
        .where(kindWhere)
        .groupBy(summaryJobs.status);
      const counts = Object.fromEntries(countRows.map((r) => [r.status, r.n]));

      const rows = await db
        .select({
          id: summaryJobs.id,
          kind: summaryJobs.kind,
          targetId: summaryJobs.targetId,
          socialAccountId: summaryJobs.socialAccountId,
          username: socialAccounts.username,
          status: summaryJobs.status,
          attempts: summaryJobs.attempts,
          error: summaryJobs.error,
          options: summaryJobs.options,
          progress: summaryJobs.progress,
          // Post jobs an account job is still waiting on.
          livePosts: sql<number>`(
            SELECT count(*)::int FROM summary_jobs p
            WHERE p.kind = 'post' AND p.social_account_id = ${summaryJobs.socialAccountId} AND p.status IN ('pending', 'running')
          )`,
          postType: socialAccountPosts.postType,
          postedAt: socialAccountPosts.postedAt,
          postDescription: sql<string | null>`left(${socialAccountPosts.description}, 120)`,
          createdAt: summaryJobs.createdAt,
          startedAt: summaryJobs.startedAt,
          completedAt: summaryJobs.completedAt,
        })
        .from(summaryJobs)
        .leftJoin(socialAccounts, eq(summaryJobs.socialAccountId, socialAccounts.id))
        .leftJoin(
          socialAccountPosts,
          and(eq(summaryJobs.kind, "post"), eq(socialAccountPosts.id, summaryJobs.targetId)),
        )
        .where(and(kindWhere, status ? eq(summaryJobs.status, status) : undefined))
        .orderBy(desc(summaryJobs.createdAt))
        .limit(200);

      res.json({ counts, rows });
    } catch (error) {
      res.status(500).json({ error: "Failed to load summary queue" });
    }
  });

  app.post("/api/summary-queue/retry-failed", async (_req, res) => {
    try {
      const updated = await db
        .update(summaryJobs)
        .set({ status: "pending", attempts: 0, error: null, startedAt: null, completedAt: null })
        .where(eq(summaryJobs.status, "failed"))
        .returning({ id: summaryJobs.id });
      if (updated.length > 0) wakeSummaryRunner();
      res.json({ retried: updated.length });
    } catch (error) {
      res.status(500).json({ error: "Failed to retry summary jobs" });
    }
  });

  app.delete("/api/summary-queue/finished", async (_req, res) => {
    try {
      const deleted = await db
        .delete(summaryJobs)
        .where(inArray(summaryJobs.status, ["done", "failed", "cancelled"]))
        .returning({ id: summaryJobs.id });
      res.json({ cleared: deleted.length });
    } catch (error) {
      res.status(500).json({ error: "Failed to clear finished summary jobs" });
    }
  });

  app.post("/api/summary-queue/posts/historical", async (req, res) => {
    try {
      const disabled = await summaryDisabled("post");
      if (disabled) return res.status(409).json({ error: disabled });
      const includeSummarized = Boolean(req.body?.includeSummarized);
      const queued = await enqueueAllHistoricalPosts(includeSummarized);
      res.json({ queued });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : "Failed to queue historical posts" });
    }
  });

  app.post("/api/summary-queue/accounts/by-interest", async (req, res) => {
    try {
      const disabled = await summaryDisabled("account");
      if (disabled) return res.status(409).json({ error: disabled });
      const level = req.body?.level as InterestLevel;
      if (!level || !(INTEREST_LEVELS as readonly string[]).includes(level)) {
        return res.status(400).json({ error: "Valid interest level is required" });
      }
      const result = await enqueueAccountSummariesForLevel(level);
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : "Failed to queue account summaries" });
    }
  });

  app.get("/api/social-posts/:id/summary", async (req, res) => {
    try {
      const [post] = await db
        .select({
          id: socialAccountPosts.id,
          aiSummary: socialAccountPosts.aiSummary,
          aiSummaryAt: socialAccountPosts.aiSummaryAt,
          aiSummaryModel: socialAccountPosts.aiSummaryModel,
        })
        .from(socialAccountPosts)
        .where(eq(socialAccountPosts.id, req.params.id));
      if (!post) return res.status(404).json({ error: "Post not found" });

      // The newest job of any status, so an old failure doesn't outlive a later success.
      const [latestJob] = await db
        .select()
        .from(summaryJobs)
        .where(and(eq(summaryJobs.kind, "post"), eq(summaryJobs.targetId, post.id)))
        .orderBy(desc(summaryJobs.createdAt))
        .limit(1);

      res.json({
        aiSummary: post.aiSummary ?? null,
        aiSummaryAt: post.aiSummaryAt ?? null,
        aiSummaryModel: post.aiSummaryModel ?? null,
        job: latestJob ?? null,
      });
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch post summary" });
    }
  });

  app.post("/api/social-posts/:id/summary", async (req, res) => {
    try {
      const [post] = await db
        .select({ id: socialAccountPosts.id, socialAccountId: socialAccountPosts.socialAccountId })
        .from(socialAccountPosts)
        .where(eq(socialAccountPosts.id, req.params.id));
      if (!post) return res.status(404).json({ error: "Post not found" });

      const disabled = await summaryDisabled("post");
      if (disabled) return res.status(409).json({ error: disabled });
      const queued = await enqueueSummaryJob("post", post.id, post.socialAccountId);
      res.json({ queued });
    } catch (error) {
      res.status(500).json({ error: "Failed to queue post summary" });
    }
  });

  // History content is only sent with ?history=1 (the Summary tab); the overview card just shows the count.
  app.get("/api/social-accounts/:id/summary", async (req, res) => {
    try {
      const [account] = await db
        .select({
          id: socialAccounts.id,
          aiSummary: socialAccounts.aiSummary,
          aiSummaryGeneratedAt: socialAccounts.aiSummaryGeneratedAt,
          aiSummaryInvalidated: socialAccounts.aiSummaryInvalidated,
          aiSummaryInvalidatedAt: socialAccounts.aiSummaryInvalidatedAt,
          aiSummaryModel: socialAccounts.aiSummaryModel,
        })
        .from(socialAccounts)
        .where(eq(socialAccounts.id, req.params.id));
      if (!account) return res.status(404).json({ error: "Social account not found" });

      const historyWhere = eq(historicalAccountSummaries.socialAccountId, account.id);
      const [history, [{ historyCount }], activeJobs, [latestFailedAccountJob]] = await Promise.all([
        req.query.history === "1"
          ? db.select().from(historicalAccountSummaries).where(historyWhere).orderBy(desc(historicalAccountSummaries.replacedAt))
          : Promise.resolve([]),
        db.select({ historyCount: sql<number>`count(*)::int` }).from(historicalAccountSummaries).where(historyWhere),
        db
          .select()
          .from(summaryJobs)
          .where(and(eq(summaryJobs.socialAccountId, account.id), inArray(summaryJobs.status, ["pending", "running"])))
          .orderBy(desc(summaryJobs.createdAt)),
        db
          .select()
          .from(summaryJobs)
          .where(and(eq(summaryJobs.kind, "account"), eq(summaryJobs.targetId, account.id), eq(summaryJobs.status, "failed")))
          .orderBy(desc(summaryJobs.completedAt))
          .limit(1),
      ]);

      const failedSinceLastSummary =
        latestFailedAccountJob &&
        (!account.aiSummaryGeneratedAt ||
          (latestFailedAccountJob.completedAt && latestFailedAccountJob.completedAt > account.aiSummaryGeneratedAt));

      res.json({
        current: account.aiSummary
          ? { content: account.aiSummary, generatedAt: account.aiSummaryGeneratedAt, model: account.aiSummaryModel }
          : null,
        invalidated: account.aiSummaryInvalidated,
        invalidatedAt: account.aiSummaryInvalidatedAt,
        history,
        historyCount,
        activeJobs,
        lastError: activeJobs.length === 0 && failedSinceLastSummary ? latestFailedAccountJob.error : null,
      });
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch account summary" });
    }
  });

  app.post("/api/social-accounts/:id/summary", async (req, res) => {
    try {
      const [account] = await db.select({ id: socialAccounts.id }).from(socialAccounts).where(eq(socialAccounts.id, req.params.id));
      if (!account) return res.status(404).json({ error: "Social account not found" });

      const disabled = await summaryDisabled("account");
      if (disabled) return res.status(409).json({ error: disabled });
      const result = await enqueueAccountSummary(account.id);
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: "Failed to queue account summary" });
    }
  });
}
