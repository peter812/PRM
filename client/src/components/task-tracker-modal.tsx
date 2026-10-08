import { useState, useEffect, useRef, useSyncExternalStore } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { ChevronDown, Layers, Trash2 } from "lucide-react";
import type { Task } from "@shared/schema";

interface SocialJob {
  id: string;
  socialAccountId: string;
  username: string;
  kind: string;
  origin: string;
  status: string;
}

interface TrackedTask {
  key: string;
  id: string;
  source: "general" | "social";
  accountId?: string;
  status: string;
  name: string;
  sub: string | null;
}

function getTaskLabel(type: string): string {
  switch (type) {
    case "refresh_follower_count":
      return "Follower Count Refresh";
    case "mass_refresh_follower_count":
      return "Mass Follower Count Refresh";
    case "get_img":
      return "Image Download";
    case "migrate_profile_image_tiers":
      return "Migrate Profile Image Tiers";
    case "bake_image_variants":
      return "Bake Image Variants";
    case "import_social":
      return "Social Extraction Import";
    case "import_instagram":
      return "Instagram Import";
    case "import_instagram_backup":
      return "Instagram Backup Import";
    case "import_sms":
      return "SMS Backup Import";
    case "export_xml":
      return "XML Export";
    case "import_xml":
      return "XML Import";
    default:
      return type;
  }
}

const SOCIAL_KIND_LABEL: Record<string, string> = {
  info: "acct info",
  follows: "follows",
  posts: "posts",
};

const STATUS_STYLE: Record<string, { label: string; className: string }> = {
  pending: { label: "waiting", className: "bg-muted text-muted-foreground" },
  queued: { label: "waiting", className: "bg-muted text-muted-foreground" },
  in_progress: { label: "in progress", className: "bg-blue-500/15 text-blue-600 dark:text-blue-400" },
  running: { label: "in progress", className: "bg-blue-500/15 text-blue-600 dark:text-blue-400" },
  completed: { label: "finished", className: "bg-green-500/15 text-green-600 dark:text-green-400" },
  failed: { label: "error", className: "bg-red-500/15 text-red-600 dark:text-red-400" },
  cancelled: { label: "cancelled", className: "bg-muted text-muted-foreground" },
  skipped: { label: "skipped", className: "bg-muted text-muted-foreground" },
};

const isActive = (status: string) =>
  status === "pending" || status === "in_progress" || status === "queued" || status === "running";

// "Show scheduled social checks" is shared with Settings Home, since the panel
// (and its switch) disappears when it has nothing to show.
const SHOW_SCHEDULED_KEY = "task-tracker-show-scheduled";
let showScheduledValue = (() => {
  try {
    return localStorage.getItem(SHOW_SCHEDULED_KEY) !== "0";
  } catch {
    return true;
  }
})();
const showScheduledListeners = new Set<() => void>();

export function setShowScheduledTasks(on: boolean) {
  showScheduledValue = on;
  try {
    localStorage.setItem(SHOW_SCHEDULED_KEY, on ? "1" : "0");
  } catch {}
  showScheduledListeners.forEach((l) => l());
}

export function useShowScheduledTasks() {
  return useSyncExternalStore(
    (cb) => {
      showScheduledListeners.add(cb);
      return () => showScheduledListeners.delete(cb);
    },
    () => showScheduledValue
  );
}

const EMPTY_TASKS: Task[] = [];
const EMPTY_JOBS: SocialJob[] = [];

function useTaskSSE() {
  useEffect(() => {
    const es = new EventSource("/api/v1/events/stream", { withCredentials: true });
    let hasConnectedOnce = false;
    let trackingDebounce: ReturnType<typeof setTimeout> | null = null;
    let imageTaskDebounce: ReturnType<typeof setTimeout> | null = null;

    const scheduleTrackingInvalidate = () => {
      if (trackingDebounce) clearTimeout(trackingDebounce);
      trackingDebounce = setTimeout(() => {
        trackingDebounce = null;
        void queryClient.invalidateQueries({ queryKey: ["/api/tracking-jobs/current"] });
      }, 150);
    };

    const scheduleImageTaskInvalidate = () => {
      if (imageTaskDebounce) clearTimeout(imageTaskDebounce);
      imageTaskDebounce = setTimeout(() => {
        imageTaskDebounce = null;
        void queryClient.invalidateQueries({ queryKey: ["/api/image-tasks"] });
      }, 150);
    };

    es.addEventListener("connected", () => {
      if (hasConnectedOnce) {
        void queryClient.invalidateQueries({ queryKey: ["/api/tasks/current"] });
        void queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
        void queryClient.invalidateQueries({ queryKey: ["/api/tracking-jobs/current"] });
        void queryClient.invalidateQueries({ queryKey: ["/api/image-tasks"] });
      }
      hasConnectedOnce = true;
    });

    es.addEventListener("task.updated", (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data);
        if (data.action === "progress" && data.id) {
          const patchTask = (t: Task) =>
            t.id === data.id
              ? {
                  ...t,
                  progress: typeof data.progress === "number" ? data.progress : t.progress,
                  progressMessage: data.progressMessage !== undefined ? data.progressMessage : t.progressMessage,
                }
              : t;
          queryClient.setQueryData<Task[]>(["/api/tasks/current"], (old) => old?.map(patchTask));
          queryClient.setQueryData<Task[]>(["/api/tasks"], (old) => old?.map(patchTask));
          queryClient.setQueryData<Task>([`/api/tasks/${data.id}`], (old) => (old ? patchTask(old) : old));
        } else {
          void queryClient.invalidateQueries({ queryKey: ["/api/tasks/current"] });
          void queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
          if (data.id) {
            void queryClient.invalidateQueries({ queryKey: [`/api/tasks/${data.id}`] });
          }
        }
      } catch {}
    });

    es.addEventListener("image_task.updated", (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data);
        if (data.action === "progress" && data.id && data.parentTaskId) {
          queryClient.setQueryData<{ items: any[]; total: number; page: number; limit: number; totalPages: number }>(
            ["/api/image-tasks", "parent", data.parentTaskId],
            (old) =>
              old
                ? {
                    ...old,
                    items: old.items.map((item) =>
                      item.id === data.id
                        ? {
                            ...item,
                            progress: typeof data.progress === "number" ? data.progress : item.progress,
                            progressMessage:
                              data.progressMessage !== undefined ? data.progressMessage : item.progressMessage,
                          }
                        : item
                    ),
                  }
                : old
          );
        } else {
          scheduleImageTaskInvalidate();
        }
      } catch {}
    });

    es.addEventListener("tracking_job.updated", () => {
      scheduleTrackingInvalidate();
    });

    es.addEventListener("worker.status", (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data);
        if (typeof data.paused === "boolean") {
          queryClient.setQueryData(["/api/tasks/worker-status"], { paused: data.paused });
        }
      } catch {}
    });

    return () => {
      if (trackingDebounce) clearTimeout(trackingDebounce);
      if (imageTaskDebounce) clearTimeout(imageTaskDebounce);
      es.close();
    };
  }, []);
}

export function TaskTrackerModal() {
  useTaskSSE();
  const { toast } = useToast();
  const [minimized, setMinimized] = useState(false);
  const showScheduled = useShowScheduledTasks();
  const [trackedTasks, setTrackedTasks] = useState<Record<string, TrackedTask>>({});
  const [dismissedKeys, setDismissedKeys] = useState<Set<string>>(new Set());
  const trackedRef = useRef(trackedTasks);
  trackedRef.current = trackedTasks;
  const dismissedKeysRef = useRef(dismissedKeys);
  useEffect(() => {
    dismissedKeysRef.current = dismissedKeys;
  }, [dismissedKeys]);

  const activeTasksCount = Object.values(trackedTasks).filter((t) => isActive(t.status)).length;

  // General background tasks (updated in real time via SSE)
  const { data: tasks = EMPTY_TASKS } = useQuery<Task[]>({
    queryKey: ["/api/tasks/current"],
  });

  // Social tracking jobs (server caps the waiting list and reports the full count; updated via SSE)
  const { data: socialData } = useQuery<{ jobs: SocialJob[]; waitingTotal: number }>({
    queryKey: ["/api/tracking-jobs/current", { scheduled: showScheduled }],
    queryFn: async () =>
      (await apiRequest("GET", `/api/tracking-jobs/current?scheduled=${showScheduled ? 1 : 0}`)).json(),
  });

  const socialJobs = socialData?.jobs ?? EMPTY_JOBS;
  const shownWaiting = socialJobs.filter((j) => j.status === "queued").length;
  const moreWaiting = Math.max(0, (socialData?.waitingTotal ?? 0) - shownWaiting);

  // Merge backend queries into local display state
  useEffect(() => {
    let hasNewActiveTask = false;
    const timeoutsToSchedule: string[] = [];

    // Computed synchronously from the last render (not in a setState updater, which React may defer)
    // so the new-task and just-finished flags below are filled in before they're read
    const prev = trackedRef.current;
    let changed = false;
    const next = { ...prev };
    const dismissed = dismissedKeysRef.current;

    const processTask = (t: Omit<TrackedTask, "key">) => {
      const key = `${t.source}:${t.id}`;
      if (dismissed.has(key)) return;
      const prevTask = prev[key];

      // Track if active, or if it was tracked before and just finished
      if (!isActive(t.status) && !prevTask) return;
      if (!prevTask && isActive(t.status)) hasNewActiveTask = true;

      if (!prevTask || prevTask.status !== t.status || prevTask.name !== t.name || prevTask.sub !== t.sub) {
        changed = true;
        next[key] = { ...t, key };

        // A task that just reached a non-error terminal state auto-dismisses after 8s
        if (prevTask && prevTask.status !== t.status && !isActive(t.status) && t.status !== "failed") {
          timeoutsToSchedule.push(key);
        }
      }
    };

    for (const t of tasks) {
      processTask({ id: t.id, source: "general", status: t.status, name: getTaskLabel(t.type), sub: t.title });
    }

    for (const j of socialJobs) {
      processTask({
        id: j.id,
        source: "social",
        accountId: j.socialAccountId,
        status: j.status,
        name: j.username,
        sub: SOCIAL_KIND_LABEL[j.kind] ?? j.kind,
      });
    }

    // Active social jobs the server no longer returns (cancelled elsewhere, or hidden by the toggle) drop out
    const socialKeys = new Set(socialJobs.map((j) => `social:${j.id}`));
    for (const t of Object.values(next)) {
      if (t.source === "social" && isActive(t.status) && !socialKeys.has(t.key)) {
        delete next[t.key];
        changed = true;
      }
    }

    if (changed) setTrackedTasks(next);

    if (hasNewActiveTask) {
      setMinimized(false);
    }

    // Not cleared on re-run: the next poll would otherwise cancel the hide before it fires
    if (timeoutsToSchedule.length > 0) {
      setTimeout(() => dismiss(timeoutsToSchedule), 8000);
    }
  }, [tasks, socialJobs]);

  const dismiss = (keys: string[]) => {
    if (keys.length === 0) return;
    setTrackedTasks((curr) => {
      const copy = { ...curr };
      keys.forEach((k) => delete copy[k]);
      return copy;
    });
    setDismissedKeys((curr) => {
      const copy = new Set(curr);
      keys.forEach((k) => copy.add(k));
      return copy;
    });
  };

  const cancelGeneralMutation = useMutation({
    mutationFn: async (task: TrackedTask) => (await apiRequest("DELETE", `/api/tasks/${task.id}`)).json(),
    onSuccess: (_, task) => {
      queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
      toast({ title: "Task cancelled" });
      setTrackedTasks((curr) =>
        curr[task.key] ? { ...curr, [task.key]: { ...curr[task.key], status: "cancelled" } } : curr
      );
    },
    onError: (err: Error) => {
      toast({ title: "Failed to cancel task", description: err.message, variant: "destructive" });
    },
  });

  const cancelSocialMutation = useMutation({
    mutationFn: async (task: TrackedTask) =>
      (await apiRequest("DELETE", `/api/social-accounts/${task.accountId}/tracking-jobs/${task.id}`)).json(),
    onSuccess: (_, task) => {
      queryClient.invalidateQueries({ queryKey: ["/api/tracking-jobs/current"] });
      dismiss([task.key]);
    },
    onError: (err: Error) => {
      toast({ title: "Failed to cancel job", description: err.message, variant: "destructive" });
    },
  });

  // Trash: cancel what can be cancelled; a running social job just leaves the panel and finishes in the background
  const handleTrash = (task: TrackedTask) => {
    if (task.source === "general" && isActive(task.status)) cancelGeneralMutation.mutate(task);
    else if (task.source === "social" && task.status === "queued") cancelSocialMutation.mutate(task);
    else dismiss([task.key]);
  };

  const terminalKeys = Object.values(trackedTasks)
    .filter((t) => !isActive(t.status))
    .map((t) => t.key);

  // Running first, then waiting, then finished
  const rank = (s: string) => (s === "in_progress" || s === "running" ? 0 : isActive(s) ? 1 : 2);
  const rows = Object.values(trackedTasks).sort((a, b) => rank(a.status) - rank(b.status));

  const hasTasks = rows.length > 0;

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
                  <Badge className="absolute -top-1 -right-1 h-5 min-w-5 flex items-center justify-center px-1 bg-destructive border-2 border-background text-[10px] font-bold">
                    {activeTasksCount + moreWaiting}
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
                <div className="flex items-center justify-between px-3 py-2 border-b bg-muted/30">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold">Background Tasks</span>
                    <Badge variant="secondary" className="px-1.5 py-0 text-xs font-normal">
                      {activeTasksCount + moreWaiting} active
                    </Badge>
                  </div>
                  <div className="flex items-center gap-1">
                    <label className="flex items-center gap-1.5 text-xs text-muted-foreground mr-1 cursor-pointer">
                      Scheduled
                      <Switch
                        checked={showScheduled}
                        onCheckedChange={setShowScheduledTasks}
                        className="scale-75"
                        aria-label="Show scheduled social checks"
                      />
                    </label>
                    {terminalKeys.length > 0 && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => dismiss(terminalKeys)}
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

                {/* Task rows */}
                <div className="py-1 max-h-[300px] overflow-y-auto custom-scrollbar">
                  {rows.map((task) => {
                    const style = STATUS_STYLE[task.status] ?? STATUS_STYLE.pending;
                    return (
                      <div key={task.key} className="flex items-center gap-2 px-3 py-1 text-xs hover:bg-muted/40">
                        <span className="font-semibold truncate min-w-0">{task.name}</span>
                        {task.sub && <span className="text-muted-foreground truncate min-w-0">{task.sub}</span>}
                        <span className={`ml-auto shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${style.className}`}>
                          {style.label}
                        </span>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-6 w-6 shrink-0 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                          onClick={() => handleTrash(task)}
                          disabled={cancelGeneralMutation.isPending || cancelSocialMutation.isPending}
                          title={isActive(task.status) ? "Cancel" : "Dismiss"}
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    );
                  })}
                  {moreWaiting > 0 && (
                    <div className="px-3 py-1 text-[11px] text-muted-foreground">+{moreWaiting} more waiting</div>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}
    </AnimatePresence>
  );
}
