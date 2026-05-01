import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { RefreshCw, Play, Loader2, CheckCircle2, XCircle, Clock, Zap, X, Trash2, Pause, CirclePlay } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Task } from "@shared/schema";

type BriefAccount = {
  id: string;
  username: string;
  nickname: string | null;
};

function getTaskLabel(type: string): string {
  switch (type) {
    case "refresh_follower_count":
      return "Follower Count Refresh";
    case "mass_refresh_follower_count":
      return "Mass Follower Count Refresh";
    case "get_img":
      return "Image Download";
    case "transfer_images_to_local":
      return "Transfer Images to Local";
    case "transfer_images_to_s3":
      return "Transfer Images to S3";
    case "import_instagram":
      return "Instagram Import";
    default:
      return type;
  }
}

function TaskStatusBadge({ status }: { status: string }) {
  switch (status) {
    case "pending":
      return (
        <Badge variant="secondary" data-testid={`badge-status-${status}`}>
          <Clock className="h-3 w-3 mr-1" />
          Waiting
        </Badge>
      );
    case "in_progress":
      return (
        <Badge variant="default" data-testid={`badge-status-${status}`}>
          <Loader2 className="h-3 w-3 mr-1 animate-spin" />
          Running
        </Badge>
      );
    case "completed":
      return (
        <Badge variant="outline" className="text-green-600 border-green-600" data-testid={`badge-status-${status}`}>
          <CheckCircle2 className="h-3 w-3 mr-1" />
          Finished
        </Badge>
      );
    case "failed":
      return (
        <Badge variant="destructive" data-testid={`badge-status-${status}`}>
          <XCircle className="h-3 w-3 mr-1" />
          Failed
        </Badge>
      );
    case "cancelled":
      return (
        <Badge variant="outline" className="text-muted-foreground" data-testid={`badge-status-${status}`}>
          <XCircle className="h-3 w-3 mr-1" />
          Cancelled
        </Badge>
      );
    default:
      return <Badge variant="secondary">{status}</Badge>;
  }
}

function TaskResultDisplay({ task }: { task: Task }) {
  if (!task.result) return null;
  try {
    const result = JSON.parse(task.result);
    if (task.type === "refresh_follower_count") {
      return (
        <span className="text-xs text-muted-foreground" data-testid={`text-task-result-${task.id}`}>
          Followers: {result.followerCount}, Following: {result.followingCount}
        </span>
      );
    }
    if (task.type === "mass_refresh_follower_count") {
      return (
        <span className="text-xs text-muted-foreground" data-testid={`text-task-result-${task.id}`}>
          Refreshed: {result.refreshed}, Skipped: {result.skipped}, Total: {result.total}
        </span>
      );
    }
    if (task.type === "transfer_images_to_local" || task.type === "transfer_images_to_s3") {
      return (
        <span className="text-xs text-muted-foreground" data-testid={`text-task-result-${task.id}`}>
          Transferred: {result.transferred}, Failed: {result.failed}, Total: {result.total}
          {result.cancelled && " (cancelled)"}
        </span>
      );
    }
    if (task.type === "import_instagram") {
      return (
        <span className="text-xs text-muted-foreground" data-testid={`text-task-result-${task.id}`}>
          Imported: {result.imported}, Updated: {result.updated}, Total: {result.total}
          {result.cancelled && " (cancelled)"}
        </span>
      );
    }
    return null;
  } catch {
    if (task.status === "failed") {
      return (
        <span className="text-xs text-destructive" data-testid={`text-task-error-${task.id}`}>
          {task.result}
        </span>
      );
    }
    return null;
  }
}

export default function TasksSettingsPage() {
  const { toast } = useToast();
  const [selectedAccountId, setSelectedAccountId] = useState<string>("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  const { data: tasks = [], isLoading: tasksLoading } = useQuery<Task[]>({
    queryKey: ["/api/tasks"],
    refetchInterval: (query) => {
      const data = query.state.data as Task[] | undefined;
      if (data?.some(t => t.status === "pending" || t.status === "in_progress")) {
        return 3000;
      }
      return false;
    },
  });

  const { data: briefAccounts = [] } = useQuery<BriefAccount[]>({
    queryKey: ["/api/tasks", "social-accounts-brief"],
  });

  const { data: workerStatus, refetch: refetchWorkerStatus } = useQuery<{ paused: boolean }>({
    queryKey: ["/api/tasks/worker-status"],
    refetchInterval: 5000,
  });

  const isPaused = workerStatus?.paused ?? false;
  const hasActiveTasks = tasks.some(t => t.status === "pending" || t.status === "in_progress");

  const selectedAccount = selectedAccountId
    ? briefAccounts.find(a => a.id === selectedAccountId)
    : null;

  const massRefreshMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/tasks/mass-refresh-follower-count");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
      toast({ title: "Mass refresh started", description: "All social account follower counts will be refreshed." });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to start mass refresh", description: error.message, variant: "destructive" });
    },
  });

  const singleRefreshMutation = useMutation({
    mutationFn: async (socialAccountId: string) => {
      const res = await apiRequest("POST", `/api/tasks/refresh-follower-count/${socialAccountId}`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
      toast({ title: "Refresh started", description: "Follower count refresh task has been queued." });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to start refresh", description: error.message, variant: "destructive" });
    },
  });

  const cancelTaskMutation = useMutation({
    mutationFn: async (taskId: string) => {
      const res = await apiRequest("DELETE", `/api/tasks/${taskId}`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
      toast({ title: "Task cancelled", description: "The task has been terminated." });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to cancel task", description: error.message, variant: "destructive" });
    },
  });

  const pauseMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/tasks/pause");
      return res.json();
    },
    onSuccess: () => {
      refetchWorkerStatus();
      toast({ title: "Worker paused", description: "No new tasks will be processed until resumed." });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to pause worker", description: error.message, variant: "destructive" });
    },
  });

  const unpauseMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/tasks/unpause");
      return res.json();
    },
    onSuccess: () => {
      refetchWorkerStatus();
      queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
      toast({ title: "Worker resumed", description: "Tasks will now be processed." });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to resume worker", description: error.message, variant: "destructive" });
    },
  });

  const deleteAllMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("DELETE", "/api/tasks");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
      toast({ title: "All tasks removed", description: "The task list has been cleared." });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to remove tasks", description: error.message, variant: "destructive" });
    },
  });

  const handleSingleRefresh = () => {
    if (!selectedAccountId) {
      toast({ title: "No account selected", description: "Please select a social account first.", variant: "destructive" });
      return;
    }
    singleRefreshMutation.mutate(selectedAccountId);
  };

  return (
    <div className="container max-w-full md:max-w-3xl py-3 md:py-8 px-4 md:pl-12 mx-auto md:mx-0">
      <div className="flex items-center justify-between gap-4 flex-wrap mb-6">
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold" data-testid="text-tasks-title">Tasks</h1>
          <p className="text-muted-foreground">
            Run background tasks and monitor their progress.
          </p>
        </div>
        <Button
          onClick={() => massRefreshMutation.mutate()}
          disabled={massRefreshMutation.isPending}
          data-testid="button-mass-refresh"
        >
          {massRefreshMutation.isPending ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <Zap className="h-4 w-4 mr-2" />
          )}
          Mass Follower Count Refresh
        </Button>
      </div>

      <div className="space-y-6">
        <Card data-testid="card-available-tasks">
          <CardHeader>
            <CardTitle className="text-lg">Available Tasks</CardTitle>
            <CardDescription>Select and run background tasks on your social accounts.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-col gap-4">
              <div className="space-y-3">
                <h3 className="text-sm font-medium" data-testid="text-single-refresh-label">Single Account Follower Count Refresh</h3>
                <p className="text-xs text-muted-foreground">
                  Recalculate the follower and following count for a specific social account.
                </p>
                <div className="flex items-center gap-2 flex-wrap">
                  <div className="relative">
                    {selectedAccountId && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="absolute left-0 top-0 z-10"
                        onClick={() => setSelectedAccountId("")}
                        data-testid="button-clear-account"
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    )}
                    <Popover open={searchOpen} onOpenChange={(open) => { setSearchOpen(open); if (!open) setSearchQuery(""); }}>
                      <PopoverTrigger asChild>
                        <Button
                          variant="outline"
                          className="w-[280px] justify-start text-left font-normal"
                          style={{ paddingLeft: selectedAccountId ? "2.5rem" : undefined }}
                          data-testid="button-account-search"
                        >
                          {selectedAccount
                            ? (selectedAccount.nickname || selectedAccount.username)
                            : "Select account..."}
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-80 p-0" align="start">
                        <Command shouldFilter={false}>
                          <CommandInput
                            placeholder="Type 3+ characters to search..."
                            value={searchQuery}
                            onValueChange={setSearchQuery}
                            data-testid="input-account-search"
                          />
                          <CommandList>
                            {searchQuery.length > 0 && searchQuery.length < 3 && (
                              <div className="p-3 text-sm text-muted-foreground text-center">
                                Type {3 - searchQuery.length} more character{3 - searchQuery.length > 1 ? "s" : ""} to search...
                              </div>
                            )}
                            {searchQuery.length >= 3 && (() => {
                              const query = searchQuery.toLowerCase();
                              const filtered = briefAccounts.filter(a =>
                                a.username.toLowerCase().includes(query) ||
                                (a.nickname && a.nickname.toLowerCase().includes(query))
                              ).slice(0, 50);
                              if (filtered.length === 0) return <CommandEmpty>No account found.</CommandEmpty>;
                              return (
                                <CommandGroup>
                                  {filtered.map((account) => (
                                    <CommandItem
                                      key={account.id}
                                      value={account.id}
                                      onSelect={() => {
                                        setSelectedAccountId(account.id);
                                        setSearchOpen(false);
                                        setSearchQuery("");
                                      }}
                                      data-testid={`option-account-${account.id}`}
                                    >
                                      {account.nickname || account.username}
                                      {account.nickname && (
                                        <span className="ml-1 text-muted-foreground">@{account.username}</span>
                                      )}
                                    </CommandItem>
                                  ))}
                                </CommandGroup>
                              );
                            })()}
                          </CommandList>
                        </Command>
                      </PopoverContent>
                    </Popover>
                  </div>
                  <Button
                    onClick={handleSingleRefresh}
                    disabled={!selectedAccountId || singleRefreshMutation.isPending}
                    variant="outline"
                    data-testid="button-single-refresh"
                  >
                    {singleRefreshMutation.isPending ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <RefreshCw className="h-4 w-4 mr-2" />
                    )}
                    Refresh
                  </Button>
                </div>
              </div>

              <div className="border-t pt-4 space-y-3">
                <h3 className="text-sm font-medium" data-testid="text-mass-refresh-label">Mass Follower Count Refresh</h3>
                <p className="text-xs text-muted-foreground">
                  Recalculate follower and following counts for all social accounts at once.
                </p>
                <Button
                  onClick={() => massRefreshMutation.mutate()}
                  disabled={massRefreshMutation.isPending}
                  variant="outline"
                  data-testid="button-mass-refresh-card"
                >
                  {massRefreshMutation.isPending ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Play className="h-4 w-4 mr-2" />
                  )}
                  Run Mass Refresh
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card data-testid="card-task-list">
          <CardHeader>
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div>
                <CardTitle className="text-lg">Task History</CardTitle>
                <CardDescription>
                  {isPaused
                    ? "Worker is paused — tasks will not be processed."
                    : hasActiveTasks
                    ? "Tasks are running — list updates automatically."
                    : "Recent task activity."}
                </CardDescription>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                {hasActiveTasks && !isPaused && (
                  <Badge variant="secondary" data-testid="badge-active-tasks">
                    <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                    Active
                  </Badge>
                )}
                {isPaused && (
                  <Badge variant="outline" className="text-muted-foreground" data-testid="badge-worker-paused">
                    <Pause className="h-3 w-3 mr-1" />
                    Paused
                  </Badge>
                )}
                <Button
                  size="icon"
                  variant="outline"
                  onClick={() => isPaused ? unpauseMutation.mutate() : pauseMutation.mutate()}
                  disabled={pauseMutation.isPending || unpauseMutation.isPending}
                  data-testid="button-toggle-pause"
                  title={isPaused ? "Resume worker" : "Pause worker"}
                >
                  {pauseMutation.isPending || unpauseMutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : isPaused ? (
                    <CirclePlay className="h-4 w-4" />
                  ) : (
                    <Pause className="h-4 w-4" />
                  )}
                </Button>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button
                      size="icon"
                      variant="outline"
                      className="text-destructive"
                      disabled={tasks.length === 0 || deleteAllMutation.isPending}
                      data-testid="button-delete-all-tasks"
                      title="Remove all tasks"
                    >
                      {deleteAllMutation.isPending ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Trash2 className="h-4 w-4" />
                      )}
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Remove all tasks?</AlertDialogTitle>
                      <AlertDialogDescription>
                        This will permanently delete all {tasks.length} task{tasks.length !== 1 ? "s" : ""} from the history, including any pending or running ones. This cannot be undone.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={() => deleteAllMutation.mutate()}
                        className="bg-destructive text-destructive-foreground"
                        data-testid="button-confirm-delete-all"
                      >
                        Remove all
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {tasksLoading ? (
              <div className="flex items-center justify-center py-8" data-testid="loading-tasks">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : tasks.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8" data-testid="text-no-tasks">
                No tasks have been run yet.
              </p>
            ) : (
              <div className="space-y-2">
                {tasks.map((task) => (
                  <div
                    key={task.id}
                    className="flex items-center justify-between gap-3 flex-wrap py-2 px-3 rounded-md border"
                    data-testid={`row-task-${task.id}`}
                  >
                    <div className="flex flex-col gap-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium" data-testid={`text-task-type-${task.id}`}>
                          {getTaskLabel(task.type)}
                        </span>
                        <TaskStatusBadge status={task.status} />
                      </div>
                      <TaskResultDisplay task={task} />
                      <span className="text-xs text-muted-foreground" data-testid={`text-task-time-${task.id}`}>
                        {task.createdAt ? new Date(task.createdAt).toLocaleString() : ""}
                      </span>
                    </div>
                    {(task.status === "pending" || task.status === "in_progress") && (
                      <Button
                        size="icon"
                        variant="ghost"
                        className="text-destructive"
                        onClick={() => cancelTaskMutation.mutate(task.id)}
                        disabled={cancelTaskMutation.isPending}
                        data-testid={`button-cancel-task-${task.id}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
