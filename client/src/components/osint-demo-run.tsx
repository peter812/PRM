// OSINT settings → Demo run: one scan of any username or email with any
// scanner, outside of any account. It goes through the scan queue like every
// other scan (so it shows in OSINT Tasks) and is polled until it finishes.
import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { OSINT_TOOLS, getOsintTool, type OsintTargetType } from "@shared/osint-tools";
import { AlertCircle, FlaskConical, Loader2, Search, X } from "lucide-react";

type JobStatus = "pending" | "running" | "done" | "error" | "cancelled";

interface JobSummary {
  id: string;
  tool: string;
  target: string;
  target_type: OsintTargetType;
  status: JobStatus;
  error: string | null;
}
interface JobDetail extends JobSummary {
  result: any | null;
}

const TERMINAL: JobStatus[] = ["done", "error", "cancelled"];

function statusVariant(status: JobStatus): "default" | "secondary" | "destructive" | "outline" {
  if (status === "done") return "default";
  if (status === "error" || status === "cancelled") return "destructive";
  return "secondary";
}

/** Render a tool's `result` in a readable way, branching on its shape. */
function ResultView({ result }: { result: any }) {
  if (!result || typeof result !== "object") {
    return <p className="text-sm text-muted-foreground">No structured result returned.</p>;
  }

  // The five tools each expose a list of hits under one of these keys.
  const list: any[] | undefined =
    result.sites ?? result.platforms ?? result.modules ?? undefined;

  return (
    <div className="space-y-4">
      {Array.isArray(list) && (
        <div>
          <p className="text-sm text-muted-foreground mb-2">
            {list.length} result{list.length === 1 ? "" : "s"}
          </p>
          <div className="space-y-1">
            {list.map((item, i) => {
              const name = item.site ?? item.platform ?? item.name ?? `#${i + 1}`;
              const url = item.url as string | undefined;
              return (
                <div
                  key={i}
                  className="flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm"
                  data-testid={`osint-result-item-${i}`}
                >
                  <div className="min-w-0">
                    <span className="font-medium">{name}</span>
                    {url && (url.startsWith("http://") || url.startsWith("https://")) ? (
                      <a
                        href={url}
                        target="_blank"
                        rel="noreferrer"
                        className="block truncate text-xs text-muted-foreground underline underline-offset-2"
                      >
                        {url}
                      </a>
                    ) : url ? (
                      <span className="block truncate text-xs text-muted-foreground">{url}</span>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 gap-1">
                    {item.tags?.map((t: string) => (
                      <Badge key={t} variant="outline">{t}</Badge>
                    ))}
                    {item.status && <Badge variant="secondary">{item.status}</Badge>}
                    {item.exists !== undefined && (
                      <Badge variant={item.exists ? "default" : "outline"}>
                        {item.exists ? "exists" : "free"}
                      </Badge>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {Array.isArray(result.breach_hits) && result.breach_hits.length > 0 && (
        <div>
          <p className="text-sm font-medium mb-1">Breach hits</p>
          <ul className="list-disc pl-5 text-sm">
            {result.breach_hits.map((b: any, i: number) => (
              <li key={i}>{typeof b === "string" ? b : JSON.stringify(b)}</li>
            ))}
          </ul>
        </div>
      )}

      <details className="text-xs">
        <summary className="cursor-pointer text-muted-foreground">Raw JSON</summary>
        <pre className="mt-2 max-h-96 overflow-auto rounded-md bg-muted p-3">
          {JSON.stringify(result, null, 2)}
        </pre>
      </details>
    </div>
  );
}

export function OsintDemoRunCard({ disabled }: { disabled: boolean }) {
  const { toast } = useToast();
  const [toolName, setToolName] = useState("sherlock");
  const tool = getOsintTool(toolName) ?? OSINT_TOOLS[0];
  const [targetType, setTargetType] = useState<OsintTargetType>("username");
  const [target, setTarget] = useState("");
  const [jobId, setJobId] = useState<string | null>(null);

  const submitMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/osint/scans", { tool: toolName, target: target.trim(), target_type: targetType });
      return res.json() as Promise<JobSummary>;
    },
    onSuccess: (job) => {
      setJobId(job.id);
      queryClient.invalidateQueries({ queryKey: ["/api/osint/scan-queue"] });
    },
    onError: (err: Error) => toast({ title: "Scan failed to start", description: err.message, variant: "destructive" }),
  });

  const { data: job } = useQuery<JobDetail>({
    queryKey: ["/api/osint/scans", jobId],
    enabled: !!jobId,
    refetchInterval: (query) => {
      const s = query.state.data?.status;
      return s && !TERMINAL.includes(s) ? 2500 : false;
    },
  });

  const cancelMutation = useMutation({
    mutationFn: async () => {
      if (jobId) await apiRequest("DELETE", `/api/osint/scans/${jobId}`);
    },
    onSuccess: () => {
      toast({ title: "Scan cancelled" });
      if (jobId) queryClient.invalidateQueries({ queryKey: ["/api/osint/scans", jobId] });
      queryClient.invalidateQueries({ queryKey: ["/api/osint/scan-queue"] });
    },
    onError: (err: Error) => toast({ title: "Failed to cancel scan", description: err.message, variant: "destructive" }),
  });

  const isRunning = job ? !TERMINAL.includes(job.status) : submitMutation.isPending;
  const go = () => {
    if (!target.trim() || isRunning) return;
    setJobId(null);
    submitMutation.mutate();
  };
  const pickTool = (name: string) => {
    setToolName(name);
    const meta = getOsintTool(name);
    setTargetType(meta?.supportedTargetTypes[0] ?? "username");
  };

  return (
    <Card data-testid="card-osint-demo-run">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <FlaskConical className="h-5 w-5 text-muted-foreground" />
          Demo run
        </CardTitle>
        <CardDescription>Try a scanner on any username or email. {tool.description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-2">
          <Select value={toolName} onValueChange={pickTool}>
            <SelectTrigger className="w-40" data-testid="select-osint-demo-tool"><SelectValue /></SelectTrigger>
            <SelectContent>
              {OSINT_TOOLS.map((t) => <SelectItem key={t.name} value={t.name}>{t.label}</SelectItem>)}
            </SelectContent>
          </Select>
          {tool.supportedTargetTypes.length > 1 && (
            <Select value={targetType} onValueChange={(v) => setTargetType(v as OsintTargetType)}>
              <SelectTrigger className="w-32" data-testid="select-osint-target-type"><SelectValue /></SelectTrigger>
              <SelectContent>
                {tool.supportedTargetTypes.map((t) => (
                  <SelectItem key={t} value={t}>{t === "email" ? "Email" : "Username"}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
        <div className="flex gap-2">
          <Input
            value={target}
            placeholder={targetType === "email" ? "someone@example.com" : "someusername"}
            onChange={(e) => setTarget(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && go()}
            data-testid="input-osint-target"
          />
          <Button onClick={go} disabled={disabled || !target.trim() || isRunning} data-testid="button-osint-run">
            {isRunning ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Search className="h-4 w-4 mr-2" />}
            Go
          </Button>
        </div>

        {jobId && (
          <div className="border-t pt-4 space-y-3" data-testid="osint-demo-results">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Results</span>
              <div className="flex items-center gap-2">
                {job && <Badge variant={statusVariant(job.status)} data-testid="badge-osint-status">{job.status}</Badge>}
                {job && !TERMINAL.includes(job.status) && (
                  <Button variant="ghost" size="sm" onClick={() => cancelMutation.mutate()} disabled={cancelMutation.isPending} data-testid="button-osint-cancel">
                    <X className="h-4 w-4 mr-1" />
                    Cancel
                  </Button>
                )}
              </div>
            </div>
            {!job || !TERMINAL.includes(job.status) ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                {job?.status === "running" ? "Scanning…" : "Queued…"}
              </div>
            ) : job.status === "error" ? (
              <div className="flex items-start gap-2 text-sm text-destructive">
                <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                <span>{job.error ?? "The scan failed."}</span>
              </div>
            ) : job.status === "cancelled" ? (
              <p className="text-sm text-muted-foreground">Scan cancelled.</p>
            ) : (
              <ResultView result={job.result} />
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
