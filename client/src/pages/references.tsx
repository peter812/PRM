import { useRef, useState } from "react";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { Link } from "wouter";
import { Loader2, ScanFace, Search, Upload } from "lucide-react";
import type { ReferenceRecord } from "@shared/schema";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ReferenceCard, ReferenceMatchesDialog, type ReferenceProbe } from "@/components/reference-matches-dialog";

const PAGE_SIZE = 60;
const ALL_TYPES = "__all";

export default function ReferencesPage() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState("");
  const [q, setQ] = useState("");
  const [type, setType] = useState(ALL_TYPES);
  const [sort, setSort] = useState<"newest" | "oldest">("newest");
  const [page, setPage] = useState(1);
  const [probe, setProbe] = useState<ReferenceProbe | null>(null);

  const params = new URLSearchParams({ sort, page: String(page), pageSize: String(PAGE_SIZE) });
  if (name.trim()) params.set("name", name.trim());
  if (q.trim()) params.set("q", q.trim());
  if (type !== ALL_TYPES) params.set("type", type);

  const { data, isFetching, error } = useQuery<{ items: ReferenceRecord[]; total: number; types: string[] }>({
    queryKey: [`/api/references?${params}`],
    placeholderData: keepPreviousData,
  });
  const pages = Math.max(1, Math.ceil((data?.total ?? 0) / PAGE_SIZE));
  const filter = <T,>(set: (v: T) => void) => (v: T) => { set(v); setPage(1); };

  return (
    <div className="h-full overflow-auto">
      <div className="container mx-auto p-6 max-w-6xl space-y-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-3xl font-bold flex items-center gap-2"><ScanFace className="h-7 w-7" />References</h1>
            <p className="text-muted-foreground">
              Faces saved from yearbook and playbill pages (<Link href="/demos/roster-import" className="underline">import more</Link>).
            </p>
          </div>
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) setProbe({ file });
            e.target.value = "";
          }} />
          <Button variant="outline" onClick={() => fileRef.current?.click()}><Upload className="h-4 w-4 mr-2" />Search by face</Button>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Input value={name} placeholder="Name" onChange={(e) => filter(setName)(e.target.value)} />
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input value={q} placeholder="Keyword (name, role, bio, location)" className="pl-8" onChange={(e) => filter(setQ)(e.target.value)} />
          </div>
          <Select value={type} onValueChange={filter(setType)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_TYPES}>All types</SelectItem>
              {data?.types.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={sort} onValueChange={filter(setSort as (v: string) => void)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="newest">Newest first</SelectItem>
              <SelectItem value="oldest">Oldest first</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          {isFetching && <Loader2 className="h-4 w-4 animate-spin" />}
          {data && `${data.total} reference${data.total === 1 ? "" : "s"}`}
        </div>

        {error ? (
          <p className="text-sm text-destructive">{(error as Error).message}</p>
        ) : data?.items.length === 0 ? (
          <p className="text-sm text-muted-foreground">No references match.</p>
        ) : (
          <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
            {data?.items.map((r) => <ReferenceCard key={r.id} reference={r} onFindSimilar={() => setProbe({ referenceId: r.id })} />)}
          </div>
        )}

        {pages > 1 && (
          <div className="flex items-center justify-center gap-3">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</Button>
            <span className="text-sm">Page {page} of {pages}</span>
            <Button variant="outline" size="sm" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>Next</Button>
          </div>
        )}
      </div>

      <ReferenceMatchesDialog probe={probe} onClose={() => setProbe(null)} onFindSimilar={(referenceId) => setProbe({ referenceId })} />
    </div>
  );
}
