import { useEffect, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Loader2, Wrench, Search, AtSign, User, Book, NotebookPen, MessageSquare, RefreshCw, AlertCircle, type LucideIcon } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

type ToolMetadata = {
  name: string;
  label: string;
  description: string;
  icon: string;
};

type ToolSettings = {
  enabled: boolean;
  perTool: Record<string, boolean>;
};

// Mirror of the server-side icon map (server/ai-tools.ts).
const TOOL_ICON_MAP: Record<string, LucideIcon> = {
  search: Search,
  user: User,
  "user-search": User,
  "at-sign": AtSign,
  "at-sign-search": AtSign,
  book: Book,
  notebook: NotebookPen,
  "message-square": MessageSquare,
};

export default function IntelligenceToolsSettingsPage() {
  const { toast } = useToast();
  const [enabled, setEnabled] = useState(true);
  const [perTool, setPerTool] = useState<Record<string, boolean>>({});

  const { data: toolsData, isLoading: isLoadingTools, isError: isToolsError, refetch: refetchTools } = useQuery<{ tools: ToolMetadata[] }>({
    queryKey: ["/api/ai-tools"],
  });
  const { data: settings, isLoading: isLoadingSettings, isError: isSettingsError, refetch: refetchSettings } = useQuery<ToolSettings>({
    queryKey: ["/api/ai-tools/settings"],
  });

  useEffect(() => {
    if (!settings) return;
    setEnabled(settings.enabled);
    setPerTool(settings.perTool ?? {});
  }, [settings]);

  const saveMutation = useMutation({
    mutationFn: async (patch: Partial<ToolSettings>) => {
      const res = await apiRequest("POST", "/api/ai-tools/settings", patch);
      return res.json() as Promise<ToolSettings>;
    },
    onSuccess: (data) => {
      queryClient.setQueryData(["/api/ai-tools/settings"], data);
    },
    onError: (error: Error) => {
      toast({ title: "Failed to save", description: error.message, variant: "destructive" });
    },
  });

  const tools = toolsData?.tools ?? [];

  const handleMasterToggle = (next: boolean) => {
    setEnabled(next);
    saveMutation.mutate({ enabled: next });
  };

  const handleToolToggle = (name: string, next: boolean) => {
    setPerTool((prev) => ({ ...prev, [name]: next }));
    saveMutation.mutate({ perTool: { [name]: next } });
  };

  if (isLoadingTools || isLoadingSettings) {
    return (
      <div className="flex items-center justify-center py-16" data-testid="loading-tool-settings">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (isToolsError || isSettingsError) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-16 text-center" data-testid="error-tool-settings">
        <AlertCircle className="h-8 w-8 text-destructive" />
        <p className="text-sm text-muted-foreground">Failed to load tool settings.</p>
        <Button
          variant="outline"
          size="sm"
          onClick={() => { void refetchTools(); void refetchSettings(); }}
          data-testid="button-retry-tool-settings"
        >
          <RefreshCw className="h-4 w-4 mr-2" /> Retry
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Wrench className="h-5 w-5" /> AI Tools
          </CardTitle>
          <CardDescription>
            Tools (also called "skills") let the AI chat read data from your PRM during a
            conversation — for example, looking up a person, pulling a social account, or finding a
            note. The model decides when to call a tool based on what you ask. Disabled tools are
            hidden from the model entirely; turning them all off forces the chat to rely only on
            its prompt and the message history.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between rounded-md border p-4">
            <div className="space-y-0.5">
              <Label htmlFor="tools-master" className="text-base">Enable AI tool calls</Label>
              <p className="text-sm text-muted-foreground">
                Master switch. When off, the chat will not be offered any tools regardless of the
                per-tool settings below.
              </p>
            </div>
            <Switch
              id="tools-master"
              checked={enabled}
              onCheckedChange={handleMasterToggle}
              data-testid="switch-tools-master"
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Available tools</CardTitle>
          <CardDescription>
            Toggle individual tools the AI chat may invoke.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {tools.map((tool) => {
            const Icon = TOOL_ICON_MAP[tool.icon] ?? Search;
            const checked = perTool[tool.name] !== false;
            return (
              <div
                key={tool.name}
                className="flex items-start justify-between gap-4 rounded-md border p-4"
                data-testid={`tool-row-${tool.name}`}
              >
                <div className="flex items-start gap-3">
                  <span className="mt-0.5 inline-flex h-8 w-8 items-center justify-center rounded-md border bg-background">
                    <Icon className="h-4 w-4" />
                  </span>
                  <div className="space-y-0.5">
                    <Label htmlFor={`tool-${tool.name}`} className="text-base">{tool.label}</Label>
                    <p className="text-sm text-muted-foreground">{tool.description}</p>
                  </div>
                </div>
                <Switch
                  id={`tool-${tool.name}`}
                  checked={checked}
                  onCheckedChange={(v) => handleToolToggle(tool.name, v)}
                  disabled={!enabled}
                  data-testid={`switch-tool-${tool.name}`}
                />
              </div>
            );
          })}
          {tools.length === 0 && (
            <p className="text-sm text-muted-foreground">No tools are registered.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
