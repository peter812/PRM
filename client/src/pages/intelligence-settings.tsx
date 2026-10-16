import { useState } from "react";
import { useLoadOnce } from "@/hooks/use-load-once";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, Sparkles, MessagesSquare, ListChecks, MessageSquare, HelpCircle, Cpu } from "lucide-react";
import { AiProvidersCard } from "@/components/ai-providers-card";
import { ProviderModelPicker, apiErrorMessage, type ModelSelection } from "@/components/provider-model-picker";

import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

const DEFAULT_EVENTS_PROMPT = "You extract a list of distinct events from a daily journal entry. An \"event\" is a concrete thing that happened that day: meetings, calls, meals, travel, milestones, decisions, conversations, or notable observations. Each event must be a short, standalone past-tense statement (one sentence, ideally under 120 characters). Do not include opinions, plans for the future, or generic reflections. Do not invent events that aren't supported by the text. Return strictly the JSON shape requested by the schema: { \"events\": [ { \"text\": string } ] }. If no events are present, return { \"events\": [] }.";

type AiSettings = {
  eventsPrompt: string;
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
  const [eventsPrompt, setEventsPrompt] = useState(DEFAULT_EVENTS_PROMPT);

  const { data: settings, isLoading } = useQuery<AiSettings>({
    queryKey: ["/api/ai/settings"],
  });

  useLoadOnce(settings, (s) => {
    setSelections({ text: s.text, events: s.events, sexGuess: s.sexGuess });
    setEventsPrompt(s.eventsPrompt || DEFAULT_EVENTS_PROMPT);
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

  const handleSaveEventsPrompt = () => {
    saveMutation.mutate({ eventsPrompt });
  };

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
              The system prompt sent to the model when extracting events from a daily note's markdown body. The model is also constrained at the API level to return JSON in the shape <code className="text-xs bg-muted px-1 rounded">{"{ events: [{ text }] }"}</code>, but the prompt should reinforce this and define what counts as an event.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 pt-0">
            <Textarea
              value={eventsPrompt}
              onChange={(e) => setEventsPrompt(e.target.value)}
              rows={5}
              className="resize-y font-mono text-xs"
              data-testid="textarea-ai-events-prompt"
            />
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground transition-colors"
                  onClick={() => setEventsPrompt(DEFAULT_EVENTS_PROMPT)}
                  data-testid="button-reset-events-prompt"
                >
                  Reset to default
                </button>
                <span className="text-xs text-muted-foreground" data-testid="text-events-prompt-char-count">
                  {eventsPrompt.length} characters
                </span>
              </div>
              <Button
                size="sm"
                className="h-8 px-4 text-xs"
                onClick={handleSaveEventsPrompt}
                disabled={!eventsPrompt.trim() || saveMutation.isPending}
                data-testid="button-save-events-prompt"
              >
                {saveMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : "Save Prompt"}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
