import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import { Radar, Settings } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import type { OsintScan } from "@shared/schema";

type ScanQueue = { counts: Record<string, number>; rows: Omit<OsintScan, "result">[] };

const STATUSES = ["pending", "running", "done", "failed", "cancelled"] as const;
// The running row is the one the runner holds; it can't be cleared.
const CLEARABLE = ["pending", "done", "failed", "cancelled"] as const;

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  pending: "outline",
  running: "secondary",
  done: "default",
  failed: "destructive",
  cancelled: "outline",
};

const formatTime = (t: string | Date | null) => (t ? new Date(t).toLocaleString() : "—");

export default function OsintTasksPage() {
  const { isAdmin } = useAuth();
  const { toast } = useToast();
  const [status, setStatus] = useState("all");

  const { data: queue, isLoading } = useQuery<ScanQueue>({
    queryKey: ["/api/osint/scan-queue", { status }],
    refetchInterval: 15000,
  });
  const counts = queue?.counts ?? {};
  const rows = queue?.rows ?? [];
  const total = STATUSES.reduce((n, s) => n + (counts[s] ?? 0), 0);

  const queueMutation = useMutation({
    mutationFn: async ({ method, path }: { method: string; path: string }) => {
      const res = await apiRequest(method, path);
      return res.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/osint/scan-queue"] }),
    onError: (error: Error) => toast({ title: "Queue action failed", description: error.message, variant: "destructive" }),
  });

  return (
    <div className="container max-w-full md:max-w-5xl py-3 md:py-8 px-4 md:pl-12">
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-2 mb-6">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2" data-testid="text-osint-tasks-title">
            <Radar className="h-6 w-6" />
            OSINT Tasks
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Every OSINT scan PRM sends to PRM-Compute. Scans wait here and are fed to PRM-Compute a few at a time as
            earlier ones finish. Scans of a known account also land in its Insights tab; failed scans are retried
            up to three times.
          </p>
        </div>
        <Button variant="outline" size="sm" asChild>
          <Link href="~/settings/osint">
            <Settings className="h-4 w-4 mr-1.5" />
            OSINT settings
          </Link>
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-44" data-testid="select-osint-status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All ({total})</SelectItem>
            {STATUSES.map((s) => (
              <SelectItem key={s} value={s}>{s} ({counts[s] ?? 0})</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {isAdmin && (
          <div className="flex flex-wrap gap-2 sm:ml-auto">
            <Button
              variant="outline"
              size="sm"
              disabled={queueMutation.isPending}
              onClick={() => queueMutation.mutate({ method: "POST", path: "/api/osint/scan-queue/backfill" })}
              data-testid="button-osint-backfill"
            >
              Queue my network now
            </Button>
            {CLEARABLE.map((s) => (
              <Button
                key={s}
                variant="outline"
                size="sm"
                disabled={!counts[s] || queueMutation.isPending}
                onClick={() => queueMutation.mutate({ method: "DELETE", path: `/api/osint/scan-queue?status=${s}` })}
                data-testid={`button-osint-clear-${s}`}
              >
                Clear {s}
              </Button>
            ))}
          </div>
        )}
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Target</TableHead>
            <TableHead>Tool</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Attempts</TableHead>
            <TableHead>Queued</TableHead>
            <TableHead>Started</TableHead>
            <TableHead>Finished</TableHead>
            <TableHead>Error</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {isLoading ? (
            <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">Loading…</TableCell></TableRow>
          ) : rows.length === 0 ? (
            <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">No OSINT scans queued.</TableCell></TableRow>
          ) : (
            rows.map((row) => (
              <TableRow key={row.id} data-testid={`row-osint-scan-${row.id}`}>
                <TableCell>
                  {row.socialAccountId ? (
                    <Link href={`~/social-accounts/${row.socialAccountId}`} className="font-medium hover:underline">
                      @{row.target}
                    </Link>
                  ) : row.personId ? (
                    <Link href={`~/people/${row.personId}`} className="font-medium hover:underline">
                      {row.target}
                    </Link>
                  ) : (
                    <span className="font-medium">{row.target}</span>
                  )}
                  {row.targetType && row.targetType !== "username" && (
                    <Badge variant="outline" className="ml-2 text-[10px] py-0 px-1 font-normal text-muted-foreground">
                      {row.targetType}
                    </Badge>
                  )}
                </TableCell>
                <TableCell className="text-muted-foreground">{row.tool}</TableCell>
                <TableCell><Badge variant={STATUS_VARIANT[row.status] ?? "outline"}>{row.status}</Badge></TableCell>
                <TableCell className="text-right">{row.attempts}</TableCell>
                <TableCell className="text-muted-foreground whitespace-nowrap">{formatTime(row.createdAt)}</TableCell>
                <TableCell className="text-muted-foreground whitespace-nowrap">{formatTime(row.startedAt)}</TableCell>
                <TableCell className="text-muted-foreground whitespace-nowrap">{formatTime(row.completedAt)}</TableCell>
                <TableCell className="text-xs text-destructive max-w-xs truncate" title={row.error ?? undefined}>
                  {row.error ?? ""}
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
      {rows.length >= 200 && (
        <p className="text-xs text-muted-foreground mt-2">Showing the 200 most recent scans.</p>
      )}
    </div>
  );
}
