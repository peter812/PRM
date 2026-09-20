import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertCircle,
  AudioLines,
  Check,
  Copy,
  Loader2,
  Mic,
  RotateCcw,
  Square,
  Upload,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface WhisperSegment {
  start: number;
  end: number;
  text: string;
}

interface WhisperResult {
  text: string;
  segments: WhisperSegment[];
  language: string;
  duration: number;
  model: string;
  device: "cuda" | "cpu";
  elapsedMs: number;
}

interface WhisperModel {
  id: string;
  label: string;
  description: string;
  downloaded: boolean;
  active: boolean;
  device: "cuda" | "cpu";
}

interface PrmFaceSettings {
  apiUrl: string;
  hasApiKey: boolean;
}

const fmtTime = (s: number) => {
  const m = Math.floor(s / 60);
  const sec = (s - m * 60).toFixed(1).padStart(4, "0");
  return `${m}:${sec}`;
};

export default function WhisperDemoPage() {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const [clip, setClip] = useState<{ blob: Blob; name: string; url: string } | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const [model, setModel] = useState<string>("");
  const [language, setLanguage] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [result, setResult] = useState<WhisperResult | null>(null);
  const [playhead, setPlayhead] = useState(0);
  const [copied, setCopied] = useState(false);

  const { data: settings } = useQuery<PrmFaceSettings>({ queryKey: ["/api/prm-face/settings"] });
  const isConfigured = !!(settings?.apiUrl && settings?.hasApiKey);

  const { data: models } = useQuery<{ models: WhisperModel[] }>({
    queryKey: ["/api/prm-face/whisper/models"],
    enabled: isConfigured,
  });

  // Default the picker to whatever PRM-Compute has active.
  useEffect(() => {
    if (!model) {
      const active = models?.models.find((m) => m.active);
      if (active) setModel(active.id);
    }
  }, [models, model]);

  // Tick the recording timer.
  useEffect(() => {
    if (!isRecording) return;
    setRecordSeconds(0);
    const id = window.setInterval(() => setRecordSeconds((s) => s + 1), 1000);
    return () => window.clearInterval(id);
  }, [isRecording]);

  const releaseMic = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  };

  // Release the mic and the object URL on unmount.
  useEffect(() => {
    return () => {
      if (recorderRef.current && recorderRef.current.state !== "inactive") recorderRef.current.stop();
      releaseMic();
    };
  }, []);

  const setNewClip = (blob: Blob, name: string) => {
    setClip((prev) => {
      if (prev) URL.revokeObjectURL(prev.url);
      return { blob, name, url: URL.createObjectURL(blob) };
    });
    setResult(null);
    setPlayhead(0);
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mimeType = MediaRecorder.isTypeSupported("audio/webm")
        ? "audio/webm"
        : MediaRecorder.isTypeSupported("audio/ogg")
          ? "audio/ogg"
          : "";
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      chunksRef.current = [];
      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      recorder.onstop = () => {
        releaseMic();
        setIsRecording(false);
        const type = recorder.mimeType || "audio/webm";
        const blob = new Blob(chunksRef.current, { type });
        chunksRef.current = [];
        if (blob.size > 0) setNewClip(blob, `recording.${type.includes("ogg") ? "ogg" : "webm"}`);
      };
      recorderRef.current = recorder;
      recorder.start();
      setIsRecording(true);
    } catch (err: any) {
      releaseMic();
      toast({
        title: "Microphone unavailable",
        description: err?.name === "NotAllowedError" ? "Microphone permission was denied." : err?.message,
        variant: "destructive",
      });
    }
  };

  const stopRecording = () => {
    if (recorderRef.current && recorderRef.current.state !== "inactive") recorderRef.current.stop();
  };

  const handleFile = (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith("audio/") && !file.type.startsWith("video/")) {
      toast({ title: "Not an audio file", description: file.name, variant: "destructive" });
      return;
    }
    setNewClip(file, file.name);
  };

  const transcribe = async () => {
    if (!clip) return;
    setIsProcessing(true);
    setResult(null);
    try {
      const form = new FormData();
      form.append("audio", clip.blob, clip.name);
      if (model) form.append("model", model);
      if (language.trim()) form.append("language", language.trim().toLowerCase());
      const res = await fetch("/api/prm-face/whisper", { method: "POST", body: form, credentials: "include" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Transcription failed (${res.status})`);
      setResult(data as WhisperResult);
    } catch (err: any) {
      toast({ title: "Transcription failed", description: err.message, variant: "destructive" });
    } finally {
      setIsProcessing(false);
    }
  };

  const reset = () => {
    if (clip) URL.revokeObjectURL(clip.url);
    setClip(null);
    setResult(null);
    setPlayhead(0);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const copyText = async () => {
    if (!result?.text) return;
    await navigator.clipboard.writeText(result.text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const seekTo = (s: number) => {
    const el = audioRef.current;
    if (!el) return;
    el.currentTime = s;
    void el.play();
  };

  const activeSegment = result?.segments.findIndex((s) => playhead >= s.start && playhead < s.end) ?? -1;
  const speed = result && result.duration > 0 ? result.duration / (result.elapsedMs / 1000) : null;

  return (
    <div className="h-full overflow-auto">
      <div className="container max-w-4xl py-6 px-4 md:px-8 space-y-6">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold flex items-center gap-2" data-testid="text-whisper-demo-title">
            <Mic className="h-6 w-6 text-primary" />
            Whisper Demo
          </h1>
          <p className="text-muted-foreground text-sm">
            Speech-to-text with PRM-Compute's built-in Whisper engine. Record from your microphone or upload
            an audio file, then step through the timed segments.
          </p>
        </div>

        {!isConfigured && (
          <div className="flex items-start gap-3 rounded-md bg-muted p-4 text-sm" data-testid="alert-not-configured">
            <AlertCircle className="h-4 w-4 shrink-0 mt-0.5 text-destructive" />
            <span className="text-muted-foreground">
              PRM-Compute is not configured yet. Go to{" "}
              <Link href="/settings/recognition" className="underline font-medium text-foreground">
                Settings → Recognition
              </Link>{" "}
              to configure your PRM-Compute API URL and key.
            </span>
          </div>
        )}

        <Card data-testid="card-audio-input">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <AudioLines className="h-4 w-4" />
              Audio
            </CardTitle>
            <CardDescription>Record a clip or drop in a file (webm, ogg, wav, mp3, m4a — up to 50 MB).</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              {isRecording ? (
                <Button variant="destructive" onClick={stopRecording} data-testid="button-stop-recording">
                  <Square className="h-4 w-4 mr-2" />
                  Stop ({fmtTime(recordSeconds)})
                </Button>
              ) : (
                <Button onClick={startRecording} disabled={!isConfigured || isProcessing} data-testid="button-start-recording">
                  <Mic className="h-4 w-4 mr-2" />
                  Record
                </Button>
              )}
              <Button
                variant="outline"
                onClick={() => fileInputRef.current?.click()}
                disabled={!isConfigured || isRecording || isProcessing}
                data-testid="button-upload-audio"
              >
                <Upload className="h-4 w-4 mr-2" />
                Upload file
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                accept="audio/*,video/webm"
                className="hidden"
                onChange={(e) => handleFile(e.target.files?.[0])}
                data-testid="input-audio-file"
              />
              {clip && (
                <Button variant="ghost" onClick={reset} disabled={isProcessing} data-testid="button-reset">
                  <RotateCcw className="h-4 w-4 mr-2" />
                  Clear
                </Button>
              )}
            </div>

            <div
              className={`border-2 border-dashed rounded-lg p-4 transition-colors ${clip ? "" : "min-h-24 flex items-center justify-center text-sm text-muted-foreground"}`}
              onDrop={(e) => { e.preventDefault(); handleFile(e.dataTransfer.files?.[0]); }}
              onDragOver={(e) => e.preventDefault()}
              data-testid="dropzone-audio"
            >
              {clip ? (
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2 text-sm">
                    <span className="truncate font-medium" data-testid="text-clip-name">{clip.name}</span>
                    <span className="text-muted-foreground shrink-0">{(clip.blob.size / 1024).toFixed(0)} KB</span>
                  </div>
                  <audio
                    ref={audioRef}
                    src={clip.url}
                    controls
                    className="w-full"
                    onTimeUpdate={(e) => setPlayhead(e.currentTarget.currentTime)}
                    data-testid="audio-player"
                  />
                </div>
              ) : (
                <span>Drop an audio file here</span>
              )}
            </div>

            <div className="grid gap-4 sm:grid-cols-[1fr_10rem_auto] items-end">
              <div className="space-y-2">
                <Label htmlFor="whisper-model">Model</Label>
                <Select value={model} onValueChange={setModel}>
                  <SelectTrigger id="whisper-model" data-testid="select-whisper-model">
                    <SelectValue placeholder="PRM-Compute default" />
                  </SelectTrigger>
                  <SelectContent>
                    {models?.models.map((m) => (
                      <SelectItem key={m.id} value={m.id} data-testid={`option-whisper-model-${m.id}`}>
                        {m.label}{m.downloaded ? "" : " (not downloaded)"}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="whisper-language">Language</Label>
                <Input
                  id="whisper-language"
                  placeholder="auto"
                  maxLength={5}
                  value={language}
                  onChange={(e) => setLanguage(e.target.value)}
                  data-testid="input-whisper-language"
                />
              </div>
              <Button onClick={transcribe} disabled={!clip || isProcessing || isRecording} data-testid="button-transcribe">
                {isProcessing ? (
                  <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Transcribing…</>
                ) : (
                  <><AudioLines className="h-4 w-4 mr-2" />Transcribe</>
                )}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Language is an ISO-639-1 code (en, de, fr…); leave blank to auto-detect. "Whisper little" is
              English-only. Models are managed under{" "}
              <Link href="/settings/recognition" className="underline">Settings → Recognition</Link>.
            </p>
          </CardContent>
        </Card>

        {result && (
          <Card data-testid="card-result">
            <CardHeader className="pb-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <CardTitle className="text-base">Transcript</CardTitle>
                  <CardDescription>Click a segment to play it back from that point.</CardDescription>
                </div>
                <Button variant="outline" size="sm" onClick={copyText} disabled={!result.text} data-testid="button-copy-transcript">
                  {copied ? <Check className="h-4 w-4 mr-2" /> : <Copy className="h-4 w-4 mr-2" />}
                  {copied ? "Copied" : "Copy"}
                </Button>
              </div>
              <div className="flex flex-wrap gap-2 pt-2">
                <Badge variant="secondary" data-testid="badge-model">{models?.models.find((m) => m.id === result.model)?.label ?? result.model}</Badge>
                <Badge variant="secondary" data-testid="badge-device">{result.device === "cuda" ? "GPU (CUDA)" : "CPU"}</Badge>
                <Badge variant="secondary" data-testid="badge-language">lang: {result.language}</Badge>
                <Badge variant="secondary" data-testid="badge-duration">{result.duration.toFixed(1)} s audio</Badge>
                <Badge variant="secondary" data-testid="badge-elapsed">
                  {(result.elapsedMs / 1000).toFixed(2)} s{speed ? ` · ${speed.toFixed(0)}× realtime` : ""}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {result.text ? (
                <p className="text-sm leading-relaxed whitespace-pre-wrap" data-testid="text-transcript">{result.text}</p>
              ) : (
                <p className="text-sm text-muted-foreground" data-testid="text-no-speech">No speech detected.</p>
              )}

              {result.segments.length > 0 && (
                <div className="space-y-1" data-testid="list-segments">
                  {result.segments.map((s, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => seekTo(s.start)}
                      className={`w-full text-left flex gap-3 rounded-md px-3 py-2 text-sm transition-colors hover:bg-accent ${i === activeSegment ? "bg-accent" : ""}`}
                      data-testid={`segment-${i}`}
                    >
                      <span className="font-mono text-xs text-muted-foreground shrink-0 pt-0.5">
                        {fmtTime(s.start)} – {fmtTime(s.end)}
                      </span>
                      <span>{s.text}</span>
                    </button>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
