import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Trash2, ChevronLeft, ChevronRight, Image as ImageIcon, ExternalLink, RefreshCw } from "lucide-react";
import { format } from "date-fns";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { ImageTask, ImageTaskGroup } from "@shared/schema";
import { imageDetailHref } from "@/lib/image-link";

interface ImageTaskGroupModalProps {
  groupId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type GroupWithCounts = ImageTaskGroup & {
  counts?: {
    total: number;
    pending: number;
    in_progress: number;
    completed: number;
    failed: number;
    cancelled: number;
  };
};

type GroupTasksResponse = {
  items: ImageTask[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
};

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  completed: "default",
  in_progress: "secondary",
  pending: "outline",
  failed: "destructive",
  cancelled: "outline",
};

const TYPE_LABELS: Record<string, string> = {
  download_img_instagram: "Download Instagram",
  analyze_img_full: "Analyze Full",
  analyze_img_face: "Analyze Face",
  analyze_img_ocr: "Analyze OCR",
  transcribe_video: "Transcribe Video",
  analyze_img_metadata: "Analyze Metadata",
  analyze_img_llm: "Analyze LLM",
  convert_img: "Convert Image",
};

function formatDuration(ms: number): string {
  if (ms < 0) ms = 0;
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

export function ImageTaskGroupModal({ groupId, open, onOpenChange }: ImageTaskGroupModalProps) {
  const { toast } = useToast();
  const [page, setPage] = useState(1);
  const [typeFilter, setTypeFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");

  // Fetch group metadata
  const { data: group } = useQuery<GroupWithCounts>({
    queryKey: [`/api/image-task-groups/${groupId}`],
    queryFn: async () => {
      const res = await fetch(`/api/image-task-groups/${groupId}`);
      if (!res.ok) throw new Error("Failed to fetch image task group");
      return res.json();
    },
    enabled: !!groupId && open,
    refetchInterval: (query) => {
      const g = query.state.data;
      const hasActive =
        g?.status === "pending" ||
        g?.status === "in_progress" ||
        Boolean(g?.counts && (g.counts.pending > 0 || g.counts.in_progress > 0));
      return hasActive ? 2500 : false;
    },
  });

  // Fetch tasks in this group
  const params = new URLSearchParams({ page: String(page), limit: "25" });
  if (typeFilter && typeFilter !== "all") params.set("type", typeFilter);
  if (statusFilter && statusFilter !== "all") params.set("status", statusFilter);

  const { data, isLoading, refetch, isFetching } = useQuery<GroupTasksResponse>({
    queryKey: [`/api/image-task-groups/${groupId}/tasks`, page, typeFilter, statusFilter],
    queryFn: async () => {
      const res = await fetch(`/api/image-task-groups/${groupId}/tasks?${params.toString()}`);
      if (!res.ok) throw new Error("Failed to fetch sub-tasks");
      return res.json();
    },
    enabled: !!groupId && open,
    refetchInterval: (query) => {
      const items = query.state.data?.items ?? [];
      const hasActive = items.some((t) => t.status === "pending" || t.status === "in_progress");
      return hasActive ? 2500 : false;
    },
  });

  const cancelSingleMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/image-tasks/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/image-task-groups/${groupId}`] });
      queryClient.invalidateQueries({ queryKey: [`/api/image-task-groups/${groupId}/tasks`] });
      queryClient.invalidateQueries({ queryKey: ["/api/image-task-groups"] });
      toast({ title: "Subtask cancelled" });
    },
    onError: () => toast({ title: "Failed to cancel subtask", variant: "destructive" }),
  });

  const cancelRemainingMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("DELETE", `/api/image-task-groups/${groupId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/image-task-groups/${groupId}`] });
      queryClient.invalidateQueries({ queryKey: [`/api/image-task-groups/${groupId}/tasks`] });
      queryClient.invalidateQueries({ queryKey: ["/api/image-task-groups"] });
      toast({ title: "Remaining tasks cancelled" });
    },
    onError: () => toast({ title: "Failed to cancel remaining tasks", variant: "destructive" }),
  });

  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const totalPages = data?.totalPages ?? 1;

  const hasActiveTasks =
    group?.status === "pending" ||
    group?.status === "in_progress" ||
    Boolean(group?.counts && (group.counts.pending > 0 || group.counts.in_progress > 0)) ||
    items.some((t) => t.status === "pending" || t.status === "in_progress");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[88vh] flex flex-col p-6 overflow-hidden">
        <DialogHeader className="shrink-0 space-y-1.5 pb-2 border-b">
          <div className="flex items-center justify-between gap-3 pr-6">
            <DialogTitle className="text-xl font-semibold flex items-center gap-2">
              <ImageIcon className="h-5 w-5 text-primary" />
              <span>{group?.title || "Image Task Group Details"}</span>
            </DialogTitle>
            {group?.status && (
              <Badge variant={STATUS_VARIANT[group.status] ?? "outline"}>
                {group.status.replace(/_/g, " ")}
              </Badge>
            )}
          </div>
          <DialogDescription className="text-xs text-muted-foreground flex items-center gap-4 flex-wrap">
            {group?.createdAt && (
              <span>Created: {new Date(group.createdAt).toLocaleString()}</span>
            )}
            {group?.kind && (
              <span className="capitalize">Kind: {group.kind.replace(/_/g, " ")}</span>
            )}
            {group?.parentTaskId && (
              <Link href={`/task/${group.parentTaskId}`} className="hover:underline text-primary inline-flex items-center gap-1">
                Parent Task: {group.parentTaskId.slice(0, 8)}… <ExternalLink className="h-3 w-3" />
              </Link>
            )}
          </DialogDescription>
          {group?.counts && group.counts.total > 0 && (
            <div className="pt-2">
              <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
                <span>
                  {group.counts.completed} / {group.counts.total} completed
                  {group.counts.failed > 0 && <span className="text-destructive font-medium ml-1.5">({group.counts.failed} failed)</span>}
                  {group.counts.in_progress > 0 && <span className="text-blue-500 font-medium ml-1.5">({group.counts.in_progress} running)</span>}
                  {group.counts.pending > 0 && <span className="text-amber-500 font-medium ml-1.5">({group.counts.pending} pending)</span>}
                </span>
                <span className="font-mono font-medium">
                  {Math.round((group.counts.completed / group.counts.total) * 100)}%
                </span>
              </div>
              <Progress value={(group.counts.completed / group.counts.total) * 100} className="h-1.5" />
            </div>
          )}
        </DialogHeader>

        {/* Filter bar */}
        <div className="flex flex-wrap items-center justify-between gap-2 py-3 shrink-0">
          <div className="flex items-center gap-2">
            <Select value={typeFilter} onValueChange={(v) => { setTypeFilter(v); setPage(1); }}>
              <SelectTrigger className="w-44 h-8 text-xs" data-testid="modal-select-type">
                <SelectValue placeholder="All types" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All types</SelectItem>
                <SelectItem value="download_img_instagram">Download Instagram</SelectItem>
                <SelectItem value="analyze_img_face">Analyze Face</SelectItem>
                <SelectItem value="analyze_img_ocr">Analyze OCR</SelectItem>
                <SelectItem value="transcribe_video">Transcribe Video</SelectItem>
                <SelectItem value="analyze_img_metadata">Analyze Metadata</SelectItem>
                <SelectItem value="analyze_img_llm">Analyze LLM</SelectItem>
                <SelectItem value="convert_img">Convert Image</SelectItem>
              </SelectContent>
            </Select>

            <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPage(1); }}>
              <SelectTrigger className="w-36 h-8 text-xs" data-testid="modal-select-status">
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
              className="h-8 w-8"
              onClick={() => refetch()}
              disabled={isFetching}
              title="Refresh subtasks"
            >
              {isFetching ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            </Button>
          </div>

          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              className="h-8 text-xs text-destructive border-destructive/30 hover:bg-destructive/10"
              onClick={() => cancelRemainingMutation.mutate()}
              disabled={cancelRemainingMutation.isPending || !hasActiveTasks}
              data-testid="modal-button-cancel-remaining"
            >
              {cancelRemainingMutation.isPending && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
              Cancel remaining
            </Button>
          </div>
        </div>

        {/* Subtask items table */}
        <div className="flex-1 overflow-y-auto border rounded-md min-h-60">
          {isLoading ? (
            <div className="flex items-center justify-center py-20 text-muted-foreground">
              <Loader2 className="h-6 w-6 animate-spin mr-2" /> Loading subtasks...
            </div>
          ) : items.length === 0 ? (
            <div className="flex items-center justify-center py-20 text-sm text-muted-foreground">
              No subtasks found matching filters.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50">
                  <TableHead className="w-36">Type</TableHead>
                  <TableHead className="w-28">Status</TableHead>
                  <TableHead className="w-28">Photo</TableHead>
                  <TableHead className="w-24">Started</TableHead>
                  <TableHead className="w-20">Duration</TableHead>
                  <TableHead>Outcome / Details</TableHead>
                  <TableHead className="w-12 text-right"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((task) => {
                  const result = (() => {
                    try { return JSON.parse(task.result || "{}"); } catch { return task.result; }
                  })();

                  return (
                    <TableRow key={task.id} data-testid={`modal-row-subtask-${task.id}`}>
                      <TableCell className="font-mono text-xs">
                        {TYPE_LABELS[task.type] ?? task.type}
                      </TableCell>
                      <TableCell>
                        <Badge variant={STATUS_VARIANT[task.status] ?? "outline"} className="text-xs">
                          {task.status === "in_progress" && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
                          {task.status.replace(/_/g, " ")}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {task.photoId ? (
                          <Link
                            href={`~${imageDetailHref(task.photoId, "/settings/image-tasks")}`}
                            className="inline-flex items-center gap-1 text-xs text-primary hover:underline font-mono"
                            title={task.photoId}
                          >
                            <ImageIcon className="h-3 w-3 shrink-0" />
                            {task.photoId.slice(0, 8)}…
                          </Link>
                        ) : (
                          <span className="text-muted-foreground text-xs">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                        {task.startedAt ? format(new Date(task.startedAt), "HH:mm:ss") : "—"}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                        {task.startedAt && task.completedAt
                          ? formatDuration(new Date(task.completedAt).getTime() - new Date(task.startedAt).getTime())
                          : task.status === "in_progress"
                          ? "Running…"
                          : "—"}
                      </TableCell>
                      <TableCell className="text-xs max-w-xs truncate">
                        {task.status === "failed" ? (
                          <span className="text-destructive font-mono text-xs">{task.result || "Task failed"}</span>
                        ) : typeof result === "object" && result !== null ? (
                          <span className="text-muted-foreground font-mono text-[11px] truncate block">
                            {result.skipped ? `Skipped: ${result.reason || ""}` : result.facesDetected !== undefined ? `${result.facesDetected} face(s) found` : JSON.stringify(result)}
                          </span>
                        ) : (
                          <span className="text-muted-foreground font-mono text-xs">{task.result || "—"}</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        {(task.status === "pending" || task.status === "in_progress") && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-muted-foreground hover:text-destructive"
                            onClick={() => cancelSingleMutation.mutate(task.id)}
                            disabled={cancelSingleMutation.isPending}
                            title="Cancel task"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </div>

        {/* Footer with pagination */}
        <div className="flex items-center justify-between pt-3 shrink-0 text-xs text-muted-foreground">
          <span>
            {total} subtask{total !== 1 ? "s" : ""} — page {page} of {totalPages}
          </span>
          <div className="flex items-center gap-1">
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
