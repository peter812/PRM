import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation, useParams } from "wouter";
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
  Clock,
  User,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { formatDistanceToNow, format } from "date-fns";
import { cn } from "@/lib/utils";

// Reusable Image component that queries the photos API by UUID
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
    <a href={photo.location} target="_blank" rel="noreferrer" className="block overflow-hidden rounded border hover:opacity-90 transition-opacity">
      <img
        src={photo.location}
        alt="Attachment"
        className="max-h-60 max-w-full object-cover rounded"
      />
    </a>
  );
}

export default function MessageConversationPage() {
  const { id: conversationId } = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Compose State
  const [content, setContent] = useState("");
  const [senderId, setSenderId] = useState("self"); // 'self' or participant personId
  const [sentAt, setSentAt] = useState(format(new Date(), "yyyy-MM-dd'T'HH:mm"));
  const [uploadedPhotos, setUploadedPhotos] = useState<Array<{ id: string; location: string }>>([]);
  const [isUploading, setIsUploading] = useState(false);

  // Queries
  const { data: conversation, isLoading: isConvLoading } = useQuery<any>({
    queryKey: [`/api/conversations/${conversationId}`],
  });

  const { data: messagesData, isLoading: isMsgsLoading } = useQuery<{ messages: any[]; total: number }>({
    queryKey: [`/api/conversations/${conversationId}/messages`],
  });

  const messages = messagesData?.messages || [];

  // Scroll to bottom on load
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  // Mutations
  const sendMessageMutation = useMutation({
    mutationFn: async (payload: any) => {
      const res = await apiRequest("POST", `/api/conversations/${conversationId}/messages`, payload);
      return await res.json();
    },
    onSuccess: () => {
      setContent("");
      setUploadedPhotos([]);
      // Reset sentAt to current time
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
      toast({
        title: "Conversation deleted",
        description: "The thread has been deleted.",
      });
      navigate("/messages");
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
      setUploadedPhotos(prev => [...prev, photo]);
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

  const handleRemoveUploadedPhoto = (photoId: string) => {
    setUploadedPhotos(prev => prev.filter(p => p.id !== photoId));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!content.trim() && uploadedPhotos.length === 0) return;

    // Resolve sender
    const isSelf = senderId === "self";
    const senderPersonId = isSelf ? null : senderId;

    // Resolve recipients: everyone else in the conversation
    const recipients = (conversation?.participants || [])
      .filter((p: any) => (isSelf ? p.personId !== null : p.personId !== senderId))
      .map((p: any) => ({
        personId: p.personId,
        socialAccountId: p.socialAccountId,
        recipientType: "to",
      }));

    sendMessageMutation.mutate({
      senderPersonId,
      senderSocialAccountId: null, // Defaulting to person entity for logging
      content: content.trim() || null,
      contentType: "text",
      imageUuids: uploadedPhotos.map(p => p.id),
      sentAt: sentAt ? new Date(sentAt).toISOString() : new Date().toISOString(),
      recipients,
    });
  };

  if (isConvLoading || isMsgsLoading) {
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
        <Button variant="outline" size="sm" className="mt-4" onClick={() => navigate("/messages")}>
          Back to Messages
        </Button>
      </div>
    );
  }

  // Format title / subtitle
  const participantsList = conversation.participants || [];
  const participantsNames = participantsList
    .map((p: any) => {
      if (p.person) return `${p.person.firstName} ${p.person.lastName}`;
      if (p.socialAccount) return p.socialAccount.username;
      return "Unknown";
    })
    .join(", ");

  const getChannelIcon = (type: string) => {
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
  };

  // Messages in chronological order
  const chronologicalMessages = [...messages].reverse();

  return (
    <div className="flex flex-col h-full overflow-hidden bg-background">
      {/* Header */}
      <div className="border-b px-6 py-4 flex items-center justify-between shrink-0 bg-card/40 backdrop-blur-md z-10">
        <div className="flex items-center gap-3 min-w-0">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => navigate("/messages")}
            className="h-8 w-8 rounded-full shrink-0"
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>

          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="font-bold text-foreground truncate text-base">
                {conversation.title || participantsNames}
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
            {conversation.title && (
              <p className="text-xs text-muted-foreground truncate mt-0.5">
                {participantsNames}
              </p>
            )}
          </div>
        </div>

        <Button
          variant="ghost"
          size="icon"
          onClick={() => {
            if (confirm("Are you sure you want to delete this communication log? All logged messages will be removed.")) {
              deleteConversationMutation.mutate();
            }
          }}
          className="h-8 w-8 rounded-full text-muted-foreground hover:text-destructive shrink-0"
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>

      {/* Message History Grid / Timeline */}
      <div className="flex-1 overflow-y-auto px-6 py-6 space-y-4 scrollbar-thin bg-muted/10">
        {chronologicalMessages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 text-muted-foreground/60 text-sm">
            <MessageCircle className="h-8 w-8 mb-2 opacity-50" />
            <p>No messages logged in this thread yet.</p>
            <p className="text-xs opacity-75 mt-0.5">Add a message below to start logging.</p>
          </div>
        ) : (
          <div className="max-w-4xl mx-auto space-y-4">
            {chronologicalMessages.map((msg: any) => {
              const isSelf = msg.senderPersonId === null && msg.senderSocialAccountId === null;
              const senderName = isSelf
                ? "Self"
                : msg.senderPerson
                  ? `${msg.senderPerson.firstName} ${msg.senderPerson.lastName}`
                  : msg.senderSocialAccount
                    ? msg.senderSocialAccount.username
                    : "Unknown";

              const relativeTime = msg.sentAt
                ? formatDistanceToNow(new Date(msg.sentAt), { addSuffix: true })
                : "";

              return (
                <div
                  key={msg.id}
                  className={cn("flex flex-col max-w-[70%]", isSelf ? "ml-auto items-end" : "mr-auto items-start")}
                >
                  {/* Sender Name */}
                  <span className="text-[10px] text-muted-foreground font-semibold px-2 mb-0.5 select-none">
                    {senderName}
                  </span>

                  {/* Speech Bubble */}
                  <div
                    className={cn(
                      "rounded-2xl px-4 py-2.5 text-sm shadow-sm relative group/bubble border",
                      isSelf
                        ? "bg-primary text-primary-foreground border-primary/20 rounded-tr-sm"
                        : "bg-card text-foreground border-muted rounded-tl-sm"
                    )}
                  >
                    {/* Content */}
                    <div className="whitespace-pre-wrap break-words leading-relaxed font-sans">
                      {msg.content}
                    </div>

                    {/* Attachment Images */}
                    {msg.imageUuids && msg.imageUuids.length > 0 && (
                      <div className="mt-2.5 grid gap-1.5 grid-cols-1 sm:grid-cols-2">
                        {msg.imageUuids.map((uuid: string) => (
                          <MessageImage key={uuid} photoId={uuid} />
                        ))}
                      </div>
                    )}

                    {/* Delete Message Button */}
                    <button
                      onClick={async () => {
                        if (confirm("Delete this logged message?")) {
                          await apiRequest("DELETE", `/api/messages/${msg.id}`);
                          queryClient.invalidateQueries({ queryKey: [`/api/conversations/${conversationId}/messages`] });
                        }
                      }}
                      className={cn(
                        "absolute top-1/2 -translate-y-1/2 p-1.5 rounded-full bg-destructive text-destructive-foreground opacity-0 group-hover/bubble:opacity-100 transition-opacity hover:scale-105 shadow",
                        isSelf ? "right-full mr-2" : "left-full ml-2"
                      )}
                      title="Delete log"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>

                  {/* Timestamp */}
                  <span className="text-[9px] text-muted-foreground/75 mt-1 px-2 select-none flex items-center gap-1 font-medium">
                    <Clock className="h-2.5 w-2.5" />
                    <span>{relativeTime}</span>
                  </span>
                </div>
              );
            })}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* Compose/Add Message Card */}
      <div className="border-t p-4 shrink-0 bg-card/60 backdrop-blur-md z-10">
        <form onSubmit={handleSubmit} className="max-w-4xl mx-auto space-y-3">
          {/* Metadata selectors (Sender, Timestamp) */}
          <div className="flex flex-wrap items-center gap-3 bg-muted/30 p-2 rounded-xl border border-muted/50">
            {/* Sender selection */}
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

            {/* Time selection */}
            <div className="flex items-center gap-1.5 shrink-0 ml-auto md:ml-0">
              <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
              <Input
                type="datetime-local"
                className="h-8 text-xs bg-background border-none w-44 shadow-none p-1 focus-visible:ring-0"
                value={sentAt}
                onChange={e => setSentAt(e.target.value)}
              />
            </div>
          </div>

          {/* Uploaded Images Thumbnails */}
          {uploadedPhotos.length > 0 && (
            <div className="flex flex-wrap gap-2 p-2 border rounded-xl bg-muted/20">
              {uploadedPhotos.map(photo => (
                <div key={photo.id} className="relative h-16 w-16 group rounded border overflow-hidden">
                  <img src={photo.location} alt="Thumbnail" className="h-full w-full object-cover" />
                  <button
                    type="button"
                    onClick={() => handleRemoveUploadedPhoto(photo.id)}
                    className="absolute top-1 right-1 p-0.5 rounded-full bg-destructive text-destructive-foreground opacity-90 hover:opacity-100 shadow"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Message input text area */}
          <div className="flex gap-2 items-end">
            <div className="relative flex-1">
              <Textarea
                placeholder="Log message content..."
                className="min-h-[44px] h-11 py-2.5 resize-none pr-10 rounded-2xl bg-muted/40 focus:bg-background border-muted/80 transition-all font-sans"
                value={content}
                onChange={e => setContent(e.target.value)}
                onKeyDown={e => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleSubmit(e);
                  }
                }}
              />

              {/* Photo Upload Button */}
              <div className="absolute right-2.5 bottom-2.5">
                <input
                  type="file"
                  id="message-file-input"
                  className="hidden"
                  accept="image/*"
                  onChange={handleImageUpload}
                  disabled={isUploading}
                />
                <label
                  htmlFor="message-file-input"
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
    </div>
  );
}
