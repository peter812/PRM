import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Wifi, WifiOff, CheckCircle2, Loader2, Sparkles } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

type OllamaSettings = {
  enabled: boolean;
  apiUrl: string;
  authRequired: boolean;
  username: string;
  hasPassword: boolean;
};

type TestResult = {
  ok: boolean;
  message: string;
};

export default function AiDescriptionSettingsPage() {
  const { toast } = useToast();

  const [enabled, setEnabled] = useState(false);
  const [apiUrl, setApiUrl] = useState("");
  const [authRequired, setAuthRequired] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [testResult, setTestResult] = useState<TestResult | null>(null);

  const { data: settings, isLoading } = useQuery<OllamaSettings>({
    queryKey: ["/api/ollama/settings"],
  });

  useEffect(() => {
    if (!settings) return;
    setEnabled(settings.enabled);
    setApiUrl(settings.apiUrl);
    setAuthRequired(settings.authRequired);
    setUsername(settings.username);
  }, [settings]);

  const saveMutation = useMutation({
    mutationFn: async (patch: Partial<OllamaSettings & { password: string }>) => {
      const res = await apiRequest("POST", "/api/ollama/settings", patch);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ollama/settings"] });
      toast({ title: "Settings saved" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to save settings", description: error.message, variant: "destructive" });
    },
  });

  const testMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/ollama/test", {});
      return res.json() as Promise<TestResult>;
    },
    onSuccess: (data) => {
      setTestResult(data);
    },
    onError: (error: Error) => {
      setTestResult({ ok: false, message: error.message });
    },
  });

  const handleSaveAll = () => {
    const patch: Record<string, unknown> = {
      enabled,
      apiUrl,
      authRequired,
      username,
    };
    if (password.length > 0) patch.password = password;
    saveMutation.mutate(patch as Partial<OllamaSettings & { password: string }>);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16" data-testid="loading-ai-description-settings">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="container max-w-full md:max-w-2xl py-3 md:py-8 px-4 md:pl-12 mx-auto md:mx-0">
      <div className="space-y-2 mb-6">
        <h1 className="text-2xl font-semibold flex items-center gap-2" data-testid="text-ai-description-title">
          <Sparkles className="h-6 w-6" />
          AI Description
        </h1>
        <p className="text-muted-foreground">
          Connect to a local <a href="https://ollama.com" target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">Ollama</a> instance to generate AI-powered image descriptions using a vision model such as LLaVA.
        </p>
      </div>

      <div className="space-y-6">
        <Card data-testid="card-ai-description-enable">
          <CardHeader>
            <CardTitle className="text-lg">Enable AI Description</CardTitle>
            <CardDescription>
              When enabled, AI-generated descriptions can be produced for images via the demo page and other features.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between gap-4">
              <div className="space-y-0.5">
                <Label htmlFor="ollama-enabled-switch" className="text-sm font-medium">
                  Enable AI description
                </Label>
                <p className="text-xs text-muted-foreground">
                  {enabled ? "AI description is active." : "AI description is disabled."}
                </p>
              </div>
              <Switch
                id="ollama-enabled-switch"
                checked={enabled}
                onCheckedChange={setEnabled}
                data-testid="switch-ollama-enabled"
              />
            </div>
          </CardContent>
        </Card>

        <Card data-testid="card-ollama-api-url">
          <CardHeader>
            <CardTitle className="text-lg">Ollama API URL</CardTitle>
            <CardDescription>
              The base URL of your Ollama server (e.g. <code className="text-xs bg-muted px-1 rounded">http://localhost:11434</code>).
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="ollama-api-url">Server URL</Label>
              <Input
                id="ollama-api-url"
                placeholder="http://localhost:11434"
                value={apiUrl}
                onChange={(e) => { setApiUrl(e.target.value); setTestResult(null); }}
                data-testid="input-ollama-api-url"
              />
            </div>
          </CardContent>
        </Card>

        <Card data-testid="card-ollama-auth">
          <CardHeader>
            <CardTitle className="text-lg">Authentication</CardTitle>
            <CardDescription>
              If your Ollama instance is protected by HTTP Basic Auth, enable this and provide credentials.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between gap-4">
              <div className="space-y-0.5">
                <Label htmlFor="ollama-auth-switch" className="text-sm font-medium">
                  Auth required
                </Label>
                <p className="text-xs text-muted-foreground">
                  Uses HTTP Basic Auth
                </p>
              </div>
              <Switch
                id="ollama-auth-switch"
                checked={authRequired}
                onCheckedChange={setAuthRequired}
                data-testid="switch-ollama-auth-required"
              />
            </div>

            {authRequired && (
              <div className="space-y-3 pt-1" data-testid="section-ollama-credentials">
                <div className="space-y-2">
                  <Label htmlFor="ollama-username">Username</Label>
                  <Input
                    id="ollama-username"
                    placeholder="username"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    data-testid="input-ollama-username"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="ollama-password">
                    Password
                    {settings?.hasPassword && (
                      <span className="ml-2 text-xs text-muted-foreground font-normal">(saved — enter new value to change)</span>
                    )}
                  </Label>
                  <Input
                    id="ollama-password"
                    type="password"
                    placeholder={settings?.hasPassword ? "••••••••" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    data-testid="input-ollama-password"
                  />
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <div className="flex flex-wrap gap-3">
          <Button
            onClick={handleSaveAll}
            disabled={saveMutation.isPending}
            data-testid="button-save-ollama-settings"
          >
            {saveMutation.isPending ? (
              <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Saving…</>
            ) : (
              "Save Settings"
            )}
          </Button>
          <Button
            variant="outline"
            onClick={() => testMutation.mutate()}
            disabled={testMutation.isPending || !apiUrl.trim()}
            data-testid="button-verify-ollama-connection"
          >
            {testMutation.isPending ? (
              <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Verifying…</>
            ) : (
              <><Wifi className="h-4 w-4 mr-2" />Verify Connection</>
            )}
          </Button>
        </div>

        {testResult !== null && (
          <div
            className={`flex items-start gap-2 rounded-md p-3 text-sm ${testResult.ok ? "bg-primary/10 border border-primary/20" : "bg-destructive/10 border border-destructive/20"}`}
            data-testid="text-ollama-test-result"
          >
            {testResult.ok ? (
              <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" />
            ) : (
              <WifiOff className="h-4 w-4 shrink-0 mt-0.5 text-destructive" />
            )}
            <span>{testResult.message}</span>
          </div>
        )}
      </div>
    </div>
  );
}
