import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Loader2,
  CheckCircle2,
  XCircle,
  Clock,
  X,
  ChevronDown,
  Layers,
  Trash2
} from "lucide-react";
import type { Task, ImageTask } from "@shared/schema";

interface TrackedTask {
  id: string;
  type: string;
  isImageTask: boolean;
  status: string;
  title: string | null;
  progress: number;
  progressMessage: string | null;
}

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
    case "export_xml":
      return "XML Export";
    case "import_xml":
      return "XML Import";
    case "download_img_instagram":
      return "Instagram Image DL";
    case "analyze_img_full":
      return "Analyze Image (Full)";
    case "analyze_img_face":
      return "Analyze Image (Face)";
    case "analyze_img_metadata":
      return "Analyze Image (Metadata)";
    case "analyze_img_llm":
      return "Analyze Image (LLM)";
    case "convert_img":
      return "Convert Image";
    default:
      return type;
  }
}

export function TaskTrackerModal() {
  const { toast } = useToast();
  const [minimized, setMinimized] = useState(false);
  const [trackedTasks, setTrackedTasks] = useState<Record<string, TrackedTask>>({});
  const [dismissedTaskIds, setDismissedTaskIds] = useState<Set<string>>(new Set());

  // Determine if there are active tasks in our tracked tasks list
  const activeTasksCount = Object.values(trackedTasks).filter(
    (t) => t.status === "pending" || t.status === "in_progress"
  ).length;

  const totalTasksCount = Object.keys(trackedTasks).length;
  const hasTasks = totalTasksCount > 0;

  // Query general background tasks
  const { data: tasks = [] } = useQuery<Task[]>({
    queryKey: ["/api/tasks"],
    refetchInterval: (query) => {
      const data = query.state.data as Task[] | undefined;
      const hasActive = data?.some((t) => t.status === "pending" || t.status === "in_progress");
      return hasActive || activeTasksCount > 0 ? 2500 : 10000;
    },
  });

  // Query image background tasks
  const { data: imageTasksData } = useQuery<{ items: ImageTask[] }>({
    queryKey: ["/api/image-tasks", "active-tracker"],
    queryFn: async () => {
      const res = await fetch("/api/image-tasks?limit=25");
      if (!res.ok) throw new Error("Failed to fetch image tasks");
      return res.json();
    },
    refetchInterval: (query) => {
      const data = query.state.data as { items: ImageTask[] } | undefined;
      const hasActive = data?.items?.some((t) => t.status === "pending" || t.status === "in_progress");
      return hasActive || activeTasksCount > 0 ? 2500 : 10000;
    },
  });

  const imageTasks = imageTasksData?.items ?? [];

  // Merge backend queries into local display state
  useEffect(() => {
    setTrackedTasks((prev) => {
      const next = { ...prev };
      let hasNewTask = false;

      const processTask = (t: any, isImageTask: boolean) => {
        if (dismissedTaskIds.has(t.id)) return;

        const isTerminal =
          t.status === "completed" || t.status === "failed" || t.status === "cancelled";
        const isAlreadyTracked = !!next[t.id];

        // Track if active, or if it was tracked before and just finished
        if (!isTerminal || isAlreadyTracked) {
          if (!isAlreadyTracked && (t.status === "pending" || t.status === "in_progress")) {
            hasNewTask = true;
          }

          const oldStatus = next[t.id]?.status;
          next[t.id] = {
            id: t.id,
            type: t.type,
            isImageTask,
            status: t.status,
            title:
              t.title ||
              (isImageTask
                ? t.type === "download_img_instagram"
                  ? "Instagram Image"
                  : "Image Task"
                : null),
            progress: t.progress,
            progressMessage: t.progressMessage || null,
          };

          // If a task transitioned to a terminal success/cancelled state, auto-dismiss after 8s
          if (
            oldStatus &&
            oldStatus !== t.status &&
            (t.status === "completed" || t.status === "cancelled")
          ) {
            setTimeout(() => {
              setTrackedTasks((curr) => {
                const copy = { ...curr };
                delete copy[t.id];
                return copy;
              });
              setDismissedTaskIds((curr) => {
                const copy = new Set(curr);
                copy.add(t.id);
                return copy;
              });
            }, 8000);
          }
        }
      };

      // Process general tasks
      for (const t of tasks) {
        processTask(t, false);
      }

      // Process image tasks
      for (const t of imageTasks) {
        processTask(t, true);
      }

      if (hasNewTask) {
        setMinimized(false);
      }

      return next;
    });
  }, [tasks, imageTasks, dismissedTaskIds]);

  // Mutation to cancel a running task
  const cancelTaskMutation = useMutation({
    mutationFn: async (task: { id: string; isImageTask: boolean }) => {
      const url = task.isImageTask ? `/api/image-tasks/${task.id}` : `/api/tasks/${task.id}`;
      const res = await apiRequest("DELETE", url);
      return res.json();
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
      queryClient.invalidateQueries({ queryKey: ["/api/image-tasks"] });
      toast({ title: "Task cancelled" });

      // Instantly show cancelled state locally
      setTrackedTasks((curr) => {
        const copy = { ...curr };
        if (copy[variables.id]) {
          copy[variables.id].status = "cancelled";
        }
        return copy;
      });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to cancel task", description: err.message, variant: "destructive" });
    },
  });

  const handleDismiss = (id: string) => {
    setTrackedTasks((curr) => {
      const copy = { ...curr };
      delete copy[id];
      return copy;
    });
    setDismissedTaskIds((curr) => {
      const copy = new Set(curr);
      copy.add(id);
      return copy;
    });
  };

  const handleDismissAllCompleted = () => {
    const terminalIds = Object.values(trackedTasks)
      .filter((t) => t.status === "completed" || t.status === "cancelled" || t.status === "failed")
      .map((t) => t.id);

    setTrackedTasks((curr) => {
      const copy = { ...curr };
      terminalIds.forEach((id) => delete copy[id]);
      return copy;
    });

    setDismissedTaskIds((curr) => {
      const copy = new Set(curr);
      terminalIds.forEach((id) => copy.add(id));
      return copy;
    });
  };

  const hasTerminalTasks = Object.values(trackedTasks).some(
    (t) => t.status === "completed" || t.status === "cancelled" || t.status === "failed"
  );

  return (
    <AnimatePresence>
      {hasTasks && (
        <div className="fixed z-50 left-4 md:left-6 bottom-[4.5rem] md:bottom-6 pointer-events-none">
          <AnimatePresence mode="wait">
            {minimized ? (
              <motion.button
                key="minimized-bubble"
                initial={{ scale: 0, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0, opacity: 0 }}
                whileHover={{ scale: 1.05 }}
                onClick={() => setMinimized(false)}
                className="pointer-events-auto h-12 w-12 rounded-full flex items-center justify-center bg-primary text-primary-foreground shadow-lg border border-primary/20 relative"
                title="Expand Tasks Panel"
              >
                <Layers className="h-5 w-5 animate-pulse" />
                {activeTasksCount > 0 && (
                  <Badge className="absolute -top-1 -right-1 h-5 w-5 flex items-center justify-center p-0 bg-destructive border-2 border-background text-[10px] font-bold">
                    {activeTasksCount}
                  </Badge>
                )}
                {activeTasksCount === 0 && (
                  <div className="absolute -top-1 -right-1 h-3 w-3 rounded-full bg-green-500 border-2 border-background" />
                )}
              </motion.button>
            ) : (
              <motion.div
                key="expanded-panel"
                initial={{ y: 50, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ y: 50, opacity: 0 }}
                className="pointer-events-auto w-[calc(100vw-2rem)] md:w-96 rounded-xl border border-border/80 bg-background/95 backdrop-blur-md shadow-xl overflow-hidden"
              >
                {/* Header */}
                <div className="flex items-center justify-between px-4 py-3 border-b bg-muted/30">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold">Background Tasks</span>
                    <Badge variant="secondary" className="px-1.5 py-0 text-xs font-normal">
                      {activeTasksCount} active
                    </Badge>
                  </div>
                  <div className="flex items-center gap-1">
                    {hasTerminalTasks && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={handleDismissAllCompleted}
                        className="text-xs h-7 px-2 text-muted-foreground hover:text-foreground"
                      >
                        Clear Finished
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setMinimized(true)}
                      className="h-7 w-7 text-muted-foreground hover:text-foreground"
                      title="Minimize"
                    >
                      <ChevronDown className="h-4 w-4" />
                    </Button>
                  </div>
                </div>

                {/* Task List */}
                <div className="p-4 max-h-[300px] overflow-y-auto space-y-3.5 custom-scrollbar">
                  {Object.values(trackedTasks).map((task) => {
                    const isPending = task.status === "pending";
                    const isRunning = task.status === "in_progress";
                    const isCompleted = task.status === "completed";
                    const isFailed = task.status === "failed";
                    const isCancelled = task.status === "cancelled";

                    return (
                      <div key={task.id} className="space-y-1.5 group">
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-start gap-2.5 min-w-0">
                            {/* Icon */}
                            <div className="mt-0.5 shrink-0">
                              {isPending && <Clock className="h-4 w-4 text-muted-foreground" />}
                              {isRunning && <Loader2 className="h-4 w-4 animate-spin text-primary" />}
                              {isCompleted && <CheckCircle2 className="h-4 w-4 text-green-500" />}
                              {isFailed && <XCircle className="h-4 w-4 text-destructive" />}
                              {isCancelled && <XCircle className="h-4 w-4 text-muted-foreground" />}
                            </div>

                            {/* Text info */}
                            <div className="min-w-0">
                              <p className="text-xs font-semibold text-foreground truncate">
                                {task.title
                                  ? `${task.title} - ${getTaskLabel(task.type)}`
                                  : getTaskLabel(task.type)}
                              </p>
                              {task.progressMessage && (
                                <p className="text-[11px] text-muted-foreground line-clamp-1">
                                  {task.progressMessage}
                                </p>
                              )}
                            </div>
                          </div>

                          {/* Action Button */}
                          <div className="shrink-0 ml-1">
                            {isPending || isRunning ? (
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-6 w-6 rounded-full hover:bg-destructive/10 hover:text-destructive text-muted-foreground"
                                onClick={() =>
                                  cancelTaskMutation.mutate({
                                    id: task.id,
                                    isImageTask: task.isImageTask,
                                  })
                                }
                                disabled={cancelTaskMutation.isPending}
                                title="Cancel Task"
                              >
                                <Trash2 className="h-3 w-3" />
                              </Button>
                            ) : (
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-6 w-6 rounded-full text-muted-foreground hover:text-foreground"
                                onClick={() => handleDismiss(task.id)}
                                title="Dismiss"
                              >
                                <X className="h-3 w-3" />
                              </Button>
                            )}
                          </div>
                        </div>

                        {/* Progress bar */}
                        {(isRunning || task.progress > 0) && (
                          <div className="flex items-center gap-2 pl-6">
                            <Progress value={task.progress} className="h-1.5" />
                            <span className="text-[10px] font-mono text-muted-foreground shrink-0 min-w-8 text-right">
                              {task.progress}%
                            </span>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}
    </AnimatePresence>
  );
}
