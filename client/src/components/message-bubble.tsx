import { useQuery } from "@tanstack/react-query";
import { Phone, ExternalLink, MicOff, FileX, X, Instagram } from "lucide-react";
import { cn } from "@/lib/utils";
import type { MessageAttachment, MessageMetadata } from "@shared/schema";

// Image loaded by photo UUID via the photos API
function MessageImage({ photoId }: { photoId: string }) {
  const { data: photo } = useQuery<{ id: string; location: string }>({
    queryKey: [`/api/photos/${photoId}`],
    queryFn: async () => {
      const res = await fetch(`/api/photos/${photoId}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch photo");
      return await res.json();
    },
  });

  if (!photo?.location) {
    return <div className="h-24 w-24 bg-muted animate-pulse rounded" />;
  }

  return (
    <a
      href={photo.location}
      target="_blank"
      rel="noreferrer"
      className="block overflow-hidden rounded border hover:opacity-90 transition-opacity"
    >
      <img src={photo.location} alt="Attachment" className="max-h-60 max-w-full object-cover rounded" />
    </a>
  );
}

function AttachmentView({ attachment }: { attachment: MessageAttachment }) {
  if (attachment.unavailable || !attachment.url) {
    const label =
      attachment.type === "audio"
        ? "Voice message (no longer available)"
        : attachment.type === "video"
          ? "Video (no longer available)"
          : "Attachment missing";
    const Icon = attachment.type === "audio" ? MicOff : FileX;
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground italic bg-muted/40 rounded-lg px-3 py-2">
        <Icon className="h-3.5 w-3.5 shrink-0" />
        <span>{label}</span>
      </div>
    );
  }

  if (attachment.type === "video") {
    return (
      <video
        controls
        preload="metadata"
        className="max-w-full max-h-72 rounded-lg border bg-black"
        src={attachment.url}
      />
    );
  }

  if (attachment.type === "audio") {
    return <audio controls preload="metadata" className="max-w-full h-10" src={attachment.url} />;
  }

  return (
    <a href={attachment.url} target="_blank" rel="noreferrer" className="text-xs underline">
      Attachment
    </a>
  );
}

function ShareCard({ share, isSelf }: { share: NonNullable<MessageMetadata["share"]>; isSelf: boolean }) {
  const hostname = (() => {
    try {
      return share.link ? new URL(share.link).hostname.replace(/^www\./, "") : null;
    } catch {
      return null;
    }
  })();

  const inner = (
    <div
      className={cn(
        "flex items-center gap-2 rounded-lg border px-3 py-2 text-xs",
        isSelf ? "border-primary-foreground/25 bg-primary-foreground/10" : "border-muted bg-muted/40"
      )}
    >
      <Instagram className="h-3.5 w-3.5 shrink-0 opacity-70" />
      <div className="min-w-0">
        <div className="font-medium truncate">{share.text || "Shared post"}</div>
        {hostname && <div className="opacity-70 truncate">{hostname}</div>}
      </div>
      {share.link && <ExternalLink className="h-3 w-3 shrink-0 opacity-70" />}
    </div>
  );

  return share.link ? (
    <a href={share.link} target="_blank" rel="noreferrer" className="block hover:opacity-90 transition-opacity">
      {inner}
    </a>
  ) : (
    inner
  );
}

export interface MessageBubbleProps {
  msg: any; // MessageWithRecipients from the API
  isSelf: boolean;
  senderName: string;
  /** Hide the small sender label above the bubble (grouped bubbles) */
  hideSender?: boolean;
  /** Timestamp string rendered under the bubble; omit to hide */
  timestamp?: string;
  onDelete?: (messageId: string) => void;
}

export function MessageBubble({ msg, isSelf, senderName, hideSender, timestamp, onDelete }: MessageBubbleProps) {
  const metadata = (msg.metadata || {}) as MessageMetadata;
  const attachments = (msg.attachments || []) as MessageAttachment[];
  const reactions = metadata.reactions || [];
  const isCall = metadata.callDurationSec !== undefined;

  // Calls render as a centered event chip, not a speech bubble
  if (isCall) {
    const mins = Math.floor((metadata.callDurationSec || 0) / 60);
    const secs = (metadata.callDurationSec || 0) % 60;
    return (
      <div className="flex flex-col items-center w-full py-1">
        <div className="flex items-center gap-2 text-xs text-muted-foreground bg-muted/40 border rounded-full px-3.5 py-1.5">
          <Phone className="h-3 w-3" />
          <span>
            {msg.content || "Call"} · {mins}m {secs}s
          </span>
        </div>
        {timestamp && <span className="text-[9px] text-muted-foreground/75 mt-1 select-none">{timestamp}</span>}
      </div>
    );
  }

  return (
    <div className={cn("flex flex-col max-w-[70%]", isSelf ? "ml-auto items-end" : "mr-auto items-start")}>
      {!hideSender && (
        <span className="text-[10px] text-muted-foreground font-semibold px-2 mb-0.5 select-none">{senderName}</span>
      )}

      <div
        className={cn(
          "rounded-2xl px-4 py-2.5 text-sm shadow-sm relative group/bubble border",
          isSelf
            ? "bg-primary text-primary-foreground border-primary/20 rounded-tr-sm"
            : "bg-card text-foreground border-muted rounded-tl-sm",
          reactions.length > 0 && "mb-2.5"
        )}
      >
        {msg.content && (
          <div className="whitespace-pre-wrap break-words leading-relaxed font-sans">{msg.content}</div>
        )}

        {metadata.share && (
          <div className={cn(msg.content && "mt-2")}>
            <ShareCard share={metadata.share} isSelf={isSelf} />
          </div>
        )}

        {msg.imageUuids && msg.imageUuids.length > 0 && (
          <div className="mt-2.5 grid gap-1.5 grid-cols-1 sm:grid-cols-2">
            {msg.imageUuids.map((uuid: string) => (
              <MessageImage key={uuid} photoId={uuid} />
            ))}
          </div>
        )}

        {attachments.length > 0 && (
          <div className={cn("space-y-1.5", (msg.content || msg.imageUuids?.length > 0) && "mt-2.5")}>
            {attachments.map((att, i) => (
              <AttachmentView key={i} attachment={att} />
            ))}
          </div>
        )}

        {/* Reaction badge, Instagram-style pinned to the bubble's bottom corner */}
        {reactions.length > 0 && (
          <div
            className={cn(
              "absolute -bottom-3 flex items-center bg-card border rounded-full px-1.5 py-0.5 text-xs shadow-sm select-none",
              isSelf ? "right-2" : "left-2"
            )}
            title={reactions.map((r) => `${r.actor}: ${r.emoji}`).join(", ")}
          >
            {reactions.map((r, i) => (
              <span key={i}>{r.emoji}</span>
            ))}
            {reactions.length > 1 && (
              <span className="ml-0.5 text-[9px] text-muted-foreground">{reactions.length}</span>
            )}
          </div>
        )}

        {onDelete && (
          <button
            onClick={() => onDelete(msg.id)}
            className={cn(
              "absolute top-1/2 -translate-y-1/2 p-1.5 rounded-full bg-destructive text-destructive-foreground opacity-0 group-hover/bubble:opacity-100 transition-opacity hover:scale-105 shadow",
              isSelf ? "right-full mr-2" : "left-full ml-2"
            )}
            title="Delete log"
          >
            <X className="h-3 w-3" />
          </button>
        )}
      </div>

      {timestamp && (
        <span className="text-[9px] text-muted-foreground/75 mt-1 px-2 select-none font-medium">{timestamp}</span>
      )}
    </div>
  );
}
