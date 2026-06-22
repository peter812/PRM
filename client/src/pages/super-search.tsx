import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation, useSearch } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Loader2, Search, Users, Users2, FileText, Calendar, AtSign, BookOpen, MessageSquare, Image, ArrowLeft } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";

type UniversalEntityType = "person" | "group" | "image" | "note" | "interaction" | "social_account" | "daily_note" | "ai_chat";

type SearchResult = {
  type: UniversalEntityType;
  entityId: string;
  title: string;
  snippet: string;
  score: number;
  createdAt?: string;
  meta?: Record<string, unknown>;
};

const TYPE_LABELS: Record<UniversalEntityType, string> = {
  person: "Person",
  group: "Group",
  image: "Image",
  note: "Note",
  interaction: "Interaction",
  social_account: "Social Account",
  daily_note: "Daily Note",
  ai_chat: "AI Chat",
};

const TYPE_ICONS: Record<UniversalEntityType, typeof Users> = {
  person: Users,
  group: Users2,
  image: Image,
  note: FileText,
  interaction: Calendar,
  social_account: AtSign,
  daily_note: BookOpen,
  ai_chat: MessageSquare,
};

const TYPE_COLORS: Record<UniversalEntityType, string> = {
  person: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  group: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200",
  image: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  note: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
  interaction: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200",
  social_account: "bg-pink-100 text-pink-800 dark:bg-pink-900 dark:text-pink-200",
  daily_note: "bg-indigo-100 text-indigo-800 dark:bg-indigo-900 dark:text-indigo-200",
  ai_chat: "bg-teal-100 text-teal-800 dark:bg-teal-900 dark:text-teal-200",
};

function getEntityRoute(result: SearchResult): string {
  switch (result.type) {
    case "person":
      return `/person/${result.entityId}`;
    case "group":
      return `/group/${result.entityId}`;
    case "note":
      return result.meta?.personId ? `/person/${result.meta.personId}` : `/people`;
    case "interaction":
      return `/people`; // interactions don't have a dedicated page
    case "social_account":
      return `/social-accounts/${result.entityId}`;
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

export default function SuperSearchPage() {
  const searchString = useSearch();
  const params = new URLSearchParams(searchString);
  const initialQuery = params.get("q") || "";
  const [, navigate] = useLocation();
  const [query, setQuery] = useState(initialQuery);
  const [searchQuery, setSearchQuery] = useState(initialQuery);

  const { data, isLoading, error } = useQuery<{ results: SearchResult[] }>({
    queryKey: ["/api/vector/universal/search", searchQuery],
    queryFn: async () => {
      if (!searchQuery.trim()) return { results: [] };
      const res = await apiRequest("POST", "/api/vector/universal/search", {
        query: searchQuery,
        limit: 30,
      });
      return res.json();
    },
    enabled: !!searchQuery.trim(),
  });

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

        {isLoading && (
          <div className="flex flex-col items-center justify-center py-16 gap-4">
            <Loader2 className="h-10 w-10 animate-spin text-blue-500" />
            <p className="text-muted-foreground">Searching with AI...</p>
          </div>
        )}

        {!isLoading && searchQuery && results.length === 0 && (
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
