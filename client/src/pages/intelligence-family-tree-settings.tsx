import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, RefreshCw, Sparkles, Network } from "lucide-react";

import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

type OllamaSettings = {
  enabled: boolean;
  apiUrl: string;
  textModel: string;
  familyTreeModel: string;
};

type OllamaModel = {
  name: string;
  parameterSize: string | null;
};

export default function IntelligenceFamilyTreeSettingsPage() {
  const { toast } = useToast();
  const [selectedModel, setSelectedModel] = useState("");

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
    setSelectedModel(settings.familyTreeModel ?? "");
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

  const models = modelsData?.models ?? [];
  const urlConfigured = !!settings?.apiUrl;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16" data-testid="loading-family-tree-ai-settings">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="container max-w-full md:max-w-2xl py-3 md:py-8 px-4 md:pl-12 mx-auto md:mx-0">
      <div className="space-y-2 mb-6">
        <h1 className="text-2xl font-semibold flex items-center gap-2" data-testid="text-family-tree-ai-title">
          <Network className="h-6 w-6" />
          Family Tree AI
        </h1>
        <p className="text-muted-foreground">
          Choose which AI model powers the "Generate connections" feature on the family tree page.
          The model is asked to translate a free-text family description into a set of proposed
          relationship additions, edits, and deletions.
        </p>
      </div>

      <div className="space-y-6">
        <Card data-testid="card-family-tree-model">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Sparkles className="h-4 w-4" />
              Generation Model
            </CardTitle>
            <CardDescription>
              {urlConfigured
                ? "Pick a model that supports tool calling. If unset, the general text model is used as a fallback."
                : "Configure an Ollama API URL on the Intelligence page before selecting a model."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex gap-2 items-end">
              <div className="flex-1 space-y-2">
                <Label htmlFor="family-tree-model-select">Model</Label>
                <Select
                  value={selectedModel}
                  onValueChange={setSelectedModel}
                  disabled={!urlConfigured || isLoadingModels}
                >
                  <SelectTrigger id="family-tree-model-select" data-testid="select-family-tree-model">
                    <SelectValue placeholder={
                      !urlConfigured ? "No API URL configured" :
                      isLoadingModels ? "Loading models…" :
                      models.length === 0 ? "No models found" :
                      "Select a model"
                    } />
                  </SelectTrigger>
                  <SelectContent>
                    {models.map((m) => (
                      <SelectItem key={m.name} value={m.name} data-testid={`option-family-tree-model-${m.name}`}>
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
                data-testid="button-refresh-family-tree-models"
              >
                {isLoadingModels ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4" />
                )}
              </Button>
              <Button
                onClick={() => saveMutation.mutate({ familyTreeModel: selectedModel })}
                disabled={saveMutation.isPending}
                data-testid="button-save-family-tree-model"
              >
                {saveMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}
              </Button>
            </div>

            {settings?.familyTreeModel && (
              <p className="text-xs text-muted-foreground" data-testid="text-saved-family-tree-model">
                Currently saved: <span className="font-mono">{settings.familyTreeModel}</span>
              </p>
            )}
            {!settings?.familyTreeModel && settings?.textModel && (
              <p className="text-xs text-muted-foreground">
                Falls back to the text model (<span className="font-mono">{settings.textModel}</span>) when not set.
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
