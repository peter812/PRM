import { useEffect, useRef, useState } from "react";
import { useInfiniteQuery, useMutation, useQuery } from "@tanstack/react-query";
import { AlertCircle, ChevronDown, Clock, Loader2, X } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { useImporters } from "@/lib/instagram";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { getInitials } from "@/lib/utils";
import { SocialAccountHistoryModal, type CurrentProfileValues } from "@/components/social-account-history-modal";
import { TRACKING_KINDS, TRACKING_KIND_LABEL, type TrackingKind } from "@shared/interest-level";
import {
  PROFILE_IMAGE_CHANGE_LABELS,
  type ProfileImageChange,
  type SocialAccountHistoryEntry,
  type SocialAccountHistoryKind,
  type SocialAccountHistorySummary,
  type TrackingJob,
} from "@shared/schema";

/** Refetch cadence while the tab is open, so PRM Stories results land without a reload. */
const LIVE_MS = 10_000;
/** How long a finished-but-failed job stays pinned at the top of the timeline. */
const FAILED_VISIBLE_MS = 10 * 60_000;

interface PaginatedHistory {
  items: SocialAccountHistoryEntry[];
  total: number;
  page: number;
  totalPages: number;
}

const KINDS: { value: SocialAccountHistoryKind; label: string }[] = [
  { value: "all", label: "All" },
  { value: "direct", label: "This account" },
  { value: "neighbour", label: "Observed elsewhere" },
];

const formatDateTime = (value: Date | string) =>
  new Date(value).toLocaleString([], {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

const PROFILE_FIELD_LABELS: Record<string, string> = {
  username: "username changed",
  nickname: "display name changed",
  bio: "bio changed",
  location: "location changed",
  image: "photo changed",
  joined: "date joined recorded",
};

type Part = { text: string; tone: "gain" | "loss" | "neutral" };

/**
 * The one-line summary of a direct entry, built entirely from the count columns
 * and profileFieldsChanged — never from `delta`, which the list does not carry.
 *
 * An initial capture reads "5,000 followers captured" rather than "+5,000": the
 * first pull is not growth, and typing it as growth puts a fake spike at the
 * start of every account's history.
 */
function describeEntry(entry: SocialAccountHistoryEntry): Part[] {
  const parts: Part[] = [];
  const n = (value: number) => value.toLocaleString();

  if (entry.entryKind === "baseline") {
    // Synthetic, written by the migration: state as it stood, not a move.
    parts.push({ text: "starting point", tone: "neutral" });
    if (entry.followersAfter > 0) parts.push({ text: `${n(entry.followersAfter)} followers`, tone: "neutral" });
    if (entry.followingAfter > 0) parts.push({ text: `${n(entry.followingAfter)} following`, tone: "neutral" });
  } else if (entry.isInitialCapture) {
    if (entry.followersAfter > 0) parts.push({ text: `${n(entry.followersAfter)} followers captured`, tone: "neutral" });
    if (entry.followingAfter > 0) parts.push({ text: `${n(entry.followingAfter)} following captured`, tone: "neutral" });
  } else {
    if (entry.followersAdded > 0) parts.push({ text: `+${n(entry.followersAdded)} followers`, tone: "gain" });
    if (entry.followersLost > 0) parts.push({ text: `−${n(entry.followersLost)} followers`, tone: "loss" });
    if (entry.followingAdded > 0) parts.push({ text: `+${n(entry.followingAdded)} following`, tone: "gain" });
    if (entry.followingLost > 0) parts.push({ text: `−${n(entry.followingLost)} following`, tone: "loss" });
  }

  if (entry.postsAdded > 0) parts.push({ text: `${n(entry.postsAdded)} ${entry.postsAdded === 1 ? "post" : "posts"} imported`, tone: "gain" });
  if (entry.postsDeleted > 0) parts.push({ text: `${n(entry.postsDeleted)} ${entry.postsDeleted === 1 ? "post" : "posts"} deleted`, tone: "loss" });

  for (const field of entry.profileFieldsChanged) {
    // Image entries carry the tier transition; rows from before that column existed keep the generic label.
    const label =
      field === "image" && entry.imageChange
        ? PROFILE_IMAGE_CHANGE_LABELS[entry.imageChange as ProfileImageChange] ?? PROFILE_FIELD_LABELS.image
        : PROFILE_FIELD_LABELS[field];
    if (label) parts.push({ text: label, tone: "neutral" });
  }

  if (parts.length === 0) {
    parts.push({ text: entry.captureScope === "posts" ? "posts checked, nothing new" : "no changes recorded", tone: "neutral" });
  }
  return parts;
}

/**
 * What a neighbour entry means, from the point of view of the account being
 * viewed. A gained follower is the observed-via account following them; a gained
 * following is the reverse.
 */
function describeNeighbour(entry: SocialAccountHistoryEntry): string {
  if (entry.followersAdded > 0) return "started following you";
  if (entry.followersLost > 0) return "unfollowed you";
  if (entry.followingAdded > 0) return "you started following them";
  if (entry.followingLost > 0) return "you unfollowed them";
  return "appeared in their scrape";
}

const TONE_CLASS: Record<Part["tone"], string> = {
  gain: "text-green-600 dark:text-green-400",
  loss: "text-destructive",
  neutral: "text-muted-foreground",
};

export function SocialAccountHistoryTab({
  socialAccountId,
  current,
  canTrack = false,
}: {
  socialAccountId: string;
  /** The account as it stands today — the "after" side of every profile change. */
  current?: CurrentProfileValues;
  /** Instagram accounts can be refreshed through PRM Stories; others get no menu. */
  canTrack?: boolean;
}) {
  const [kind, setKind] = useState<SocialAccountHistoryKind>("all");
  const [openEntryId, setOpenEntryId] = useState<string | null>(null);
  const { toast } = useToast();

  const { data: importers } = useImporters();
  const hasImporter = importers ? importers.length > 0 : true;

  const jobsKey = [`/api/social-accounts/${socialAccountId}/tracking-jobs`];
  const { data: jobs } = useQuery<TrackingJob[]>({
    queryKey: jobsKey,
    enabled: canTrack && !!socialAccountId,
    refetchInterval: (query) => {
      const data = query.state.data as TrackingJob[] | undefined;
      const hasOpen = data?.some((j) => j.status === "queued" || j.status === "running");
      return hasOpen ? 2_000 : LIVE_MS;
    },
  });
  const openJobs = (jobs ?? []).filter((j) => j.status === "queued" || j.status === "running");
  const recentFailures = (jobs ?? []).filter(
    (j) =>
      (j.status === "failed" || j.status === "skipped") &&
      j.finishedAt &&
      Date.now() - new Date(j.finishedAt).getTime() < FAILED_VISIBLE_MS,
  );
  const pinnedJobs = [...openJobs, ...recentFailures];

  const prevOpenJobIdsRef = useRef<string[] | null>(null);
  useEffect(() => {
    if (!jobs) return;
    const currentOpenIds = openJobs.map((j) => j.id);
    if (prevOpenJobIdsRef.current !== null) {
      const finishedAny = prevOpenJobIdsRef.current.some((id) => !currentOpenIds.includes(id));
      if (finishedAny) {
        // The account itself too: it is the "after" side of every profile change.
        queryClient.invalidateQueries({ queryKey: ["/api/social-accounts", socialAccountId] });
      }
    }
    prevOpenJobIdsRef.current = currentOpenIds;
  }, [jobs, openJobs, socialAccountId]);

  const queue = useMutation({
    mutationFn: (jobKind: TrackingKind) =>
      apiRequest("POST", `/api/social-accounts/${socialAccountId}/tracking-jobs`, { kind: jobKind }),
    onSuccess: (_r, jobKind) => {
      queryClient.invalidateQueries({ queryKey: jobsKey });
      toast({ title: "Queued", description: `${TRACKING_KIND_LABEL[jobKind]} was sent to PRM Stories.` });
    },
    onError: (e: Error) => toast({ title: "Not queued", description: e.message, variant: "destructive" }),
  });

  const cancelJob = useMutation({
    mutationFn: (jobId: string) =>
      apiRequest("DELETE", `/api/social-accounts/${socialAccountId}/tracking-jobs/${jobId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: jobsKey });
      toast({ title: "Removed", description: "The pending check was cancelled." });
    },
    onError: (e: Error) => toast({ title: "Failed to cancel", description: e.message, variant: "destructive" }),
  });

  const { data: summary } = useQuery<SocialAccountHistorySummary>({
    queryKey: ["/api/social-accounts", socialAccountId, "history", "summary"],
    queryFn: async () => {
      const res = await fetch(`/api/social-accounts/${socialAccountId}/history/summary`);
      if (!res.ok) throw new Error("Failed to fetch history summary");
      return res.json();
    },
    enabled: !!socialAccountId,
    refetchInterval: LIVE_MS,
  });

  const { data, isLoading, fetchNextPage, hasNextPage, isFetchingNextPage } =
    useInfiniteQuery<PaginatedHistory>({
      queryKey: ["/api/social-accounts", socialAccountId, "history", kind],
      queryFn: async ({ pageParam }) => {
        const res = await fetch(
          `/api/social-accounts/${socialAccountId}/history?kind=${kind}&page=${pageParam}&limit=25`,
        );
        if (!res.ok) throw new Error("Failed to fetch history");
        return res.json();
      },
      initialPageParam: 1,
      getNextPageParam: (lastPage) =>
        lastPage.page < lastPage.totalPages ? lastPage.page + 1 : undefined,
      enabled: !!socialAccountId,
    });

  // Only the lightweight summary polls: polling an infinite query refetches every
  // loaded page on each tick. When the summary shows new entries, refresh the list.
  const summarySigRef = useRef<string | null>(null);
  useEffect(() => {
    if (!summary) return;
    const sig = `${summary.direct}|${summary.neighbour}|${summary.baseline}|${summary.lastEntryAt ?? ""}`;
    if (summarySigRef.current !== null && summarySigRef.current !== sig) {
      // Every kind's list, not just the visible one: staleTime is Infinity, so a
      // cached list for another filter would otherwise never catch up.
      for (const { value } of KINDS) {
        queryClient.invalidateQueries({ queryKey: ["/api/social-accounts", socialAccountId, "history", value] });
      }
    }
    summarySigRef.current = sig;
  }, [summary, socialAccountId]);

  const entries = data?.pages.flatMap((p) => p.items) ?? [];
  const total = data?.pages[0]?.total ?? 0;

  // Baselines are only reachable under "All": kind=direct filters on the entry
  // kind, so counting them under "This account" would not match the rows listed.
  const kindCount = (value: SocialAccountHistoryKind) => {
    if (!summary) return null;
    if (value === "all") return summary.direct + summary.neighbour + summary.baseline;
    if (value === "direct") return summary.direct;
    return summary.neighbour;
  };

  return (
    <div className="px-6 py-6 space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3 flex-wrap">
        <div
          className="inline-flex items-center gap-1 rounded-md border p-1"
          data-testid="toggle-history-kind"
        >
          {KINDS.map((option) => (
            <Button
              key={option.value}
              variant={kind === option.value ? "secondary" : "ghost"}
              size="sm"
              onClick={() => setKind(option.value)}
              data-testid={`button-history-kind-${option.value}`}
            >
              {option.label}
              {kindCount(option.value) !== null && (
                <span className="ml-1.5 text-xs text-muted-foreground">{kindCount(option.value)}</span>
              )}
            </Button>
          ))}
        </div>
        {summary?.lastEntryAt && (
          <p className="text-xs text-muted-foreground" data-testid="text-history-last-entry">
            Last entry {formatDateTime(summary.lastEntryAt)}
          </p>
        )}
        </div>

        {canTrack && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" data-testid="button-update-from-stories">
                Update from PRM Stories
                <ChevronDown className="h-4 w-4 ml-1" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {!hasImporter && (
                <>
                  <DropdownMenuLabel className="font-normal text-xs text-muted-foreground max-w-56">
                    No PRM Stories importer configured. Add one under Settings → Instagram importers.
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                </>
              )}
              {TRACKING_KINDS.map((jobKind) => {
                const inFlight = openJobs.some((j) => j.kind === jobKind);
                return (
                  <DropdownMenuItem
                    key={jobKind}
                    disabled={!hasImporter || inFlight || queue.isPending}
                    onSelect={() => queue.mutate(jobKind)}
                    data-testid={`menu-item-track-${jobKind}`}
                  >
                    {TRACKING_KIND_LABEL[jobKind]}
                    {inFlight && <Loader2 className="h-3 w-3 animate-spin ml-auto" />}
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      {isLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      ) : entries.length === 0 && pinnedJobs.length === 0 ? (
        <p className="text-sm text-muted-foreground italic" data-testid="text-history-empty">
          No history recorded yet.
        </p>
      ) : (
        // A single rail down the left keeps chronology legible when direct and
        // neighbour entries are interleaved under "All".
        <div className="relative space-y-3 pl-6 before:absolute before:left-2 before:top-2 before:bottom-2 before:w-px before:bg-border">
          {pinnedJobs.map((job) => (
            <PendingJob key={job.id} job={job} onCancel={() => cancelJob.mutate(job.id)} />
          ))}

          {entries.map((entry) =>
            entry.entryKind === "neighbour" ? (
              <NeighbourEntry key={entry.id} entry={entry} />
            ) : (
              <DirectEntry key={entry.id} entry={entry} onOpen={() => setOpenEntryId(entry.id)} />
            ),
          )}

          {hasNextPage && (
            <div className="pt-2 flex flex-col items-center gap-1">
              <p className="text-xs text-muted-foreground" data-testid="text-history-loaded">
                Showing {entries.length} of {total}
              </p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => fetchNextPage()}
                disabled={isFetchingNextPage}
                data-testid="button-history-load-more"
              >
                {isFetchingNextPage ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
                    Loading…
                  </>
                ) : (
                  "Load older entries"
                )}
              </Button>
            </div>
          )}
        </div>
      )}

      <SocialAccountHistoryModal
        entryId={openEntryId}
        current={current}
        onClose={() => setOpenEntryId(null)}
      />
    </div>
  );
}

/** A PRM Stories job that hasn't produced a history entry yet, pinned above the timeline. */
function PendingJob({ job, onCancel }: { job: TrackingJob; onCancel?: () => void }) {
  const label = TRACKING_KIND_LABEL[job.kind as TrackingKind] ?? job.kind;
  const failed = job.status === "failed" || job.status === "skipped";
  const reason = job.error ?? (job.result as { reason?: string } | null)?.reason;
  return (
    <div
      className={`relative rounded-xl border border-dashed px-4 py-3 text-sm ${
        failed ? "border-destructive/50 bg-destructive/5" : "bg-muted/40"
      }`}
      data-testid={`pending-job-${job.id}`}
    >
      <span
        className={`absolute -left-[1.125rem] top-4 h-2 w-2 rounded-full ring-2 ring-background ${
          failed ? "bg-destructive" : "bg-primary"
        }`}
      />
      <div className="flex items-center gap-2 flex-wrap">
        {failed ? (
          <AlertCircle className="h-4 w-4 text-destructive shrink-0" />
        ) : job.status === "running" ? (
          <Loader2 className="h-4 w-4 animate-spin text-primary shrink-0" />
        ) : (
          <Clock className="h-4 w-4 text-muted-foreground shrink-0" />
        )}
        <span className="font-medium">{label}</span>
        <Badge variant={failed ? "destructive" : "secondary"} className="text-xs">
          {job.status === "queued"
            ? "Waiting for PRM Stories"
            : job.status === "running"
              ? "Running in PRM Stories"
              : job.status === "skipped"
                ? "Skipped"
                : "Failed"}
        </Badge>
        <div className="flex items-center gap-1.5 ml-auto">
          <span className="text-xs text-muted-foreground">
            {formatDateTime(job.finishedAt ?? job.startedAt ?? job.createdAt)}
          </span>
          {onCancel && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive shrink-0"
              title="Cancel check"
              onClick={onCancel}
              data-testid={`button-cancel-job-${job.id}`}
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </div>
      {failed && reason && <p className="mt-1 text-xs text-destructive">{reason}</p>}
    </div>
  );
}

function DirectEntry({ entry, onOpen }: { entry: SocialAccountHistoryEntry; onOpen: () => void }) {
  const changedImage = entry.profileFieldsChanged.includes("image");
  return (
    <Card
      className="p-4 cursor-pointer hover-elevate"
      onClick={onOpen}
      data-testid={`card-history-entry-${entry.id}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <p className="text-sm font-semibold">{formatDateTime(entry.detectedAt)}</p>
          <p className="text-sm flex flex-wrap gap-x-2 gap-y-0.5">
            {describeEntry(entry).map((part, i) => (
              <span key={i} className={TONE_CLASS[part.tone]}>
                {i > 0 && <span className="text-muted-foreground mr-2">·</span>}
                {part.text}
              </span>
            ))}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {changedImage && (
            <div className="flex items-center gap-1">
              <Avatar className="w-8 h-8 opacity-60">
                {(entry.previousImageUrlHq ?? entry.previousImageUrl) && (
                  <AvatarImage src={entry.previousImageUrlHq ?? entry.previousImageUrl ?? undefined} alt="previous" />
                )}
                <AvatarFallback className="text-[10px]">old</AvatarFallback>
              </Avatar>
              <span className="text-muted-foreground text-xs">→</span>
            </div>
          )}
          <Badge variant="secondary" className="text-[10px]">{entry.changeSource}</Badge>
        </div>
      </div>
    </Card>
  );
}

/** Marginalia: half the height, muted, a rail tick rather than a card. */
function NeighbourEntry({ entry }: { entry: SocialAccountHistoryEntry }) {
  const via = entry.observedVia;
  return (
    <div
      className="border-l-2 pl-3 py-1 text-xs text-muted-foreground flex items-center gap-2"
      data-testid={`card-history-entry-${entry.id}`}
    >
      {via && (
        <Avatar className="w-5 h-5">
          {via.imageUrl && <AvatarImage src={via.imageUrl} alt={via.username} />}
          <AvatarFallback className="text-[9px]">{getInitials(via.username)}</AvatarFallback>
        </Avatar>
      )}
      <span className="italic truncate">
        {via ? `via @${via.username} — ` : ""}
        {describeNeighbour(entry)}
      </span>
      <span className="ml-auto shrink-0 tabular-nums">{formatDateTime(entry.detectedAt)}</span>
    </div>
  );
}
