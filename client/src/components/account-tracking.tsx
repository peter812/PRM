/**
 * Tracking on an Instagram account's page (account-tracking-plan.md §5.1):
 * the interest level sits in Account Details; everything else — the three
 * cadences with their last/next dates and the buttons that queue a check for
 * prm-stories to run — lives behind the "Edit tracking" dialog.
 */
import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { SocialAccount, TrackingJob } from "@shared/schema";
import {
  INTEREST_LEVEL_LABEL,
  TRACKING_KIND_LABEL,
  TRACKING_KINDS,
  parseLevelCadences,
  resolveCadence,
  trackingBlocker,
  type TrackingKind,
} from "@shared/interest-level";
import { InterestLevelSelect, asLevel } from "@/components/interest-level-badge";

const ROW: Record<TrackingKind, { override: "infoEveryDays" | "followsEveryDays" | "postsEveryDays"; checked: "infoCheckedAt" | "followsCheckedAt" | "postsCheckedAt"; due: "infoDueAt" | "followsDueAt" | "postsDueAt" }> = {
  info: { override: "infoEveryDays", checked: "infoCheckedAt", due: "infoDueAt" },
  follows: { override: "followsEveryDays", checked: "followsCheckedAt", due: "followsDueAt" },
  posts: { override: "postsEveryDays", checked: "postsCheckedAt", due: "postsDueAt" },
};

const BLOCKER_TEXT = { private: "private account", too_many_follows: "over 10,000 follows — header count only" } as const;

const when = (d: string | Date | null | undefined) => (d ? new Date(d).toLocaleDateString([], { month: "short", day: "numeric" }) : "—");

export function AccountTracking({ account }: { account: SocialAccount }) {
  const { toast } = useToast();
  const { data: settings } = useQuery<Record<string, string | null>>({ queryKey: ["/api/settings"] });
  const { data: jobs } = useQuery<TrackingJob[]>({ queryKey: [`/api/social-accounts/${account.id}/tracking-jobs`], refetchInterval: 30_000 });
  const cadence = resolveCadence(account, parseLevelCadences(settings?.tracking_level_defaults));
  const [editing, setEditing] = useState(false);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: [`/api/social-accounts/${account.id}`] });
    queryClient.invalidateQueries({ queryKey: [`/api/social-accounts/${account.id}/tracking-jobs`] });
  };
  const patch = useMutation({
    mutationFn: (body: Record<string, unknown>) => apiRequest("PATCH", `/api/social-accounts/${account.id}`, body),
    onSuccess: invalidate,
    onError: (e: Error) => toast({ title: "Not saved", description: e.message, variant: "destructive" }),
  });
  const queue = useMutation({
    mutationFn: (kind: TrackingKind) => apiRequest("POST", `/api/social-accounts/${account.id}/tracking-jobs`, { kind }),
    onSuccess: (_r, kind) => {
      invalidate();
      toast({ title: "Queued", description: `${TRACKING_KIND_LABEL[kind]} will run on the next tracking run.` });
    },
    onError: (e: Error) => toast({ title: "Not queued", description: e.message, variant: "destructive" }),
  });

  const open = (jobs ?? []).filter((j) => j.status === "queued" || j.status === "running");
  const finished = (jobs ?? []).filter((j) => j.status !== "queued" && j.status !== "running").slice(0, 10);
  const openKinds = new Set(open.map((j) => j.kind));
  const isNone = account.interestLevel === "none";

  return (
    <div data-testid="card-tracking">
      <span className="text-[10px] text-muted-foreground uppercase font-semibold block">Interest Level</span>
      <div className="flex items-center gap-2 mt-0.5">
        <InterestLevelSelect value={account.interestLevel} onChange={(interestLevel) => patch.mutate({ interestLevel })} className="h-8 w-36 text-xs" />
        {!account.interestLevelManual && !isNone && (
          <span className="text-[11px] text-muted-foreground">set automatically</span>
        )}
      </div>
      <Button variant="outline" size="sm" className="mt-2 h-7 text-xs gap-1.5" onClick={() => setEditing(true)} data-testid="button-edit-tracking">
        <RefreshCw className="h-3.5 w-3.5" />
        Edit tracking
        {open.length > 0 && <Badge variant="secondary" className="text-[10px] px-1 py-0 h-4 leading-none">{open.length} queued</Badge>}
      </Button>

      <Dialog open={editing} onOpenChange={setEditing}>
        <DialogContent className="max-w-2xl" data-testid="dialog-tracking">
          <DialogHeader>
            <DialogTitle>Tracking</DialogTitle>
            <DialogDescription>
              Level: {INTEREST_LEVEL_LABEL[asLevel(account.interestLevel)]}. Changing it resets the cadences below to its defaults. Days are how often prm-stories re-checks each thing.
            </DialogDescription>
          </DialogHeader>

      <div className="space-y-2">
        {TRACKING_KINDS.map((kind) => {
          const row = ROW[kind];
          const blocker = trackingBlocker(account, kind);
          return (
            <div key={kind} className="grid grid-cols-[1fr_auto] sm:grid-cols-[minmax(0,1.4fr)_90px_minmax(0,1fr)_minmax(0,1fr)_auto] gap-2 items-center text-xs border-b pb-2 last:border-0 last:pb-0">
              <div className="min-w-0">
                <div className="font-medium">{TRACKING_KIND_LABEL[kind]}</div>
                {blocker && <div className="text-[11px] text-muted-foreground">{BLOCKER_TEXT[blocker]}</div>}
              </div>
              <CadenceInput
                value={account[row.override]}
                inherited={cadence[kind]}
                disabled={isNone}
                onCommit={(days) => patch.mutate({ [row.override]: days })}
              />
              <div className="text-muted-foreground hidden sm:block">last {when(account[row.checked])}</div>
              <div className="text-muted-foreground hidden sm:block">{isNone || blocker ? "not scheduled" : `due ${when(account[row.due])}`}</div>
              <div className="flex items-center gap-1 col-span-2 sm:col-span-1 justify-end">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs"
                  disabled={queue.isPending || openKinds.has(kind) || Boolean(blocker)}
                  onClick={() => queue.mutate(kind)}
                  data-testid={`button-refresh-${kind}`}
                >
                  {openKinds.has(kind) ? "Queued" : "Refresh now"}
                </Button>
              </div>
            </div>
          );
        })}
      </div>

      {(open.length > 0 || finished.length > 0) && (
        <div className="space-y-1.5 text-xs">
          {open.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {open.map((j) => (
                <Badge key={j.id} variant="secondary" className="text-[11px] gap-1">
                  {j.status === "running" && <Loader2 className="h-3 w-3 animate-spin" />}
                  {TRACKING_KIND_LABEL[j.kind as TrackingKind]} · {j.status}
                </Badge>
              ))}
            </div>
          )}
          {finished.length > 0 && (
            <details>
              <summary className="cursor-pointer text-muted-foreground">Recent checks</summary>
              <ul className="mt-1 space-y-0.5">
                {finished.map((j) => (
                  <li key={j.id} className="flex justify-between gap-2">
                    <span>{TRACKING_KIND_LABEL[j.kind as TrackingKind]}</span>
                    <span className="text-muted-foreground truncate">
                      {when(j.finishedAt ?? j.createdAt)} · {j.status}
                      {(j.result as { reason?: string } | null)?.reason ? ` (${(j.result as { reason: string }).reason})` : ""}
                      {j.error ? ` — ${j.error}` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
        </DialogContent>
      </Dialog>

    </div>
  );
}

/** Days between checks; empty means "inherit", shown as the level's number in the placeholder. */
function CadenceInput({ value, inherited, disabled, onCommit }: { value: number | null; inherited: number | null; disabled: boolean; onCommit: (days: number | null) => void }) {
  const [text, setText] = useState(value == null ? "" : String(value));
  useEffect(() => setText(value == null ? "" : String(value)), [value]);
  const commit = () => {
    const n = text.trim() === "" ? null : Number(text);
    if (n !== null && (!Number.isInteger(n) || n < 1)) return setText(value == null ? "" : String(value));
    if (n !== value) onCommit(n);
  };
  return (
    <div className="flex items-center gap-1">
      <Input
        type="number"
        min={1}
        className="h-7 w-16 text-xs"
        placeholder={inherited == null ? "—" : String(inherited)}
        value={text}
        disabled={disabled}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
        data-testid="input-cadence-days"
      />
      <span className="text-[11px] text-muted-foreground">d</span>
    </div>
  );
}
