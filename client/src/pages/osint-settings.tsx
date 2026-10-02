import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { AlertCircle, Loader2, Radar, ScanSearch } from "lucide-react";
import { Link } from "wouter";
import { OsintDemoRunCard } from "@/components/osint-demo-run";
import type { OsintScan } from "@shared/schema";

type ScanQueue = { counts: Record<string, number>; rows: Omit<OsintScan, "result">[] };

function OsintAutoScanSection({
  settings,
  saveSetting,
}: {
  settings: Record<string, string | null>;
  saveSetting: (key: string, value: string) => void;
}) {
  const { toast } = useToast();
  const enabled = settings.osint_auto_scan_enabled === "true";

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
          follows is queued for a username scan. Queued scans are fed to PRM-Compute a few at a
          time as earlier ones finish, and land in the Insights tab of each account.
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

        <p className="text-sm text-muted-foreground">
          Scans use the scanners picked on the{" "}
          <Link href="~/social-accounts/tracking" className="underline">Tracking</Link> page.
        </p>

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
          <Button variant="outline" size="sm" asChild>
            <Link href="~/settings/tasks/osint" data-testid="link-osint-tasks">View tasks</Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export default function OsintSettingsPage() {
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

  const { data: osintStatus } = useQuery<{ configured: boolean; enabled: boolean; hasApiUrl: boolean }>({
    queryKey: ["/api/osint/status"],
  });
  const isComputeConfigured = Boolean(osintStatus?.configured);

  if (isLoading) {
    return (
      <div className="flex h-[50vh] w-full items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="container max-w-full py-3 md:py-8 px-4 md:pl-12 mx-auto md:mx-0 space-y-6">
      <div className="max-w-3xl">
        <h1 className="text-2xl font-semibold flex items-center gap-2" data-testid="text-osint-settings-title">
          <Radar className="h-6 w-6" />
          OSINT Settings
        </h1>
        <p className="text-muted-foreground mt-1">
          Configure automatic background intelligence scans powered by PRM-Compute.
        </p>
      </div>

      {!isComputeConfigured && (
        <div className="flex items-center justify-between rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-900 dark:text-amber-200 max-w-3xl" data-testid="banner-compute-not-configured">
          <div className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>PRM-Compute is not configured. OSINT scans require an active PRM-Compute server.</span>
          </div>
          <Button variant="outline" size="sm" asChild>
            <Link href="~/settings/recognition">Configure PRM-Compute</Link>
          </Button>
        </div>
      )}

      <div className="settings-cards-grid">
        <OsintAutoScanSection
          settings={settings ?? {}}
          saveSetting={(key, value) => updateSettingMutation.mutate({ key, value })}
        />
        <OsintDemoRunCard disabled={!isComputeConfigured} />
      </div>
    </div>
  );
}
