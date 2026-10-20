// Face review's Verify tab (face-clustering-plan.md §4): per identity, the faces auto-assign thinks
// are probably them but didn't move, plus older auto-assigns below today's bar. Everything starts
// selected: deselect the misses, then Confirm names the rest and marks the misses "not them".
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Check, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import { withImageSize } from "@shared/image-size";

type VerifyIdentity = { group: string; label: string; cropUrl: string | null; pending: number; unconfirmed: number };
type VerifyFace = { id: string; cropUrl: string; score: number };
type VerifyGroup = VerifyIdentity & { pendingFaces: VerifyFace[]; unconfirmedFaces: VerifyFace[] };

export function FaceVerifyTab() {
  const { data: identities, isLoading, isError } = useQuery<VerifyIdentity[]>({ queryKey: ["/api/face-review/verify"] });
  const [picked, setPicked] = useState<string | null>(null);
  // Keep the pick while it still has faces to verify; otherwise move to the top of the list.
  const group = identities?.some((i) => i.group === picked) ? picked : identities?.[0]?.group ?? null;

  if (isLoading) return <div className="text-center py-16 text-muted-foreground">Loading…</div>;
  if (isError) return <div className="text-center py-16 text-sm text-destructive">Couldn't load the verify list. Please refresh.</div>;
  if (!identities?.length) return <div className="text-center py-16 text-muted-foreground">Nothing to verify. Auto-assign adds faces here when it's fairly but not fully sure.</div>;

  return (
    <div className="grid gap-4 md:grid-cols-[240px_1fr]">
      <div className="space-y-1">
        {identities.map((i) => (
          <button
            key={i.group}
            type="button"
            onClick={() => setPicked(i.group)}
            className={cn("w-full flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent", i.group === group && "bg-accent")}
            data-testid={`verify-identity-${i.group}`}
          >
            {i.cropUrl ? <img src={withImageSize(i.cropUrl, 64)} alt="" className="h-8 w-8 rounded object-cover shrink-0" /> : <div className="h-8 w-8 rounded bg-muted shrink-0" />}
            <span className="truncate flex-1">{i.label}</span>
            <Badge variant="secondary">{i.pending + i.unconfirmed}</Badge>
          </button>
        ))}
      </div>
      {group && <VerifyGroupPanel key={group} group={group} />}
    </div>
  );
}

function VerifyGroupPanel({ group }: { group: string }) {
  const { toast } = useToast();
  const { data, isLoading } = useQuery<VerifyGroup>({ queryKey: ["/api/face-review/verify", group] });
  const [deselected, setDeselected] = useState<Set<string>>(new Set());
  const all = data ? [...data.pendingFaces, ...data.unconfirmedFaces] : [];
  const confirm = all.filter((f) => !deselected.has(f.id)).map((f) => f.id);
  const reject = all.filter((f) => deselected.has(f.id)).map((f) => f.id);

  const save = useMutation({
    mutationFn: async () => (await apiRequest("POST", `/api/face-review/verify/${encodeURIComponent(group)}/confirm`, { confirm, reject })).json() as Promise<{ confirmed: number; rejected: number }>,
    onSuccess: ({ confirmed, rejected }) => toast({ title: `Confirmed ${confirmed} face${confirmed === 1 ? "" : "s"}${rejected ? `, ${rejected} marked not them` : ""}` }),
    onError: (err: Error) =>
      toast(err.message.startsWith("409") ? { title: "This list changed", description: "It was reloaded; check it again." } : { title: "That didn't work", description: err.message.replace(/^\d+: /, ""), variant: "destructive" }),
    // Faces moved: every Face review list, count and cluster may have changed.
    onSettled: () => {
      setDeselected(new Set());
      queryClient.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith("/api/face-review") });
    },
  });

  if (isLoading || !data) return <div className="text-center py-16 text-muted-foreground">Loading…</div>;
  const toggle = (id: string) =>
    setDeselected((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  const grid = (title: string, list: VerifyFace[]) =>
    list.length > 0 && (
      <div className="space-y-2">
        <h3 className="text-sm font-medium">{title} <span className="text-muted-foreground font-normal">({list.length})</span></h3>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(88px,1fr))] gap-1.5">
          {list.map((f) => (
            <button key={f.id} type="button" onClick={() => toggle(f.id)} className="relative" title={`${Math.round(f.score * 100)}% match`} data-testid={`verify-face-${f.id}`}>
              <img src={withImageSize(f.cropUrl, 128)} alt="" loading="lazy" className={cn("aspect-square w-full object-cover rounded bg-muted", deselected.has(f.id) && "opacity-25 grayscale")} />
              {deselected.has(f.id) && <X className="absolute inset-0 m-auto h-6 w-6 text-destructive" />}
              <span className="absolute bottom-0.5 right-0.5 rounded bg-background/80 px-1 text-[10px]">{Math.round(f.score * 100)}%</span>
            </button>
          ))}
        </div>
      </div>
    );

  return (
    <div className="space-y-4 min-w-0">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-lg font-semibold truncate">Is this {data.label}?</h2>
        <span className="text-sm text-muted-foreground">Click the faces that aren't them.</span>
        <Button size="sm" className="ml-auto" disabled={save.isPending || !all.length} onClick={() => save.mutate()} data-testid="button-verify-confirm">
          {save.isPending ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Check className="h-4 w-4 mr-1.5" />}
          Confirm {confirm.length}{reject.length ? `, not them ${reject.length}` : ""}
        </Button>
      </div>
      {grid("Probably them", data.pendingFaces)}
      {grid("Auto-assigned at a lower score, unconfirmed", data.unconfirmedFaces)}
    </div>
  );
}
