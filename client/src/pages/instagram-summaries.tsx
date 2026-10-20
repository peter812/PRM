import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLoadOnce } from "@/hooks/use-load-once";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Loader2, FileText, Cpu, MessageSquare, Sparkles, RefreshCw, Trash2, Play, Server, BarChart3 } from "lucide-react";
import { ProviderModelPicker, apiErrorMessage, useAiProviders, type ModelSelection } from "@/components/provider-model-picker";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { INTEREST_LEVELS, INTEREST_LEVEL_LABEL, type InterestLevel } from "@shared/interest-level";
import { Link } from "wouter";
import { SummaryStatusBadge, jobStep, summaryStepLabel } from "@/components/summary-status";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

type SummarySettingsResponse = {
  postEnabled: boolean;
  postAutoEnabled: boolean;
  accountEnabled: boolean;
  accountAutoEnabled: boolean;
  sceneModel: ModelSelection;
  textModel: ModelSelection;
  scenePrompt: string;
  postPrompt: string;
  storyPrompt: string;
  accountPrompt: string;
  postMaxWords: number;
  sceneNoThink: boolean;
  postNoThink: boolean;
  storyNoThink: boolean;
  accountNoThink: boolean;
  hostPool: HostPoolEntry[];
  defaults: {
    scenePrompt: string;
    postPrompt: string;
    storyPrompt: string;
    accountPrompt: string;
    postMaxWords: number;
  };
};

type HostPoolEntry = { providerId: string; slots: number; mlx?: boolean };
type HostStatus = { providerId: string; name: string; slots: number; inFlight: number; downUntil: number | null; tokensPerSecond: number | null };

type NoThinkKey ="sceneNoThink" | "postNoThink" | "storyNoThink" | "accountNoThink";

const NO_THINK_OPTIONS: { key: NoThinkKey; label: string; hint: string }[] = [
  { key: "sceneNoThink", label: "No thinking on image summaries", hint: "Per-image scene descriptions in posts." },
  { key: "postNoThink", label: "No thinking on post summaries", hint: "Combining a post's image descriptions." },
  { key: "storyNoThink", label: "No thinking on story summaries", hint: "The single story run." },
  { key: "accountNoThink", label: "No thinking on account summaries", hint: "The account profile summary." },
];

type SummaryTotalsResponse = {
  postsTotal: number;
  postsDone: number;
  postsQueued: number;
  storiesTotal: number;
  storiesDone: number;
  storiesQueued: number;
  accountsTotal: number;
  accountsDone: number;
  accountsQueued: number;
};

// Green = summarized, blue = queued, grey = neither.
function TotalBar({ label, done, queued, total, testId }: { label: string; done: number; queued: number; total: number; testId: string }) {
  const pct = (n: number) => (total > 0 ? (n / total) * 100 : 0);
  return (
    <div className="space-y-1.5" data-testid={testId}>
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="font-medium">{label}</span>
        <span className="text-muted-foreground tabular-nums">
          {done.toLocaleString()} / {total.toLocaleString()} ({Math.round(pct(done))}%)
          {queued > 0 && <span className="text-blue-600 dark:text-blue-400"> · {queued.toLocaleString()} queued</span>}
        </span>
      </div>
      <div className="h-3 w-full rounded-full bg-muted overflow-hidden flex">
        <div className="h-full bg-green-500 transition-all" style={{ width: `${pct(done)}%` }} />
        <div className="h-full bg-blue-500 transition-all" style={{ width: `${pct(queued)}%` }} />
      </div>
    </div>
  );
}

type SummaryQueueResponse = {
  counts: Record<string, number>;
  rows: Array<{
    id: string;
    kind: "post" | "account";
    targetId: string;
    socialAccountId: string | null;
    username: string | null;
    status: string;
    attempts: number;
    error: string | null;
    createdAt: string;
    startedAt: string | null;
    completedAt: string | null;
  }>;
  hosts: HostStatus[];
};

export default function InstagramSummariesPage() {
  const { toast } = useToast();

  const [sceneModel, setSceneModel] = useState<ModelSelection>({ providerId: "", model: "" });
  const [textModel, setTextModel] = useState<ModelSelection>({ providerId: "", model: "" });
  const [scenePrompt, setScenePrompt] = useState("");
  const [postPrompt, setPostPrompt] = useState("");
  const [storyPrompt, setStoryPrompt] = useState("");
  const [accountPrompt, setAccountPrompt] = useState("");
  const [postMaxWords, setPostMaxWords] = useState(400);
  const [selectedLevel, setSelectedLevel] = useState<InterestLevel>("medium");
  const [hostPool, setHostPool] = useState<HostPoolEntry[]>([]);
  const { data: providers } = useAiProviders();
  const ollamaProviders = (providers ?? []).filter((p) => p.kind === "ollama");

  const { data: settings, isLoading } = useQuery<SummarySettingsResponse>({
    queryKey: ["/api/summary/settings"],
  });

  const { data: queue } = useQuery<SummaryQueueResponse>({
    queryKey: ["/api/summary-queue"],
    refetchInterval: 5000,
  });

  const { data: totals } = useQuery<SummaryTotalsResponse>({
    queryKey: ["/api/summary/totals"],
    refetchInterval: 10000,
  });

  useLoadOnce(settings, (s) => {
    if (s.sceneModel) setSceneModel(s.sceneModel);
    if (s.textModel) setTextModel(s.textModel);
    setScenePrompt(s.scenePrompt || s.defaults.scenePrompt);
    setPostPrompt(s.postPrompt || s.defaults.postPrompt);
    setStoryPrompt(s.storyPrompt || s.defaults.storyPrompt);
    setAccountPrompt(s.accountPrompt || s.defaults.accountPrompt);
    setPostMaxWords(s.postMaxWords);
    setHostPool(s.hostPool ?? []);
  });

  const poolEntry = (id: string) => hostPool.find((h) => h.providerId === id);
  const toggleHost = (id: string, on: boolean) =>
    setHostPool((pool) => (on ? [...pool, { providerId: id, slots: 1 }] : pool.filter((h) => h.providerId !== id)));
  const setHostSlots = (id: string, slots: number) =>
    setHostPool((pool) => pool.map((h) => (h.providerId === id ? { ...h, slots: Math.min(16, Math.max(1, slots || 1)) } : h)));
  const setHostMlx = (id: string, mlx: boolean) =>
    setHostPool((pool) => pool.map((h) => (h.providerId === id ? { ...h, mlx } : h)));

  const saveMutation = useMutation({
    mutationFn: async (patch: Record<string, unknown>) => {
      const res = await apiRequest("POST", "/api/summary/settings", patch);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/summary/settings"] });
      toast({ title: "Settings saved" });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to save settings", description: apiErrorMessage(err), variant: "destructive" });
    },
  });

  const historicalPostsMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/summary-queue/posts/historical", { includeSummarized: false });
      return res.json() as Promise<{ queued: number }>;
    },
    onSuccess: ({ queued }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/summary-queue"] });
      toast({ title: queued > 0 ? `Queued ${queued} historical post(s) for summary` : "All historical posts are already summarized or queued" });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to queue historical posts", description: apiErrorMessage(err), variant: "destructive" });
    },
  });

  const queueAllMutation = useMutation({
    mutationFn: async (only: "post" | "story") => {
      const res = await apiRequest("POST", "/api/summary-queue/posts/historical", { includeSummarized: false, only });
      return { ...((await res.json()) as { queued: number }), only };
    },
    onSuccess: ({ queued, only }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/summary-queue"] });
      const noun = only === "story" ? "stories" : "posts";
      toast({ title: queued > 0 ? `Queued ${queued} ${noun} for summary` : `All ${noun} are already summarized or queued` });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to queue", description: apiErrorMessage(err), variant: "destructive" });
    },
  });

  const interestAccountsMutation = useMutation({
    mutationFn: async (level: InterestLevel) => {
      const res = await apiRequest("POST", "/api/summary-queue/accounts/by-interest", { level });
      return res.json() as Promise<{ accountsQueued: number; postsQueued: number }>;
    },
    onSuccess: ({ accountsQueued, postsQueued }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/summary-queue"] });
      toast({
        title: `Queued ${accountsQueued} account summary job(s)`,
        description: postsQueued > 0 ? `Also queued ${postsQueued} unsummarized post(s) first.` : undefined,
      });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to queue account summaries", description: apiErrorMessage(err), variant: "destructive" });
    },
  });

  const retryQueueMutation = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/summary-queue/retry-failed")).json(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/summary-queue"] });
      toast({ title: "Retrying failed summary jobs" });
    },
  });

  const clearQueueMutation = useMutation({
    mutationFn: async () => (await apiRequest("DELETE", "/api/summary-queue/finished")).json(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/summary-queue"] });
      toast({ title: "Cleared finished summary jobs" });
    },
  });

  if (isLoading || !settings) {
    return (
      <div className="flex items-center justify-center py-16" data-testid="loading-instagram-summaries">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const counts = queue?.counts ?? {};

  return (
    <div className="h-full overflow-y-auto">
    <div className="container max-w-full md:max-w-5xl py-3 md:py-8 px-4 md:pl-12 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold flex items-center gap-2" data-testid="text-summaries-title">
          <FileText className="h-6 w-6" />
          Summaries
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Configure post, story, and social account summaries, automatic invalidation &amp; updates, models, and prompts.
        </p>
      </div>

      {/* Total Numbers */}
      <Card data-testid="card-summary-totals">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <BarChart3 className="h-4 w-4 text-primary" />
            Total Numbers
          </CardTitle>
          <CardDescription>How much of the library has been summarized.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {totals ? (
            <>
              <TotalBar label="Posts" done={totals.postsDone} queued={totals.postsQueued} total={totals.postsTotal} testId="bar-total-posts" />
              <TotalBar label="Stories" done={totals.storiesDone} queued={totals.storiesQueued} total={totals.storiesTotal} testId="bar-total-stories" />
              <TotalBar
                label="Accounts with posts or stories"
                done={totals.accountsDone}
                queued={totals.accountsQueued}
                total={totals.accountsTotal}
                testId="bar-total-accounts"
              />
            </>
          ) : (
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          )}
          <div className="pt-2 border-t flex flex-wrap gap-2">
            {(["post", "story"] as const).map((only) => (
              <Button
                key={only}
                variant="outline"
                size="sm"
                disabled={!settings.postEnabled || queueAllMutation.isPending}
                onClick={() => queueAllMutation.mutate(only)}
                data-testid={`button-queue-all-${only}s`}
              >
                {queueAllMutation.isPending && queueAllMutation.variables === only ? (
                  <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                ) : (
                  <Play className="h-4 w-4 mr-1.5" />
                )}
                {only === "post" ? "Queue all posts" : "Queue all stories"}
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Post Summaries Options */}
      <Card data-testid="card-post-summaries">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            Post &amp; Story Summaries
          </CardTitle>
          <CardDescription>
            Each image in a post is described with the scene description model, then the descriptions and transcript
            are combined into a post summary. A story gets a single run: all its images go to the scene description
            model with the story prompt (video-only stories send the transcript to the summary model).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between gap-4 md:max-w-md">
            <div>
              <Label htmlFor="switch-post-enabled">Enable post summaries</Label>
              <p className="text-xs text-muted-foreground">Allow summarizing individual posts and stories.</p>
            </div>
            <Switch
              id="switch-post-enabled"
              checked={settings.postEnabled}
              onCheckedChange={(checked) => saveMutation.mutate({ postEnabled: checked })}
              data-testid="switch-post-summaries-enabled"
            />
          </div>

          <div className="flex items-center justify-between gap-4 md:max-w-md">
            <div>
              <Label htmlFor="switch-post-auto-enabled">Enable auto post summaries</Label>
              <p className="text-xs text-muted-foreground">Automatically summarize new posts and stories when they are added.</p>
            </div>
            <Switch
              id="switch-post-auto-enabled"
              checked={settings.postAutoEnabled}
              disabled={!settings.postEnabled}
              onCheckedChange={(checked) => saveMutation.mutate({ postAutoEnabled: checked })}
              data-testid="switch-auto-post-summaries-enabled"
            />
          </div>

          <div className="pt-2 border-t flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-sm font-medium">Run all historical posts through summaries</div>
              <p className="text-xs text-muted-foreground">Queues all existing unsummarized posts and stories across all accounts.</p>
            </div>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!settings.postEnabled || historicalPostsMutation.isPending}
                  data-testid="button-run-historical-posts"
                >
                  {historicalPostsMutation.isPending ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Play className="h-4 w-4 mr-1.5" />}
                  Run all historical posts
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Summarize all historical posts?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Every post and story without a summary is queued, across all accounts. Each one runs the vision model per
                    image plus the text model, so a large library can keep the AI busy for hours.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={() => historicalPostsMutation.mutate()}>Queue posts</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </CardContent>
      </Card>

      {/* Account Summaries Options */}
      <Card data-testid="card-account-summaries">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <FileText className="h-4 w-4 text-primary" />
            Account Summaries
          </CardTitle>
          <CardDescription>
            Synthesizes an account's post and story summaries into a profile summary. Previous summaries are archived in
            historical account summaries with creation, invalidation, and replacement timestamps.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between gap-4 md:max-w-md">
            <div>
              <Label htmlFor="switch-account-enabled">Enable account summaries</Label>
              <p className="text-xs text-muted-foreground">
                Marks an account's current summary out of date when new post summaries finish.
              </p>
            </div>
            <Switch
              id="switch-account-enabled"
              checked={settings.accountEnabled}
              onCheckedChange={(checked) => saveMutation.mutate({ accountEnabled: checked })}
              data-testid="switch-account-summaries-enabled"
            />
          </div>

          <div className="flex items-center justify-between gap-4 md:max-w-md">
            <div>
              <Label htmlFor="switch-account-auto-enabled">Enable auto account summaries</Label>
              <p className="text-xs text-muted-foreground">
                Automatically regenerate the social account summary whenever it is marked out of date.
              </p>
            </div>
            <Switch
              id="switch-account-auto-enabled"
              checked={settings.accountAutoEnabled}
              disabled={!settings.accountEnabled}
              onCheckedChange={(checked) => saveMutation.mutate({ accountAutoEnabled: checked })}
              data-testid="switch-auto-account-summaries-enabled"
            />
          </div>

          <div className="pt-2 border-t flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-sm font-medium">Run account summaries by interest level</div>
              <p className="text-xs text-muted-foreground">
                Queue account summaries for all social accounts at the selected interest level and above.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Select value={selectedLevel} onValueChange={(v) => setSelectedLevel(v as InterestLevel)}>
                <SelectTrigger className="w-36 h-8 text-xs" data-testid="select-summary-interest-level">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {INTEREST_LEVELS.filter((l) => l !== "none").map((l) => (
                    <SelectItem key={l} value={l}>
                      {INTEREST_LEVEL_LABEL[l]} &amp; above
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                variant="outline"
                size="sm"
                onClick={() => interestAccountsMutation.mutate(selectedLevel)}
                disabled={!settings.accountEnabled || interestAccountsMutation.isPending}
                data-testid="button-run-interest-level-summaries"
              >
                {interestAccountsMutation.isPending ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Play className="h-4 w-4 mr-1.5" />}
                Run account summaries
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Models */}
      <Card data-testid="card-summary-models">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Cpu className="h-4 w-4 text-primary" />
            Models
          </CardTitle>
          <CardDescription>
            Select the vision model for per-image scene descriptions and the text model for combining post &amp; account summaries.
            Leave blank to inherit the default models from Intelligence settings.
            {settings.hostPool.length > 0 && " With the host pool on, only the model names are used, and they run on every pool host."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-2">
            <Label>Scene Description Model (Per-Image VLM)</Label>
            <ProviderModelPicker value={sceneModel} onChange={setSceneModel} testId="picker-summary-scene-model" />
          </div>
          <div className="space-y-2">
            <Label>Summary Model (Post Combine &amp; Account Summary LLM)</Label>
            <ProviderModelPicker value={textModel} onChange={setTextModel} testId="picker-summary-text-model" />
          </div>
          <div className="space-y-3 pt-2 border-t">
            <div>
              <div className="text-sm font-medium">Thinking</div>
              <p className="text-xs text-muted-foreground">
                Turn off reasoning on thinking models for faster summaries. Ollama providers only; other providers ignore it.
              </p>
            </div>
            {NO_THINK_OPTIONS.map(({ key, label, hint }) => (
              <div key={key} className="flex items-center justify-between gap-4 md:max-w-md">
                <div>
                  <Label htmlFor={`switch-${key}`}>{label}</Label>
                  <p className="text-xs text-muted-foreground">{hint}</p>
                </div>
                <Switch
                  id={`switch-${key}`}
                  checked={settings[key]}
                  onCheckedChange={(checked) => saveMutation.mutate({ [key]: checked })}
                  data-testid={`switch-${key}`}
                />
              </div>
            ))}
          </div>
          <div className="flex justify-end">
            <Button
              size="sm"
              onClick={() => saveMutation.mutate({ sceneModel, textModel })}
              disabled={saveMutation.isPending}
              data-testid="button-save-summary-models"
            >
              {saveMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save Models"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Host Pool */}
      <Card data-testid="card-summary-host-pool">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Server className="h-4 w-4 text-primary" />
            Host Pool
          </CardTitle>
          <CardDescription>
            Spread summary runs across several Ollama hosts so queued jobs finish faster. Every checked host needs the
            scene and summary models pulled. Set slots to match each host's <code>OLLAMA_NUM_PARALLEL</code>. Check <code>-mlx</code> on Macs with MLX builds pulled (named
            <code>model-mlx</code>). With no
            hosts checked, jobs run one at a time on the providers chosen above.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {ollamaProviders.length === 0 ? (
            <p className="text-sm text-muted-foreground">No Ollama providers yet. Add them at Settings → Intelligence.</p>
          ) : (
            ollamaProviders.map((p) => {
              const entry = poolEntry(p.id);
              const live = queue?.hosts?.find((h) => h.providerId === p.id);
              return (
                <div key={p.id} className="flex flex-wrap items-center gap-3" data-testid={`row-host-${p.id}`}>
                  <Checkbox
                    id={`host-${p.id}`}
                    checked={!!entry}
                    onCheckedChange={(checked) => toggleHost(p.id, checked === true)}
                    data-testid={`checkbox-host-${p.id}`}
                  />
                  <Label htmlFor={`host-${p.id}`} className="min-w-0 flex-1">
                    <span className="font-medium">{p.name}</span>{" "}
                    <span className="text-xs text-muted-foreground break-all">{p.baseUrl}</span>
                  </Label>
                  {entry && (
                    <div className="flex items-center gap-2" title='Use MLX builds of the models (model name + "-mlx"). Faster on Macs that have them pulled.'>
                      <Checkbox
                        id={`mlx-${p.id}`}
                        checked={entry.mlx === true}
                        onCheckedChange={(checked) => setHostMlx(p.id, checked === true)}
                        data-testid={`checkbox-host-mlx-${p.id}`}
                      />
                      <Label htmlFor={`mlx-${p.id}`} className="text-xs text-muted-foreground">-mlx</Label>
                    </div>
                  )}
                  {entry && (
                    <div className="flex items-center gap-2">
                      <Label htmlFor={`slots-${p.id}`} className="text-xs text-muted-foreground">Slots</Label>
                      <Input
                        id={`slots-${p.id}`}
                        type="number"
                        min={1}
                        max={16}
                        className="w-20 h-8"
                        value={entry.slots}
                        onChange={(e) => setHostSlots(p.id, Number(e.target.value))}
                        data-testid={`input-host-slots-${p.id}`}
                      />
                    </div>
                  )}
                  {live && (
                    live.downUntil ? (
                      <Badge variant="destructive">Unreachable, retrying in {Math.max(1, Math.ceil((live.downUntil - Date.now()) / 1000))}s</Badge>
                    ) : (
                      <Badge variant="secondary">{live.inFlight}/{live.slots} busy</Badge>
                    )
                  )}
                  {live?.tokensPerSecond != null && (
                    <Badge variant="outline" title="Generation speed of this host's most recent summary call">
                      {live.tokensPerSecond.toFixed(1)} tok/s
                    </Badge>
                  )}
                </div>
              );
            })
          )}
          <div className="flex justify-end">
            <Button
              size="sm"
              onClick={() => saveMutation.mutate({ hostPool })}
              disabled={saveMutation.isPending}
              data-testid="button-save-host-pool"
            >
              {saveMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save Host Pool"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Prompts */}
      <Card data-testid="card-summary-prompts">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <MessageSquare className="h-4 w-4 text-primary" />
            Prompts
          </CardTitle>
          <CardDescription>
            Customize the instructions used for scene description, post, story, and account summaries.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="textarea-scene-prompt">Image Scene Description Prompt</Label>
              <button
                type="button"
                className="text-xs text-muted-foreground underline hover:text-foreground"
                onClick={() => setScenePrompt(settings.defaults.scenePrompt)}
                data-testid="button-reset-scene-prompt"
              >
                Reset to default
              </button>
            </div>
            <Textarea
              id="textarea-scene-prompt"
              value={scenePrompt}
              onChange={(e) => setScenePrompt(e.target.value)}
              rows={2}
              data-testid="textarea-scene-prompt"
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="textarea-post-prompt">Post Summary Prompt</Label>
              <button
                type="button"
                className="text-xs text-muted-foreground underline hover:text-foreground"
                onClick={() => setPostPrompt(settings.defaults.postPrompt)}
                data-testid="button-reset-post-prompt"
              >
                Reset to default
              </button>
            </div>
            <Textarea
              id="textarea-post-prompt"
              value={postPrompt}
              onChange={(e) => setPostPrompt(e.target.value)}
              rows={3}
              data-testid="textarea-post-prompt"
            />
            <div className="flex items-center gap-2">
              <Label htmlFor="input-post-max-words" className="text-xs text-muted-foreground">
                Max words per post &amp; story summary
              </Label>
              <Input
                id="input-post-max-words"
                type="number"
                min={10}
                max={2000}
                step={10}
                value={postMaxWords}
                onChange={(e) => setPostMaxWords(Number(e.target.value))}
                className="h-8 w-24"
                data-testid="input-post-max-words"
              />
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="textarea-story-prompt">Story Summary Prompt</Label>
              <button
                type="button"
                className="text-xs text-muted-foreground underline hover:text-foreground"
                onClick={() => setStoryPrompt(settings.defaults.storyPrompt)}
                data-testid="button-reset-story-prompt"
              >
                Reset to default
              </button>
            </div>
            <Textarea
              id="textarea-story-prompt"
              value={storyPrompt}
              onChange={(e) => setStoryPrompt(e.target.value)}
              rows={3}
              data-testid="textarea-story-prompt"
            />
            <p className="text-xs text-muted-foreground">Sent with every story image in one run. The max words above also applies.</p>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="textarea-account-prompt">Account Summary Prompt</Label>
              <button
                type="button"
                className="text-xs text-muted-foreground underline hover:text-foreground"
                onClick={() => setAccountPrompt(settings.defaults.accountPrompt)}
                data-testid="button-reset-account-prompt"
              >
                Reset to default
              </button>
            </div>
            <Textarea
              id="textarea-account-prompt"
              value={accountPrompt}
              onChange={(e) => setAccountPrompt(e.target.value)}
              rows={4}
              data-testid="textarea-account-prompt"
            />
          </div>

          <div className="flex justify-end">
            <Button
              size="sm"
              onClick={() => saveMutation.mutate({ scenePrompt, postPrompt, storyPrompt, accountPrompt, postMaxWords })}
              disabled={saveMutation.isPending}
              data-testid="button-save-summary-prompts"
            >
              {saveMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save Prompts"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Queue Status */}
      <Card data-testid="card-summary-queue">
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle className="text-base">Summary Queue</CardTitle>
            <CardDescription>
              Recent and pending post &amp; account summary jobs.{" "}
              <Link href="~/settings/tasks/summaries" className="underline" data-testid="link-summary-tasks">
                View summary tasks
              </Link>
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => retryQueueMutation.mutate()}
              disabled={!counts.failed || retryQueueMutation.isPending}
              data-testid="button-retry-failed-summaries"
            >
              <RefreshCw className="h-3.5 w-3.5 mr-1" />
              Retry failed ({counts.failed ?? 0})
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => clearQueueMutation.mutate()}
              disabled={clearQueueMutation.isPending}
              data-testid="button-clear-finished-summaries"
            >
              <Trash2 className="h-3.5 w-3.5 mr-1" />
              Clear finished
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {(["pending", "running", "done", "failed"] as const).map((st) => (
              <SummaryStatusBadge key={st} step={jobStep(st)} label={`${summaryStepLabel(jobStep(st))}: ${counts[st] ?? 0}`} />
            ))}
          </div>

          {queue?.rows && queue.rows.length > 0 ? (
            <div className="max-h-72 overflow-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Type</TableHead>
                    <TableHead>Account</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead>Error</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {queue.rows.map((job) => (
                    <TableRow key={job.id}>
                      <TableCell className="font-medium capitalize">{job.kind}</TableCell>
                      <TableCell>
                        {job.socialAccountId ? (
                          <Link href={`~/social-accounts/${job.socialAccountId}`} className="text-primary hover:underline">
                            @{job.username || job.socialAccountId.slice(0, 8)}
                          </Link>
                        ) : (
                          "—"
                        )}
                      </TableCell>
                      <TableCell>
                        <SummaryStatusBadge step={jobStep(job.status)} />
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {new Date(job.createdAt).toLocaleString()}
                      </TableCell>
                      <TableCell className="text-xs text-destructive max-w-xs truncate" title={job.error ?? undefined}>
                        {job.error ?? ""}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground italic">No summary jobs in queue.</p>
          )}
        </CardContent>
      </Card>
    </div>
    </div>
  );
}
