import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Wifi, WifiOff, CheckCircle2, Loader2, Sparkles, RefreshCw, Cpu, MessageSquare, MessagesSquare } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

const DEFAULT_PROMPT = "Return 2 sentences explaining what is happening in this image.";

type OllamaSettings = {
  enabled: boolean;
  apiUrl: string;
  authRequired: boolean;
  username: string;
  hasPassword: boolean;
  model: string;
  textModel: string;
  prompt: string;
};

type TestResult = {
  ok: boolean;
  message: string;
};

type OllamaModel = {
  name: string;
  parameterSize: string | null;
};

export default function IntelligenceSettingsPage() {
  const { toast } = useToast();

  const [enabled, setEnabled] = useState(false);
  const [apiUrl, setApiUrl] = useState("");
  const [authRequired, setAuthRequired] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [selectedModel, setSelectedModel] = useState("");
  const [selectedTextModel, setSelectedTextModel] = useState("");
  const [prompt, setPrompt] = useState(DEFAULT_PROMPT);
  const [testResult, setTestResult] = useState<TestResult | null>(null);

  const { data: settings, isLoading } = useQuery<OllamaSettings>({
    queryKey: ["/api/ollama/settings"],
  });

  const { data: modelsData, isLoading: isLoadingModels, refetch: refetchModels } = useQuery<{ models: OllamaModel[] }>({
    queryKey: ["/api/ollama/models"],
    enabled: !!settings?.apiUrl,
    retry: false,
  });

  useEffect(() => {
    if (!settings) return;
    setEnabled(settings.enabled);
    setApiUrl(settings.apiUrl);
    setAuthRequired(settings.authRequired);
    setUsername(settings.username);
    setSelectedModel(settings.model ?? "");
    setSelectedTextModel(settings.textModel ?? "");
    setPrompt(settings.prompt || DEFAULT_PROMPT);
  }, [settings]);

  const saveMutation = useMutation({
    mutationFn: async (patch: Record<string, unknown>) => {
      const res = await apiRequest("POST", "/api/ollama/settings", patch);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ollama/settings"] });
      toast({ title: "Saved" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to save", description: error.message, variant: "destructive" });
    },
  });

  const testMutation = useMutation({
    mutationFn: async () => {
      const body: Record<string, unknown> = { apiUrl, authRequired, username };
      if (password.length > 0) body.password = password;
      const res = await apiRequest("POST", "/api/ollama/test", body);
      return res.json() as Promise<TestResult>;
    },
    onSuccess: (data) => {
      setTestResult(data);
    },
    onError: (error: Error) => {
      setTestResult({ ok: false, message: error.message });
    },
  });

  const handleSaveUrl = () => {
    const patch: Record<string, unknown> = { apiUrl, authRequired, username };
    if (password.length > 0) patch.password = password;
    saveMutation.mutate(patch);
  };

  const handleSaveModel = () => {
    saveMutation.mutate({ model: selectedModel });
  };

  const handleSaveTextModel = () => {
    saveMutation.mutate({ textModel: selectedTextModel });
  };

  const handleSavePrompt = () => {
    saveMutation.mutate({ prompt });
  };

  const models = modelsData?.models ?? [];
  const urlConfigured = !!settings?.apiUrl;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16" data-testid="loading-intelligence-settings">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="container max-w-full md:max-w-2xl py-3 md:py-8 px-4 md:pl-12 mx-auto md:mx-0">
      <div className="space-y-2 mb-6">
        <h1 className="text-2xl font-semibold flex items-center gap-2" data-testid="text-intelligence-title">
          <Sparkles className="h-6 w-6" />
          Intelligence
        </h1>
        <p className="text-muted-foreground">
          Connect to a local <a href="https://ollama.com" target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">Ollama</a> instance to power AI features such as image descriptions and AI chat.
        </p>
      </div>

      <div className="space-y-6">
        <Card data-testid="card-ai-enable">
          <CardHeader>
            <CardTitle className="text-lg">Enable AI</CardTitle>
            <CardDescription>
              When enabled, AI-powered features such as image descriptions and AI chat are available.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between gap-4">
              <div className="space-y-0.5">
                <Label htmlFor="ollama-enabled-switch" className="text-sm font-medium">
                  Enable AI
                </Label>
                <p className="text-xs text-muted-foreground">
                  {enabled ? "AI features are active." : "AI features are disabled."}
                </p>
              </div>
              <Switch
                id="ollama-enabled-switch"
                checked={enabled}
                onCheckedChange={(v) => { setEnabled(v); saveMutation.mutate({ enabled: v }); }}
                disabled={saveMutation.isPending}
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
              <div className="flex gap-2">
                <Input
                  id="ollama-api-url"
                  placeholder="http://localhost:11434"
                  value={apiUrl}
                  onChange={(e) => { setApiUrl(e.target.value); setTestResult(null); }}
                  data-testid="input-ollama-api-url"
                />
                <Button
                  onClick={handleSaveUrl}
                  disabled={saveMutation.isPending}
                  data-testid="button-save-ollama-url"
                >
                  {saveMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}
                </Button>
              </div>
            </div>

            <div className="space-y-4 pt-1">
              <div className="flex items-center justify-between gap-4">
                <div className="space-y-0.5">
                  <Label htmlFor="ollama-auth-switch" className="text-sm font-medium">
                    Auth required
                  </Label>
                  <p className="text-xs text-muted-foreground">Uses HTTP Basic Auth</p>
                </div>
                <Switch
                  id="ollama-auth-switch"
                  checked={authRequired}
                  onCheckedChange={setAuthRequired}
                  data-testid="switch-ollama-auth-required"
                />
              </div>

              {authRequired && (
                <div className="space-y-3" data-testid="section-ollama-credentials">
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
            </div>

            <div className="flex flex-wrap gap-2 pt-1">
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
          </CardContent>
        </Card>

        <Card data-testid="card-ollama-models">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Cpu className="h-4 w-4" />
              Image Description Model
            </CardTitle>
            <CardDescription>
              {urlConfigured
                ? "Choose which vision model to use for image descriptions. Only models already pulled on your Ollama instance are shown."
                : "Configure and save an API URL above to load available models."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex gap-2 items-end">
              <div className="flex-1 space-y-2">
                <Label htmlFor="ollama-model-select">Model</Label>
                <Select
                  value={selectedModel}
                  onValueChange={setSelectedModel}
                  disabled={!urlConfigured || isLoadingModels}
                >
                  <SelectTrigger id="ollama-model-select" data-testid="select-ollama-model">
                    <SelectValue placeholder={
                      !urlConfigured ? "No API URL configured" :
                      isLoadingModels ? "Loading models…" :
                      models.length === 0 ? "No models found" :
                      "Select a model"
                    } />
                  </SelectTrigger>
                  <SelectContent>
                    {models.map((m) => (
                      <SelectItem key={m.name} value={m.name} data-testid={`option-model-${m.name}`}>
                        <span className="font-mono text-sm">{m.name}</span>
                        {m.parameterSize && (
                          <span className="ml-2 text-xs text-muted-foreground">{m.parameterSize}</span>
                        )}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button
                variant="outline"
                size="icon"
                onClick={() => refetchModels()}
                disabled={!urlConfigured || isLoadingModels}
                title="Refresh model list"
                data-testid="button-refresh-models"
              >
                {isLoadingModels ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4" />
                )}
              </Button>
              <Button
                onClick={handleSaveModel}
                disabled={!selectedModel || saveMutation.isPending}
                data-testid="button-save-model"
              >
                {saveMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}
              </Button>
            </div>

            {settings?.model && (
              <p className="text-xs text-muted-foreground" data-testid="text-saved-model">
                Currently saved: <span className="font-mono">{settings.model}</span>
              </p>
            )}
          </CardContent>
        </Card>

        <Card data-testid="card-ollama-text-model">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <MessagesSquare className="h-4 w-4" />
              Text Model Selection
            </CardTitle>
            <CardDescription>
              {urlConfigured
                ? "Choose which text model to use for AI chat. Only models already pulled on your Ollama instance are shown."
                : "Configure and save an API URL above to load available models."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex gap-2 items-end">
              <div className="flex-1 space-y-2">
                <Label htmlFor="ollama-text-model-select">Model</Label>
                <Select
                  value={selectedTextModel}
                  onValueChange={setSelectedTextModel}
                  disabled={!urlConfigured || isLoadingModels}
                >
                  <SelectTrigger id="ollama-text-model-select" data-testid="select-ollama-text-model">
                    <SelectValue placeholder={
                      !urlConfigured ? "No API URL configured" :
                      isLoadingModels ? "Loading models…" :
                      models.length === 0 ? "No models found" :
                      "Select a model"
                    } />
                  </SelectTrigger>
                  <SelectContent>
                    {models.map((m) => (
                      <SelectItem key={m.name} value={m.name} data-testid={`option-text-model-${m.name}`}>
                        <span className="font-mono text-sm">{m.name}</span>
                        {m.parameterSize && (
                          <span className="ml-2 text-xs text-muted-foreground">{m.parameterSize}</span>
                        )}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button
                variant="outline"
                size="icon"
                onClick={() => refetchModels()}
                disabled={!urlConfigured || isLoadingModels}
                title="Refresh model list"
                data-testid="button-refresh-text-models"
              >
                {isLoadingModels ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4" />
                )}
              </Button>
              <Button
                onClick={handleSaveTextModel}
                disabled={!selectedTextModel || saveMutation.isPending}
                data-testid="button-save-text-model"
              >
                {saveMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}
              </Button>
            </div>

            {settings?.textModel && (
              <p className="text-xs text-muted-foreground" data-testid="text-saved-text-model">
                Currently saved: <span className="font-mono">{settings.textModel}</span>
              </p>
            )}
          </CardContent>
        </Card>

        <Card data-testid="card-ollama-prompt">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <MessageSquare className="h-4 w-4" />
              Image Description Prompt
            </CardTitle>
            <CardDescription>
              The instruction sent to the model along with each image. Edit this to change what kind of description the AI produces.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={3}
              className="resize-y"
              data-testid="textarea-ollama-prompt"
            />
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground transition-colors"
                  onClick={() => setPrompt(DEFAULT_PROMPT)}
                  data-testid="button-reset-prompt"
                >
                  Reset to default
                </button>
                <span className="text-xs text-muted-foreground" data-testid="text-prompt-char-count">
                  {prompt.length} characters
                </span>
              </div>
              <Button
                onClick={handleSavePrompt}
                disabled={!prompt.trim() || saveMutation.isPending}
                data-testid="button-save-prompt"
              >
                {saveMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
