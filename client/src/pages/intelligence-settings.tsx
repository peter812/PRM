import { useState } from "react";
import { Link } from "wouter";
import { useLoadOnce } from "@/hooks/use-load-once";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Loader2, Sparkles, MessagesSquare, ListChecks, MessageSquare, HelpCircle, Cpu } from "lucide-react";
import { AiProvidersCard } from "@/components/ai-providers-card";
import { ProviderModelPicker, apiErrorMessage, type ModelSelection } from "@/components/provider-model-picker";

import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

type AiSettings = {
  text: ModelSelection;
  events: ModelSelection;
  sexGuess: ModelSelection;
};

type TaskKey = "text" | "events" | "sexGuess";

const MODEL_TASKS: { key: TaskKey; label: string; description: string; icon: typeof MessagesSquare; fallbackLabel?: string }[] = [
  { key: "text", label: "Text Model", description: "Powers AI chat and general text tasks. Falls back to the image model.", icon: MessagesSquare, fallbackLabel: "Use image model" },
  { key: "events", label: "Daily Note Events", description: "Extracts structured events from daily notes.", icon: ListChecks, fallbackLabel: "Use text model" },
  { key: "sexGuess", label: "Sex Guess Model", description: "Infers sex when unknown.", icon: HelpCircle, fallbackLabel: "Use text model" },
];

const EMPTY_SELECTION: ModelSelection = { providerId: "", model: "" };

export default function IntelligenceSettingsPage() {
  const { toast } = useToast();

  const [selections, setSelections] = useState<Record<TaskKey, ModelSelection>>({
    text: EMPTY_SELECTION, events: EMPTY_SELECTION, sexGuess: EMPTY_SELECTION,
  });

  const { data: settings, isLoading } = useQuery<AiSettings>({
    queryKey: ["/api/ai/settings"],
  });

  useLoadOnce(settings, (s) => {
    setSelections({ text: s.text, events: s.events, sexGuess: s.sexGuess });
  });

  const saveMutation = useMutation({
    mutationFn: async (patch: Record<string, unknown>) => {
      const res = await apiRequest("POST", "/api/ai/settings", patch);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ai/settings"] });
      toast({ title: "Saved" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to save", description: apiErrorMessage(error), variant: "destructive" });
    },
  });

  const sameSelection = (a: ModelSelection, b: ModelSelection | undefined) =>
    a.model === (b?.model ?? "") && (!a.model || a.providerId === (b?.providerId ?? ""));
  const hasModelChanges = MODEL_TASKS.some(({ key }) => !sameSelection(selections[key], settings?.[key]));

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16" data-testid="loading-intelligence-settings">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="container max-w-full py-3 md:py-8 px-4 md:pl-12 mx-auto md:mx-0">
      <div className="space-y-2 mb-6 max-w-3xl">
        <h1 className="text-2xl font-semibold flex items-center gap-2" data-testid="text-intelligence-title">
          <Sparkles className="h-6 w-6" />
          Intelligence
        </h1>
        <p className="text-muted-foreground">
          AI providers and the models used for chat and text intelligence.
        </p>
      </div>

      <div className="settings-cards-grid">
        <AiProvidersCard />

        <Card data-testid="card-ai-models">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Cpu className="h-4 w-4" />
              Model Selection
            </CardTitle>
            <CardDescription className="text-xs">
              Pick a provider and model for each feature. Image description is set under Images.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 pt-0">
            {MODEL_TASKS.map(({ key, label, description, icon: Icon, fallbackLabel }) => (
              <div key={key} className="rounded-lg border bg-card p-3 space-y-1.5 shadow-sm" data-testid={`section-${key}-model`}>
                <Label className="text-xs font-medium flex items-center gap-1.5">
                  <Icon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  {label}
                </Label>
                <p className="text-[11px] text-muted-foreground leading-tight">{description}</p>
                <ProviderModelPicker
                  value={selections[key]}
                  onChange={(v) => setSelections((s) => ({ ...s, [key]: v }))}
                  fallbackLabel={fallbackLabel}
                  testId={`picker-${key}`}
                />
              </div>
            ))}

            <div className="flex items-center justify-between pt-2 border-t">
              <p className="text-xs text-muted-foreground">
                {hasModelChanges
                  ? <span className="text-amber-600 dark:text-amber-400 font-medium">Unsaved model changes</span>
                  : "All model selections saved."}
              </p>
              <Button
                size="sm"
                className="h-8 px-4 text-xs"
                onClick={() => saveMutation.mutate(selections)}
                disabled={saveMutation.isPending || !hasModelChanges}
                data-testid="button-save-models"
              >
                {saveMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : null}
                Save Models
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card data-testid="card-ai-events-prompt">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <MessageSquare className="h-4 w-4" />
              Daily Note Event Extraction System Prompt
            </CardTitle>
            <CardDescription className="text-xs">
              The system prompt sent to the model when extracting events from a daily note. It lives on the Prompts page with the other AI prompts.
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-0">
            <Button variant="outline" size="sm" asChild data-testid="link-ai-events-prompt">
              <Link href="/intelligence/prompts?prompt=dailyNoteEvents">Open prompt</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
