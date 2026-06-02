import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Trash2, ChevronLeft, ChevronRight, RefreshCw, Image as ImageIcon, ExternalLink } from "lucide-react";
import { format } from "date-fns";
import type { ImageTask } from "@shared/schema";

type ImageTasksResponse = {
  items: ImageTask[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
};

const STATUS_COLORS: Record<string, string> = {
  pending: "bg-muted text-muted-foreground",
  in_progress: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  completed: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  failed: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
  cancelled: "bg-muted text-muted-foreground line-through",
};

function formatDate(d: string | Date | null | undefined): string {
  if (!d) return "—";
  return format(new Date(d), "MMM d, yy HH:mm:ss");
}

function TypeLabel({ type }: { type: string }) {
  const labels: Record<string, string> = {
    download_img_instagram: "DL Instagram",
    analyze_img_full: "Analyze Full",
    analyze_img_face: "Analyze Face",
    analyze_img_metadata: "Analyze Meta",
    analyze_img_llm: "Analyze LLM",
    convert_img: "Convert",
  };
  return <span className="font-mono text-xs">{labels[type] ?? type}</span>;
}

export default function ImageTasksSettingsPage() {
  const { toast } = useToast();
  const [page, setPage] = useState(1);
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");

  const params = new URLSearchParams({ page: String(page), limit: "25" });
  if (typeFilter && typeFilter !== "all") params.set("type", typeFilter);
  if (statusFilter && statusFilter !== "all") params.set("status", statusFilter);

  const { data, isLoading, refetch, isFetching } = useQuery<ImageTasksResponse>({
    queryKey: ["/api/image-tasks", page, typeFilter, statusFilter],
    queryFn: async () => {
      const res = await fetch(`/api/image-tasks?${params.toString()}`);
      if (!res.ok) throw new Error("Failed to fetch image tasks");
      return res.json();
    },
    refetchInterval: (query) => {
      const items = query.state.data?.items ?? [];
      const hasActive = items.some(t => t.status === "pending" || t.status === "in_progress");
      return hasActive ? 3000 : false;
    },
  });

  const cancelTask = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/image-tasks/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/image-tasks"] });
      toast({ title: "Task cancelled" });
    },
    onError: () => toast({ title: "Failed to cancel task", variant: "destructive" }),
  });

  const cancelAll = useMutation({
    mutationFn: () => apiRequest("DELETE", "/api/image-tasks"),
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/image-tasks"] });
      toast({ title: `Cancelled ${data?.cancelled ?? 0} tasks` });
    },
    onError: () => toast({ title: "Failed to cancel tasks", variant: "destructive" }),
  });

  const items = data?.items ?? [];
  const totalPages = data?.totalPages ?? 1;
  const total = data?.total ?? 0;

  return (
    <div className="container max-w-full md:max-w-5xl py-3 md:py-8 px-4 md:pl-12">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">Image Tasks</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Background image operations — downloads, analysis, and conversions.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <Select value={typeFilter} onValueChange={v => { setTypeFilter(v); setPage(1); }}>
          <SelectTrigger className="w-48" data-testid="select-type-filter">
            <SelectValue placeholder="All types" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All types</SelectItem>
            <SelectItem value="download_img_instagram">Download Instagram</SelectItem>
            <SelectItem value="analyze_img_full">Analyze Full</SelectItem>
            <SelectItem value="analyze_img_face">Analyze Face</SelectItem>
            <SelectItem value="analyze_img_metadata">Analyze Metadata</SelectItem>
            <SelectItem value="analyze_img_llm">Analyze LLM</SelectItem>
            <SelectItem value="convert_img">Convert</SelectItem>
          </SelectContent>
        </Select>

        <Select value={statusFilter} onValueChange={v => { setStatusFilter(v); setPage(1); }}>
          <SelectTrigger className="w-40" data-testid="select-status-filter">
            <SelectValue placeholder="All statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="in_progress">In Progress</SelectItem>
            <SelectItem value="completed">Completed</SelectItem>
            <SelectItem value="failed">Failed</SelectItem>
            <SelectItem value="cancelled">Cancelled</SelectItem>
          </SelectContent>
        </Select>

        <Button
          size="icon"
          variant="ghost"
          onClick={() => refetch()}
          disabled={isFetching}
          data-testid="button-refresh"
        >
          {isFetching ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
        </Button>

        <div className="ml-auto">
          <Button
            variant="outline"
            size="sm"
            onClick={() => cancelAll.mutate()}
            disabled={cancelAll.isPending}
            data-testid="button-cancel-all"
          >
            {cancelAll.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Trash2 className="h-4 w-4 mr-2" />}
            Cancel all active
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : items.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground text-sm">
          No image tasks found.
        </div>
      ) : (
        <div className="border rounded-md overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="text-left px-3 py-2 font-medium text-muted-foreground whitespace-nowrap">Type</th>
                <th className="text-left px-3 py-2 font-medium text-muted-foreground whitespace-nowrap">Status</th>
                <th className="text-left px-3 py-2 font-medium text-muted-foreground whitespace-nowrap">Progress</th>
                <th className="text-left px-3 py-2 font-medium text-muted-foreground whitespace-nowrap">Photo</th>
                <th className="text-left px-3 py-2 font-medium text-muted-foreground whitespace-nowrap">Parent Task</th>
                <th className="text-left px-3 py-2 font-medium text-muted-foreground whitespace-nowrap">Created</th>
                <th className="text-left px-3 py-2 font-medium text-muted-foreground whitespace-nowrap">Started</th>
                <th className="text-left px-3 py-2 font-medium text-muted-foreground whitespace-nowrap">Completed</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {items.map((task, idx) => (
                <tr
                  key={task.id}
                  className={`border-b last:border-b-0 ${idx % 2 === 0 ? "" : "bg-muted/20"}`}
                  data-testid={`row-image-task-${task.id}`}
                >
                  <td className="px-3 py-2">
                    <TypeLabel type={task.type} />
                  </td>
                  <td className="px-3 py-2">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${STATUS_COLORS[task.status] ?? "bg-muted text-muted-foreground"}`}>
                      {task.status === "in_progress" && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
                      {task.status.replace(/_/g, " ")}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    {task.progress > 0 || task.status === "in_progress" ? (
                      <div className="flex items-center gap-2 min-w-16">
                        <div className="flex-1 bg-muted rounded-full h-1.5 min-w-12">
                          <div
                            className="bg-primary h-1.5 rounded-full transition-all"
                            style={{ width: `${task.progress}%` }}
                          />
                        </div>
                        <span className="text-xs text-muted-foreground shrink-0">{task.progress}%</span>
                      </div>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {task.photoId ? (
                      <Link
                        href={`~/image/${task.photoId}`}
                        className="inline-flex items-center gap-1 text-xs text-primary hover:underline font-mono"
                        title={task.photoId}
                        data-testid={`link-photo-${task.id}`}
                      >
                        <ImageIcon className="h-3 w-3 shrink-0" />
                        {task.photoId.slice(0, 8)}…
                      </Link>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {task.parentTaskId ? (
                      <Link
                        href={`/task/${task.parentTaskId}`}
                        className="inline-flex items-center gap-1 text-xs text-primary hover:underline font-mono"
                        title={task.parentTaskId}
                        data-testid={`link-parent-task-${task.id}`}
                      >
                        <ExternalLink className="h-3 w-3 shrink-0" />
                        {task.parentTaskId.slice(0, 8)}…
                      </Link>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">
                    {formatDate(task.createdAt)}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">
                    {formatDate(task.startedAt)}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">
                    {formatDate(task.completedAt)}
                  </td>
                  <td className="px-3 py-2">
                    {(task.status === "pending" || task.status === "in_progress") && (
                      <Button
                        size="icon"
                        variant="ghost"
                        className="text-destructive"
                        onClick={() => cancelTask.mutate(task.id)}
                        disabled={cancelTask.isPending}
                        data-testid={`button-cancel-task-${task.id}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-4">
          <span className="text-sm text-muted-foreground">
            {total} total — page {page} of {totalPages}
          </span>
          <div className="flex items-center gap-1">
            <Button
              size="icon"
              variant="ghost"
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page === 1}
              data-testid="button-prev-page"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              data-testid="button-next-page"
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
