import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Loader2, Save, ImagePlus, CheckCircle2, AlertCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";

type ImmichSettings = {
  enabled: boolean;
  url: string;
  hasApiKey: boolean;
};

export default function ImmichSettingsPage() {
  const { toast } = useToast();
  const { data, isLoading } = useQuery<ImmichSettings>({
    queryKey: ["/api/immich/settings"],
  });

  const [enabled, setEnabled] = useState(false);
  const [url, setUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [hasStoredKey, setHasStoredKey] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  useEffect(() => {
    if (!data) return;
    setEnabled(data.enabled);
    setUrl(data.url);
    setHasStoredKey(data.hasApiKey);
  }, [data]);

  const handleSaveAndTest = async () => {
    setIsSaving(true);
    setTestResult(null);
    try {
      // Save first (only send apiKey if user typed one).
      const savePayload: Record<string, unknown> = { enabled, url };
      if (apiKey.length > 0) savePayload.apiKey = apiKey;
      const saveRes = await fetch("/api/immich/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(savePayload),
        credentials: "include",
      });
      if (!saveRes.ok) {
        const err = await saveRes.json().catch(() => ({}));
        throw new Error(err.error || "Failed to save settings");
      }

      // Then test against the now-saved values.
      const testRes = await fetch("/api/immich/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
        credentials: "include",
      });
      const testData = (await testRes.json()) as { ok: boolean; message: string };
      setTestResult(testData);

      if (apiKey.length > 0) {
        setApiKey("");
        setHasStoredKey(true);
      }
      // Refresh queries that depend on these settings.
      queryClient.invalidateQueries({ queryKey: ["/api/immich/settings"] });
      queryClient.invalidateQueries({ queryKey: ["/api/immich/client-config"] });
      queryClient.invalidateQueries({ queryKey: ["/api/immich/assets"] });

      toast({
        title: testData.ok ? "Settings saved" : "Saved, but test failed",
        description: testData.message,
        variant: testData.ok ? "default" : "destructive",
      });
    } catch (err: any) {
      toast({ title: "Save failed", description: err.message, variant: "destructive" });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="container max-w-2xl mx-auto py-6 px-4 space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold flex items-center gap-2" data-testid="text-immich-settings-title">
          <ImagePlus className="h-6 w-6" />
          Immich Connection
        </h1>
        <p className="text-muted-foreground text-sm">
          Configure the connection to your Immich server. When enabled, the Immich Demo page is
          available from the main menu.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Connection</CardTitle>
          <CardDescription>
            Photo uploads go through PRM, but image downloads are made directly from your browser to
            Immich.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {isLoading ? (
            <Loader2 className="h-5 w-5 animate-spin" />
          ) : (
            <>
              <div className="flex items-center justify-between gap-4">
                <div>
                  <Label htmlFor="immich-enabled" className="text-sm font-medium">
                    Enable Immich demo system
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    Adds an "Immich Demo" entry to the main menu.
                  </p>
                </div>
                <Switch
                  id="immich-enabled"
                  checked={enabled}
                  onCheckedChange={setEnabled}
                  data-testid="switch-immich-enabled"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="immich-url">Immich URL</Label>
                <Input
                  id="immich-url"
                  type="url"
                  placeholder="https://immich.example.com"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  data-testid="input-immich-url"
                />
                <p className="text-xs text-muted-foreground">
                  Base URL of your Immich server (no trailing slash).
                </p>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="immich-api-key">Immich API key</Label>
                <Input
                  id="immich-api-key"
                  type="password"
                  placeholder={hasStoredKey ? "•••••••• (stored — leave blank to keep)" : "Paste your Immich API key"}
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  autoComplete="off"
                  data-testid="input-immich-api-key"
                />
                <p className="text-xs text-muted-foreground">
                  Create an API key in Immich under Account Settings → API Keys.
                </p>
              </div>

              <div className="flex items-center gap-3 pt-2">
                <Button
                  onClick={handleSaveAndTest}
                  disabled={isSaving}
                  data-testid="button-immich-save-and-test"
                >
                  {isSaving ? (
                    <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Saving & testing…</>
                  ) : (
                    <><Save className="h-4 w-4 mr-2" />Save and test</>
                  )}
                </Button>
                {testResult && (
                  <span
                    className={`text-sm flex items-center gap-1 ${testResult.ok ? "text-green-600" : "text-destructive"}`}
                    data-testid="text-immich-test-result"
                  >
                    {testResult.ok ? (
                      <CheckCircle2 className="h-4 w-4" />
                    ) : (
                      <AlertCircle className="h-4 w-4" />
                    )}
                    {testResult.message}
                  </span>
                )}
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
