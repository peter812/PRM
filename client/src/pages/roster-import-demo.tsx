import { useRef, useState } from "react";
import { Link } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { BookUser, Loader2, Upload, AlertCircle, CheckCircle2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { withImageSize } from "@shared/image-size";

type Layout = "yearbook" | "yearbook_advanced" | "cyt" | "cyt_leads";
type Location = Record<string, string>;
type Box = { x: number; y: number; w: number; h: number };
type Entry = { n: number; referenceUuid: string; box: Box; cropUrl: string; name: string; role: string; bio: string; lowConfidence: boolean };
type Row = Entry & { skip: boolean };
type Debug = { annotatedImage: string; lines: { n: number; text: string[] }[]; prompt?: string; reply?: string };
type Analysis = { page: { w: number; h: number }; entries: Entry[]; unmatchedText: string[]; debug?: Debug };

const LAYOUTS: { value: Layout; label: string; hint: string }[] = [
  { value: "yearbook", label: "Yearbook – standard", hint: "Each name is printed below its face." },
  { value: "yearbook_advanced", label: "Yearbook – advanced", hint: "Each row of faces has its own name list on the left, in left-to-right order." },
  { value: "cyt", label: "Playbill CYT – standard", hint: "Each name is printed below its face." },
  { value: "cyt_leads", label: "Playbill CYT – leads", hint: "Each face has a name, role and bio beside it." },
];

// Mirrors ROSTER_SUBTYPES in server/roster-layout.ts; the first one is the default.
type Subtype = { value: string; label: string; hint: string; role?: boolean; bio?: boolean };
const STANDARD: Subtype[] = [{ value: "standard", label: "Standard", hint: "" }];
const SUBTYPES: Record<Layout, Subtype[]> = {
  yearbook: STANDARD,
  yearbook_advanced: STANDARD,
  cyt: [
    { value: "separated", label: "Separated", hint: "First name on the first line, last name on the second line." },
    { value: "name_role", label: "Name and role", hint: "First and last name on the first line, role(s) in a smaller font on the second.", role: true },
  ],
  cyt_leads: [
    { value: "spokane", label: "Spokane config", hint: "\"{role} - {name}\" in bold beside the face, bio below it.", role: true, bio: true },
    { value: "north_idaho", label: "North Idaho config", hint: "Role below the photo; the bio starts with the name in bold.", role: true, bio: true },
  ],
};

const FIELDS: Record<"yearbook" | "cyt", { key: string; label: string; placeholder: string }[]> = {
  yearbook: [
    { key: "year", label: "Year", placeholder: "2019" },
    { key: "month", label: "Month", placeholder: "May" },
    { key: "schoolName", label: "School name", placeholder: "Lincoln High School" },
    { key: "schoolLocation", label: "School location", placeholder: "Spokane, WA" },
    { key: "grade", label: "Grade", placeholder: "10 or Sophomore" },
  ],
  cyt: [
    { key: "year", label: "Year", placeholder: "2024" },
    { key: "quarter", label: "Quarter", placeholder: "" },
    { key: "organization", label: "Organization / branch", placeholder: "CYT Spokane" },
    { key: "production", label: "Production", placeholder: "Annie" },
  ],
};
const LOCATION_TYPE = { yearbook: "Yearbook", cyt: "Playbill" } as const;

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), credentials: "include" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Server error ${res.status}`);
  return data as T;
}

export default function RosterImportDemo() {
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [layout, setLayout] = useState<Layout>("yearbook");
  const [subtypeValue, setSubtypeValue] = useState(SUBTYPES.yearbook[0].value);
  const [location, setLocation] = useState<Location>({});
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [hovered, setHovered] = useState<number | null>(null);
  const [busy, setBusy] = useState<"analyze" | "commit" | null>(null);
  const [saved, setSaved] = useState<number | null>(null);
  const [dryRun, setDryRun] = useState(false);
  const [aiRefine, setAiRefine] = useState(false);

  const family = layout.startsWith("yearbook") ? "yearbook" : "cyt";
  const fields = FIELDS[family];
  const subtype = SUBTYPES[layout].find((s) => s.value === subtypeValue)!;
  const resetResults = () => { setAnalysis(null); setRows([]); setSaved(null); };

  const pickFile = (f: File | undefined) => {
    if (!f) return;
    setFile(f);
    setPreview(URL.createObjectURL(f));
    setAnalysis(null);
    setRows([]);
    setSaved(null);
  };

  const analyze = async () => {
    if (!file) return;
    setBusy("analyze");
    setSaved(null);
    try {
      const form = new FormData();
      form.append("image", file);
      form.append("layout", layout);
      form.append("subtype", subtype.value);
      if (dryRun) form.append("dryRun", "true");
      if (aiRefine) form.append("aiRefine", "true");
      const res = await fetch("/api/roster-import/analyze", { method: "POST", body: form, credentials: "include" });
      const data: Analysis = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as any).error || `Server error ${res.status}`);
      setAnalysis(data);
      setRows(data.entries.map((e) => ({ ...e, skip: false })));
      if (data.entries.length === 0) toast({ title: "No faces found", description: "PRM Compute did not detect any faces on this page.", variant: "destructive" });
    } catch (err: any) {
      toast({ title: "Analyze failed", description: err.message, variant: "destructive" });
    } finally {
      setBusy(null);
    }
  };

  const update = (n: number, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.n === n ? { ...r, ...patch } : r)));

  const commitBody = () => ({
    location: { ...location, type: LOCATION_TYPE[family], layout, subtype: subtype.value },
    entries: rows.filter((r) => !r.skip).map((r) => ({
      referenceUuid: r.referenceUuid, cropUrl: r.cropUrl, name: r.name,
      role: subtype.role ? r.role : undefined, bio: subtype.bio ? r.bio : undefined,
    })),
    discard: rows.filter((r) => r.skip).map((r) => r.referenceUuid),
  });

  const commit = async () => {
    if (!analysis) return;
    setBusy("commit");
    try {
      const res = await postJson<{ saved: number }>("/api/roster-import/commit", commitBody());
      setSaved(res.saved);
      setAnalysis(null);
      setRows([]);
      toast({ title: "References saved", description: `${res.saved} reference${res.saved === 1 ? "" : "s"} saved.` });
    } catch (err: any) {
      toast({ title: "Save failed", description: err.message, variant: "destructive" });
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
            Upload a yearbook or playbill page. Faces are detected, the printed text is read with OCR and matched to each face by
            position, and you review the pairings before each face is saved as a reference.
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>1. Page type &amp; details</CardTitle>
            <CardDescription>Saved as each reference's location (type: {LOCATION_TYPE[family]}). Every detail is optional.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2 max-w-3xl">
              <div className="space-y-1">
                <Label>Image type</Label>
                <Select value={layout} onValueChange={(v) => { setLayout(v as Layout); setSubtypeValue(SUBTYPES[v as Layout][0].value); resetResults(); }}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {LAYOUTS.map((l) => <SelectItem key={l.value} value={l.value}>{l.label}</SelectItem>)}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">{LAYOUTS.find((l) => l.value === layout)!.hint}</p>
              </div>
              <div className="space-y-1">
                <Label>Subtype</Label>
                <Select value={subtype.value} onValueChange={(v) => { setSubtypeValue(v); resetResults(); }}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {SUBTYPES[layout].map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
                  </SelectContent>
                </Select>
                {subtype.hint && <p className="text-xs text-muted-foreground">{subtype.hint}</p>}
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              {fields.map((f) => (
                <div key={f.key} className="space-y-1">
                  <Label>{f.label}</Label>
                  {f.key === "quarter" ? (
                    <Select value={location.quarter ?? ""} onValueChange={(v) => setLocation((l) => ({ ...l, quarter: v }))}>
                      <SelectTrigger><SelectValue placeholder="Pick a quarter" /></SelectTrigger>
                      <SelectContent>{["Q1", "Q2", "Q3", "Q4"].map((q) => <SelectItem key={q} value={q}>{q}</SelectItem>)}</SelectContent>
                    </Select>
                  ) : (
                    <Input value={location[f.key] ?? ""} placeholder={f.placeholder} onChange={(e) => setLocation((l) => ({ ...l, [f.key]: e.target.value }))} />
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
              <Button onClick={analyze} disabled={!file || busy !== null}>
                {busy === "analyze" && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Analyze page
              </Button>
              <label className="flex items-center gap-2 text-sm" title="Run detection and OCR, but save nothing; show the debug output instead.">
                <Switch checked={dryRun} onCheckedChange={setDryRun} />Dry run
              </label>
              <label className="flex items-center gap-2 text-sm" title="Let the vision model correct names, roles and bios. Only text that OCR found near the face is accepted. Slower.">
                <Switch checked={aiRefine} onCheckedChange={setAiRefine} />Refine with AI
              </label>
            </div>
            {preview && (
              <div className="relative inline-block max-w-full">
                <img src={preview} alt="Page" className="max-h-[70vh] max-w-full" />
                {analysis && rows.map((r) => (
                  <div
                    key={r.n}
                    onMouseEnter={() => setHovered(r.n)}
                    onMouseLeave={() => setHovered(null)}
                    className={`absolute border-2 ${hovered === r.n ? "border-yellow-400 bg-yellow-400/20" : r.skip ? "border-slate-400" : "border-red-500"}`}
                    style={{ left: `${(r.box.x / analysis.page.w) * 100}%`, top: `${(r.box.y / analysis.page.h) * 100}%`, width: `${(r.box.w / analysis.page.w) * 100}%`, height: `${(r.box.h / analysis.page.h) * 100}%` }}
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
              <CardDescription>Fix any misread names. Skipped faces are discarded; a face without a name is saved without one.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {analysis.unmatchedText.length > 0 && (
                <div className="flex items-start gap-2 rounded-md border border-amber-500/50 bg-amber-500/10 p-3 text-sm">
                  <AlertCircle className="h-4 w-4 mt-0.5 text-amber-500" />
                  <div>Text not matched to a face (not saved): {analysis.unmatchedText.join(" · ")}</div>
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
                  <img src={withImageSize(r.cropUrl, 128)} alt="" className="h-16 w-16 rounded object-cover" />
                  <div className="flex-1 min-w-[240px] space-y-2">
                    <Input value={r.name} placeholder="Name" onChange={(e) => update(r.n, { name: e.target.value })} />
                    {subtype.role && <Input value={r.role} placeholder="Role(s)" onChange={(e) => update(r.n, { role: e.target.value })} />}
                    {subtype.bio &&<Textarea value={r.bio} rows={3} placeholder="Bio" onChange={(e) => update(r.n, { bio: e.target.value })} />}
                  </div>
                  <div className="flex flex-col items-end gap-2">
                    {r.lowConfidence && <Badge variant="outline" className="border-amber-500 text-amber-600">Check name</Badge>}
                    <label className="flex items-center gap-2 text-sm">
                      <Checkbox checked={r.skip} onCheckedChange={(v) => update(r.n, { skip: !!v })} />Skip
                    </label>
                  </div>
                </div>
              ))}
              {!analysis.debug && (
                <div className="flex items-center gap-3 pt-2">
                  <Button onClick={commit} disabled={busy !== null}>
                    {busy === "commit" && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Save {importCount} reference{importCount === 1 ? "" : "s"}
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {analysis?.debug && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">Dry run output <Badge variant="outline">nothing saved</Badge></CardTitle>
              <CardDescription>The faces, text slots and OCR lines found, the text read for each face, and the commit that Save would send.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1">
                <Label>Faces (red), text slots (blue) and OCR lines (green: matched, amber: unmatched)</Label>
                <img src={analysis.debug.annotatedImage} alt="Labeled page" className="max-h-[70vh] max-w-full border" />
              </div>
              <div className="space-y-1">
                <Label>OCR lines per face</Label>
                <pre className="whitespace-pre-wrap rounded-md bg-muted p-3 text-xs">
                  {analysis.debug.lines.map((l) => `${l.n}: ${l.text.join(" / ")}`).join("\n")}
                </pre>
              </div>
              {analysis.debug.prompt && (
                <div className="space-y-1">
                  <Label>AI refine prompt</Label>
                  <pre className="whitespace-pre-wrap rounded-md bg-muted p-3 text-xs">{analysis.debug.prompt}</pre>
                </div>
              )}
              {analysis.debug.reply && (
                <div className="space-y-1">
                  <Label>Raw AI reply</Label>
                  <pre className="whitespace-pre-wrap rounded-md bg-muted p-3 text-xs">{analysis.debug.reply}</pre>
                </div>
              )}
              <div className="space-y-1">
                <Label>Commit payload (crops omitted)</Label>
                <pre className="whitespace-pre-wrap rounded-md bg-muted p-3 text-xs">
                  {JSON.stringify(commitBody(), (k, v) => (k === "cropUrl" ? undefined : v), 2)}
                </pre>
              </div>
            </CardContent>
          </Card>
        )}

        {saved !== null && (
          <Card>
            <CardContent className="pt-6 flex items-center gap-2 text-sm">
              <CheckCircle2 className="h-5 w-5 text-green-600" />
              {saved} reference{saved === 1 ? "" : "s"} saved ·
              <Link href="/demos/references" className="underline">open references</Link>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

