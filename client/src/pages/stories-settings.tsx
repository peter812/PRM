import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { AlertTriangle, BookOpen, CheckCircle2, ChevronDown, ChevronRight, ExternalLink, HelpCircle, Loader2, LogIn, Play, Plus, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
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
import { Link } from "wouter";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";

interface RunItem {
  username: string;
  storyPk: string | null;
  takenAt: string | null;
  mediaType: number | null;
  outcome: string;
  prmOutcome?: string;
  accountId?: string | null;
}

interface StoryRun {
  id: string;
  importerId: string | null;
  importerLabel: string | null;
  status: string;
  startedAt: string;
  finishedAt: string | null;
  counts: Partial<Record<"accountsInTray" | "accountsOpened" | "storiesSeen" | "imagesSaved" | "unreached", number>>;
  items: RunItem[];
  error: string | null;
}

/** PRM's verdict wins once delivered; before that the scraper's own outcome is all we know. */
const finalOutcome = (i: RunItem) => i.prmOutcome ?? i.outcome;

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  completed: "default",
  starting: "secondary",
  running: "secondary",
  skipped: "secondary",
  rate_limited: "outline",
  unreachable: "outline",
  already_running: "outline",
  needs_login: "destructive",
  checkpoint: "destructive",
  no_username: "destructive",
  parse_failed: "destructive",
  error: "destructive",
};

function RunRow({
  run,
  isSelected,
  onToggleSelect,
  onDelete,
  isAdmin,
}: {
  run: StoryRun;
  isSelected: boolean;
  onToggleSelect: (id: string) => void;
  onDelete: (run: StoryRun) => void;
  isAdmin: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("all");
  const noAccount = run.items.filter((i) => finalOutcome(i) === "no_account").length;
  const items = filter === "all" ? run.items : run.items.filter((i) => finalOutcome(i) === filter);
  const outcomes = Array.from(new Set(run.items.map(finalOutcome))).sort();
  const c = run.counts;

  return (
    <>
      <TableRow className="cursor-pointer" onClick={() => setOpen((o) => !o)} data-testid={`row-run-${run.id}`}>
        <TableCell className="w-8">{open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</TableCell>
        {isAdmin && (
          <TableCell className="w-8" onClick={(e) => e.stopPropagation()}>
            <Checkbox
              checked={isSelected}
              onCheckedChange={() => onToggleSelect(run.id)}
              aria-label={`Select run ${run.id}`}
              data-testid={`checkbox-run-${run.id}`}
            />
          </TableCell>
        )}
        <TableCell>{new Date(run.startedAt).toLocaleString()}</TableCell>
        <TableCell className="text-muted-foreground">{run.importerLabel ?? "—"}</TableCell>
        <TableCell><Badge variant={STATUS_VARIANT[run.status] ?? "outline"}>{run.status}</Badge></TableCell>
        <TableCell className="text-right">{c.accountsOpened ?? 0} / {c.accountsInTray ?? 0}</TableCell>
        <TableCell className="text-right">{c.storiesSeen ?? 0}</TableCell>
        <TableCell className="text-right">{c.imagesSaved ?? 0}</TableCell>
        <TableCell className="text-right">{noAccount}</TableCell>
        {isAdmin && (
          <TableCell className="text-right w-12" onClick={(e) => e.stopPropagation()}>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-muted-foreground hover:text-destructive"
              onClick={() => onDelete(run)}
              title="Delete run"
              data-testid={`button-delete-run-${run.id}`}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </TableCell>
        )}
      </TableRow>
      {open && (
        <TableRow>
          <TableCell colSpan={isAdmin ? 10 : 8} className="bg-muted/30 p-4">
            {run.error && <p className="text-sm text-destructive mb-3">{run.error}</p>}
            {run.items.length === 0 ? (
              <p className="text-sm text-muted-foreground">No stories recorded for this run.</p>
            ) : (
              <>
                <Select value={filter} onValueChange={setFilter}>
                  <SelectTrigger className="w-56 mb-3" data-testid="select-outcome-filter">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All outcomes ({run.items.length})</SelectItem>
                    {outcomes.map((o) => (
                      <SelectItem key={o} value={o}>{o} ({run.items.filter((i) => finalOutcome(i) === o).length})</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <div className="max-h-96 overflow-y-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Account</TableHead>
                        <TableHead>Posted</TableHead>
                        <TableHead>Outcome</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {items.map((i, idx) => (
                        <TableRow key={`${i.username}-${i.storyPk ?? idx}`}>
                          <TableCell>
                            {i.accountId ? (
                              <Link
                                href={`~/social-accounts/${i.accountId}?tab=stories${i.storyPk ? `&storyPk=${i.storyPk}` : ""}`}
                                className="inline-flex items-center gap-1 font-medium hover:underline text-primary"
                                data-testid={`link-account-${i.username}`}
                              >
                                @{i.username}
                              </Link>
                            ) : (
                              <span className="inline-flex items-center gap-1.5 text-muted-foreground" data-testid={`text-no-account-${i.username}`}>
                                @{i.username}
                                <a
                                  href={`https://www.instagram.com/${i.username}/`}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="inline-flex items-center text-muted-foreground hover:text-foreground"
                                  title="Open in Instagram (account not in PRM)"
                                >
                                  <ExternalLink className="h-3 w-3" />
                                </a>
                              </span>
                            )}
                          </TableCell>
                          <TableCell>{i.takenAt ? new Date(i.takenAt).toLocaleString() : "—"}</TableCell>
                          <TableCell>{finalOutcome(i)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </>
            )}
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

type Settings = Record<string, string | null>;

/** One row of story_importers as GET /api/stories/importers returns it. */
interface Importer {
  id: string;
  label: string;
  serviceUrl: string;
  enabled: boolean;
  runEveryDays: number;
  runWindow: string;
  skipDayProbability: number;
  downloadVideos: boolean;
  nextRunAt: string | null;
  lastUsername: string | null;
  createdAt: string;
}

const IMPORTERS_KEY = ["/api/stories/importers"];

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

/** What the last run that reached Instagram said about the session. */
function sessionFromRuns(runs: StoryRun[]): { label: string; ok: boolean | null; at: string | null } {
  const last = runs.find((r) => ["completed", "running", "needs_login", "checkpoint", "no_username", "rate_limited", "parse_failed", "error"].includes(r.status));
  if (!last) return { label: "Unknown — no run has reached Instagram yet", ok: null, at: null };
  if (last.status === "needs_login") return { label: "Logged out — Instagram wants a person to sign in again", ok: false, at: last.startedAt };
  if (last.status === "checkpoint") return { label: "Flagged — Instagram is asking for a verification step", ok: false, at: last.startedAt };
  if (last.status === "no_username") return { label: "Logged in, but the service couldn't tell which account — nothing was collected", ok: false, at: last.startedAt };
  return { label: "Logged in", ok: true, at: last.startedAt };
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
  const [start, setStart] = useState(importer.runWindow.split("-")[0] ?? "19:30");
  const [end, setEnd] = useState(importer.runWindow.split("-")[1] ?? "22:30");
  const [skip, setSkip] = useState(String(importer.skipDayProbability));
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const windowValid = Boolean(start && end && start < end);
  const nextRunAt = importer.nextRunAt ? new Date(importer.nextRunAt) : null;

  const save = useMutation({
    mutationFn: async (patch: Partial<Omit<Importer, "id" | "nextRunAt" | "lastUsername" | "createdAt">>) =>
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
      queryClient.invalidateQueries({ queryKey: ["/api/stories/runs"] });
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

export default function StoriesSettingsPage() {
  const { isAdmin } = useAuth();
  const { toast } = useToast();
  const { data: settings } = useQuery<Settings>({ queryKey: ["/api/settings"] });
  const { data: runs = [], isLoading } = useQuery<StoryRun[]>({
    queryKey: ["/api/stories/runs"],
    queryFn: async () => (await apiRequest("GET", "/api/stories/runs")).json(),
    staleTime: 0,
    refetchOnMount: "always",
  });

  const { data: importers = [] } = useQuery<Importer[]>({
    queryKey: IMPORTERS_KEY,
    queryFn: async () => (await apiRequest("GET", "/api/stories/importers")).json(),
  });

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [runToDelete, setRunToDelete] = useState<StoryRun | null>(null);
  const [showBulkDeleteDialog, setShowBulkDeleteDialog] = useState(false);
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
      queryClient.invalidateQueries({ queryKey: ["/api/stories/runs"] });
    },
    onError: (error: Error) => toast({ title: "Failed to remove importer", description: error.message, variant: "destructive" }),
  });

  const handleToggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      setSelectedIds(new Set(runs.map((r) => r.id)));
    } else {
      setSelectedIds(new Set());
    }
  };

  const deleteSingleMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/stories/runs/${id}`);
    },
    onSuccess: (_, id) => {
      toast({ title: "Run deleted", description: "The story run log has been removed." });
      setSelectedIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      setRunToDelete(null);
      queryClient.invalidateQueries({ queryKey: ["/api/stories/runs"] });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to delete run", description: error.message, variant: "destructive" });
    },
  });

  const deleteBulkMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      const res = await apiRequest("POST", "/api/stories/runs/bulk-delete", { ids });
      return res.json() as Promise<{ ok: boolean; deletedCount: number }>;
    },
    onSuccess: (data) => {
      toast({
        title: "Runs deleted",
        description: `Successfully removed ${data.deletedCount} run ${data.deletedCount === 1 ? "log" : "logs"}.`,
      });
      setSelectedIds(new Set());
      setShowBulkDeleteDialog(false);
      queryClient.invalidateQueries({ queryKey: ["/api/stories/runs"] });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to delete runs", description: error.message, variant: "destructive" });
    },
  });

  return (
    <div className="container max-w-full md:max-w-5xl py-3 md:py-8 px-4 md:pl-12">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">Instagram Stories</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Collect the stories of everyone your Instagram accounts follow and attach them to their social accounts.
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

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-3">
        <div>
          <h2 className="text-lg font-semibold">Recent runs</h2>
          <p className="text-sm text-muted-foreground">
            Expand a run to see every story it saw, including the ones dropped because no social account exists for the
            poster (<code>no_account</code>).
          </p>
        </div>
        {isAdmin && selectedIds.size > 0 && (
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">{selectedIds.size} selected</span>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => setShowBulkDeleteDialog(true)}
              disabled={deleteBulkMutation.isPending}
              data-testid="button-delete-selected-runs"
            >
              <Trash2 className="h-4 w-4 mr-1.5" />
              Delete selected ({selectedIds.size})
            </Button>
          </div>
        )}
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-8" />
            {isAdmin && (
              <TableHead className="w-8">
                <Checkbox
                  checked={runs.length > 0 && selectedIds.size === runs.length}
                  onCheckedChange={handleSelectAll}
                  aria-label="Select all runs"
                  data-testid="checkbox-select-all-runs"
                />
              </TableHead>
            )}
            <TableHead>Started</TableHead>
            <TableHead>Importer</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Accounts</TableHead>
            <TableHead className="text-right">Seen</TableHead>
            <TableHead className="text-right">Saved</TableHead>
            <TableHead className="text-right">No account</TableHead>
            {isAdmin && <TableHead className="w-12 text-right">Actions</TableHead>}
          </TableRow>
        </TableHeader>
        <TableBody>
          {isLoading ? (
            <TableRow><TableCell colSpan={isAdmin ? 10 : 8} className="text-center py-8 text-muted-foreground">Loading…</TableCell></TableRow>
          ) : runs.length === 0 ? (
            <TableRow><TableCell colSpan={isAdmin ? 10 : 8} className="text-center py-8 text-muted-foreground">No runs delivered yet.</TableCell></TableRow>
          ) : (
            runs.map((run) => (
              <RunRow
                key={run.id}
                run={run}
                isSelected={selectedIds.has(run.id)}
                onToggleSelect={handleToggleSelect}
                onDelete={(r) => setRunToDelete(r)}
                isAdmin={Boolean(isAdmin)}
              />
            ))
          )}
        </TableBody>
      </Table>

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

      {/* Delete Single Run Dialog */}
      <AlertDialog open={!!runToDelete} onOpenChange={(open) => !open && setRunToDelete(null)}>
        <AlertDialogContent data-testid="dialog-delete-single-run">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete story run?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete the run from{" "}
              <strong>{runToDelete ? new Date(runToDelete.startedAt).toLocaleString() : ""}</strong>?
              This will remove the run log. Any stories and photos that were saved to PRM will not be deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete-run">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => runToDelete && deleteSingleMutation.mutate(runToDelete.id)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleteSingleMutation.isPending}
              data-testid="button-confirm-delete-run"
            >
              {deleteSingleMutation.isPending ? "Deleting…" : "Delete run"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Bulk Delete Runs Dialog */}
      <AlertDialog open={showBulkDeleteDialog} onOpenChange={setShowBulkDeleteDialog}>
        <AlertDialogContent data-testid="dialog-delete-bulk-runs">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {selectedIds.size} story {selectedIds.size === 1 ? "run" : "runs"}?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete {selectedIds.size} selected run {selectedIds.size === 1 ? "log" : "logs"}?
              This action cannot be undone. Any stories and photos that were saved to PRM will not be deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-bulk-delete">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteBulkMutation.mutate(Array.from(selectedIds))}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleteBulkMutation.isPending}
              data-testid="button-confirm-bulk-delete"
            >
              {deleteBulkMutation.isPending ? "Deleting…" : `Delete ${selectedIds.size} ${selectedIds.size === 1 ? "run" : "runs"}`}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
