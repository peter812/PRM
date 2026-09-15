import { useEffect, useRef, useState } from "react";
import { useToast } from "@/hooks/use-toast";

export type DictationStatus = "idle" | "recording" | "transcribing";

/**
 * Microphone dictation: records with MediaRecorder, sends the clip to the
 * Whisper proxy (/api/daily-notes/transcribe) and hands back the text.
 * Errors are surfaced as toasts; the mic is released on stop and on unmount.
 */
export function useDictation(onTranscript: (text: string) => void) {
  const { toast } = useToast();
  const [status, setStatus] = useState<DictationStatus>("idle");
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const onTranscriptRef = useRef(onTranscript);
  onTranscriptRef.current = onTranscript;

  const releaseMic = () => {
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
  };

  const transcribe = async (blob: Blob) => {
    setStatus("transcribing");
    try {
      const form = new FormData();
      form.append("audio", blob, `dictation.${blob.type.includes("ogg") ? "ogg" : "webm"}`);
      const res = await fetch("/api/daily-notes/transcribe", { method: "POST", body: form, credentials: "include" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Transcription failed (${res.status})`);
      }
      const data = await res.json() as { text?: string };
      onTranscriptRef.current((data.text || "").trim());
    } catch (err: any) {
      toast({ title: "Dictation failed", description: err.message || "Could not transcribe audio.", variant: "destructive" });
    } finally {
      setStatus("idle");
    }
  };

  const start = async () => {
    if (status !== "idle") return;
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
      recorder.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      recorder.onstop = () => {
        releaseMic();
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" });
        chunksRef.current = [];
        if (blob.size > 0) void transcribe(blob);
        else setStatus("idle");
      };
      recorderRef.current = recorder;
      recorder.start();
      setStatus("recording");
    } catch (err: any) {
      releaseMic();
      setStatus("idle");
      toast({
        title: "Microphone unavailable",
        description: err?.name === "NotAllowedError"
          ? "Microphone permission was denied."
          : (err?.message || "Could not access the microphone."),
        variant: "destructive",
      });
    }
  };

  const stop = () => {
    if (recorderRef.current && recorderRef.current.state !== "inactive") recorderRef.current.stop();
  };

  const toggle = () => {
    if (status === "recording") stop();
    else if (status === "idle") void start();
  };

  // Stop the mic if the component unmounts mid-recording.
  useEffect(() => () => { stop(); releaseMic(); }, []);

  return { status, toggle };
}
