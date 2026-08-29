import { useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { ChevronDown, Loader2 } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { SocialAccountRow } from "@/components/social-account-row";
import type { HistoryAccountList, SocialAccountHistoryDetail } from "@shared/schema";

/** The account's values today, which is what a previous* value is a change away from. */
export interface CurrentProfileValues {
  nickname?: string | null;
  bio?: string | null;
  location?: string | null;
  imageUrl?: string | null;
}

const LIST_PAGE = 100;

const formatDateTime = (value: Date | string) =>
  new Date(value).toLocaleString([], {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

export function SocialAccountHistoryModal({
  entryId,
  current,
  onClose,
}: {
  entryId: string | null;
  current?: CurrentProfileValues;
  onClose: () => void;
}) {
  // The endpoint pages all four id arrays together, so one "Load more" extends
  // whichever of them still has rows left.
  const { data, isLoading, fetchNextPage, hasNextPage, isFetchingNextPage } =
    useInfiniteQuery<SocialAccountHistoryDetail>({
      queryKey: ["/api/social-accounts/history", entryId],
      queryFn: async ({ pageParam }) => {
        const res = await fetch(
          `/api/social-accounts/history/${entryId}?listLimit=${LIST_PAGE}&listOffset=${pageParam}`,
        );
        if (!res.ok) throw new Error("Failed to fetch history entry");
        return res.json();
      },
      initialPageParam: 0,
      getNextPageParam: (lastPage, allPages) => {
        const loaded = allPages.length * LIST_PAGE;
        const biggest = Math.max(
          lastPage.followersAddedList.total,
          lastPage.followersLostList.total,
          lastPage.followingAddedList.total,
          lastPage.followingLostList.total,
        );
        return loaded < biggest ? loaded : undefined;
      },
      enabled: !!entryId,
    });

  const entry = data?.pages[0];
  const merge = (pick: (page: SocialAccountHistoryDetail) => HistoryAccountList): HistoryAccountList => ({
    total: entry ? pick(entry).total : 0,
    items: (data?.pages ?? []).flatMap((page) => pick(page).items),
  });

  return (
    <Dialog open={!!entryId} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg" data-testid="dialog-history-entry">
        {isLoading || !entry ? (
          <>
            <DialogHeader>
              <DialogTitle>Import details</DialogTitle>
              <DialogDescription>Loading this entry…</DialogDescription>
            </DialogHeader>
            <Skeleton className="h-40 w-full" />
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle data-testid="text-history-entry-date">
                {formatDateTime(entry.detectedAt)}
              </DialogTitle>
              <DialogDescription className="flex flex-wrap items-center gap-1.5 pt-1">
                <Badge variant="secondary">{entry.changeSource}</Badge>
                <Badge variant="outline">captured: {entry.captureScope}</Badge>
                {entry.isInitialCapture && <Badge>initial capture</Badge>}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 pt-1 max-h-[60vh] overflow-y-auto pr-1">
              {entry.profileFieldsChanged.includes("image") && (
                <Section title="Profile image">
                  <div className="flex items-center gap-4">
                    <ImageSide label="Before" url={entry.previousImageUrl} />
                    <span className="text-muted-foreground">→</span>
                    <ImageSide label="Now" url={current?.imageUrl} />
                  </div>
                </Section>
              )}

              {entry.profileFieldsChanged.includes("nickname") && (
                <BeforeAfter title="Display name" before={entry.previousNickname} after={current?.nickname} />
              )}
              {entry.profileFieldsChanged.includes("bio") && (
                <BeforeAfter title="Bio" before={entry.previousBio} after={current?.bio} />
              )}
              {entry.profileFieldsChanged.includes("location") && (
                <BeforeAfter title="Location" before={entry.previousLocation} after={current?.location} />
              )}

              <CountSection
                title="Followers"
                after={entry.followersAfter}
                added={entry.followersAdded}
                lost={entry.followersLost}
                reported={entry.reportedFollowersAfter}
                isInitialCapture={entry.isInitialCapture}
                addedList={merge((p) => p.followersAddedList)}
                lostList={merge((p) => p.followersLostList)}
                onClose={onClose}
              />
              <CountSection
                title="Following"
                after={entry.followingAfter}
                added={entry.followingAdded}
                lost={entry.followingLost}
                reported={entry.reportedFollowingAfter}
                isInitialCapture={entry.isInitialCapture}
                addedList={merge((p) => p.followingAddedList)}
                lostList={merge((p) => p.followingLostList)}
                onClose={onClose}
              />

              {hasNextPage && (
                <div className="flex justify-center">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => fetchNextPage()}
                    disabled={isFetchingNextPage}
                    data-testid="button-load-more-history-accounts"
                  >
                    {isFetchingNextPage ? (
                      <><Loader2 className="h-3 w-3 animate-spin mr-1" />Loading...</>
                    ) : (
                      "Load more accounts"
                    )}
                  </Button>
                </div>
              )}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <p className="text-sm font-semibold">{title}</p>
      {children}
    </div>
  );
}

function ImageSide({ label, url }: { label: string; url?: string | null }) {
  return (
    <div className="flex flex-col items-center gap-1">
      <Avatar className="w-14 h-14">
        {url && <AvatarImage src={url} alt={label} />}
        <AvatarFallback className="text-xs">{label}</AvatarFallback>
      </Avatar>
      <span className="text-[10px] text-muted-foreground uppercase tracking-wider">{label}</span>
    </div>
  );
}

function BeforeAfter({ title, before, after }: { title: string; before: string | null; after?: string | null }) {
  return (
    <Section title={title}>
      <div className="text-sm space-y-1">
        <p className="text-muted-foreground line-through whitespace-pre-wrap break-words">
          {before || <span className="italic no-underline">empty</span>}
        </p>
        <p className="whitespace-pre-wrap break-words">
          {after || <span className="italic text-muted-foreground">empty</span>}
        </p>
      </div>
    </Section>
  );
}

/**
 * One direction of the network. The header line reads from the count columns; the
 * lists come from the resolved `delta` and only render when there is something in
 * them, so an entry that moved nothing shows nothing.
 */
function CountSection({
  title,
  after,
  added,
  lost,
  reported,
  isInitialCapture,
  addedList,
  lostList,
  onClose,
}: {
  title: string;
  after: number;
  added: number;
  lost: number;
  reported: number | null;
  isInitialCapture: boolean;
  addedList: HistoryAccountList;
  lostList: HistoryAccountList;
  onClose: () => void;
}) {
  if (added === 0 && lost === 0) return null;

  const before = after - added + lost;
  const n = (value: number) => value.toLocaleString();

  return (
    <>
      <Separator />
      <Section title={title}>
        <p className="text-sm" data-testid={`text-history-${title.toLowerCase()}-counts`}>
          {isInitialCapture ? (
            <span>{n(after)} captured</span>
          ) : (
            <>
              <span className="text-muted-foreground">{n(before)} → </span>
              <span className="font-medium">{n(after)}</span>
              <span className="text-muted-foreground"> (</span>
              {added > 0 && <span className="text-green-600 dark:text-green-400">+{n(added)}</span>}
              {added > 0 && lost > 0 && <span className="text-muted-foreground">, </span>}
              {lost > 0 && <span className="text-destructive">−{n(lost)}</span>}
              <span className="text-muted-foreground">)</span>
            </>
          )}
        </p>

        {/* The honest signal about how complete the scrape was. */}
        {reported !== null && reported !== after && (
          <p className="text-xs text-muted-foreground italic" data-testid={`text-history-${title.toLowerCase()}-reported`}>
            Instagram reports {n(reported)}; {n(after)} captured
          </p>
        )}

        <AccountList title={isInitialCapture ? "Captured" : "Added"} list={addedList} testId={`${title.toLowerCase()}-added`} onNavigate={onClose} />
        <AccountList title="Lost" list={lostList} testId={`${title.toLowerCase()}-lost`} onNavigate={onClose} />
      </Section>
    </>
  );
}

function AccountList({
  title,
  list,
  testId,
  onNavigate,
}: {
  title: string;
  list: HistoryAccountList;
  testId: string;
  onNavigate: () => void;
}) {
  const [open, setOpen] = useState(false);
  if (list.total === 0) return null;

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <Button variant="ghost" size="sm" className="px-2" data-testid={`button-history-${testId}`}>
          <ChevronDown className={`h-3 w-3 mr-1 transition-transform ${open ? "" : "-rotate-90"}`} />
          {title} ({list.total.toLocaleString()})
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="pt-1">
        {list.items.map((account) => (
          <SocialAccountRow
            key={account.id}
            id={account.id}
            username={account.username}
            imageUrl={account.imageUrl}
            testIdPrefix={`history-${testId}`}
            onNavigate={onNavigate}
          />
        ))}
        {list.items.length < list.total && (
          <p className="text-xs text-muted-foreground px-2 pt-1">
            Showing {list.items.length.toLocaleString()} of {list.total.toLocaleString()}
          </p>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}
