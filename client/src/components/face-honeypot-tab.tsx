// Face review's Honey pot tab (honey-pot-plan.md): faces put away as too blurry to name, newest
// first. Click faces to pick them, then take them back out to the review queues and clustering,
// or (auto-routed ones) keep them so future faces are matched against them too.
import { useState } from "react";
import { useInfiniteQuery, useMutation } from "@tanstack/react-query";
import { Check, CheckCheck, Loader2, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import { withImageSize } from "@shared/image-size";

type Source = "manual" | "auto";
type HoneypotFace = { id: string; cropUrl: string; photoId: string | null; sharpness: number | null; source: Source; score: number | null };
type HoneypotPage = { items: HoneypotFace[]; total: number; manual: number; auto: number };
const PAGE = 120;
const FILTERS: { value: Source | "all"; label: string }[] = [
  { value: "all", label: "All" },
  { value: "manual", label: "Sent by you" },
  { value: "auto", label: "Matched" },
];

export function FaceHoneypotTab() {
  const { toast } = useToast();
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<Source | "all">("all");
  const query = useInfiniteQuery<HoneypotPage>({
    queryKey: ["/api/face-review/honeypot", filter],
    queryFn: async ({ pageParam }) => {
      const source = filter === "all" ? "" : `&source=${filter}`;
      const res = await fetch(`/api/face-review/honeypot?offset=${pageParam}&limit=${PAGE}${source}`, { credentials: "include" });
      if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
      return res.json();
    },
    initialPageParam: 0,
    getNextPageParam: (last, pages) => {
      const loaded = pages.reduce((n, p) => n + p.items.length, 0);
      return last.items.length && loaded < last.total ? loaded : undefined;
    },
  });
  const onSettled = () => queryClient.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith("/api/face-review") });
  const onError = (err: Error) => toast({ title: "That didn't work", description: err.message.replace(/^\d+: /, ""), variant: "destructive" });
  const plural = (n: number) => `${n} face${n === 1 ? "" : "s"}`;
  const release = useMutation({
    mutationFn: async (faceIds: string[]) => (await apiRequest("POST", "/api/face-review/honeypot/release", { faceIds })).json() as Promise<{ released: number }>,
    onSuccess: ({ released }) => {
      toast({ title: `Took ${plural(released)} out of the honey pot`, description: "They're back in the review queues." });
      setPicked(new Set());
    },
    onError,
    onSettled,
  });
  const confirm = useMutation({
    mutationFn: async (faceIds: string[]) => (await apiRequest("POST", "/api/face-review/honeypot/confirm", { faceIds })).json() as Promise<{ confirmed: number }>,
    onSuccess: ({ confirmed }) => {
      toast({ title: `Kept ${plural(confirmed)} in the honey pot`, description: "Future faces are matched against them too." });
      setPicked(new Set());
    },
    onError,
    onSettled,
  });

  const first = query.data?.pages[0];
  const filters = (
    <div className="flex gap-1.5">
      {FILTERS.map(({ value, label }) => {
        const n = value === "all" ? (first ? first.manual + first.auto : undefined) : first?.[value];
        return (
          <Button
            key={value}
            size="sm"
            variant={filter === value ? "secondary" : "ghost"}
            onClick={() => {
              setFilter(value);
              setPicked(new Set());
            }}
            data-testid={`filter-honeypot-${value}`}
          >
            {label}
            {n !== undefined && <span className="ml-1.5 text-muted-foreground">{n}</span>}
          </Button>
        );
      })}
    </div>
  );
  if (query.isLoading) return <div className="space-y-4">{filters}<div className="text-center py-16 text-muted-foreground">Loading…</div></div>;
  if (query.isError) return <div className="text-center py-16 text-sm text-destructive">Couldn't load the honey pot. Please refresh.</div>;
  const faces = query.data?.pages.flatMap((p) => p.items) ?? [];
  const total = first?.total ?? 0;
  if (!faces.length) {
    return (
      <div className="space-y-4">
        {filters}
        <div className="text-center py-16 text-muted-foreground">
          {filter === "auto"
            ? "No faces matched yet. With honey pot routing on (Recognition settings), auto-assign sends faces that look like these here."
            : "The honey pot is empty. Send faces that are too blurry to name here from a cluster or a photo."}
        </div>
      </div>
    );
  }
  const pickedAuto = faces.filter((f) => picked.has(f.id) && f.source === "auto").map((f) => f.id);
  const busy = release.isPending || confirm.isPending;
  const toggle = (id: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  return (
    <div className="space-y-4">
      {filters}
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-lg font-semibold">{total} face{total === 1 ? "" : "s"} in the honey pot</h2>
        <span className="text-sm text-muted-foreground">Too blurry to name. Pick any you can name after all.</span>
        <div className="ml-auto flex gap-2">
          {picked.size > 0 && (
            <Button size="sm" variant="ghost" onClick={() => setPicked(new Set())}>
              Clear
            </Button>
          )}
          {pickedAuto.length > 0 && (
            <Button size="sm" variant="outline" disabled={busy} onClick={() => confirm.mutate(pickedAuto)} data-testid="button-honeypot-confirm">
              {confirm.isPending ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <CheckCheck className="h-4 w-4 mr-1.5" />}
              Keep {pickedAuto.length}
            </Button>
          )}
          <Button size="sm" disabled={!picked.size || busy} onClick={() => release.mutate(Array.from(picked))} data-testid="button-honeypot-release">
            {release.isPending ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Undo2 className="h-4 w-4 mr-1.5" />}
            Take out{picked.size ? ` ${picked.size}` : ""}
          </Button>
        </div>
      </div>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(88px,1fr))] gap-1.5">
        {faces.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => toggle(f.id)}
            className={cn("relative rounded", picked.has(f.id) && "ring-2 ring-primary")}
            title={[f.source === "auto" ? "Matched by auto-assign" : "Sent by you", f.sharpness != null && `sharpness ${Math.round(f.sharpness)}`].filter(Boolean).join(", ")}
            data-testid={`honeypot-face-${f.id}`}
          >
            <img src={withImageSize(f.cropUrl, 128)} alt="" loading="lazy" className="aspect-square w-full object-cover rounded bg-muted" />
            {f.score != null && (
              <span className="absolute bottom-1 left-1 rounded bg-black/70 px-1 text-[10px] text-white">{f.score.toFixed(2)}</span>
            )}
            {picked.has(f.id) && <Check className="absolute top-1 right-1 h-4 w-4 rounded-full bg-primary text-primary-foreground p-0.5" />}
          </button>
        ))}
      </div>
      {query.hasNextPage && (
        <div className="flex justify-center">
          <Button variant="outline" size="sm" disabled={query.isFetchingNextPage} onClick={() => query.fetchNextPage()}>
            {query.isFetchingNextPage ? "Loading…" : "Load more"}
          </Button>
        </div>
      )}
    </div>
  );
}
