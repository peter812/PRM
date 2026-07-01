import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import {
  GripVertical,
  ListTodo,
  Users,
  AtSign,
  ImageIcon,
  CalendarDays,
  Pencil,
  Check,
  Link2,
  BookOpen,
  Plus,
  MessageSquare,
  Scan,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { getInitials, cn } from "@/lib/utils";
import { imageDetailHref } from "@/lib/image-link";
import type {
  Person,
  PersonWithRelations,
  SocialAccountWithCurrentProfile,
  Photo,
} from "@shared/schema";

type CardId =
  | "things-to-do"
  | "quick-chat"
  | "recent-people"
  | "recent-social"
  | "recent-photos"
  | "recent-events";

const DEFAULT_ORDER: CardId[] = [
  "things-to-do",
  "quick-chat",
  "recent-people",
  "recent-social",
  "recent-photos",
  "recent-events",
];

const LAYOUT_STORAGE_KEY = "home_card_order_v1";

function loadOrder(): CardId[] {
  try {
    const raw = localStorage.getItem(LAYOUT_STORAGE_KEY);
    if (!raw) return DEFAULT_ORDER;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return DEFAULT_ORDER;
    const valid = parsed.filter((id): id is CardId =>
      DEFAULT_ORDER.includes(id as CardId),
    );
    // Append any new defaults that weren't in storage so new cards still appear
    for (const id of DEFAULT_ORDER) {
      if (!valid.includes(id)) valid.push(id);
    }
    return valid;
  } catch {
    return DEFAULT_ORDER;
  }
}

function saveOrder(order: CardId[]) {
  try {
    localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(order));
  } catch {
    // ignore
  }
}

function getGreeting(date: Date, name?: string): string {
  const hour = date.getHours();
  const trimmedName = (name || "").trim();
  const suffix = trimmedName ? ` ${trimmedName}` : "";
  if (hour >= 0 && hour < 5) return `Late night?${suffix}`;
  if (hour >= 5 && hour < 12) return `Morning${suffix}`;
  if (hour >= 12 && hour < 17) return `Greetings${suffix}`;
  if (hour >= 17 && hour < 22) return `Evening${suffix}`;
  return `Late night?${suffix}`;
}

function useColumnCount(): number {
  const compute = () => {
    if (typeof window === "undefined") return 3;
    const w = window.innerWidth;
    if (w < 640) return 1; // mobile
    if (w < 1024) return 2; // small tablet
    if (w < 1280) return 3; // tablet/large tablet
    if (w < 1536) return 4; // desktop
    return 5; // wide desktop
  };
  const [cols, setCols] = useState<number>(compute);
  useEffect(() => {
    const onResize = () => setCols(compute());
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return cols;
}

function distributeIntoColumns<T>(items: T[], cols: number): T[][] {
  const columns: T[][] = Array.from({ length: cols }, () => []);
  items.forEach((item, idx) => {
    columns[idx % cols].push(item);
  });
  return columns;
}

interface BoardCardProps {
  id: CardId;
  title: string;
  icon: React.ReactNode;
  editMode: boolean;
  onDragStart: (id: CardId) => void;
  onDragOverCard: (id: CardId) => void;
  onDropOnCard: (id: CardId) => void;
  isDraggingThis: boolean;
  isDropTarget: boolean;
  children: React.ReactNode;
}

function BoardCard({
  id,
  title,
  icon,
  editMode,
  onDragStart,
  onDragOverCard,
  onDropOnCard,
  isDraggingThis,
  isDropTarget,
  children,
}: BoardCardProps) {
  return (
    <Card
      data-testid={`home-card-${id}`}
      draggable={editMode}
      onDragStart={(e) => {
        if (!editMode) return;
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", id);
        onDragStart(id);
      }}
      onDragOver={(e) => {
        if (!editMode) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        onDragOverCard(id);
      }}
      onDrop={(e) => {
        if (!editMode) return;
        e.preventDefault();
        onDropOnCard(id);
      }}
      className={cn(
        "transition-all",
        editMode && "cursor-grab active:cursor-grabbing",
        isDraggingThis && "opacity-50",
        isDropTarget && "ring-2 ring-primary",
      )}
    >
      <CardHeader className="flex-row items-center justify-between gap-2 space-y-0">
        <CardTitle className="flex items-center gap-2 text-base">
          {icon}
          <span>{title}</span>
        </CardTitle>
        {editMode && (
          <div
            className="text-muted-foreground"
            aria-hidden
            data-testid={`home-card-handle-${id}`}
          >
            <GripVertical className="h-5 w-5" />
          </div>
        )}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function RecentPeopleContent() {
  const { data, isLoading } = useQuery<Person[]>({
    queryKey: ["/api/people/paginated", { sortBy: "added", limit: 5 }],
    queryFn: async () => {
      const res = await fetch(
        "/api/people/paginated?sortBy=added&limit=5&offset=0",
      );
      if (!res.ok) throw new Error("Failed to load people");
      return res.json();
    },
  });

  if (isLoading) {
    return (
      <ul className="space-y-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <li key={i} className="flex items-center gap-3 p-1.5">
            <Skeleton className="h-8 w-8 rounded-full" />
            <div className="flex-1 space-y-1">
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-3 w-1/3" />
            </div>
          </li>
        ))}
      </ul>
    );
  }
  if (!data || data.length === 0) {
    return (
      <div className="text-sm text-muted-foreground">No people yet.</div>
    );
  }
  return (
    <ul className="space-y-2">
      {data.map((p) => (
        <li key={p.id}>
          <Link
            href={`/person/${p.id}`}
            className="flex items-center gap-3 rounded-md p-1.5 hover-elevate active-elevate-2"
            data-testid={`home-recent-person-${p.id}`}
          >
            <Avatar className="h-8 w-8">
              {p.imageUrl && <AvatarImage src={p.imageUrl} />}
              <AvatarFallback className="text-xs">
                {getInitials(`${p.firstName} ${p.lastName}`)}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">
                {p.firstName} {p.lastName}
              </div>
              {p.createdAt && (
                <div className="truncate text-xs text-muted-foreground">
                  Added {new Date(p.createdAt).toLocaleDateString()}
                </div>
              )}
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function RecentSocialContent() {
  const { data, isLoading } = useQuery<SocialAccountWithCurrentProfile[]>({
    queryKey: ["/api/social-accounts"],
  });

  const recent = useMemo(() => {
    if (!data) return [];
    return [...data]
      .sort((a, b) => {
        const aT = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const bT = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return bT - aT;
      })
      .slice(0, 5);
  }, [data]);

  if (isLoading) {
    return (
      <ul className="space-y-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <li key={i} className="flex items-center gap-3 p-1.5">
            <Skeleton className="h-8 w-8 rounded-full" />
            <div className="flex-1 space-y-1">
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="h-3 w-1/3" />
            </div>
          </li>
        ))}
      </ul>
    );
  }
  if (recent.length === 0) {
    return (
      <div className="text-sm text-muted-foreground">
        No social accounts yet.
      </div>
    );
  }
  return (
    <ul className="space-y-2">
      {recent.map((acc) => {
        const display =
          acc.currentProfile?.nickname || acc.username || "Unknown";
        return (
          <li key={acc.id}>
            <Link
              href={`/social-accounts/${acc.id}`}
              className="flex items-center gap-3 rounded-md p-1.5 hover-elevate active-elevate-2"
              data-testid={`home-recent-social-${acc.id}`}
            >
              <Avatar className="h-8 w-8">
                {acc.currentProfile?.imageUrl && (
                  <AvatarImage src={acc.currentProfile.imageUrl} />
                )}
                <AvatarFallback className="text-xs">
                  <AtSign className="h-4 w-4" />
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{display}</div>
                <div className="truncate text-xs text-muted-foreground">
                  @{acc.username}
                </div>
              </div>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function RecentPhotosContent() {
  const { data, isLoading, isError } = useQuery<{
    items?: Photo[];
  }>({
    queryKey: ["/api/photos", { limit: 6, excludeSubImages: true }],
    queryFn: async () => {
      const res = await fetch("/api/photos?limit=6&excludeSubImages=true");
      if (!res.ok) throw new Error("Photos unavailable");
      return res.json();
    },
    retry: false,
  });

  if (isLoading) {
    return (
      <div className="grid grid-cols-3 gap-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="aspect-square rounded-md w-full" />
        ))}
      </div>
    );
  }
  if (isError) {
    return (
      <div className="text-sm text-muted-foreground">
        Photos unavailable. Please refresh.
      </div>
    );
  }
  const images = data?.items || [];
  if (images.length === 0) {
    return (
      <div className="text-sm text-muted-foreground">No photos yet.</div>
    );
  }
  return (
    <div className="grid grid-cols-3 gap-2">
      {images.slice(0, 6).map((img) => {
        const src = img.location;
        return (
          <Link
            key={img.id}
            href={imageDetailHref(img.id, "/home")}
            className="relative aspect-square overflow-hidden rounded-md bg-muted hover-elevate"
            data-testid={`home-recent-photo-${img.id}`}
          >
            {src ? (
              <img
                src={src}
                alt=""
                className="h-full w-full object-cover"
                loading="lazy"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-muted-foreground">
                <ImageIcon className="h-5 w-5" />
              </div>
            )}
          </Link>
        );
      })}
    </div>
  );
}

function RecentEventsContent() {
  return (
    <div className="text-sm text-muted-foreground">
      Coming soon — recent events will appear here.
    </div>
  );
}

function ThingsToDoContent() {
  return (
    <div className="flex flex-col gap-2">
      <Button
        asChild
        variant="outline"
        className="justify-start"
        data-testid="home-action-link-accounts"
      >
        <Link href="/account-matching">
          <Link2 className="mr-2 h-4 w-4" />
          Link people and social accounts
        </Link>
      </Button>
      <Button
        asChild
        variant="outline"
        className="justify-start"
        data-testid="home-action-daily-note"
      >
        <Link href="/daily-notes">
          <BookOpen className="mr-2 h-4 w-4" />
          Add to your daily note
        </Link>
      </Button>
      <Button
        asChild
        variant="outline"
        className="justify-start"
        data-testid="home-action-add-person"
      >
        <Link href="/people">
          <Plus className="mr-2 h-4 w-4" />
          Add a new person
        </Link>
      </Button>
    </div>
  );
}

function QuickChatContent() {
  const [message, setMessage] = useState("");
  const [, navigate] = useLocation();
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleGo = () => {
    const trimmed = message.trim();
    if (!trimmed) return;
    navigate(`/ai-chat-demo?message=${encodeURIComponent(trimmed)}`);
  };

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setMessage(e.target.value);
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 200)}px`;
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <Textarea
        ref={textareaRef}
        placeholder="What's on your mind?"
        value={message}
        onChange={handleInput}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            handleGo();
          }
        }}
        className="min-h-[40px] resize-none overflow-y-auto"
        rows={1}
        data-testid="home-quick-chat-input"
      />
      <Button
        onClick={handleGo}
        disabled={!message.trim()}
        className="self-end"
        data-testid="home-quick-chat-go"
      >
        Go
      </Button>
    </div>
  );
}


const CARD_DEFINITIONS: Record<
  CardId,
  { title: string; icon: React.ReactNode; render: () => React.ReactNode }
> = {
  "things-to-do": {
    title: "Things to do",
    icon: <ListTodo className="h-4 w-4" />,
    render: () => <ThingsToDoContent />,
  },
  "quick-chat": {
    title: "Start a Chat",
    icon: <MessageSquare className="h-4 w-4" />,
    render: () => <QuickChatContent />,
  },
  "recent-people": {
    title: "Recently added people",
    icon: <Users className="h-4 w-4" />,
    render: () => <RecentPeopleContent />,
  },
  "recent-social": {
    title: "Recently added social accounts",
    icon: <AtSign className="h-4 w-4" />,
    render: () => <RecentSocialContent />,
  },
  "recent-photos": {
    title: "Recently added photos",
    icon: <ImageIcon className="h-4 w-4" />,
    render: () => <RecentPhotosContent />,
  },
  "recent-events": {
    title: "Recent events",
    icon: <CalendarDays className="h-4 w-4" />,
    render: () => <RecentEventsContent />,
  },
};

export default function HomePage() {
  const { data: mePerson } = useQuery<PersonWithRelations>({
    queryKey: ["/api/me"],
    retry: false,
  });

  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const interval = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(interval);
  }, []);

  const greeting = getGreeting(now, mePerson?.firstName);

  const [editMode, setEditMode] = useState(false);
  const [order, setOrder] = useState<CardId[]>(() => loadOrder());
  const [draggingId, setDraggingId] = useState<CardId | null>(null);
  const [dropTargetId, setDropTargetId] = useState<CardId | null>(null);

  // Persist order whenever it changes
  const isFirstRender = useRef(true);
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    saveOrder(order);
  }, [order]);

  const cols = useColumnCount();
  const columns = useMemo(
    () => distributeIntoColumns(order, cols),
    [order, cols],
  );

  const handleDragStart = (id: CardId) => {
    setDraggingId(id);
    setDropTargetId(null);
  };

  const handleDragOverCard = (id: CardId) => {
    if (!draggingId || draggingId === id) {
      if (dropTargetId !== null) setDropTargetId(null);
      return;
    }
    if (dropTargetId !== id) setDropTargetId(id);
  };

  const handleDropOnCard = (targetId: CardId) => {
    if (!draggingId || draggingId === targetId) {
      setDraggingId(null);
      setDropTargetId(null);
      return;
    }
    setOrder((prev) => {
      const next = prev.filter((id) => id !== draggingId);
      const targetIdx = next.indexOf(targetId);
      if (targetIdx === -1) {
        next.push(draggingId);
      } else {
        // Insert before target so target (and below) shifts down in the column
        next.splice(targetIdx, 0, draggingId);
      }
      return next;
    });
    setDraggingId(null);
    setDropTargetId(null);
  };

  const handleDragEnd = () => {
    setDraggingId(null);
    setDropTargetId(null);
  };

  const handleResetLayout = () => {
    setOrder(DEFAULT_ORDER);
  };

  return (
    <div
      className="h-full overflow-y-auto"
      onDragEnd={handleDragEnd}
      data-testid="home-page"
    >
      <div className="mx-auto w-full max-w-7xl px-4 py-4 md:px-6 md:py-6">
        <div className="mb-4 flex items-start justify-between gap-3">
          <Button
            variant={editMode ? "default" : "outline"}
            size="sm"
            onClick={() => setEditMode((v) => !v)}
            data-testid="home-edit-layout-toggle"
          >
            {editMode ? (
              <>
                <Check className="mr-2 h-4 w-4" />
                Done
              </>
            ) : (
              <>
                <Pencil className="mr-2 h-4 w-4" />
                Edit layout
              </>
            )}
          </Button>
          {editMode && (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleResetLayout}
              data-testid="home-reset-layout"
            >
              Reset
            </Button>
          )}
        </div>

        <div className="mb-6">
          <h1
            className="text-2xl font-semibold md:text-3xl"
            data-testid="home-greeting"
          >
            {greeting}
          </h1>
          <p
            className="mt-1 text-sm text-muted-foreground"
            data-testid="home-subtitle"
          >
            {/* subtitle programmed later */}
          </p>
        </div>

        <div
          className="grid gap-4"
          style={{
            gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
          }}
          data-testid="home-board"
        >
          {columns.map((columnIds, colIdx) => (
            <div
              key={colIdx}
              className="flex flex-col gap-4"
              data-testid={`home-column-${colIdx}`}
            >
              {columnIds.map((id) => {
                const def = CARD_DEFINITIONS[id];
                if (!def) return null;
                return (
                  <BoardCard
                    key={id}
                    id={id}
                    title={def.title}
                    icon={def.icon}
                    editMode={editMode}
                    onDragStart={handleDragStart}
                    onDragOverCard={handleDragOverCard}
                    onDropOnCard={handleDropOnCard}
                    isDraggingThis={draggingId === id}
                    isDropTarget={dropTargetId === id}
                  >
                    {def.render()}
                  </BoardCard>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
