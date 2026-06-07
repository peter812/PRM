import { useEffect, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Loader2,
  Wrench,
  Search,
  AtSign,
  User,
  UserPlus,
  UserCog,
  Book,
  BookPlus,
  NotebookPen,
  MessageSquare,
  MessageSquarePlus,
  Pencil,
  RefreshCw,
  AlertCircle,
  ChevronDown,
  ChevronRight,
  ShieldCheck,
  ShieldOff,
  ShieldAlert,
  type LucideIcon,
} from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

type ExecutionMode = "off" | "auth" | "open";

type ToolMetadata = {
  name: string;
  label: string;
  description: string;
  icon: string;
  category: string;
  write: boolean;
};

type ToolSettings = {
  enabled: boolean;
  perTool: Record<string, boolean>;
  executionMode: ExecutionMode;
};

// Mirror of the server-side icon map (server/ai-tools.ts).
const TOOL_ICON_MAP: Record<string, LucideIcon> = {
  search: Search,
  user: User,
  "user-search": User,
  "user-plus": UserPlus,
  "user-pen": UserCog,
  "at-sign": AtSign,
  "at-sign-search": AtSign,
  book: Book,
  "book-plus": BookPlus,
  notebook: NotebookPen,
  "notebook-pen": NotebookPen,
  "message-square": MessageSquare,
  "message-square-plus": MessageSquarePlus,
  pencil: Pencil,
};

// Display labels for each backend category. Keep in sync with `AiToolCategory`
// in server/ai-tools.ts.
const CATEGORY_LABELS: Record<string, string> = {
  people: "People",
  notes: "Notes",
  interactions: "Interactions",
  "daily-notes": "Daily notes",
  "social-accounts": "Social accounts",
};

// Stable category ordering for the UI.
const CATEGORY_ORDER = ["people", "interactions", "notes", "daily-notes", "social-accounts"];

export default function IntelligenceToolsSettingsPage() {
  const { toast } = useToast();
  const [enabled, setEnabled] = useState(true);
  const [executionMode, setExecutionMode] = useState<ExecutionMode>("off");
  const [perTool, setPerTool] = useState<Record<string, boolean>>({});
  const [openCategories, setOpenCategories] = useState<Record<string, boolean>>({});

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
    setExecutionMode(settings.executionMode ?? "off");
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

  const handleExecutionModeChange = (next: string) => {
    if (next !== "off" && next !== "auth" && next !== "open") return;
    setExecutionMode(next);
    saveMutation.mutate({ executionMode: next });
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

  // Group tools by category for the expandable cards below.
  const grouped: Record<string, ToolMetadata[]> = {};
  for (const t of tools) {
    const key = t.category || "other";
    (grouped[key] ??= []).push(t);
  }
  const categoryKeys = [
    ...CATEGORY_ORDER.filter((c) => grouped[c]?.length),
    ...Object.keys(grouped).filter((c) => !CATEGORY_ORDER.includes(c)),
  ];

  return (
    <div className="space-y-6 max-w-3xl">
      {/* Execution mode — top of the page per spec. */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5" /> AI tool execution
          </CardTitle>
          <CardDescription>
            Controls whether the AI may modify your PRM data. Read-only tools (searches, lookups)
            are always available when AI tools are enabled below — these options govern write tools
            (create / update) only.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <RadioGroup
            value={executionMode}
            onValueChange={handleExecutionModeChange}
            className="grid gap-3"
            data-testid="radio-execution-mode"
          >
            <label
              htmlFor="exec-off"
              className="flex cursor-pointer items-start gap-3 rounded-md border p-4 hover-elevate"
            >
              <RadioGroupItem value="off" id="exec-off" data-testid="radio-execution-off" />
              <div className="space-y-0.5">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <ShieldOff className="h-4 w-4" /> No AI writes
                </div>
                <p className="text-sm text-muted-foreground">
                  AI models have no access to tools that write or edit aspects of PRM. The model
                  may only read.
                </p>
              </div>
            </label>
            <label
              htmlFor="exec-auth"
              className="flex cursor-pointer items-start gap-3 rounded-md border p-4 hover-elevate"
            >
              <RadioGroupItem value="auth" id="exec-auth" data-testid="radio-execution-auth" />
              <div className="space-y-0.5">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <ShieldAlert className="h-4 w-4" /> User auth requests
                </div>
                <p className="text-sm text-muted-foreground">
                  The AI must request every change. A popup appears in the lower-left corner (top
                  center on mobile) and you can accept, examine, or reject the request.
                </p>
              </div>
            </label>
            <label
              htmlFor="exec-open"
              className="flex cursor-pointer items-start gap-3 rounded-md border p-4 hover-elevate"
            >
              <RadioGroupItem value="open" id="exec-open" data-testid="radio-execution-open" />
              <div className="space-y-0.5">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <ShieldCheck className="h-4 w-4" /> Unrestricted
                </div>
                <p className="text-sm text-muted-foreground">
                  All create and edit tools are accessible to the LLM with no auth required.
                </p>
              </div>
            </label>
          </RadioGroup>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Wrench className="h-5 w-5" /> AI Tools
          </CardTitle>
          <CardDescription>
            Tools (also called "skills") let the AI chat read and (when allowed above) modify data
            in your PRM during a conversation. The model decides when to call a tool based on what
            you ask. Disabled tools are hidden from the model entirely; turning the master switch
            off forces the chat to rely only on its prompt and the message history.
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

      {/* One expandable card per category. Per-tool details are hidden by default. */}
      <div className="space-y-3">
        {categoryKeys.map((cat) => {
          const list = grouped[cat] ?? [];
          if (list.length === 0) return null;
          const isOpen = openCategories[cat] ?? false;
          const writeCount = list.filter((t) => t.write).length;
          return (
            <Card key={cat} data-testid={`tool-category-${cat}`}>
              <Collapsible
                open={isOpen}
                onOpenChange={(v) => setOpenCategories((prev) => ({ ...prev, [cat]: v }))}
              >
                <CollapsibleTrigger asChild>
                  <button
                    type="button"
                    className="flex w-full items-center justify-between p-4 text-left hover-elevate"
                    data-testid={`tool-category-toggle-${cat}`}
                  >
                    <div className="flex items-center gap-2">
                      {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                      <span className="text-base font-medium">
                        {CATEGORY_LABELS[cat] ?? cat}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {list.length} tool{list.length === 1 ? "" : "s"}
                        {writeCount > 0 && ` · ${writeCount} write`}
                      </span>
                    </div>
                  </button>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="space-y-3 px-4 pb-4">
                    {list.map((tool) => {
                      const Icon = TOOL_ICON_MAP[tool.icon] ?? Search;
                      const checked = perTool[tool.name] !== false;
                      const writeDisabled = tool.write && executionMode === "off";
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
                              <div className="flex items-center gap-2">
                                <Label htmlFor={`tool-${tool.name}`} className="text-base">{tool.label}</Label>
                                {tool.write && (
                                  <span
                                    className="rounded-md border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-600 border-amber-300 dark:text-amber-400 dark:border-amber-700"
                                    data-testid={`tool-write-badge-${tool.name}`}
                                  >
                                    Write
                                  </span>
                                )}
                              </div>
                              <p className="text-sm text-muted-foreground">{tool.description}</p>
                              {writeDisabled && (
                                <p className="text-xs text-muted-foreground italic">
                                  Disabled by execution mode (No AI writes).
                                </p>
                              )}
                            </div>
                          </div>
                          <Switch
                            id={`tool-${tool.name}`}
                            checked={checked}
                            onCheckedChange={(v) => handleToolToggle(tool.name, v)}
                            disabled={!enabled || writeDisabled}
                            data-testid={`switch-tool-${tool.name}`}
                          />
                        </div>
                      );
                    })}
                  </div>
                </CollapsibleContent>
              </Collapsible>
            </Card>
          );
        })}
        {tools.length === 0 && (
          <p className="text-sm text-muted-foreground">No tools are registered.</p>
        )}
      </div>
    </div>
  );
}
