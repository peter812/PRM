// Social Accounts → Tracking: refresh everyone I follow in one go. The button
// queues a manual profile-info job per followed account as one batch; the
// scheduler drains it as a chain of runs of `tracking_max_jobs` each
// (server/stories-scheduler.ts). This page shows the batch's progress and
// whatever is holding the queue up.
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Loader2, RefreshCw, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { RECENT_CHECK_HOURS, TRACKING_KIND_LABEL, type TrackingKind } from "@shared/interest-level";

interface Batch {
  id: string;
  kind: TrackingKind;
  createdAt: string;
  total: number;
  queued: number;
  running: number;
  completed: number;
  failed: number;
  skipped: number;
}

interface FollowingStatus {
  following: number;
  open: number;
  /** Checked in the last RECENT_CHECK_HOURS, so a refresh would skip them; 0 when that setting is off. */
  recent: number;
  batch: Batch | null;
  importer: { id: string; label: string; maxJobs: number; hasServiceUrl: boolean } | null;
  activeRun: { id: string; kind: string; startedAt: string } | null;
  rateLimitedUntil: string | null;
}

const STATUS_KEY = ["/api/tracking/following"];
/** Roughly what one profile check costs the service, with its human pacing, plus the rest between runs. */
const SECONDS_PER_INFO_JOB = 25;
const CHAIN_REST_MINUTES = 5.5;

function estimate(jobs: number, perRun: number): string {
  const minutes = (jobs * SECONDS_PER_INFO_JOB) / 60 + Math.max(Math.ceil(jobs / perRun) - 1, 0) * CHAIN_REST_MINUTES;
  if (minutes < 90) return `about ${Math.max(Math.round(minutes / 5) * 5, 5)} minutes`;
  return `about ${Math.round(minutes / 30) / 2} hours`;
}

function BatchProgress({ batch, perRun }: { batch: Batch; perRun: number }) {
  const { toast } = useToast();
  const remaining = batch.queued + batch.running;
  const done = batch.total - remaining;
  const cancel = useMutation({
    mutationFn: async () => (await apiRequest("DELETE", `/api/tracking/batches/${batch.id}/queued`)).json() as Promise<{ cancelled: number }>,
    onSuccess: ({ cancelled }) => {
      toast({ title: "Batch cancelled", description: `${cancelled} queued ${cancelled === 1 ? "check" : "checks"} dropped; running ones finish on their own.` });
      queryClient.invalidateQueries({ queryKey: STATUS_KEY });
    },
    onError: (error: Error) => toast({ title: "Failed to cancel", description: error.message, variant: "destructive" }),
  });

  return (
    <div className="space-y-3" data-testid="batch-progress">
      <div className="flex items-center justify-between gap-2 text-sm">
        <span>
          {TRACKING_KIND_LABEL[batch.kind]} · started {new Date(batch.createdAt).toLocaleString()}
        </span>
        <span className="text-muted-foreground">
          {done} / {batch.total}
          {remaining > 0 && ` · ${estimate(remaining, perRun)} left`}
        </span>
      </div>
      <Progress value={batch.total ? (done / batch.total) * 100 : 0} className="h-2" />
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
        <span data-testid="text-batch-completed">Completed {batch.completed}</span>
        <span>Skipped {batch.skipped}</span>
        <span className={batch.failed ? "text-destructive" : ""}>Failed {batch.failed}</span>
        <span>Running {batch.running}</span>
        <span>Queued {batch.queued}</span>
      </div>
      {batch.queued > 0 && (
        <Button variant="outline" size="sm" onClick={() => cancel.mutate()} disabled={cancel.isPending} data-testid="button-cancel-batch">
          <XCircle className="h-4 w-4 mr-1.5" />
          Cancel the {batch.queued} still queued
        </Button>
      )}
    </div>
  );
}

export default function SocialTrackingPage() {
  const { toast } = useToast();
  const { data, isLoading } = useQuery<FollowingStatus>({
    queryKey: STATUS_KEY,
    // Keep counting while a batch drains; a page left open otherwise costs one request a minute.
    refetchInterval: (q) => ((q.state.data?.batch?.queued ?? 0) + (q.state.data?.batch?.running ?? 0) > 0 ? 10_000 : 60_000),
  });

  const refresh = useMutation({
    mutationFn: async () =>
      (await apiRequest("POST", "/api/tracking/following/refresh", { kind: "info" })).json() as Promise<{ batch: Batch | null; skippedRecent: number }>,
    onSuccess: ({ batch, skippedRecent }) => {
      const skipped = skippedRecent > 0 ? ` ${skippedRecent} checked in the last ${RECENT_CHECK_HOURS} hours were skipped.` : "";
      toast(
        batch
          ? { title: "Profile refresh queued", description: `${batch.total} accounts queued; they run in batches of ${data?.importer?.maxJobs ?? 40}.${skipped}` }
          : { title: "Nothing to queue", description: `Every account you follow already has a profile check queued or running.${skipped}` },
      );
      queryClient.invalidateQueries({ queryKey: STATUS_KEY });
    },
    onError: (error: Error) => toast({ title: "Failed to queue", description: error.message, variant: "destructive" }),
  });

  const perRun = data?.importer?.maxJobs ?? 40;
  const batchOpen = (data?.batch?.queued ?? 0) + (data?.batch?.running ?? 0) > 0;
  const toQueue = data ? data.following - data.open - (data.recent ?? 0) : 0;

  let blocker: string | null = null;
  if (data && !data.importer) blocker = "No Instagram importer is set up yet — add one under Settings → Import & Export → Instagram.";
  else if (data && !data.importer!.hasServiceUrl) blocker = `Importer "${data.importer!.label}" has no service URL, so jobs will wait until it does.`;
  else if (data?.rateLimitedUntil) blocker = `Instagram rate-limited the account; the queue waits until ${new Date(data.rateLimitedUntil).toLocaleString()}.`;

  return (
    <div className="container max-w-full md:max-w-3xl py-3 md:py-8 px-4 md:pl-12">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold" data-testid="text-tracking-title">Tracking</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Bulk checks of the accounts you follow, run by the Instagram importer. Each account's own level and cadence live on its page.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Everyone I follow</CardTitle>
          <CardDescription>
            Re-read every followed account's profile: name, bio, link, picture, counts and whether it's private. The importer
            takes {perRun} accounts per run with a short rest between runs, so a large batch takes a while.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {isLoading || !data ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
          ) : (
            <>
              <p className="text-sm" data-testid="text-following-count">
                You follow <strong>{data.following}</strong> Instagram {data.following === 1 ? "account" : "accounts"} PRM can check
                {data.open > 0 && <> — <strong>{data.open}</strong> already have a profile check queued or running</>}
                {data.recent > 0 && (
                  <>
                    {data.open > 0 ? ", and " : " — "}
                    <strong>{data.recent}</strong> {data.recent === 1 ? "was" : "were"} checked in the last {RECENT_CHECK_HOURS} hours and will be skipped (
                    <Link href="/settings/instagram/tracking" className="underline">change</Link>)
                  </>
                )}
                .{toQueue > 0 && <> A full refresh is {estimate(toQueue, perRun)}.</>}
              </p>
              {blocker && <p className="text-sm text-amber-600 dark:text-amber-500" data-testid="text-tracking-blocker">{blocker}</p>}
              {data.activeRun && (
                <p className="text-sm text-muted-foreground" data-testid="text-active-run">
                  A {data.activeRun.kind} run has been going since {new Date(data.activeRun.startedAt).toLocaleTimeString()} — see{" "}
                  <Link href="/settings/social-tasks" className="underline">Social Tasks</Link>.
                </p>
              )}
              <Button
                onClick={() => refresh.mutate()}
                disabled={refresh.isPending || toQueue === 0}
                data-testid="button-refresh-following"
              >
                {refresh.isPending ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-1.5" />}
                {batchOpen ? `Queue the ${toQueue} not yet queued` : `Update ${toQueue} profiles`}
              </Button>
              {data.batch && (
                <div className="border-t pt-4">
                  <BatchProgress batch={data.batch} perRun={perRun} />
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
