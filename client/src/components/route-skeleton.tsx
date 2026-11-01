import { useLocation } from "wouter";
import { Skeleton } from "@/components/ui/skeleton";
import { Card } from "@/components/ui/card";
import { ProfileSkeleton } from "@/components/profile-skeleton";

/** Loading placeholder mirroring the home board. Lives outside pages/home so it shows before that chunk loads. */
function HomeSkeleton() {
  return (
    <div className="h-full overflow-hidden" data-testid="home-skeleton">
      <div className="mx-auto w-full max-w-7xl px-4 py-4 md:px-6 md:py-6">
        <Skeleton className="mb-4 h-8 w-28" />
        <Skeleton className="mb-6 h-8 w-64 md:h-9" />
        {/* Same breakpoints as home's useColumnCount */}
        <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
          {Array.from({ length: 7 }).map((_, i) => (
            <Card key={i} className="p-4 space-y-4">
              <Skeleton className="h-5 w-2/3" />
              <div className="space-y-2">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-5/6" />
                <Skeleton className="h-4 w-1/2" />
              </div>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Page-shaped skeleton for routes that have one, otherwise `fallback`. Used while auth or a page chunk loads. */
export function RouteSkeleton({ fallback }: { fallback: React.ReactNode }) {
  const [location] = useLocation();
  if (location === "/home") return <HomeSkeleton />;
  if (location === "/me" || /^\/person\/[^/]+$/.test(location)) return <ProfileSkeleton />;
  return <>{fallback}</>;
}
