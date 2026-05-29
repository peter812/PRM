import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
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
import { Scan, Key, Wifi, WifiOff, CheckCircle2, Loader2, Eye, EyeOff, Copy, Check, Trash2, BrainCircuit } from "lucide-react";
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
      toast({ title: "API key generated", description: "Your PRM-Face API key has been saved securely." });
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

  const resetAllMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/prm-face/reset-all", {});
      return res.json();
    },
    onSuccess: () => {
      setResetDialogOpen(false);
      toast({ title: "All PRM-Face data deleted", description: "All records, faces, and images have been wiped from the PRM-Face server." });
    },
    onError: (error: Error) => {
      setResetDialogOpen(false);
      toast({ title: "Reset failed", description: error.message, variant: "destructive" });
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
    <div className="container max-w-full md:max-w-2xl py-3 md:py-8 px-4 md:pl-12 mx-auto md:mx-0">
      <div className="space-y-2 mb-6">
        <h1 className="text-2xl font-semibold flex items-center gap-2" data-testid="text-recognition-settings-title">
          <Scan className="h-6 w-6" />
          PRM-Face API
        </h1>
        <p className="text-muted-foreground">
          PRM-Face is a self-hosted facial recognition service. Configure the URL of your PRM-Face server below,
          then use your one-time setup code to generate an API key that links this application to it.
        </p>
      </div>

      <div className="space-y-6">
        <Card data-testid="card-api-url">
          <CardHeader>
            <CardTitle className="text-lg">API URL</CardTitle>
            <CardDescription>
              The base URL of your PRM-Face server (e.g. <code className="text-xs bg-muted px-1 rounded">http://localhost:8000</code>).
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
              On first startup, PRM-Face prints a one-time setup code to its console
              (<code className="text-xs bg-muted px-1 rounded">[Config] Setup code: ...</code>).
              Paste it here to generate and store an API key for this application.
              The key is stored securely and never displayed again.
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
        <Card data-testid="card-facial-intelligence">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <BrainCircuit className="h-4 w-4" />
              Facial Intelligence Features
            </CardTitle>
            <CardDescription>
              Enable advanced facial intelligence features across the application. When enabled, a
              dedicated <strong>Photos</strong> tab appears on every person profile, showing all images
              in which that person has been identified. Disabling this hides those features and stops
              sending any facial recognition data to the client.
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

        <Card className="border-destructive/40" data-testid="card-danger-zone">
          <CardHeader>
            <CardTitle className="text-lg text-destructive flex items-center gap-2">
              <Trash2 className="h-4 w-4" />
              Danger Zone
            </CardTitle>
            <CardDescription>
              Permanently delete all data stored on the PRM-Face server — this includes all indexed images,
              face records, and recognition data. This action cannot be undone.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              variant="destructive"
              onClick={() => setResetDialogOpen(true)}
              disabled={!hasApiKey || resetAllMutation.isPending}
              data-testid="button-reset-all-prm-face"
            >
              {resetAllMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Deleting…
                </>
              ) : (
                <>
                  <Trash2 className="h-4 w-4 mr-2" />
                  Delete All PRM-Face Data
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
        <AlertDialogContent data-testid="dialog-confirm-reset-all">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete all PRM-Face data?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently wipe all images, face records, and recognition data from the PRM-Face server.
              This action <strong>cannot be undone</strong>.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-reset-all">Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => resetAllMutation.mutate()}
              data-testid="button-confirm-reset-all"
            >
              Yes, delete everything
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
