// Issues: accounts PRM can no longer check (account-issues-plan.md §3).
// The tracking result handler raises and resolves them; the Issues page
// closes them by hand. An open not_found issue keeps its account out of
// scheduled claims (claimTrackingJobs).
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "./db";
import { socialAccountIssues, type IssueKind, type SocialAccountIssue } from "@shared/schema";
import type { TrackingKind } from "@shared/interest-level";

export type Resolution = "renamed" | "recheck_ok" | "became_public" | "dismissed";

/** A job hit a wall: open the issue for that kind, or bump the open one. */
export async function raiseIssue(accountId: string, kind: IssueKind, job: { id: string; kind: TrackingKind }): Promise<void> {
  await db
    .insert(socialAccountIssues)
    .values({ socialAccountId: accountId, kind, jobId: job.id, jobKind: job.kind })
    .onConflictDoUpdate({
      target: [socialAccountIssues.socialAccountId, socialAccountIssues.kind],
      targetWhere: sql`status = 'open'`,
      set: { timesSeen: sql`${socialAccountIssues.timesSeen} + 1`, lastSeenAt: new Date(), jobId: job.id, jobKind: job.kind },
    });
}

/** A job on this account got through: close the open issues that proves wrong. */
export async function resolveIssues(accountId: string, kinds: IssueKind[], resolution: Resolution): Promise<void> {
  await db
    .update(socialAccountIssues)
    .set({ status: "resolved", resolution, resolvedAt: new Date() })
    .where(and(eq(socialAccountIssues.socialAccountId, accountId), eq(socialAccountIssues.status, "open"), inArray(socialAccountIssues.kind, kinds)));
}

/** A person closed it. Returns nothing when the issue isn't open. */
export async function closeIssue(id: string, resolution: Resolution, userId: number, previousUsername?: string): Promise<SocialAccountIssue | undefined> {
  const [row] = await db
    .update(socialAccountIssues)
    .set({ status: resolution === "dismissed" ? "dismissed" : "resolved", resolution, resolvedBy: userId, resolvedAt: new Date(), previousUsername })
    .where(and(eq(socialAccountIssues.id, id), eq(socialAccountIssues.status, "open")))
    .returning();
  return row;
}
