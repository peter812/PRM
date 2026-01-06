import { useRef, useCallback, useEffect, useMemo } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { format, isSameDay } from "date-fns";
import { MessageSquare, StickyNote, Users, Loader2, Mail, Phone, AtSign } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { FlowItem, FlowResponse, Note, Interaction, Message } from "@shared/schema";

const typeIcons = {
  email: Mail,
  phone: Phone,
  social: AtSign,
};

const typeColors = {
  email: "#3b82f6",
  phone: "#22c55e",
  social: "#a855f7",
};

interface PersonFlowTabProps {
  personId: string;
  onAddNote: () => void;
  onAddInteraction: () => void;
  onAddMessage: () => void;
  onSelectNote: (note: Note) => void;
  onSelectInteraction: (interaction: Interaction) => void;
  onSelectMessage: (message: Message) => void;
}

export function PersonFlowTab({
  personId,
  onAddNote,
  onAddInteraction,
  onAddMessage,
  onSelectNote,
  onSelectInteraction,
  onSelectMessage,
}: PersonFlowTabProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading,
  } = useInfiniteQuery<FlowResponse>({
    queryKey: ["/api/people", personId, "flow"],
    queryFn: async ({ pageParam }) => {
      const params = new URLSearchParams({ limit: "20" });
      if (pageParam) {
        params.set("cursor", pageParam as string);
      }
      const res = await fetch(`/api/people/${personId}/flow?${params}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to fetch flow data");
      return res.json();
    },
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    initialPageParam: undefined as string | undefined,
  });

  const handleScroll = useCallback(() => {
    if (!scrollRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
    if (scrollHeight - scrollTop <= clientHeight * 1.5 && hasNextPage && !isFetchingNextPage) {
      fetchNextPage();
    }
  }, [fetchNextPage, hasNextPage, isFetchingNextPage]);

  useEffect(() => {
    const scrollEl = scrollRef.current;
    if (scrollEl) {
      scrollEl.addEventListener("scroll", handleScroll);
      return () => scrollEl.removeEventListener("scroll", handleScroll);
    }
  }, [handleScroll]);

  const allItems = data?.pages.flatMap((page) => page.items) || [];
  
  // Get person identifiers and name mapping from the first page
  const personIdentifiers = useMemo(() => 
    data?.pages[0]?.personIdentifiers || [], 
    [data?.pages]
  );
  const identifierToName = useMemo(() => 
    data?.pages[0]?.identifierToName || {}, 
    [data?.pages]
  );

  const handleItemClick = (item: FlowItem) => {
    if (item.type === "note") {
      onSelectNote({
        id: item.id,
        personId,
        content: item.content,
        imageUrl: item.imageUrl || null,
        createdAt: new Date(item.date),
      });
    } else if (item.type === "interaction") {
      onSelectInteraction({
        id: item.id,
        peopleIds: item.peopleIds || [],
        groupIds: item.groupIds || [],
        typeId: item.interactionType?.id || null,
        title: item.title || null,
        date: new Date(item.date),
        description: item.description || null,
        imageUrl: item.imageUrl || null,
        createdAt: new Date(item.date),
      });
    } else if (item.type === "message") {
      onSelectMessage({
        id: item.id,
        uploadTimestamp: new Date(item.date),
        sentTimestamp: new Date(item.date),
        type: item.messageType || "email",
        sender: item.sender || "",
        receivers: item.receivers || [],
        content: item.content || null,
        imageUrls: item.imageUrls || [],
        isOrphan: item.isOrphan || false,
      });
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (allItems.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
        <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-4">
          <MessageSquare className="h-8 w-8 text-muted-foreground" />
        </div>
        <h3 className="text-lg font-medium mb-2">No activity yet</h3>
        <p className="text-muted-foreground mb-6 max-w-sm">
          Add notes, interactions, or messages to see them here.
        </p>
        <div className="flex gap-2 flex-wrap justify-center">
          <Button onClick={onAddNote} variant="outline" data-testid="button-add-first-note">
            <StickyNote className="h-4 w-4" />
            Add Note
          </Button>
          <Button onClick={onAddInteraction} variant="outline" data-testid="button-add-first-interaction">
            <Users className="h-4 w-4" />
            Add Interaction
          </Button>
          <Button onClick={onAddMessage} data-testid="button-add-first-message">
            <MessageSquare className="h-4 w-4" />
            Add Message
          </Button>
        </div>
      </div>
    );
  }

  const renderDateSeparator = (date: Date) => (
    <div className="flex items-center justify-center my-4">
      <div className="px-3 py-1 bg-muted rounded-full text-xs text-muted-foreground">
        {format(date, "MMM d, yyyy")}
      </div>
    </div>
  );

  const renderFlowItem = (item: FlowItem, prevItem?: FlowItem) => {
    const itemDate = new Date(item.date);
    const prevDate = prevItem ? new Date(prevItem.date) : null;
    const showDateSeparator = !prevDate || !isSameDay(itemDate, prevDate);

    return (
      <div key={item.id}>
        {showDateSeparator && renderDateSeparator(itemDate)}
        {item.type === "message" ? (
          <MessageBubble 
            item={item} 
            onClick={() => handleItemClick(item)} 
            personIdentifiers={personIdentifiers}
            identifierToName={identifierToName}
          />
        ) : (
          <CenteredItem item={item} onClick={() => handleItemClick(item)} />
        )}
      </div>
    );
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between p-4 border-b gap-2">
        <h3 className="font-medium">Activity Flow</h3>
        <div className="flex gap-1">
          <Button size="sm" variant="ghost" onClick={onAddNote} data-testid="button-add-note">
            <StickyNote className="h-4 w-4" />
          </Button>
          <Button size="sm" variant="ghost" onClick={onAddInteraction} data-testid="button-add-interaction">
            <Users className="h-4 w-4" />
          </Button>
          <Button size="sm" onClick={onAddMessage} data-testid="button-add-message">
            <MessageSquare className="h-4 w-4" />
            Message
          </Button>
        </div>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-auto p-4">
        {allItems.map((item, index) =>
          renderFlowItem(item, index > 0 ? allItems[index - 1] : undefined)
        )}
        {isFetchingNextPage && (
          <div className="flex justify-center py-4">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        )}
      </div>
    </div>
  );
}

function MessageBubble({ 
  item, 
  onClick, 
  personIdentifiers,
  identifierToName 
}: { 
  item: FlowItem; 
  onClick: () => void;
  personIdentifiers: string[];
  identifierToName: Record<string, string>;
}) {
  const msgType = item.messageType || "email";
  const TypeIcon = typeIcons[msgType as keyof typeof typeIcons] || Mail;
  const typeColor = typeColors[msgType as keyof typeof typeColors] || "#6b7280";

  // Determine if message is sent BY the person (sender matches person's identifier)
  const isSentByPerson = item.sender && personIdentifiers.includes(item.sender);
  
  // Get display name for sender - use name from mapping or fall back to identifier
  const senderDisplay = item.sender 
    ? (identifierToName[item.sender] || item.sender)
    : "Unknown";

  return (
    <div className={`flex mb-3 ${isSentByPerson ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[80%] p-3 rounded-lg cursor-pointer hover-elevate transition-all ${
          isSentByPerson ? 'rounded-br-sm' : 'rounded-bl-sm'
        }`}
        style={{
          backgroundColor: typeColor + "20",
          [isSentByPerson ? 'borderRight' : 'borderLeft']: `3px solid ${typeColor}`,
        }}
        onClick={onClick}
        data-testid={`flow-message-${item.id}`}
      >
        <div className="flex items-center gap-2 mb-1 flex-wrap">
          <TypeIcon 
            className="h-3 w-3" 
            style={{ color: typeColor }}
          />
          <span className="text-xs font-medium">
            {senderDisplay}
          </span>
          <span className="text-xs text-muted-foreground">
            {format(new Date(item.date), "h:mm a")}
          </span>
        </div>
        {item.content && (
          <p className="text-sm whitespace-pre-wrap break-words">{item.content}</p>
        )}
        {item.imageUrls && item.imageUrls.length > 0 && (
          <div className="flex gap-1 mt-2">
            {item.imageUrls.slice(0, 2).map((url, idx) => (
              <img
                key={idx}
                src={url}
                alt={`Attachment ${idx + 1}`}
                className="h-10 w-10 object-cover rounded"
              />
            ))}
            {item.imageUrls.length > 2 && (
              <div className="h-10 w-10 rounded bg-muted flex items-center justify-center text-xs text-muted-foreground">
                +{item.imageUrls.length - 2}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function CenteredItem({ item, onClick }: { item: FlowItem; onClick: () => void }) {
  const isNote = item.type === "note";
  const typeColor = item.interactionType?.color || "#6b7280";

  return (
    <div className="flex justify-center mb-3">
      <div
        className="max-w-[85%] p-3 rounded-lg cursor-pointer hover-elevate transition-all bg-muted/50 border"
        onClick={onClick}
        data-testid={`flow-${item.type}-${item.id}`}
      >
        <div className="flex items-center gap-2 mb-1">
          {isNote ? (
            <StickyNote className="h-3 w-3 text-muted-foreground" />
          ) : (
            <Users className="h-3 w-3 text-muted-foreground" />
          )}
          {isNote ? (
            <span className="text-xs font-medium text-muted-foreground">Note</span>
          ) : (
            <span
              className="text-xs font-medium px-1.5 py-0.5 rounded"
              style={{ backgroundColor: typeColor, color: "white" }}
            >
              {item.interactionType?.name || "Interaction"}
            </span>
          )}
          <span className="text-xs text-muted-foreground">
            {format(new Date(item.date), "h:mm a")}
          </span>
        </div>
        {item.title && (
          <p className="text-sm font-medium mb-1">{item.title}</p>
        )}
        <p className="text-sm whitespace-pre-wrap break-words">{item.content}</p>
        {item.imageUrl && (
          <img
            src={item.imageUrl}
            alt="Attachment"
            className="mt-2 rounded max-h-32 object-cover"
          />
        )}
      </div>
    </div>
  );
}
