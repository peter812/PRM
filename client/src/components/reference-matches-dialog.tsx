/** References that look like a face: an uploaded photo, a face crop, a person's faces or another reference. */
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { Loader2 } from "lucide-react";
import type { ReferenceLocation, ReferenceRecord } from "@shared/schema";
import { withImageSize } from "@shared/image-size";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export type ReferenceProbe = { faceUuid: string } | { personId: string } | { referenceId: string } | { file: File };
type Match = ReferenceRecord & { similarity: number };

/** "Yearbook · 2019 · Lincoln High School · Spokane, WA" */
export function formatLocation(loc: ReferenceLocation): string {
  const { type, layout, subtype, ...rest } = loc;
  return [type, ...Object.values(rest)].filter(Boolean).join(" · ");
}

export function ReferenceCard({ reference, similarity, onFindSimilar }: { reference: ReferenceRecord; similarity?: number; onFindSimilar?: () => void }) {
  return (
    <div className="rounded-md border p-2 space-y-1.5 text-sm">
      <img src={withImageSize(reference.cropUrl, 360)} alt={reference.name ?? ""} className="aspect-square w-full rounded object-cover bg-muted" loading="lazy" />
      <div className="flex items-start justify-between gap-1">
        <div className="font-medium truncate">{reference.name || <span className="text-muted-foreground italic">No name</span>}</div>
        {similarity !== undefined && <Badge variant="secondary" className="shrink-0">{Math.round(similarity * 100)}%</Badge>}
      </div>
      {reference.role && <div className="text-xs font-medium line-clamp-2">{reference.role}</div>}
      <div className="text-xs text-muted-foreground line-clamp-2">{formatLocation(reference.location)}</div>
      {reference.bio && <div className="text-xs line-clamp-3">{reference.bio}</div>}
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>{format(new Date(reference.collectedAt), "MMM d, yyyy")}</span>
        {onFindSimilar && <button type="button" className="underline hover:text-foreground" onClick={onFindSimilar}>Find similar</button>}
      </div>
    </div>
  );
}

async function search(probe: ReferenceProbe): Promise<{ probeFaces: number; matches: Match[] }> {
  let init: RequestInit;
  if ("file" in probe) {
    const form = new FormData();
    form.append("image", probe.file);
    init = { method: "POST", body: form, credentials: "include" };
  } else {
    init = { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(probe), credentials: "include" };
  }
  const res = await fetch("/api/references/search", init);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Server error ${res.status}`);
  return data;
}

export function ReferenceMatchesDialog({ probe, onClose, onFindSimilar }: {
  probe: ReferenceProbe | null;
  onClose: () => void;
  onFindSimilar?: (referenceId: string) => void;
}) {
  const { data, isFetching, error } = useQuery({
    queryKey: ["/api/references/search", probe && ("file" in probe ? { file: `${probe.file.name}:${probe.file.size}:${probe.file.lastModified}` } : probe)],
    queryFn: () => search(probe!),
    enabled: !!probe,
    staleTime: 0,
    gcTime: 0,
  });

  return (
    <Dialog open={!!probe} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-4xl max-h-[85vh] overflow-auto">
        <DialogHeader>
          <DialogTitle>Matching references</DialogTitle>
          <DialogDescription>
            {data && !isFetching ? `${data.matches.length} match${data.matches.length === 1 ? "" : "es"} from ${data.probeFaces} face${data.probeFaces === 1 ? "" : "s"} searched.` : "References whose face looks like this one, best first."}
          </DialogDescription>
        </DialogHeader>
        {isFetching ? (
          <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin" /></div>
        ) : error ? (
          <p className="text-sm text-destructive">{(error as Error).message}</p>
        ) : data?.probeFaces === 0 ? (
          <p className="text-sm text-muted-foreground">No face to search with.</p>
        ) : data?.matches.length === 0 ? (
          <p className="text-sm text-muted-foreground">No references look like this face.</p>
        ) : (
          <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 md:grid-cols-4">
            {data?.matches.map((m) => (
              <ReferenceCard key={m.id} reference={m} similarity={m.similarity} onFindSimilar={onFindSimilar && (() => onFindSimilar(m.id))} />
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
