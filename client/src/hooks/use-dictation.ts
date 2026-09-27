import { useEffect, useRef, useState } from "react";
import { useToast } from "@/hooks/use-toast";

export type DictationStatus = "idle" | "recording" | "transcribing";

export interface UseDictationOptions {
  deviceId?: string;
  onPermissionGranted?: () => void;
}

/**
 * Microphone dictation: records with MediaRecorder, sends the clip to the
 * Whisper proxy (/api/daily-notes/transcribe) and hands back the text.
 * Errors are surfaced as toasts; the mic is released on stop and on unmount.
 */
export function useDictation(
  onTranscript: (text: string) => void,
  options?: UseDictationOptions
) {
  const { toast } = useToast();
  const [status, setStatus] = useState<DictationStatus>("idle");
  const [audioLevel, setAudioLevel] = useState<number>(0);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const onTranscriptRef = useRef(onTranscript);
  onTranscriptRef.current = onTranscript;
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const releaseMic = () => {
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }
    setAudioLevel(0);
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
      const selectedDeviceId = optionsRef.current?.deviceId;
      const constraints: MediaStreamConstraints = {
        audio: selectedDeviceId && selectedDeviceId !== "default"
          ? { deviceId: { exact: selectedDeviceId } }
          : true,
      };

      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia(constraints);
      } catch (deviceErr) {
        if (selectedDeviceId && selectedDeviceId !== "default") {
          stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        } else {
          throw deviceErr;
        }
      }
      streamRef.current = stream;
      optionsRef.current?.onPermissionGranted?.();

      try {
        const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
        if (AudioContextClass) {
          const ctx = new AudioContextClass();
          const source = ctx.createMediaStreamSource(stream);
          const analyser = ctx.createAnalyser();
          analyser.fftSize = 256;
          analyser.smoothingTimeConstant = 0.4;
          source.connect(analyser);
          audioContextRef.current = ctx;

          const dataArray = new Uint8Array(analyser.frequencyBinCount);
          const checkVolume = () => {
            if (recorderRef.current && recorderRef.current.state === "recording") {
              analyser.getByteFrequencyData(dataArray);
              let sum = 0;
              const count = Math.min(dataArray.length, 32);
              for (let i = 0; i < count; i++) {
                sum += dataArray[i];
              }
              const avg = sum / count;
              const normalized = Math.min(1, Math.max(0, avg / 80));
              setAudioLevel(normalized);
              animFrameRef.current = requestAnimationFrame(checkVolume);
            } else {
              setAudioLevel(0);
            }
          };
          animFrameRef.current = requestAnimationFrame(checkVolume);
        }
      } catch {
        // Web Audio visualizer setup shouldn't interrupt recording
      }

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

  return { status, toggle, start, stop, audioLevel };
}
