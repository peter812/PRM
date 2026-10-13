import { useRef, useState } from "react";
import { Link } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { BookUser, Loader2, Upload, AlertCircle, CheckCircle2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { withImageSize } from "@shared/image-size";

type Layout = "yearbook" | "yearbook_advanced" | "cyt" | "cyt_leads";
type Context = Partial<Record<"school" | "yearbookYear" | "grade" | "branch" | "year" | "quarter" | "production", string>>;
type Box = { x: number; y: number; w: number; h: number };
type PersonRef = { id: string; name: string; imageUrl: string | null };
type Match = { status: "existing"; person: PersonRef } | { status: "suggestion"; candidates: PersonRef[] } | { status: "new" };
type Entry = {
  n: number; faceUuid: string; box: Box; cropUrl: string | null;
  firstName: string; lastName: string; bio: string; lowConfidence: boolean; match: Match;
};
type Row = Entry & { personId: string | null; skip: boolean };
type Analysis = { photoId: string; imageUrl: string; entries: Entry[]; extraNames: string[] };
type CommitResult = { created: number; matched: number; imagesSet: number; failed: { name: string; error: string }[]; groupId: string };

const LAYOUTS: { value: Layout; label: string; hint: string }[] = [
  { value: "yearbook", label: "Yearbook – standard", hint: "Each name is printed below its face." },
  { value: "yearbook_advanced", label: "Yearbook – advanced", hint: "Each row of faces has its own name list on the left, in left-to-right order." },
  { value: "cyt", label: "Playbill CYT – standard", hint: "Each name is printed below its face." },
  { value: "cyt_leads", label: "Playbill CYT – leads", hint: "Faces on the left; name (first line) and bio to the right." },
];

const FIELDS: Record<"yearbook" | "cyt", { key: keyof Context; label: string; placeholder: string }[]> = {
  yearbook: [
    { key: "school", label: "School name", placeholder: "Lincoln High School" },
    { key: "yearbookYear", label: "Yearbook year", placeholder: "2019" },
    { key: "grade", label: "Grade level", placeholder: "10 or Sophomore" },
  ],
  cyt: [
    { key: "branch", label: "CYT branch", placeholder: "Spokane" },
    { key: "year", label: "Year", placeholder: "2024" },
    { key: "quarter", label: "Quarter", placeholder: "" },
    { key: "production", label: "Production name", placeholder: "Annie" },
  ],
};

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), credentials: "include" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Server error ${res.status}`);
  return data as T;
}

const defaultPersonId = (m: Match) => (m.status === "existing" ? m.person.id : null);

export default function RosterImportDemo() {
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [layout, setLayout] = useState<Layout>("yearbook");
  const [context, setContext] = useState<Context>({});
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [hovered, setHovered] = useState<number | null>(null);
  const [busy, setBusy] = useState<"analyze" | "commit" | null>(null);
  const [result, setResult] = useState<CommitResult | null>(null);

  const family = layout.startsWith("yearbook") ? "yearbook" : "cyt";
  const fields = FIELDS[family];
  const contextReady = fields.every((f) => context[f.key]?.trim());
  const isLeads = layout === "cyt_leads";

  const pickFile = (f: File | undefined) => {
    if (!f) return;
    setFile(f);
    setPreview(URL.createObjectURL(f));
    setNatural(null);
    setAnalysis(null);
    setRows([]);
    setResult(null);
  };

  const analyze = async () => {
    if (!file) return;
    setBusy("analyze");
    setResult(null);
    try {
      const form = new FormData();
      form.append("image", file);
      form.append("prmLocation", "roster_import");
      const up = await fetch("/api/upload-image", { method: "POST", body: form, credentials: "include" });
      const upData = await up.json().catch(() => ({}));
      if (!up.ok || !upData.photoId) throw new Error(upData.error || "Upload failed");
      const data = await postJson<Analysis>("/api/roster-import/analyze", { photoId: upData.photoId, layout, context });
      setAnalysis(data);
      setRows(data.entries.map((e) => ({ ...e, personId: defaultPersonId(e.match), skip: !e.firstName })));
      if (data.entries.length === 0) toast({ title: "No faces found", description: "PRM Compute did not detect any faces on this page.", variant: "destructive" });
    } catch (err: any) {
      toast({ title: "Analyze failed", description: err.message, variant: "destructive" });
    } finally {
      setBusy(null);
    }
  };

  const update = (n: number, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.n === n ? { ...r, ...patch } : r)));

  /** Names were edited: re-check who they match. */
  const rematch = async (row: Row) => {
    try {
      const match = await postJson<Match>("/api/roster-import/match", { layout, context, firstName: row.firstName, lastName: row.lastName });
      update(row.n, { match, personId: defaultPersonId(match) });
    } catch { /* keep the old match */ }
  };

  const commit = async () => {
    if (!analysis) return;
    const entries = rows.filter((r) => !r.skip).map((r) => ({
      faceUuid: r.faceUuid, box: r.box, firstName: r.firstName, lastName: r.lastName,
      bio: isLeads ? r.bio : undefined, personId: r.personId,
    }));
    setBusy("commit");
    try {
      const res = await postJson<CommitResult>("/api/roster-import/commit", { photoId: analysis.photoId, layout, context, entries });
      setResult(res);
      toast({ title: "Import complete", description: `${res.created} created, ${res.matched} matched, ${res.imagesSet} profile images set.` });
    } catch (err: any) {
      toast({ title: "Import failed", description: err.message, variant: "destructive" });
    } finally {
      setBusy(null);
    }
  };

  const importCount = rows.filter((r) => !r.skip).length;

  return (
    <div className="h-full overflow-auto">
      <div className="container mx-auto p-6 max-w-6xl space-y-6">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2"><BookUser className="h-7 w-7" />Yearbook &amp; Playbill Import</h1>
          <p className="text-muted-foreground">
            Upload a yearbook or playbill page. Faces are detected, the vision model reads each face's name, and you review the
            pairings before people are created. New people are marked low value.
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>1. Page type &amp; details</CardTitle>
            <CardDescription>The details keep people with the same name from different schools, years or shows apart.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1 max-w-md">
              <Label>Image type</Label>
              <Select value={layout} onValueChange={(v) => { setLayout(v as Layout); setAnalysis(null); setRows([]); setResult(null); }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {LAYOUTS.map((l) => <SelectItem key={l.value} value={l.value}>{l.label}</SelectItem>)}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">{LAYOUTS.find((l) => l.value === layout)!.hint}</p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {fields.map((f) => (
                <div key={f.key} className="space-y-1">
                  <Label>{f.label}</Label>
                  {f.key === "quarter" ? (
                    <Select value={context.quarter ?? ""} onValueChange={(v) => setContext((c) => ({ ...c, quarter: v }))}>
                      <SelectTrigger><SelectValue placeholder="Pick a quarter" /></SelectTrigger>
                      <SelectContent>{["Q1", "Q2", "Q3", "Q4"].map((q) => <SelectItem key={q} value={q}>{q}</SelectItem>)}</SelectContent>
                    </Select>
                  ) : (
                    <Input value={context[f.key] ?? ""} placeholder={f.placeholder} onChange={(e) => setContext((c) => ({ ...c, [f.key]: e.target.value }))} />
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>2. Page image</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => pickFile(e.target.files?.[0])} />
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => fileRef.current?.click()}><Upload className="h-4 w-4 mr-2" />{file ? "Choose another image" : "Choose image"}</Button>
              <Button onClick={analyze} disabled={!file || !contextReady || busy !== null}>
                {busy === "analyze" && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Analyze page
              </Button>
              {!contextReady && file && <span className="text-sm text-muted-foreground self-center">Fill in every detail above first.</span>}
            </div>
            {preview && (
              <div className="relative inline-block max-w-full">
                <img src={preview} alt="Page" className="max-h-[70vh] max-w-full" onLoad={(e) => setNatural({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })} />
                {natural && rows.map((r) => (
                  <div
                    key={r.n}
                    onMouseEnter={() => setHovered(r.n)}
                    onMouseLeave={() => setHovered(null)}
                    className={`absolute border-2 ${hovered === r.n ? "border-yellow-400 bg-yellow-400/20" : r.skip ? "border-slate-400" : "border-red-500"}`}
                    style={{ left: `${(r.box.x / natural.w) * 100}%`, top: `${(r.box.y / natural.h) * 100}%`, width: `${(r.box.w / natural.w) * 100}%`, height: `${(r.box.h / natural.h) * 100}%` }}
                  >
                    <span className="absolute -top-0 -left-0 bg-red-500 text-white text-[10px] leading-none px-1 py-0.5">{r.n}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {analysis && rows.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>3. Review pairings</CardTitle>
              <CardDescription>
                Fix any misread names. A name already in this {family === "yearbook" ? "school" : "CYT branch"} is matched automatically;
                a same-name person elsewhere is only a suggestion.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {analysis.extraNames.length > 0 && (
                <div className="flex items-start gap-2 rounded-md border border-amber-500/50 bg-amber-500/10 p-3 text-sm">
                  <AlertCircle className="h-4 w-4 mt-0.5 text-amber-500" />
                  <div>Names on the page without a detected face (not imported): {analysis.extraNames.join(", ")}</div>
                </div>
              )}
              {rows.map((r) => (
                <div
                  key={r.n}
                  onMouseEnter={() => setHovered(r.n)}
                  onMouseLeave={() => setHovered(null)}
                  className={`flex flex-wrap gap-3 items-start rounded-md border p-3 ${r.skip ? "opacity-50" : ""} ${hovered === r.n ? "ring-2 ring-yellow-400" : ""}`}
                >
                  <div className="text-sm font-mono w-6 pt-2">{r.n}</div>
                  {r.cropUrl ? <img src={withImageSize(r.cropUrl, 128)} alt="" className="h-16 w-16 rounded object-cover" /> : <div className="h-16 w-16 rounded bg-muted" />}
                  <div className="flex-1 min-w-[240px] space-y-2">
                    <div className="flex gap-2">
                      <Input value={r.firstName} placeholder="First name" onChange={(e) => update(r.n, { firstName: e.target.value })} onBlur={() => rematch(r)} />
                      <Input value={r.lastName} placeholder="Last name" onChange={(e) => update(r.n, { lastName: e.target.value })} onBlur={() => rematch(r)} />
                    </div>
                    {isLeads && <Textarea value={r.bio} rows={3} placeholder="Bio" onChange={(e) => update(r.n, { bio: e.target.value })} />}
                    <MatchControl row={r} onPick={(personId) => update(r.n, { personId })} />
                  </div>
                  <div className="flex flex-col items-end gap-2">
                    {r.lowConfidence && <Badge variant="outline" className="border-amber-500 text-amber-600">Check name</Badge>}
                    <label className="flex items-center gap-2 text-sm">
                      <Checkbox checked={r.skip} onCheckedChange={(v) => update(r.n, { skip: !!v })} />Skip
                    </label>
                  </div>
                </div>
              ))}
              <div className="flex items-center gap-3 pt-2">
                <Button onClick={commit} disabled={busy !== null || importCount === 0 || rows.some((r) => !r.skip && !r.firstName.trim())}>
                  {busy === "commit" && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Import {importCount} {importCount === 1 ? "person" : "people"}
                </Button>
                {rows.some((r) => !r.skip && !r.firstName.trim()) && <span className="text-sm text-muted-foreground">Every imported face needs a first name (or skip it).</span>}
              </div>
            </CardContent>
          </Card>
        )}

        {result && (
          <Card>
            <CardContent className="pt-6 space-y-2">
              <div className="flex items-center gap-2 font-medium"><CheckCircle2 className="h-5 w-5 text-green-600" />Import finished</div>
              <div className="text-sm">
                {result.created} people created (low value) · {result.matched} matched to existing · {result.imagesSet} profile images set ·{" "}
                <Link href={`/group/${result.groupId}`} className="underline">open group</Link>
              </div>
              {result.failed.length > 0 && (
                <ul className="text-sm text-destructive list-disc pl-5">
                  {result.failed.map((f, i) => <li key={i}>{f.name}: {f.error}</li>)}
                </ul>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

function MatchControl({ row, onPick }: { row: Row; onPick: (personId: string | null) => void }) {
  const m = row.match;
  if (m.status === "existing") {
    return (
      <div className="flex items-center gap-2 text-sm">
        <Badge className="bg-emerald-600">Existing</Badge>
        <Link href={`/person/${m.person.id}`} className="underline">{m.person.name}</Link>
        <span className="text-muted-foreground">{m.person.imageUrl ? "· keeps current photo" : "· will get this photo"}</span>
      </div>
    );
  }
  if (m.status === "suggestion") {
    return (
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Badge variant="outline" className="border-sky-500 text-sky-600">Same name elsewhere</Badge>
        <Select value={row.personId ?? "new"} onValueChange={(v) => onPick(v === "new" ? null : v)}>
          <SelectTrigger className="h-8 w-[260px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="new">Create a new person</SelectItem>
            {m.candidates.map((c) => <SelectItem key={c.id} value={c.id}>Use existing: {c.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
    );
  }
  return <Badge variant="secondary">New person</Badge>;
}
