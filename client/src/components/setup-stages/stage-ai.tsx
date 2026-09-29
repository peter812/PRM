import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  Brain,
  Sparkles,
  Database,
  ScanFace,
  Mic,
  Save,
  Loader2,
  RefreshCw,
  Terminal,
  ExternalLink,
} from "lucide-react";

interface OllamaModel {
  name: string;
  parameterSize: string | null;
}

export function StageAi() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Ollama Settings Query
  const { data: ollamaSettings, isLoading: isLoadingOllama } = useQuery<{
    enabled: boolean;
    apiUrl: string;
    model: string;
    textModel: string;
    eventsModel: string;
    eventsPrompt: string;
    whisperApiUrl: string;
    whisperModel: string;
  }>({
    queryKey: ["/api/ollama/settings"],
  });

  // Pulled Ollama Models
  const {
    data: ollamaModelsData,
    isLoading: isLoadingModels,
    refetch: refetchModels,
    isFetching: isFetchingModels,
  } = useQuery<{ models: OllamaModel[] }>({
    queryKey: ["/api/ollama/models"],
    retry: false,
  });

  // Vector Settings
  const { data: vectorSettings } = useQuery<{
    enabled: boolean;
    qdrantUrl: string;
    collectionName: string;
    embeddingModel: string;
  }>({
    queryKey: ["/api/vector/settings"],
  });

  // Facial Intelligence Switch Query
  const { data: facialData } = useQuery<{ enabled: boolean }>({
    queryKey: ["/api/prm-face/facial-intelligence"],
  });

  // Form State
  const [textModel, setTextModel] = useState("");
  const [visionModel, setVisionModel] = useState("");
  const [eventsModel, setEventsModel] = useState("");
  const [eventsPrompt, setEventsPrompt] = useState("");
  const [embeddingModel, setEmbeddingModel] = useState("");
  const [whisperModel, setWhisperModel] = useState("");
  const [facialIntelligence, setFacialIntelligence] = useState(false);

  useEffect(() => {
    if (ollamaSettings) {
      setTextModel(ollamaSettings.textModel || ollamaSettings.model || "");
      setVisionModel(ollamaSettings.model || "");
      setEventsModel(ollamaSettings.eventsModel || "");
      setEventsPrompt(ollamaSettings.eventsPrompt || "");
      setWhisperModel(ollamaSettings.whisperModel || "Systran/faster-distil-whisper-small.en");
    }
  }, [ollamaSettings]);

  useEffect(() => {
    if (vectorSettings) {
      setEmbeddingModel(vectorSettings.embeddingModel || "all-minilm");
    }
  }, [vectorSettings]);

  useEffect(() => {
    if (facialData) {
      setFacialIntelligence(facialData.enabled);
    }
  }, [facialData]);

  // Mutations
  const saveAiMutation = useMutation({
    mutationFn: async () => {
      // 1. Save Ollama Models
      await apiRequest("POST", "/api/ollama/settings", {
        textModel: textModel.trim(),
        model: visionModel.trim(),
        eventsModel: eventsModel.trim(),
        eventsPrompt: eventsPrompt.trim() || undefined,
        whisperModel: whisperModel.trim(),
      });

      // 2. Save Vector Embedding Model
      if (vectorSettings) {
        await apiRequest("POST", "/api/vector/settings", {
          ...vectorSettings,
          embeddingModel: embeddingModel.trim(),
        });
      }

      // 3. Save Facial Intelligence
      await apiRequest("POST", "/api/prm-face/facial-intelligence", {
        enabled: facialIntelligence,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ollama/settings"] });
      queryClient.invalidateQueries({ queryKey: ["/api/vector/settings"] });
      queryClient.invalidateQueries({ queryKey: ["/api/prm-face/facial-intelligence"] });
      toast({ title: "AI & Intelligence configuration saved" });
    },
    onError: (err: any) => {
      toast({ title: "Failed to save AI settings", description: err.message, variant: "destructive" });
    },
  });

  const models = ollamaModelsData?.models || [];

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 rounded-lg bg-muted/40 border">
        <div>
          <h3 className="font-semibold text-base">AI & Intelligence Capabilities</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Configure local models for chat, journal event extraction, face recognition, and speech-to-text.
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => refetchModels()}
          disabled={isFetchingModels}
          className="gap-2 shrink-0 self-start sm:self-auto text-xs"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${isFetchingModels ? "animate-spin" : ""}`} />
          Refresh Local Models
        </Button>
      </div>

      {models.length === 0 && (
        <div className="p-3.5 rounded-lg border border-amber-500/30 bg-amber-500/10 flex items-start gap-3 text-xs">
          <Terminal className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <p className="font-medium text-foreground">No Ollama models detected yet</p>
            <p className="text-muted-foreground">
              To pull recommended starter models, run in your terminal:
            </p>
            <div className="font-mono bg-background/80 p-2 rounded text-[11px] select-all border">
              ollama pull llama3 && ollama pull llava && ollama pull all-minilm
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4">
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
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="text-model" className="text-xs">Text & Chat Model</Label>
                {models.length > 0 ? (
                  <Select value={textModel} onValueChange={setTextModel}>
                    <SelectTrigger id="text-model" className="h-8 text-xs">
                      <SelectValue placeholder="Select installed model..." />
                    </SelectTrigger>
                    <SelectContent>
                      {models.map((m) => (
                        <SelectItem key={m.name} value={m.name} className="text-xs">
                          {m.name} {m.parameterSize && `(${m.parameterSize})`}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <Input
                    id="text-model"
                    placeholder="e.g. llama3:latest"
                    value={textModel}
                    onChange={(e) => setTextModel(e.target.value)}
                    className="h-8 text-xs"
                  />
                )}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="vision-model" className="text-xs">Multimodal / Vision Model</Label>
                {models.length > 0 ? (
                  <Select value={visionModel} onValueChange={setVisionModel}>
                    <SelectTrigger id="vision-model" className="h-8 text-xs">
                      <SelectValue placeholder="Select vision model..." />
                    </SelectTrigger>
                    <SelectContent>
                      {models.map((m) => (
                        <SelectItem key={m.name} value={m.name} className="text-xs">
                          {m.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <Input
                    id="vision-model"
                    placeholder="e.g. llava:latest"
                    value={visionModel}
                    onChange={(e) => setVisionModel(e.target.value)}
                    className="h-8 text-xs"
                  />
                )}
              </div>
            </div>

            <div className="space-y-1.5 pt-1">
              <Label htmlFor="events-model" className="text-xs">Daily Notes Event Extraction Model</Label>
              {models.length > 0 ? (
                <Select value={eventsModel || textModel} onValueChange={setEventsModel}>
                  <SelectTrigger id="events-model" className="h-8 text-xs">
                    <SelectValue placeholder="Select model for extracting daily events..." />
                  </SelectTrigger>
                  <SelectContent>
                    {models.map((m) => (
                      <SelectItem key={m.name} value={m.name} className="text-xs">
                        {m.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Input
                  id="events-model"
                  placeholder="e.g. llama3:latest"
                  value={eventsModel}
                  onChange={(e) => setEventsModel(e.target.value)}
                  className="h-8 text-xs"
                />
              )}
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
          <CardContent className="space-y-3 pt-0 text-xs">
            <div className="space-y-1.5">
              <Label htmlFor="embedding-model" className="text-xs">Embedding Model</Label>
              <Input
                id="embedding-model"
                placeholder="e.g. all-minilm or bge-small-en"
                value={embeddingModel}
                onChange={(e) => setEmbeddingModel(e.target.value)}
                className="h-8 text-xs"
              />
              <p className="text-[11px] text-muted-foreground">
                Model pulled in Ollama or Qdrant for creating 384D or 768D text vectors.
              </p>
            </div>
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
