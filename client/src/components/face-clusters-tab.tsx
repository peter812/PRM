// Face review's Clusters tab (face-clustering-plan.md §5): likely-same-person clusters of open
// faces, largest first, each named, rejected or dismissed in one go. Cluster ids change on every
// run, so the server answers 409 when a cluster changed under you and the tab reloads.
// With `accountId` it's scoped to one account's faces (account-faces-plan.md §3.2): only clusters
// with faces there, sized by those faces, and actions apply to them unless widened to the cluster.
import { useEffect, useState } from "react";
import { useInfiniteQuery, useMutation, useQuery } from "@tanstack/react-query";
import { Check, Loader2, RefreshCw, Search, UserX, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import { withImageSize } from "@shared/image-size";
import { IdentitySearch, type IdentityTarget } from "@/components/identity-search";
import { SUGGESTION_COPY, type FaceReviewSuggestion } from "@/components/face-identify-chips";

type ClusterSuggestion = FaceReviewSuggestion & { photos: number; share: number; score?: number };
type ClusterBanner = { suggestion: ClusterSuggestion; solo?: { hits: number; total: number } };
type ClusterCard = { id: string; size: number; elsewhere: number; faces: { id: string; cropUrl: string; inScope: boolean }[]; suggestions: ClusterSuggestion[]; banner: ClusterBanner | null };
type ClusterPage = { clusters: ClusterCard[]; nextOffset: number | null };
type ClusterSummary = { clusters: number; faces: number; noise: Record<string, number>; lastRunAt: string | null };

const NOISE_LABEL: Record<string, string> = { small: "too small", low_conf: "low confidence", blurry: "blurry", singleton: "no cluster" };
const PAGE = 24;
/** Suggestion chips shown in the cluster dialog before the rest fold into a "+N more" menu. */
const VISIBLE_SUGGESTIONS = 10;

const target = (s: IdentityTarget): IdentityTarget => ({ socialAccountId: s.socialAccountId, personId: s.personId, username: s.username });

function suggestionText(s: ClusterSuggestion): string {
  const why = s.reason === "lookalike" && s.score !== undefined ? `looks like them · ${Math.round(s.score * 100)}%` : `${SUGGESTION_COPY[s.reason]?.replace(/[()]/g, "") ?? s.reason} · ${s.photos} photo${s.photos === 1 ? "" : "s"}`;
  return `${s.label} (${why})`;
}

function bannerText(b: ClusterBanner): string {
  return b.solo ? `${b.solo.hits} of their ${b.solo.total} solo posts` : "their profile picture is in this cluster";
}

/** Every Face review query (queues, counts, clusters, summary), and accounts' Faces tabs, after faces change. */
const invalidateFaceReview = () => queryClient.invalidateQueries({
  predicate: (q) => {
    const k = String(q.queryKey[0]);
    return k.startsWith("/api/face-review") || (k.startsWith("/api/social-accounts/") && k.includes("/faces"));
  },
});

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

const identityId = (s: IdentityTarget) => s.socialAccountId ?? s.personId ?? (s.username ? `@${s.username}` : "");

export function FaceClustersTab({ clusterId, onOpenCluster, accountId }: { clusterId: string | null; onOpenCluster: (id: string | null) => void; accountId?: string }) {
  const { toast } = useToast();
  const scope = { account: accountId };
  const { data: summary } = useQuery<ClusterSummary>({ queryKey: ["/api/face-review/cluster-summary", scope] });
  const clustersQuery = useInfiniteQuery<ClusterPage>({
    queryKey: ["/api/face-review/clusters", scope],
    queryFn: async ({ pageParam }) => {
      const res = await fetch(`/api/face-review/clusters?offset=${pageParam}&limit=${PAGE}${accountId ? `&account=${encodeURIComponent(accountId)}` : ""}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load clusters");
      return res.json();
    },
    initialPageParam: 0,
    getNextPageParam: (last) => last.nextOffset ?? undefined,
  });
  const clusters = clustersQuery.data?.pages.flatMap((p) => p.clusters) ?? [];
  const actions = useClusterActions();
  // Scoped, a card's "Yes" can't see all its in-scope faces, so it opens the dialog ready to confirm.
  const [preset, setPreset] = useState<ClusterSuggestion | null>(null);

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
        {!accountId && <Button variant="outline" size="sm" className="ml-auto" disabled={recluster.isPending} onClick={() => recluster.mutate()} data-testid="button-recluster">
          {recluster.isPending ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-1.5" />}
          {recluster.isPending ? "Clustering…" : "Recluster"}
        </Button>}
      </div>

      {clustersQuery.isLoading ? (
        <div className="text-center py-16 text-muted-foreground">Loading…</div>
      ) : clustersQuery.isError ? (
        <div className="text-center py-16 text-sm text-destructive">Couldn't load clusters. Please refresh.</div>
      ) : !clusters.length ? (
        <div className="text-center py-16 text-muted-foreground">{accountId ? "No unnamed clusters in this account." : "No clusters to review. Recluster after new faces come in."}</div>
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
                <span className="flex items-center gap-1.5">
                  <Badge variant="secondary">{c.size} faces</Badge>
                  {accountId && c.elsewhere > 0 && <span className="text-xs text-muted-foreground">+{c.elsewhere} elsewhere</span>}
                </span>
                <button type="button" className="text-xs underline text-muted-foreground" onClick={() => onOpenCluster(c.id)}>Review</button>
              </div>
              {c.banner && (
                <div className="rounded-md bg-accent p-2 space-y-1.5 text-sm">
                  <p>Is this <strong>{c.banner.suggestion.label}</strong>? <span className="text-muted-foreground">({bannerText(c.banner)})</span></p>
                  <div className="flex gap-1.5">
                    <Button size="sm" className="h-7" disabled={actions.busy} onClick={() => {
                        if (!accountId) return actions.name.mutate({ id: c.id, to: c.banner!.suggestion, label: c.banner!.suggestion.label });
                        setPreset(c.banner!.suggestion);
                        onOpenCluster(c.id);
                      }}>
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

      {clusterId && (
        <ClusterDialog
          id={clusterId}
          accountId={accountId}
          preset={preset}
          onClose={() => {
            setPreset(null);
            onOpenCluster(null);
          }}
        />
      )}
    </div>
  );
}

/**
 * One cluster's full face grid: click faces to leave them out, then name the rest or skip them as
 * strangers. Scoped to an account, only its faces show until "Apply to whole cluster" is on.
 */
function ClusterDialog({ id, accountId, preset, onClose }: { id: string; accountId?: string; preset?: ClusterSuggestion | null; onClose: () => void }) {
  const { data: cluster, isLoading, isError } = useQuery<ClusterCard>({ queryKey: ["/api/face-review/clusters", id, { account: accountId }], retry: false });
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [searching, setSearching] = useState(false);
  const [whole, setWhole] = useState(false);
  const presetPending = preset ? { to: preset, label: preset.label } : null;
  const [pending, setPending] = useState<{ to: IdentityTarget; label: string } | null>(presetPending);
  useEffect(() => {
    setExcluded(new Set());
    setWhole(false);
    setPending(presetPending);
  }, [id]);
  const actions = useClusterActions(onClose);
  const shown = cluster?.faces.filter((f) => !accountId || whole || f.inScope) ?? [];
  const included = shown.filter((f) => !excluded.has(f.id)).map((f) => f.id);
  const nameAs = (to: IdentityTarget, label: string) => {
    setPending({ to, label });
    setSearching(false);
  };
  const confirmName = () => pending && actions.name.mutate({ id, faceIds: included, ...pending });
  const toggle = (faceId: string) =>
    setExcluded((prev) => {
      const next = new Set(prev);
      if (!next.delete(faceId)) next.add(faceId);
      return next;
    });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{!cluster ? "Cluster" : accountId ? `${cluster.size} faces here · ${cluster.size + cluster.elsewhere} in the cluster` : `Cluster of ${cluster.size} faces`}</DialogTitle>
          <DialogDescription>Click a face to leave it out, then name the rest or skip them.</DialogDescription>
        </DialogHeader>
        {isLoading ? (
          <div className="py-12 text-center text-muted-foreground">Loading…</div>
        ) : isError || !cluster ? (
          <div className="py-12 text-center text-muted-foreground">This cluster is gone: it was named, skipped or reclustered.</div>
        ) : (
          <>
            <div className="flex flex-wrap gap-1.5">
              {cluster.suggestions.slice(0, VISIBLE_SUGGESTIONS).map((s) => (
                <span key={identityId(s)} className="text-xs rounded-full border flex items-center">
                  <button type="button" className="pl-2 pr-1 py-1 hover:bg-accent rounded-l-full" disabled={actions.busy || !included.length} onClick={() => nameAs(s, s.label)} data-testid={`chip-cluster-suggestion-${identityId(s)}`}>
                    {suggestionText(s)}
                  </button>
                  <button type="button" className="px-1.5 py-1 hover:bg-accent rounded-r-full text-muted-foreground" title="Not them" disabled={actions.busy} onClick={() => actions.reject.mutate({ id, to: s })}>
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
              {cluster.suggestions.length > VISIBLE_SUGGESTIONS && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button type="button" className="text-xs px-2 py-1 rounded-full border hover:bg-accent" data-testid="button-cluster-more-suggestions">
                      +{cluster.suggestions.length - VISIBLE_SUGGESTIONS} more
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="max-h-72 overflow-y-auto">
                    {cluster.suggestions.slice(VISIBLE_SUGGESTIONS).map((s) => (
                      <DropdownMenuItem key={identityId(s)} className="text-xs gap-2" disabled={actions.busy} onSelect={(e) => (included.length ? nameAs(s, s.label) : e.preventDefault())} data-testid={`item-cluster-suggestion-${identityId(s)}`}>
                        <span className="flex-1">{suggestionText(s)}</span>
                        <button
                          type="button"
                          className="p-0.5 rounded hover:bg-background text-muted-foreground"
                          title="Not them"
                          disabled={actions.busy}
                          onClick={(e) => {
                            e.stopPropagation();
                            actions.reject.mutate({ id, to: s });
                          }}
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
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
            {searching && <IdentitySearch onPick={(to, label) => nameAs(to, label ?? "them")} onCancel={() => setSearching(false)} />}
            {pending && (
              <div className="rounded-md bg-accent p-2 flex flex-wrap items-center gap-2 text-sm" data-testid="cluster-confirm-name">
                <span>Name {included.length} face{included.length === 1 ? "" : "s"} as <strong>{pending.label}</strong>?</span>
                <div className="flex gap-1.5 ml-auto">
                  <Button size="sm" className="h-7" disabled={actions.busy || !included.length} onClick={confirmName} data-testid="button-cluster-confirm-name">
                    {actions.name.isPending ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Check className="h-3.5 w-3.5 mr-1" />} Confirm
                  </Button>
                  <Button size="sm" variant="outline" className="h-7" disabled={actions.name.isPending} onClick={() => setPending(null)}>
                    Cancel
                  </Button>
                </div>
              </div>
            )}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
              <span>{included.length} of {shown.length} faces selected{excluded.size ? ` · ${excluded.size} left out` : ""}</span>
              {accountId && cluster.elsewhere > 0 && (
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input type="checkbox" checked={whole} onChange={(e) => setWhole(e.target.checked)} data-testid="checkbox-cluster-whole" />
                  Apply to whole cluster ({cluster.size + cluster.elsewhere})
                </label>
              )}
            </div>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(72px,1fr))] gap-1">
              {shown.map((f) => (
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
