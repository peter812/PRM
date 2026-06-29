import { useQuery } from "@tanstack/react-query";
import { Link, useRoute } from "wouter";
import { Loader2, ChevronLeft, ImageIcon } from "lucide-react";
import { format } from "date-fns";
import type { Task, ImageTask } from "@shared/schema";
import { Badge } from "@/components/ui/badge";
import { imageDetailHref } from "@/lib/image-link";

function formatDate(d: string | Date | null | undefined): string {
  if (!d) return "—";
  return format(new Date(d), "MMM d, yyyy HH:mm:ss");
}

function getTaskLabel(type: string): string {
  switch (type) {
    case "refresh_follower_count": return "Follower Count Refresh";
    case "mass_refresh_follower_count": return "Mass Follower Count Refresh";
    case "get_img": return "Image Download";
    case "transfer_images_to_local": return "Transfer Images to Local";
    case "transfer_images_to_s3": return "Transfer Images to S3";
    case "import_instagram": return "Instagram Import";
    case "export_xml": return "XML Export";
    case "import_xml": return "XML Import";
    case "download_img_instagram": return "Download Instagram Image";
    case "analyze_img_full": return "Analyze Image (Full)";
    case "analyze_img_face": return "Analyze Image (Face)";
    case "analyze_img_metadata": return "Analyze Image (Metadata)";
    case "analyze_img_llm": return "Analyze Image (LLM)";
    case "convert_img": return "Convert Image";
    default: return type;
  }
}

const STATUS_COLORS: Record<string, string> = {
  pending: "bg-muted text-muted-foreground",
  in_progress: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  completed: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  failed: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
  cancelled: "bg-muted text-muted-foreground line-through",
};

function StatusPill({ status }: { status: string }) {
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${STATUS_COLORS[status] ?? "bg-muted text-muted-foreground"}`}
      data-testid={`badge-status-${status}`}
    >
      {status === "in_progress" && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
      {status.replace(/_/g, " ")}
    </span>
  );
}

type ImageTasksResponse = {
  items: ImageTask[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
};

export default function TaskDetailPage() {
  const [, params] = useRoute("/task/:id");
  const id = params?.id;

  const { data: task, isLoading: taskLoading, error: taskError } = useQuery<Task>({
    queryKey: [`/api/tasks/${id}`],
    enabled: !!id,
    refetchInterval: (query) => {
      const t = query.state.data;
      if (!t) return false;
      return t.status === "pending" || t.status === "in_progress" ? 3000 : false;
    },
  });

  const { data: subTasksData, isLoading: subLoading } = useQuery<ImageTasksResponse>({
    queryKey: ["/api/image-tasks", "parent", id],
    queryFn: async () => {
      const params = new URLSearchParams({ parentTaskId: id ?? "", limit: "100", page: "1" });
      const res = await fetch(`/api/image-tasks?${params.toString()}`);
      if (!res.ok) throw new Error("Failed to fetch sub-tasks");
      return res.json();
    },
    enabled: !!id,
    refetchInterval: (query) => {
      const items = query.state.data?.items ?? [];
      const hasActive = items.some(t => t.status === "pending" || t.status === "in_progress");
      return hasActive ? 3000 : false;
    },
  });

  const subTasks = subTasksData?.items ?? [];

  // Aggregate sub-task status counts
  const statusCounts = subTasks.reduce<Record<string, number>>((acc, t) => {
    acc[t.status] = (acc[t.status] ?? 0) + 1;
    return acc;
  }, {});

  if (taskLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (taskError || !task) {
    return (
      <div className="container max-w-3xl py-8 px-4">
        <Link href="/settings/tasks" className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground">
          <ChevronLeft className="h-4 w-4 mr-1" /> Back to Tasks
        </Link>
        <div className="mt-8 text-center text-muted-foreground">Task not found.</div>
      </div>
    );
  }

  return (
    <div className="container max-w-5xl py-6 px-4">
      <div className="mb-4">
        <Link href="/settings/tasks" className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground" data-testid="link-back">
          <ChevronLeft className="h-4 w-4 mr-1" /> Back to Tasks
        </Link>
      </div>

      <div className="flex items-start justify-between gap-4 mb-2 flex-wrap">
        <h1 className="text-2xl font-semibold" data-testid="text-task-title">
          {task.title ? `${task.title} - ${getTaskLabel(task.type)}` : getTaskLabel(task.type)}
        </h1>
        <StatusPill status={task.status} />
      </div>
      <p className="text-xs font-mono text-muted-foreground mb-6 break-all" data-testid="text-task-id">{task.id}</p>

      <div className="border rounded-md px-3 mb-8">
        <div className="grid grid-cols-[160px_1fr] gap-3 py-2 border-b text-sm">
          <div className="text-muted-foreground">Type</div>
          <div className="font-mono text-xs">{task.type}</div>
        </div>
        <div className="grid grid-cols-[160px_1fr] gap-3 py-2 border-b text-sm">
          <div className="text-muted-foreground">Progress</div>
          <div>
            {task.progress > 0 || task.status === "in_progress" ? (
              <div className="flex items-center gap-2 max-w-xs">
                <div className="flex-1 bg-muted rounded-full h-1.5">
                  <div className="bg-primary h-1.5 rounded-full transition-all" style={{ width: `${task.progress}%` }} />
                </div>
                <span className="text-xs text-muted-foreground">{task.progress}%</span>
              </div>
            ) : <span className="text-muted-foreground">—</span>}
          </div>
        </div>
        {task.progressMessage && (
          <div className="grid grid-cols-[160px_1fr] gap-3 py-2 border-b text-sm">
            <div className="text-muted-foreground">Progress message</div>
            <div className="break-words">{task.progressMessage}</div>
          </div>
        )}
        <div className="grid grid-cols-[160px_1fr] gap-3 py-2 border-b text-sm">
          <div className="text-muted-foreground">Created</div>
          <div>{formatDate(task.createdAt)}</div>
        </div>
        <div className="grid grid-cols-[160px_1fr] gap-3 py-2 border-b text-sm">
          <div className="text-muted-foreground">Started</div>
          <div>{formatDate(task.startedAt)}</div>
        </div>
        <div className="grid grid-cols-[160px_1fr] gap-3 py-2 text-sm">
          <div className="text-muted-foreground">Completed</div>
          <div>{formatDate(task.completedAt)}</div>
        </div>
      </div>

      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
          Sub tasks {subTasksData ? `(${subTasksData.total})` : ""}
        </h2>
        {Object.keys(statusCounts).length > 0 && (
          <div className="flex flex-wrap items-center gap-2" data-testid="sub-task-status-summary">
            {Object.entries(statusCounts).map(([s, count]) => (
              <Badge key={s} variant="outline" className="text-xs">
                {s.replace(/_/g, " ")}: {count}
              </Badge>
            ))}
          </div>
        )}
      </div>

      {subLoading ? (
        <div className="flex items-center justify-center py-10">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : subTasks.length === 0 ? (
        <div className="text-center py-10 text-sm text-muted-foreground border rounded-md">
          No sub tasks for this task.
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
                <th className="text-left px-3 py-2 font-medium text-muted-foreground whitespace-nowrap">Created</th>
                <th className="text-left px-3 py-2 font-medium text-muted-foreground whitespace-nowrap">Completed</th>
              </tr>
            </thead>
            <tbody>
              {subTasks.map((st, idx) => (
                <tr
                  key={st.id}
                  className={`border-b last:border-b-0 ${idx % 2 === 0 ? "" : "bg-muted/20"}`}
                  data-testid={`row-sub-task-${st.id}`}
                >
                  <td className="px-3 py-2 font-mono text-xs">{st.type}</td>
                  <td className="px-3 py-2"><StatusPill status={st.status} /></td>
                  <td className="px-3 py-2">
                    {st.progress > 0 || st.status === "in_progress" ? (
                      <div className="flex items-center gap-2 min-w-16">
                        <div className="flex-1 bg-muted rounded-full h-1.5 min-w-12">
                          <div className="bg-primary h-1.5 rounded-full transition-all" style={{ width: `${st.progress}%` }} />
                        </div>
                        <span className="text-xs text-muted-foreground shrink-0">{st.progress}%</span>
                      </div>
                    ) : <span className="text-muted-foreground">—</span>}
                  </td>
                  <td className="px-3 py-2">
                    {st.photoId ? (
                      <Link
                        href={`~${imageDetailHref(st.photoId)}`}
                        className="inline-flex items-center gap-1 text-xs text-primary hover:underline font-mono"
                        title={st.photoId}
                        data-testid={`link-sub-photo-${st.id}`}
                      >
                        <ImageIcon className="h-3 w-3 shrink-0" />
                        {st.photoId.slice(0, 8)}…
                      </Link>
                    ) : <span className="text-muted-foreground">—</span>}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">{formatDate(st.createdAt)}</td>
                  <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">{formatDate(st.completedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
