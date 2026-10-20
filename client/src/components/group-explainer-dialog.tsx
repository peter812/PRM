import { useEffect } from "react";
import { useMutation } from "@tanstack/react-query";
import { RefreshCw, Sparkles, UserMinus, Tag } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";

export type GroupSignal = "mutualFollow" | "oneWayFollow" | "coFollow" | "coMention" | "bio";

export interface GroupSignals {
  internalWeightBySignal: Record<GroupSignal, number>;
  sharePct: Record<GroupSignal, number>;
  pairCounts: Record<GroupSignal, number>;
  topSharedFollows: { username: string; memberCount: number }[];
  keywordCounts: { keyword: string; memberCount: number }[];
  topPairs: { a: string; b: string; weight: number; dominant: GroupSignal }[];
  weakMembers: { id: string; username: string; fit: number }[];
}

export interface GroupExplanation {
  explanation: string;
  suggestedName: string;
  outliers: { id: string; username: string; reason: string }[];
  model: string;
  generatedAt: string;
}

export interface ExplainableGroup {
  id: string;
  suggestedName: string;
  memberCount: number;
  cohesionScore: number;
  signals?: GroupSignals;
  explanation?: GroupExplanation;
}

const SIGNAL_META: Record<GroupSignal, { label: string; color: string }> = {
  mutualFollow: { label: "Mutual follows", color: "bg-violet-500" },
  oneWayFollow: { label: "One-way follows", color: "bg-sky-500" },
  coFollow: { label: "Shared follows", color: "bg-emerald-500" },
  coMention: { label: "Tagged together", color: "bg-amber-500" },
  bio: { label: "Bio keywords", color: "bg-rose-500" },
};
const SIGNAL_ORDER = Object.keys(SIGNAL_META) as GroupSignal[];

/**
 * "Why are these grouped?" for a Smart Multi-Signal result. The signal
 * breakdown renders straight from the stored signals; the LLM explanation is
 * fetched on open (once — the server saves it into the task result).
 */
export function GroupExplainerDialog({
  taskId,
  group,
  onClose,
  onUseName,
  onPromoteWithout,
}: {
  taskId: string;
  group: ExplainableGroup | null;
  onClose: () => void;
  onUseName: (name: string) => void;
  onPromoteWithout: (memberIds: string[]) => void;
}) {
  const { toast } = useToast();

  const explainMutation = useMutation({
    mutationFn: async ({ groupId, regenerate }: { groupId: string; regenerate?: boolean }) => {
      const res = await apiRequest(
        "POST",
        `/api/potential-groups/results/${taskId}/explain/${groupId}${regenerate ? "?regenerate=1" : ""}`,
      );
      return res.json() as Promise<GroupExplanation>;
    },
    onSuccess: (explanation, { groupId }) => {
      // Remember it on the cached result so reopening is instant
      queryClient.setQueryData(["/api/potential-groups/results", taskId], (old: any) =>
        old ? { ...old, results: old.results.map((r: any) => (r.id === groupId ? { ...r, explanation } : r)) } : old,
      );
    },
    onError: (err) => {
      toast({ title: "Couldn't explain group", description: err.message, variant: "destructive" });
    },
  });

  useEffect(() => {
    if (group && !group.explanation) explainMutation.mutate({ groupId: group.id });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [group?.id]);

  const s = group?.signals;
  const explanation = group?.explanation;
  const loading = explainMutation.isPending;

  return (
    <Dialog open={group !== null} onOpenChange={(open) => !open && onClose()}>
      {group && s && (
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" />
              Why are these grouped?
            </DialogTitle>
            <DialogDescription>
              {group.memberCount} accounts · {group.cohesionScore}% of their connection strength stays inside the group
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-5 py-1">
            {/* Signal breakdown */}
            <div className="space-y-2">
              <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-muted">
                {SIGNAL_ORDER.filter((sig) => s.sharePct[sig] > 0).map((sig) => (
                  <div key={sig} className={SIGNAL_META[sig].color} style={{ width: `${s.sharePct[sig]}%` }} />
                ))}
              </div>
              <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                {SIGNAL_ORDER.filter((sig) => s.sharePct[sig] > 0).map((sig) => (
                  <span key={sig} className="flex items-center gap-1.5">
                    <span className={`h-2 w-2 rounded-full ${SIGNAL_META[sig].color}`} />
                    {SIGNAL_META[sig].label} {s.sharePct[sig]}%
                  </span>
                ))}
              </div>
            </div>

            {(s.topSharedFollows.length > 0 || s.keywordCounts.length > 0) && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
                {s.topSharedFollows.length > 0 && (
                  <div>
                    <p className="text-xs font-medium text-muted-foreground mb-1">Most members follow</p>
                    <ul className="space-y-0.5">
                      {s.topSharedFollows.map((f) => (
                        <li key={f.username}>
                          @{f.username} <span className="text-muted-foreground">· {f.memberCount}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {s.keywordCounts.length > 0 && (
                  <div>
                    <p className="text-xs font-medium text-muted-foreground mb-1">Shared bio keywords</p>
                    <div className="flex flex-wrap gap-1">
                      {s.keywordCounts.map((k) => (
                        <Badge key={k.keyword} variant="secondary" className="text-[11px] font-normal">
                          #{k.keyword} · {k.memberCount}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* LLM explanation */}
            <div className="rounded-md border p-3 space-y-3">
              {loading ? (
                <div className="space-y-2">
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-11/12" />
                  <Skeleton className="h-4 w-3/4" />
                </div>
              ) : explanation ? (
                <>
                  <p className="text-sm leading-relaxed">{explanation.explanation}</p>

                  {explanation.suggestedName && (
                    <div className="flex items-center justify-between gap-2">
                      <span className="flex items-center gap-1.5 text-sm">
                        <Tag className="h-3.5 w-3.5 text-muted-foreground" />
                        <span className="font-medium">{explanation.suggestedName}</span>
                      </span>
                      <Button size="sm" variant="outline" onClick={() => onUseName(explanation.suggestedName)}>
                        Use this name
                      </Button>
                    </div>
                  )}

                  {explanation.outliers.length > 0 && (
                    <div className="space-y-1.5">
                      <p className="text-xs font-medium text-muted-foreground">Weak fits</p>
                      <ul className="space-y-1 text-sm">
                        {explanation.outliers.map((o) => (
                          <li key={o.id}>
                            <span className="font-medium">@{o.username}</span>
                            <span className="text-muted-foreground"> — {o.reason}</span>
                          </li>
                        ))}
                      </ul>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => onPromoteWithout(explanation.outliers.map((o) => o.id))}
                      >
                        <UserMinus className="h-3.5 w-3.5 mr-1.5" />
                        Promote without these
                      </Button>
                    </div>
                  )}

                  <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                    <span>{explanation.model}</span>
                    <button
                      type="button"
                      className="flex items-center gap-1 hover:text-foreground"
                      onClick={() => explainMutation.mutate({ groupId: group.id, regenerate: true })}
                    >
                      <RefreshCw className="h-3 w-3" />
                      Regenerate
                    </button>
                  </div>
                </>
              ) : (
                <div className="flex items-center justify-between text-sm text-muted-foreground">
                  No explanation yet.
                  <Button size="sm" variant="outline" onClick={() => explainMutation.mutate({ groupId: group.id })}>
                    Explain
                  </Button>
                </div>
              )}
            </div>
          </div>
        </DialogContent>
      )}
    </Dialog>
  );
}
