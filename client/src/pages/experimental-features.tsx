import { useEffect, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { CheckCircle2, ImageIcon, Loader2, Radar, Save, Sparkles, XCircle } from "lucide-react";

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
      </div>
    </div>
  );
}
