// Social Accounts → Tracking: refresh everyone I follow in one go. The button
// queues a manual profile-info job per followed account as one batch; the
// scheduler drains it as a chain of runs of `tracking_max_jobs` each
// (server/stories-scheduler.ts). This page shows the batch's progress and
// whatever is holding the queue up. The OSINT card picks the scanners every
// account scan uses and queues accounts by tracking level.
import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { ChevronDown, ChevronRight, Loader2, Play, Radar, RefreshCw, Search, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { AccountTracking, TrackingSchedule } from "@/components/account-tracking";
import { InterestLevelBadge, InterestLevelSelect } from "@/components/interest-level-badge";
import { useAuth } from "@/hooks/use-auth";
import { IMPORTERS_KEY, RUNS_KEY, useImporters, type Importer } from "@/lib/instagram";
import { INSTAGRAM_TYPE_ID, type SocialAccount, type TrackingJob } from "@shared/schema";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { RECENT_CHECK_HOURS, TRACKING_KIND_LABEL, trackingBlocker, type TrackingKind } from "@shared/interest-level";
import { OSINT_TOOLS } from "@shared/osint-tools";

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

interface Upcoming {
  trackingEnabled: boolean;
  runAt: string;
  importerLabel: string | null;
  limit: number;
  checks: { accountId: string; username: string; nickname: string | null; interestLevel: string; kind: TrackingKind; origin: "manual" | "schedule"; at: string }[];
}

/** On demand: the accounts the next morning run would check, in the order it takes them. */
function UpcomingCard() {
  const { data, isFetching, refetch } = useQuery<Upcoming>({ queryKey: ["/api/tracking/upcoming"], enabled: false });
  const day = (d: string) => new Date(d).toLocaleDateString([], { month: "short", day: "numeric" });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Next to get updated</CardTitle>
        <CardDescription>The accounts the next tracking run will check: anything queued by hand first, then the most overdue.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Button variant="outline" onClick={() => refetch()} disabled={isFetching} data-testid="button-load-upcoming">
          {isFetching ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-1.5" />}
          {data ? "Reload accounts" : "Load accounts"}
        </Button>
        {data && (
          <>
            <p className="text-sm text-muted-foreground" data-testid="text-upcoming-run">
              {data.trackingEnabled
                ? <>Next run {new Date(data.runAt).toLocaleString()}{data.importerLabel && <> on {data.importerLabel}</>}, up to {data.limit} checks.</>
                : <>Auto tracking is off, so nothing is scheduled. If it ran a day from now, up to {data.limit} checks, it would take these.</>}
            </p>
            {data.checks.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nothing is due by then.</p>
            ) : (
              <div className="border rounded-md divide-y max-h-96 overflow-y-auto" data-testid="list-upcoming">
                {data.checks.map((c) => (
                  <div key={`${c.accountId}-${c.kind}`} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                    <Link href={`/social-accounts/${c.accountId}`} className="truncate hover:underline">
                      @{c.username}
                      {c.nickname && <span className="text-muted-foreground"> · {c.nickname}</span>}
                    </Link>
                    <div className="flex items-center gap-2 shrink-0 text-muted-foreground">
                      <span>{TRACKING_KIND_LABEL[c.kind]}</span>
                      <span className="w-24 text-right">{c.origin === "manual" ? "queued" : `due ${day(c.at)}`}</span>
                      <InterestLevelBadge level={c.interestLevel} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

/** Queue one check of each kind for an account; the next tracking run picks it up. */
function QueueCheckButtons({ account }: { account: SocialAccount }) {
  const { toast } = useToast();
  const jobsKey = [`/api/social-accounts/${account.id}/tracking-jobs`];
  // Same key as AccountTracking, so both show a kind as queued at once.
  const { data: jobs } = useQuery<TrackingJob[]>({ queryKey: jobsKey, refetchInterval: 30_000 });
  const openKinds = new Set((jobs ?? []).filter((j) => j.status === "queued" || j.status === "running").map((j) => j.kind));
  const queue = useMutation({
    mutationFn: (kind: TrackingKind) => apiRequest("POST", `/api/social-accounts/${account.id}/tracking-jobs`, { kind }),
    onSuccess: (_r, kind) => {
      queryClient.invalidateQueries({ queryKey: jobsKey });
      toast({ title: "Queued", description: `${TRACKING_KIND_LABEL[kind]} for @${account.username} will run on the next tracking run.` });
    },
    onError: (e: Error) => toast({ title: "Not queued", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="flex flex-wrap gap-2 border-t pt-4" data-testid="section-queue-checks">
      {(["info", "posts", "follows"] as const).map((kind) => {
        const blocker = trackingBlocker(account, kind);
        return (
          <Button
            key={kind}
            variant="outline"
            size="sm"
            disabled={queue.isPending || openKinds.has(kind) || Boolean(blocker)}
            title={blocker ? (blocker === "private" ? "Private account" : "Over 10,000 follows") : undefined}
            onClick={() => queue.mutate(kind)}
            data-testid={`button-queue-${kind}`}
          >
            {queue.isPending && queue.variables === kind ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-1.5" />}
            {TRACKING_KIND_LABEL[kind]}{openKinds.has(kind) && " · queued"}
          </Button>
        );
      })}
    </div>
  );
}

/** Pick one Instagram account by name, then set its interest level and see its check schedule. */
function AccountTrackingCard() {
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  const searching = debounced.length >= 3;
  const { data: results = [], isFetching } = useQuery<SocialAccount[]>({
    queryKey: ["/api/social-accounts/paginated", { search: debounced, typeId: INSTAGRAM_TYPE_ID, limit: 10 }],
    queryFn: async () => {
      const params = new URLSearchParams({ search: debounced, typeId: INSTAGRAM_TYPE_ID, limit: "10", offset: "0", full: "true" });
      return (await apiRequest("GET", `/api/social-accounts/paginated?${params}`)).json();
    },
    enabled: searching,
  });
  // Same key AccountTracking invalidates, so a level change shows up in the schedule at once.
  const { data: account } = useQuery<SocialAccount>({ queryKey: [`/api/social-accounts/${selectedId}`], enabled: !!selectedId });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Account tracking</CardTitle>
        <CardDescription>Find an Instagram account to set its interest level and see how often and when it's checked.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search accounts (3+ characters)"
            className="pl-8"
            data-testid="input-tracking-account-search"
          />
        </div>
        {searching && (
          <div className="border rounded-md divide-y max-h-64 overflow-y-auto" data-testid="list-tracking-account-results">
            {isFetching && results.length === 0 ? (
              <div className="flex items-center gap-2 p-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Searching…</div>
            ) : results.length === 0 ? (
              <div className="p-2 text-sm text-muted-foreground">No Instagram accounts match.</div>
            ) : (
              results.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => {
                    setSelectedId(a.id);
                    setSearch("");
                  }}
                  className={`w-full flex items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-muted ${a.id === selectedId ? "bg-muted" : ""}`}
                  data-testid={`button-tracking-account-${a.id}`}
                >
                  <span className="truncate">
                    @{a.username}
                    {a.nickname && <span className="text-muted-foreground"> · {a.nickname}</span>}
                  </span>
                  <InterestLevelBadge level={a.interestLevel} />
                </button>
              ))
            )}
          </div>
        )}
        {account && (
          <div className="border-t pt-4 space-y-4" data-testid="section-selected-account">
            <Link href={`/social-accounts/${account.id}`} className="font-medium underline">@{account.username}</Link>
            <AccountTracking account={account} />
            <TrackingSchedule account={account} />
            <QueueCheckButtons account={account} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

const EVERY_DAYS_OPTIONS = [
  { value: "1", label: "Every day" },
  { value: "2", label: "Every 2 days" },
  { value: "3", label: "Every 3 days" },
  { value: "7", label: "Once a week" },
];

type ImporterPatch = Partial<Pick<Importer,
  "runEveryDays" | "runWindow" | "enabled" | "skipDayProbability" | "downloadVideos" | "trackingEnabled" | "trackingWindow" | "trackingMaxJobs">>;

function useSaveImporter(id: string) {
  const { toast } = useToast();
  return useMutation({
    mutationFn: (patch: ImporterPatch) => apiRequest("PATCH", `/api/stories/importers/${id}`, patch),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: IMPORTERS_KEY });
      queryClient.invalidateQueries({ queryKey: STATUS_KEY });
    },
    onError: (error: Error) => toast({ title: "Failed to save", description: error.message, variant: "destructive" }),
  });
}

/** An "HH:MM-HH:MM" window as two time inputs, saved on blur when valid and changed. */
function TimeWindow({ value, disabled, onSave, testId }: { value: string; disabled: boolean; onSave: (w: string) => void; testId: string }) {
  const [start, setStart] = useState(value.split("-")[0] ?? "");
  const [end, setEnd] = useState(value.split("-")[1] ?? "");
  const valid = Boolean(start && end && start < end);
  const save = () => {
    if (valid && `${start}-${end}` !== value) onSave(`${start}-${end}`);
  };
  return (
    <>
      <div className="flex items-center gap-2">
        <Input type="time" value={start} disabled={disabled} onChange={(e) => setStart(e.target.value)} onBlur={save} aria-label="Earliest" data-testid={`${testId}-start`} />
        <span className="text-muted-foreground">to</span>
        <Input type="time" value={end} disabled={disabled} onChange={(e) => setEnd(e.target.value)} onBlur={save} aria-label="Latest" data-testid={`${testId}-end`} />
      </div>
      {!valid && <p className="text-xs text-destructive">The latest time must be after the earliest.</p>}
    </>
  );
}

/** The evening story run: how often, when, on/off, and a manual run. */
function StorySchedule({ importer }: { importer: Importer }) {
  const { isAdmin } = useAuth();
  const { toast } = useToast();
  const save = useSaveImporter(importer.id);
  const [skip, setSkip] = useState(String(importer.skipDayProbability));
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const nextRunAt = importer.nextRunAt ? new Date(importer.nextRunAt) : null;
  const saveSkip = () => {
    const n = Number(skip);
    if (Number.isFinite(n) && n >= 0 && n <= 1 && n !== importer.skipDayProbability) save.mutate({ skipDayProbability: n });
    else setSkip(String(importer.skipDayProbability));
  };

  const runNow = useMutation({
    mutationFn: async () =>
      (await apiRequest("POST", `/api/stories/importers/${importer.id}/run-now`)).json() as Promise<{ status: string; error: string | null; username: string | null }>,
    onSuccess: (r) => {
      toast({
        title: r.status === "running" ? `Run started${r.username ? ` as @${r.username}` : ""}` : `Run not started: ${r.status}`,
        description: r.error ?? "The scraper is logged in and watching the tray.",
        variant: r.status === "running" ? "default" : "destructive",
      });
      queryClient.invalidateQueries({ queryKey: RUNS_KEY });
      queryClient.invalidateQueries({ queryKey: IMPORTERS_KEY });
    },
    onError: (error: Error) => toast({ title: "Failed to trigger run", description: error.message, variant: "destructive" }),
  });

  return (
    <>
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor={`every-${importer.id}`}>How often</Label>
          <Select value={String(importer.runEveryDays)} disabled={!isAdmin} onValueChange={(v) => save.mutate({ runEveryDays: Number(v) })}>
            <SelectTrigger id={`every-${importer.id}`} data-testid={`select-importer-every-${importer.id}`}><SelectValue /></SelectTrigger>
            <SelectContent>
              {EVERY_DAYS_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
              {!EVERY_DAYS_OPTIONS.some((o) => o.value === String(importer.runEveryDays)) && (
                <SelectItem value={String(importer.runEveryDays)}>Every {importer.runEveryDays} days</SelectItem>
              )}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">Stories disappear after 24 hours, so anything less than daily will miss some.</p>
        </div>
        <div className="space-y-2">
          <Label>Time of day</Label>
          <TimeWindow value={importer.runWindow} disabled={!isAdmin} onSave={(runWindow) => save.mutate({ runWindow })} testId={`input-importer-window-${importer.id}`} />
          <p className="text-xs text-muted-foreground">A random minute inside this window, in the PRM server's time zone.</p>
        </div>
      </div>

      <div className="flex items-center justify-between rounded-md border px-3 py-2">
        <div className="pr-4">
          <Label htmlFor={`enabled-${importer.id}`} className="cursor-pointer">Enable auto run</Label>
          <p className="text-xs text-muted-foreground">
            {importer.enabled && nextRunAt
              ? <>Next run: <strong data-testid={`text-importer-next-run-${importer.id}`}>{nextRunAt.toLocaleString()}</strong></>
              : importer.enabled ? "Planning the next run…" : "Runs only when you press Run now."}
          </p>
        </div>
        <Switch
          id={`enabled-${importer.id}`}
          checked={importer.enabled}
          disabled={!isAdmin}
          onCheckedChange={(v) => save.mutate({ enabled: v })}
          data-testid={`switch-importer-enabled-${importer.id}`}
        />
      </div>

      <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
        <CollapsibleTrigger asChild>
          <button type="button" className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground" data-testid={`button-importer-advanced-${importer.id}`}>
            {advancedOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            Advanced
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent className="pt-3">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor={`skip-${importer.id}`}>Chance to skip a run (0–1)</Label>
              <Input
                id={`skip-${importer.id}`}
                type="number"
                min={0}
                max={1}
                step={0.01}
                value={skip}
                disabled={!isAdmin}
                onChange={(e) => setSkip(e.target.value)}
                onBlur={saveSkip}
                data-testid={`input-importer-skip-${importer.id}`}
              />
              <p className="text-xs text-muted-foreground">An occasional day off keeps the pattern from looking scripted.</p>
            </div>
            <div className="flex items-center justify-between rounded-md border px-3 py-2 self-start">
              <div className="pr-4">
                <Label htmlFor={`videos-${importer.id}`} className="cursor-pointer">Download videos</Label>
                <p className="text-xs text-muted-foreground">Keep the video of a video story, not just its cover frame. Up to 50 MB each.</p>
              </div>
              <Switch
                id={`videos-${importer.id}`}
                checked={importer.downloadVideos}
                disabled={!isAdmin}
                onCheckedChange={(v) => save.mutate({ downloadVideos: v })}
                data-testid={`switch-importer-videos-${importer.id}`}
              />
            </div>
          </div>
        </CollapsibleContent>
      </Collapsible>

      {isAdmin && (
        <Button className="self-start" onClick={() => runNow.mutate()} disabled={runNow.isPending || !importer.serviceUrl} data-testid={`button-importer-run-now-${importer.id}`}>
          {runNow.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />}
          {runNow.isPending ? "Checking Instagram login…" : "Run now"}
        </Button>
      )}
    </>
  );
}

/** The morning account-tracking run: on/off, window, checks per run, and a manual run. */
function AccountSchedule({ importer }: { importer: Importer }) {
  const { isAdmin } = useAuth();
  const { toast } = useToast();
  const save = useSaveImporter(importer.id);
  const [maxJobs, setMaxJobs] = useState(String(importer.trackingMaxJobs));
  const nextTrackingRunAt = importer.nextTrackingRunAt ? new Date(importer.nextTrackingRunAt) : null;
  const saveMaxJobs = () => {
    const n = Number(maxJobs);
    if (Number.isInteger(n) && n >= 1 && n <= 500 && n !== importer.trackingMaxJobs) save.mutate({ trackingMaxJobs: n });
    else setMaxJobs(String(importer.trackingMaxJobs));
  };

  const trackNow = useMutation({
    mutationFn: async () =>
      (await apiRequest("POST", `/api/stories/importers/${importer.id}/track-now`)).json() as Promise<{ status: string; error: string | null; jobs: number }>,
    onSuccess: (r) => {
      toast({
        title: r.status === "running" ? `Tracking run started with ${r.jobs} jobs` : r.status === "nothing_due" ? "Nothing to check" : `Run not started: ${r.status}`,
        description: r.error ?? (r.status === "nothing_due" ? "No account is due and no manual job is queued." : undefined),
        variant: r.status === "running" || r.status === "nothing_due" ? "default" : "destructive",
      });
      queryClient.invalidateQueries({ queryKey: RUNS_KEY });
      queryClient.invalidateQueries({ queryKey: ["/api/tracking/jobs"] });
      queryClient.invalidateQueries({ queryKey: IMPORTERS_KEY });
      queryClient.invalidateQueries({ queryKey: STATUS_KEY });
    },
    onError: (error: Error) => toast({ title: "Failed to trigger tracking run", description: error.message, variant: "destructive" }),
  });

  return (
    <>
      <div className="flex items-center justify-between rounded-md border px-3 py-2">
        <div className="pr-4">
          <Label htmlFor={`tracking-${importer.id}`} className="cursor-pointer">Enable auto tracking</Label>
          <p className="text-xs text-muted-foreground">
            {importer.trackingEnabled && nextTrackingRunAt
              ? <>Next tracking run: <strong data-testid={`text-importer-next-tracking-${importer.id}`}>{nextTrackingRunAt.toLocaleString()}</strong></>
              : importer.trackingEnabled ? "Planning the next tracking run…" : "Off — accounts are only checked when you queue them."}
          </p>
        </div>
        <Switch
          id={`tracking-${importer.id}`}
          checked={importer.trackingEnabled}
          disabled={!isAdmin}
          onCheckedChange={(v) => save.mutate({ trackingEnabled: v })}
          data-testid={`switch-importer-tracking-${importer.id}`}
        />
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label>Tracking window</Label>
          <TimeWindow value={importer.trackingWindow} disabled={!isAdmin} onSave={(trackingWindow) => save.mutate({ trackingWindow })} testId={`input-importer-track-${importer.id}`} />
        </div>
        <div className="space-y-2">
          <Label htmlFor={`maxjobs-${importer.id}`}>Checks per run</Label>
          <Input
            id={`maxjobs-${importer.id}`}
            type="number"
            min={1}
            max={500}
            value={maxJobs}
            disabled={!isAdmin}
            onChange={(e) => setMaxJobs(e.target.value)}
            onBlur={saveMaxJobs}
            data-testid={`input-importer-max-jobs-${importer.id}`}
          />
          <p className="text-xs text-muted-foreground">The run ends when the window does; whatever it didn't reach stays due.</p>
        </div>
      </div>
      {isAdmin && (
        <Button variant="outline" className="self-start" onClick={() => trackNow.mutate()} disabled={trackNow.isPending || !importer.serviceUrl} data-testid={`button-importer-track-now-${importer.id}`}>
          {trackNow.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />}
          {trackNow.isPending ? "Starting…" : "Run tracking now"}
        </Button>
      )}
    </>
  );
}

/** A schedule card with one section per importer, named only when there's more than one. */
function ScheduleCard({ title, description, testId, render }: {
  title: string;
  description: string;
  testId: string;
  render: (importer: Importer) => React.ReactNode;
}) {
  const { data: importers, isLoading } = useImporters();
  return (
    <Card data-testid={testId}>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
        ) : !importers?.length ? (
          <p className="text-sm text-muted-foreground">
            No Instagram importer is set up yet — add one under <Link href="/settings/instagram" className="underline">Instagram importers</Link>.
          </p>
        ) : (
          importers.map((importer, i) => (
            <div key={importer.id} className={`flex flex-col gap-4 ${i > 0 ? "border-t pt-6" : ""}`}>
              {importers.length > 1 && (
                <p className="text-sm font-medium">
                  {importer.label}
                  {importer.lastUsername && <span className="text-muted-foreground font-normal"> · @{importer.lastUsername}</span>}
                </p>
              )}
              {render(importer)}
              {!importer.serviceUrl && (
                <p className="text-sm text-muted-foreground">
                  Set the service URL under <Link href="/settings/instagram" className="underline">Instagram importers</Link> before it can run.
                </p>
              )}
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}

const USERNAME_TOOLS = OSINT_TOOLS.filter((t) => t.supportedTargetTypes.includes("username"));

/** The scanners every account scan uses, the yearly sweep, and a bulk queue by tracking level. */
function OsintTrackingCard() {
  const { toast } = useToast();
  const { isAdmin } = useAuth();
  const [level, setLevel] = useState("high");
  const { data: status } = useQuery<{ configured: boolean }>({ queryKey: ["/api/osint/status"] });
  const { data: settings } = useQuery<Record<string, string | null>>({ queryKey: ["/api/settings"] });
  const tools = (settings?.osint_auto_scan_tools ?? "sherlock").split(",").filter(Boolean);
  const configured = !!status?.configured;

  const save = useMutation({
    mutationFn: (s: { key: string; value: string }) => apiRequest("POST", "/api/settings", s),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/settings"] }),
    onError: (error: Error) => toast({ title: "Not saved", description: error.message, variant: "destructive" }),
  });
  const queue = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/osint/scan-queue/level", { level })).json() as Promise<{ queued: number }>,
    onSuccess: ({ queued }) => {
      toast({ title: queued ? `Queued ${queued} scan${queued === 1 ? "" : "s"}` : "Nothing to queue", description: queued ? undefined : "Every account there was scanned in the last 120 days or is already queued." });
      queryClient.invalidateQueries({ queryKey: ["/api/osint/scan-queue"] });
    },
    onError: (error: Error) => toast({ title: "Failed to queue", description: error.message, variant: "destructive" }),
  });
  const toggleTool = (name: string, on: boolean) =>
    save.mutate({ key: "osint_auto_scan_tools", value: (on ? [...tools, name] : tools.filter((t) => t !== name)).join(",") });

  return (
    <Card data-testid="card-osint-tracking">
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2"><Radar className="h-4 w-4" /> OSINT</CardTitle>
        <CardDescription>Username scans of social accounts through PRM-Compute. Every account scan uses the scanners picked here; results land on each account's OSINT section.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {status && !configured && (
          <p className="text-sm text-amber-600 dark:text-amber-500">
            PRM-Compute is not configured — <Link href="/settings/recognition" className="underline">set it up</Link> to run scans.
          </p>
        )}
        <div className="space-y-2">
          <Label>Scanners</Label>
          <div className="flex flex-wrap gap-4">
            {USERNAME_TOOLS.map((t) => (
              <label key={t.name} className="flex items-center gap-2 text-sm cursor-pointer">
                <Checkbox checked={tools.includes(t.name)} disabled={!isAdmin} onCheckedChange={(v) => toggleTool(t.name, v === true)} data-testid={`checkbox-osint-tool-${t.name}`} />
                {t.label}
              </label>
            ))}
          </div>
        </div>
        <div className="flex items-center justify-between gap-4">
          <Label htmlFor="osint-yearly" className="flex-1 cursor-pointer">
            Rescan every account once a year
            <span className="block text-xs text-muted-foreground font-normal">Queues any account a scanner hasn't checked in the last 365 days.</span>
          </Label>
          <Switch
            id="osint-yearly"
            checked={settings?.osint_yearly_scan_enabled === "true"}
            disabled={!isAdmin}
            onCheckedChange={(on) => save.mutate({ key: "osint_yearly_scan_enabled", value: on ? "true" : "false" })}
            data-testid="switch-osint-yearly"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span>Queue every account with tracking level</span>
          <InterestLevelSelect value={level} onChange={setLevel} className="w-36 h-8" />
          <span>and above</span>
          <Button size="sm" onClick={() => queue.mutate()} disabled={!configured || !tools.length || queue.isPending} data-testid="button-osint-queue-level">
            {queue.isPending && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
            Queue
          </Button>
          <Link href="/settings/tasks/osint" className="ml-auto underline text-muted-foreground">View tasks</Link>
        </div>
        <p className="text-xs text-muted-foreground">Accounts a scanner checked in the last 120 days are skipped.</p>
      </CardContent>
    </Card>
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
    <div className="h-full overflow-y-auto">
    <div className="container max-w-full md:max-w-3xl py-3 md:py-8 px-4 md:pl-12">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold" data-testid="text-tracking-title">Tracking</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Checks of Instagram accounts, run by the Instagram importer: automatically by interest level, one account at a time, or everyone you follow at once.
        </p>
      </div>

      <div className="space-y-6">
      <ScheduleCard
        title="Auto story tracking"
        description="In the evening the importer watches every story in its tray and keeps the ones from accounts PRM knows."
        testId="card-story-schedule"
        render={(importer) => <StorySchedule importer={importer} />}
      />
      <ScheduleCard
        title="Auto account tracking"
        description="In the morning the importer re-checks accounts by their interest level: profile info, follow lists, posts."
        testId="card-account-schedule"
        render={(importer) => <AccountSchedule importer={importer} />}
      />
      <UpcomingCard />
      <AccountTrackingCard />
      <OsintTrackingCard />
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
    </div>
    </div>
  );
}
