import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { MessageSquare, Plus, Phone, Mail, Instagram, MessageCircle, Clock, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { NewConversationDialog } from "@/components/new-conversation-dialog";
import { formatDistanceToNow } from "date-fns";

interface MessagesTabProps {
  personId?: string;
  socialAccountId?: string;
}

export function MessagesTab({ personId, socialAccountId }: MessagesTabProps) {
  const [isNewDialogOpen, setIsNewDialogOpen] = useState(false);

  // Fetch conversations
  const { data, isLoading } = useQuery<{ conversations: any[]; total: number }>({
    queryKey: [
      personId
        ? `/api/people/${personId}/conversations`
        : `/api/social-accounts/${socialAccountId}/conversations`,
    ],
    queryFn: async () => {
      const url = personId
        ? `/api/people/${personId}/conversations`
        : `/api/social-accounts/${socialAccountId}/conversations`;
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch conversations");
      return await res.json();
    },
  });

  const conversations = data?.conversations || [];

  const getChannelIcon = (type: string) => {
    switch (type) {
      case "phone":
        return <Phone className="h-4 w-4 text-emerald-500" />;
      case "email":
        return <Mail className="h-4 w-4 text-indigo-500" />;
      case "instagram":
        return <Instagram className="h-4 w-4 text-pink-500" />;
      default:
        return <MessageCircle className="h-4 w-4 text-amber-500" />;
    }
  };

  const getChannelColor = (type: string) => {
    switch (type) {
      case "phone":
        return "border-emerald-500/20 bg-emerald-500/5 text-emerald-500 dark:bg-emerald-500/10";
      case "email":
        return "border-indigo-500/20 bg-indigo-500/5 text-indigo-500 dark:bg-indigo-500/10";
      case "instagram":
        return "border-pink-500/20 bg-pink-500/5 text-pink-500 dark:bg-pink-500/10";
      default:
        return "border-amber-500/20 bg-amber-500/5 text-amber-500 dark:bg-amber-500/10";
    }
  };

  const formatConversationParticipants = (participants: any[]) => {
    if (participants.length === 0) return "No participants";
    return participants
      .map(p => {
        if (p.person) return `${p.person.firstName} ${p.person.lastName}`;
        if (p.socialAccount) return p.socialAccount.username;
        return "Unknown";
      })
      .join(", ");
  };

  return (
    <div className="space-y-4">
      {/* Tab Header Action */}
      <div className="flex items-center justify-between">
        <h3 className="text-base font-semibold flex items-center gap-2 text-foreground">
          <MessageSquare className="h-4 w-4 text-muted-foreground" />
          Logged Conversations
        </h3>
        <Button
          onClick={() => setIsNewDialogOpen(true)}
          size="sm"
          className="rounded-full shadow-sm hover:shadow-primary/10 transition-all flex items-center gap-1"
        >
          <Plus className="h-3.5 w-3.5" />
          Log Conversation
        </Button>
      </div>

      {/* List */}
      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map(i => (
            <Card key={i} className="border border-muted/40 opacity-70">
              <CardContent className="p-4 flex items-center gap-4">
                <Skeleton className="h-10 w-10 rounded-full" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-1/4" />
                  <Skeleton className="h-3 w-1/2" />
                </div>
                <Skeleton className="h-4 w-16" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : conversations.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 border-2 border-dashed border-muted/50 rounded-xl bg-card/5 text-center">
          <MessageSquare className="h-8 w-8 text-muted-foreground/60 mb-2 opacity-50" />
          <h4 className="font-medium text-sm text-foreground/80">No conversation history logged</h4>
          <p className="text-xs text-muted-foreground mt-1 max-w-[240px] mx-auto">
            Log messages, DMs, or emails with this contact to track relationship timeline.
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setIsNewDialogOpen(true)}
            className="mt-3 rounded-full text-xs"
          >
            <Plus className="h-3.5 w-3.5 mr-1" />
            Log Conversation
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          {conversations.map((conv: any) => {
            const participantsText = formatConversationParticipants(conv.participants);
            const dateToFormat = conv.lastMessageAt || conv.createdAt;
            const relativeTime = dateToFormat
              ? formatDistanceToNow(new Date(dateToFormat), { addSuffix: true })
              : "";

            return (
              <Link key={conv.id} href={`/messages/${conv.id}`}>
                <Card className="hover:border-primary/40 hover:bg-primary/5 transition-all duration-200 cursor-pointer shadow-sm border border-muted/45 group overflow-hidden">
                  <CardContent className="p-4 flex items-center gap-4">
                    {/* Avatar Icon */}
                    <div className={`p-2 rounded-full border shrink-0 ${getChannelColor(conv.channelType)}`}>
                      {getChannelIcon(conv.channelType)}
                    </div>

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-foreground group-hover:text-primary transition-colors text-sm truncate">
                          {conv.title || participantsText}
                        </span>
                        <Badge variant="outline" className="text-[10px] py-0 px-1 text-normal select-none">
                          {conv.channelType}
                        </Badge>
                      </div>
                      <div className="text-xs text-muted-foreground truncate mt-0.5">
                        {conv.title ? (
                          <span className="font-medium text-foreground/75">
                            {participantsText}
                          </span>
                        ) : null}
                        {conv.title && participantsText ? " · " : ""}
                        {conv.lastMessage ? (
                          <span className="italic">
                            "{conv.lastMessage.content?.replace(/<[^>]*>/g, "")}"
                          </span>
                        ) : (
                          <span className="text-muted-foreground/60">No messages logged yet</span>
                        )}
                      </div>
                    </div>

                    {/* Right Meta info */}
                    <div className="flex flex-col items-end shrink-0 gap-2">
                      {relativeTime && (
                        <div className="flex items-center gap-1 text-[9px] text-muted-foreground font-medium">
                          <Clock className="h-2.5 w-2.5" />
                          <span>{relativeTime}</span>
                        </div>
                      )}
                      <ChevronRight className="h-4 w-4 text-muted-foreground/70 group-hover:translate-x-1 transition-transform" />
                    </div>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      )}

      {/* New conversation dialog */}
      <NewConversationDialog
        open={isNewDialogOpen}
        onOpenChange={setIsNewDialogOpen}
        initialPersonId={personId}
        initialSocialAccountId={socialAccountId}
      />
    </div>
  );
}
