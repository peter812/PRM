// The Issues page (account-issues-plan.md §5): accounts PRM can no longer
// check, and the two ways out — rename and re-check, or delete. Re-check and
// delete use the account's own routes; only the rename and the dismissal
// need something of their own. Paths stay off /api/social-accounts/:id so
// that wildcard can't swallow them.
import type { Express, Response } from "express";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "../db";
import { storage } from "../storage";
import { requireAuth } from "../auth";
import { visibleShared } from "../access";
import { sseManager } from "../middleware/sse";
import { syncEntityInBackground } from "../vector-universal";
import { people, socialAccountIssues, socialAccounts, trackingJobs } from "@shared/schema";
import { recordAccountProfileChanges } from "../social-account-history";
import { closeIssue } from "../account-issues";
import { mergeSocialAccounts } from "../account-merge";
import { INSTAGRAM_TYPE_ID, queueManualJob } from "../tracking";
import { kickManualTrackingJobs } from "../stories-scheduler";
import { deleteEntityVector } from "../vector-universal";
import type { SocialAccount, SocialAccountIssue } from "@shared/schema";

const fail = (res: Response, what: string, error: unknown) => {
  console.error(`Account issues: ${what}:`, error);
  res.status(500).json({ error: `Failed to ${what}` });
};

/** The issue with its account, for the caller — undefined when either is out of sight. */
async function issueFor(id: string) {
  const [row] = await db
    .select({ issue: socialAccountIssues, account: socialAccounts })
    .from(socialAccountIssues)
    .innerJoin(socialAccounts, eq(socialAccounts.id, socialAccountIssues.socialAccountId))
    .where(and(eq(socialAccountIssues.id, id), visibleShared(socialAccounts.visibility, socialAccounts.createdByUserId)));
  return row;
}

const normalizeUsername = (raw: unknown) => String(raw ?? "").trim().replace(/^@/, "").toLowerCase();

/** Another Instagram row already under this username, if any. */
async function instagramAccountNamed(username: string) {
  const [row] = await db
    .select({ id: socialAccounts.id, username: socialAccounts.username, vectorId: socialAccounts.vectorId })
    .from(socialAccounts)
    .where(and(eq(socialAccounts.username, username), eq(socialAccounts.typeId, INSTAGRAM_TYPE_ID)))
    .limit(1);
  return row;
}

// The fix for a renamed account: the row keeps its followers, posts and
// history under the new name, the issue closes, and a profile check goes
// out to confirm. If that 404s too, the result handler opens a fresh issue.
async function renameAndRecheck(issue: SocialAccountIssue, account: SocialAccount, username: string, userId: number) {
  const changes = { username, accountUrl: `https://instagram.com/${username}` };
  await storage.updateSocialAccount(account.id, changes);
  await recordAccountProfileChanges(account.id, changes, account);
  await closeIssue(issue.id, "renamed", userId, account.username);
  const job = await queueManualJob(account.id, "info", userId);
  kickManualTrackingJobs();
  sseManager.broadcast("social_account.updated", { id: account.id });
  syncEntityInBackground("social_account", account.id);
  return job;
}

export function registerAccountIssues(app: Express) {
  // ?status=open (default) or closed; ?accountId= narrows to one account.
  app.get("/api/account-issues", requireAuth, async (req, res) => {
    try {
      const closed = req.query.status === "closed";
      const accountId = typeof req.query.accountId === "string" ? req.query.accountId : null;
      const rows = await db
        .select({
          issue: socialAccountIssues,
          account: {
            id: socialAccounts.id,
            username: socialAccounts.username,
            nickname: socialAccounts.nickname,
            imageUrl: socialAccounts.imageUrl,
            ownerUuid: socialAccounts.ownerUuid,
          },
          ownerName: sql<string | null>`trim(concat_ws(' ', ${people.firstName}, ${people.lastName}))`,
          // The check queued or running for this account right now, if any.
          openJob: sql<{ kind: string; status: string } | null>`(
            SELECT json_build_object('kind', j.kind, 'status', j.status) FROM ${trackingJobs} j
            WHERE j.social_account_id = ${socialAccounts.id} AND j.status IN ('queued', 'running')
            ORDER BY j.created_at LIMIT 1)`,
        })
        .from(socialAccountIssues)
        .innerJoin(socialAccounts, eq(socialAccounts.id, socialAccountIssues.socialAccountId))
        .leftJoin(people, eq(people.id, socialAccounts.ownerUuid))
        .where(
          and(
            closed ? inArray(socialAccountIssues.status, ["resolved", "dismissed"]) : eq(socialAccountIssues.status, "open"),
            accountId ? eq(socialAccountIssues.socialAccountId, accountId) : undefined,
            visibleShared(socialAccounts.visibility, socialAccounts.createdByUserId),
          ),
        )
        .orderBy(desc(closed ? socialAccountIssues.resolvedAt : socialAccountIssues.lastSeenAt))
        .limit(500);
      res.json(rows);
    } catch (error) {
      fail(res, "list issues", error);
    }
  });

  app.get("/api/account-issues/count", requireAuth, async (_req, res) => {
    try {
      const [row] = await db
        .select({ open: sql<number>`count(*)::int` })
        .from(socialAccountIssues)
        .innerJoin(socialAccounts, eq(socialAccounts.id, socialAccountIssues.socialAccountId))
        .where(and(eq(socialAccountIssues.status, "open"), visibleShared(socialAccounts.visibility, socialAccounts.createdByUserId)));
      res.json({ open: row?.open ?? 0 });
    } catch (error) {
      fail(res, "count issues", error);
    }
  });

  // Refuses with the duplicate when the name is already another row — the
  // page then offers the merge below instead.
  app.post("/api/account-issues/:id/rename", requireAuth, async (req, res) => {
    try {
      const row = await issueFor(req.params.id);
      if (!row) return res.status(404).json({ error: "Issue not found" });
      const { issue, account } = row;
      if (issue.status !== "open") return res.status(409).json({ error: "Issue is already closed" });
      const username = normalizeUsername(req.body?.username);
      if (!username || username === account.username) return res.status(400).json({ error: "Enter a different username" });
      const duplicate = await instagramAccountNamed(username);
      if (duplicate) return res.status(409).json({ error: `@${username} is already another account in PRM`, duplicate: { id: duplicate.id, username } });
      const job = await renameAndRecheck(issue, account, username, req.user!.id);
      res.json({ username, job });
    } catch (error) {
      fail(res, "rename account", error);
    }
  });

  // The rename when the new name is already a row of its own (account-merge-plan.md):
  // this row survives, takes in everything the other learned, and the other goes.
  app.post("/api/account-issues/:id/merge", requireAuth, async (req, res) => {
    try {
      const row = await issueFor(req.params.id);
      if (!row) return res.status(404).json({ error: "Issue not found" });
      const { issue, account } = row;
      if (issue.status !== "open") return res.status(409).json({ error: "Issue is already closed" });
      const username = normalizeUsername(req.body?.intoUsername);
      if (!username || username === account.username) return res.status(400).json({ error: "Enter a different username" });
      const duplicate = await instagramAccountNamed(username);
      if (!duplicate) return res.status(404).json({ error: `@${username} is not in PRM — rename instead` });

      const merged = await mergeSocialAccounts(account.id, duplicate.id);
      if (duplicate.vectorId) void deleteEntityVector("social_account", duplicate.vectorId);
      const job = await renameAndRecheck(issue, account, username, req.user!.id);
      res.json({ username, job, merged });
    } catch (error) {
      fail(res, "merge accounts", error);
    }
  });

  // For a not_found issue this resumes scheduled checks; the next 404 reopens it.
  app.post("/api/account-issues/:id/dismiss", requireAuth, async (req, res) => {
    try {
      const row = await issueFor(req.params.id);
      if (!row) return res.status(404).json({ error: "Issue not found" });
      const issue = await closeIssue(row.issue.id, "dismissed", req.user!.id);
      if (!issue) return res.status(409).json({ error: "Issue is already closed" });
      sseManager.broadcast("social_account.updated", { id: row.account.id });
      res.json(issue);
    } catch (error) {
      fail(res, "dismiss issue", error);
    }
  });
}
