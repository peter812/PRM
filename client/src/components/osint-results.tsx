import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ChevronDown, Info, Loader2, Radar } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { OsintResults } from "@shared/osint-tools";

/** Body for POST /api/osint/results: an account, or one of a person's OSINT Runs targets. */
export type OsintScanRequest = { socialAccountId: string } | { personId: string; target: string; targetType: string };

/** Yellow "unchecked" until a scan has finished, then green with the merged hit count. */
export function OsintChip({ results, onClick, disabled }: { results: OsintResults | undefined; onClick?: () => void; disabled?: boolean }) {
  const n = results?.hits.length;
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!disabled && onClick && (e.key === "Enter" || e.key === " ")) {
      e.preventDefault();
      onClick();
    }
  };
  return (
    <Badge
      variant="outline"
      role="button"
      tabIndex={disabled ? -1 : 0}
      onClick={disabled ? undefined : onClick}
      onKeyDown={handleKeyDown}
      className={`text-[10px] font-medium border-0 select-none ${disabled ? "opacity-50" : "cursor-pointer"} ${
        results ? "bg-green-500/15 text-green-700 dark:text-green-400" : "bg-yellow-500/15 text-yellow-700 dark:text-yellow-400"
      }`}
      data-testid="chip-osint"
    >
      {results ? `${n} result${n === 1 ? "" : "s"}` : "unchecked"}
    </Badge>
  );
}

/** Info icon listing each tool and when it ran; opens on hover or click. */
export function OsintRunsInfo({ results }: { results: OsintResults | undefined }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
        <button type="button" className="text-muted-foreground hover:text-foreground" data-testid="button-osint-info">
          <Info className="h-4 w-4" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-auto text-xs space-y-1" side="bottom" align="start">
        {results?.runs.length ? (
          results.runs.map((r) => (
            <div key={r.tool} className="flex justify-between gap-4">
              <span className="font-medium">{r.tool}</span>
              <span className="text-muted-foreground">{new Date(r.completedAt).toLocaleString()}</span>
            </div>
          ))
        ) : (
          <span className="text-muted-foreground">Not scanned yet</span>
        )}
      </PopoverContent>
    </Popover>
  );
}

function isSafeHttpUrl(url: string | null): boolean {
  if (!url) return false;
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

export function OsintResultsList({ results }: { results: OsintResults | undefined }) {
  if (!results) return <p className="text-xs text-muted-foreground italic">Not scanned yet.</p>;
  if (!results.hits.length) return <p className="text-xs text-muted-foreground italic">No accounts found.</p>;
  return (
    <div className="space-y-1 max-h-96 overflow-auto">
      {results.hits.map((h) => (
        <div key={h.site} className="flex items-center justify-between gap-3 rounded-md border px-3 py-1.5 text-xs">
          <span className="font-medium shrink-0">{h.site}</span>
          {h.url && isSafeHttpUrl(h.url) ? (
            <a href={h.url} target="_blank" rel="noreferrer" className="truncate text-muted-foreground underline underline-offset-2">
              {h.url}
            </a>
          ) : h.url ? (
            <span className="truncate text-muted-foreground">{h.url}</span>
          ) : null}
        </div>
      ))}
    </div>
  );
}

/** Queues a scan on every settings tool that takes this target type. */
export function OsintRunScanButton({ request, onScanQueued }: { request: OsintScanRequest; onScanQueued?: () => void }) {
  const { toast } = useToast();
  const run = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/osint/results", request)).json() as Promise<{ queued: number }>,
    onSuccess: ({ queued }) => {
      toast({ title: queued ? `Queued ${queued} scan${queued === 1 ? "" : "s"}` : "Already scanning, or no tool takes this target" });
      queryClient.invalidateQueries({ queryKey: ["/api/osint/scan-queue"] });
      queryClient.invalidateQueries({ queryKey: ["/api/osint/results"] });
      if (queued > 0) onScanQueued?.();
    },
    onError: (e: Error) => toast({ title: "Scan not queued", description: e.message, variant: "destructive" }),
  });
  return (
    <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => run.mutate()} disabled={run.isPending} data-testid="button-osint-run-scan">
      {run.isPending ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Radar className="h-3.5 w-3.5 mr-1" />}
      Run scan
    </Button>
  );
}

/** The chip plus the dialog it opens: the accounts the scanners found for one target. */
export function OsintChipDialog({ title, results, request, disabled }: { title: string; results: OsintResults | undefined; request: OsintScanRequest; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <OsintChip results={results} onClick={() => setOpen(true)} disabled={disabled} />
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {title}
              <OsintRunsInfo results={results} />
            </DialogTitle>
          </DialogHeader>
          <OsintResultsList results={results} />
          <div className="flex justify-end">
            <OsintRunScanButton request={request} />
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

/**
 * Social account page: the username's OSINT results. Collapsed by default and
 * loads nothing until opened.
 */
export function AccountOsintCard({ socialAccountId }: { socialAccountId: string }) {
  const [open, setOpen] = useState(false);
  const [isPolling, setIsPolling] = useState(false);
  const { data, isLoading } = useQuery<Record<string, OsintResults>>({
    queryKey: ["/api/osint/results", { socialAccountIds: socialAccountId }],
    enabled: open,
    refetchInterval: isPolling ? 3000 : false,
  });
  const results = data?.[socialAccountId];
  return (
    <Card className="p-4 space-y-3 shadow-none" data-testid="card-account-osint">
      <div className="flex items-center gap-2">
        <button type="button" className="flex-1 flex items-center gap-2 font-semibold text-sm text-left" onClick={() => setOpen(!open)}>
          <ChevronDown className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`} />
          OSINT
        </button>
        {open && data && (
          <>
            <OsintChip results={results} />
            <OsintRunsInfo results={results} />
          </>
        )}
      </div>
      {open && (
        <>
          {isLoading ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /> : <OsintResultsList results={results} />}
          <div className="flex justify-end">
            <OsintRunScanButton
              request={{ socialAccountId }}
              onScanQueued={() => {
                setIsPolling(true);
                setTimeout(() => setIsPolling(false), 60000);
              }}
            />
          </div>
        </>
      )}
    </Card>
  );
}
