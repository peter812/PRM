import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { AlertTriangle, BookOpen, CheckCircle2, ChevronDown, ChevronRight, HelpCircle, Loader2, LogIn, Play, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { IMPORTERS_KEY, RUNS_KEY, sessionFromRuns, useImporters, useStoryRuns, type Importer, type Settings, type StoryRun } from "@/lib/instagram";

function HowToCard({ defaultOpen }: { defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <Card className="mb-6">
        <CollapsibleTrigger asChild>
          <CardHeader className="cursor-pointer select-none" data-testid="button-stories-howto">
            <CardTitle className="text-base flex items-center gap-2">
              <BookOpen className="h-4 w-4" />
              Learn how to use
              {open ? <ChevronDown className="ml-auto h-4 w-4" /> : <ChevronRight className="ml-auto h-4 w-4" />}
            </CardTitle>
            <CardDescription>What the story collector does, and the four steps to get it running.</CardDescription>
          </CardHeader>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <CardContent className="space-y-4 text-sm">
            <p>
              A small companion service (<code>prm-stories</code>) drives a real Chrome window that is logged in to an
              Instagram account. On each scheduled run it watches every story in the tray — including ones already
              seen — and sends each story's image plus its metadata here as soon as it finishes with each account. For a
              video story that image is its cover frame; turn on <em>Download videos</em> to keep the video too. Stories
              from accounts PRM has no social account for are dropped but recorded in the run log, so you can always see
              why one is missing. Every story remembers which account it was collected from.
            </p>
            <ol className="list-decimal list-inside space-y-2">
              <li>
                <strong>Start a service.</strong> <code>npm install</code> then <code>npm start</code> in a{" "}
                <code>prm-stories</code> folder. One install per Instagram account — give each its own{" "}
                <code>STORIES_PORT</code>.
              </li>
              <li>
                <strong>Add an importer.</strong> Press <em>+</em> below and enter the service URL
                (<code>http://localhost:5055</code> by default).
              </li>
              <li>
                <strong>Log in once.</strong> Press <em>Open Instagram login</em> on the card. A Chrome window opens on the
                service's own profile; sign in as you normally would, then close the window. The profile keeps the session,
                so you only repeat this when Instagram logs it out.
              </li>
              <li>
                <strong>Set the schedule and enable it.</strong> Choose how often to run and the time-of-day window. PRM picks a
                random minute inside the window each time so the runs don't look automated. Press <em>Run now</em> to check
                that everything works — it reports right away whether the login is still good.
              </li>
            </ol>
            <p className="text-muted-foreground">
              Keep each service on the same network its account normally uses, and set its <code>TZ</code> to the machine
              you logged in from.
            </p>
          </CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}


const EVERY_DAYS_OPTIONS = [
  { value: "1", label: "Every day" },
  { value: "2", label: "Every 2 days" },
  { value: "3", label: "Every 3 days" },
  { value: "7", label: "Once a week" },
];


/** One prm-stories install: its URL, schedule, login and run controls. */
function ImporterCard({ importer, runs, onDelete }: { importer: Importer; runs: StoryRun[]; onDelete: (i: Importer) => void }) {
  const { isAdmin } = useAuth();
  const { toast } = useToast();
  const session = sessionFromRuns(runs);
  const hasUrl = Boolean(importer.serviceUrl);

  const [label, setLabel] = useState(importer.label);
  const [apiUrl, setApiUrl] = useState(importer.serviceUrl);
  const [secret, setSecret] = useState("");
  const [start, setStart] = useState(importer.runWindow.split("-")[0] ?? "19:30");
  const [end, setEnd] = useState(importer.runWindow.split("-")[1] ?? "22:30");
  const [skip, setSkip] = useState(String(importer.skipDayProbability));
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const windowValid = Boolean(start && end && start < end);
  const nextRunAt = importer.nextRunAt ? new Date(importer.nextRunAt) : null;
  const [trackStart, setTrackStart] = useState(importer.trackingWindow.split("-")[0] ?? "07:00");
  const [trackEnd, setTrackEnd] = useState(importer.trackingWindow.split("-")[1] ?? "10:00");
  const [maxJobs, setMaxJobs] = useState(String(importer.trackingMaxJobs));
  const trackWindowValid = Boolean(trackStart && trackEnd && trackStart < trackEnd);
  const nextTrackingRunAt = importer.nextTrackingRunAt ? new Date(importer.nextTrackingRunAt) : null;

  const save = useMutation({
    mutationFn: async (patch: Partial<Omit<Importer, "id" | "nextRunAt" | "nextTrackingRunAt" | "lastUsername" | "createdAt" | "serviceSecretSet">> & { serviceSecret?: string }) =>
      apiRequest("PATCH", `/api/stories/importers/${importer.id}`, patch),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: IMPORTERS_KEY }),
    onError: (error: Error) => toast({ title: "Failed to save importer", description: error.message, variant: "destructive" }),
  });

  const saveWindow = () => {
    const w = `${start}-${end}`;
    if (windowValid && w !== importer.runWindow) save.mutate({ runWindow: w });
  };
  const saveSkip = () => {
    const n = Number(skip);
    if (Number.isFinite(n) && n >= 0 && n <= 1 && n !== importer.skipDayProbability) save.mutate({ skipDayProbability: n });
    else setSkip(String(importer.skipDayProbability));
  };
  const saveTrackWindow = () => {
    const w = `${trackStart}-${trackEnd}`;
    if (trackWindowValid && w !== importer.trackingWindow) save.mutate({ trackingWindow: w });
  };
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
    },
    onError: (error: Error) => toast({ title: "Failed to trigger tracking run", description: error.message, variant: "destructive" }),
  });

  const openLogin = useMutation({
    mutationFn: async () =>
      (await apiRequest("POST", `/api/stories/importers/${importer.id}/login`)).json() as Promise<{ ok: boolean; reason: string | null; error?: string }>,
    onSuccess: (r) => {
      if (r.ok) {
        toast({ title: "Chrome window opened", description: "Sign in to Instagram in the window, then close it." });
      } else {
        toast({
          title: r.reason === "already_running" ? "The service is busy" : `Couldn't open the window: ${r.reason}`,
          description: r.reason === "already_running" ? "A run or a login window is already using the browser profile. Try again when it finishes." : r.error,
          variant: "destructive",
        });
      }
    },
    onError: (error: Error) => toast({ title: "Failed to reach the service", description: error.message, variant: "destructive" }),
  });

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
    <Card className="mb-4" data-testid={`card-importer-${importer.id}`}>
      <CardHeader className="pb-4">
        <div className="flex items-start gap-3">
          <div className="flex-1 min-w-0 space-y-1">
            <Input
              value={label}
              disabled={!isAdmin}
              onChange={(e) => setLabel(e.target.value)}
              onBlur={() => (label.trim() && label.trim() !== importer.label ? save.mutate({ label: label.trim() }) : setLabel(importer.label))}
              className="h-9 text-base font-semibold px-2 -ml-2 w-full max-w-sm border-transparent hover:border-input focus:border-input"
              aria-label="Importer name"
              data-testid={`input-importer-label-${importer.id}`}
            />
            {importer.lastUsername && (
              <p className="text-sm text-muted-foreground" data-testid={`text-importer-username-${importer.id}`}>@{importer.lastUsername}</p>
            )}
          </div>
          {isAdmin && (
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
              onClick={() => onDelete(importer)}
              title="Remove importer"
              data-testid={`button-delete-importer-${importer.id}`}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
        </div>
        <div className="flex items-start gap-2 text-sm pt-1">
          {session.ok === true && <CheckCircle2 className="h-4 w-4 mt-0.5 text-green-600" />}
          {session.ok === false && <AlertTriangle className="h-4 w-4 mt-0.5 text-destructive" />}
          {session.ok === null && <HelpCircle className="h-4 w-4 mt-0.5 text-muted-foreground" />}
          <span data-testid={`text-importer-session-${importer.id}`}>
            {session.label}
            {session.at && <span className="text-muted-foreground"> (as of {new Date(session.at).toLocaleString()})</span>}
          </span>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2 md:col-span-2">
            <Label htmlFor={`url-${importer.id}`}>Service URL</Label>
            <Input
              id={`url-${importer.id}`}
              placeholder="http://localhost:5055"
              value={apiUrl}
              disabled={!isAdmin}
              onChange={(e) => setApiUrl(e.target.value)}
              onBlur={() => apiUrl.trim() !== importer.serviceUrl && save.mutate({ serviceUrl: apiUrl.trim() })}
              data-testid={`input-importer-url-${importer.id}`}
            />
          </div>
          <div className="space-y-2 md:col-span-2">
            <Label htmlFor={`secret-${importer.id}`}>Service secret</Label>
            <Input
              id={`secret-${importer.id}`}
              type="password"
              autoComplete="off"
              placeholder={importer.serviceSecretSet ? "(set — type to replace)" : "STORIES_SERVICE_SECRET on the service, if it has one"}
              value={secret}
              disabled={!isAdmin}
              onChange={(e) => setSecret(e.target.value)}
              onBlur={() => {
                if (!secret.trim()) return;
                save.mutate({ serviceSecret: secret.trim() });
                setSecret("");
              }}
              data-testid={`input-importer-secret-${importer.id}`}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor={`every-${importer.id}`}>How often</Label>
            <Select
              value={String(importer.runEveryDays)}
              disabled={!isAdmin}
              onValueChange={(v) => save.mutate({ runEveryDays: Number(v) })}
            >
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
            <div className="flex items-center gap-2">
              <Input
                type="time"
                value={start}
                disabled={!isAdmin}
                onChange={(e) => setStart(e.target.value)}
                onBlur={saveWindow}
                aria-label="Earliest"
                data-testid={`input-importer-window-start-${importer.id}`}
              />
              <span className="text-muted-foreground">to</span>
              <Input
                type="time"
                value={end}
                disabled={!isAdmin}
                onChange={(e) => setEnd(e.target.value)}
                onBlur={saveWindow}
                aria-label="Latest"
                data-testid={`input-importer-window-end-${importer.id}`}
              />
            </div>
            {windowValid ? (
              <p className="text-xs text-muted-foreground">A random minute inside this window, in the PRM server's time zone.</p>
            ) : (
              <p className="text-xs text-destructive">The latest time must be after the earliest.</p>
            )}
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

        <div className="rounded-md border px-3 py-3 space-y-3" data-testid={`section-tracking-${importer.id}`}>
          <div className="flex items-center justify-between">
            <div className="pr-4">
              <Label htmlFor={`tracking-${importer.id}`} className="cursor-pointer">Account tracking (mornings)</Label>
              <p className="text-xs text-muted-foreground">
                {importer.trackingEnabled && nextTrackingRunAt
                  ? <>Next tracking run: <strong data-testid={`text-importer-next-tracking-${importer.id}`}>{nextTrackingRunAt.toLocaleString()}</strong></>
                  : importer.trackingEnabled ? "Planning the next tracking run…" : "Refreshes accounts by interest level: profile info, follow lists, posts."}
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
              <div className="flex items-center gap-2">
                <Input type="time" value={trackStart} disabled={!isAdmin} onChange={(e) => setTrackStart(e.target.value)} onBlur={saveTrackWindow} aria-label="Earliest" data-testid={`input-importer-track-start-${importer.id}`} />
                <span className="text-muted-foreground">to</span>
                <Input type="time" value={trackEnd} disabled={!isAdmin} onChange={(e) => setTrackEnd(e.target.value)} onBlur={saveTrackWindow} aria-label="Latest" data-testid={`input-importer-track-end-${importer.id}`} />
              </div>
              {!trackWindowValid && <p className="text-xs text-destructive">The latest time must be after the earliest.</p>}
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
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <Button variant="outline" onClick={() => openLogin.mutate()} disabled={openLogin.isPending || !hasUrl} data-testid={`button-importer-login-${importer.id}`}>
              {openLogin.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <LogIn className="mr-2 h-4 w-4" />}
              {openLogin.isPending ? "Opening Chrome…" : "Open Instagram login"}
            </Button>
            <Button onClick={() => runNow.mutate()} disabled={runNow.isPending || !hasUrl} data-testid={`button-importer-run-now-${importer.id}`}>
              {runNow.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />}
              {runNow.isPending ? "Checking Instagram login…" : "Run now"}
            </Button>
            <Button variant="outline" onClick={() => trackNow.mutate()} disabled={trackNow.isPending || !hasUrl} data-testid={`button-importer-track-now-${importer.id}`}>
              {trackNow.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />}
              {trackNow.isPending ? "Starting…" : "Run tracking now"}
            </Button>
            {!hasUrl && <span className="text-sm text-muted-foreground">Set the service URL first.</span>}
          </div>
        )}
      </CardContent>
    </Card>
  );
}


/** Settings shared by every importer. */
function StorageCard({ settings }: { settings: Settings }) {
  const { isAdmin } = useAuth();
  const { toast } = useToast();
  const save = useMutation({
    mutationFn: async (value: string) => apiRequest("POST", "/api/settings", { key: "stories_image_storage", value }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/settings"] }),
    onError: (error: Error) => toast({ title: "Failed to save setting", description: error.message, variant: "destructive" }),
  });

  return (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle className="text-base">Storage</CardTitle>
        <CardDescription>Where the images and videos every importer sends should go. Only admins can change this.</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-2 md:max-w-xs">
          <Label htmlFor="stories-storage">Image and video storage</Label>
          <Select
            value={settings.stories_image_storage === "s3" ? "s3" : "local"}
            disabled={!isAdmin}
            onValueChange={(v) => save.mutate(v)}
          >
            <SelectTrigger id="stories-storage" data-testid="select-stories-storage"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="local">Local disk</SelectItem>
              <SelectItem value="s3">S3</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </CardContent>
    </Card>
  );
}

export default function InstagramImportersPage() {
  const { isAdmin } = useAuth();
  const { toast } = useToast();
  const { data: settings } = useQuery<Settings>({ queryKey: ["/api/settings"] });
  const { data: runs = [] } = useStoryRuns();
  const { data: importers = [] } = useImporters();
  const [importerToDelete, setImporterToDelete] = useState<Importer | null>(null);

  const addImporter = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/stories/importers")).json() as Promise<Importer>,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: IMPORTERS_KEY }),
    onError: (error: Error) => toast({ title: "Failed to add importer", description: error.message, variant: "destructive" }),
  });

  const deleteImporter = useMutation({
    mutationFn: async (id: string) => apiRequest("DELETE", `/api/stories/importers/${id}`),
    onSuccess: () => {
      toast({ title: "Importer removed", description: "Its past runs are kept." });
      setImporterToDelete(null);
      queryClient.invalidateQueries({ queryKey: IMPORTERS_KEY });
      queryClient.invalidateQueries({ queryKey: RUNS_KEY });
    },
    onError: (error: Error) => toast({ title: "Failed to remove importer", description: error.message, variant: "destructive" }),
  });

  return (
    <div className="container max-w-full md:max-w-5xl py-3 md:py-8 px-4 md:pl-12">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">Importers</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Each importer is one Instagram account driven by its own prm-stories service. In the evening it collects the
          stories of everyone that account follows; in the morning it refreshes tracked accounts.
        </p>
      </div>

      <HowToCard defaultOpen={importers.length === 0} />

      <div className="flex items-center justify-between gap-2 mb-3">
        <div>
          <h2 className="text-lg font-semibold">Importers</h2>
          <p className="text-sm text-muted-foreground">One card per Instagram account, each with its own prm-stories service.</p>
        </div>
        {isAdmin && (
          <Button size="icon" variant="outline" onClick={() => addImporter.mutate()} disabled={addImporter.isPending} title="Add importer" data-testid="button-add-importer">
            {addImporter.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          </Button>
        )}
      </div>
      {importers.length === 0 ? (
        <Card className="mb-6">
          <CardContent className="py-8 text-center text-sm text-muted-foreground" data-testid="text-no-importers">
            No importers yet — add one per Instagram account.
          </CardContent>
        </Card>
      ) : (
        <div className="mb-6">
          {importers.map((importer) => (
            <ImporterCard
              key={importer.id}
              importer={importer}
              runs={runs.filter((r) => r.importerId === importer.id)}
              onDelete={setImporterToDelete}
            />
          ))}
        </div>
      )}

      {settings && <StorageCard settings={settings} />}


      <AlertDialog open={!!importerToDelete} onOpenChange={(open) => !open && setImporterToDelete(null)}>
        <AlertDialogContent data-testid="dialog-delete-importer">
          <AlertDialogHeader>
            <AlertDialogTitle>Remove importer?</AlertDialogTitle>
            <AlertDialogDescription>
              <strong>{importerToDelete?.label}</strong> will stop being scheduled. Its past runs stay in the log, and the
              stories it collected are not deleted. The prm-stories service itself is untouched.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete-importer">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => importerToDelete && deleteImporter.mutate(importerToDelete.id)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleteImporter.isPending}
              data-testid="button-confirm-delete-importer"
            >
              {deleteImporter.isPending ? "Removing…" : "Remove importer"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
