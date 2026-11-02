import { useState } from "react";
import { useLoadOnce } from "@/hooks/use-load-once";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { AiProvidersCard } from "@/components/ai-providers-card";
import { ProviderModelPicker, apiErrorMessage, type ModelSelection } from "@/components/provider-model-picker";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { HEALTH_KEY, ServiceStatusBadge, type HealthResult } from "./service-status";
import {
  Brain,
  BrainCircuit,
  RefreshCw,
  Save,
  Loader2,
} from "lucide-react";

type AiSettings = {
  vision: ModelSelection;
  text: ModelSelection;
  events: ModelSelection;
};

const EMPTY: ModelSelection = { providerId: "", model: "" };

export function StageAi() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Same health query as the Sub-Services step; this stage shows only its AI providers entry
  const { data: health, refetch: refetchHealth, isFetching: isHealthFetching } = useQuery<Record<string, HealthResult>>({
    queryKey: HEALTH_KEY,
  });

  const { data: aiSettings } = useQuery<AiSettings>({
    queryKey: ["/api/ai/settings"],
  });

  const [text, setText] = useState<ModelSelection>(EMPTY);
  const [vision, setVision] = useState<ModelSelection>(EMPTY);
  const [events, setEvents] = useState<ModelSelection>(EMPTY);

  useLoadOnce(aiSettings, (s) => {
    setText(s.text);
    setVision(s.vision);
    setEvents(s.events);
  });

  const saveAiMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/ai/settings", {
        text,
        vision,
        events,
      });

    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ai/settings"] });
      toast({ title: "AI & Intelligence configuration saved" });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to save AI settings", description: apiErrorMessage(err), variant: "destructive" });
    },
  });

  return (
    <div className="space-y-6">
      <div className="p-4 rounded-lg bg-muted/40 border">
        <h3 className="font-semibold text-base">AI & Intelligence Capabilities</h3>
        <p className="text-xs text-muted-foreground mt-0.5">
          Add AI providers, then pick models for chat, photo descriptions, and journal event extraction.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4">
        {/* Live status of every provider */}
        <div className="rounded-lg border p-3 space-y-2 text-xs">
          <div className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-2 font-semibold text-sm">
              <BrainCircuit className="h-4 w-4 text-amber-500" /> Provider Status
            </span>
            <div className="flex items-center gap-2 shrink-0">
              <ServiceStatusBadge result={health?.ai} />
              <Button
                size="icon"
                variant="ghost"
                className="h-7 w-7"
                title="Test providers"
                onClick={() => refetchHealth()}
                disabled={isHealthFetching}
              >
                <RefreshCw className={`h-3.5 w-3.5 ${isHealthFetching ? "animate-spin" : ""}`} />
              </Button>
            </div>
          </div>
          {health?.ai?.message && (
            <p className="text-muted-foreground bg-muted/50 p-2 rounded text-[11px] whitespace-pre-line">
              {health.ai.message}
            </p>
          )}
        </div>

        <AiProvidersCard />

        {/* 1. Language & Vision Models */}
        <Card className="border-border">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Brain className="h-4 w-4 text-primary" /> Large Language Models (LLM)
            </CardTitle>
            <CardDescription className="text-xs">
              Models used for AI Chat, relationship summarization, and photo analysis.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 pt-0 text-xs">
            <div className="space-y-1.5">
              <Label className="text-xs">Text & Chat Model</Label>
              <ProviderModelPicker value={text} onChange={setText} fallbackLabel="Use vision model" testId="setup-picker-text" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Multimodal / Vision Model</Label>
              <ProviderModelPicker value={vision} onChange={setVision} testId="setup-picker-vision" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Daily Notes Event Extraction Model</Label>
              <ProviderModelPicker value={events} onChange={setEvents} fallbackLabel="Use text model" testId="setup-picker-events" />
            </div>
          </CardContent>
        </Card>

      </div>

      <div className="flex justify-end pt-2">
        <Button
          size="sm"
          onClick={() => saveAiMutation.mutate()}
          disabled={saveAiMutation.isPending}
          className="gap-1.5 h-8 text-xs"
        >
          {saveAiMutation.isPending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Save className="h-3.5 w-3.5" />
          )}
          Save AI Preferences
        </Button>
      </div>
    </div>
  );
}
