import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Database, CheckCircle2, Loader2, RefreshCw, AlertCircle, Sparkles, BookOpen } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

type VectorSettings = {
  enabled: boolean;
  qdrantUrl: string;
  hasApiKey: boolean;
  collectionName: string;
  embeddingModel: string;
};

type TestResult = { ok: boolean; message: string };
type EmbeddingModel = { name: string; parameterSize: string | null };
type VectorStats = {
  totalNotes: number;
  vectorized: number;
  missing: number;
  lastSyncedAt: string | null;
};
type UniversalStats = Record<string, { total: number; vectorized: number }>;
type UniversalStatus = { enabled: boolean; collectionReady: boolean; pointCount: number };

export default function VectorSettingsPage() {
  const { toast } = useToast();

  const [enabled, setEnabled] = useState(false);
  const [qdrantUrl, setQdrantUrl] = useState("");
  const [qdrantApiKey, setQdrantApiKey] = useState("");
  const [collectionName, setCollectionName] = useState("");
  const [embeddingModel, setEmbeddingModel] = useState("");
  const [testResult, setTestResult] = useState<TestResult | null>(null);

  const { data: settings, isLoading } = useQuery<VectorSettings>({
    queryKey: ["/api/vector/settings"],
  });

  const { data: modelsData, isLoading: isLoadingModels, refetch: refetchModels } = useQuery<{ models: EmbeddingModel[] }>({
    queryKey: ["/api/vector/embedding-models"],
    retry: false,
  });

  const { data: stats, refetch: refetchStats } = useQuery<VectorStats>({
    queryKey: ["/api/vector/stats"],
  });

  useEffect(() => {
    if (!settings) return;
    setEnabled(settings.enabled);
    setQdrantUrl(settings.qdrantUrl);
    setCollectionName(settings.collectionName);
    setEmbeddingModel(settings.embeddingModel);
  }, [settings]);

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

  const vectorizeAllMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/daily-notes/vectorize-all", {});
      return res.json() as Promise<{ ok: boolean; processed: number; failed: number; total: number; errors: string[] }>;
    },
    onSuccess: (data) => {
      toast({
        title: "Vectorize complete",
        description: `Processed ${data.processed}/${data.total}, ${data.failed} failed.`,
      });
      refetchStats();
    },
    onError: (error: Error) => {
      toast({ title: "Vectorize failed", description: error.message, variant: "destructive" });
    },
  });

  const handleSaveConnection = () => {
    const patch: Record<string, unknown> = { qdrantUrl, collectionName };
    if (qdrantApiKey.length > 0) patch.qdrantApiKey = qdrantApiKey;
    saveMutation.mutate(patch);
  };

  const handleSaveModel = () => {
    saveMutation.mutate({ embeddingModel });
  };

  const models = modelsData?.models ?? [];

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16" data-testid="loading-vector-settings">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="container max-w-full md:max-w-2xl py-3 md:py-8 px-4 md:pl-12 mx-auto md:mx-0">
      <div className="space-y-2 mb-6">
        <h1 className="text-2xl font-semibold flex items-center gap-2" data-testid="text-vector-title">
          <Database className="h-6 w-6" />
          Vector Storage
        </h1>
        <p className="text-muted-foreground">
          Connect to a <a href="https://qdrant.tech" target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">Qdrant</a> server to enable semantic search over your daily notes. Embeddings are generated by your configured Ollama instance.
        </p>
      </div>

      <div className="space-y-6">
        <Card data-testid="card-vector-enable">
          <CardHeader>
            <CardTitle className="text-lg">Enable Vector Storage</CardTitle>
            <CardDescription>
              When enabled, daily notes are automatically synced to Qdrant on create, update, and delete.
            </CardDescription>
          </CardHeader>
          <CardContent>
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
          </CardContent>
        </Card>

        <Card data-testid="card-qdrant-connection">
          <CardHeader>
            <CardTitle className="text-lg">Qdrant Connection</CardTitle>
            <CardDescription>
              Base URL of your Qdrant server (e.g. <code className="text-xs bg-muted px-1 rounded">http://localhost:6333</code>).
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
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
            <div className="flex flex-wrap gap-2 pt-1">
              <Button onClick={handleSaveConnection} disabled={saveMutation.isPending} data-testid="button-save-qdrant">
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

        <Card data-testid="card-embedding-model">
          <CardHeader>
            <CardTitle className="text-lg">Embedding Model</CardTitle>
            <CardDescription>
              Model used to embed daily notes. Pulled from your configured Ollama instance — embedding-capable models such as <code className="text-xs bg-muted px-1 rounded">nomic-embed-text</code> are recommended.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="embedding-model">Model</Label>
              <div className="flex gap-2">
                <Select value={embeddingModel || undefined} onValueChange={setEmbeddingModel}>
                  <SelectTrigger id="embedding-model" data-testid="select-embedding-model">
                    <SelectValue placeholder={isLoadingModels ? "Loading models…" : (models.length === 0 ? "No models available — configure Ollama first" : "Select a model")} />
                  </SelectTrigger>
                  <SelectContent>
                    {models.map(m => (
                      <SelectItem key={m.name} value={m.name}>
                        {m.name}{m.parameterSize ? ` (${m.parameterSize})` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button variant="outline" size="icon" onClick={() => refetchModels()} disabled={isLoadingModels} data-testid="button-refresh-models">
                  <RefreshCw className={`h-4 w-4 ${isLoadingModels ? "animate-spin" : ""}`} />
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Changing this invalidates existing vectors. Use "Vectorize all daily notes" below to re-embed.
              </p>
            </div>
            <div className="flex gap-2">
              <Button onClick={handleSaveModel} disabled={saveMutation.isPending || !embeddingModel} data-testid="button-save-model">
                {saveMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save model"}
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card data-testid="card-vector-usage">
          <CardHeader>
            <CardTitle className="text-lg">Usage</CardTitle>
            <CardDescription>Vectorization status across all daily notes.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-3 gap-3 text-center">
              <div className="rounded-md border p-3" data-testid="stat-total">
                <div className="text-2xl font-semibold">{stats?.totalNotes ?? 0}</div>
                <div className="text-xs text-muted-foreground">Total notes</div>
              </div>
              <div className="rounded-md border p-3" data-testid="stat-vectorized">
                <div className="text-2xl font-semibold">{stats?.vectorized ?? 0}</div>
                <div className="text-xs text-muted-foreground">Vectorized</div>
              </div>
              <div className="rounded-md border p-3" data-testid="stat-missing">
                <div className="text-2xl font-semibold">{stats?.missing ?? 0}</div>
                <div className="text-xs text-muted-foreground">Pending</div>
              </div>
            </div>
            {stats?.lastSyncedAt && (
              <p className="text-xs text-muted-foreground" data-testid="text-last-synced">
                Last sync: {new Date(stats.lastSyncedAt).toLocaleString()}
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              <Button
                onClick={() => vectorizeAllMutation.mutate()}
                disabled={vectorizeAllMutation.isPending || !enabled}
                data-testid="button-vectorize-all"
              >
                {vectorizeAllMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                Vectorize all daily notes
              </Button>
              <Button variant="outline" onClick={() => refetchStats()} data-testid="button-refresh-stats">
                <RefreshCw className="h-4 w-4" />
              </Button>
            </div>
            {!enabled && (
              <p className="text-xs text-muted-foreground">Enable vector sync to vectorize notes.</p>
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

  const { data: universalSettings } = useQuery<{ enabled: boolean; collectionName: string }>({
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
      toast({ title: "Saved" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to save", description: error.message, variant: "destructive" });
    },
  });

  const vectorizeEverythingMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/vector/universal/vectorize-all", {});
      return res.json() as Promise<{ ok: boolean; processed: number; failed: number; total: number; errors: string[] }>;
    },
    onSuccess: (data) => {
      toast({
        title: "Vectorize Everything complete",
        description: `Processed ${data.processed}/${data.total}, ${data.failed} failed.`,
      });
      refetchUniversalStats();
      refetchStatus();
    },
    onError: (error: Error) => {
      toast({ title: "Vectorize Everything failed", description: error.message, variant: "destructive" });
    },
  });

  const totalEntities = universalStats
    ? Object.values(universalStats).reduce((sum, s) => sum + s.total, 0)
    : 0;
  const totalVectorized = universalStats
    ? Object.values(universalStats).reduce((sum, s) => sum + s.vectorized, 0)
    : 0;

  return (
    <Card data-testid="card-universal-vectorization">
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-blue-500" />
          Universal Vectorization
        </CardTitle>
        <CardDescription>
          Vectorize all entity types (people, groups, notes, interactions, social accounts, daily notes, AI chats, and images) into a single collection for powerful AI-powered "Super Search".
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
              {Object.entries(universalStats).map(([name, { total, vectorized }]) => (
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
          </div>
        )}

        <div className="flex flex-wrap gap-2 pt-2">
          <Button
            onClick={() => vectorizeEverythingMutation.mutate()}
            disabled={vectorizeEverythingMutation.isPending || !universalEnabled}
            data-testid="button-vectorize-everything"
          >
            {vectorizeEverythingMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Sparkles className="h-4 w-4 mr-2" />}
            Vectorize Everything Now
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
          Provide a searchable documentation database about the application itself to the AI chat assistant. Uses data loaded from the CSV file.
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

