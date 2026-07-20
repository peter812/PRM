import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2, Film, Link as LinkIcon, ImageIcon, ExternalLink, MessageSquare } from "lucide-react";
import { format } from "date-fns";

interface MediaItem {
  messageId: string;
  type: "photo" | "video" | "link";
  url?: string;
  photoId?: string;
  title?: string;
  sentAt?: string | Date;
}

// Inline helper to fetch and render photo thumbnail
function PhotoThumbnail({ photoId }: { photoId: string }) {
  const { data: photo, isLoading } = useQuery<{ id: string; location: string }>({
    queryKey: [`/api/photos/${photoId}`],
    queryFn: async () => {
      const res = await fetch(`/api/photos/${photoId}`);
      if (!res.ok) throw new Error("Failed to fetch photo");
      return res.json();
    },
  });

  if (isLoading) {
    return <div className="aspect-square w-full bg-muted animate-pulse rounded-md" />;
  }

  if (!photo?.location) {
    return (
      <div className="aspect-square w-full bg-muted flex items-center justify-center rounded-md border text-muted-foreground">
        <ImageIcon className="h-6 w-6 opacity-40" />
      </div>
    );
  }

  return (
    <img
      src={photo.location}
      alt="Shared Media"
      className="aspect-square w-full object-cover rounded-md border bg-muted"
    />
  );
}

interface ConversationMediaDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  conversationId: string;
  onJumpToMessage: (messageId: string) => void;
}

export function ConversationMediaDialog({
  open,
  onOpenChange,
  conversationId,
  onJumpToMessage,
}: ConversationMediaDialogProps) {
  // Fetch all messages in the conversation to build the media index
  const { data, isLoading } = useQuery<{ messages: any[] }>({
    queryKey: [`/api/conversations/${conversationId}/messages/all-media`],
    queryFn: async () => {
      // Fetch a large page count to scan most conversation history
      const res = await fetch(`/api/conversations/${conversationId}/messages?offset=0&limit=1000`);
      if (!res.ok) throw new Error("Failed to fetch conversation history");
      return res.json();
    },
    enabled: open,
  });

  const messages = data?.messages || [];

  // Parse media items
  const mediaItems: MediaItem[] = [];
  for (const msg of messages) {
    // 1. Photos
    if (msg.imageUuids && Array.isArray(msg.imageUuids) && msg.imageUuids.length > 0) {
      for (const photoId of msg.imageUuids) {
        mediaItems.push({
          messageId: msg.id,
          type: "photo",
          photoId,
          sentAt: msg.sentAt,
        });
      }
    }
    // 2. Attachments (videos/links)
    if (msg.attachments && Array.isArray(msg.attachments)) {
      for (const att of msg.attachments) {
        if (att.url) {
          if (att.type === "video") {
            mediaItems.push({
              messageId: msg.id,
              type: "video",
              url: att.url,
              sentAt: msg.sentAt,
            });
          } else if (att.type === "file" || att.type === "link") {
            mediaItems.push({
              messageId: msg.id,
              type: "link",
              url: att.url,
              title: att.name || "Attachment Link",
              sentAt: msg.sentAt,
            });
          }
        }
      }
    }
    // 3. Instagram share card metadata
    if (msg.metadata?.share) {
      const share = msg.metadata.share;
      if (share.link) {
        mediaItems.push({
          messageId: msg.id,
          type: "link",
          url: share.link,
          title: share.text || "Shared Link",
          sentAt: msg.sentAt,
        });
      }
    }
  }

  // Helper to open media detail page/link
  const handleOpenMedia = async (item: MediaItem) => {
    if (item.type === "photo" && item.photoId) {
      // Fetch full photo url
      try {
        const res = await fetch(`/api/photos/${item.photoId}`);
        if (res.ok) {
          const photo = await res.json();
          if (photo?.location) window.open(photo.location, "_blank");
        }
      } catch (err) {
        console.error("Failed to open photo link:", err);
      }
    } else if (item.url) {
      window.open(item.url, "_blank");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[80vh] flex flex-col p-6 overflow-hidden">
        <DialogHeader className="mb-2 shrink-0">
          <DialogTitle className="text-xl font-bold flex items-center gap-2">
            <ImageIcon className="h-5 w-5 text-primary" />
            Shared Media Gallery ({mediaItems.length})
          </DialogTitle>
        </DialogHeader>

        {isLoading ? (
          <div className="flex-1 flex items-center justify-center py-20">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : mediaItems.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground py-20 italic">
            No photos, videos, or links have been shared in this conversation.
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto pr-1">
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4 p-1">
              {mediaItems.map((item, idx) => (
                <div
                  key={idx}
                  className="group relative flex flex-col justify-between overflow-hidden rounded-lg border bg-card text-card-foreground shadow-sm hover:shadow-md transition-all duration-300"
                >
                  {/* Media Content */}
                  <div className="relative aspect-square w-full flex items-center justify-center bg-muted/30">
                    {item.type === "photo" && item.photoId && (
                      <PhotoThumbnail photoId={item.photoId} />
                    )}

                    {item.type === "video" && (
                      <div className="relative w-full h-full flex items-center justify-center bg-black/90 rounded-t-lg">
                        <video src={item.url} className="absolute inset-0 w-full h-full object-cover opacity-60" />
                        <Film className="h-8 w-8 text-white relative z-10 opacity-80" />
                      </div>
                    )}

                    {item.type === "link" && (
                      <div className="w-full h-full p-3 flex flex-col items-center justify-center text-center bg-muted/40 rounded-t-lg">
                        <LinkIcon className="h-8 w-8 text-primary mb-2 opacity-80" />
                        <span className="text-[11px] font-medium line-clamp-3 text-foreground px-1 break-all">
                          {item.title || "Link"}
                        </span>
                      </div>
                    )}

                    {/* Date Tag */}
                    {item.sentAt && (
                      <span className="absolute bottom-1 right-1 bg-black/75 text-white text-[9px] px-1.5 py-0.5 rounded leading-none">
                        {format(new Date(item.sentAt), "MMM d")}
                      </span>
                    )}
                  </div>

                  {/* Actions overlay panel */}
                  <div className="flex border-t divide-x">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="flex-1 h-8 rounded-none rounded-bl-lg text-[11px] gap-1 px-1.5"
                      onClick={() => handleOpenMedia(item)}
                      title="Open full page/file"
                    >
                      <ExternalLink className="h-3 w-3" />
                      Open
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="flex-1 h-8 rounded-none rounded-br-lg text-[11px] gap-1 px-1.5"
                      onClick={() => onJumpToMessage(item.messageId)}
                      title="Jump to message context"
                    >
                      <MessageSquare className="h-3 w-3" />
                      Context
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
