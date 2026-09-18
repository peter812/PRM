import { Badge } from "@/components/ui/badge";

/** Shown in place of a post's like count when the poster turned it off. */
export function LikesHiddenBadge({ className = "" }: { className?: string }) {
  return (
    <Badge
      className={`border-yellow-300 bg-yellow-100 text-yellow-800 dark:border-yellow-800 dark:bg-yellow-950 dark:text-yellow-200 px-1.5 py-0 text-[10px] font-medium leading-4 ${className}`}
      data-testid="badge-likes-hidden"
    >
      hidden
    </Badge>
  );
}
