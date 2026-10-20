import { useState } from "react";
import { useLocation, useSearch } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Loader2, Search, ArrowLeft, Newspaper } from "lucide-react";
import { MEDIA_TYPES, MediaTile, useUniversalSearch, type UniversalEntityType } from "./super-search";

const FILTERS: { label: string; types: UniversalEntityType[] }[] = [
  { label: "All", types: MEDIA_TYPES },
  { label: "Posts", types: ["post"] },
  { label: "Stories", types: ["story"] },
];

/** Super Search limited to posts and stories, shown as a thumbnail grid. */
export default function SuperSearchMediaPage() {
  const searchQuery = new URLSearchParams(useSearch()).get("q") || "";
  const [, navigate] = useLocation();
  const [query, setQuery] = useState(searchQuery);
  const [filter, setFilter] = useState(FILTERS[0]);
  const { data, isLoading, error } = useUniversalSearch(searchQuery, filter.types, 100);
  const results = data?.results || [];

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    navigate(`/super-search/media?q=${encodeURIComponent(query)}`, { replace: true });
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="container mx-auto p-6 max-w-5xl">
        <div className="flex items-center gap-3 mb-6">
          <Button variant="ghost" size="icon" onClick={() => navigate(`/super-search?q=${encodeURIComponent(searchQuery)}`)}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Newspaper className="h-6 w-6 text-blue-500" />
            Media Search
          </h1>
        </div>

        <form onSubmit={handleSubmit} className="mb-4 flex gap-2">
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search posts and stories..."
            className="py-5"
            autoFocus
          />
          <Button type="submit" disabled={!query.trim() || isLoading}>
            {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
          </Button>
        </form>

        <div className="flex gap-1 mb-4">
          {FILTERS.map((f) => (
            <Button
              key={f.label}
              size="sm"
              variant={f === filter ? "secondary" : "ghost"}
              onClick={() => setFilter(f)}
              data-testid={`filter-media-${f.label.toLowerCase()}`}
            >
              {f.label}
            </Button>
          ))}
        </div>

        {error && (
          <Card className="border-destructive">
            <CardContent className="p-4 text-destructive">{(error as Error).message}</CardContent>
          </Card>
        )}

        <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-5 gap-2">
          {isLoading
            ? Array.from({ length: 10 }).map((_, i) => <Skeleton key={i} className="aspect-square rounded-md" />)
            : results.map((result) => <MediaTile key={result.entityId} result={result} />)}
        </div>

        {!isLoading && searchQuery && results.length === 0 && (
          <p className="text-center py-16 text-muted-foreground">No posts or stories found for "{searchQuery}"</p>
        )}
      </div>
    </div>
  );
}
