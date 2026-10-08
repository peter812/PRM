import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import { RefreshCw, Settings, Sparkles, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  ImageSummariesDialog,
  SummaryProgressBar,
  SummaryStatusBadge,
  accountWaitProgress,
  jobStep,
  postJobProgress,
} from "@/components/summary-status";
import type { SummaryJobProgress } from "@shared/schema";

type Kind = "post" | "account";

type SummaryQueueRow = {
  id: string;
  kind: Kind;
  targetId: string;
  socialAccountId: string | null;
  username: string | null;
  status: string;
  attempts: number;
  error: string | null;
  options: Record<string, unknown>;
  progress: SummaryJobProgress | null;
  livePosts: number;
  postType: string | null;
  postedAt: string | null;
  postDescription: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
};

type SummaryQueue = { counts: Record<string, number>; rows: SummaryQueueRow[] };

const STATUSES = [
  { value: "pending", label: "Queued" },
  { value: "running", label: "Running" },
  { value: "done", label: "Finished" },
  { value: "failed", label: "Failed" },
] as const;

// Time within a day, then day + month, then month + year once it's over a year old.
function formatQueued(t: string) {
  const d = new Date(t);
  const age = Date.now() - d.getTime();
  if (age < 24 * 60 * 60 * 1000) return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  if (age < 365 * 24 * 60 * 60 * 1000) return d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
  return d.toLocaleDateString(undefined, { month: "short", year: "numeric" });
}

function formatDuration(start: string | null, end: string | null) {
  if (!start || !end) return "—";
  const secs = Math.max(0, Math.round((new Date(end).getTime() - new Date(start).getTime()) / 1000));
  const m = Math.floor(secs / 60);
  return m > 0 ? `${m}m ${secs % 60}s` : `${secs}s`;
}

function postLabel(row: SummaryQueueRow): string {
  const kind = row.postType === "story" ? "Story" : "Post";
  return row.postedAt ? `${kind} · ${new Date(row.postedAt).toLocaleDateString()}` : kind;
}

export default function SummaryTasksPage() {
  const { toast } = useToast();
  const [kind, setKind] = useState<Kind>("post");
  const [status, setStatus] = useState("all");
  const [openRowId, setOpenRowId] = useState<string | null>(null);

  const { data: queue, isLoading } = useQuery<SummaryQueue>({
    queryKey: ["/api/summary-queue", { kind, status }],
    refetchInterval: (q) => {
      const c = q.state.data?.counts;
      return c?.pending || c?.running ? 3000 : 15000;
    },
  });
  const counts = queue?.counts ?? {};
  const rows = queue?.rows ?? [];
  const total = STATUSES.reduce((n, s) => n + (counts[s.value] ?? 0), 0);
  const openRow = rows.find((r) => r.id === openRowId);

  const queueMutation = useMutation({
    mutationFn: async ({ method, path }: { method: string; path: string }) => (await apiRequest(method, path)).json(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/summary-queue"] }),
    onError: (error: Error) => toast({ title: "Queue action failed", description: error.message, variant: "destructive" }),
  });

  return (
    <div className="container max-w-full md:max-w-6xl py-3 md:py-8 px-4 md:pl-12">
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-2 mb-6">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2" data-testid="text-summary-tasks-title">
            <Sparkles className="h-6 w-6" />
            Summary Tasks
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Every AI post and account summary job. A post summary describes each image, then combines them in a final
            run; an account summary waits for its account's post summaries first. Failed jobs are retried up to three
            times.
          </p>
        </div>
        <Button variant="outline" size="sm" asChild>
          <Link href="~/settings/instagram/summaries">
            <Settings className="h-4 w-4 mr-1.5" />
            Summary settings
          </Link>
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <Tabs value={kind} onValueChange={(v) => setKind(v as Kind)}>
          <TabsList>
            <TabsTrigger value="post" data-testid="tab-summary-post">Post summaries</TabsTrigger>
            <TabsTrigger value="account" data-testid="tab-summary-account">Account summaries</TabsTrigger>
          </TabsList>
        </Tabs>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-40" data-testid="select-summary-status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All ({total})</SelectItem>
            {STATUSES.map((s) => (
              <SelectItem key={s.value} value={s.value}>{s.label} ({counts[s.value] ?? 0})</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="flex flex-wrap gap-2 sm:ml-auto">
          <Button
            variant="outline"
            size="sm"
            disabled={queueMutation.isPending}
            onClick={() => queueMutation.mutate({ method: "POST", path: "/api/summary-queue/retry-failed" })}
            data-testid="button-summary-retry-failed"
          >
            <RefreshCw className="h-3.5 w-3.5 mr-1" />
            Retry all failed
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={queueMutation.isPending}
            onClick={() => queueMutation.mutate({ method: "DELETE", path: "/api/summary-queue/finished" })}
            data-testid="button-summary-clear-finished"
          >
            <Trash2 className="h-3.5 w-3.5 mr-1" />
            Clear all finished
          </Button>
        </div>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{kind === "post" ? "Post" : "Account"}</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="w-48">Progress</TableHead>
            <TableHead className="text-right">Attempts</TableHead>
            <TableHead>Queued</TableHead>
            <TableHead>Finished in</TableHead>
            <TableHead>Error</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {isLoading ? (
            <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">Loading…</TableCell></TableRow>
          ) : rows.length === 0 ? (
            <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">No summary jobs.</TableCell></TableRow>
          ) : (
            rows.map((row) => {
              const step = jobStep(row.status);
              const postCount = row.kind === "post" ? postJobProgress(row.progress) : null;
              const waitCount = row.kind === "account" && step === "queued" ? accountWaitProgress(row.options, row.livePosts) : null;
              return (
                <TableRow
                  key={row.id}
                  className={row.kind === "post" ? "cursor-pointer" : undefined}
                  onClick={row.kind === "post" ? () => setOpenRowId(row.id) : undefined}
                  data-testid={`row-summary-job-${row.id}`}
                >
                  <TableCell className="max-w-xs">
                    {row.socialAccountId ? (
                      <Link
                        href={`~/social-accounts/${row.socialAccountId}`}
                        className="font-medium hover:underline"
                        onClick={(e) => e.stopPropagation()}
                      >
                        @{row.username ?? row.socialAccountId.slice(0, 8)}
                      </Link>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                    {row.kind === "post" && (
                      <div className="text-xs text-muted-foreground truncate" title={row.postDescription ?? undefined}>
                        {postLabel(row)}
                        {row.postDescription ? ` — ${row.postDescription}` : ""}
                      </div>
                    )}
                  </TableCell>
                  <TableCell><SummaryStatusBadge step={step} /></TableCell>
                  <TableCell>
                    {postCount ? (
                      <SummaryProgressBar count={postCount} label="steps" />
                    ) : waitCount ? (
                      <SummaryProgressBar count={waitCount} label="posts" />
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">{row.attempts}</TableCell>
                  <TableCell className="text-muted-foreground whitespace-nowrap text-xs" title={new Date(row.createdAt).toLocaleString()}>{formatQueued(row.createdAt)}</TableCell>
                  <TableCell className="text-muted-foreground whitespace-nowrap text-xs" title={row.completedAt ? new Date(row.completedAt).toLocaleString() : undefined}>{formatDuration(row.startedAt, row.completedAt)}</TableCell>
                  <TableCell className="text-xs text-destructive max-w-xs truncate" title={row.error ?? undefined}>
                    {row.error ?? ""}
                  </TableCell>
                </TableRow>
              );
            })
          )}
        </TableBody>
      </Table>
      {rows.length >= 200 && (
        <p className="text-xs text-muted-foreground mt-2">Showing the 200 most recent jobs.</p>
      )}

      <ImageSummariesDialog
        open={!!openRow}
        onOpenChange={(o) => !o && setOpenRowId(null)}
        progress={openRow?.progress ?? null}
        title={openRow ? `Image summaries — @${openRow.username ?? ""} ${postLabel(openRow)}` : "Image summaries"}
      />
    </div>
  );
}
