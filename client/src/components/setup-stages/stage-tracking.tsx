import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  Radar,
  Sliders,
  Network,
  Save,
  Loader2,
  CheckCircle2,
  Moon,
  Sun,
  Search,
} from "lucide-react";
import {
  DEFAULT_LEVEL_CADENCES,
  INTEREST_LEVELS,
  INTEREST_LEVEL_LABEL,
  TRACKING_KINDS,
  TRACKING_KIND_LABEL,
  parseLevelCadences,
  skipRecentEnabled,
  type InterestLevel,
  type TrackingKind,
  type Cadence,
} from "@shared/interest-level";

export function StageTracking() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: appSettings } = useQuery<Record<string, string | null>>({
    queryKey: ["/api/settings"],
  });

  // Tracking cadences state
  const [cadences, setCadences] = useState<Record<InterestLevel, Cadence>>(DEFAULT_LEVEL_CADENCES);
  const [skipRecent, setSkipRecent] = useState<boolean>(true);

  // App settings state
  const [defaultGraphView, setDefaultGraphView] = useState<string>("3d");
  const [searchPriority, setSearchPriority] = useState<string>("people");

  useEffect(() => {
    if (appSettings) {
      if (appSettings.tracking_level_defaults) {
        setCadences(parseLevelCadences(appSettings.tracking_level_defaults));
      }
      setSkipRecent(skipRecentEnabled(appSettings.tracking_skip_recent));
      if (appSettings.default_graph_view) {
        setDefaultGraphView(appSettings.default_graph_view);
      }
      if (appSettings.search_priority) {
        setSearchPriority(appSettings.search_priority);
      }
    }
  }, [appSettings]);

  const saveSettingsMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/settings", {
        key: "tracking_level_defaults",
        value: JSON.stringify(cadences),
      });
      await apiRequest("POST", "/api/settings", {
        key: "tracking_skip_recent",
        value: skipRecent ? "true" : "false",
      });
      await apiRequest("POST", "/api/settings", {
        key: "default_graph_view",
        value: defaultGraphView,
      });
      await apiRequest("POST", "/api/settings", {
        key: "search_priority",
        value: searchPriority,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/settings"] });
      toast({ title: "Tracking & key settings saved" });
    },
    onError: (err: any) => {
      toast({ title: "Failed to save settings", description: err.message, variant: "destructive" });
    },
  });

  const handleCadenceChange = (level: InterestLevel, kind: TrackingKind, valueStr: string) => {
    const val = parseInt(valueStr, 10);
    if (isNaN(val) || val < 1) return;
    setCadences((prev) => ({
      ...prev,
      [level]: {
        ...prev[level],
        [kind]: val,
      },
    }));
  };

  const applyCadencePreset = (preset: "balanced" | "aggressive" | "light") => {
    if (preset === "balanced") {
      setCadences(DEFAULT_LEVEL_CADENCES);
    } else if (preset === "aggressive") {
      setCadences({
        none: { info: null, follows: null, posts: null },
        low: { info: 14, follows: 14, posts: 30 },
        medium: { info: 3, follows: 14, posts: 14 },
        high: { info: 2, follows: 7, posts: 7 },
        very_high: { info: 1, follows: 3, posts: 3 },
        extreme: { info: 1, follows: 1, posts: 1 },
      });
    } else if (preset === "light") {
      setCadences({
        none: { info: null, follows: null, posts: null },
        low: { info: 60, follows: 60, posts: 90 },
        medium: { info: 30, follows: 60, posts: 60 },
        high: { info: 14, follows: 30, posts: 30 },
        very_high: { info: 7, follows: 14, posts: 14 },
        extreme: { info: 3, follows: 7, posts: 7 },
      });
    }
    toast({ title: `Applied ${preset} cadence preset` });
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 rounded-lg bg-muted/40 border">
        <div>
          <h3 className="font-semibold text-base">Tracking Preferences & Core Settings</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Configure how often social profiles are re-checked and fine-tune system-wide viewing options.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5">
        {/* Tracking Cadences */}
        <Card className="border-border">
          <CardHeader className="pb-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <Radar className="h-4 w-4 text-primary" /> Social Account Tracking Cadences
                </CardTitle>
                <CardDescription className="text-xs mt-0.5">
                  Days between automatic checks for linked accounts based on interest level.
                </CardDescription>
              </div>
              <div className="flex items-center gap-1.5 self-start sm:self-auto">
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-[11px]"
                  onClick={() => applyCadencePreset("balanced")}
                >
                  Balanced (Default)
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-[11px]"
                  onClick={() => applyCadencePreset("aggressive")}
                >
                  Aggressive
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-[11px]"
                  onClick={() => applyCadencePreset("light")}
                >
                  Light
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4 pt-0 text-xs">
            <div className="border rounded-md overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="h-8 text-xs">
                    <TableHead className="w-[120px]">Interest Level</TableHead>
                    {TRACKING_KINDS.map((k) => (
                      <TableHead key={k}>{TRACKING_KIND_LABEL[k]} (Days)</TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {INTEREST_LEVELS.filter((l) => l !== "none").map((level) => (
                    <TableRow key={level} className="h-9">
                      <TableCell className="font-medium text-xs py-1">
                        {INTEREST_LEVEL_LABEL[level]}
                      </TableCell>
                      {TRACKING_KINDS.map((kind) => (
                        <TableCell key={kind} className="py-1">
                          <Input
                            type="number"
                            min={1}
                            className="h-7 w-20 text-xs"
                            value={cadences[level]?.[kind] ?? ""}
                            onChange={(e) => handleCadenceChange(level, kind, e.target.value)}
                          />
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <div className="flex items-center justify-between p-3 rounded-lg border bg-muted/20">
              <div className="space-y-0.5">
                <Label htmlFor="skip-recent" className="text-xs font-medium cursor-pointer">
                  Skip Accounts Checked in Last 24 Hours
                </Label>
                <p className="text-[11px] text-muted-foreground">
                  Prevents redundant crawler runs when running bulk checks or routine syncs.
                </p>
              </div>
              <Switch
                id="skip-recent"
                checked={skipRecent}
                onCheckedChange={setSkipRecent}
              />
            </div>
          </CardContent>
        </Card>

        {/* Key Core Settings */}
        <Card className="border-border">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Sliders className="h-4 w-4 text-primary" /> Key Application Preferences
            </CardTitle>
            <CardDescription className="text-xs">
              Default preferences for visualization, search, and navigation.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 pt-0 text-xs">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="graph-view" className="text-xs">Default Social Graph Mode</Label>
                <Select value={defaultGraphView} onValueChange={setDefaultGraphView}>
                  <SelectTrigger id="graph-view" className="h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="3d" className="text-xs">3D Force Graph (WebGL / Interactive)</SelectItem>
                    <SelectItem value="2d" className="text-xs">2D Graph (Canvas / Lightweight)</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-[11px] text-muted-foreground">
                  Default rendering engine when opening `/graph` or person social clusters.
                </p>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="search-pref" className="text-xs">Global Search Priority</Label>
                <Select value={searchPriority} onValueChange={setSearchPriority}>
                  <SelectTrigger id="search-pref" className="h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="people" className="text-xs">Prioritize People Profiles</SelectItem>
                    <SelectItem value="notes" className="text-xs">Prioritize Daily Notes & Logs</SelectItem>
                    <SelectItem value="balanced" className="text-xs">Equal Weight Across All Entities</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-[11px] text-muted-foreground">
                  Controls ordering of quick results in the Ctrl+K search dialog.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="flex justify-end pt-2">
        <Button
          size="sm"
          onClick={() => saveSettingsMutation.mutate()}
          disabled={saveSettingsMutation.isPending}
          className="gap-1.5 h-8 text-xs"
        >
          {saveSettingsMutation.isPending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Save className="h-3.5 w-3.5" />
          )}
          Save Tracking Preferences
        </Button>
      </div>
    </div>
  );
}
