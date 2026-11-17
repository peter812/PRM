import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { AlertTriangle, Copy, Key, Loader2, Plus, ShieldAlert, Trash2 } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

type ApiKey = {
  id: string;
  name: string;
  keyType: string;
  createdAt: string;
  lastUsedAt: string | null;
};

type McpTool = {
  name: string;
  label: string;
  description: string;
  category: string;
  write: boolean;
};

type McpSettings = {
  enabled: boolean;
  allowWrites: boolean;
  perTool: Record<string, boolean>;
  tools: McpTool[];
};

type McpSettingsPatch = Partial<Pick<McpSettings, "enabled" | "allowWrites" | "perTool">>;

const KEY_PLACEHOLDER = "<YOUR_MCP_KEY>";

/** "daily-notes" → "Daily notes" (matches the Intelligence → Tools labels). */
function categoryLabel(category: string): string {
  const s = category.replace(/-/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function CodeBlock({ code, onCopy }: { code: string; onCopy: (text: string) => void }) {
  return (
    <div className="relative">
      <pre className="font-mono text-xs bg-muted p-3 pr-12 rounded overflow-x-auto whitespace-pre">{code}</pre>
      {/* Wrapper holds the position: Button's hover-elevate forces position: relative. */}
      <div className="absolute top-1 right-1">
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => onCopy(code)} aria-label="Copy">
          <Copy className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

export default function McpSettingsPage() {
  const { toast } = useToast();
  const [tab, setTab] = useState("auth");
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [keyName, setKeyName] = useState("");
  const [newKey, setNewKey] = useState<{ name: string; key: string } | null>(null);
  // Raw key from this visit only, so the guides can be copied ready-to-use. Never persisted.
  const [sessionKey, setSessionKey] = useState<string | null>(null);
  const [keyToRevoke, setKeyToRevoke] = useState<ApiKey | null>(null);

  const endpoint = `${window.location.origin}/api/mcp`;

  const { data: allKeys = [], isLoading: isLoadingKeys } = useQuery<ApiKey[]>({
    queryKey: ["/api/api-keys"],
  });
  const mcpKeys = allKeys.filter((k) => k.keyType === "mcp");

  const { data: settings, isLoading: isLoadingSettings } = useQuery<McpSettings>({
    queryKey: ["/api/mcp/settings"],
  });

  const copy = (text: string) => {
    navigator.clipboard.writeText(text);
    toast({ title: "Copied to clipboard" });
  };

  const saveMutation = useMutation({
    mutationFn: async (patch: McpSettingsPatch) => {
      const res = await apiRequest("POST", "/api/mcp/settings", patch);
      return res.json() as Promise<McpSettings>;
    },
    onMutate: (patch) => {
      // Optimistic so switches flip immediately.
      const prev = queryClient.getQueryData<McpSettings>(["/api/mcp/settings"]);
      if (prev) {
        queryClient.setQueryData<McpSettings>(["/api/mcp/settings"], {
          ...prev,
          ...patch,
          perTool: { ...prev.perTool, ...patch.perTool },
        });
      }
      return { prev };
    },
    onSuccess: (data) => queryClient.setQueryData(["/api/mcp/settings"], data),
    onError: (error: Error, _patch, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(["/api/mcp/settings"], ctx.prev);
      toast({ variant: "destructive", title: "Failed to save", description: error.message });
    },
  });

  const createKeyMutation = useMutation({
    mutationFn: async (name: string) => {
      const res = await apiRequest("POST", "/api/api-keys", { name, keyType: "mcp" });
      return res.json() as Promise<{ name: string; key: string }>;
    },
    onSuccess: (data) => {
      setNewKey({ name: data.name, key: data.key });
      setSessionKey(data.key);
      setIsCreateOpen(false);
      setKeyName("");
      queryClient.invalidateQueries({ queryKey: ["/api/api-keys"] });
    },
    onError: (error: Error) => {
      toast({ variant: "destructive", title: "Failed to create key", description: error.message });
    },
  });

  const revokeKeyMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/api-keys/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/api-keys"] });
      toast({ title: "Key revoked", description: "Clients using it lose access immediately." });
      setKeyToRevoke(null);
    },
    onError: (error: Error) => {
      toast({ variant: "destructive", title: "Failed to revoke key", description: error.message });
    },
  });

  const handleCreate = () => {
    if (!keyName.trim()) return;
    createKeyMutation.mutate(keyName.trim());
  };

  // Tools grouped by category, keeping server order.
  const toolGroups = new Map<string, McpTool[]>();
  for (const t of settings?.tools ?? []) {
    toolGroups.set(t.category, [...(toolGroups.get(t.category) ?? []), t]);
  }
  const exposedCount = (settings?.tools ?? []).filter(
    (t) => settings?.perTool[t.name] && (!t.write || settings.allowWrites),
  ).length;

  const key = sessionKey ?? KEY_PLACEHOLDER;
  const guides = [
    {
      id: "claude-code",
      label: "Claude Code",
      steps: "Run this once in a terminal. Add --scope user to make it available in every project.",
      code: `claude mcp add --transport http prm ${endpoint} --header "Authorization: Bearer ${key}"`,
    },
    {
      id: "claude-desktop",
      label: "Claude Desktop",
      steps:
        "Settings → Developer → Edit Config, merge this into claude_desktop_config.json, then restart Claude Desktop. Requires Node.js (npx) on your PATH.",
      code: JSON.stringify(
        {
          mcpServers: {
            prm: {
              command: "npx",
              args: ["-y", "mcp-remote", endpoint, "--header", "Authorization:${PRM_MCP_AUTH}"],
              env: { PRM_MCP_AUTH: `Bearer ${key}` },
            },
          },
        },
        null,
        2,
      ),
    },
    {
      id: "cursor",
      label: "Cursor",
      steps: "Add to ~/.cursor/mcp.json (all projects) or .cursor/mcp.json (one project).",
      code: JSON.stringify(
        { mcpServers: { prm: { url: endpoint, headers: { Authorization: `Bearer ${key}` } } } },
        null,
        2,
      ),
    },
    {
      id: "vscode",
      label: "VS Code",
      steps: "Add to .vscode/mcp.json in your workspace, then start the server from the MCP view.",
      code: JSON.stringify(
        { servers: { prm: { type: "http", url: endpoint, headers: { Authorization: `Bearer ${key}` } } } },
        null,
        2,
      ),
    },
    {
      id: "curl",
      label: "curl",
      steps: "Smoke test from bash. A working server answers with serverInfo.name = \"prm\".",
      code: `curl -X POST ${endpoint} \\
  -H "Authorization: Bearer ${key}" \\
  -H "Content-Type: application/json" \\
  -H "Accept: application/json, text/event-stream" \\
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"curl","version":"1"}}}'`,
    },
  ];

  return (
    <div className="container max-w-full md:max-w-3xl py-3 md:py-8 px-4 md:pl-12 mx-auto md:mx-0">
      <div className="flex items-center justify-between gap-4 flex-wrap mb-6">
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold" data-testid="heading-mcp-settings">MCP Server</h1>
          <p className="text-muted-foreground">
            Let AI assistants like Claude Code, Claude Desktop and Cursor use your PRM data through the Model Context Protocol.
          </p>
        </div>
        {settings && (
          <Badge variant={settings.enabled ? "default" : "secondary"} data-testid="badge-mcp-status">
            {settings.enabled ? "Enabled" : "Disabled"}
          </Badge>
        )}
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="mb-6">
          <TabsTrigger value="auth" data-testid="tab-mcp-auth">Auth</TabsTrigger>
          <TabsTrigger value="options" data-testid="tab-mcp-options">Options</TabsTrigger>
          <TabsTrigger value="guides" data-testid="tab-mcp-guides">Guides</TabsTrigger>
        </TabsList>

        {/* ── Auth ─────────────────────────────────────────────────────── */}
        <TabsContent value="auth" className="space-y-6">
          <Card>
            <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
              <div className="space-y-1.5">
                <CardTitle className="text-lg">Access keys</CardTitle>
                <CardDescription>
                  Each MCP client authenticates with its own key. Create one per device or app so you can revoke them separately.
                </CardDescription>
              </div>
              <Button onClick={() => setIsCreateOpen(true)} data-testid="button-create-mcp-key">
                <Plus className="h-4 w-4 mr-2" />
                Create key
              </Button>
            </CardHeader>
            <CardContent>
              {isLoadingKeys ? (
                <div className="py-6 flex justify-center">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : mcpKeys.length === 0 ? (
                <div className="py-6 text-center text-muted-foreground" data-testid="text-no-mcp-keys">
                  <Key className="h-10 w-10 mx-auto mb-3" />
                  No MCP keys yet. Create one to connect a client.
                </div>
              ) : (
                <div className="divide-y">
                  {mcpKeys.map((k) => (
                    <div key={k.id} className="flex items-center justify-between gap-4 py-3" data-testid={`row-mcp-key-${k.id}`}>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <Key className="h-4 w-4 text-muted-foreground shrink-0" />
                          <span className="font-medium truncate">{k.name}</span>
                        </div>
                        <p className="text-sm text-muted-foreground">
                          Created {formatDistanceToNow(new Date(k.createdAt), { addSuffix: true })}
                          {" · "}
                          {k.lastUsedAt
                            ? `last used ${formatDistanceToNow(new Date(k.lastUsedAt), { addSuffix: true })}`
                            : "never used"}
                        </p>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setKeyToRevoke(k)}
                        aria-label={`Revoke ${k.name}`}
                        data-testid={`button-revoke-mcp-key-${k.id}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">How authentication works</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm text-muted-foreground">
              <p>
                Clients send the key as <code className="font-mono text-foreground">Authorization: Bearer &lt;key&gt;</code> on every request.
              </p>
              <p>Keys are stored hashed and shown only once, when created. If you lose one, revoke it and create a new one.</p>
              <p>MCP keys only work on the MCP endpoint. They can't sign in to the web app or call the REST API.</p>
              <p>Revoking a key cuts off every client that uses it on its next request.</p>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Options ──────────────────────────────────────────────────── */}
        <TabsContent value="options" className="space-y-6">
          {isLoadingSettings || !settings ? (
            <div className="py-12 flex justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <>
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Server</CardTitle>
                  <CardDescription>When off, the endpoint rejects every request, whatever key it carries.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center justify-between gap-4">
                    <Label htmlFor="mcp-enabled">Enable MCP server</Label>
                    <Switch
                      id="mcp-enabled"
                      checked={settings.enabled}
                      onCheckedChange={(enabled) => saveMutation.mutate({ enabled })}
                      data-testid="switch-mcp-enabled"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Endpoint URL</Label>
                    <div className="flex gap-2">
                      <Input value={endpoint} readOnly className="font-mono text-sm" data-testid="input-mcp-endpoint" />
                      <Button variant="outline" size="icon" onClick={() => copy(endpoint)} aria-label="Copy endpoint">
                        <Copy className="h-4 w-4" />
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Streamable HTTP transport. Clients on other machines need this server reachable over HTTPS.
                    </p>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Write access</CardTitle>
                  <CardDescription>
                    Allow clients to create and update people, notes, interactions, daily notes and relationships. When off, write tools are hidden from clients entirely.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center justify-between gap-4">
                    <Label htmlFor="mcp-writes">Allow write tools</Label>
                    <Switch
                      id="mcp-writes"
                      checked={settings.allowWrites}
                      onCheckedChange={(allowWrites) => saveMutation.mutate({ allowWrites })}
                      data-testid="switch-mcp-writes"
                    />
                  </div>
                  {settings.allowWrites && (
                    <div className="flex gap-2 rounded-md border border-yellow-200 dark:border-yellow-800 bg-yellow-50 dark:bg-yellow-950 p-3 text-sm text-yellow-800 dark:text-yellow-200">
                      <ShieldAlert className="h-4 w-4 mt-0.5 shrink-0" />
                      <span>
                        Writes run without an in-app approval step. Most MCP clients ask you before each tool call, so keep that prompt turned on in your client.
                      </span>
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Exposed tools</CardTitle>
                  <CardDescription>
                    {exposedCount} of {settings.tools.length} tools are offered to clients. These are the same tools the in-app chat uses, configured separately here.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  {Array.from(toolGroups.entries()).map(([category, tools]) => (
                    <div key={category} className="space-y-1">
                      <h3 className="text-sm font-medium text-muted-foreground">{categoryLabel(category)}</h3>
                      <div className="divide-y">
                        {tools.map((t) => {
                          const blocked = t.write && !settings.allowWrites;
                          return (
                            <div key={t.name} className="flex items-start justify-between gap-4 py-3" data-testid={`row-mcp-tool-${t.name}`}>
                              <div className={`min-w-0 ${blocked ? "opacity-50" : ""}`}>
                                <div className="flex items-center gap-2 flex-wrap">
                                  <Label htmlFor={`mcp-tool-${t.name}`} className="font-medium">{t.label}</Label>
                                  <code className="font-mono text-xs text-muted-foreground">{t.name}</code>
                                  {t.write && <Badge variant="outline">Write</Badge>}
                                </div>
                                <p className="text-sm text-muted-foreground line-clamp-2">{t.description}</p>
                                {blocked && <p className="text-xs text-muted-foreground mt-1">Hidden until write access is allowed.</p>}
                              </div>
                              <Switch
                                id={`mcp-tool-${t.name}`}
                                checked={!!settings.perTool[t.name]}
                                onCheckedChange={(on) => saveMutation.mutate({ perTool: { [t.name]: on } })}
                                data-testid={`switch-mcp-tool-${t.name}`}
                              />
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </>
          )}
        </TabsContent>

        {/* ── Guides ───────────────────────────────────────────────────── */}
        <TabsContent value="guides" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Connect a client</CardTitle>
              <CardDescription>
                {sessionKey
                  ? "The snippets below already contain the key you just created. Treat them like a password."
                  : `Replace ${KEY_PLACEHOLDER} with a key from the Auth tab.`}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Tabs defaultValue="claude-code">
                <TabsList className="flex-wrap h-auto mb-4">
                  {guides.map((g) => (
                    <TabsTrigger key={g.id} value={g.id} data-testid={`tab-guide-${g.id}`}>{g.label}</TabsTrigger>
                  ))}
                </TabsList>
                {guides.map((g) => (
                  <TabsContent key={g.id} value={g.id} className="space-y-3">
                    <p className="text-sm text-muted-foreground">{g.steps}</p>
                    <CodeBlock code={g.code} onCopy={copy} />
                  </TabsContent>
                ))}
              </Tabs>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">What a connected assistant can do</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm text-muted-foreground">
              <p>Search and read people, social accounts, notes, interactions, daily notes and messages, and pull relationships and family trees.</p>
              <p>With write access on, it can also create and update people, notes, interactions, daily notes and relationships.</p>
              <p>
                Try: <span className="text-foreground">"Who did I last talk to about the reunion?"</span> or{" "}
                <span className="text-foreground">"Summarize my notes on Alex from this year."</span>
              </p>
              <p>The in-chat "ask me a question" tool isn't available over MCP. Your client asks you directly instead.</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Troubleshooting</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="space-y-3 text-sm">
                {[
                  ["401 Unauthorized", "The key is wrong, revoked, or isn't an MCP key. Create a new one on the Auth tab."],
                  ["503 MCP server is disabled", "Turn on Enable MCP server on the Options tab."],
                  ["A tool is missing", "It's switched off under Exposed tools, or it's a write tool and write access is off. Reconnect the client after changing tools."],
                  ["Claude Desktop shows no tools", "Check that npx runs from a terminal, then fully quit and reopen Claude Desktop. Its MCP log is under Settings → Developer."],
                  ["Works locally but not from another machine", "Use your public HTTPS URL instead of localhost, and make sure your reverse proxy forwards /api/mcp."],
                ].map(([title, body]) => (
                  <div key={title}>
                    <dt className="font-medium">{title}</dt>
                    <dd className="text-muted-foreground">{body}</dd>
                  </div>
                ))}
              </dl>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Create key */}
      <Dialog open={isCreateOpen} onOpenChange={(open) => { setIsCreateOpen(open); if (!open) setKeyName(""); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create MCP key</DialogTitle>
            <DialogDescription>Name it after the client or device that will use it.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <Label htmlFor="mcp-key-name">Key name</Label>
            <Input
              id="mcp-key-name"
              placeholder="e.g., Claude Code on laptop"
              value={keyName}
              onChange={(e) => setKeyName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleCreate()}
              data-testid="input-mcp-key-name"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsCreateOpen(false)}>Cancel</Button>
            <Button
              onClick={handleCreate}
              disabled={!keyName.trim() || createKeyMutation.isPending}
              data-testid="button-confirm-create-mcp-key"
            >
              {createKeyMutation.isPending ? "Creating..." : "Create key"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Show new key once */}
      <Dialog open={!!newKey} onOpenChange={(open) => !open && setNewKey(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-yellow-500" />
              Save your MCP key
            </DialogTitle>
            <DialogDescription>This is the only time the key is shown. Copy it now.</DialogDescription>
          </DialogHeader>
          {newKey && (
            <div className="space-y-2 py-2">
              <Label>{newKey.name}</Label>
              <div className="flex gap-2">
                <Input value={newKey.key} readOnly className="font-mono text-sm" data-testid="input-new-mcp-key" />
                <Button variant="outline" size="icon" onClick={() => copy(newKey.key)} aria-label="Copy key">
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setNewKey(null)}>Done</Button>
            <Button onClick={() => { setNewKey(null); setTab("guides"); }} data-testid="button-mcp-key-to-guides">
              Set up a client
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Revoke */}
      <AlertDialog open={!!keyToRevoke} onOpenChange={(open) => !open && setKeyToRevoke(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke "{keyToRevoke?.name}"?</AlertDialogTitle>
            <AlertDialogDescription>
              Any MCP client using this key loses access immediately. This can't be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => keyToRevoke && revokeKeyMutation.mutate(keyToRevoke.id)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid="button-confirm-revoke-mcp-key"
            >
              {revokeKeyMutation.isPending ? "Revoking..." : "Revoke key"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
