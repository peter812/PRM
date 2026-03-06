import { useRef, useCallback, useEffect } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { format, isSameDay } from "date-fns";
import { StickyNote, Users, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { FlowItem, FlowResponse, Note, Interaction } from "@shared/schema";

interface PersonFlowTabProps {
  personId: string;
  onAddNote: () => void;
  onAddInteraction: () => void;
  onSelectNote: (note: Note) => void;
  onSelectInteraction: (interaction: Interaction) => void;
}

export function PersonFlowTab({
  personId,
  onAddNote,
  onAddInteraction,
  onSelectNote,
  onSelectInteraction,
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
          <StickyNote className="h-8 w-8 text-muted-foreground" />
        </div>
        <h3 className="text-lg font-medium mb-2">No activity yet</h3>
        <p className="text-muted-foreground mb-6 max-w-sm">
          Add notes or interactions to see them here.
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
        <CenteredItem item={item} onClick={() => handleItemClick(item)} />
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
