import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, ImageIcon, Cpu, MessageSquare, RefreshCw, AlertCircle } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

const DEFAULT_PROMPT = "Return 2 sentences explaining what is happening in this image.";

type OllamaSettings = {
  enabled: boolean;
  apiUrl: string;
  model: string;
  prompt: string;
  autoDescribeImages: boolean;
};

type OllamaModel = {
  name: string;
  parameterSize: string | null;
};

export default function IntelligenceImagesSettingsPage() {
  const { toast } = useToast();

  const [autoDescribeImages, setAutoDescribeImages] = useState(false);
  const [selectedModel, setSelectedModel] = useState("");
  const [prompt, setPrompt] = useState(DEFAULT_PROMPT);

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
    setAutoDescribeImages(settings.autoDescribeImages ?? false);
    setSelectedModel(settings.model ?? "");
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

  const handleToggleAutoDescribe = (checked: boolean) => {
    setAutoDescribeImages(checked);
    saveMutation.mutate({ autoDescribeImages: checked });
  };

  const handleSaveModel = () => {
    saveMutation.mutate({ model: selectedModel });
  };

  const handleSavePrompt = () => {
    saveMutation.mutate({ prompt });
  };

  const models = modelsData?.models ?? [];
  const urlConfigured = !!settings?.apiUrl;
  const ollamaReady = settings?.enabled && urlConfigured && !!settings?.model;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16" data-testid="loading-intelligence-images-settings">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="container max-w-full md:max-w-2xl py-3 md:py-8 px-4 md:pl-12 mx-auto md:mx-0">
      <div className="space-y-2 mb-6">
        <h1 className="text-2xl font-semibold flex items-center gap-2" data-testid="text-intelligence-images-title">
          <ImageIcon className="h-6 w-6" />
          Images
        </h1>
        <p className="text-sm text-muted-foreground">
          Configure AI-powered image description settings.
        </p>
      </div>

      <div className="space-y-4">
        <Card data-testid="card-auto-describe">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <ImageIcon className="h-4 w-4" />
              Auto-describe Uploaded Images
            </CardTitle>
            <CardDescription>
              When enabled, every image you upload (except profile images) is automatically sent to
              the configured vision model to generate a description. The description is saved in the
              background — uploads are not delayed.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-3">
              <Switch
                id="auto-describe-toggle"
                checked={autoDescribeImages}
                onCheckedChange={handleToggleAutoDescribe}
                disabled={saveMutation.isPending}
                data-testid="switch-auto-describe"
              />
              <Label htmlFor="auto-describe-toggle" className="cursor-pointer">
                {autoDescribeImages ? "Enabled" : "Disabled"}
              </Label>
            </div>
            {autoDescribeImages && !ollamaReady && (
              <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30 px-3 py-2 text-sm text-amber-800 dark:text-amber-200">
                <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                <span>
                  Auto-describe is on but Ollama is not fully configured. Make sure the connection
                  is enabled on the Intelligence page and a vision model is selected below.
                </span>
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
                : "Configure and save an API URL on the Intelligence page to load available models."}
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
