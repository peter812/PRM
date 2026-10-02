import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
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
import { Scan, Key, Wifi, WifiOff, CheckCircle2, Loader2, Eye, EyeOff, Copy, Check, Trash2, BrainCircuit, Sliders, ScanText, Download, Mic, Timer, Sparkles, Layers } from "lucide-react";
import { Link } from "wouter";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

type PrmFaceSettings = {
  apiUrl: string;
  hasApiKey: boolean;
};

type TestResult = {
  ok: boolean;
  message: string;
};

export default function RecognitionSettingsPage() {
  const { toast } = useToast();
  const [apiUrl, setApiUrl] = useState("");
  const [setupCode, setSetupCode] = useState("");
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [revealedKey, setRevealedKey] = useState<string | null>(null);
  const [keyVisible, setKeyVisible] = useState(false);
  const [copied, setCopied] = useState(false);
  const [isRevealing, setIsRevealing] = useState(false);
  const [resetDialogOpen, setResetDialogOpen] = useState(false);

  const [maxFaces, setMaxFaces] = useState<number>(10);
  const [minFaceSize, setMinFaceSize] = useState<number>(20);
  const [sureness, setSureness] = useState<number>(65);

  const { data: settings, isLoading } = useQuery<PrmFaceSettings>({
    queryKey: ["/api/prm-face/settings"],
  });

  const { data: facialIntelligenceData } = useQuery<{ enabled: boolean }>({
    queryKey: ["/api/prm-face/facial-intelligence"],
  });
  const facialIntelligenceEnabled = facialIntelligenceData?.enabled ?? false;

  const facialIntelligenceMutation = useMutation({
    mutationFn: async (enabled: boolean) => {
      const res = await apiRequest("POST", "/api/prm-face/facial-intelligence", { enabled });
      return res.json();
    },
    onSuccess: (_data, enabled) => {
      queryClient.invalidateQueries({ queryKey: ["/api/prm-face/facial-intelligence"] });
      toast({ title: enabled ? "Facial intelligence features enabled" : "Facial intelligence features disabled" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to update setting", description: error.message, variant: "destructive" });
    },
  });

  useEffect(() => {
    if (settings?.apiUrl !== undefined) {
      setApiUrl(settings.apiUrl);
    }
  }, [settings?.apiUrl]);

  const saveUrlMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/prm-face/settings", { apiUrl });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/prm-face/settings"] });
      toast({ title: "API URL saved" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to save API URL", description: error.message, variant: "destructive" });
    },
  });

  const generateKeyMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/prm-face/generate-key", { setupCode });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/prm-face/settings"] });
      setSetupCode("");
      toast({ title: "API key generated", description: "Your PRM-Compute API key has been saved securely." });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to generate API key", description: error.message, variant: "destructive" });
    },
  });

  const handleRevealKey = async () => {
    if (revealedKey) {
      setKeyVisible((v) => !v);
      return;
    }
    setIsRevealing(true);
    try {
      const res = await fetch("/api/prm-face/reveal-key", { credentials: "include" });
      const text = await res.text();
      let data: any;
      try {
        data = JSON.parse(text);
      } catch {
        throw new Error("Unexpected response from server — your session may have expired. Please refresh the page.");
      }
      if (!res.ok) throw new Error(data.error || "Failed to retrieve key");
      setRevealedKey(data.apiKey);
      setKeyVisible(true);
    } catch (err: any) {
      toast({ title: "Could not retrieve key", description: err.message, variant: "destructive" });
    } finally {
      setIsRevealing(false);
    }
  };

  const handleCopy = async () => {
    if (!revealedKey) return;
    await navigator.clipboard.writeText(revealedKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const testMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/prm-face/test", {});
      return res.json() as Promise<TestResult>;
    },
    onSuccess: (data) => {
      setTestResult(data);
    },
    onError: (error: Error) => {
      setTestResult({ ok: false, message: error.message });
    },
  });

  const deleteFaceDataMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/prm-face/delete-face-data", {});
      return res.json();
    },
    onSuccess: (data: { compute?: { faces_deleted?: number }; local?: { photosCleared?: number } }) => {
      setResetDialogOpen(false);
      toast({
        title: "Face data deleted",
        description: `${data.compute?.faces_deleted ?? 0} faces and their crops removed; ${data.local?.photosCleared ?? 0} photos will be re-scanned.`,
      });
    },
    onError: (error: Error) => {
      setResetDialogOpen(false);
      toast({ title: "Delete failed", description: error.message, variant: "destructive" });
    },
  });

  type FaceConfig = {
    max_faces: number;
    min_face_size: number;
    sureness: number;
  };

  const { data: config } = useQuery<FaceConfig>({
    queryKey: ["/api/prm-face/config"],
    enabled: !!settings?.hasApiKey,
  });

  useEffect(() => {
    if (config) {
      setMaxFaces(config.max_faces);
      setMinFaceSize(config.min_face_size);
      setSureness(config.sureness);
    }
  }, [config]);

  const saveConfigMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/prm-face/config", {
        maxFaces,
        minFaceSize,
        sureness,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/prm-face/config"] });
      toast({ title: "Recognition configuration updated successfully" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to update configuration", description: error.message, variant: "destructive" });
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16" data-testid="loading-recognition-settings">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const hasApiKey = settings?.hasApiKey ?? false;

  return (
    <div className="container max-w-full py-3 md:py-8 px-4 md:pl-12 mx-auto md:mx-0">
      <div className="space-y-2 mb-6 max-w-3xl">
        <h1 className="text-2xl font-semibold flex items-center gap-2" data-testid="text-recognition-settings-title">
          <Scan className="h-6 w-6" />
          PRM-Compute API
        </h1>
        <p className="text-muted-foreground">
          PRM-Compute is a self-hosted compute and intelligence service (facial recognition, OCR, and OSINT). Configure the URL of your PRM-Compute server below,
          then use your one-time setup code to generate an API key that links this application to it.
        </p>
      </div>

      <div className="settings-cards-grid">
        <Card data-testid="card-api-url">
          <CardHeader>
            <CardTitle className="text-lg">API URL</CardTitle>
            <CardDescription>
              The base URL of your PRM-Compute server (e.g. <code className="text-xs bg-muted px-1 rounded">http://localhost:8000</code>).
              This setting is saved persistently.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="api-url">Server URL</Label>
              <div className="flex gap-2">
                <Input
                  id="api-url"
                  placeholder="http://localhost:8000"
                  value={apiUrl}
                  onChange={(e) => setApiUrl(e.target.value)}
                  disabled={saveUrlMutation.isPending}
                  data-testid="input-prm-face-api-url"
                />
                <Button
                  onClick={() => saveUrlMutation.mutate()}
                  disabled={saveUrlMutation.isPending || !apiUrl.trim()}
                  data-testid="button-save-api-url"
                >
                  {saveUrlMutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    "Save"
                  )}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card data-testid="card-api-key">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Key className="h-4 w-4" />
              API Key
            </CardTitle>
            <CardDescription>
              Enter the setup code printed by PRM-Compute at startup to generate an API key.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {hasApiKey && (
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-sm text-muted-foreground rounded-md bg-muted p-3" data-testid="text-key-status">
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-green-600 dark:text-green-500" />
                  <span>An API key is configured. Enter a new setup code below to replace it.</span>
                </div>
                <div className="flex gap-2" data-testid="row-reveal-key">
                  <div className="relative flex-1">
                    <Input
                      readOnly
                      value={revealedKey ?? ""}
                      type={keyVisible ? "text" : "password"}
                      placeholder="••••••••••••••••••••••••••••••••"
                      className="pr-10 font-mono text-sm"
                      data-testid="input-revealed-key"
                    />
                    {revealedKey && (
                      <button
                        type="button"
                        onClick={() => setKeyVisible((v) => !v)}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                        data-testid="button-toggle-key-visibility"
                      >
                        {keyVisible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    )}
                  </div>
                  <Button
                    variant="outline"
                    onClick={handleRevealKey}
                    disabled={isRevealing}
                    data-testid="button-reveal-key"
                  >
                    {isRevealing ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : revealedKey ? (
                      keyVisible ? <><EyeOff className="h-4 w-4 mr-2" />Hide</> : <><Eye className="h-4 w-4 mr-2" />Show</>
                    ) : (
                      <><Eye className="h-4 w-4 mr-2" />Show API Key</>
                    )}
                  </Button>
                  {revealedKey && (
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={handleCopy}
                      data-testid="button-copy-key"
                    >
                      {copied ? <Check className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4" />}
                    </Button>
                  )}
                </div>
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="setup-code">Setup Code</Label>
              <Input
                id="setup-code"
                placeholder="a3f8c2d1e9b076541234567890abcdef"
                value={setupCode}
                onChange={(e) => setSetupCode(e.target.value)}
                disabled={generateKeyMutation.isPending}
                data-testid="input-setup-code"
              />
            </div>
            <div className="flex gap-3 flex-wrap">
              <Button
                onClick={() => generateKeyMutation.mutate()}
                disabled={generateKeyMutation.isPending || !setupCode.trim() || !apiUrl.trim()}
                data-testid="button-generate-api-key"
              >
                {generateKeyMutation.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    {hasApiKey ? "Regenerating…" : "Generating…"}
                  </>
                ) : (
                  <>
                    <Key className="h-4 w-4 mr-2" />
                    {hasApiKey ? "Regenerate API Key" : "Generate API Key"}
                  </>
                )}
              </Button>
              <Button
                variant="outline"
                onClick={() => testMutation.mutate()}
                disabled={testMutation.isPending || !apiUrl.trim()}
                data-testid="button-test-connection"
              >
                {testMutation.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Testing…
                  </>
                ) : (
                  <>
                    <Wifi className="h-4 w-4 mr-2" />
                    Test Connection
                  </>
                )}
              </Button>
            </div>

            {testResult !== null && (
              <div
                className={`flex items-start gap-2 rounded-md p-3 text-sm ${testResult.ok ? "bg-primary/10 border border-primary/20" : "bg-destructive/10 border border-destructive/20"}`}
                data-testid="text-test-result"
              >
                {testResult.ok ? (
                  <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" />
                ) : (
                  <WifiOff className="h-4 w-4 shrink-0 mt-0.5 text-destructive" />
                )}
                <span>{testResult.message}</span>
              </div>
            )}
          </CardContent>
        </Card>
        {hasApiKey && (
          <Card data-testid="card-recognition-params">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Sliders className="h-4 w-4" />
                Recognition Parameters
              </CardTitle>
              <CardDescription>
                Adjust the parameters used by the facial detection and recognition model.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="max-faces">Max Faces Detected per Image ({maxFaces})</Label>
                <Input
                  id="max-faces"
                  type="number"
                  min={1}
                  max={100}
                  value={maxFaces}
                  onChange={(e) => setMaxFaces(Number(e.target.value))}
                  data-testid="input-max-faces"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="min-face-size">Min Face Size in Pixels ({minFaceSize}px)</Label>
                <Input
                  id="min-face-size"
                  type="number"
                  min={5}
                  max={500}
                  value={minFaceSize}
                  onChange={(e) => setMinFaceSize(Number(e.target.value))}
                  data-testid="input-min-face-size"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="sureness">Face Sureness Requirement ({sureness}%)</Label>
                <div className="flex items-center gap-4">
                  <input
                    id="sureness"
                    type="range"
                    min={0}
                    max={100}
                    value={sureness}
                    onChange={(e) => setSureness(Number(e.target.value))}
                    className="flex-1 accent-primary"
                    data-testid="slider-sureness"
                  />
                  <span className="w-12 text-right font-mono text-sm">{sureness}%</span>
                </div>
              </div>
              <Button
                onClick={() => saveConfigMutation.mutate()}
                disabled={saveConfigMutation.isPending}
                data-testid="button-save-config"
              >
                {saveConfigMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : null}
                Save Configuration
              </Button>
            </CardContent>
          </Card>
        )}

        {hasApiKey && (
          <>
            <ComputeModelCard
              engine="ocr"
              title="OCR"
              icon={<ScanText className="h-4 w-4" />}
              blurb="Choose which PaddleOCR (PP-OCRv5) model PRM-Compute uses to read text from images."
              requestNoun="OCR request"
            />
            <ComputeModelCard
              engine="whisper"
              title="Whisper"
              heading="Speech-to-text (Whisper)"
              icon={<Mic className="h-4 w-4" />}
              blurb="Choose which Whisper model PRM-Compute uses to transcribe dictation and Describe Me recordings."
              requestNoun="transcription"
            />
            <IdleUnloadCard />
            <ParallelLanesCard />
          </>
        )}

        <Card data-testid="card-facial-intelligence">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <BrainCircuit className="h-4 w-4" />
              Facial Intelligence Features
            </CardTitle>
            <CardDescription>
              Enables the Photos tab on person profiles and facial recognition data.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between gap-4">
              <div className="space-y-0.5">
                <Label htmlFor="facial-intelligence-switch" className="text-sm font-medium">
                  Enable facial intelligence features
                </Label>
                <p className="text-xs text-muted-foreground">
                  {facialIntelligenceEnabled
                    ? "Features are active. Person profiles show a Photos tab."
                    : "Features are disabled. No recognition data is sent to the client."}
                </p>
              </div>
              <Switch
                id="facial-intelligence-switch"
                checked={facialIntelligenceEnabled}
                onCheckedChange={(checked) => facialIntelligenceMutation.mutate(checked)}
                disabled={facialIntelligenceMutation.isPending}
                data-testid="switch-facial-intelligence"
              />
            </div>
          </CardContent>
        </Card>

        <AutoRecognitionCard />

        <Card className="border-destructive/40" data-testid="card-danger-zone">
          <CardHeader>
            <CardTitle className="text-lg text-destructive flex items-center gap-2">
              <Trash2 className="h-4 w-4" />
              Danger Zone
            </CardTitle>
            <CardDescription>
              Permanently delete detected faces and assignments. Photos are preserved.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              variant="destructive"
              onClick={() => setResetDialogOpen(true)}
              disabled={!hasApiKey || deleteFaceDataMutation.isPending}
              data-testid="button-delete-face-data"
            >
              {deleteFaceDataMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Deleting…
                </>
              ) : (
                <>
                  <Trash2 className="h-4 w-4 mr-2" />
                  Delete Face Data
                </>
              )}
            </Button>
            {!hasApiKey && (
              <p className="text-xs text-muted-foreground mt-2" data-testid="text-reset-disabled-hint">
                Configure an API key above before using this action.
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      <AlertDialog open={resetDialogOpen} onOpenChange={setResetDialogOpen}>
        <AlertDialogContent data-testid="dialog-confirm-delete-face-data">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete face data?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove all detected faces, face crops, pending face questions, and
              person-to-face links from PRM and PRM-Compute. Photos are kept.
              This action <strong>cannot be undone</strong>.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete-face-data">Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteFaceDataMutation.mutate()}
              data-testid="button-confirm-delete-face-data"
            >
              Yes, delete face data
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
type ComputeModel = {
  id: string;
  label: string;
  description: string;
  downloaded: boolean;
  downloading: boolean;
  error: string | null;
  active: boolean;
  device: "cuda" | "cpu";
};

// Model picker for one PRM-Compute engine (OCR, Whisper). Both expose the same
// /models, /models/:id/download and /config endpoints, proxied by PRM.
function ComputeModelCard({
  engine,
  title,
  heading = title,
  icon,
  blurb,
  requestNoun,
}: {
  engine: "ocr" | "whisper";
  title: string;
  heading?: string;
  icon: React.ReactNode;
  blurb: string;
  requestNoun: string;
}) {
  const { toast } = useToast();
  const modelsKey = `/api/prm-face/${engine}/models`;
  const [model, setModel] = useState<string>("");

  const { data: models } = useQuery<{ models: ComputeModel[] }>({
    queryKey: [modelsKey],
    // Poll while a download is in flight so the buttons flip to "Downloaded".
    refetchInterval: (query) => (query.state.data?.models.some((m) => m.downloading) ? 2000 : false),
  });

  useEffect(() => {
    const active = models?.models.find((m) => m.active);
    if (active) setModel(active.id);
  }, [models]);

  const downloadMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("POST", `${modelsKey}/${id}/download`, {});
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [modelsKey] });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to start download", description: error.message, variant: "destructive" });
    },
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/prm-face/${engine}/config`, { model });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [modelsKey] });
      toast({ title: `${title} model updated` });
    },
    onError: (error: Error) => {
      toast({ title: `Failed to update ${title} model`, description: error.message, variant: "destructive" });
    },
  });

  return (
    <Card data-testid={`card-${engine}`}>
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          {icon}
          {heading}
        </CardTitle>
        <CardDescription>
          {blurb}
          {models && (
            <> (Device: <span className="font-medium text-foreground" data-testid={`text-${engine}-device`}>{models.models[0]?.device === "cuda" ? "GPU" : "CPU"}</span>)</>
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor={`${engine}-model`}>Active {title} Model</Label>
          <div className="flex gap-2">
            <Select value={model} onValueChange={setModel}>
              <SelectTrigger id={`${engine}-model`} className="flex-1" data-testid={`select-${engine}-model`}>
                <SelectValue placeholder="Select a model" />
              </SelectTrigger>
              <SelectContent>
                {models?.models.map((m) => (
                  <SelectItem key={m.id} value={m.id} data-testid={`option-${engine}-model-${m.id}`}>
                    {m.label}{m.downloaded ? "" : " (not downloaded)"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              onClick={() => saveMutation.mutate()}
              disabled={saveMutation.isPending || !model || models?.models.find((m) => m.active)?.id === model}
              data-testid={`button-save-${engine}-model`}
            >
              {saveMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}
            </Button>
          </div>
        </div>

        <div className="space-y-2">
          {models?.models.map((m) => (
            <div
              key={m.id}
              className="flex items-center justify-between gap-4 rounded-md border p-3"
              data-testid={`row-${engine}-model-${m.id}`}
            >
              <div className="space-y-0.5 min-w-0">
                <p className="text-sm font-medium">{m.label}</p>
                <p className="text-xs text-muted-foreground">{m.description}</p>
                {m.error && <p className="text-xs text-destructive">Download failed: {m.error}</p>}
              </div>
              {m.downloaded ? (
                <span className="flex items-center gap-1 text-xs text-muted-foreground shrink-0">
                  <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-500" />
                  Downloaded
                </span>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  className="shrink-0"
                  onClick={() => downloadMutation.mutate(m.id)}
                  disabled={m.downloading || downloadMutation.isPending}
                  data-testid={`button-download-${engine}-model-${m.id}`}
                >
                  {m.downloading ? (
                    <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Downloadingâ€¦</>
                  ) : (
                    <><Download className="h-4 w-4 mr-2" />Download</>
                  )}
                </Button>
              )}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

type IdleUnloadStatus = {
  enabled: boolean;
  minutes: number;
  loaded: { engine: string; model: string; idle_seconds: number }[] | null;
  computeError?: string;
};

type Lanes = { face: number; ocr: number; stt: number; total: number; busyWait: number };
type LaneLoad = { limit: number; running: number; waiting: number };
type LanesStatus = {
  lanes: Lanes;
  max: Lanes;
  status: {
    lanes: { face: LaneLoad; ocr: LaneLoad; whisper: LaneLoad; total: LaneLoad };
    cpu_count: number;
    devices: { face: string; ocr: string; whisper: string };
  } | null;
  computeError?: string;
};

const LANE_PRESETS: { id: string; label: string; lanes: Omit<Lanes, "busyWait">; hint: string }[] = [
  { id: "serial", label: "Serial", lanes: { face: 1, ocr: 1, stt: 1, total: 1 }, hint: "One job at a time. Low-memory box or debugging." },
  { id: "balanced", label: "Balanced", lanes: { face: 1, ocr: 1, stt: 1, total: 3 }, hint: "One face, one OCR and one transcription side by side." },
  { id: "fast", label: "Fast", lanes: { face: 2, ocr: 2, stt: 1, total: 4 }, hint: "4+ CPU cores, or a GPU with 8 GB or more." },
  { id: "max", label: "Max", lanes: { face: 4, ocr: 4, stt: 2, total: 8 }, hint: "A GPU with 16 GB or more, or many CPU cores." },
];
const LANE_FIELDS: { key: keyof Lanes; label: string }[] = [
  { key: "face", label: "Face" },
  { key: "ocr", label: "OCR" },
  { key: "stt", label: "Speech-to-text" },
  { key: "total", label: "Total cap" },
  { key: "busyWait", label: "Busy wait (s)" },
];

function presetOf(l: Lanes) {
  return LANE_PRESETS.find((p) => Object.entries(p.lanes).every(([k, v]) => l[k as keyof Lanes] === v))?.id ?? "custom";
}

function formatIdle(seconds: number) {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`;
}

// Automatic recognition: what to queue for PRM-Compute when prm-stories delivers
// new stories, posts and profile pictures. Toggles only affect new arrivals;
// "Run on existing" queues the unprocessed backlog through the image task queue.
type AutoRecognitionKind = "profile" | "post" | "story" | "message";
type AutoRecognitionJob = "face" | "ocr" | "transcribe";
type AutoRecognitionSettings = Record<AutoRecognitionKind, Partial<Record<AutoRecognitionJob, boolean>>> & {
  profileLink?: { minFacePct: number };
  lookalike?: { minScore: number };
  autoAssign?: { minScore: number };
};
type BackfillCounts = Record<AutoRecognitionKind, Partial<Record<AutoRecognitionJob, number>>>;

const AUTO_RECOGNITION_SECTIONS: { kind: AutoRecognitionKind; title: string; noun: string; jobs: { job: AutoRecognitionJob; label: string; hint: string }[] }[] = [
  { kind: "profile", title: "Profile images", noun: "profile", jobs: [
    { job: "face", label: "Facial recognition", hint: "Detect faces on each new profile picture." },
  ] },
  { kind: "post", title: "Posts", noun: "post", jobs: [
    { job: "face", label: "Facial recognition", hint: "Detect faces on every slide of a new post." },
    { job: "ocr", label: "OCR", hint: "Extract any text in the images." },
    { job: "transcribe", label: "Videos: speech to text", hint: "Transcribe the audio of video posts with Whisper." },
  ] },
  { kind: "story", title: "Stories", noun: "story", jobs: [
    { job: "face", label: "Facial recognition", hint: "Detect faces on each new story frame." },
    { job: "ocr", label: "OCR", hint: "Extract any text in the story image." },
    { job: "transcribe", label: "Videos: speech to text", hint: "Transcribe the audio of video stories with Whisper." },
  ] },
  { kind: "message", title: "Messages", noun: "message", jobs: [
    { job: "face", label: "Facial recognition", hint: "Detect faces on images sent in imported messages." },
  ] },
];

const JOB_NOUN: Record<AutoRecognitionJob, string> = { face: "facial recognition", ocr: "OCR", transcribe: "speech to text" };

function AutoRecognitionCard() {
  const { toast } = useToast();
  const [pendingBackfill, setPendingBackfill] = useState<{ kind: AutoRecognitionKind; job: AutoRecognitionJob; count: number } | null>(null);
  const [minFacePct, setMinFacePct] = useState("");
  const [minScore, setMinScore] = useState("");
  const [autoAssignScore, setAutoAssignScore] = useState("");

  const { data: settings } = useQuery<AutoRecognitionSettings>({ queryKey: ["/api/recognition/auto"] });
  useEffect(() => {
    if (settings?.profileLink) setMinFacePct(String(settings.profileLink.minFacePct));
  }, [settings?.profileLink?.minFacePct]);
  useEffect(() => {
    if (settings?.lookalike) setMinScore(String(settings.lookalike.minScore));
  }, [settings?.lookalike?.minScore]);
  useEffect(() => {
    if (settings?.autoAssign) setAutoAssignScore(String(settings.autoAssign.minScore));
  }, [settings?.autoAssign?.minScore]);
  const { data: counts, isFetching: countsLoading } = useQuery<BackfillCounts>({
    queryKey: ["/api/recognition/auto/backfill-counts"],
    refetchInterval: 30000,
  });

  const saveMutation = useMutation({
    mutationFn: async (update: Partial<AutoRecognitionSettings>) => {
      const res = await apiRequest("POST", "/api/recognition/auto", update);
      return res.json() as Promise<AutoRecognitionSettings>;
    },
    onSuccess: (data) => {
      queryClient.setQueryData(["/api/recognition/auto"], data);
      // Look-alike threshold and profile-link settings change what the review queue suggests.
      queryClient.invalidateQueries({ queryKey: ["/api/face-review"] });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to update setting", description: error.message, variant: "destructive" });
    },
  });

  const autoAssignMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/face-review/auto-assign");
      return res.json() as Promise<{ scanned: number; assigned: number }>;
    },
    onSuccess: ({ scanned, assigned }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/face-review"] });
      queryClient.invalidateQueries({ queryKey: ["/api/face-review/counts"] });
      toast({ title: assigned ? `Auto-assigned ${assigned} of ${scanned} faces` : `No confident matches among ${scanned} faces` });
    },
    onError: (error: Error) => {
      toast({ title: "Auto-assign failed", description: error.message, variant: "destructive" });
    },
  });

  const associateMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/recognition/auto/associate-profile-faces");
      return res.json() as Promise<{ examined: number; linked: number; skipped: Record<string, number> }>;
    },
    onSuccess: ({ examined, linked, skipped }) => {
      const skippedText = Object.entries(skipped).map(([reason, n]) => `${n} ${reason.replace(/_/g, " ")}`).join(", ");
      toast({
        title: examined ? `Linked ${linked} of ${examined} account${examined === 1 ? "" : "s"}` : "Nothing to associate",
        description: skippedText ? `Skipped: ${skippedText}.` : examined ? undefined : "Every recognised profile picture is already linked, or has not been recognised yet.",
      });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to associate", description: error.message, variant: "destructive" });
    },
  });

  const backfillMutation = useMutation({
    mutationFn: async ({ kind, job }: { kind: AutoRecognitionKind; job: AutoRecognitionJob }) => {
      const res = await apiRequest("POST", "/api/recognition/auto/backfill", { kind, job });
      return res.json() as Promise<{ queued: number }>;
    },
    onSuccess: ({ queued }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/recognition/auto/backfill-counts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/image-tasks"] });
      toast({ title: queued ? `Queued ${queued.toLocaleString()} task${queued === 1 ? "" : "s"}` : "Nothing to queue", description: queued ? "Progress shows on the Image Tasks page." : undefined });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to queue backfill", description: error.message, variant: "destructive" });
    },
  });

  return (
    <Card data-testid="card-auto-recognition">
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <Sparkles className="h-4 w-4" />
          Automatic Recognition
        </CardTitle>
        <CardDescription>
          Automatically queue recognition for new arrivals. Track queue on <Link href="~/settings/image-tasks" className="underline">Image Tasks</Link>.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {AUTO_RECOGNITION_SECTIONS.map((section) => (
          <div key={section.kind} className="space-y-3" data-testid={`auto-recognition-${section.kind}`}>
            <h3 className="text-sm font-semibold">{section.title}</h3>
            {section.jobs.map(({ job, label, hint }) => {
              const count = counts?.[section.kind]?.[job];
              const id = `auto-recog-${section.kind}-${job}`;
              return (
                <div key={job} className="flex items-center justify-between gap-4">
                  <div className="space-y-0.5">
                    <Label htmlFor={id} className="text-sm font-medium">{label}</Label>
                    <p className="text-xs text-muted-foreground">{hint}</p>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={countsLoading && count === undefined || !count || backfillMutation.isPending}
                      onClick={() => setPendingBackfill({ kind: section.kind, job, count: count ?? 0 })}
                      data-testid={`button-backfill-${section.kind}-${job}`}
                    >
                      Run on existing{count !== undefined ? ` (${count.toLocaleString()})` : ""}
                    </Button>
                    <Switch
                      id={id}
                      checked={!!settings?.[section.kind]?.[job]}
                      onCheckedChange={(checked) => saveMutation.mutate({ [section.kind]: { [job]: checked } })}
                      disabled={!settings || saveMutation.isPending}
                      data-testid={`switch-${id}`}
                    />
                  </div>
                </div>
              );
            })}
            {section.kind === "profile" && (
              <div className="flex items-center justify-between gap-4">
                <div className="space-y-0.5">
                  <p className="text-sm font-medium">Accounts and faces</p>
                  <p className="text-xs text-muted-foreground">
                    Link single-face profile pictures to their account.
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="shrink-0"
                  disabled={associateMutation.isPending}
                  onClick={() => associateMutation.mutate()}
                  data-testid="button-associate-profile-faces"
                >
                  {associateMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Associate"}
                </Button>
              </div>
            )}
            {section.kind === "profile" && (
              <div className="flex items-center justify-between gap-4">
                <div className="space-y-0.5">
                  <Label htmlFor="profile-link-min-face-pct" className="text-sm font-medium">Min face size to link the account</Label>
                  <p className="text-xs text-muted-foreground">
                    Minimum face size (% of shorter side) to link to account holder.
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Input
                    id="profile-link-min-face-pct"
                    type="number"
                    min={1}
                    max={100}
                    className="w-20"
                    value={minFacePct}
                    onChange={(e) => setMinFacePct(e.target.value)}
                    onBlur={() => {
                      const pct = Number(minFacePct);
                      if (pct > 0 && pct <= 100 && pct !== settings?.profileLink?.minFacePct) saveMutation.mutate({ profileLink: { minFacePct: pct } });
                    }}
                    disabled={!settings || saveMutation.isPending}
                    data-testid="input-profile-link-min-face-pct"
                  />
                  <span className="text-sm text-muted-foreground">%</span>
                </div>
              </div>
            )}
            {section.kind === "profile" && (
              <div className="flex items-center justify-between gap-4">
                <div className="space-y-0.5">
                  <Label htmlFor="lookalike-min-score" className="text-sm font-medium">Min look-alike score</Label>
                  <p className="text-xs text-muted-foreground">
                    Minimum similarity (0–1) to suggest matches on Face Review.
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Input
                    id="lookalike-min-score"
                    type="number"
                    min={0.01}
                    max={1}
                    step={0.01}
                    className="w-20"
                    value={minScore}
                    onChange={(e) => setMinScore(e.target.value)}
                    onBlur={() => {
                      const score = Number(minScore);
                      if (score > 0 && score <= 1 && score !== settings?.lookalike?.minScore) saveMutation.mutate({ lookalike: { minScore: score } });
                    }}
                    disabled={!settings || saveMutation.isPending}
                    data-testid="input-lookalike-min-score"
                  />
                </div>
              </div>
            )}
            {section.kind === "profile" && (
              <div className="flex items-center justify-between gap-4">
                <div className="space-y-0.5">
                  <Label htmlFor="auto-assign-min-score" className="text-sm font-medium">Auto-assign score</Label>
                  <p className="text-xs text-muted-foreground">
                    Minimum similarity (0–1) to auto-assign faces. Near ties are left for review.
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Input
                    id="auto-assign-min-score"
                    type="number"
                    min={0.01}
                    max={1}
                    step={0.01}
                    className="w-20"
                    value={autoAssignScore}
                    onChange={(e) => setAutoAssignScore(e.target.value)}
                    onBlur={() => {
                      const score = Number(autoAssignScore);
                      if (score > 0 && score <= 1 && score !== settings?.autoAssign?.minScore) saveMutation.mutate({ autoAssign: { minScore: score } });
                    }}
                    disabled={!settings || saveMutation.isPending}
                    data-testid="input-auto-assign-min-score"
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={autoAssignMutation.isPending}
                    onClick={() => autoAssignMutation.mutate()}
                    data-testid="button-auto-assign-now"
                  >
                    {autoAssignMutation.isPending ? "Matching…" : "Run now"}
                  </Button>
                </div>
              </div>
            )}
          </div>
        ))}
      </CardContent>

      <AlertDialog open={!!pendingBackfill} onOpenChange={(open) => !open && setPendingBackfill(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Queue {pendingBackfill ? JOB_NOUN[pendingBackfill.job] : ""} on existing content?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingBackfill && (
                <>
                  This queues {pendingBackfill.count.toLocaleString()} {AUTO_RECOGNITION_SECTIONS.find((s) => s.kind === pendingBackfill.kind)?.noun}{" "}
                  {pendingBackfill.job === "transcribe" ? "video" : "image"}{pendingBackfill.count === 1 ? "" : "s"} that
                  {pendingBackfill.count === 1 ? " has" : " have"} never been processed. PRM-Compute works through them one at a time.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (pendingBackfill) backfillMutation.mutate({ kind: pendingBackfill.kind, job: pendingBackfill.job });
                setPendingBackfill(null);
              }}
              data-testid="button-confirm-backfill"
            >
              Queue
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

// Idle model unload: OCR / Whisper presets stay in memory once loaded unless
// this is on. The setting is saved in PRM (app_settings) and PRM-Compute reads
// it at startup and whenever it's saved here.
function IdleUnloadCard() {
  const { toast } = useToast();
  const [enabled, setEnabled] = useState(false);
  const [minutes, setMinutes] = useState("10");

  const { data: status } = useQuery<IdleUnloadStatus>({
    queryKey: ["/api/prm-face/idle-unload"],
    refetchInterval: 30000,
  });

  useEffect(() => {
    if (!status) return;
    setEnabled(status.enabled);
    setMinutes(String(status.minutes));
  }, [status?.enabled, status?.minutes]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/prm-face/idle-unload", { enabled, minutes: Number(minutes) });
      return res.json() as Promise<IdleUnloadStatus>;
    },
    onSuccess: (data) => {
      queryClient.setQueryData(["/api/prm-face/idle-unload"], data);
      toast({
        title: "Idle unload setting saved",
        description: data.computeError
          ? `PRM-Compute will pick it up on its next start: ${data.computeError}`
          : undefined,
      });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to save idle unload setting", description: error.message, variant: "destructive" });
    },
  });

  const mins = Number(minutes);
  const validMinutes = Number.isInteger(mins) && mins >= 1 && mins <= 1440;
  const dirty = !!status && (enabled !== status.enabled || mins !== status.minutes);

  return (
    <Card data-testid="card-idle-unload">
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <Timer className="h-4 w-4" />
          Idle Model Unload
        </CardTitle>
        <CardDescription>
          Unload idle OCR and Whisper models from memory after a period of inactivity. Face models stay resident.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <Label htmlFor="idle-unload-enabled">Unload idle models</Label>
            <p className="text-sm text-muted-foreground">Free memory when a model sits unused.</p>
          </div>
          <Switch
            id="idle-unload-enabled"
            checked={enabled}
            onCheckedChange={setEnabled}
            data-testid="switch-idle-unload"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="idle-unload-minutes">Unload after (minutes)</Label>
          <div className="flex gap-2">
            <Input
              id="idle-unload-minutes"
              type="number"
              min={1}
              max={1440}
              value={minutes}
              onChange={(e) => setMinutes(e.target.value)}
              disabled={!enabled}
              className="w-32"
              data-testid="input-idle-unload-minutes"
            />
            <Button
              onClick={() => saveMutation.mutate()}
              disabled={saveMutation.isPending || !validMinutes || !dirty}
              data-testid="button-save-idle-unload"
            >
              {saveMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}
            </Button>
          </div>
          {!validMinutes && (
            <p className="text-xs text-destructive">Enter a whole number between 1 and 1440.</p>
          )}
        </div>

        <div className="space-y-2">
          <p className="text-sm font-medium">Loaded models</p>
          {status?.loaded == null ? (
            <p className="text-xs text-muted-foreground" data-testid="text-idle-unload-offline">
              {status?.computeError ?? "Loading…"}
            </p>
          ) : status.loaded.length === 0 ? (
            <p className="text-xs text-muted-foreground" data-testid="text-idle-unload-empty">
              No OCR or Whisper models are in memory.
            </p>
          ) : (
            status.loaded.map((m) => (
              <div
                key={`${m.engine}/${m.model}`}
                className="flex items-center justify-between gap-4 rounded-md border p-3"
                data-testid={`row-loaded-${m.engine}-${m.model}`}
              >
                <p className="text-sm font-medium">
                  {m.engine === "ocr" ? "OCR" : "Whisper"} · {m.model}
                </p>
                <span className="text-xs text-muted-foreground shrink-0">idle {formatIdle(m.idle_seconds)}</span>
              </div>
            ))
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// Parallel processing: how many face / OCR / transcription jobs PRM-Compute
// runs at once. Saved in PRM (app_settings); PRM-Compute and the task worker
// both pick it up on save.
function ParallelLanesCard() {
  const { toast } = useToast();
  const [draft, setDraft] = useState<Lanes | null>(null);
  const [custom, setCustom] = useState(false);

  const { data } = useQuery<LanesStatus>({
    queryKey: ["/api/prm-face/lanes"],
    refetchInterval: 5000,
  });

  const values = draft ?? data?.lanes;
  const valid = !!values && !!data && LANE_FIELDS.every(({ key }) => Number.isInteger(values[key]) && values[key] >= 1 && values[key] <= data.max[key]);
  const dirty = !!draft && !!data && LANE_FIELDS.some(({ key }) => draft[key] !== data.lanes[key]);
  const preset = custom || !values ? "custom" : presetOf(values);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/prm-face/lanes", values);
      return res.json() as Promise<LanesStatus>;
    },
    onSuccess: (result) => {
      queryClient.setQueryData(["/api/prm-face/lanes"], result);
      setDraft(null);
      toast({
        title: "Parallel processing saved",
        description: result.computeError ? `PRM-Compute will pick it up on its next start: ${result.computeError}` : undefined,
      });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to save parallel processing", description: error.message, variant: "destructive" });
    },
  });

  const choosePreset = (id: string) => {
    const p = LANE_PRESETS.find((x) => x.id === id);
    setCustom(!p);
    if (p && values) setDraft({ ...values, ...p.lanes });
  };

  const live = data?.status;
  const load = (name: string, l: LaneLoad) => `${name} ${l.running}/${l.limit}`;
  const waiting = live ? live.lanes.face.waiting + live.lanes.ocr.waiting + live.lanes.whisper.waiting : 0;
  const onGpu = live ? Object.values(live.devices).some((d) => d === "cuda") : false;

  return (
    <Card data-testid="card-parallel-lanes">
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <Layers className="h-4 w-4" />
          Parallel Processing
        </CardTitle>
        <CardDescription>
          Configure concurrent recognition job limits for face, OCR, and speech recognition.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Preset">
          {[...LANE_PRESETS, { id: "custom", label: "Custom" }].map((p) => (
            <Button
              key={p.id}
              size="sm"
              variant={preset === p.id ? "default" : "outline"}
              role="radio"
              aria-checked={preset === p.id}
              onClick={() => choosePreset(p.id)}
              disabled={!values}
              data-testid={`button-lanes-preset-${p.id}`}
            >
              {p.label}
            </Button>
          ))}
        </div>
        <p className="text-sm text-muted-foreground">
          {LANE_PRESETS.find((p) => p.id === preset)?.hint ?? "Set each lane yourself (1–16)."}
        </p>

        {preset === "custom" && values && data && (
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            {LANE_FIELDS.map(({ key, label }) => (
              <div key={key} className="space-y-1">
                <Label htmlFor={`lanes-${key}`} className="text-xs">{label}</Label>
                <Input
                  id={`lanes-${key}`}
                  type="number"
                  min={1}
                  max={data.max[key]}
                  value={values[key] || ""}
                  onChange={(e) => setDraft({ ...values, [key]: Number(e.target.value) })}
                  data-testid={`input-lanes-${key}`}
                />
              </div>
            ))}
          </div>
        )}
        {!valid && values && data && (
          <p className="text-xs text-destructive">
            Lanes must be whole numbers from 1 to 16; busy wait from 1 to {data.max.busyWait} seconds.
          </p>
        )}

        <div className="flex items-center justify-between gap-4">
          <p className="text-xs text-muted-foreground" data-testid="text-lanes-status">
            {live
              ? `Now: ${load("face", live.lanes.face)} · ${load("ocr", live.lanes.ocr)} · ${load("stt", live.lanes.whisper)}` +
                (waiting ? ` · ${waiting} waiting` : "") +
                ` — ${onGpu ? "GPU" : `CPU, ${live.cpu_count} cores`}`
              : data?.computeError ?? "Loading…"}
          </p>
          <Button
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending || !valid || !dirty}
            data-testid="button-save-lanes"
          >
            {saveMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
