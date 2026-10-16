import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Image as ImageIcon, Search, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Link } from "wouter";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useDebounce } from "@/hooks/use-debounce";
import { TRACKING_KINDS, TRACKING_KIND_LABEL, type TrackingKind } from "@shared/interest-level";
import { ImageTaskGroupModal } from "@/components/image-task-group-modal";

/** One row of GET /api/tracking/jobs. */
interface TaskRow {
  id: string;
  socialAccountId: string;
  username: string;
  kind: TrackingKind;
  status: string;
  result: { reason?: string } | null;
  error: string | null;
  createdAt: string;
  imageTaskGroupId: string | null;
}

const JOBS_KEY = ["/api/tracking/jobs"];
const STATUSES = ["queued", "running", "completed", "skipped", "failed"];

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  completed: "default",
  queued: "outline",
  running: "secondary",
  skipped: "secondary",
  failed: "destructive",
};

function OutcomeChip({ task }: { task: TaskRow }) {
  const detail = [task.result?.reason, task.error].filter(Boolean).join(" — ");
  const chip = <Badge variant={STATUS_VARIANT[task.status] ?? "outline"}>{task.status}</Badge>;
  if (!detail) return chip;
  return (
    <Tooltip>
      <TooltipTrigger asChild><span className="cursor-help">{chip}</span></TooltipTrigger>
      <TooltipContent className="max-w-sm">{detail}</TooltipContent>
    </Tooltip>
  );
}

export default function SocialTasksPage() {
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [kind, setKind] = useState("all");
  const [status, setStatus] = useState("all");
  const q = useDebounce(search.trim(), 300);

  const { data: tasks = [], isLoading } = useQuery<TaskRow[]>({
    queryKey: [...JOBS_KEY, { q: q || undefined, kind: kind === "all" ? undefined : kind, status: status === "all" ? undefined : status }],
    refetchInterval: (query) => (query.state.data?.some((t) => t.status === "queued" || t.status === "running") ? 10_000 : false),
  });
  const removable = tasks.filter((t) => t.status !== "running");

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [taskToDelete, setTaskToDelete] = useState<TaskRow | null>(null);
  const [showBulkDeleteDialog, setShowBulkDeleteDialog] = useState(false);
  const [showDeleteAllDialog, setShowDeleteAllDialog] = useState(false);
  const [modalGroupId, setModalGroupId] = useState<string | null>(null);

  const handleToggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const allSelected = removable.length > 0 && removable.every((t) => selectedIds.has(t.id));
  const handleSelectAll = () => setSelectedIds(allSelected ? new Set() : new Set(removable.map((t) => t.id)));

  const deleteSingleMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/tracking/jobs/${id}`);
      return id;
    },
    onSuccess: (id) => {
      toast({ title: "Task removed" });
      setTaskToDelete(null);
      setSelectedIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      queryClient.invalidateQueries({ queryKey: JOBS_KEY });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to remove task", description: error.message, variant: "destructive" });
    },
  });

  // No ids removes every task, not just the ones listed.
  const deleteBulkMutation = useMutation({
    mutationFn: async (ids?: string[]) => {
      const res = ids
        ? await apiRequest("POST", "/api/tracking/jobs/bulk-delete", { ids })
        : await apiRequest("DELETE", "/api/tracking/jobs");
      return res.json();
    },
    onSuccess: (data: { deletedCount: number }) => {
      toast({ title: "Tasks removed", description: `Removed ${data.deletedCount} ${data.deletedCount === 1 ? "task" : "tasks"}.` });
      setSelectedIds(new Set());
      setShowBulkDeleteDialog(false);
      setShowDeleteAllDialog(false);
      queryClient.invalidateQueries({ queryKey: JOBS_KEY });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to remove tasks", description: error.message, variant: "destructive" });
    },
  });

  return (
    <div className="container max-w-full md:max-w-5xl py-3 md:py-8 px-4 md:pl-12">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-4">
        <div>
          <h1 className="text-2xl font-semibold" data-testid="text-social-tasks-title">Social Tasks</h1>
          <p className="text-sm text-muted-foreground mt-1">Every tracking job, newest first. A run works a few at a time; the rest stay queued and can be removed until their turn. Hover an outcome to see why it was skipped or failed.</p>
        </div>
        <div className="flex gap-2">
          {selectedIds.size > 0 && (
            <Button
              variant="destructive"
              size="sm"
              onClick={() => setShowBulkDeleteDialog(true)}
              disabled={deleteBulkMutation.isPending}
              data-testid="button-delete-selected-tasks"
            >
              <Trash2 className="h-4 w-4 mr-1.5" />
              Remove selected ({selectedIds.size})
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowDeleteAllDialog(true)}
            disabled={deleteBulkMutation.isPending || removable.length === 0}
            data-testid="button-delete-all-tasks"
          >
            <Trash2 className="h-4 w-4 mr-1.5" />
            Remove all
          </Button>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-2 mb-4">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by account name"
            className="pl-8"
            data-testid="input-search-tasks"
          />
        </div>
        <Select value={kind} onValueChange={setKind}>
          <SelectTrigger className="sm:w-48" data-testid="select-task-kind"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All job types</SelectItem>
            {TRACKING_KINDS.map((k) => <SelectItem key={k} value={k}>{TRACKING_KIND_LABEL[k]}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="sm:w-40" data-testid="select-task-status"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All outcomes</SelectItem>
            {STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-8">
              <Checkbox checked={allSelected} onCheckedChange={handleSelectAll} aria-label="Select all tasks" data-testid="checkbox-select-all-tasks" />
            </TableHead>
            <TableHead>Account</TableHead>
            <TableHead>Job type</TableHead>
            <TableHead>Outcome</TableHead>
            <TableHead>Images</TableHead>
            <TableHead>Date</TableHead>
            <TableHead className="w-12" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {isLoading ? (
            <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">Loading…</TableCell></TableRow>
          ) : tasks.length === 0 ? (
            <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">No tasks found.</TableCell></TableRow>
          ) : (
            tasks.map((t) => (
              <TableRow key={t.id} data-testid={`row-task-${t.id}`}>
                <TableCell>
                  <Checkbox
                    checked={selectedIds.has(t.id)}
                    onCheckedChange={() => handleToggleSelect(t.id)}
                    disabled={t.status === "running"}
                    aria-label={`Select task ${t.id}`}
                  />
                </TableCell>
                <TableCell>
                  <Link href={`~/social-accounts/${t.socialAccountId}`} className="font-medium text-primary hover:underline" data-testid={`link-account-${t.username}`}>
                    @{t.username}
                  </Link>
                </TableCell>
                <TableCell className="text-muted-foreground">{TRACKING_KIND_LABEL[t.kind] ?? t.kind}</TableCell>
                <TableCell><OutcomeChip task={t} /></TableCell>
                <TableCell>
                  {t.imageTaskGroupId ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 px-1.5 text-xs font-semibold text-primary gap-1"
                      onClick={() => setModalGroupId(t.imageTaskGroupId)}
                      title="View Image Tasks"
                      data-testid={`button-image-tasks-${t.id}`}
                    >
                      <ImageIcon className="h-3 w-3" />
                      Images
                    </Button>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell className="text-muted-foreground whitespace-nowrap">{new Date(t.createdAt).toLocaleString()}</TableCell>
                <TableCell className="text-right">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-muted-foreground hover:text-destructive"
                    onClick={() => setTaskToDelete(t)}
                    disabled={t.status === "running"}
                    title={t.status === "running" ? "Can't remove a running task" : "Remove task"}
                    data-testid={`button-delete-task-${t.id}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>

      <AlertDialog open={!!taskToDelete} onOpenChange={(open) => !open && setTaskToDelete(null)}>
        <AlertDialogContent data-testid="dialog-delete-task">
          <AlertDialogHeader>
            <AlertDialogTitle>Remove task?</AlertDialogTitle>
            <AlertDialogDescription>
              Remove the {taskToDelete ? TRACKING_KIND_LABEL[taskToDelete.kind] : ""} task for <strong>@{taskToDelete?.username}</strong>?
              Anything it saved to PRM stays.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => taskToDelete && deleteSingleMutation.mutate(taskToDelete.id)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleteSingleMutation.isPending}
              data-testid="button-confirm-delete-task"
            >
              {deleteSingleMutation.isPending ? "Removing…" : "Remove"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={showBulkDeleteDialog} onOpenChange={setShowBulkDeleteDialog}>
        <AlertDialogContent data-testid="dialog-delete-bulk-tasks">
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {selectedIds.size} {selectedIds.size === 1 ? "task" : "tasks"}?</AlertDialogTitle>
            <AlertDialogDescription>Anything they saved to PRM stays. Running tasks are skipped.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteBulkMutation.mutate(Array.from(selectedIds))}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleteBulkMutation.isPending}
              data-testid="button-confirm-bulk-delete"
            >
              {deleteBulkMutation.isPending ? "Removing…" : "Remove"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={showDeleteAllDialog} onOpenChange={setShowDeleteAllDialog}>
        <AlertDialogContent data-testid="dialog-delete-all-tasks">
          <AlertDialogHeader>
            <AlertDialogTitle>Remove all social tasks?</AlertDialogTitle>
            <AlertDialogDescription>
              Removes every task, including ones hidden by the current filters. Anything they saved to PRM stays. Running tasks are skipped.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteBulkMutation.mutate(undefined)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleteBulkMutation.isPending}
              data-testid="button-confirm-delete-all"
            >
              {deleteBulkMutation.isPending ? "Removing…" : "Remove all"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <ImageTaskGroupModal groupId={modalGroupId} open={!!modalGroupId} onOpenChange={(open) => !open && setModalGroupId(null)} />
    </div>
  );
}
