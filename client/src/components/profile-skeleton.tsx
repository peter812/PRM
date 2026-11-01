import { Skeleton } from "@/components/ui/skeleton";
import { Card } from "@/components/ui/card";

/** Loading placeholder mirroring the person / me profile layout: top bar, tab rail, Home tab dashboard. */
export function ProfileSkeleton() {
  return (
    <div className="flex flex-col h-full overflow-hidden" data-testid="profile-skeleton">
      <div className="border-b px-4 py-2 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <Skeleton className="h-8 w-8 rounded-full" />
          <div className="space-y-1.5">
            <Skeleton className="h-3.5 w-36" />
            <Skeleton className="h-3 w-24" />
          </div>
        </div>
        <Skeleton className="h-8 w-24" />
      </div>

      <div className="flex-1 flex flex-col md:flex-row overflow-hidden">
        <div className="hidden md:flex md:w-64 shrink-0 border-r bg-card/25 p-3 flex-col gap-1">
          {Array.from({ length: 9 }).map((_, i) => (
            <Skeleton key={i} className="h-9 w-full" />
          ))}
        </div>

        <div className="flex-1 overflow-hidden p-6">
          <div className="flex flex-col lg:flex-row gap-6 items-start">
            <div className="flex-1 space-y-6 w-full min-w-0">
              <div className="space-y-2">
                <Skeleton className="h-8 w-1/3" />
                <Skeleton className="h-4 w-1/4" />
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className="h-20" />
                ))}
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {Array.from({ length: 2 }).map((_, i) => (
                  <Card key={i} className="p-4 space-y-3 shadow-none">
                    <Skeleton className="h-4 w-24" />
                    <Skeleton className="h-3 w-full" />
                    <Skeleton className="h-3 w-5/6" />
                    <Skeleton className="h-3 w-2/3" />
                  </Card>
                ))}
              </div>
              <Card className="p-4 space-y-3 shadow-none">
                <Skeleton className="h-4 w-32" />
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <Skeleton className="h-10" />
                  <Skeleton className="h-10" />
                </div>
              </Card>
              <Card className="p-4 space-y-3 shadow-none">
                <Skeleton className="h-4 w-20" />
                <div className="grid grid-cols-4 gap-2">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <Skeleton key={i} className="aspect-square" />
                  ))}
                </div>
              </Card>
            </div>

            <div className="w-full lg:w-80 shrink-0 space-y-4">
              <Skeleton className="aspect-square w-full rounded-2xl" />
              <Skeleton className="h-8 w-full" />
              <Card className="p-4 space-y-3 shadow-none">
                <Skeleton className="h-3 w-28" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-2/3" />
              </Card>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
