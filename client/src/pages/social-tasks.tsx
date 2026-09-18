import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, ExternalLink, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { TRACKING_KIND_LABEL } from "@shared/interest-level";
import { RUNS_KEY, useStoryRuns, type RunItem, type StoryRun, type TrackItem } from "@/lib/instagram";

const finalOutcome = (i: RunItem) => i.prmOutcome ?? i.outcome;

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  completed: "default",
  starting: "secondary",
  running: "secondary",
  skipped: "secondary",
  rate_limited: "outline",
  unreachable: "outline",
  already_running: "outline",
  needs_login: "destructive",
  checkpoint: "destructive",
  no_username: "destructive",
  parse_failed: "destructive",
  error: "destructive",
};

function RunRow({
  run,
  isSelected,
  onToggleSelect,
  onDelete,
  isAdmin,
}: {
  run: StoryRun;
  isSelected: boolean;
  onToggleSelect: (id: string) => void;
  onDelete: (run: StoryRun) => void;
  isAdmin: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("all");
  const noAccount = run.items.filter((i) => finalOutcome(i) === "no_account").length;
  const items = filter === "all" ? run.items : run.items.filter((i) => finalOutcome(i) === filter);
  const outcomes = Array.from(new Set(run.items.map(finalOutcome))).sort();
  const c = run.counts;

  return (
    <>
      <TableRow className="cursor-pointer" onClick={() => setOpen((o) => !o)} data-testid={`row-run-${run.id}`}>
        <TableCell className="w-8">{open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</TableCell>
        {isAdmin && (
          <TableCell className="w-8" onClick={(e) => e.stopPropagation()}>
            <Checkbox
              checked={isSelected}
              onCheckedChange={() => onToggleSelect(run.id)}
              aria-label={`Select run ${run.id}`}
              data-testid={`checkbox-run-${run.id}`}
            />
          </TableCell>
        )}
        <TableCell>{new Date(run.startedAt).toLocaleString()}</TableCell>
        <TableCell className="text-muted-foreground">{run.importerLabel ?? "—"}</TableCell>
        <TableCell className="text-muted-foreground">{run.kind}</TableCell>
        <TableCell><Badge variant={STATUS_VARIANT[run.status] ?? "outline"}>{run.status}</Badge></TableCell>
        {run.kind === "tracking" ? (
          <>
            <TableCell className="text-right">{c.completed ?? 0} / {c.jobs ?? 0}</TableCell>
            <TableCell className="text-right">{c.skipped ?? 0}</TableCell>
            <TableCell className="text-right">{c.failed ?? 0}</TableCell>
            <TableCell className="text-right">—</TableCell>
          </>
        ) : (
          <>
            <TableCell className="text-right">{c.accountsOpened ?? 0} / {c.accountsInTray ?? 0}</TableCell>
            <TableCell className="text-right">{c.storiesSeen ?? 0}</TableCell>
            <TableCell className="text-right">{c.imagesSaved ?? 0}</TableCell>
            <TableCell className="text-right">{noAccount}</TableCell>
          </>
        )}
        {isAdmin && (
          <TableCell className="text-right w-12" onClick={(e) => e.stopPropagation()}>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-muted-foreground hover:text-destructive"
              onClick={() => onDelete(run)}
              title="Delete run"
              data-testid={`button-delete-run-${run.id}`}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </TableCell>
        )}
      </TableRow>
      {open && (
        <TableRow>
          <TableCell colSpan={isAdmin ? 11 : 9} className="bg-muted/30 p-4">
            {run.error && <p className="text-sm text-destructive mb-3">{run.error}</p>}
            {run.kind === "tracking" ? (
              <TrackItems items={run.items as unknown as TrackItem[]} />
            ) : run.items.length === 0 ? (
              <p className="text-sm text-muted-foreground">No stories recorded for this run.</p>
            ) : (
              <>
                <Select value={filter} onValueChange={setFilter}>
                  <SelectTrigger className="w-56 mb-3" data-testid="select-outcome-filter">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All outcomes ({run.items.length})</SelectItem>
                    {outcomes.map((o) => (
                      <SelectItem key={o} value={o}>{o} ({run.items.filter((i) => finalOutcome(i) === o).length})</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <div className="max-h-96 overflow-y-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Account</TableHead>
                        <TableHead>Posted</TableHead>
                        <TableHead>Outcome</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {items.map((i, idx) => (
                        <TableRow key={`${i.username}-${i.storyPk ?? idx}`}>
                          <TableCell>
                            {i.accountId ? (
                              <Link
                                href={`~/social-accounts/${i.accountId}?tab=stories${i.storyPk ? `&storyPk=${i.storyPk}` : ""}`}
                                className="inline-flex items-center gap-1 font-medium hover:underline text-primary"
                                data-testid={`link-account-${i.username}`}
                              >
                                @{i.username}
                              </Link>
                            ) : (
                              <span className="inline-flex items-center gap-1.5 text-muted-foreground" data-testid={`text-no-account-${i.username}`}>
                                @{i.username}
                                <a
                                  href={`https://www.instagram.com/${i.username}/`}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="inline-flex items-center text-muted-foreground hover:text-foreground"
                                  title="Open in Instagram (account not in PRM)"
                                >
                                  <ExternalLink className="h-3 w-3" />
                                </a>
                              </span>
                            )}
                          </TableCell>
                          <TableCell>{i.takenAt ? new Date(i.takenAt).toLocaleString() : "—"}</TableCell>
                          <TableCell>{finalOutcome(i)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </>
            )}
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

function TrackItems({ items }: { items: TrackItem[] }) {
  if (items.length === 0) return <p className="text-sm text-muted-foreground">No jobs recorded for this run.</p>;
  return (
    <div className="max-h-96 overflow-y-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Account</TableHead>
            <TableHead>Job</TableHead>
            <TableHead>Outcome</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((i) => (
            <TableRow key={i.jobId}>
              <TableCell>
                {i.accountId ? (
                  <Link href={`~/social-accounts/${i.accountId}`} className="font-medium hover:underline text-primary">@{i.username}</Link>
                ) : (
                  <span className="text-muted-foreground">@{i.username}</span>
                )}
              </TableCell>
              <TableCell>{TRACKING_KIND_LABEL[i.kind] ?? i.kind}</TableCell>
              <TableCell>
                {i.outcome}
                {i.reason ? ` (${i.reason})` : ""}
                {i.error && <span className="text-destructive"> — {i.error}</span>}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export default function SocialTasksPage() {
  const { isAdmin } = useAuth();
  const { toast } = useToast();
  const { data: runs = [], isLoading } = useStoryRuns();

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [runToDelete, setRunToDelete] = useState<StoryRun | null>(null);
  const [showBulkDeleteDialog, setShowBulkDeleteDialog] = useState(false);

  const handleToggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleSelectAll = () => {
    if (selectedIds.size === runs.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(runs.map((r) => r.id)));
    }
  };

  const deleteSingleMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/stories/runs/${id}`);
    },
    onSuccess: () => {
      toast({ title: "Run deleted", description: "The run log has been removed." });
      setRunToDelete(null);
      if (runToDelete) {
        setSelectedIds((prev) => {
          const next = new Set(prev);
          next.delete(runToDelete.id);
          return next;
        });
      }
      queryClient.invalidateQueries({ queryKey: RUNS_KEY });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to delete run", description: error.message, variant: "destructive" });
    },
  });

  const deleteBulkMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      const res = await apiRequest("POST", "/api/stories/runs/bulk-delete", { ids });
      return res.json();
    },
    onSuccess: (data: { deletedCount: number }) => {
      toast({
        title: "Runs deleted",
        description: `Successfully deleted ${data.deletedCount} run ${data.deletedCount === 1 ? "log" : "logs"}.`,
      });
      setSelectedIds(new Set());
      setShowBulkDeleteDialog(false);
      queryClient.invalidateQueries({ queryKey: RUNS_KEY });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to delete runs", description: error.message, variant: "destructive" });
    },
  });

  return (
    <div className="container max-w-full md:max-w-5xl py-3 md:py-8 px-4 md:pl-12">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-6">
        <div>
          <h1 className="text-2xl font-semibold" data-testid="text-social-tasks-title">Social Tasks</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Expand a stories run to see every story it saw, including the ones dropped because no social account exists
            for the poster (<code>no_account</code>); a tracking run lists its jobs.
          </p>
        </div>
        {isAdmin && selectedIds.size > 0 && (
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">{selectedIds.size} selected</span>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => setShowBulkDeleteDialog(true)}
              disabled={deleteBulkMutation.isPending}
              data-testid="button-delete-selected-runs"
            >
              <Trash2 className="h-4 w-4 mr-1.5" />
              Delete selected ({selectedIds.size})
            </Button>
          </div>
        )}
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-8" />
            {isAdmin && (
              <TableHead className="w-8">
                <Checkbox
                  checked={runs.length > 0 && selectedIds.size === runs.length}
                  onCheckedChange={handleSelectAll}
                  aria-label="Select all runs"
                  data-testid="checkbox-select-all-runs"
                />
              </TableHead>
            )}
            <TableHead>Started</TableHead>
            <TableHead>Importer</TableHead>
            <TableHead>Kind</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Accounts / jobs</TableHead>
            <TableHead className="text-right">Seen / skipped</TableHead>
            <TableHead className="text-right">Saved / failed</TableHead>
            <TableHead className="text-right">No account</TableHead>
            {isAdmin && <TableHead className="w-12 text-right">Actions</TableHead>}
          </TableRow>
        </TableHeader>
        <TableBody>
          {isLoading ? (
            <TableRow><TableCell colSpan={isAdmin ? 11 : 9} className="text-center py-8 text-muted-foreground">Loading…</TableCell></TableRow>
          ) : runs.length === 0 ? (
            <TableRow><TableCell colSpan={isAdmin ? 11 : 9} className="text-center py-8 text-muted-foreground">No runs delivered yet.</TableCell></TableRow>
          ) : (
            runs.map((run) => (
              <RunRow
                key={run.id}
                run={run}
                isSelected={selectedIds.has(run.id)}
                onToggleSelect={handleToggleSelect}
                onDelete={(r) => setRunToDelete(r)}
                isAdmin={Boolean(isAdmin)}
              />
            ))
          )}
        </TableBody>
      </Table>

      {/* Delete Single Run Dialog */}
      <AlertDialog open={!!runToDelete} onOpenChange={(open) => !open && setRunToDelete(null)}>
        <AlertDialogContent data-testid="dialog-delete-single-run">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete story run?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete the run from{" "}
              <strong>{runToDelete ? new Date(runToDelete.startedAt).toLocaleString() : ""}</strong>?
              This will remove the run log. Any stories and photos that were saved to PRM will not be deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete-run">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => runToDelete && deleteSingleMutation.mutate(runToDelete.id)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleteSingleMutation.isPending}
              data-testid="button-confirm-delete-run"
            >
              {deleteSingleMutation.isPending ? "Deleting…" : "Delete run"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Bulk Delete Runs Dialog */}
      <AlertDialog open={showBulkDeleteDialog} onOpenChange={setShowBulkDeleteDialog}>
        <AlertDialogContent data-testid="dialog-delete-bulk-runs">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {selectedIds.size} story {selectedIds.size === 1 ? "run" : "runs"}?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete {selectedIds.size} selected run {selectedIds.size === 1 ? "log" : "logs"}?
              This action cannot be undone. Any stories and photos that were saved to PRM will not be deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-bulk-delete">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteBulkMutation.mutate(Array.from(selectedIds))}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleteBulkMutation.isPending}
              data-testid="button-confirm-bulk-delete"
            >
              {deleteBulkMutation.isPending ? "Deleting…" : `Delete ${selectedIds.size} ${selectedIds.size === 1 ? "run" : "runs"}`}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
