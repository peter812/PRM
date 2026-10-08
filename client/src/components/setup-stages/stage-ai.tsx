import { useState, useEffect } from "react";
import { useLoadOnce } from "@/hooks/use-load-once";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { AiProvidersCard } from "@/components/ai-providers-card";
import { ProviderModelPicker, apiErrorMessage, type ModelSelection } from "@/components/provider-model-picker";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  Brain,
  Database,
  ScanFace,
  Mic,
  Save,
  Loader2,
} from "lucide-react";

type AiSettings = {
  vision: ModelSelection;
  text: ModelSelection;
  events: ModelSelection;
  whisperModel: string;
};

const EMPTY: ModelSelection = { providerId: "", model: "" };

export function StageAi() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: aiSettings } = useQuery<AiSettings>({
    queryKey: ["/api/ai/settings"],
  });

  const { data: vectorSettings } = useQuery<{ embeddingModel: string; embeddingProviderId: string }>({
    queryKey: ["/api/vector/settings"],
  });

  const { data: facialData } = useQuery<{ enabled: boolean }>({
    queryKey: ["/api/prm-face/facial-intelligence"],
  });

  const [text, setText] = useState<ModelSelection>(EMPTY);
  const [vision, setVision] = useState<ModelSelection>(EMPTY);
  const [events, setEvents] = useState<ModelSelection>(EMPTY);
  const [embedding, setEmbedding] = useState<ModelSelection>(EMPTY);
  const [whisperModel, setWhisperModel] = useState("");
  const [facialIntelligence, setFacialIntelligence] = useState(false);

  useLoadOnce(aiSettings, (s) => {
    setText(s.text);
    setVision(s.vision);
    setEvents(s.events);
    setWhisperModel(s.whisperModel || "Systran/faster-distil-whisper-small.en");
  });

  useLoadOnce(vectorSettings, (s) => {
    setEmbedding({ providerId: s.embeddingProviderId ?? "", model: s.embeddingModel || "" });
  });

  useEffect(() => {
    if (facialData) {
      setFacialIntelligence(facialData.enabled);
    }
  }, [facialData]);

  const saveAiMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/ai/settings", {
        text,
        vision,
        events,
        whisperModel: whisperModel.trim(),
      });

      if (embedding.model) {
        await apiRequest("POST", "/api/vector/settings", {
          embeddingModel: embedding.model,
          embeddingProviderId: embedding.providerId,
        });
      }

      await apiRequest("POST", "/api/prm-face/facial-intelligence", {
        enabled: facialIntelligence,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ai/settings"] });
      queryClient.invalidateQueries({ queryKey: ["/api/vector/settings"] });
      queryClient.invalidateQueries({ queryKey: ["/api/prm-face/facial-intelligence"] });
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
          Add AI providers, then pick models for chat, photo descriptions, journal event extraction, and search.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4">
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

        {/* 2. Semantic Search & Vector Embeddings */}
        <Card className="border-border">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Database className="h-4 w-4 text-emerald-500" /> Vector Embeddings & Search
            </CardTitle>
            <CardDescription className="text-xs">
              Powers semantic similarity search across all notes, daily logs, and people.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-1.5 pt-0 text-xs">
            <Label className="text-xs">Embedding Model</Label>
            <ProviderModelPicker value={embedding} onChange={setEmbedding} testId="setup-picker-embedding" />
            <p className="text-[11px] text-muted-foreground">
              e.g. all-minilm or nomic-embed-text on Ollama, text-embedding-3-small on OpenAI.
            </p>
          </CardContent>
        </Card>

        {/* 3. Facial Intelligence */}
        <Card className="border-border">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <ScanFace className="h-4 w-4 text-purple-500" /> Automatic Face Recognition
                </CardTitle>
                <CardDescription className="text-xs mt-0.5">
                  Automatically cluster and label faces detected in newly uploaded photos.
                </CardDescription>
              </div>
              <Switch
                checked={facialIntelligence}
                onCheckedChange={setFacialIntelligence}
              />
            </div>
          </CardHeader>
        </Card>

        {/* 4. Speech-to-Text (Whisper) */}
        <Card className="border-border">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Mic className="h-4 w-4 text-rose-500" /> Voice & Speech Transcription
            </CardTitle>
            <CardDescription className="text-xs">
              Whisper STT model used for transcribing voice notes and audio memos.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 pt-0 text-xs">
            <div className="space-y-1.5">
              <Label htmlFor="whisper-model" className="text-xs">Whisper Model</Label>
              <Input
                id="whisper-model"
                placeholder="Systran/faster-distil-whisper-small.en"
                value={whisperModel}
                onChange={(e) => setWhisperModel(e.target.value)}
                className="h-8 text-xs"
              />
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
