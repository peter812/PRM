import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  HardDrive,
  Scan,
  BrainCircuit,
  Database,
  Mic,
  ExternalLink,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  HelpCircle,
  Loader2,
  Terminal,
  Save,
} from "lucide-react";

type HealthStatus = "online" | "degraded" | "offline" | "not_configured" | "testing";

interface HealthResult {
  ok: boolean;
  status: HealthStatus;
  message: string;
  details?: Record<string, any>;
}

export function StageServices() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Unified health query
  const {
    data: health,
    isLoading: isHealthLoading,
    refetch: refetchHealth,
    isFetching: isHealthFetching,
  } = useQuery<Record<string, HealthResult>>({
    queryKey: ["/api/setup/services/health"],
    refetchInterval: false,
  });

  // Settings Queries
  const { data: s3Settings } = useQuery<{
    endpoint: string;
    publicEndpoint: string;
    bucket: string;
  }>({
    queryKey: ["/api/image-storage/prm-s3/settings"],
  });

  const { data: computeSettings } = useQuery<{
    apiUrl: string;
    hasApiKey: boolean;
  }>({
    queryKey: ["/api/prm-compute/settings"],
  });

  const { data: ollamaSettings } = useQuery<{
    enabled: boolean;
    apiUrl: string;
  }>({
    queryKey: ["/api/ollama/settings"],
  });

  const { data: vectorSettings } = useQuery<{
    enabled: boolean;
    qdrantUrl: string;
    collectionName: string;
  }>({
    queryKey: ["/api/vector/settings"],
  });

  // Local Form States
  const [s3Endpoint, setS3Endpoint] = useState<string>("");
  const [s3Bucket, setS3Bucket] = useState<string>("");

  const [computeUrl, setComputeUrl] = useState<string>("");
  const [computeSetupCode, setComputeSetupCode] = useState<string>("");

  const [ollamaEnabled, setOllamaEnabled] = useState<boolean>(true);
  const [ollamaUrl, setOllamaUrl] = useState<string>("");

  const [vectorEnabled, setVectorEnabled] = useState<boolean>(true);
  const [vectorUrl, setVectorUrl] = useState<string>("");

  const [whisperUrl, setWhisperUrl] = useState<string>("");

  // Populate from query results when loaded
  useEffect(() => {
    if (s3Settings) {
      setS3Endpoint(s3Settings.endpoint || "http://localhost:9000");
      setS3Bucket(s3Settings.bucket || "images");
    }
  }, [s3Settings]);

  useEffect(() => {
    if (computeSettings) {
      setComputeUrl(computeSettings.apiUrl || "http://localhost:8001");
    }
  }, [computeSettings]);

  useEffect(() => {
    if (ollamaSettings) {
      setOllamaEnabled(ollamaSettings.enabled ?? true);
      setOllamaUrl(ollamaSettings.apiUrl || "http://localhost:11434");
    }
  }, [ollamaSettings]);

  useEffect(() => {
    if (vectorSettings) {
      setVectorEnabled(vectorSettings.enabled ?? true);
      setVectorUrl(vectorSettings.qdrantUrl || "http://localhost:6333");
    }
  }, [vectorSettings]);

  // Individual test states
  const [testingService, setTestingService] = useState<string | null>(null);

  // Mutations
  const saveS3Mutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/image-storage/prm-s3/settings", {
        endpoint: s3Endpoint || "http://localhost:9000",
        bucket: s3Bucket || "images",
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/image-storage/prm-s3/settings"] });
      refetchHealth();
      toast({ title: "PRM-S3 settings saved" });
    },
  });

  const saveComputeMutation = useMutation({
    mutationFn: async () => {
      const body: Record<string, string> = { apiUrl: computeUrl || "http://localhost:8001" };
      if (computeSetupCode.trim()) body.setupCode = computeSetupCode.trim();
      const res = await apiRequest("POST", "/api/prm-compute/settings", body);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/prm-compute/settings"] });
      refetchHealth();
      toast({ title: "PRM-Compute settings saved" });
    },
  });

  const saveOllamaMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/ollama/settings", {
        enabled: ollamaEnabled,
        apiUrl: ollamaUrl || "http://localhost:11434",
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ollama/settings"] });
      refetchHealth();
      toast({ title: "Ollama settings saved" });
    },
  });

  const saveVectorMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/vector/settings", {
        enabled: vectorEnabled,
        qdrantUrl: vectorUrl || "http://localhost:6333",
        collectionName: vectorSettings?.collectionName || "people_vectors",
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/vector/settings"] });
      refetchHealth();
      toast({ title: "Vector DB settings saved" });
    },
  });

  const saveWhisperMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/ollama/settings", {
        whisperApiUrl: whisperUrl || "http://localhost:8000",
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ollama/settings"] });
      refetchHealth();
      toast({ title: "Whisper settings saved" });
    },
  });

  // Single test handler
  const handleTestService = async (service: string) => {
    setTestingService(service);
    try {
      if (service === "s3") {
        const res = await apiRequest("POST", "/api/image-storage/prm-s3/test");
        const data = await res.json();
        toast({
          title: data.ok ? "PRM-S3 Connected" : "PRM-S3 Test Failed",
          description: data.message,
          variant: data.ok ? "default" : "destructive",
        });
      } else if (service === "compute") {
        const res = await apiRequest("POST", "/api/prm-compute/test");
        const data = await res.json();
        toast({
          title: data.ok ? "PRM-Compute Connected" : "PRM-Compute Test Failed",
          description: data.message,
          variant: data.ok ? "default" : "destructive",
        });
      } else if (service === "ollama") {
        const res = await apiRequest("POST", "/api/ollama/test");
        const data = await res.json();
        toast({
          title: data.ok ? "Ollama Connected" : "Ollama Test Failed",
          description: data.message,
          variant: data.ok ? "default" : "destructive",
        });
      } else if (service === "vector") {
        const res = await apiRequest("POST", "/api/vector/test");
        const data = await res.json();
        toast({
          title: data.ok ? "Qdrant Connected" : "Qdrant Test Failed",
          description: data.message,
          variant: data.ok ? "default" : "destructive",
        });
      } else if (service === "whisper") {
        const res = await apiRequest("POST", "/api/whisper/test", { apiUrl: whisperUrl });
        const data = await res.json();
        toast({
          title: data.ok ? "Whisper Connected" : "Whisper Test Failed",
          description: data.message,
          variant: data.ok ? "default" : "destructive",
        });
      }
      refetchHealth();
    } catch (err: any) {
      toast({
        title: "Test Error",
        description: err.message || "Failed to reach endpoint",
        variant: "destructive",
      });
    } finally {
      setTestingService(null);
    }
  };

  const renderStatusBadge = (res?: HealthResult) => {
    if (!res) {
      return (
        <Badge variant="outline" className="gap-1 text-muted-foreground border-dashed">
          <HelpCircle className="h-3 w-3" /> Unknown
        </Badge>
      );
    }
    if (res.status === "online") {
      return (
        <Badge className="bg-emerald-600 hover:bg-emerald-700 text-white gap-1">
          <CheckCircle2 className="h-3 w-3" /> Online
        </Badge>
      );
    }
    if (res.status === "degraded") {
      return (
        <Badge className="bg-amber-600 hover:bg-amber-700 text-white gap-1">
          <AlertTriangle className="h-3 w-3" /> Setup Needed
        </Badge>
      );
    }
    if (res.status === "not_configured") {
      return (
        <Badge variant="secondary" className="gap-1 text-muted-foreground">
          <HelpCircle className="h-3 w-3" /> Unconfigured
        </Badge>
      );
    }
    return (
      <Badge variant="destructive" className="gap-1">
        <XCircle className="h-3 w-3" /> Offline
      </Badge>
    );
  };

  return (
    <div className="space-y-6">
      {/* Header and Test All button */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 rounded-lg bg-muted/40 border">
        <div>
          <h3 className="font-semibold text-base">PRM Distributed Sub-Services</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            PRM uses companion microservices for storage, face recognition, vector search, and local AI.
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => refetchHealth()}
          disabled={isHealthFetching}
          className="gap-2 shrink-0 self-start sm:self-auto"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${isHealthFetching ? "animate-spin" : ""}`} />
          {isHealthFetching ? "Testing Services..." : "Test All Connections"}
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-4">
        {/* 1. PRM-S3 */}
        <Card className="border-border">
          <CardHeader className="pb-3">
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-md bg-sky-500/10 text-sky-500">
                  <HardDrive className="h-5 w-5" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <CardTitle className="text-base font-semibold">PRM-S3 (Media Store)</CardTitle>
                    <a
                      href="https://github.com/peter812/PRM-s3"
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-0.5 hover:underline"
                    >
                      GitHub <ExternalLink className="h-3 w-3" />
                    </a>
                  </div>
                  <CardDescription className="text-xs">
                    Stores all photos, high-res images, and face cutouts in local S3 storage.
                  </CardDescription>
                </div>
              </div>
              <div className="shrink-0">{renderStatusBadge(health?.s3)}</div>
            </div>
          </CardHeader>
          <CardContent className="space-y-3 pt-0 text-xs">
            {health?.s3?.message && (
              <p className="text-muted-foreground bg-muted/50 p-2 rounded text-[11px]">
                {health.s3.message}
              </p>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="s3-endpoint" className="text-xs">S3 Endpoint</Label>
                <Input
                  id="s3-endpoint"
                  size={1}
                  className="h-8 text-xs"
                  placeholder="http://localhost:9000"
                  value={s3Endpoint}
                  onChange={(e) => setS3Endpoint(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="s3-bucket" className="text-xs">Bucket Name</Label>
                <Input
                  id="s3-bucket"
                  size={1}
                  className="h-8 text-xs"
                  placeholder="images"
                  value={s3Bucket}
                  onChange={(e) => setS3Bucket(e.target.value)}
                />
              </div>
            </div>
            <div className="flex items-center justify-between pt-1">
              <span className="text-[11px] text-muted-foreground flex items-center gap-1">
                <Terminal className="h-3 w-3" /> Port 9000 (Go / MinIO compatible)
              </span>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs"
                  onClick={() => handleTestService("s3")}
                  disabled={testingService === "s3"}
                >
                  {testingService === "s3" ? <Loader2 className="h-3 w-3 animate-spin" /> : "Test"}
                </Button>
                <Button
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => saveS3Mutation.mutate()}
                  disabled={saveS3Mutation.isPending}
                >
                  <Save className="h-3 w-3 mr-1" /> Save
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* 2. PRM-Compute / PRM-Face */}
        <Card className="border-border">
          <CardHeader className="pb-3">
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-md bg-purple-500/10 text-purple-500">
                  <Scan className="h-5 w-5" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <CardTitle className="text-base font-semibold">PRM-Compute / PRM-Face</CardTitle>
                    <a
                      href="https://github.com/peter812/PRM-face"
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-0.5 hover:underline"
                    >
                      GitHub <ExternalLink className="h-3 w-3" />
                    </a>
                  </div>
                  <CardDescription className="text-xs">
                    Python microservice for face detection, 512D embeddings, and clustering.
                  </CardDescription>
                </div>
              </div>
              <div className="shrink-0">{renderStatusBadge(health?.compute)}</div>
            </div>
          </CardHeader>
          <CardContent className="space-y-3 pt-0 text-xs">
            {health?.compute?.message && (
              <p className="text-muted-foreground bg-muted/50 p-2 rounded text-[11px]">
                {health.compute.message}
              </p>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="compute-url" className="text-xs">API Endpoint URL</Label>
                <Input
                  id="compute-url"
                  className="h-8 text-xs"
                  placeholder="http://localhost:8001"
                  value={computeUrl}
                  onChange={(e) => setComputeUrl(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="compute-code" className="text-xs">Setup Code (Printed in Terminal)</Label>
                <Input
                  id="compute-code"
                  type="password"
                  className="h-8 text-xs"
                  placeholder="Setup code from PRM-face boot log"
                  value={computeSetupCode}
                  onChange={(e) => setComputeSetupCode(e.target.value)}
                />
              </div>
            </div>
            <div className="flex items-center justify-between pt-1">
              <span className="text-[11px] text-muted-foreground flex items-center gap-1">
                <Terminal className="h-3 w-3" /> Port 8001 (FastAPI / InsightFace)
              </span>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs"
                  onClick={() => handleTestService("compute")}
                  disabled={testingService === "compute"}
                >
                  {testingService === "compute" ? <Loader2 className="h-3 w-3 animate-spin" /> : "Test"}
                </Button>
                <Button
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => saveComputeMutation.mutate()}
                  disabled={saveComputeMutation.isPending}
                >
                  <Save className="h-3 w-3 mr-1" /> Save
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* 3. Ollama */}
        <Card className="border-border">
          <CardHeader className="pb-3">
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-md bg-amber-500/10 text-amber-500">
                  <BrainCircuit className="h-5 w-5" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <CardTitle className="text-base font-semibold">Ollama (Local LLM)</CardTitle>
                    <a
                      href="https://github.com/ollama/ollama"
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-0.5 hover:underline"
                    >
                      GitHub <ExternalLink className="h-3 w-3" />
                    </a>
                  </div>
                  <CardDescription className="text-xs">
                    Local language models for person descriptions, chat, and journal event extraction.
                  </CardDescription>
                </div>
              </div>
              <div className="shrink-0">{renderStatusBadge(health?.ollama)}</div>
            </div>
          </CardHeader>
          <CardContent className="space-y-3 pt-0 text-xs">
            {health?.ollama?.message && (
              <p className="text-muted-foreground bg-muted/50 p-2 rounded text-[11px]">
                {health.ollama.message}
              </p>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-center">
              <div className="sm:col-span-2 space-y-1">
                <Label htmlFor="ollama-url" className="text-xs">Ollama Server URL</Label>
                <Input
                  id="ollama-url"
                  className="h-8 text-xs"
                  placeholder="http://localhost:11434"
                  value={ollamaUrl}
                  onChange={(e) => setOllamaUrl(e.target.value)}
                />
              </div>
              <div className="flex items-center justify-between sm:justify-start gap-3 sm:pt-4">
                <Label htmlFor="ollama-enabled" className="text-xs cursor-pointer">Enable Ollama</Label>
                <Switch
                  id="ollama-enabled"
                  checked={ollamaEnabled}
                  onCheckedChange={setOllamaEnabled}
                />
              </div>
            </div>
            <div className="flex items-center justify-between pt-1">
              <span className="text-[11px] text-muted-foreground flex items-center gap-1">
                <Terminal className="h-3 w-3" /> Port 11434 (Run: <code>ollama pull llama3</code>)
              </span>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs"
                  onClick={() => handleTestService("ollama")}
                  disabled={testingService === "ollama"}
                >
                  {testingService === "ollama" ? <Loader2 className="h-3 w-3 animate-spin" /> : "Test"}
                </Button>
                <Button
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => saveOllamaMutation.mutate()}
                  disabled={saveOllamaMutation.isPending}
                >
                  <Save className="h-3 w-3 mr-1" /> Save
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* 4. Qdrant */}
        <Card className="border-border">
          <CardHeader className="pb-3">
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-md bg-emerald-500/10 text-emerald-500">
                  <Database className="h-5 w-5" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <CardTitle className="text-base font-semibold">Qdrant (Vector Database)</CardTitle>
                    <a
                      href="https://github.com/qdrant/qdrant"
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-0.5 hover:underline"
                    >
                      GitHub <ExternalLink className="h-3 w-3" />
                    </a>
                  </div>
                  <CardDescription className="text-xs">
                    Enables semantic natural-language search across notes, interactions, and faces.
                  </CardDescription>
                </div>
              </div>
              <div className="shrink-0">{renderStatusBadge(health?.vector)}</div>
            </div>
          </CardHeader>
          <CardContent className="space-y-3 pt-0 text-xs">
            {health?.vector?.message && (
              <p className="text-muted-foreground bg-muted/50 p-2 rounded text-[11px]">
                {health.vector.message}
              </p>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-center">
              <div className="sm:col-span-2 space-y-1">
                <Label htmlFor="qdrant-url" className="text-xs">Qdrant Host URL</Label>
                <Input
                  id="qdrant-url"
                  className="h-8 text-xs"
                  placeholder="http://localhost:6333"
                  value={vectorUrl}
                  onChange={(e) => setVectorUrl(e.target.value)}
                />
              </div>
              <div className="flex items-center justify-between sm:justify-start gap-3 sm:pt-4">
                <Label htmlFor="vector-enabled" className="text-xs cursor-pointer">Enable Vector DB</Label>
                <Switch
                  id="vector-enabled"
                  checked={vectorEnabled}
                  onCheckedChange={setVectorEnabled}
                />
              </div>
            </div>
            <div className="flex items-center justify-between pt-1">
              <span className="text-[11px] text-muted-foreground flex items-center gap-1">
                <Terminal className="h-3 w-3" /> Port 6333 (Docker: <code>qdrant/qdrant</code>)
              </span>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs"
                  onClick={() => handleTestService("vector")}
                  disabled={testingService === "vector"}
                >
                  {testingService === "vector" ? <Loader2 className="h-3 w-3 animate-spin" /> : "Test"}
                </Button>
                <Button
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => saveVectorMutation.mutate()}
                  disabled={saveVectorMutation.isPending}
                >
                  <Save className="h-3 w-3 mr-1" /> Save
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* 5. Whisper */}
        <Card className="border-border">
          <CardHeader className="pb-3">
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-md bg-rose-500/10 text-rose-500">
                  <Mic className="h-5 w-5" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <CardTitle className="text-base font-semibold">Whisper / Speaches (Speech-to-Text)</CardTitle>
                    <a
                      href="https://github.com/speaches-ai/speaches"
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-0.5 hover:underline"
                    >
                      GitHub <ExternalLink className="h-3 w-3" />
                    </a>
                  </div>
                  <CardDescription className="text-xs">
                    Transcribes audio voice notes and supports the voice dictation interface.
                  </CardDescription>
                </div>
              </div>
              <div className="shrink-0">{renderStatusBadge(health?.whisper)}</div>
            </div>
          </CardHeader>
          <CardContent className="space-y-3 pt-0 text-xs">
            {health?.whisper?.message && (
              <p className="text-muted-foreground bg-muted/50 p-2 rounded text-[11px]">
                {health.whisper.message}
              </p>
            )}
            <div className="space-y-1">
              <Label htmlFor="whisper-url" className="text-xs">Whisper API Endpoint</Label>
              <Input
                id="whisper-url"
                className="h-8 text-xs"
                placeholder="http://localhost:8000"
                value={whisperUrl || "http://localhost:8000"}
                onChange={(e) => setWhisperUrl(e.target.value)}
              />
            </div>
            <div className="flex items-center justify-between pt-1">
              <span className="text-[11px] text-muted-foreground flex items-center gap-1">
                <Terminal className="h-3 w-3" /> Port 8000 (Speaches / Faster-Whisper)
              </span>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs"
                  onClick={() => handleTestService("whisper")}
                  disabled={testingService === "whisper"}
                >
                  {testingService === "whisper" ? <Loader2 className="h-3 w-3 animate-spin" /> : "Test"}
                </Button>
                <Button
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => saveWhisperMutation.mutate()}
                  disabled={saveWhisperMutation.isPending}
                >
                  <Save className="h-3 w-3 mr-1" /> Save
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
