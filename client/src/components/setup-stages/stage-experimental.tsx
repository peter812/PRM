import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  Sparkles,
  Gamepad2,
  ImageIcon,
  Save,
  Loader2,
  Layers,
  Radar,
  MapPin,
  Bot,
} from "lucide-react";

export function StageExperimental() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: settings } = useQuery<Record<string, string | null>>({
    queryKey: ["/api/settings"],
  });

  const [demosEnabled, setDemosEnabled] = useState(false);
  const [imagesTabEnabled, setImagesTabEnabled] = useState(true);

  useEffect(() => {
    if (settings) {
      setDemosEnabled(settings.experimental_demos_enabled === "true");
      setImagesTabEnabled(settings.images_tab_enabled !== "false");
    }
  }, [settings]);

  const saveExperimentalMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/settings", {
        key: "experimental_demos_enabled",
        value: demosEnabled ? "true" : "false",
      });
      await apiRequest("POST", "/api/settings", {
        key: "images_tab_enabled",
        value: imagesTabEnabled ? "true" : "false",
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/settings"] });
      toast({ title: "Experimental features saved" });
    },
    onError: (err: any) => {
      toast({ title: "Failed to save settings", description: err.message, variant: "destructive" });
    },
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 rounded-lg bg-muted/40 border">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="font-semibold text-base">Experimental Features & Labs</h3>
            <Badge variant="secondary" className="text-[10px] bg-purple-500/10 text-purple-600">
              Beta / Lab
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            Preview upcoming capabilities, research games, and specialized intelligence tools.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4">
        {/* Demos Switch */}
        <Card className="border-border">
          <CardHeader className="pb-3">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-md bg-purple-500/10 text-purple-500 shrink-0">
                  <Gamepad2 className="h-5 w-5" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <CardTitle className="text-base font-semibold">Demos & Research Games Menu</CardTitle>
                  </div>
                  <CardDescription className="text-xs mt-0.5">
                    Unlocks experimental playground tools directly in the primary navigation sidebar.
                  </CardDescription>
                </div>
              </div>
              <Switch
                checked={demosEnabled}
                onCheckedChange={setDemosEnabled}
                id="demos-toggle"
              />
            </div>
          </CardHeader>
          <CardContent className="space-y-3 pt-0 text-xs text-muted-foreground">
            <p>Includes access to:</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
              <div className="flex items-center gap-2 p-2 rounded bg-muted/30 border">
                <Radar className="h-4 w-4 text-primary shrink-0" />
                <span>OSINT investigation tools</span>
              </div>
              <div className="flex items-center gap-2 p-2 rounded bg-muted/30 border">
                <MapPin className="h-4 w-4 text-emerald-500 shrink-0" />
                <span>Interactive 3D location map</span>
              </div>
              <div className="flex items-center gap-2 p-2 rounded bg-muted/30 border">
                <Bot className="h-4 w-4 text-amber-500 shrink-0" />
                <span>Describe Me & AI guessing games</span>
              </div>
              <div className="flex items-center gap-2 p-2 rounded bg-muted/30 border">
                <Layers className="h-4 w-4 text-purple-500 shrink-0" />
                <span>Bio word clouds & face review queues</span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Profile Images Tab */}
        <Card className="border-border">
          <CardHeader className="pb-3">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-md bg-sky-500/10 text-sky-500 shrink-0">
                  <ImageIcon className="h-5 w-5" />
                </div>
                <div>
                  <CardTitle className="text-base font-semibold">Profile Photos & Images Tab</CardTitle>
                  <CardDescription className="text-xs mt-0.5">
                    Displays a dedicated Photos gallery tab on person profiles and your "ME" profile.
                  </CardDescription>
                </div>
              </div>
              <Switch
                checked={imagesTabEnabled}
                onCheckedChange={setImagesTabEnabled}
                id="images-tab-toggle"
              />
            </div>
          </CardHeader>
          <CardContent className="space-y-2 pt-0 text-xs text-muted-foreground">
            <p>
              When enabled, profiles feature a visual gallery displaying all images, face crops, and social photos associated with that contact.
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="flex justify-end pt-2">
        <Button
          size="sm"
          onClick={() => saveExperimentalMutation.mutate()}
          disabled={saveExperimentalMutation.isPending}
          className="gap-1.5 h-8 text-xs"
        >
          {saveExperimentalMutation.isPending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Save className="h-3.5 w-3.5" />
          )}
          Save Experimental Preferences
        </Button>
      </div>
    </div>
  );
}
