import { useState, useEffect } from "react";
import { useLoadOnce } from "@/hooks/use-load-once";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { ProviderModelPicker, type ModelSelection } from "@/components/provider-model-picker";
import { Database, CheckCircle2, Loader2, RefreshCw, AlertCircle, Sparkles, BookOpen, Square, Trash2 } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

type VectorSettings = {
  enabled: boolean;
  qdrantUrl: string;
  hasApiKey: boolean;
  collectionName: string;
  embeddingModel: string;
  embeddingProviderId: string;
  embeddingConcurrency: number;
};

type TestResult = { ok: boolean; message: string };
type UniversalStats = Record<string, { total: number; vectorized: number }>;
type UniversalStatus = { enabled: boolean; collectionReady: boolean; pointCount: number };
type BulkSyncProgress = {
  running: boolean;
  stopRequested: boolean;
  processed: number;
  failed: number;
  total: number;
  error: string | null;
};

export default function VectorSettingsPage() {
  const { toast } = useToast();

  const [enabled, setEnabled] = useState(false);
  const [qdrantUrl, setQdrantUrl] = useState("");
  const [qdrantApiKey, setQdrantApiKey] = useState("");
  const [collectionName, setCollectionName] = useState("");
  const [embedding, setEmbedding] = useState<ModelSelection>({ providerId: "", model: "" });
  const [concurrency, setConcurrency] = useState("1");
  const [testResult, setTestResult] = useState<TestResult | null>(null);

  const { data: settings, isLoading } = useQuery<VectorSettings>({
    queryKey: ["/api/vector/settings"],
  });

  useLoadOnce(settings, (s) => {
    setEnabled(s.enabled);
    setQdrantUrl(s.qdrantUrl);
    setCollectionName(s.collectionName);
    setEmbedding({ providerId: s.embeddingProviderId ?? "", model: s.embeddingModel });
    setConcurrency(String(s.embeddingConcurrency ?? 1));
  });

  const saveMutation = useMutation({
    mutationFn: async (patch: Record<string, unknown>) => {
      const res = await apiRequest("POST", "/api/vector/settings", patch);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/vector/settings"] });
      toast({ title: "Saved" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to save", description: error.message, variant: "destructive" });
    },
  });

  const testMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/vector/test", {});
      return res.json() as Promise<TestResult>;
    },
    onSuccess: (data) => setTestResult(data),
    onError: (error: Error) => setTestResult({ ok: false, message: error.message }),
  });

  const handleSave = () => {
    const patch: Record<string, unknown> = { qdrantUrl, collectionName, embeddingConcurrency: Number(concurrency) || 1 };
    if (qdrantApiKey.length > 0) patch.qdrantApiKey = qdrantApiKey;
    // Server treats a model change as invalidating vectors, so don't send a blank one.
    if (embedding.model) Object.assign(patch, { embeddingModel: embedding.model, embeddingProviderId: embedding.providerId });
    saveMutation.mutate(patch);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16" data-testid="loading-vector-settings">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="container max-w-full py-3 md:py-8 px-4 md:pl-12 mx-auto md:mx-0">
      <div className="space-y-2 mb-6 max-w-3xl">
        <h1 className="text-2xl font-semibold flex items-center gap-2" data-testid="text-vector-title">
          <Database className="h-6 w-6" />
          Vector Storage
        </h1>
        <p className="text-muted-foreground">
          Connect to Qdrant for semantic search over daily notes and entities.
        </p>
      </div>

      <div className="settings-cards-grid">
        <Card data-testid="card-vector-storage">
          <CardHeader>
            <CardTitle className="text-lg">Qdrant &amp; Embeddings</CardTitle>
            <CardDescription>
              Sync daily notes and entities automatically to Qdrant.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between gap-4">
              <div className="space-y-0.5">
                <Label htmlFor="vector-enabled-switch" className="text-sm font-medium">Enable vector sync</Label>
                <p className="text-xs text-muted-foreground">
                  {enabled ? "Daily notes are being synced to Qdrant." : "Vector sync is disabled."}
                </p>
              </div>
              <Switch
                id="vector-enabled-switch"
                checked={enabled}
                onCheckedChange={(v) => { setEnabled(v); saveMutation.mutate({ enabled: v }); }}
                disabled={saveMutation.isPending}
                data-testid="switch-vector-enabled"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="qdrant-url">Server URL</Label>
              <Input
                id="qdrant-url"
                placeholder="http://localhost:6333"
                value={qdrantUrl}
                onChange={(e) => { setQdrantUrl(e.target.value); setTestResult(null); }}
                data-testid="input-qdrant-url"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="qdrant-api-key">
                API Key
                {settings?.hasApiKey && (
                  <span className="ml-2 text-xs text-muted-foreground font-normal">(saved — enter new value to change)</span>
                )}
              </Label>
              <Input
                id="qdrant-api-key"
                type="password"
                placeholder={settings?.hasApiKey ? "••••••••" : "Optional API key"}
                value={qdrantApiKey}
                onChange={(e) => setQdrantApiKey(e.target.value)}
                data-testid="input-qdrant-api-key"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="qdrant-collection">Collection name</Label>
              <Input
                id="qdrant-collection"
                placeholder="prm_daily_notes"
                value={collectionName}
                onChange={(e) => setCollectionName(e.target.value)}
                data-testid="input-qdrant-collection"
              />
              <p className="text-xs text-muted-foreground">
                Created automatically the first time a note is vectorized. Vector size is determined by the embedding model.
              </p>
            </div>
            <div className="space-y-2">
              <Label>Embedding model</Label>
              <ProviderModelPicker value={embedding} onChange={setEmbedding} testId="picker-embedding" />
              <p className="text-xs text-muted-foreground">
                Changing this invalidates existing vectors. Use "Vectorize Everything Now" below to re-embed.
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="embedding-concurrency">Parallel requests</Label>
              <Input
                id="embedding-concurrency"
                type="number"
                min={1}
                max={16}
                className="w-24"
                value={concurrency}
                onChange={(e) => setConcurrency(e.target.value)}
                data-testid="input-embedding-concurrency"
              />
              <p className="text-xs text-muted-foreground">
                Embedding requests sent at once during Vectorize Everything and App Knowledge re-index (1–16).
                Match <code className="text-xs bg-muted px-1 rounded">OLLAMA_NUM_PARALLEL</code> on the embedding machine.
              </p>
            </div>
            <div className="flex flex-wrap gap-2 pt-1">
              <Button onClick={handleSave} disabled={saveMutation.isPending} data-testid="button-save-vector-settings">
                {saveMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}
              </Button>
              <Button
                variant="outline"
                onClick={() => testMutation.mutate()}
                disabled={testMutation.isPending || !qdrantUrl.trim()}
                data-testid="button-test-qdrant"
              >
                {testMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Test connection"}
              </Button>
            </div>
            {testResult && (
              <div
                className={`flex items-start gap-2 rounded-md border p-3 text-sm ${testResult.ok ? "border-green-500/30 text-green-700 dark:text-green-400" : "border-destructive/40 text-destructive"}`}
                data-testid="text-test-result"
              >
                {testResult.ok ? <CheckCircle2 className="h-4 w-4 mt-0.5" /> : <AlertCircle className="h-4 w-4 mt-0.5" />}
                <span>{testResult.message}</span>
              </div>
            )}
          </CardContent>
        </Card>

        <UniversalVectorizationSection />
        <AppKnowledgeSection />
      </div>
    </div>
  );
}

// ── Universal Vectorization Section ──────────────────────────────────────────

function UniversalVectorizationSection() {
  const { toast } = useToast();
  const [universalEnabled, setUniversalEnabled] = useState(false);
  const [chunkChars, setChunkChars] = useState("");
  const [chunkOverlap, setChunkOverlap] = useState("");

  const { data: universalSettings } = useQuery<{ enabled: boolean; collectionName: string; chunkChars: number; chunkOverlap: number }>({
    queryKey: ["/api/vector/universal/settings"],
  });

  const { data: universalStatus, refetch: refetchStatus } = useQuery<UniversalStatus>({
    queryKey: ["/api/vector/universal/status"],
  });

  const { data: universalStats, refetch: refetchUniversalStats } = useQuery<UniversalStats>({
    queryKey: ["/api/vector/universal/stats"],
  });

  useEffect(() => {
    if (universalSettings) {
      setUniversalEnabled(universalSettings.enabled);
      setChunkChars(String(universalSettings.chunkChars));
      setChunkOverlap(String(universalSettings.chunkOverlap));
    }
  }, [universalSettings]);

  const saveUniversalMutation = useMutation({
    mutationFn: async (patch: Record<string, unknown>) => {
      const res = await apiRequest("POST", "/api/vector/universal/settings", patch);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/vector/universal/settings"] });
      queryClient.invalidateQueries({ queryKey: ["/api/vector/universal/status"] });
      queryClient.invalidateQueries({ queryKey: ["/api/vector/universal/stats"] });
      toast({ title: "Saved" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to save", description: error.message, variant: "destructive" });
    },
  });

  // The run executes server-side in the background; poll its progress while it's active.
  const { data: progress, refetch: refetchProgress } = useQuery<BulkSyncProgress>({
    queryKey: ["/api/vector/universal/progress"],
    refetchInterval: (query) => (query.state.data?.running ? 1500 : false),
  });
  const running = progress?.running ?? false;

  // Toast once when a run we saw in progress finishes, then refresh the counts.
  const [wasRunning, setWasRunning] = useState(false);
  useEffect(() => {
    if (running) { setWasRunning(true); return; }
    if (!wasRunning || !progress) return;
    setWasRunning(false);
    refetchUniversalStats();
    refetchStatus();
    if (progress.error) {
      toast({ title: "Vectorize Everything failed", description: progress.error, variant: "destructive" });
    } else {
      toast({
        title: progress.stopRequested ? "Vectorize Everything stopped" : "Vectorize Everything complete",
        description: `Processed ${progress.processed}/${progress.total}, ${progress.failed} failed.`,
      });
    }
  }, [running, wasRunning, progress, refetchUniversalStats, refetchStatus, toast]);

  // Refresh per-type counts alongside progress polling.
  useEffect(() => {
    if (running) refetchUniversalStats();
  }, [running, progress?.processed, refetchUniversalStats]);

  const vectorizeEverythingMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/vector/universal/vectorize-all", {});
      return res.json();
    },
    onSettled: () => { refetchProgress(); refetchUniversalStats(); },
    onError: (error: Error) => {
      toast({ title: "Vectorize Everything failed", description: error.message, variant: "destructive" });
    },
  });

  const stopMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/vector/universal/stop", {});
      return res.json();
    },
    onSettled: () => refetchProgress(),
  });

  // Clears vector_synced_at so a new/emptied Qdrant instance gets everything on the next Vectorize Everything.
  const resetSyncMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/vector/universal/reset-sync", {});
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Sync status reset", description: "Run Vectorize Everything and Re-index App Knowledge Base to reload the collections." });
      queryClient.invalidateQueries({ queryKey: ["/api/vector/app-knowledge/stats"] });
      refetchUniversalStats();
      refetchStatus();
    },
    onError: (error: Error) => {
      toast({ title: "Reset failed", description: error.message, variant: "destructive" });
    },
  });

  // Drops every Qdrant collection PRM uses and marks everything as not vectorized.
  const deleteAllMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/vector/delete-all", {});
      return res.json() as Promise<{ ok: boolean; deletedCollections: string[] }>;
    },
    onSuccess: (data) => {
      toast({
        title: "All vectors deleted",
        description: data.deletedCollections.length
          ? `Removed ${data.deletedCollections.join(", ")}.`
          : "No collections existed; sync status cleared.",
      });
      refetchUniversalStats();
      refetchStatus();
      queryClient.invalidateQueries({ queryKey: ["/api/vector/app-knowledge/stats"] });
    },
    onError: (error: Error) => {
      toast({ title: "Delete failed", description: error.message, variant: "destructive" });
    },
  });

  // message_chunks is a point count, not entities waiting to be vectorized.
  const { message_chunks: chunkStats, ...entityStats } = universalStats ?? {};
  const totalEntities = Object.values(entityStats).reduce((sum, s) => sum + s.total, 0);
  const totalVectorized = Object.values(entityStats).reduce((sum, s) => sum + s.vectorized, 0);
  const chunkSettingsDirty = !!universalSettings &&
    (chunkChars !== String(universalSettings.chunkChars) || chunkOverlap !== String(universalSettings.chunkOverlap));

  return (
    <Card data-testid="card-universal-vectorization">
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-blue-500" />
          Universal Vectorization
        </CardTitle>
        <CardDescription>
          Index all entities into a single collection for AI-powered Super Search.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between gap-4">
          <div className="space-y-0.5">
            <Label htmlFor="universal-enabled-switch" className="text-sm font-medium">Enable universal vectorization</Label>
            <p className="text-xs text-muted-foreground">
              {universalEnabled ? "All entities are synced to the universal collection on create/update." : "Universal vectorization is disabled."}
            </p>
          </div>
          <Switch
            id="universal-enabled-switch"
            checked={universalEnabled}
            onCheckedChange={(v) => { setUniversalEnabled(v); saveUniversalMutation.mutate({ enabled: v }); }}
            disabled={saveUniversalMutation.isPending}
            data-testid="switch-universal-enabled"
          />
        </div>

        {universalStatus && (
          <div className="rounded-md border p-3 text-sm space-y-1">
            <div className="flex items-center gap-2">
              {universalStatus.collectionReady ? (
                <CheckCircle2 className="h-4 w-4 text-green-500" />
              ) : (
                <AlertCircle className="h-4 w-4 text-muted-foreground" />
              )}
              <span>
                Collection: {universalStatus.collectionReady ? "Ready" : "Not created yet"}
                {universalStatus.collectionReady && ` (${universalStatus.pointCount} points)`}
              </span>
            </div>
          </div>
        )}

        {universalStats && (
          <div className="space-y-2">
            <p className="text-sm font-medium">Vectorization Progress</p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-center text-xs">
              {Object.entries(entityStats).map(([name, { total, vectorized }]) => (
                <div key={name} className="rounded-md border p-2">
                  <div className="font-semibold text-sm">{vectorized}/{total}</div>
                  <div className="text-muted-foreground">{name.replace(/_/g, ' ')}</div>
                </div>
              ))}
            </div>
            <div className="flex items-center gap-2 pt-1">
              <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full bg-blue-500 rounded-full transition-all"
                  style={{ width: totalEntities > 0 ? `${(totalVectorized / totalEntities) * 100}%` : "0%" }}
                />
              </div>
              <span className="text-xs text-muted-foreground">
                {totalVectorized}/{totalEntities}
              </span>
            </div>
            {chunkStats && (
              <p className="text-xs text-muted-foreground">{chunkStats.total} message chunks stored.</p>
            )}
          </div>
        )}

        <div className="rounded-md border p-3 space-y-2">
          <p className="text-sm font-medium">Message chunking</p>
          <p className="text-xs text-muted-foreground">
            Each conversation is split into overlapping chunks of whole messages, one point per chunk.
            Overlap rounds to the nearest whole message. Changes apply on the next Vectorize Everything.
          </p>
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <Label htmlFor="chunk-chars" className="text-xs">Chunk size (chars)</Label>
              <Input
                id="chunk-chars"
                type="number"
                min={500}
                max={50000}
                className="w-32"
                value={chunkChars}
                onChange={(e) => setChunkChars(e.target.value)}
                data-testid="input-chunk-chars"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="chunk-overlap" className="text-xs">Overlap (chars)</Label>
              <Input
                id="chunk-overlap"
                type="number"
                min={0}
                className="w-32"
                value={chunkOverlap}
                onChange={(e) => setChunkOverlap(e.target.value)}
                data-testid="input-chunk-overlap"
              />
            </div>
            <Button
              variant="outline"
              onClick={() => saveUniversalMutation.mutate({ chunkChars: Number(chunkChars), chunkOverlap: Number(chunkOverlap) })}
              disabled={!chunkSettingsDirty || saveUniversalMutation.isPending || running}
              data-testid="button-save-chunk-settings"
            >
              Save
            </Button>
          </div>
        </div>

        {running && progress && (
          <div className="rounded-md border p-3 space-y-2" data-testid="universal-run-progress">
            <div className="flex items-center justify-between text-xs">
              <span className="flex items-center gap-2 font-medium">
                <Loader2 className="h-3 w-3 animate-spin" />
                {progress.stopRequested ? "Stopping…" : "Vectorizing…"}
              </span>
              <span className="text-muted-foreground">
                {progress.processed}/{progress.total}{progress.failed > 0 && ` · ${progress.failed} failed`}
              </span>
            </div>
            <div className="h-2 rounded-full bg-muted overflow-hidden">
              <div
                className="h-full bg-blue-500 rounded-full transition-all"
                style={{ width: progress.total > 0 ? `${(progress.processed / progress.total) * 100}%` : "0%" }}
              />
            </div>
          </div>
        )}

        <div className="flex flex-wrap gap-2 pt-2">
          {running ? (
            <Button
              variant="destructive"
              onClick={() => stopMutation.mutate()}
              disabled={stopMutation.isPending || progress?.stopRequested}
              data-testid="button-stop-vectorize-everything"
            >
              <Square className="h-4 w-4 mr-2" />
              Stop
            </Button>
          ) : (
            <Button
              onClick={() => vectorizeEverythingMutation.mutate()}
              disabled={vectorizeEverythingMutation.isPending || !universalEnabled}
              data-testid="button-vectorize-everything"
            >
              {vectorizeEverythingMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Sparkles className="h-4 w-4 mr-2" />}
              Vectorize Everything Now
            </Button>
          )}
          <Button
            variant="outline"
            onClick={() => {
              if (confirm("Mark every entity and app knowledge chunk as not vectorized? Use this after switching to a new or emptied Qdrant instance.")) {
                resetSyncMutation.mutate();
              }
            }}
            disabled={resetSyncMutation.isPending || running}
            data-testid="button-reset-universal-sync"
          >
            {resetSyncMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
            Reset sync
          </Button>
          <Button
            variant="outline"
            className="text-destructive hover:text-destructive"
            onClick={() => {
              if (confirm("Delete ALL vectors? This drops the Super Search, daily notes and app knowledge collections in Qdrant. You'll need to run Vectorize Everything and Re-index App Knowledge Base again.")) {
                deleteAllMutation.mutate();
              }
            }}
            disabled={deleteAllMutation.isPending || running}
            data-testid="button-delete-all-vectors"
          >
            {deleteAllMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Trash2 className="h-4 w-4 mr-2" />}
            Delete all
          </Button>
          <Button variant="outline" onClick={() => { refetchUniversalStats(); refetchStatus(); }} data-testid="button-refresh-universal-stats">
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
        {!universalEnabled && (
          <p className="text-xs text-muted-foreground">Enable universal vectorization to use Super Search.</p>
        )}
      </CardContent>
    </Card>
  );
}

// ── App Knowledge Base Section ──────────────────────────────────────────────

function AppKnowledgeSection() {
  const { toast } = useToast();
  const [appEnabled, setAppEnabled] = useState(false);

  const { data: appSettingsData } = useQuery<{ enabled: boolean }>({
    queryKey: ["/api/vector/app-knowledge/settings"],
  });

  const { data: stats, refetch: refetchStats } = useQuery<{
    totalChunks: number;
    vectorized: number;
    missing: number;
    lastSyncedAt: string | null;
  }>({
    queryKey: ["/api/vector/app-knowledge/stats"],
  });

  useEffect(() => {
    if (appSettingsData) {
      setAppEnabled(appSettingsData.enabled);
    }
  }, [appSettingsData]);

  const saveSettingsMutation = useMutation({
    mutationFn: async (patch: { enabled: boolean }) => {
      const res = await apiRequest("POST", "/api/vector/app-knowledge/settings", patch);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/vector/app-knowledge/settings"] });
      queryClient.invalidateQueries({ queryKey: ["/api/vector/app-knowledge/stats"] });
      toast({ title: "Saved" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to save", description: error.message, variant: "destructive" });
    },
  });

  const reindexMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/vector/app-knowledge/reindex", {});
      return res.json();
    },
    onSuccess: () => {
      toast({
        title: "Re-indexing initiated",
        description: "App knowledge base is being chunked and vectorized in the background.",
      });
      setTimeout(() => refetchStats(), 2000);
      setTimeout(() => refetchStats(), 5000);
    },
    onError: (error: Error) => {
      toast({ title: "Re-indexing failed", description: error.message, variant: "destructive" });
    },
  });

  return (
    <Card data-testid="card-app-knowledge">
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <BookOpen className="h-5 w-5 text-indigo-500" />
          App Knowledge Base
        </CardTitle>
        <CardDescription>
          Searchable documentation database for the AI assistant.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between gap-4">
          <div className="space-y-0.5">
            <Label htmlFor="app-knowledge-enabled-switch" className="text-sm font-medium">Enable app knowledge base</Label>
            <p className="text-xs text-muted-foreground">
              {appEnabled ? "AI chat assistant can query documentation about the app." : "App knowledge base is disabled."}
            </p>
          </div>
          <Switch
            id="app-knowledge-enabled-switch"
            checked={appEnabled}
            onCheckedChange={(v) => { setAppEnabled(v); saveSettingsMutation.mutate({ enabled: v }); }}
            disabled={saveSettingsMutation.isPending}
            data-testid="switch-app-knowledge-enabled"
          />
        </div>

        {stats && (
          <div className="space-y-3 pt-2">
            <p className="text-sm font-medium">Knowledge Base Stats</p>
            <div className="grid grid-cols-3 gap-3 text-center text-xs">
              <div className="rounded-md border p-2">
                <div className="text-base font-semibold">{stats.totalChunks}</div>
                <div className="text-muted-foreground">Total chunks</div>
              </div>
              <div className="rounded-md border p-2">
                <div className="text-base font-semibold">{stats.vectorized}</div>
                <div className="text-muted-foreground">Vectorized</div>
              </div>
              <div className="rounded-md border p-2">
                <div className="text-base font-semibold">{stats.missing}</div>
                <div className="text-muted-foreground">Pending</div>
              </div>
            </div>
            {stats.lastSyncedAt && (
              <p className="text-[11px] text-muted-foreground">
                Last indexed: {new Date(stats.lastSyncedAt).toLocaleString()}
              </p>
            )}
          </div>
        )}

        <div className="flex flex-wrap gap-2 pt-2">
          <Button
            onClick={() => reindexMutation.mutate()}
            disabled={reindexMutation.isPending || !appEnabled}
            data-testid="button-reindex-app-knowledge"
          >
            {reindexMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <RefreshCw className="h-4 w-4 mr-2" />}
            Re-index App Knowledge Base
          </Button>
          <Button variant="outline" onClick={() => { refetchStats(); }} data-testid="button-refresh-app-knowledge-stats">
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
        {!appEnabled && (
          <p className="text-xs text-muted-foreground">Enable the app knowledge base to index or update the database.</p>
        )}
      </CardContent>
    </Card>
  );
}

