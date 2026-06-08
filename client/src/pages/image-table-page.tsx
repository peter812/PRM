import { useEffect, useRef, useCallback } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { format } from "date-fns";
import { imageDetailHref } from "@/lib/image-link";

const PAGE_SIZE = 50;

type Photo = {
  id: string;
  location: string;
  uploadedAt: string;
  isSubImage: boolean;
  processedAt: string | null;
  imageDescriptionAt: string | null;
  imageDescription: string | null;
  faceIdAt: string | null;
  faceUuids: unknown;
  prmLocation: string;
};

type PhotosPage = {
  items: Photo[];
  total: number;
};

function fmtDate(val: string | null | undefined): string {
  if (!val) return "—";
  try {
    return format(new Date(val), "yyyy-MM-dd HH:mm");
  } catch {
    return val;
  }
}

function faceCount(faceUuids: unknown): number {
  if (!faceUuids) return 0;
  if (Array.isArray(faceUuids)) return faceUuids.length;
  return 0;
}

function BoolBadge({ value }: { value: boolean }) {
  return (
    <Badge
      variant={value ? "default" : "secondary"}
      className="text-[10px] px-1 py-0 font-mono no-default-active-elevate"
      data-testid={`badge-bool-${value}`}
    >
      {value ? "true" : "false"}
    </Badge>
  );
}

function TruncCell({ value, maxW = 180 }: { value: string | null | undefined; maxW?: number }) {
  if (!value) return <span className="text-muted-foreground">—</span>;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className="block truncate cursor-default"
          style={{ maxWidth: maxW }}
          data-testid="text-trunc-cell"
        >
          {value}
        </span>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="max-w-xs break-all text-xs">
        {value}
      </TooltipContent>
    </Tooltip>
  );
}

export default function ImageTablePage() {
  const sentinelRef = useRef<HTMLDivElement>(null);

  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading,
    isError,
  } = useInfiniteQuery<PhotosPage>({
    queryKey: ["/api/photos", "table"],
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

  const total = data?.pages[0]?.total ?? 0;
  const rows = data?.pages.flatMap((p) => p.items) ?? [];

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

  return (
    <TooltipProvider>
      <div className="flex flex-col min-h-full">
        <div
          className="flex items-center gap-3 px-4 py-3 border-b sticky top-0 bg-background z-20"
          data-testid="header-image-table"
        >
          <div>
            <h1 className="text-lg font-semibold leading-none">Image Table</h1>
            {!isLoading && (
              <p className="text-xs text-muted-foreground mt-1">
                {total.toLocaleString()} photo{total !== 1 ? "s" : ""} total
                {rows.length < total && ` · ${rows.length.toLocaleString()} loaded`}
              </p>
            )}
          </div>
        </div>

        {isLoading && (
          <div className="flex items-center justify-center py-16" data-testid="loading-image-table">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        )}

        {isError && (
          <div className="px-4 py-8 text-sm text-destructive" data-testid="error-image-table">
            Failed to load photos. Please refresh.
          </div>
        )}

        {!isLoading && !isError && (
          <div className="overflow-x-auto">
            <table className="text-xs border-collapse" style={{ minWidth: 1700 }} data-testid="table-images">
              <thead>
                <tr className="bg-muted/60 border-b">
                  <Th w={210}>Image UUID</Th>
                  <Th w={220}>Image URL</Th>
                  <Th w={140}>Created Date</Th>
                  <Th w={180}>Image Desc</Th>
                  <Th w={82}>Sub Image</Th>
                  <Th w={82}>Face Recog</Th>
                  <Th w={140}>Face Recog Date</Th>
                  <Th w={72}>Image AI</Th>
                  <Th w={200}>Image AI Data</Th>
                  <Th w={105}>Face UUIDs Found</Th>
                  <Th w={200}>PRM Location</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((photo, i) => (
                  <tr
                    key={photo.id}
                    className={i % 2 === 0 ? "bg-background" : "bg-muted/20"}
                    data-testid={`row-photo-${photo.id}`}
                  >
                    <Td w={210}>
                      <Link
                        href={`~${imageDetailHref(photo.id, "/settings/image-storage/table")}`}
                        className="font-mono text-[10px] text-primary hover:underline truncate block"
                        style={{ maxWidth: 195 }}
                        title={photo.id}
                        data-testid={`link-photo-${photo.id}`}
                      >
                        {photo.id}
                      </Link>
                    </Td>
                    <Td w={220}>
                      <TruncCell value={photo.location} maxW={205} />
                    </Td>
                    <Td w={140}>
                      <span className="text-muted-foreground">{fmtDate(photo.uploadedAt)}</span>
                    </Td>
                    <Td w={180}>
                      <TruncCell value={photo.imageDescription} maxW={165} />
                    </Td>
                    <Td w={82}>
                      <BoolBadge value={photo.isSubImage} />
                    </Td>
                    <Td w={82}>
                      <BoolBadge value={photo.faceIdAt !== null} />
                    </Td>
                    <Td w={140}>
                      <span className="text-muted-foreground">{fmtDate(photo.faceIdAt)}</span>
                    </Td>
                    <Td w={72}>
                      <BoolBadge value={photo.imageDescriptionAt !== null} />
                    </Td>
                    <Td w={200}>
                      <TruncCell value={photo.imageDescription} maxW={185} />
                    </Td>
                    <Td w={105}>
                      <span className="tabular-nums">{faceCount(photo.faceUuids)}</span>
                    </Td>
                    <Td w={200}>
                      <TruncCell value={photo.prmLocation} maxW={185} />
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div ref={sentinelRef} className="h-8 flex items-center justify-center" data-testid="sentinel-load-more">
              {isFetchingNextPage && (
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              )}
            </div>
          </div>
        )}
      </div>
    </TooltipProvider>
  );
}

function Th({ children, w }: { children: React.ReactNode; w: number }) {
  return (
    <th
      className="text-left font-medium text-muted-foreground px-2 py-1.5 whitespace-nowrap border-r last:border-r-0"
      style={{ width: w, minWidth: w }}
    >
      {children}
    </th>
  );
}

function Td({ children, w }: { children: React.ReactNode; w: number }) {
  return (
    <td
      className="px-2 py-1 border-r last:border-r-0 border-b border-border/40 align-middle overflow-hidden"
      style={{ width: w, minWidth: w, maxWidth: w }}
    >
      {children}
    </td>
  );
}
