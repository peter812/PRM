import { useEffect, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, ImageIcon, Loader2, Radar, Save, ScanSearch, Sparkles, XCircle } from "lucide-react";
import { OSINT_TOOLS } from "@/lib/osint-tools";
import type { OsintScanQueueRow } from "@shared/schema";

type OsintSettings = { enabled: boolean; apiUrl: string; hasApiKey: boolean };

function OsintConnectivitySection() {
  const { toast } = useToast();
  const { data: osint, isLoading } = useQuery<OsintSettings>({
    queryKey: ["/api/osint/settings"],
  });

  const [enabled, setEnabled] = useState(false);
  const [apiUrl, setApiUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  // Seed the form from the server once settings load.
  useEffect(() => {
    if (osint) {
      setEnabled(osint.enabled);
      setApiUrl(osint.apiUrl);
    }
  }, [osint]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/osint/settings", {
        enabled,
        apiUrl,
        // Only send the key when the user typed one; blank leaves the stored key intact.
        ...(apiKey.trim() ? { apiKey } : {}),
      });
      return res.json();
    },
    onSuccess: () => {
      setApiKey("");
      queryClient.invalidateQueries({ queryKey: ["/api/osint/settings"] });
      queryClient.invalidateQueries({ queryKey: ["/api/osint/status"] });
      toast({ title: "PRM-osint settings saved" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to save settings", description: error.message, variant: "destructive" });
    },
  });

  const testMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/osint/test", {
        apiUrl,
        ...(apiKey.trim() ? { apiKey } : {}),
      });
      return res.json() as Promise<{ ok: boolean; tools?: { name: string }[]; error?: string }>;
    },
    onSuccess: (data) => {
      const count = data.tools?.length ?? 0;
      setTestResult({ ok: true, message: `Connected — ${count} tool${count === 1 ? "" : "s"} available.` });
    },
    onError: (error: Error) => {
      setTestResult({ ok: false, message: error.message });
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Radar className="h-5 w-5 text-muted-foreground" />
          PRM-osint Connectivity
        </CardTitle>
        <CardDescription>
          Connect to a PRM-osint orchestration server to run OSINT lookups. When enabled and
          configured, per-tool demo pages appear in the Demos section.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between">
              <Label htmlFor="osint-enabled" className="flex-1 cursor-pointer pr-4">
                Enable PRM-osint Connectivity
              </Label>
              <Switch
                id="osint-enabled"
                checked={enabled}
                onCheckedChange={setEnabled}
                data-testid="switch-osint-enabled"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="osint-url">Address</Label>
              <Input
                id="osint-url"
                type="url"
                placeholder="http://localhost:8000"
                value={apiUrl}
                onChange={(e) => setApiUrl(e.target.value)}
                data-testid="input-osint-url"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="osint-key">API Key</Label>
              <Input
                id="osint-key"
                type="password"
                placeholder={osint?.hasApiKey ? "•••••••• (leave blank to keep current)" : "Enter API key"}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                data-testid="input-osint-key"
              />
            </div>

            {testResult && (
              <div
                className={`flex items-center gap-2 text-sm ${testResult.ok ? "text-green-600 dark:text-green-400" : "text-destructive"}`}
                data-testid="text-osint-test-result"
              >
                {testResult.ok ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
                <span>{testResult.message}</span>
              </div>
            )}

            <div className="flex gap-2">
              <Button
                onClick={() => saveMutation.mutate()}
                disabled={saveMutation.isPending}
                data-testid="button-osint-save"
              >
                {saveMutation.isPending ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Save className="h-4 w-4 mr-2" />
                )}
                Save
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  setTestResult(null);
                  testMutation.mutate();
                }}
                disabled={testMutation.isPending || !apiUrl.trim()}
                data-testid="button-osint-test"
              >
                {testMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                Test
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

type ScanQueue = { counts: Record<string, number>; rows: (OsintScanQueueRow & { username: string })[] };

const USERNAME_TOOLS = OSINT_TOOLS.filter((t) => t.supportedTargetTypes.includes("username"));

// Auto-scan settings live in app_settings alongside the other feature flags on
// this page, so they go through the same /api/settings key/value endpoint.
function OsintAutoScanSection({
  settings,
  saveSetting,
}: {
  settings: Record<string, string | null>;
  saveSetting: (key: string, value: string) => void;
}) {
  const { toast } = useToast();
  const enabled = settings.osint_auto_scan_enabled === "true";
  const tools = (settings.osint_auto_scan_tools ?? "sherlock").split(",").filter(Boolean);
  const [intervalSeconds, setIntervalSeconds] = useState(settings.osint_auto_scan_interval_seconds ?? "180");

  const { data: queue } = useQuery<ScanQueue>({
    queryKey: ["/api/osint/scan-queue"],
    refetchInterval: enabled ? 30000 : false,
  });

  const queueMutation = useMutation({
    mutationFn: async ({ method, path }: { method: string; path: string }) => {
      const res = await apiRequest(method, path);
      return res.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/osint/scan-queue"] }),
    onError: (error: Error) => toast({ title: "Queue action failed", description: error.message, variant: "destructive" }),
  });

  const toggleTool = (name: string, on: boolean) => {
    const next = on ? [...tools, name] : tools.filter((t) => t !== name);
    saveSetting("osint_auto_scan_tools", next.join(","));
  };

  const counts = queue?.counts ?? {};

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <ScanSearch className="h-5 w-5 text-muted-foreground" />
          Automatic OSINT Scans
        </CardTitle>
        <CardDescription>
          When a social account linked to your Me profile is added or updated, every account it
          follows is queued for a username scan. Scans run one at a time on the interval below
          and land in the Insights tab of each account.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between">
          <Label htmlFor="osint-auto-scan" className="flex-1 cursor-pointer pr-4">
            Enable automatic scans
          </Label>
          <Switch
            id="osint-auto-scan"
            checked={enabled}
            onCheckedChange={(checked) => saveSetting("osint_auto_scan_enabled", checked ? "true" : "false")}
            data-testid="switch-osint-auto-scan"
          />
        </div>

        <div className="space-y-2">
          <Label>Tools</Label>
          <div className="flex flex-wrap gap-4">
            {USERNAME_TOOLS.map((t) => (
              <label key={t.name} className="flex items-center gap-2 text-sm cursor-pointer">
                <Checkbox checked={tools.includes(t.name)} onCheckedChange={(v) => toggleTool(t.name, v === true)} />
                {t.label}
              </label>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="osint-interval">Seconds between scans</Label>
          <Input
            id="osint-interval"
            type="number"
            min={60}
            className="w-32"
            value={intervalSeconds}
            onChange={(e) => setIntervalSeconds(e.target.value)}
            onBlur={() => saveSetting("osint_auto_scan_interval_seconds", intervalSeconds)}
            data-testid="input-osint-interval"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2 text-sm">
          {["pending", "running", "done", "failed"].map((status) => (
            <Badge key={status} variant={status === "failed" ? "destructive" : "secondary"}>
              {status}: {counts[status] ?? 0}
            </Badge>
          ))}
          <Button
            variant="outline"
            size="sm"
            className="ml-auto"
            disabled={!enabled || queueMutation.isPending}
            onClick={() => queueMutation.mutate({ method: "POST", path: "/api/osint/scan-queue/backfill" })}
            data-testid="button-osint-backfill"
          >
            Queue my network now
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={!counts.failed || queueMutation.isPending}
            onClick={() => queueMutation.mutate({ method: "DELETE", path: "/api/osint/scan-queue?status=failed" })}
          >
            Clear failed
          </Button>
        </div>

        {queue && queue.rows.length > 0 && (
          <div className="max-h-64 overflow-y-auto rounded-md border divide-y text-sm">
            {queue.rows.map((row) => (
              <div key={row.id} className="flex items-center gap-3 px-3 py-1.5" data-testid={`scan-queue-row-${row.id}`}>
                <span className="font-medium truncate">@{row.username}</span>
                <span className="text-muted-foreground">{row.tool}</span>
                <Badge variant={row.status === "failed" ? "destructive" : "outline"} className="ml-auto shrink-0">
                  {row.status}
                </Badge>
                {row.error && <span className="truncate text-xs text-destructive max-w-[40%]">{row.error}</span>}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function ExperimentalFeaturesPage() {
  const { toast } = useToast();

  const { data: settings, isLoading } = useQuery<Record<string, string | null>>({
    queryKey: ["/api/settings"],
  });

  const updateSettingMutation = useMutation({
    mutationFn: async ({ key, value }: { key: string; value: string }) => {
      const res = await apiRequest("POST", "/api/settings", { key, value });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/settings"] });
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to update setting",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  if (isLoading) {
    return (
      <div className="flex h-[50vh] w-full items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const demosEnabled = settings?.experimental_demos_enabled === "true";
  const imagesTabEnabled = settings?.images_tab_enabled !== "false"; // Defaults to true

  return (
    <div className="container max-w-full md:max-w-2xl py-3 md:py-8 px-4 md:pl-12 mx-auto md:mx-0">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold" data-testid="text-experimental-features-title">
          Experimental Features
        </h1>
        <p className="text-muted-foreground mt-1">
          Enable or disable preview capabilities and experimental layouts.
        </p>
      </div>

      <div className="space-y-4">
        {/* Switch for Demos section */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Sparkles className="h-5 w-5 text-muted-foreground" />
              Demos Sidebar Menu
            </CardTitle>
            <CardDescription>
              Show a link to the Demos page in the sidebar menu to explore upcoming features.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex items-center justify-between">
            <Label htmlFor="demos-switch" className="flex-1 cursor-pointer pr-4">
              Enable Demos Sidebar Link
            </Label>
            <Switch
              id="demos-switch"
              checked={demosEnabled}
              onCheckedChange={(checked) => {
                updateSettingMutation.mutate({
                  key: "experimental_demos_enabled",
                  value: checked ? "true" : "false",
                });
                toast({
                  title: checked ? "Demos sidebar link enabled" : "Demos sidebar link disabled",
                  description: "Changes will reflect in the sidebar menu.",
                });
              }}
              data-testid="switch-experimental-demos"
            />
          </CardContent>
        </Card>

        {/* Switch for Images tab */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <ImageIcon className="h-5 w-5 text-muted-foreground" />
              Profile Images Tab
            </CardTitle>
            <CardDescription>
              Toggle the visibility of the Images/Photos tab on person profile and the "Me" user page.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex items-center justify-between">
            <Label htmlFor="images-switch" className="flex-1 cursor-pointer pr-4">
              Enable Photos/Images Tab
            </Label>
            <Switch
              id="images-switch"
              checked={imagesTabEnabled}
              onCheckedChange={(checked) => {
                updateSettingMutation.mutate({
                  key: "images_tab_enabled",
                  value: checked ? "true" : "false",
                });
                toast({
                  title: checked ? "Photos tab enabled" : "Photos tab disabled",
                  description: "Changes will reflect on profile pages.",
                });
              }}
              data-testid="switch-experimental-images"
            />
          </CardContent>
        </Card>

        {/* PRM-osint connectivity */}
        <OsintConnectivitySection />
        <OsintAutoScanSection
          settings={settings ?? {}}
          saveSetting={(key, value) => updateSettingMutation.mutate({ key, value })}
        />
      </div>
    </div>
  );
}
