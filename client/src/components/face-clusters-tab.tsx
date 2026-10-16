// Face review's Clusters tab (face-clustering-plan.md §5): likely-same-person clusters of open
// faces, largest first, each named, rejected or dismissed in one go. Cluster ids change on every
// run, so the server answers 409 when a cluster changed under you and the tab reloads.
import { useEffect, useState } from "react";
import { useInfiniteQuery, useMutation, useQuery } from "@tanstack/react-query";
import { Check, Loader2, RefreshCw, Search, UserX, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import { withImageSize } from "@shared/image-size";
import { IdentitySearch, type IdentityTarget } from "@/components/identity-search";
import { SUGGESTION_COPY, type FaceReviewSuggestion } from "@/pages/face-review";

type ClusterSuggestion = FaceReviewSuggestion & { photos: number; share: number; score?: number };
type ClusterBanner = { suggestion: ClusterSuggestion; solo?: { hits: number; total: number } };
type ClusterCard = { id: string; size: number; faces: { id: string; cropUrl: string }[]; suggestions: ClusterSuggestion[]; banner: ClusterBanner | null };
type ClusterPage = { clusters: ClusterCard[]; nextOffset: number | null };
type ClusterSummary = { clusters: number; faces: number; noise: Record<string, number>; lastRunAt: string | null };

const NOISE_LABEL: Record<string, string> = { small: "too small", low_conf: "low confidence", blurry: "blurry", singleton: "no cluster" };
const PAGE = 24;

const target = (s: IdentityTarget): IdentityTarget => ({ socialAccountId: s.socialAccountId, personId: s.personId });

function suggestionText(s: ClusterSuggestion): string {
  const why = s.reason === "lookalike" && s.score !== undefined ? `looks like them · ${Math.round(s.score * 100)}%` : `${SUGGESTION_COPY[s.reason]?.replace(/[()]/g, "") ?? s.reason} · ${s.photos} photo${s.photos === 1 ? "" : "s"}`;
  return `${s.label} (${why})`;
}

function bannerText(b: ClusterBanner): string {
  return b.solo ? `${b.solo.hits} of their ${b.solo.total} solo posts` : "their profile picture is in this cluster";
}

/** Every Face review query (queues, counts, clusters, summary) after faces change. */
const invalidateFaceReview = () => queryClient.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith("/api/face-review") });

/** Cluster actions, shared by the cards and the detail dialog. A 409 (the cluster changed) reloads. */
function useClusterActions(onDone?: () => void) {
  const { toast } = useToast();
  const onError = (err: Error) => {
    if (err.message.startsWith("409")) {
      toast({ title: "This cluster changed", description: "It was reloaded; check it again." });
      invalidateFaceReview();
    } else {
      toast({ title: "That didn't work", description: err.message.replace(/^\d+: /, ""), variant: "destructive" });
    }
  };
  const post = (id: string, action: string, body: object) => apiRequest("POST", `/api/face-review/clusters/${encodeURIComponent(id)}/${action}`, body).then((r) => r.json());

  const name = useMutation({
    mutationFn: (v: { id: string; faceIds?: string[]; to: IdentityTarget; label: string }) => post(v.id, "name", { faceIds: v.faceIds, ...target(v.to) }) as Promise<{ moved: number }>,
    onSuccess: ({ moved }, v) => {
      toast({ title: `Named ${moved} face${moved === 1 ? "" : "s"} as ${v.label}` });
      invalidateFaceReview();
      onDone?.();
    },
    onError,
  });
  const reject = useMutation({
    mutationFn: (v: { id: string; to: IdentityTarget }) => post(v.id, "reject", target(v.to)),
    onSuccess: () => invalidateFaceReview(),
    onError,
  });
  const strangers = useMutation({
    mutationFn: (v: { id: string; faceIds?: string[] }) => post(v.id, "strangers", { faceIds: v.faceIds }) as Promise<{ dismissed: number }>,
    onSuccess: ({ dismissed }) => {
      toast({ title: `Skipped ${dismissed} face${dismissed === 1 ? "" : "s"}`, description: "They're under Skipped, where each can be undone." });
      invalidateFaceReview();
      onDone?.();
    },
    onError,
  });
  return { name, reject, strangers, busy: name.isPending || reject.isPending || strangers.isPending };
}

const identityId = (s: IdentityTarget) => s.socialAccountId ?? s.personId ?? "";

export function FaceClustersTab({ clusterId, onOpenCluster }: { clusterId: string | null; onOpenCluster: (id: string | null) => void }) {
  const { toast } = useToast();
  const { data: summary } = useQuery<ClusterSummary>({ queryKey: ["/api/face-review/cluster-summary"] });
  const clustersQuery = useInfiniteQuery<ClusterPage>({
    queryKey: ["/api/face-review/clusters"],
    queryFn: async ({ pageParam }) => {
      const res = await fetch(`/api/face-review/clusters?offset=${pageParam}&limit=${PAGE}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load clusters");
      return res.json();
    },
    initialPageParam: 0,
    getNextPageParam: (last) => last.nextOffset ?? undefined,
  });
  const clusters = clustersQuery.data?.pages.flatMap((p) => p.clusters) ?? [];
  const actions = useClusterActions();

  const recluster = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/face-review/cluster")).json() as Promise<{ clusters: number; clustered: number }>,
    onSuccess: (r) => {
      onOpenCluster(null);
      toast({ title: `Found ${r.clusters} clusters covering ${r.clustered} faces` });
      invalidateFaceReview();
    },
    onError: (err: Error) => toast({ title: "Clustering failed", description: err.message.replace(/^\d+: /, ""), variant: "destructive" }),
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
        {summary && (
          <>
            <span><strong>{summary.clusters.toLocaleString()}</strong> clusters · <strong>{summary.faces.toLocaleString()}</strong> faces</span>
            {Object.entries(summary.noise).map(([reason, n]) => (
              <span key={reason} className="text-muted-foreground">{n.toLocaleString()} {NOISE_LABEL[reason] ?? reason}</span>
            ))}
            {summary.lastRunAt && <span className="text-muted-foreground">Last run {new Date(summary.lastRunAt).toLocaleString()}</span>}
          </>
        )}
        <Button variant="outline" size="sm" className="ml-auto" disabled={recluster.isPending} onClick={() => recluster.mutate()} data-testid="button-recluster">
          {recluster.isPending ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-1.5" />}
          {recluster.isPending ? "Clustering…" : "Recluster"}
        </Button>
      </div>

      {clustersQuery.isLoading ? (
        <div className="text-center py-16 text-muted-foreground">Loading…</div>
      ) : clustersQuery.isError ? (
        <div className="text-center py-16 text-sm text-destructive">Couldn't load clusters. Please refresh.</div>
      ) : !clusters.length ? (
        <div className="text-center py-16 text-muted-foreground">No clusters to review. Recluster after new faces come in.</div>
      ) : (
        <div className="grid gap-4 grid-cols-[repeat(auto-fill,minmax(240px,1fr))]">
          {clusters.map((c) => (
            <div key={c.id} className="rounded-md border p-2 space-y-2" data-testid={`card-cluster-${c.id}`}>
              <button type="button" className="w-full grid grid-cols-4 gap-0.5 rounded overflow-hidden" onClick={() => onOpenCluster(c.id)} title="Open this cluster">
                {c.faces.map((f) => (
                  <img key={f.id} src={withImageSize(f.cropUrl, 128)} alt="" loading="lazy" className="aspect-square w-full object-cover bg-muted" />
                ))}
              </button>
              <div className="flex items-center justify-between">
                <Badge variant="secondary">{c.size} faces</Badge>
                <button type="button" className="text-xs underline text-muted-foreground" onClick={() => onOpenCluster(c.id)}>Review</button>
              </div>
              {c.banner && (
                <div className="rounded-md bg-accent p-2 space-y-1.5 text-sm">
                  <p>Is this <strong>{c.banner.suggestion.label}</strong>? <span className="text-muted-foreground">({bannerText(c.banner)})</span></p>
                  <div className="flex gap-1.5">
                    <Button size="sm" className="h-7" disabled={actions.busy} onClick={() => actions.name.mutate({ id: c.id, to: c.banner!.suggestion, label: c.banner!.suggestion.label })}>
                      <Check className="h-3.5 w-3.5 mr-1" /> Yes
                    </Button>
                    <Button size="sm" variant="outline" className="h-7" disabled={actions.busy} onClick={() => actions.reject.mutate({ id: c.id, to: c.banner!.suggestion })}>
                      No
                    </Button>
                  </div>
                </div>
              )}
              <div className="flex flex-wrap gap-1">
                {c.suggestions.filter((s) => identityId(s) !== (c.banner && identityId(c.banner.suggestion))).map((s) => (
                  <span key={identityId(s)} className="text-xs px-2 py-0.5 rounded-full border text-muted-foreground">{suggestionText(s)}</span>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
      {clustersQuery.hasNextPage && (
        <div className="flex justify-center">
          <Button variant="outline" size="sm" disabled={clustersQuery.isFetchingNextPage} onClick={() => clustersQuery.fetchNextPage()}>
            {clustersQuery.isFetchingNextPage ? "Loading…" : "More clusters"}
          </Button>
        </div>
      )}

      {clusterId && <ClusterDialog id={clusterId} onClose={() => onOpenCluster(null)} />}
    </div>
  );
}

/** One cluster's full face grid: click faces to leave them out, then name the rest or skip them as strangers. */
function ClusterDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const { data: cluster, isLoading, isError } = useQuery<ClusterCard>({ queryKey: ["/api/face-review/clusters", id], retry: false });
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [searching, setSearching] = useState(false);
  useEffect(() => setExcluded(new Set()), [id]);
  const actions = useClusterActions(onClose);
  const included = cluster?.faces.filter((f) => !excluded.has(f.id)).map((f) => f.id) ?? [];
  const nameAs = (to: IdentityTarget, label: string) => actions.name.mutate({ id, faceIds: included, to, label });
  const toggle = (faceId: string) =>
    setExcluded((prev) => {
      const next = new Set(prev);
      if (!next.delete(faceId)) next.add(faceId);
      return next;
    });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>{cluster ? `Cluster of ${cluster.size} faces` : "Cluster"}</DialogTitle>
          <DialogDescription>Click a face to leave it out, then name the rest or skip them.</DialogDescription>
        </DialogHeader>
        {isLoading ? (
          <div className="py-12 text-center text-muted-foreground">Loading…</div>
        ) : isError || !cluster ? (
          <div className="py-12 text-center text-muted-foreground">This cluster is gone: it was named, skipped or reclustered.</div>
        ) : (
          <>
            <div className="flex flex-wrap gap-1.5">
              {cluster.suggestions.map((s) => (
                <span key={identityId(s)} className="text-xs rounded-full border flex items-center">
                  <button type="button" className="pl-2 pr-1 py-1 hover:bg-accent rounded-l-full" disabled={actions.busy || !included.length} onClick={() => nameAs(s, s.label)} data-testid={`chip-cluster-suggestion-${identityId(s)}`}>
                    {suggestionText(s)}
                  </button>
                  <button type="button" className="px-1.5 py-1 hover:bg-accent rounded-r-full text-muted-foreground" title="Not them" disabled={actions.busy} onClick={() => actions.reject.mutate({ id, to: s })}>
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
              <button type="button" className={cn("text-xs px-2 py-1 rounded-full border hover:bg-accent flex items-center gap-1", searching && "bg-accent")} onClick={() => setSearching((v) => !v)}>
                <Search className="h-3 w-3" /> Name as…
              </button>
              <button
                type="button"
                className="text-xs px-2 py-1 rounded-full border border-dashed text-muted-foreground hover:bg-accent flex items-center gap-1"
                disabled={actions.busy || !included.length}
                onClick={() => actions.strangers.mutate({ id, faceIds: included })}
                data-testid="button-cluster-strangers"
              >
                <UserX className="h-3 w-3" /> Strangers
              </button>
            </div>
            {searching && <IdentitySearch onPick={(to) => nameAs(to, "them")} onCancel={() => setSearching(false)} />}
            <p className="text-xs text-muted-foreground">
              {included.length} of {cluster.faces.length} faces selected{excluded.size ? ` · ${excluded.size} left out` : ""}
            </p>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(72px,1fr))] gap-1 overflow-y-auto min-h-0">
              {cluster.faces.map((f) => (
                <button key={f.id} type="button" onClick={() => toggle(f.id)} className="relative" data-testid={`cluster-face-${f.id}`}>
                  <img src={withImageSize(f.cropUrl, 128)} alt="" loading="lazy" className={cn("aspect-square w-full object-cover rounded bg-muted", excluded.has(f.id) && "opacity-25 grayscale")} />
                  {excluded.has(f.id) && <X className="absolute inset-0 m-auto h-6 w-6 text-destructive" />}
                </button>
              ))}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
