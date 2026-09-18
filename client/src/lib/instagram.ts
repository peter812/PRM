import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import type { TrackingKind } from "@shared/interest-level";

export interface RunItem {
  username: string;
  storyPk: string | null;
  takenAt: string | null;
  mediaType: number | null;
  outcome: string;
  prmOutcome?: string;
  accountId?: string | null;
}

/** A tracking run's items: one per job. */
export interface TrackItem {
  jobId: string;
  kind: TrackingKind;
  username: string;
  outcome: string;
  reason?: string;
  error?: string;
  accountId?: string | null;
}

export interface StoryRun {
  id: string;
  importerId: string | null;
  importerLabel: string | null;
  kind: "stories" | "tracking";
  status: string;
  startedAt: string;
  finishedAt: string | null;
  counts: Partial<Record<"accountsInTray" | "accountsOpened" | "storiesSeen" | "imagesSaved" | "unreached" | "jobs" | "completed" | "failed" | "skipped", number>>;
  items: RunItem[];
  error: string | null;
}

export type Settings = Record<string, string | null>;

/** One row of story_importers as GET /api/stories/importers returns it. */
export interface Importer {
  id: string;
  label: string;
  serviceUrl: string;
  /** Whether a shared secret is stored; the secret itself never leaves the server. */
  serviceSecretSet: boolean;
  enabled: boolean;
  runEveryDays: number;
  runWindow: string;
  skipDayProbability: number;
  downloadVideos: boolean;
  nextRunAt: string | null;
  lastUsername: string | null;
  trackingEnabled: boolean;
  trackingWindow: string;
  trackingMaxJobs: number;
  nextTrackingRunAt: string | null;
  createdAt: string;
}

export const IMPORTERS_KEY = ["/api/stories/importers"];
export const RUNS_KEY = ["/api/stories/runs"];

/** Every delivered run, newest first; always refetched because the scheduler may have run since. */
export function useStoryRuns() {
  return useQuery<StoryRun[]>({
    queryKey: RUNS_KEY,
    queryFn: async () => (await apiRequest("GET", "/api/stories/runs")).json(),
    staleTime: 0,
    refetchOnMount: "always",
  });
}

export function useImporters() {
  return useQuery<Importer[]>({
    queryKey: IMPORTERS_KEY,
    queryFn: async () => (await apiRequest("GET", "/api/stories/importers")).json(),
  });
}

/** What the last run that reached Instagram said about the session. */
export function sessionFromRuns(runs: StoryRun[]): { label: string; ok: boolean | null; at: string | null } {
  const last = runs.find((r) => ["completed", "running", "needs_login", "checkpoint", "no_username", "rate_limited", "parse_failed", "error"].includes(r.status));
  if (!last) return { label: "Unknown — no run has reached Instagram yet", ok: null, at: null };
  if (last.status === "needs_login") return { label: "Logged out — Instagram wants a person to sign in again", ok: false, at: last.startedAt };
  if (last.status === "checkpoint") return { label: "Flagged — Instagram is asking for a verification step", ok: false, at: last.startedAt };
  if (last.status === "no_username") return { label: "Logged in, but the service couldn't tell which account — nothing was collected", ok: false, at: last.startedAt };
  return { label: "Logged in", ok: true, at: last.startedAt };
}

/**
 * Who a post sits under: Instagram's listed author first, then any collaborators.
 * Usernames come from the scraped metadata, ids from the row; a collab post is
 * one row on every poster's profile.
 */
export function postPosters(post: { socialAccountId: string; coauthorAccountIds?: string[] | null; metadata?: unknown }): { id: string | null; username: string; primary: boolean }[] {
  const m = (post.metadata ?? {}) as { author?: unknown; coauthors?: unknown };
  const coauthors = Array.isArray(m.coauthors) ? m.coauthors.filter((u): u is string => typeof u === "string") : [];
  const ids = post.coauthorAccountIds ?? [];
  const posters = coauthors.map((username, i) => ({ id: ids.length === coauthors.length ? ids[i] : null, username, primary: false }));
  if (typeof m.author === "string") posters.unshift({ id: post.socialAccountId, username: m.author, primary: true });
  return posters;
}
