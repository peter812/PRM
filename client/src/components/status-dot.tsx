import { useQuery } from "@tanstack/react-query";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type ServiceHealth = { ok: boolean; status: "online" | "degraded" | "offline" | "not_configured"; message: string };
export type ServiceStatuses = Record<"prm" | "s3" | "compute" | "stories", ServiceHealth>;

const POLL_INTERVAL_MS = 30_000;
const ROWS = [
  ["prm", "PRM"],
  ["s3", "S3"],
  ["compute", "Compute"],
  ["stories", "Stories"],
] as const;
const COLOR = { online: "bg-green-500", issue: "bg-amber-500", down: "bg-red-600" };

/** The status dot's poll; PrmS3StatusGuard reads the same query, so the page polls once. */
export function useServiceStatuses(enabled: boolean) {
  return useQuery<ServiceStatuses>({
    queryKey: ["/api/status-dot"],
    enabled,
    refetchInterval: POLL_INTERVAL_MS,
    refetchIntervalInBackground: false,
  });
}

type Level = keyof typeof COLOR;
const level = (s: ServiceHealth["status"]): Level => (s === "online" ? "online" : s === "offline" ? "down" : "issue");

function Dot({ color, className }: { color: Level; className?: string }) {
  return <span className={cn("inline-block h-2.5 w-2.5 shrink-0 rounded-full", COLOR[color], className)} />;
}

/** Header dot: the worst of PRM, S3, Compute and Stories; click for each one's state. */
export function StatusDot() {
  const { data, isError, error } = useServiceStatuses(true);
  // The route always answers 200, so a failed request means the PRM backend is unreachable.
  const rows = ROWS.map(([key, name]) => {
    if (isError) {
      return { key, name, color: "down" as Level, message: key === "prm" ? `Backend offline${error instanceof Error ? `: ${error.message}` : ""}` : "Unknown, backend offline" };
    }
    const s = data?.[key];
    const color: Level = s ? level(s.status) : "issue";
    return { key, name, color, message: !s ? "Checking…" : color === "online" ? "Online" : s.message };
  });
  const worst = rows.find((r) => r.color === "down")?.color ?? rows.find((r) => r.color === "issue")?.color ?? "online";

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="h-8 w-8" title="Service status" data-testid="button-status-dot">
          <Dot color={worst} className={cn(worst !== "online" && "animate-pulse")} />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96 p-2">
        {rows.map((r) => (
          <div key={r.key} className="flex items-start gap-3 px-2 py-1.5 text-sm" data-testid={`status-row-${r.key}`}>
            <Dot color={r.color} className="mt-1.5" />
            <span className="w-16 shrink-0 font-medium">{r.name}</span>
            <span className="flex-1 min-w-0 text-right text-muted-foreground break-words">{r.message}</span>
          </div>
        ))}
      </PopoverContent>
    </Popover>
  );
}
