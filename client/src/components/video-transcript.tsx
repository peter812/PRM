import { useState } from "react";
import { AudioLines, Check, ChevronDown, Copy } from "lucide-react";
import { Switch } from "@/components/ui/switch";

/** social_account_posts.video_transcript, as stored by server/recognition.ts transcribeVideo. */
interface StoredTranscript {
  text?: string;
  language?: string;
  segments?: { start: number; end: number; text: string }[];
  error?: string;
}

function formatTime(seconds: number): string {
  const s = Math.floor(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Collapsible Whisper transcript of a post/story video; renders nothing until a run has stored a result. */
export function VideoTranscript({ transcript, onSeek }: { transcript: unknown; onSeek?: (seconds: number) => void }) {
  const [open, setOpen] = useState(false);
  const [timestamps, setTimestamps] = useState(false);
  const [copied, setCopied] = useState(false);

  const t = transcript as StoredTranscript | null;
  if (!t) return null;
  const text = t.text?.trim() ?? "";
  const segments = t.segments ?? [];
  const status = t.error ? "Transcription failed" : !text ? "No audio" : null;

  const copy = () => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="rounded-md bg-muted/50 p-2.5 space-y-1.5" data-testid="section-video-transcript">
      <div className="flex items-center gap-2">
        <button
          type="button"
          className="text-xs text-muted-foreground font-medium flex items-center gap-1 hover:text-foreground disabled:hover:text-muted-foreground"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          disabled={!!status}
          title={t.error}
          data-testid="button-toggle-transcript"
        >
          {!status && <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? "" : "-rotate-90"}`} />}
          <AudioLines className="h-3.5 w-3.5" />
          Video transcript
          {status ? <span className="italic">· {status}</span> : t.language && <span>· {t.language}</span>}
        </button>
        {open && !status && (
          <div className="ml-auto flex items-center gap-2">
            {segments.length > 0 && (
              <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer">
                <Switch checked={timestamps} onCheckedChange={setTimestamps} className="scale-75" data-testid="switch-transcript-timestamps" />
                Timestamps
              </label>
            )}
            <button
              type="button"
              className="text-muted-foreground hover:text-foreground"
              onClick={copy}
              aria-label="Copy transcript"
              data-testid="button-copy-transcript"
            >
              {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            </button>
          </div>
        )}
      </div>
      {open && !status && (timestamps && segments.length > 0 ? (
        <ul className="text-sm space-y-0.5" data-testid="list-transcript-segments">
          {segments.map((s, i) => (
            <li key={i} className="flex gap-2">
              <button
                type="button"
                className="shrink-0 font-mono text-xs text-primary hover:underline pt-0.5 disabled:text-muted-foreground disabled:no-underline"
                onClick={() => onSeek?.(s.start)}
                disabled={!onSeek}
              >
                {formatTime(s.start)}
              </button>
              <span className="leading-relaxed break-words">{s.text.trim()}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm whitespace-pre-wrap leading-relaxed break-words" data-testid="text-transcript">
          {text}
        </p>
      ))}
    </div>
  );
}
