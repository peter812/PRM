import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Maximize2, Trash2, ChevronLeft, ChevronRight, RefreshCw, Loader2, Image as ImageIcon, ExternalLink } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import type { ImageTaskGroup } from "@shared/schema";
import { ImageTaskGroupModal } from "@/components/image-task-group-modal";

type GroupWithCounts = ImageTaskGroup & {
  counts: {
    total: number;
    pending: number;
    in_progress: number;
    completed: number;
    failed: number;
    cancelled: number;
  };
};

type ImageTaskGroupsResponse = {
  items: GroupWithCounts[];
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

const KIND_LABELS: Record<string, string> = {
  social_import: "Social Import",
  story_run: "Story Run",
  tracking_job: "Post Tracking",
  message_import: "SMS Import",
  recognition_batch: "Recognition Batch",
  manual: "Manual",
  general: "General",
};

export default function ImageTasksSettingsPage() {
  const { isAdmin } = useAuth();
  const { toast } = useToast();
  const [page, setPage] = useState(1);
  const [kindFilter, setKindFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [modalGroupId, setModalGroupId] = useState<string | null>(null);
  const [groupToDelete, setGroupToDelete] = useState<GroupWithCounts | null>(null);
  const [showBulkDeleteDialog, setShowBulkDeleteDialog] = useState(false);

  const params = new URLSearchParams({ page: String(page), limit: "25" });
  if (kindFilter && kindFilter !== "all") params.set("kind", kindFilter);
  if (statusFilter && statusFilter !== "all") params.set("status", statusFilter);
  if (search.trim()) params.set("search", search.trim());

  const { data, isLoading, refetch, isFetching } = useQuery<ImageTaskGroupsResponse>({
    queryKey: ["/api/image-task-groups", page, kindFilter, statusFilter, search],
    queryFn: async () => {
      const res = await fetch(`/api/image-task-groups?${params.toString()}`);
      if (!res.ok) throw new Error("Failed to fetch image task groups");
      return res.json();
    },
    refetchInterval: (query) => {
      const items = query.state.data?.items ?? [];
      const hasActive = items.some((t) => t.status === "pending" || t.status === "in_progress");
      return hasActive ? 3000 : false;
    },
  });

  const handleToggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleSelectAll = () => {
    const items = data?.items ?? [];
    if (selectedIds.size === items.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(items.map((g) => g.id)));
    }
  };

  const deleteSingleMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/image-task-groups/${id}?permanent=true`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/image-task-groups"] });
      toast({ title: "Image task group deleted" });
      setGroupToDelete(null);
    },
    onError: () => toast({ title: "Failed to delete task group", variant: "destructive" }),
  });

  const cancelGroupMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/image-task-groups/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/image-task-groups"] });
      toast({ title: "Task group cancelled" });
    },
    onError: () => toast({ title: "Failed to cancel task group", variant: "destructive" }),
  });

  const bulkCancelMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      await apiRequest("POST", "/api/image-task-groups/bulk-cancel", { ids });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/image-task-groups"] });
      toast({ title: `Cancelled ${selectedIds.size} task group(s)` });
      setSelectedIds(new Set());
    },
    onError: () => toast({ title: "Failed to cancel selected task groups", variant: "destructive" }),
  });

  const bulkDeleteMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      await apiRequest("POST", "/api/image-task-groups/bulk-delete", { ids });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/image-task-groups"] });
      toast({ title: `Deleted ${selectedIds.size} task group(s)` });
      setSelectedIds(new Set());
      setShowBulkDeleteDialog(false);
    },
    onError: () => toast({ title: "Failed to delete selected task groups", variant: "destructive" }),
  });

  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const totalPages = data?.totalPages ?? 1;

  return (
    <div className="container max-w-full md:max-w-5xl py-3 md:py-8 px-4 md:pl-12">
      <div className="flex items-center justify-between gap-4 mb-6 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold" data-testid="text-image-tasks-title">Image Tasks</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Overarching image tasks — account imports, story scraping, and recognition batches.
          </p>
        </div>
      </div>

      {/* Bulk actions bar */}
      {selectedIds.size > 0 && (
        <div className="flex items-center justify-between gap-4 p-3 mb-4 bg-muted/60 rounded-md border" data-testid="image-tasks-bulk-bar">
          <span className="text-sm font-medium">
            {selectedIds.size} task group{selectedIds.size !== 1 ? "s" : ""} selected
          </span>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setSelectedIds(new Set())}
            >
              Clear selection
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => bulkCancelMutation.mutate(Array.from(selectedIds))}
              disabled={bulkCancelMutation.isPending}
              data-testid="button-bulk-cancel-groups"
            >
              {bulkCancelMutation.isPending && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
              Cancel selected
            </Button>
            {isAdmin && (
              <Button
                variant="destructive"
                size="sm"
                onClick={() => setShowBulkDeleteDialog(true)}
                disabled={bulkDeleteMutation.isPending}
                data-testid="button-bulk-delete-groups"
              >
                {bulkDeleteMutation.isPending && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
                Delete selected
              </Button>
            )}
          </div>
        </div>
      )}

      {/* Filters and controls */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <Input
          placeholder="Search task groups..."
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
          className="w-56 h-9"
          data-testid="input-search-groups"
        />

        <Select value={kindFilter} onValueChange={(v) => { setKindFilter(v); setPage(1); }}>
          <SelectTrigger className="w-44" data-testid="select-kind-filter">
            <SelectValue placeholder="All kinds" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All kinds</SelectItem>
            <SelectItem value="social_import">Social Import</SelectItem>
            <SelectItem value="story_run">Story Run</SelectItem>
            <SelectItem value="tracking_job">Post Tracking</SelectItem>
            <SelectItem value="message_import">SMS Import</SelectItem>
            <SelectItem value="recognition_batch">Recognition Batch</SelectItem>
            <SelectItem value="manual">Manual</SelectItem>
          </SelectContent>
        </Select>

        <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPage(1); }}>
          <SelectTrigger className="w-36" data-testid="select-status-filter">
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
          data-testid="button-refresh-image-tasks"
          title="Refresh task groups"
        >
          {isFetching ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
        </Button>
      </div>

      {/* Main Table */}
      {isLoading ? (
        <div className="flex items-center justify-center py-20 text-muted-foreground">
          <Loader2 className="h-6 w-6 animate-spin mr-2" /> Loading image tasks...
        </div>
      ) : items.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground text-sm border rounded-md">
          No image task groups found.
        </div>
      ) : (
        <div className="border rounded-md overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8"></TableHead>
                {isAdmin && (
                  <TableHead className="w-8">
                    <Checkbox
                      checked={selectedIds.size === items.length && items.length > 0}
                      onCheckedChange={handleSelectAll}
                      aria-label="Select all task groups"
                    />
                  </TableHead>
                )}
                <TableHead className="w-44">Started / Created</TableHead>
                <TableHead>Task Group</TableHead>
                <TableHead className="w-32">Kind</TableHead>
                <TableHead className="w-28">Status</TableHead>
                <TableHead className="text-right w-36">Completed / Total</TableHead>
                <TableHead className="text-right w-24">Failed</TableHead>
                {isAdmin && <TableHead className="w-12 text-right"></TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((group) => {
                const c = group.counts;
                const isSelected = selectedIds.has(group.id);
                const hasActive = group.status === "pending" || group.status === "in_progress";

                return (
                  <TableRow
                    key={group.id}
                    className="cursor-pointer hover:bg-muted/40"
                    onClick={() => setModalGroupId(group.id)}
                    data-testid={`row-group-${group.id}`}
                  >
                    <TableCell className="w-8" onClick={(e) => { e.stopPropagation(); setModalGroupId(group.id); }}>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-muted-foreground hover:text-foreground"
                        title="View subtasks"
                      >
                        <Maximize2 className="h-3.5 w-3.5" />
                      </Button>
                    </TableCell>
                    {isAdmin && (
                      <TableCell className="w-8" onClick={(e) => e.stopPropagation()}>
                        <Checkbox
                          checked={isSelected}
                          onCheckedChange={() => handleToggleSelect(group.id)}
                          aria-label={`Select task group ${group.id}`}
                        />
                      </TableCell>
                    )}
                    <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                      {new Date(group.createdAt).toLocaleString()}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col gap-0.5">
                        <span className="font-medium text-sm flex items-center gap-1.5">
                          {group.title}
                        </span>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          {group.parentTaskId && (
                            <Link
                              href={`/task/${group.parentTaskId}`}
                              className="hover:underline text-primary inline-flex items-center gap-0.5 font-mono"
                              onClick={(e) => e.stopPropagation()}
                            >
                              Parent: {group.parentTaskId.slice(0, 8)}… <ExternalLink className="h-2.5 w-2.5" />
                            </Link>
                          )}
                          {group.socialAccountId && (
                            <Link
                              href={`/social-accounts/${group.socialAccountId}`}
                              className="hover:underline text-primary inline-flex items-center gap-0.5"
                              onClick={(e) => e.stopPropagation()}
                            >
                              Account <ExternalLink className="h-2.5 w-2.5" />
                            </Link>
                          )}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {KIND_LABELS[group.kind] ?? group.kind}
                    </TableCell>
                    <TableCell>
                      <Badge variant={STATUS_VARIANT[group.status] ?? "outline"}>
                        {group.status === "in_progress" && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
                        {group.status.replace(/_/g, " ")}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right text-sm font-medium">
                      {c.completed} / {c.total}
                    </TableCell>
                    <TableCell className="text-right text-sm">
                      {c.failed > 0 ? (
                        <span className="text-destructive font-medium">{c.failed}</span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    {isAdmin && (
                      <TableCell className="text-right w-12" onClick={(e) => e.stopPropagation()}>
                        {hasActive ? (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-muted-foreground hover:text-destructive"
                            onClick={() => cancelGroupMutation.mutate(group.id)}
                            disabled={cancelGroupMutation.isPending}
                            title="Cancel task group"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        ) : (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-muted-foreground hover:text-destructive"
                            onClick={() => setGroupToDelete(group)}
                            title="Delete task group"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        )}
                      </TableCell>
                    )}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-4">
          <span className="text-sm text-muted-foreground">
            {total} group{total !== 1 ? "s" : ""} — page {page} of {totalPages}
          </span>
          <div className="flex items-center gap-1">
            <Button
              size="icon"
              variant="ghost"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {/* Subtask details modal */}
      <ImageTaskGroupModal
        groupId={modalGroupId}
        open={!!modalGroupId}
        onOpenChange={(open) => {
          if (!open) setModalGroupId(null);
        }}
      />

      {/* Delete Single Group Dialog */}
      <AlertDialog open={!!groupToDelete} onOpenChange={(open) => !open && setGroupToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete task group?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete this task group and all associated subtasks from history.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground"
              onClick={() => groupToDelete && deleteSingleMutation.mutate(groupToDelete.id)}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Bulk Delete Dialog */}
      <AlertDialog open={showBulkDeleteDialog} onOpenChange={setShowBulkDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {selectedIds.size} task group(s)?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete {selectedIds.size} task group(s) and all their subtasks. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground"
              onClick={() => bulkDeleteMutation.mutate(Array.from(selectedIds))}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
