import { useState, useRef, useEffect, useLayoutEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import {
  ArrowLeft,
  Phone,
  Mail,
  Instagram,
  MessageCircle,
  Send,
  Calendar,
  Image as ImageIcon,
  Loader2,
  Trash2,
  ExternalLink,
  X,
  User,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { formatDistanceToNow, format } from "date-fns";
import { cn } from "@/lib/utils";
import { MessageBubble } from "@/components/message-bubble";
import { ConversationMediaDialog } from "@/components/conversation-media-dialog";

function isReactionNoise(content: string | null | undefined): boolean {
  if (!content) return false;
  const c = content.toLowerCase().trim();
  return (
    c.startsWith("reacted ") && (c.includes(" to your message") || c.includes(" to their message") || c.includes(" to this message") || c.endsWith("to your message"))
  ) || c === "liked a message" || c === "reacted to your message";
}

const PAGE_SIZE = 50;
/** Gap between messages that triggers an Instagram-style timestamp separator */
const TIME_SEPARATOR_GAP_MS = 60 * 60 * 1000;
/** Consecutive same-sender messages within this window render as one group */
const GROUP_WINDOW_MS = 5 * 60 * 1000;

export function getChannelIcon(type: string) {
  switch (type) {
    case "phone":
      return <Phone className="h-4 w-4" />;
    case "email":
      return <Mail className="h-4 w-4" />;
    case "instagram":
      return <Instagram className="h-4 w-4" />;
    default:
      return <MessageCircle className="h-4 w-4" />;
  }
}

interface ConversationThreadPaneProps {
  conversationId: string;
  /** Renders a back button in the header (mobile / standalone page) */
  onBack?: () => void;
  /** Where to go after deleting the conversation */
  onDeleted?: () => void;
  /**
   * Render the thread from a profile subject's point of view: messages sent
   * by the subject (their account, their person entity, or any of their
   * linked accounts) go on the right, everything else on the left — emulating
   * the subject's own phone. Omit all three for the normal
   * self-on-the-right view.
   */
  perspectiveSocialAccountId?: string;
  perspectivePersonId?: string;
  perspectiveAccountIds?: string[];
}

export function ConversationThreadPane({
  conversationId,
  onBack,
  onDeleted,
  perspectiveSocialAccountId,
  perspectivePersonId,
  perspectiveAccountIds,
}: ConversationThreadPaneProps) {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const scrollRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const prevScrollHeightRef = useRef<number | null>(null);
  const prevCountRef = useRef(0);

  // Compose state
  const [content, setContent] = useState("");
  const [senderId, setSenderId] = useState("self");
  const [sentAt, setSentAt] = useState(format(new Date(), "yyyy-MM-dd'T'HH:mm"));
  const [uploadedPhotos, setUploadedPhotos] = useState<Array<{ id: string; location: string }>>([]);
  const [isUploading, setIsUploading] = useState(false);

  // Pagination: grow the window (newest N messages); server returns newest-first
  const [pageCount, setPageCount] = useState(1);
  const [isMediaOpen, setIsMediaOpen] = useState(false);

  const handleJumpToMessage = (messageId: string) => {
    setIsMediaOpen(false);
    setTimeout(() => {
      const el = document.getElementById(`message-${messageId}`);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        el.classList.add("bg-primary/20", "ring-2", "ring-primary");
        setTimeout(() => {
          el.classList.remove("bg-primary/20", "ring-2", "ring-primary");
        }, 2000);
      }
    }, 100);
  };

  // Perspective ("their phone") helpers — see prop docs
  const subjectAccountIds = new Set([
    ...(perspectiveAccountIds ?? []),
    ...(perspectiveSocialAccountId ? [perspectiveSocialAccountId] : []),
  ]);
  const hasPerspective = subjectAccountIds.size > 0 || perspectivePersonId != null;
  const isSubjectSender = (m: any) =>
    (m.senderSocialAccountId != null && subjectAccountIds.has(m.senderSocialAccountId)) ||
    (perspectivePersonId != null && m.senderPersonId === perspectivePersonId);
  const isSubjectParticipant = (p: any) =>
    (p.socialAccountId != null && subjectAccountIds.has(p.socialAccountId)) ||
    (perspectivePersonId != null && p.personId === perspectivePersonId);

  const { data: conversation, isLoading: isConvLoading } = useQuery<any>({
    queryKey: [`/api/conversations/${conversationId}`],
  });

  const { data: messagesData, isLoading: isMsgsLoading, isFetching } = useQuery<{ messages: any[]; total: number }>({
    queryKey: [`/api/conversations/${conversationId}/messages`, pageCount],
    queryFn: async () => {
      const res = await fetch(
        `/api/conversations/${conversationId}/messages?offset=0&limit=${PAGE_SIZE * pageCount}`,
        { credentials: "include" }
      );
      if (!res.ok) throw new Error("Failed to fetch messages");
      return await res.json();
    },
    placeholderData: (prev) => prev,
  });

  const messages = messagesData?.messages || [];
  const total = messagesData?.total || 0;
  const hasOlder = messages.length < total;
  const chronologicalMessages = [...messages].reverse();

  // Reset pagination when switching conversations
  useEffect(() => {
    setPageCount(1);
    prevCountRef.current = 0;
  }, [conversationId]);

  // Scroll handling: jump to bottom on first load / new message; preserve
  // position when older messages are prepended
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (prevScrollHeightRef.current !== null) {
      // Older page loaded — keep the viewport anchored
      el.scrollTop += el.scrollHeight - prevScrollHeightRef.current;
      prevScrollHeightRef.current = null;
    } else if (chronologicalMessages.length !== prevCountRef.current) {
      messagesEndRef.current?.scrollIntoView();
    }
    prevCountRef.current = chronologicalMessages.length;
  }, [chronologicalMessages.length]);

  const loadOlder = () => {
    if (!hasOlder || isFetching) return;
    prevScrollHeightRef.current = scrollRef.current?.scrollHeight ?? null;
    setPageCount((n) => n + 1);
  };

  const handleScroll = () => {
    const el = scrollRef.current;
    if (el && el.scrollTop < 60 && hasOlder && !isFetching) loadOlder();
  };

  // Mutations
  const sendMessageMutation = useMutation({
    mutationFn: async (payload: any) => {
      const res = await apiRequest("POST", `/api/conversations/${conversationId}/messages`, payload);
      return await res.json();
    },
    onSuccess: () => {
      setContent("");
      setUploadedPhotos([]);
      setSentAt(format(new Date(), "yyyy-MM-dd'T'HH:mm"));
      queryClient.invalidateQueries({ queryKey: [`/api/conversations/${conversationId}/messages`] });
      queryClient.invalidateQueries({ queryKey: ["/api/conversations/paginated"] });
    },
    onError: (error: any) => {
      toast({
        title: "Error sending message",
        description: error.message || "Failed to log message",
        variant: "destructive",
      });
    },
  });

  const deleteConversationMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("DELETE", `/api/conversations/${conversationId}`);
    },
    onSuccess: () => {
      toast({ title: "Conversation deleted", description: "The thread has been deleted." });
      queryClient.invalidateQueries({ queryKey: ["/api/conversations/paginated"] });
      onDeleted?.();
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to delete conversation",
        variant: "destructive",
      });
    },
  });

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    const formData = new FormData();
    formData.append("image", file);

    try {
      const res = await fetch("/api/prm-face/img/add", {
        method: "POST",
        body: formData,
      });
      if (!res.ok) throw new Error("Upload failed");
      const photo = await res.json();
      setUploadedPhotos((prev) => [...prev, photo]);
    } catch (err: any) {
      toast({
        title: "Upload failed",
        description: err.message || "Failed to upload image",
        variant: "destructive",
      });
    } finally {
      setIsUploading(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!content.trim() && uploadedPhotos.length === 0) return;

    const isSelf = senderId === "self";
    const senderPersonId = isSelf ? null : senderId;

    const recipients = (conversation?.participants || [])
      .filter((p: any) => (isSelf ? p.personId !== null : p.personId !== senderId))
      .map((p: any) => ({
        personId: p.personId,
        socialAccountId: p.socialAccountId,
        recipientType: "to",
      }));

    sendMessageMutation.mutate({
      senderPersonId,
      senderSocialAccountId: null,
      content: content.trim() || null,
      contentType: "text",
      imageUuids: uploadedPhotos.map((p) => p.id),
      sentAt: sentAt ? new Date(sentAt).toISOString() : new Date().toISOString(),
      recipients,
    });
  };

  if (isConvLoading || (isMsgsLoading && !messagesData)) {
    return (
      <div className="flex h-full items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!conversation) {
    return (
      <div className="flex flex-col h-full items-center justify-center p-6 text-center bg-background">
        <h3 className="font-semibold text-lg">Conversation not found</h3>
        <p className="text-sm text-muted-foreground mt-1">This thread may have been deleted.</p>
        {onBack && (
          <Button variant="outline" size="sm" className="mt-4" onClick={onBack}>
            Back to Messages
          </Button>
        )}
      </div>
    );
  }

  const participantsList = conversation.participants || [];
  const participantsNames = participantsList
    .map((p: any) => {
      if (p.person) return `${p.person.firstName} ${p.person.lastName}`;
      if (p.socialAccount) return p.socialAccount.username;
      return "Unknown";
    })
    .filter((n: string) => n !== "Unknown")
    .join(", ");

  // In perspective mode the header names the counterpart(s) — who the subject
  // is talking to — rather than the thread's own title (which is usually the
  // subject itself in Instagram exports)
  const counterpartNames = hasPerspective
    ? Array.from(
        new Set(
          participantsList
            .filter((p: any) => !isSubjectParticipant(p))
            .map((p: any) => {
              if (p.person) return `${p.person.firstName} ${p.person.lastName}`;
              if (p.socialAccount) return p.socialAccount.username;
              return conversation.metadata?.ownerName || "You";
            })
        )
      ).join(", ") || conversation.metadata?.ownerName || "You"
    : null;

  const counterpartParticipant = hasPerspective
    ? participantsList.find((p: any) => !isSubjectParticipant(p))
    : participantsList.find((p: any) => p.personId !== null || p.socialAccountId !== null);

  return (
    <div className="flex flex-col h-full overflow-hidden bg-background">
      {/* Header */}
      <div className="border-b px-4 md:px-6 py-4 flex items-center justify-between shrink-0 bg-card/40 backdrop-blur-md z-10">
        <div className="flex items-center gap-3 min-w-0">
          {onBack && (
            <Button variant="ghost" size="icon" onClick={onBack} className="h-8 w-8 rounded-full shrink-0">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          )}

          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="font-bold text-foreground truncate text-base">
                {counterpartParticipant ? (
                  <button
                    onClick={() => {
                      if (counterpartParticipant.person) {
                        navigate(`/person/${counterpartParticipant.person.id}`);
                      } else if (counterpartParticipant.socialAccount) {
                        navigate(`/social-accounts/${counterpartParticipant.socialAccount.id}`);
                      }
                    }}
                    className="hover:underline hover:text-primary transition-colors text-left font-bold"
                  >
                    {counterpartNames || conversation.title || participantsNames || "Conversation"}
                  </button>
                ) : (
                  counterpartNames || conversation.title || participantsNames || "Conversation"
                )}
              </h2>
              <Badge variant="secondary" className="flex items-center gap-1 text-[10px] py-0 px-2 font-semibold uppercase">
                {getChannelIcon(conversation.channelType)}
                <span>{conversation.channelType}</span>
              </Badge>
              {conversation.externalUrl && (
                <a
                  href={conversation.externalUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-muted-foreground hover:text-primary transition-colors inline-flex items-center"
                  title="Source link"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              )}
            </div>
            {conversation.title && participantsNames && (
              <p className="text-xs text-muted-foreground truncate mt-0.5">{participantsNames}</p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setIsMediaOpen(true)}
            className="h-8 w-8 rounded-full text-muted-foreground hover:text-foreground shrink-0"
            title="View shared media"
            data-testid="button-view-media"
          >
            <ImageIcon className="h-4 w-4" />
          </Button>

          <Button
            variant="ghost"
            size="icon"
            onClick={() => {
              if (confirm("Are you sure you want to delete this communication log? All logged messages will be removed.")) {
                deleteConversationMutation.mutate();
              }
            }}
            className="h-8 w-8 rounded-full text-muted-foreground hover:text-destructive shrink-0"
            data-testid="button-delete-conversation"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Messages */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto px-4 md:px-6 py-6 scrollbar-thin bg-muted/10"
      >
        {(() => {
          const renderedMessages = chronologicalMessages.filter((m) => !isReactionNoise(m.content));
          if (renderedMessages.length === 0) {
            return (
              <div className="flex flex-col items-center justify-center h-48 text-muted-foreground/60 text-sm">
                <MessageCircle className="h-8 w-8 mb-2 opacity-50" />
                <p>No messages logged in this thread yet.</p>
                <p className="text-xs opacity-75 mt-0.5">Add a message below to start logging.</p>
              </div>
            );
          }
          return (
            <div className="max-w-4xl mx-auto">
              {hasOlder && (
                <div className="flex justify-center pb-4">
                  <Button variant="outline" size="sm" className="rounded-full text-xs" onClick={loadOlder} disabled={isFetching}>
                    {isFetching ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
                    Load older messages ({total - messages.length} more)
                  </Button>
                </div>
              )}

              {renderedMessages.map((msg: any, i: number) => {
                const isSelfEntity = msg.senderPersonId === null && msg.senderSocialAccountId === null;
                // Bubble side: normally self-on-the-right; in perspective mode the
                // subject's messages go right instead
                const isSelf = hasPerspective ? isSubjectSender(msg) : isSelfEntity;
                const senderName = isSelfEntity
                  ? "Self"
                  : msg.senderPerson
                    ? `${msg.senderPerson.firstName} ${msg.senderPerson.lastName}`
                    : msg.senderSocialAccount
                      ? msg.senderSocialAccount.username
                      : msg.metadata?.senderName || "Unknown";

                const prev = i > 0 ? renderedMessages[i - 1] : null;
                const msgTime = msg.sentAt ? new Date(msg.sentAt).getTime() : 0;
                const prevTime = prev?.sentAt ? new Date(prev.sentAt).getTime() : 0;

                const showTimeSeparator = !prev || msgTime - prevTime > TIME_SEPARATOR_GAP_MS;

                const sameSenderAsPrev =
                  prev !== null &&
                  !showTimeSeparator &&
                  prev.senderPersonId === msg.senderPersonId &&
                  prev.senderSocialAccountId === msg.senderSocialAccountId &&
                  msgTime - prevTime < GROUP_WINDOW_MS;

                const relativeTime = msg.sentAt
                  ? formatDistanceToNow(new Date(msg.sentAt), { addSuffix: true })
                  : "";

                // Only the last message of a group shows its timestamp
                const next = i < renderedMessages.length - 1 ? renderedMessages[i + 1] : null;
                const nextTime = next?.sentAt ? new Date(next.sentAt).getTime() : 0;
                const groupedWithNext =
                  next !== null &&
                  next.senderPersonId === msg.senderPersonId &&
                  next.senderSocialAccountId === msg.senderSocialAccountId &&
                  nextTime - msgTime < GROUP_WINDOW_MS &&
                  nextTime - msgTime <= TIME_SEPARATOR_GAP_MS;

                return (
                  <div
                    key={msg.id}
                    id={`message-${msg.id}`}
                    className={cn(sameSenderAsPrev ? "mt-0.5" : "mt-4", i === 0 && "mt-0", "transition-all duration-500 rounded-lg p-1")}
                  >
                    {showTimeSeparator && msg.sentAt && (
                      <div className="flex justify-center py-3 select-none">
                        <span className="text-[10px] font-medium text-muted-foreground/70 bg-muted/40 rounded-full px-3 py-1">
                          {format(new Date(msg.sentAt), "MMM d, yyyy · h:mm a")}
                        </span>
                      </div>
                    )}
                    <MessageBubble
                      msg={msg}
                      isSelf={isSelf}
                      senderName={senderName}
                      hideSender={sameSenderAsPrev}
                      timestamp={groupedWithNext ? undefined : relativeTime}
                      onDelete={async (messageId) => {
                        if (confirm("Delete this logged message?")) {
                          await apiRequest("DELETE", `/api/messages/${messageId}`);
                          queryClient.invalidateQueries({
                            queryKey: [`/api/conversations/${conversationId}/messages`],
                          });
                        }
                      }}
                    />
                  </div>
                );
              })}
              <div ref={messagesEndRef} />
            </div>
          );
        })()}
      </div>

      {/* Composer */}
      <div className="border-t p-4 shrink-0 bg-card/60 backdrop-blur-md z-10">
        <form onSubmit={handleSubmit} className="max-w-4xl mx-auto space-y-3">
          <div className="flex flex-wrap items-center gap-3 bg-muted/30 p-2 rounded-xl border border-muted/50">
            <div className="flex items-center gap-1.5 shrink-0">
              <User className="h-3.5 w-3.5 text-muted-foreground" />
              <Select value={senderId} onValueChange={setSenderId}>
                <SelectTrigger className="h-8 text-xs bg-background border-none w-36 shadow-none">
                  <SelectValue placeholder="Sender" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="self">Self (Logged user)</SelectItem>
                  {participantsList
                    .filter((p: any) => p.personId !== null)
                    .map((p: any) => (
                      <SelectItem key={p.personId} value={p.personId}>
                        {p.person ? `${p.person.firstName} ${p.person.lastName}` : "Contact"}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center gap-1.5 shrink-0 ml-auto md:ml-0">
              <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
              <Input
                type="datetime-local"
                className="h-8 text-xs bg-background border-none w-44 shadow-none p-1 focus-visible:ring-0"
                value={sentAt}
                onChange={(e) => setSentAt(e.target.value)}
              />
            </div>
          </div>

          {uploadedPhotos.length > 0 && (
            <div className="flex flex-wrap gap-2 p-2 border rounded-xl bg-muted/20">
              {uploadedPhotos.map((photo) => (
                <div key={photo.id} className="relative h-16 w-16 group rounded border overflow-hidden">
                  <img src={photo.location} alt="Thumbnail" className="h-full w-full object-cover" />
                  <button
                    type="button"
                    onClick={() => setUploadedPhotos((prev) => prev.filter((p) => p.id !== photo.id))}
                    className="absolute top-1 right-1 p-0.5 rounded-full bg-destructive text-destructive-foreground opacity-90 hover:opacity-100 shadow"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="flex gap-2 items-end">
            <div className="relative flex-1">
              <Textarea
                placeholder="Log message content..."
                className="min-h-[44px] h-11 py-2.5 resize-none pr-10 rounded-2xl bg-muted/40 focus:bg-background border-muted/80 transition-all font-sans"
                value={content}
                onChange={(e) => setContent(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleSubmit(e);
                  }
                }}
              />

              <div className="absolute right-2.5 bottom-2.5">
                <input
                  type="file"
                  id={`message-file-input-${conversationId}`}
                  className="hidden"
                  accept="image/*"
                  onChange={handleImageUpload}
                  disabled={isUploading}
                />
                <label
                  htmlFor={`message-file-input-${conversationId}`}
                  className={cn(
                    "cursor-pointer flex items-center justify-center p-1 rounded-full text-muted-foreground hover:text-primary transition-colors",
                    isUploading && "animate-pulse"
                  )}
                  title="Upload image"
                >
                  {isUploading ? (
                    <Loader2 className="h-4 w-4 animate-spin text-primary" />
                  ) : (
                    <ImageIcon className="h-4 w-4" />
                  )}
                </label>
              </div>
            </div>

            <Button
              type="submit"
              size="icon"
              disabled={(!content.trim() && uploadedPhotos.length === 0) || sendMessageMutation.isPending}
              className="h-11 w-11 rounded-2xl shadow-lg hover:shadow-primary/20 shrink-0"
            >
              <Send className="h-4 w-4" />
            </Button>
          </div>
        </form>
      </div>

      <ConversationMediaDialog
        open={isMediaOpen}
        onOpenChange={setIsMediaOpen}
        conversationId={conversationId}
        onJumpToMessage={handleJumpToMessage}
      />
    </div>
  );
}
