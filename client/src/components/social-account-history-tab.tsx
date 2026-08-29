import { useState } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { getInitials } from "@/lib/utils";
import { SocialAccountHistoryModal, type CurrentProfileValues } from "@/components/social-account-history-modal";
import type {
  SocialAccountHistoryEntry,
  SocialAccountHistoryKind,
  SocialAccountHistorySummary,
} from "@shared/schema";

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
  nickname: "display name changed",
  bio: "bio changed",
  location: "location changed",
  image: "photo changed",
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

  for (const field of entry.profileFieldsChanged) {
    const label = PROFILE_FIELD_LABELS[field];
    if (label) parts.push({ text: label, tone: "neutral" });
  }

  if (parts.length === 0) parts.push({ text: "no changes recorded", tone: "neutral" });
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
}: {
  socialAccountId: string;
  /** The account as it stands today — the "after" side of every profile change. */
  current?: CurrentProfileValues;
}) {
  const [kind, setKind] = useState<SocialAccountHistoryKind>("all");
  const [openEntryId, setOpenEntryId] = useState<string | null>(null);

  const { data: summary } = useQuery<SocialAccountHistorySummary>({
    queryKey: ["/api/social-accounts", socialAccountId, "history", "summary"],
    queryFn: async () => {
      const res = await fetch(`/api/social-accounts/${socialAccountId}/history/summary`);
      if (!res.ok) throw new Error("Failed to fetch history summary");
      return res.json();
    },
    enabled: !!socialAccountId,
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

      {isLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      ) : entries.length === 0 ? (
        <p className="text-sm text-muted-foreground italic" data-testid="text-history-empty">
          No history recorded yet.
        </p>
      ) : (
        // A single rail down the left keeps chronology legible when direct and
        // neighbour entries are interleaved under "All".
        <div className="relative space-y-3 pl-6 before:absolute before:left-2 before:top-2 before:bottom-2 before:w-px before:bg-border">
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
                data-testid="button-load-more-history"
              >
                {isFetchingNextPage ? (
                  <><Loader2 className="h-3 w-3 animate-spin mr-1" />Loading...</>
                ) : (
                  "Load more"
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
                {entry.previousImageUrl && <AvatarImage src={entry.previousImageUrl} alt="previous" />}
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
