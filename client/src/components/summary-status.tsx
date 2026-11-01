import { CheckCircle2, Clock, Loader2, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { withImageSize } from "@shared/image-size";
import type { SummaryJobProgress, SummaryStepStatus } from "@shared/schema";

const STEP_LOOK: Record<SummaryStepStatus, { label: string; icon: typeof Clock; className: string }> = {
  queued: { label: "Queued", icon: Clock, className: "bg-muted text-muted-foreground" },
  running: { label: "Running", icon: Loader2, className: "bg-blue-500/15 text-blue-700 dark:text-blue-400" },
  done: { label: "Finished", icon: CheckCircle2, className: "bg-green-500/15 text-green-700 dark:text-green-400" },
  failed: { label: "Failed", icon: XCircle, className: "bg-red-500/15 text-red-700 dark:text-red-400" },
};

/** Maps a summary job status ('pending' | 'running' | 'done' | 'failed') onto the four step looks. */
export function jobStep(status: string): SummaryStepStatus {
  return status === "running" || status === "done" || status === "failed" ? status : "queued";
}

export const summaryStepLabel = (step: SummaryStepStatus) => STEP_LOOK[step].label;

export function SummaryStatusBadge({ step, label }: { step: SummaryStepStatus; label?: string }) {
  const look = STEP_LOOK[step];
  const Icon = look.icon;
  return (
    <Badge
      variant="outline"
      className={cn("text-[10px] font-medium border-0 whitespace-nowrap", look.className)}
      data-testid={`badge-summary-${step}`}
    >
      <Icon className={cn("h-3 w-3 mr-1", step === "running" && "animate-spin")} />
      {label ?? look.label}
    </Badge>
  );
}

export type SummaryProgressCount = { done: number; total: number };

/** Post job progress: each image plus the final combining run counts as one step. */
export function postJobProgress(progress: SummaryJobProgress | null | undefined): SummaryProgressCount | null {
  if (!progress) return null;
  const finished = (s: SummaryStepStatus | undefined) => s === "done" || s === "failed";
  const imagesFinished = progress.images.filter((i) => finished(i.status)).length;
  const notesSteps = progress.notes ? 1 : 0; // fix jobs only
  return {
    done: imagesFinished + (progress.final === "done" ? 1 : 0) + (finished(progress.notes) ? 1 : 0),
    total: progress.images.length + 1 + notesSteps,
  };
}

/** Post jobs an account job is waiting on; postsQueued was snapshotted when the account job was queued. */
export function accountWaitProgress(options: Record<string, unknown> | null | undefined, livePosts: number): SummaryProgressCount | null {
  const total = Math.max(Number(options?.postsQueued) || 0, livePosts);
  return livePosts > 0 ? { done: total - livePosts, total } : null;
}

export function SummaryProgressBar({ count, label }: { count: SummaryProgressCount; label: string }) {
  return (
    <div className="flex items-center gap-2 min-w-0" data-testid="summary-progress">
      <Progress value={(count.done / count.total) * 100} className="h-1.5 flex-1 min-w-12" />
      <span className="text-[11px] text-muted-foreground tabular-nums whitespace-nowrap">
        {count.done}/{count.total} {label}
      </span>
    </div>
  );
}

/** Per-image results of a post summary job. */
export function ImageSummariesDialog({
  progress,
  title,
  open,
  onOpenChange,
}: {
  progress: SummaryJobProgress | null;
  title: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>Each image is described on its own, then a final run combines them into the post summary.</DialogDescription>
        </DialogHeader>
        {!progress ? (
          <p className="text-sm text-muted-foreground italic">This job hasn't started yet.</p>
        ) : (
          <div className="space-y-3">
            {progress.images.length === 0 && (
              <p className="text-sm text-muted-foreground italic">This post has no images to describe.</p>
            )}
            {progress.images.map((img) => (
              <div key={img.imageIndex} className="flex gap-3 rounded-md border p-2" data-testid={`row-image-summary-${img.imageIndex}`}>
                <img
                  src={withImageSize(img.url, 360)}
                  alt={`Image ${img.imageIndex + 1}`}
                  className="h-20 w-20 rounded object-cover shrink-0 bg-muted"
                  loading="lazy"
                />
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium">Image {img.imageIndex + 1}</span>
                    <SummaryStatusBadge step={img.status} />
                  </div>
                  {img.description && <p className="text-xs leading-relaxed whitespace-pre-wrap">{img.description}</p>}
                  {img.error && <p className="text-xs text-destructive break-words">{img.error}</p>}
                </div>
              </div>
            ))}
            <div className="flex items-center gap-2 rounded-md border p-2">
              <span className="text-xs font-medium">Final summary</span>
              <SummaryStatusBadge step={progress.final} />
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
