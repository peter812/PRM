import type { ComponentType } from "react";
import { Link } from "wouter";
import { Skeleton } from "@/components/ui/skeleton";

/** One headline number for the Stats pages. Links to `href` when given. */
export function StatTile({
  label,
  value,
  icon: Icon,
  href,
  testId,
}: {
  label: string;
  value: number | undefined;
  icon?: ComponentType<{ className?: string }>;
  href?: string;
  testId: string;
}) {
  const body = (
    <>
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        {Icon && <Icon className="h-4 w-4" />}
        <span className="truncate">{label}</span>
      </div>
      {value === undefined ? (
        <Skeleton className="h-9 w-20 mt-1" />
      ) : (
        <div className="text-3xl font-bold tabular-nums truncate mt-1" data-testid={`stat-value-${testId}`}>
          {value.toLocaleString()}
        </div>
      )}
    </>
  );
  const className = "block rounded-md border bg-card p-4";
  return href ? (
    <Link href={href} className={`${className} hover-elevate active-elevate-2`} data-testid={`stat-tile-${testId}`}>
      {body}
    </Link>
  ) : (
    <div className={className} data-testid={`stat-tile-${testId}`}>{body}</div>
  );
}
