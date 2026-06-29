import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  MessageSquare,
  Plus,
  Phone,
  Mail,
  Instagram,
  Search,
  MessageCircle,
  Clock,
  ArrowRight,
  ExternalLink,
  ChevronRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { NewConversationDialog } from "@/components/new-conversation-dialog";
import { formatDistanceToNow } from "date-fns";

const CHANNEL_FILTER_TABS = [
  { value: "all", label: "All Logs", icon: MessageSquare, color: "text-blue-500" },
  { value: "phone", label: "Phone (SMS)", icon: Phone, color: "text-emerald-500 bg-emerald-500/10" },
  { value: "email", label: "Email", icon: Mail, color: "text-indigo-500 bg-indigo-500/10" },
  { value: "instagram", label: "Instagram", icon: Instagram, color: "text-pink-500 bg-pink-500/10" },
  { value: "generic", label: "Generic", icon: MessageCircle, color: "text-amber-500 bg-amber-500/10" },
];

export default function MessagesListPage() {
  const [activeTab, setActiveTab] = useState("all");
  const [search, setSearch] = useState("");
  const [isNewDialogOpen, setIsNewDialogOpen] = useState(false);
  const [offset, setOffset] = useState(0);
  const LIMIT = 20;

  // Query paginated conversations
  const { data, isLoading } = useQuery<{ conversations: any[]; total: number }>({
    queryKey: [
      "/api/conversations/paginated",
      offset,
      activeTab,
      search,
    ],
    queryFn: async () => {
      const params = new URLSearchParams();
      params.append("offset", offset.toString());
      params.append("limit", LIMIT.toString());
      if (activeTab !== "all") params.append("channelType", activeTab);
      if (search.trim()) params.append("search", search.trim());
      
      const res = await fetch(`/api/conversations/paginated?${params.toString()}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to fetch conversations");
      return await res.json();
    },
  });

  const conversations = data?.conversations || [];
  const total = data?.total || 0;
  const hasMore = offset + LIMIT < total;

  const handleLoadMore = () => {
    setOffset(prev => prev + LIMIT);
  };

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
    <div className="flex flex-col h-full overflow-hidden bg-background">
      {/* Header */}
      <div className="border-b px-6 py-4 flex flex-col md:flex-row md:items-center justify-between gap-4 shrink-0 bg-card/40 backdrop-blur-md">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground flex items-center gap-2">
            <MessageSquare className="h-8 w-8 text-primary/80" />
            Communication Logs
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Log, track, and manage message threads, emails, and social media interactions.
          </p>
        </div>
        <Button onClick={() => setIsNewDialogOpen(true)} className="shadow-lg hover:shadow-primary/20 transition-all flex items-center gap-1">
          <Plus className="h-4 w-4" />
          Log Communication
        </Button>
      </div>

      {/* Filter and Search Bar */}
      <div className="px-6 py-3 border-b bg-card/20 shrink-0 flex flex-col md:flex-row md:items-center gap-3">
        {/* Channel selection */}
        <div className="flex flex-wrap gap-1.5 overflow-x-auto pb-1 md:pb-0 scrollbar-none">
          {CHANNEL_FILTER_TABS.map(tab => (
            <Button
              key={tab.value}
              variant={activeTab === tab.value ? "secondary" : "ghost"}
              size="sm"
              onClick={() => {
                setActiveTab(tab.value);
                setOffset(0);
              }}
              className="h-8 rounded-full text-xs font-medium"
            >
              <span>{tab.label}</span>
            </Button>
          ))}
        </div>

        {/* Search */}
        <div className="relative flex-1 md:max-w-xs ml-auto">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search threads..."
            className="pl-8 h-9 text-xs rounded-full bg-card/60 focus:bg-background transition-all"
            value={search}
            onChange={e => {
              setSearch(e.target.value);
              setOffset(0);
            }}
          />
        </div>
      </div>

      {/* Message list area */}
      <div className="flex-1 overflow-y-auto px-6 py-4 scrollbar-thin">
        {isLoading && offset === 0 ? (
          <div className="space-y-3">
            {[1, 2, 3, 4, 5].map(i => (
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
          <div className="flex flex-col items-center justify-center h-64 border-2 border-dashed border-muted/50 rounded-xl max-w-lg mx-auto mt-8 p-6 text-center bg-card/10">
            <MessageSquare className="h-12 w-12 text-muted-foreground/60 mb-3" />
            <h3 className="font-semibold text-lg">No message threads logged</h3>
            <p className="text-sm text-muted-foreground mt-1 max-w-xs">
              Log phone messages, Instagram DMs, or emails to begin tracking conversation history.
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setIsNewDialogOpen(true)}
              className="mt-4 rounded-full"
            >
              <Plus className="h-4 w-4 mr-1" />
              Create First Log
            </Button>
          </div>
        ) : (
          <div className="space-y-3 max-w-5xl mx-auto">
            {conversations.map((conv: any) => {
              const participantsText = formatConversationParticipants(conv.participants);
              const hasExternalLink = !!conv.externalUrl;
              const dateToFormat = conv.lastMessageAt || conv.createdAt;
              const relativeTime = dateToFormat
                ? formatDistanceToNow(new Date(dateToFormat), { addSuffix: true })
                : "";

              return (
                <Link key={conv.id} href={`/messages/${conv.id}`}>
                  <Card className="hover:border-primary/40 hover:bg-primary/5 transition-all duration-200 cursor-pointer shadow-sm border border-muted/40 group overflow-hidden">
                    <CardContent className="p-4 flex items-center gap-4">
                      {/* Avatar Icon */}
                      <div className={`p-2.5 rounded-full border shrink-0 ${getChannelColor(conv.channelType)}`}>
                        {getChannelIcon(conv.channelType)}
                      </div>

                      {/* Info */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-foreground group-hover:text-primary transition-colors text-sm truncate">
                            {conv.title || participantsText}
                          </span>
                          <Badge variant="outline" className="text-[10px] py-0 px-1.5 font-normal uppercase tracking-wider scale-90 select-none">
                            {conv.channelType}
                          </Badge>
                          {hasExternalLink && (
                            <a
                              href={conv.externalUrl}
                              target="_blank"
                              rel="noreferrer"
                              onClick={(e) => e.stopPropagation()}
                              className="text-muted-foreground hover:text-primary transition-colors inline-flex items-center"
                              title="View original link"
                            >
                              <ExternalLink className="h-3.5 w-3.5" />
                            </a>
                          )}
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
                          <div className="flex items-center gap-1 text-[10px] text-muted-foreground font-medium">
                            <Clock className="h-3 w-3" />
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

            {hasMore && (
              <div className="flex justify-center mt-6">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleLoadMore}
                  className="rounded-full px-6"
                >
                  Load More
                </Button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* New conversation dialog */}
      <NewConversationDialog open={isNewDialogOpen} onOpenChange={setIsNewDialogOpen} />
    </div>
  );
}
