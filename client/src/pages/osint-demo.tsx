import { useMemo, useState } from "react";
import { Link, useParams } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { getOsintTool, type OsintTargetType } from "@/lib/osint-tools";
import { AlertCircle, Loader2, Radar, Search, X } from "lucide-react";

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
                    {url && (
                      <a
                        href={url}
                        target="_blank"
                        rel="noreferrer"
                        className="block truncate text-xs text-muted-foreground underline underline-offset-2"
                      >
                        {url}
                      </a>
                    )}
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

export default function OsintDemoPage() {
  const { tool: toolName } = useParams<{ tool: string }>();
  const { toast } = useToast();
  const tool = getOsintTool(toolName);

  const { data: status, isLoading: statusLoading } = useQuery<{ configured: boolean }>({
    queryKey: ["/api/osint/status"],
  });

  const [targetType, setTargetType] = useState<OsintTargetType>(
    tool?.supportedTargetTypes[0] ?? "username",
  );
  const [target, setTarget] = useState("");
  const [jobId, setJobId] = useState<string | null>(null);

  const submitMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/osint/scans", {
        tool: tool!.name,
        target: target.trim(),
        target_type: targetType,
      });
      return res.json() as Promise<JobSummary>;
    },
    onSuccess: (job) => setJobId(job.id),
    onError: (err: Error) =>
      toast({ title: "Scan failed to start", description: err.message, variant: "destructive" }),
  });

  const { data: job } = useQuery<JobDetail>({
    queryKey: ["/api/osint/scans", jobId],
    enabled: !!jobId,
    refetchInterval: (query) => {
      const s = query.state.data?.status;
      return s && !TERMINAL.includes(s) ? 2000 : false;
    },
  });

  const cancelMutation = useMutation({
    mutationFn: async () => {
      if (jobId) await apiRequest("DELETE", `/api/osint/scans/${jobId}`);
    },
  });

  const isRunning = job ? !TERMINAL.includes(job.status) : submitMutation.isPending;
  const inputLabel = targetType === "email" ? "Email" : "Username";
  const placeholder = targetType === "email" ? "someone@example.com" : "someusername";

  const description = useMemo(() => tool?.description ?? "", [tool]);

  if (!tool) {
    return (
      <div className="container max-w-2xl py-8 px-4">
        <div className="flex items-start gap-3 rounded-md bg-muted p-4 text-sm">
          <AlertCircle className="h-4 w-4 shrink-0 mt-0.5 text-muted-foreground" />
          <span className="text-muted-foreground">
            Unknown OSINT tool "{toolName}". Return to the{" "}
            <Link href="/demos" className="underline underline-offset-2">Demos</Link> page.
          </span>
        </div>
      </div>
    );
  }

  const notConfigured = !statusLoading && !status?.configured;

  return (
    <div className="h-full overflow-auto">
      <div className="container max-w-full md:max-w-3xl py-3 md:py-8 px-4 md:pl-12 mx-auto md:mx-0">
        <div className="space-y-2 mb-6">
          <h1
            className="text-2xl font-semibold flex items-center gap-2"
            data-testid="text-osint-demo-title"
          >
            <Radar className="h-6 w-6" />
            {tool.label}
          </h1>
          <p className="text-muted-foreground">{description}</p>
        </div>

        {notConfigured ? (
          <div
            className="flex items-start gap-3 rounded-md bg-muted p-4 text-sm"
            data-testid="text-osint-not-configured"
          >
            <AlertCircle className="h-4 w-4 shrink-0 mt-0.5 text-muted-foreground" />
            <span className="text-muted-foreground">
              PRM-osint is not enabled or configured. Go to{" "}
              <Link href="/settings/experimental" className="underline underline-offset-2">
                Settings → Experimental Features
              </Link>{" "}
              to set it up.
            </span>
          </div>
        ) : (
          <>
            <Card className="mb-6">
              <CardHeader>
                <CardTitle className="text-base">Run a lookup</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {tool.supportedTargetTypes.length > 1 && (
                  <div className="space-y-2">
                    <Label>Target type</Label>
                    <Select
                      value={targetType}
                      onValueChange={(v) => setTargetType(v as OsintTargetType)}
                    >
                      <SelectTrigger className="w-48" data-testid="select-osint-target-type">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {tool.supportedTargetTypes.map((t) => (
                          <SelectItem key={t} value={t}>
                            {t === "email" ? "Email" : "Username"}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}

                <div className="space-y-2">
                  <Label htmlFor="osint-target">{inputLabel}</Label>
                  <div className="flex gap-2">
                    <Input
                      id="osint-target"
                      value={target}
                      placeholder={placeholder}
                      onChange={(e) => setTarget(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && target.trim() && !isRunning) {
                          setJobId(null);
                          submitMutation.mutate();
                        }
                      }}
                      data-testid="input-osint-target"
                    />
                    <Button
                      onClick={() => {
                        setJobId(null);
                        submitMutation.mutate();
                      }}
                      disabled={!target.trim() || isRunning}
                      data-testid="button-osint-run"
                    >
                      {isRunning ? (
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      ) : (
                        <Search className="h-4 w-4 mr-2" />
                      )}
                      Run
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Response area */}
            {jobId && (
              <Card data-testid="card-osint-response">
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base">Response</CardTitle>
                    <div className="flex items-center gap-2">
                      {job && (
                        <Badge variant={statusVariant(job.status)} data-testid="badge-osint-status">
                          {job.status}
                        </Badge>
                      )}
                      {job && !TERMINAL.includes(job.status) && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => cancelMutation.mutate()}
                          disabled={cancelMutation.isPending}
                          data-testid="button-osint-cancel"
                        >
                          <X className="h-4 w-4 mr-1" />
                          Cancel
                        </Button>
                      )}
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
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
                </CardContent>
              </Card>
            )}
          </>
        )}
      </div>
    </div>
  );
}
