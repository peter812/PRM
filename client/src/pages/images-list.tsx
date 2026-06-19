import { useEffect, useRef, useCallback } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Loader2, ImageIcon, ImageOff } from "lucide-react";
import { imageDetailHref } from "@/lib/image-link";

const PAGE_SIZE = 60;

type PhotoListItem = {
  id: string;
  location: string;
  uploadedAt: string;
  isSubImage: boolean;
};

type PhotosPage = {
  items: PhotoListItem[];
  total: number;
};

export default function ImagesListPage() {
  const sentinelRef = useRef<HTMLDivElement>(null);

  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading,
    isError,
  } = useInfiniteQuery<PhotosPage>({
    queryKey: ["/api/photos", "images-grid"],
    queryFn: async ({ pageParam }) => {
      const offset = pageParam as number;
      const res = await fetch(`/api/photos?limit=${PAGE_SIZE}&offset=${offset}`);
      if (!res.ok) throw new Error("Failed to fetch photos");
      return res.json();
    },
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) => {
      const loaded = allPages.reduce((acc, p) => acc + p.items.length, 0);
      return loaded < lastPage.total ? loaded : undefined;
    },
  });

  const handleObserver = useCallback(
    (entries: IntersectionObserverEntry[]) => {
      if (entries[0].isIntersecting && hasNextPage && !isFetchingNextPage) {
        fetchNextPage();
      }
    },
    [fetchNextPage, hasNextPage, isFetchingNextPage]
  );

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(handleObserver, { threshold: 0.1 });
    observer.observe(el);
    return () => observer.disconnect();
  }, [handleObserver]);

  const total = data?.pages[0]?.total ?? 0;
  const rows = data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      <div
        className="flex items-center gap-3 px-4 py-3 border-b sticky top-0 backdrop-blur-xl bg-background/70 z-20"
        data-testid="header-images-list"
      >
        <div>
          <h1 className="text-lg font-semibold leading-none">Images</h1>
          {!isLoading && (
            <p className="text-xs text-muted-foreground mt-1" data-testid="text-images-count">
              {total.toLocaleString()} image{total !== 1 ? "s" : ""} total
              {rows.length < total && ` · ${rows.length.toLocaleString()} loaded`}
            </p>
          )}
        </div>
      </div>

      {isLoading && (
        <div className="flex items-center justify-center py-16" data-testid="loading-images-list">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      )}

      {isError && (
        <div className="px-4 py-8 text-sm text-destructive" data-testid="error-images-list">
          Failed to load images. Please refresh.
        </div>
      )}

      {!isLoading && !isError && rows.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-muted-foreground" data-testid="empty-images-list">
          <ImageOff className="h-10 w-10 mb-3" />
          <p className="text-sm">No images yet.</p>
        </div>
      )}

      {!isLoading && !isError && rows.length > 0 && (
        <div className="p-3">
          <div
            className="grid gap-2 grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 xl:grid-cols-10"
            data-testid="grid-images"
          >
            {rows.map((photo) => (
              <Link
                key={photo.id}
                href={imageDetailHref(photo.id, "/images")}
                className="relative aspect-square overflow-hidden rounded-md bg-muted hover-elevate"
                data-testid={`link-image-${photo.id}`}
              >
                {photo.location ? (
                  <img
                    src={photo.location}
                    alt=""
                    className="h-full w-full object-cover"
                    loading="lazy"
                    onError={(e) => {
                      (e.currentTarget as HTMLImageElement).style.display = "none";
                    }}
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-muted-foreground">
                    <ImageIcon className="h-5 w-5" />
                  </div>
                )}
              </Link>
            ))}
          </div>

          <div ref={sentinelRef} className="h-12 flex items-center justify-center" data-testid="sentinel-load-more">
            {isFetchingNextPage && (
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
