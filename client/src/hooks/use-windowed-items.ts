import { useEffect, useMemo, useRef, useState } from "react";

const DEFAULT_PAGE_SIZE = 48;

/**
 * Incrementally reveals items from a client-side array as a sentinel element
 * approaches the viewport, avoiding rendering thousands of DOM nodes at once.
 */
export function useWindowedItems<T>(
  items: readonly T[],
  resetDeps: readonly unknown[],
  pageSize = DEFAULT_PAGE_SIZE,
) {
  const [visibleCount, setVisibleCount] = useState(pageSize);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setVisibleCount(pageSize);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageSize, ...resetDeps]);

  const hasMore = visibleCount < items.length;

  useEffect(() => {
    if (!hasMore) return;
    const el = sentinelRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisibleCount((prev) => prev + pageSize);
        }
      },
      { rootMargin: "200px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasMore, visibleCount, pageSize]);

  const visibleItems = useMemo(() => items.slice(0, visibleCount), [items, visibleCount]);
  const loadMore = () => setVisibleCount((prev) => prev + pageSize);
  const remainingCount = Math.max(0, items.length - visibleCount);

  return { visibleItems, hasMore, sentinelRef, loadMore, remainingCount };
}
