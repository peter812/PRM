// Social Accounts → Issues (account-issues-plan.md §6): accounts PRM can no
// longer check. A profile that 404'd is paused until it's renamed, dismissed
// or deleted here; a private one waits for the person to follow them and
// re-check, or to dismiss it.
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { AlertTriangle, Loader2, Lock, RefreshCw } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { getInitials } from "@/lib/utils";
import { withImageSize } from "@shared/image-size";
import type { IssueKind, SocialAccountIssue } from "@shared/schema";
import { TRACKING_KIND_LABEL, type TrackingKind } from "@shared/interest-level";

interface IssueRow {
  issue: SocialAccountIssue;
  account: {
    id: string;
    username: string;
    nickname: string | null;
    imageUrl: string | null;
    ownerUuid: string | null;
  };
  ownerName: string | null;
  openJob: { kind: TrackingKind; status: string } | null;
}

const OPEN_KEY = ["/api/account-issues"];
const CLOSED_KEY = ["/api/account-issues", { status: "closed" }];
const COUNT_KEY = ["/api/account-issues/count"];
/** OPEN_KEY is a prefix of CLOSED_KEY, so this refreshes both lists. */
const invalidateAll = () => {
  queryClient.invalidateQueries({ queryKey: OPEN_KEY });
  queryClient.invalidateQueries({ queryKey: COUNT_KEY });
};

const RESOLUTION_TEXT: Record<string, string> = {
  renamed: "renamed",
  recheck_ok: "a check got through",
  became_public: "went public again",
  dismissed: "dismissed",
};

const when = (d: string | Date | null | undefined) => (d ? new Date(d).toLocaleDateString([], { month: "short", day: "numeric" }) : "");

function describe(row: IssueRow): string {
  const { issue } = row;
  const job = issue.jobKind ? TRACKING_KIND_LABEL[issue.jobKind as TrackingKind].toLowerCase() : "a check";
  const times = issue.timesSeen > 1 ? ` (${issue.timesSeen} times since ${when(issue.firstSeenAt)})` : "";
  if (issue.kind === "not_found")
    return `Profile not found — the ${job} on ${when(issue.lastSeenAt)} got a 404${times}. Renamed, deleted or deactivated; scheduled checks are paused.`;
  return `Went private — the ${job} on ${when(issue.lastSeenAt)} couldn't read the list${times}. Follow them from your account and re-check, or dismiss.`;
}

function IssueCard({ row, onDelete }: { row: IssueRow; onDelete: () => void }) {
  const { toast } = useToast();
  const { issue, account } = row;
  const [renaming, setRenaming] = useState(false);
  const [username, setUsername] = useState(account.username);
  const [duplicate, setDuplicate] = useState<{
    id: string;
    username: string;
  } | null>(null);
  const fail = (title: string) => (e: Error) => toast({ title, description: e.message, variant: "destructive" });

  const rename = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/account-issues/${issue.id}/rename`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username }),
        credentials: "include",
      });
      const body = await res.json();
      if (res.status === 409 && body.duplicate) {
        setDuplicate(body.duplicate);
        return null;
      }
      if (!res.ok) throw new Error(body.error ?? res.statusText);
      return body as { username: string };
    },
    onSuccess: (r) => {
      if (!r) return;
      toast({
        title: `Renamed to @${r.username}`,
        description: "A profile check is queued to confirm it.",
      });
      invalidateAll();
    },
    onError: fail("Not renamed"),
  });
  // The rename when the name is already a row of its own: this row survives
  // and takes in the other's followers, posts and history (account-merge-plan.md).
  const merge = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/account-issues/${issue.id}/merge`, { intoUsername: duplicate!.username });
      return (await res.json()) as { username: string; merged: { followers: number; following: number; posts: number } };
    },
    onSuccess: ({ username, merged }) => {
      setDuplicate(null);
      toast({
        title: `Merged into @${username}`,
        description: `+${merged.followers} followers, +${merged.following} following, +${merged.posts} posts. A profile check is queued.`,
      });
      invalidateAll();
      queryClient.invalidateQueries({ queryKey: ["/api/social-accounts"] });
    },
    onError: fail("Not merged"),
  });
  const recheck = useMutation({
    mutationFn: () =>
      apiRequest("POST", `/api/social-accounts/${account.id}/tracking-jobs`, {
        kind: issue.kind === "private" ? "follows" : "info",
      }),
    onSuccess: () => {
      toast({
        title: "Queued",
        description: "It runs on the next tracking run.",
      });
      invalidateAll();
    },
    onError: fail("Not queued"),
  });
  const dismiss = useMutation({
    mutationFn: () => apiRequest("POST", `/api/account-issues/${issue.id}/dismiss`),
    onSuccess: invalidateAll,
    onError: fail("Not dismissed"),
  });

  return (
    <Card data-testid={`issue-${issue.id}`}>
      <CardContent className="p-4 flex gap-3">
        <Avatar className="w-12 h-12 shrink-0">
          {account.imageUrl && <AvatarImage src={withImageSize(account.imageUrl, 64)} alt={account.username} />}
          <AvatarFallback>{getInitials(account.username)}</AvatarFallback>
        </Avatar>
        <div className="flex-1 min-w-0 space-y-2">
          <div className="flex items-center gap-2 flex-wrap text-sm">
            {issue.kind === "not_found" ? (
              <AlertTriangle className="h-4 w-4 text-destructive shrink-0" />
            ) : (
              <Lock className="h-4 w-4 text-amber-500 shrink-0" />
            )}
            <Link href={`/social-accounts/${account.id}`} className="font-medium hover:underline">
              @{account.username}
            </Link>
            {account.nickname && <span className="text-muted-foreground">{account.nickname}</span>}
            {account.ownerUuid && row.ownerName && (
              <Link href={`/person/${account.ownerUuid}`} className="text-muted-foreground hover:underline">
                · {row.ownerName}
              </Link>
            )}
          </div>
          <p className="text-sm text-muted-foreground">{describe(row)}</p>
          {renaming && (
            <form
              className="flex items-center gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                setDuplicate(null);
                rename.mutate();
              }}
            >
              <span className="text-sm text-muted-foreground">@</span>
              <Input value={username} onChange={(e) => setUsername(e.target.value)} className="h-8 max-w-xs" autoFocus data-testid="input-rename" />
              <Button type="submit" size="sm" disabled={rename.isPending || !username.trim() || username.trim() === account.username}>
                {rename.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setRenaming(false)}>
                Cancel
              </Button>
            </form>
          )}
          <AlertDialog open={!!duplicate} onOpenChange={(open) => !open && !merge.isPending && setDuplicate(null)}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Merge with @{duplicate?.username}?</AlertDialogTitle>
                <AlertDialogDescription>
                  <Link href={`/social-accounts/${duplicate?.id}`} className="underline">
                    @{duplicate?.username}
                  </Link>{" "}
                  is already another account in PRM — probably this person, added by a follows scrape after the rename. Merging keeps @
                  {account.username} (this row, its history and settings), folds in everything PRM knows about @{duplicate?.username}, renames it,
                  and deletes the other row. Links to that row's page will stop working. This cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel data-testid="button-cancel-merge">Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={(e) => { e.preventDefault(); merge.mutate(); }} disabled={merge.isPending} data-testid="button-confirm-merge">
                  {merge.isPending ? "Merging…" : "Merge"}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
          <div className="flex items-center gap-2 flex-wrap">
            {issue.kind === "not_found" && !renaming && (
              <Button size="sm" variant="outline" onClick={() => setRenaming(true)} data-testid="button-rename">
                Rename…
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              onClick={() => recheck.mutate()}
              disabled={recheck.isPending || Boolean(row.openJob)}
              data-testid="button-recheck"
            >
              <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
              Re-check
            </Button>
            <Button size="sm" variant="ghost" onClick={() => dismiss.mutate()} disabled={dismiss.isPending} data-testid="button-dismiss">
              Dismiss
            </Button>
            <Button size="sm" variant="ghost" className="text-destructive" onClick={onDelete} data-testid="button-delete">
              Delete account
            </Button>
            {row.openJob && (
              <span className="text-xs text-muted-foreground flex items-center gap-1">
                {row.openJob.status === "running" && <Loader2 className="h-3 w-3 animate-spin" />}
                {TRACKING_KIND_LABEL[row.openJob.kind]} {row.openJob.status}
              </span>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function ClosedIssues() {
  const { data = [], isLoading } = useQuery<IssueRow[]>({
    queryKey: CLOSED_KEY,
  });
  if (isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (data.length === 0) return <p className="text-sm text-muted-foreground">Nothing resolved yet.</p>;
  return (
    <ul className="text-sm space-y-1" data-testid="list-closed-issues">
      {data.map(({ issue, account }) => (
        <li key={issue.id} className="flex gap-2 flex-wrap text-muted-foreground">
          <span>{when(issue.resolvedAt)}</span>
          <Link href={`/social-accounts/${account.id}`} className="text-foreground hover:underline">
            @{account.username}
          </Link>
          <span>
            {issue.kind === "not_found" ? "not found" : "private"} · {RESOLUTION_TEXT[issue.resolution ?? ""] ?? issue.resolution}
            {issue.previousUsername && ` from @${issue.previousUsername}`}
          </span>
        </li>
      ))}
    </ul>
  );
}

export default function SocialAccountsIssuesPage() {
  const { toast } = useToast();
  const [showClosed, setShowClosed] = useState(false);
  const [toDelete, setToDelete] = useState<IssueRow["account"] | null>(null);
  const { data, isLoading } = useQuery<IssueRow[]>({
    queryKey: OPEN_KEY,
    // Follow a re-check through while one is queued; otherwise one request a minute.
    refetchInterval: (q) => (q.state.data?.some((r) => r.openJob) ? 10_000 : 60_000),
  });
  const remove = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/social-accounts/${id}`),
    onSuccess: () => {
      toast({ title: "Account deleted" });
      setToDelete(null);
      invalidateAll();
      queryClient.invalidateQueries({ queryKey: ["/api/social-accounts"] });
    },
    onError: (e: Error) =>
      toast({
        title: "Not deleted",
        description: e.message,
        variant: "destructive",
      }),
  });

  const counts = { not_found: 0, private: 0 } as Record<IssueKind, number>;
  for (const r of data ?? []) counts[r.issue.kind as IssueKind]++;

  return (
    <div className="h-full overflow-y-auto">
      <div className="container max-w-full md:max-w-3xl py-3 md:py-8 px-4 md:pl-12">
        <div className="mb-6">
          <h1 className="text-2xl font-semibold" data-testid="text-issues-title">
            Issues
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Accounts the Instagram importer can no longer check. Fix the username, re-check, dismiss, or delete the account.
          </p>
        </div>

        {isLoading || !data ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        ) : data.length === 0 ? (
          <p className="text-sm text-muted-foreground" data-testid="text-no-issues">
            Every tracked account is reachable.
          </p>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground" data-testid="text-issue-counts">
              {counts.not_found} not found · {counts.private} private
            </p>
            {data.map((row) => (
              <IssueCard key={row.issue.id} row={row} onDelete={() => setToDelete(row.account)} />
            ))}
          </div>
        )}

        <div className="mt-8 border-t pt-4">
          <Button variant="ghost" size="sm" className="px-0" onClick={() => setShowClosed((v) => !v)} data-testid="button-toggle-closed">
            {showClosed ? "Hide resolved" : "Show resolved"}
          </Button>
          {showClosed && <ClosedIssues />}
        </div>

        <AlertDialog open={!!toDelete} onOpenChange={(open) => !open && setToDelete(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete Social Account</AlertDialogTitle>
              <AlertDialogDescription>
                Are you sure you want to delete @{toDelete?.username}? This will permanently remove this account and unlink it from any associated
                people. This action cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel data-testid="button-cancel-delete">Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => toDelete && remove.mutate(toDelete.id)}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                disabled={remove.isPending}
                data-testid="button-confirm-delete"
              >
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  );
}
