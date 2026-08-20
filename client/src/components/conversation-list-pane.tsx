import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  MessageSquare,
  Plus,
  Phone,
  Mail,
  Instagram,
  Search,
  MessageCircle,
  Upload,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { formatDistanceToNow } from "date-fns";
import { cn } from "@/lib/utils";
/** Preview text for a conversation's latest message, with media fallbacks */
function lastMessagePreview(lastMessage: any): string | null {
  if (!lastMessage) return null;
  const text = lastMessage.content?.replace(/<[^>]*>/g, "").trim();
  if (text) return text;
  if (lastMessage.imageUuids?.length > 0) return "📷 Photo";
  const attachments = lastMessage.attachments || [];
  if (attachments.some((a: any) => a.type === "video")) return "🎥 Video";
  if (attachments.some((a: any) => a.type === "audio")) return "🎤 Voice message";
  return null;
}

const CHANNEL_TABS = [
  { value: "all", label: "All", icon: MessageSquare },
  { value: "instagram", label: "Instagram", icon: Instagram },
  { value: "phone", label: "SMS", icon: Phone },
  { value: "email", label: "Email", icon: Mail },
  { value: "generic", label: "Other", icon: MessageCircle },
];

const PAGE_SIZE = 25;

function conversationDisplayName(conv: any, isSubject?: (p: any) => boolean): string {
  // Perspective mode (profile pages): name the conversation after who the
  // subject is talking TO — every participant except the subject themself. The
  // PRM-owner participant has no person/account reference, so fall back to the
  // owner display name captured at import time.
  if (isSubject) {
    const names = (conv.participants || [])
      .filter((p: any) => !isSubject(p))
      .map((p: any) => {
        if (p.person) return `${p.person.firstName} ${p.person.lastName}`;
        if (p.socialAccount) return p.socialAccount.username;
        return conv.metadata?.ownerName || "You";
      })
      .filter(Boolean);
    if (names.length > 0) return Array.from(new Set(names)).join(", ");
    return conv.metadata?.ownerName || "You";
  }

  if (conv.title) return conv.title;
  const names = (conv.participants || [])
    .map((p: any) => {
      if (p.person) return `${p.person.firstName} ${p.person.lastName}`;
      if (p.socialAccount) return p.socialAccount.username;
      return null;
    })
    .filter(Boolean);
  return names.join(", ") || "Conversation";
}

function channelIconFor(type: string) {
  switch (type) {
    case "phone":
      return <Phone className="h-3 w-3" />;
    case "email":
      return <Mail className="h-3 w-3" />;
    case "instagram":
      return <Instagram className="h-3 w-3" />;
    default:
      return <MessageCircle className="h-3 w-3" />;
  }
}

interface ConversationListPaneProps {
  selectedId: string | null;
  onSelect: (conversationId: string) => void;
  onNewConversation: () => void;
  /** When omitted, the import action is hidden */
  onImport?: () => void;
  /** Scope the list to one social account's conversations (profile pages) */
  socialAccountId?: string;
  /** Scope the list to one person's conversations, incl. their linked accounts */
  personId?: string;
  /**
   * Render from the scoped subject's point of view: rows are named after their
   * counterparts and "You:" means the subject. Off for the me-profile.
   */
  perspective?: boolean;
  /** Account ids that also count as the subject (a person's linked accounts) */
  perspectiveAccountIds?: string[];
  /** Pane heading; defaults to "Messages" */
  title?: string;
}

export function ConversationListPane({
  selectedId,
  onSelect,
  onNewConversation,
  onImport,
  socialAccountId,
  personId,
  perspective,
  perspectiveAccountIds,
  title = "Messages",
}: ConversationListPaneProps) {
  const [activeTab, setActiveTab] = useState("all");
  const [search, setSearch] = useState("");
  const [limit, setLimit] = useState(PAGE_SIZE);

  const { data, isLoading, isFetching } = useQuery<{ conversations: any[]; total: number }>({
    queryKey: ["/api/conversations/paginated", 0, limit, activeTab, search, socialAccountId ?? null, personId ?? null],
    queryFn: async () => {
      const params = new URLSearchParams();
      params.append("offset", "0");
      params.append("limit", String(limit));
      if (activeTab !== "all") params.append("channelType", activeTab);
      if (search.trim()) params.append("search", search.trim());
      if (socialAccountId) params.append("socialAccountId", socialAccountId);
      if (personId) params.append("personId", personId);
      const res = await fetch(`/api/conversations/paginated?${params.toString()}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to fetch conversations");
      return await res.json();
    },
    placeholderData: (prev) => prev,
  });

  const conversations = data?.conversations || [];
  const total = data?.total || 0;
  const hasMore = conversations.length < total;

  const isScoped = Boolean(socialAccountId || personId);
  const subjectAccountIds = new Set([
    ...(perspectiveAccountIds ?? []),
    ...(socialAccountId ? [socialAccountId] : []),
  ]);
  const isSubjectParticipant = (p: any) =>
    (personId != null && p.personId === personId) ||
    (p.socialAccountId != null && subjectAccountIds.has(p.socialAccountId));

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="px-4 pt-4 pb-2 shrink-0">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-bold text-lg">{title}</h2>
          <div className="flex items-center gap-1">
            {onImport && (
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 rounded-full"
                onClick={onImport}
                title="Import Instagram backup"
              >
                <Upload className="h-4 w-4" />
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 rounded-full"
              onClick={onNewConversation}
              title="New conversation log"
            >
              <Plus className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Search */}
        <div className="relative mb-2">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Search conversations..."
            className="pl-9 h-9 rounded-full bg-muted/40 border-none text-sm"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setLimit(PAGE_SIZE);
            }}
          />
        </div>

        {/* Channel filter (hidden when scoped to a single profile) */}
        <div className={cn("flex gap-1 overflow-x-auto scrollbar-none pb-1", isScoped && "hidden")}>
          {CHANNEL_TABS.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.value;
            return (
              <button
                key={tab.value}
                onClick={() => {
                  setActiveTab(tab.value);
                  setLimit(PAGE_SIZE);
                }}
                className={cn(
                  "flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium transition-colors shrink-0",
                  isActive
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted/40 text-muted-foreground hover:bg-muted"
                )}
              >
                <Icon className="h-3 w-3" />
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Conversation rows */}
      <div className="flex-1 overflow-y-auto scrollbar-thin">
        {isLoading ? (
          <div className="space-y-1 px-2 py-2">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="flex items-center gap-3 p-3">
                <Skeleton className="h-12 w-12 rounded-full shrink-0" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-3.5 w-2/5" />
                  <Skeleton className="h-3 w-4/5" />
                </div>
              </div>
            ))}
          </div>
        ) : conversations.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 px-6 text-center text-muted-foreground">
            <MessageCircle className="h-8 w-8 mb-2 opacity-40" />
            <p className="text-sm">No conversations yet</p>
            <div className="flex gap-2 mt-4">
              {onImport && (
                <Button variant="outline" size="sm" className="rounded-full text-xs" onClick={onImport}>
                  <Upload className="h-3 w-3 mr-1" />
                  Import Backup
                </Button>
              )}
              <Button variant="outline" size="sm" className="rounded-full text-xs" onClick={onNewConversation}>
                <Plus className="h-3 w-3 mr-1" />
                New Log
              </Button>
            </div>
          </div>
        ) : (
          <div className="px-2 py-1">
            {conversations.map((conv: any) => {
              const name = conversationDisplayName(conv, perspective ? isSubjectParticipant : undefined);
              const preview = lastMessagePreview(conv.lastMessage);
              // "You:" refers to whoever's viewpoint this list renders — the
              // scoped subject in perspective mode, the PRM user otherwise
              const isFromSelf = perspective
                ? conv.lastMessage &&
                  ((conv.lastMessage.senderSocialAccountId != null &&
                    subjectAccountIds.has(conv.lastMessage.senderSocialAccountId)) ||
                    (personId != null && conv.lastMessage.senderPersonId === personId))
                : conv.lastMessage &&
                  conv.lastMessage.senderPersonId === null &&
                  conv.lastMessage.senderSocialAccountId === null;
              const dateToFormat = conv.lastMessageAt || conv.createdAt;
              const relativeTime = dateToFormat
                ? formatDistanceToNow(new Date(dateToFormat), { addSuffix: false })
                : "";
              const initials = name
                .split(/\s+/)
                .map((w: string) => w[0])
                .filter(Boolean)
                .slice(0, 2)
                .join("")
                .toUpperCase();

              return (
                <button
                  key={conv.id}
                  onClick={() => onSelect(conv.id)}
                  className={cn(
                    "w-full flex items-center gap-3 p-3 rounded-xl text-left transition-colors",
                    selectedId === conv.id ? "bg-primary/10" : "hover:bg-muted/50"
                  )}
                >
                  <Avatar className="h-12 w-12 shrink-0">
                    <AvatarFallback className="bg-muted text-foreground/70 text-sm font-semibold">
                      {initials || "?"}
                    </AvatarFallback>
                  </Avatar>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="font-semibold text-sm truncate">{name}</span>
                      <span className="text-muted-foreground/70 shrink-0">
                        {channelIconFor(conv.channelType)}
                      </span>
                    </div>
                    <div className="text-xs text-muted-foreground truncate mt-0.5">
                      {preview ? (
                        <>
                          {isFromSelf && <span>You: </span>}
                          {preview}
                        </>
                      ) : (
                        <span className="opacity-60">No messages yet</span>
                      )}
                      {relativeTime && <span className="opacity-60"> · {relativeTime}</span>}
                    </div>
                  </div>
                </button>
              );
            })}

            {hasMore && (
              <div className="flex justify-center py-3">
                <Button
                  variant="ghost"
                  size="sm"
                  className="rounded-full text-xs"
                  disabled={isFetching}
                  onClick={() => setLimit((l) => l + PAGE_SIZE)}
                >
                  {isFetching ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
                  Show more
                </Button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
