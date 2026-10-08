import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { CheckCircle2, Loader2, Pencil, Plus, Server, Star, Trash2, Wifi, WifiOff } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { EXTERNAL_WARNING, ExternalBadge, apiErrorMessage, useAiProviders, type AiProviderDto } from "@/components/provider-model-picker";

const KIND_LABELS = { ollama: "Ollama", openai: "OpenAI-compatible" } as const;
const URL_PLACEHOLDERS = { ollama: "http://localhost:11434", openai: "https://api.openai.com/v1" } as const;

type Form = {
  id?: string;
  name: string;
  kind: AiProviderDto["kind"];
  baseUrl: string;
  authType: AiProviderDto["authType"];
  username: string;
  secret: string;
  hasSecret: boolean;
  /** undefined = auto-detect from the URL on the server */
  isExternal?: boolean;
};

const EMPTY_FORM: Form = { name: "", kind: "ollama", baseUrl: "", authType: "none", username: "", secret: "", hasSecret: false };

/** Client-side mirror of the server's isExternalUrl, for the live checkbox default. */
function looksExternal(url: string): boolean {
  let host: string;
  try { host = new URL(url).hostname.toLowerCase().replace(/^\[|\]$/g, ""); } catch { return false; }
  if (host.includes(":")) return !(host === "::1" || /^(fc|fd|fe80)/.test(host));
  if (!host.includes(".") || /\.(local|lan|internal|home|localhost)$/.test(host)) return false;
  const m = host.match(/^(\d+)\.(\d+)\.\d+\.\d+$/);
  if (!m) return true;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return !(a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127));
}

export function AiProvidersCard() {
  const { toast } = useToast();
  const { data: providers = [], isLoading } = useAiProviders();
  const [form, setForm] = useState<Form | null>(null);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["/api/ai/providers"] });
  const onError = (error: Error) => toast({ title: "Failed", description: apiErrorMessage(error), variant: "destructive" });

  const isExternal = form ? form.isExternal ?? looksExternal(form.baseUrl) : false;

  const payload = (f: Form) => ({
    name: f.name.trim(),
    kind: f.kind,
    baseUrl: f.baseUrl.trim(),
    authType: f.authType,
    username: f.username,
    secret: f.secret,
    isExternal,
  });

  const saveMutation = useMutation({
    mutationFn: async (f: Form) => {
      const res = f.id
        ? await apiRequest("PATCH", `/api/ai/providers/${f.id}`, payload(f))
        : await apiRequest("POST", "/api/ai/providers", payload(f));
      return res.json();
    },
    onSuccess: () => { invalidate(); setForm(null); toast({ title: "Provider saved" }); },
    onError,
  });

  const testMutation = useMutation({
    mutationFn: async (f: Form) => (await apiRequest("POST", "/api/ai/providers/test", { id: f.id, ...payload(f) })).json(),
    onSuccess: setTestResult,
    onError: (e: Error) => setTestResult({ ok: false, message: apiErrorMessage(e) }),
  });

  const defaultMutation = useMutation({
    mutationFn: (id: string) => apiRequest("PATCH", `/api/ai/providers/${id}`, { isDefault: true }),
    onSuccess: invalidate,
    onError,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/ai/providers/${id}`),
    onSuccess: () => { invalidate(); toast({ title: "Provider deleted" }); },
    // 409s explain what still uses the provider.
    onError: (e: Error) => toast({ title: "Can't delete provider", description: apiErrorMessage(e), variant: "destructive" }),
  });

  const openForm = (f: Form) => { setForm(f); setTestResult(null); };
  const update = (patch: Partial<Form>) => { setForm((f) => f && { ...f, ...patch }); setTestResult(null); };

  return (
    <Card data-testid="card-ai-providers">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-4">
          <div className="space-y-0.5">
            <CardTitle className="text-base flex items-center gap-2"><Server className="h-4 w-4" />AI Providers</CardTitle>
            <CardDescription className="text-xs">Ollama servers and OpenAI-compatible endpoints that models can run on.</CardDescription>
          </div>
          <Button size="sm" variant="outline" className="h-8 text-xs shrink-0" onClick={() => openForm(EMPTY_FORM)} data-testid="button-add-provider">
            <Plus className="h-3.5 w-3.5 mr-1" />Add
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-2 pt-0">
        {isLoading ? (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        ) : providers.length === 0 ? (
          <p className="text-xs text-muted-foreground">No providers yet. Add your Ollama server or an OpenAI-compatible endpoint.</p>
        ) : providers.map((p) => (
          <div key={p.id} className="flex items-center gap-2 rounded-md border p-2.5" data-testid={`row-provider-${p.id}`}>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-sm font-medium truncate">{p.name}</span>
                <span className="text-[10px] text-muted-foreground">{KIND_LABELS[p.kind]}</span>
                {p.isDefault && <span className="text-[10px] rounded bg-primary/10 text-primary px-1.5">Default</span>}
                {p.isExternal && <ExternalBadge />}
              </div>
              <p className="text-[11px] text-muted-foreground font-mono truncate">{p.baseUrl}</p>
            </div>
            {!p.isDefault && (
              <Button size="icon" variant="ghost" className="h-7 w-7" title="Make default" onClick={() => defaultMutation.mutate(p.id)} data-testid={`button-default-provider-${p.id}`}>
                <Star className="h-3.5 w-3.5" />
              </Button>
            )}
            <Button
              size="icon" variant="ghost" className="h-7 w-7" title="Edit"
              onClick={() => openForm({ ...p, secret: "", isExternal: p.isExternal })}
              data-testid={`button-edit-provider-${p.id}`}
            >
              <Pencil className="h-3.5 w-3.5" />
            </Button>
            <Button
              size="icon" variant="ghost" className="h-7 w-7 text-destructive" title="Delete"
              onClick={() => { if (confirm(`Delete ${p.name}?`)) deleteMutation.mutate(p.id); }}
              data-testid={`button-delete-provider-${p.id}`}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        ))}
      </CardContent>

      <Dialog open={!!form} onOpenChange={(o) => !o && setForm(null)}>
        {form && (
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>{form.id ? "Edit provider" : "Add provider"}</DialogTitle>
              <DialogDescription>Models for each feature are chosen from these providers.</DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="provider-name">Name</Label>
                  <Input id="provider-name" value={form.name} placeholder="Home Ollama" onChange={(e) => update({ name: e.target.value })} data-testid="input-provider-name" />
                </div>
                <div className="space-y-1.5">
                  <Label>Type</Label>
                  <Select value={form.kind} onValueChange={(kind) => update({ kind: kind as Form["kind"] })}>
                    <SelectTrigger data-testid="select-provider-kind"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ollama">Ollama</SelectItem>
                      <SelectItem value="openai">OpenAI-compatible</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="provider-url">Base URL</Label>
                <Input id="provider-url" value={form.baseUrl} placeholder={URL_PLACEHOLDERS[form.kind]} onChange={(e) => update({ baseUrl: e.target.value })} data-testid="input-provider-url" />
                {form.kind === "openai" && (
                  <p className="text-[11px] text-muted-foreground">Include the version path, e.g. <code>/v1</code> (LM Studio, vLLM, llama.cpp, OpenRouter…).</p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label>Authentication</Label>
                <Select value={form.authType} onValueChange={(authType) => update({ authType: authType as Form["authType"] })}>
                  <SelectTrigger data-testid="select-provider-auth"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    <SelectItem value="bearer">API key (Bearer)</SelectItem>
                    <SelectItem value="basic">Basic auth</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {form.authType === "basic" && (
                <div className="space-y-1.5">
                  <Label htmlFor="provider-username">Username</Label>
                  <Input id="provider-username" value={form.username} onChange={(e) => update({ username: e.target.value })} data-testid="input-provider-username" />
                </div>
              )}
              {form.authType !== "none" && (
                <div className="space-y-1.5">
                  <Label htmlFor="provider-secret">
                    {form.authType === "basic" ? "Password" : "API key"}
                    {form.hasSecret && <span className="ml-2 text-xs text-muted-foreground font-normal">(saved — enter a new value to change)</span>}
                  </Label>
                  <Input
                    id="provider-secret" type="password" value={form.secret}
                    placeholder={form.hasSecret ? "••••••••" : ""}
                    onChange={(e) => update({ secret: e.target.value })}
                    data-testid="input-provider-secret"
                  />
                </div>
              )}
              <div className="flex items-start gap-2">
                <Checkbox
                  id="provider-external" checked={isExternal}
                  onCheckedChange={(v) => update({ isExternal: v === true })}
                  data-testid="checkbox-provider-external"
                />
                <div className="space-y-0.5">
                  <Label htmlFor="provider-external" className="text-sm">External provider</Label>
                  <p className="text-[11px] text-muted-foreground">Detected from the URL; override if wrong.</p>
                </div>
              </div>
              {isExternal && (
                <p className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2.5 text-xs text-amber-800 dark:text-amber-300" data-testid="text-external-warning">
                  {EXTERNAL_WARNING}
                </p>
              )}
              {testResult && (
                <div className={`flex items-start gap-2 rounded-md p-2.5 text-xs ${testResult.ok ? "bg-primary/10 border border-primary/20" : "bg-destructive/10 border border-destructive/20"}`} data-testid="text-provider-test-result">
                  {testResult.ok ? <CheckCircle2 className="h-4 w-4 shrink-0" /> : <WifiOff className="h-4 w-4 shrink-0 text-destructive" />}
                  <span>{testResult.message}</span>
                </div>
              )}
            </div>
            <DialogFooter className="gap-2 sm:gap-0">
              <Button variant="outline" onClick={() => testMutation.mutate(form)} disabled={!form.baseUrl.trim() || testMutation.isPending} data-testid="button-test-provider">
                {testMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Wifi className="h-4 w-4 mr-2" />}Test
              </Button>
              <Button onClick={() => saveMutation.mutate(form)} disabled={!form.name.trim() || !form.baseUrl.trim() || saveMutation.isPending} data-testid="button-save-provider">
                {saveMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Save
              </Button>
            </DialogFooter>
          </DialogContent>
        )}
      </Dialog>
    </Card>
  );
}
