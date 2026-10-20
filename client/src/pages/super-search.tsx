import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation, useSearch } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Loader2, Search, Users, FileText, Calendar, AtSign, BookOpen, MessageSquare, Image, ArrowLeft, ArrowRight, Newspaper, CircleDot, MessagesSquare } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { withImageSize } from "@shared/image-size";

export type UniversalEntityType = "person" | "image" | "note" | "interaction" | "social_account" | "post" | "story" | "message_chunk" | "daily_note" | "ai_chat";

export type SearchResult = {
  type: UniversalEntityType;
  entityId: string;
  title: string;
  snippet: string;
  score: number;
  createdAt?: string;
  meta?: Record<string, unknown>;
};

export const TYPE_LABELS: Record<UniversalEntityType, string> = {
  person: "Person",
  image: "Image",
  note: "Note",
  interaction: "Interaction",
  social_account: "Social Account",
  post: "Post",
  story: "Story",
  message_chunk: "Messages",
  daily_note: "Daily Note",
  ai_chat: "AI Chat",
};

const TYPE_ICONS: Record<UniversalEntityType, typeof Users> = {
  person: Users,
  image: Image,
  note: FileText,
  interaction: Calendar,
  social_account: AtSign,
  post: Newspaper,
  story: CircleDot,
  message_chunk: MessagesSquare,
  daily_note: BookOpen,
  ai_chat: MessageSquare,
};

const TYPE_COLORS: Record<UniversalEntityType, string> = {
  person: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  image: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  note: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
  interaction: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200",
  social_account: "bg-pink-100 text-pink-800 dark:bg-pink-900 dark:text-pink-200",
  post: "bg-rose-100 text-rose-800 dark:bg-rose-900 dark:text-rose-200",
  story: "bg-fuchsia-100 text-fuchsia-800 dark:bg-fuchsia-900 dark:text-fuchsia-200",
  message_chunk: "bg-cyan-100 text-cyan-800 dark:bg-cyan-900 dark:text-cyan-200",
  daily_note: "bg-indigo-100 text-indigo-800 dark:bg-indigo-900 dark:text-indigo-200",
  ai_chat: "bg-teal-100 text-teal-800 dark:bg-teal-900 dark:text-teal-200",
};

export function getEntityRoute(result: SearchResult): string {
  switch (result.type) {
    case "person":
      return `/person/${result.entityId}`;
    case "note":
      return result.meta?.personId ? `/person/${result.meta.personId}` : `/people`;
    case "interaction":
      return `/people`; // interactions don't have a dedicated page
    case "social_account":
      return `/social-accounts/${result.entityId}`;
    case "post":
    case "story":
      return `/social-accounts/${result.meta?.socialAccountId}?postId=${result.entityId}`;
    case "message_chunk":
      return `/message-chunks/${result.entityId}`;
    case "daily_note":
      return `/daily-notes/${result.entityId}`;
    case "ai_chat":
      return `/ai-chat-demo/${result.entityId}`;
    case "image":
      return `/image/${result.entityId}`;
    default:
      return "/";
  }
}

export const MEDIA_TYPES: UniversalEntityType[] = ["post", "story"];
const OTHER_TYPES = (Object.keys(TYPE_LABELS) as UniversalEntityType[]).filter((t) => !MEDIA_TYPES.includes(t));

/** Semantic search limited to some entity types. Posts and stories are searched apart so their volume can't crowd out everything else. */
export function useUniversalSearch(query: string, typeFilter: UniversalEntityType[], limit: number) {
  return useQuery<{ results: SearchResult[] }>({
    queryKey: ["/api/vector/universal/search", query, typeFilter, limit],
    queryFn: async () => {
      const res = await apiRequest("POST", "/api/vector/universal/search", { query, typeFilter, limit });
      return res.json();
    },
    enabled: !!query.trim(),
  });
}

/** Square thumbnail for a post/story hit; falls back to the summary text when it has no image. */
export function MediaTile({ result, className = "" }: { result: SearchResult; className?: string }) {
  const [, navigate] = useLocation();
  const thumb = result.meta?.thumbnailUrl as string | undefined;
  return (
    <button
      type="button"
      onClick={() => navigate(getEntityRoute(result))}
      className={`relative aspect-square rounded-md border bg-muted overflow-hidden text-left hover:opacity-90 transition-opacity ${className}`}
      title={result.snippet}
      data-testid={`media-tile-${result.entityId}`}
    >
      {thumb ? (
        <img src={withImageSize(thumb, 360)} alt="" loading="lazy" className="w-full h-full object-cover" />
      ) : (
        <p className="p-2 text-[11px] text-muted-foreground line-clamp-6">{result.snippet}</p>
      )}
      <div className="absolute top-1 left-1">
        <Badge variant="secondary" className={`text-[10px] px-1.5 py-0 ${TYPE_COLORS[result.type]}`}>
          {TYPE_LABELS[result.type]}
        </Badge>
      </div>
      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent p-1.5 flex items-center gap-1 text-[10px] text-white">
        <span className="truncate">{result.title.replace(/^(Post|Story) by /, "")}</span>
        <span className="ml-auto shrink-0">{Math.round(result.score * 100)}%</span>
      </div>
    </button>
  );
}

export default function SuperSearchPage() {
  const searchString = useSearch();
  const params = new URLSearchParams(searchString);
  const initialQuery = params.get("q") || "";
  const [, navigate] = useLocation();
  const [query, setQuery] = useState(initialQuery);
  const [searchQuery, setSearchQuery] = useState(initialQuery);

  const { data, isLoading, error } = useUniversalSearch(searchQuery, OTHER_TYPES, 30);
  const { data: mediaData, isLoading: mediaLoading } = useUniversalSearch(searchQuery, MEDIA_TYPES, 20);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setSearchQuery(query);
    navigate(`/super-search?q=${encodeURIComponent(query)}`, { replace: true });
  };

  useEffect(() => {
    if (initialQuery && initialQuery !== searchQuery) {
      setSearchQuery(initialQuery);
      setQuery(initialQuery);
    }
  }, [initialQuery]);

  const results = data?.results || [];
  const media = mediaData?.results || [];

  return (
    <div className="h-full overflow-y-auto">
      <div className="container mx-auto p-6 max-w-4xl">
        <div className="flex items-center gap-3 mb-6">
          <Button variant="ghost" size="icon" onClick={() => navigate("/")}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Search className="h-6 w-6 text-blue-500" />
            Super Search
          </h1>
        </div>

        <form onSubmit={handleSubmit} className="mb-8">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search across all your data with AI..."
                className="pl-4 pr-4 py-6 text-lg border-2 border-blue-200 focus:border-blue-400 shadow-[0_0_8px_2px_rgba(59,130,246,0.3)] focus:shadow-[0_0_12px_3px_rgba(59,130,246,0.5)] transition-shadow"
                autoFocus
              />
            </div>
            <Button type="submit" size="lg" className="px-6" disabled={!query.trim() || isLoading}>
              {isLoading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Search className="h-5 w-5" />}
            </Button>
          </div>
        </form>

        {error && (
          <Card className="border-destructive">
            <CardContent className="p-4 text-destructive">
              {(error as Error).message || "Search failed. Make sure universal vectorization is enabled."}
            </CardContent>
          </Card>
        )}

        {(mediaLoading || media.length > 0) && (
          <div className="mb-6">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-sm font-semibold flex items-center gap-1.5">
                <Newspaper className="h-4 w-4 text-muted-foreground" />
                Media
              </h2>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 gap-1 text-xs"
                onClick={() => navigate(`/super-search/media?q=${encodeURIComponent(searchQuery)}`)}
                data-testid="button-media-search"
              >
                All media <ArrowRight className="h-3.5 w-3.5" />
              </Button>
            </div>
            <div className="flex gap-2 overflow-x-auto pb-2">
              {mediaLoading
                ? [1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="w-32 aspect-square shrink-0 rounded-md" />)
                : media.map((result) => <MediaTile key={result.entityId} result={result} className="w-32 shrink-0" />)}
            </div>
          </div>
        )}

        {isLoading && (
          <div className="space-y-3">
            {[1, 2, 3, 4, 5].map((i) => (
              <Card key={i}>
                <CardContent className="p-4 flex items-start gap-3">
                  <Skeleton className="h-5 w-5 shrink-0 rounded" />
                  <div className="flex-1 space-y-2">
                    <div className="flex items-center gap-2">
                      <Skeleton className="h-4 w-1/3" />
                      <Skeleton className="h-4 w-16" />
                      <Skeleton className="h-3 w-8 ml-auto" />
                    </div>
                    <Skeleton className="h-4 w-5/6" />
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {!isLoading && !mediaLoading && searchQuery && results.length === 0 && media.length === 0 && (
          <div className="text-center py-16 text-muted-foreground">
            <Search className="h-12 w-12 mx-auto mb-4 opacity-50" />
            <p className="text-lg">No results found for "{searchQuery}"</p>
            <p className="text-sm mt-2">Try a different query or make sure entities have been vectorized.</p>
          </div>
        )}

        {!isLoading && results.length > 0 && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground mb-4">
              {results.length} result{results.length !== 1 ? "s" : ""} found
            </p>
            {results.map((result, index) => {
              const Icon = TYPE_ICONS[result.type];
              const route = getEntityRoute(result);
              return (
                <Card
                  key={`${result.type}-${result.entityId}-${index}`}
                  className="cursor-pointer hover:bg-accent transition-colors"
                  onClick={() => navigate(route)}
                >
                  <CardContent className="p-4 flex items-start gap-3">
                    <div className="mt-0.5">
                      <Icon className="h-5 w-5 text-muted-foreground" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-medium truncate">{result.title}</span>
                        <Badge variant="secondary" className={`text-xs shrink-0 ${TYPE_COLORS[result.type]}`}>
                          {TYPE_LABELS[result.type]}
                        </Badge>
                        <span className="text-xs text-muted-foreground shrink-0 ml-auto">
                          {Math.round(result.score * 100)}%
                        </span>
                      </div>
                      {result.snippet && (
                        <p className="text-sm text-muted-foreground line-clamp-2">{result.snippet}</p>
                      )}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
