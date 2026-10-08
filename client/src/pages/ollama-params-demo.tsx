import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { apiErrorMessage, useAiProviders } from "@/components/provider-model-picker";

type AiModel = { name: string; parameterSize: string | null };

type ShowResult = {
  capabilities?: string[];
  thinking?: unknown;
  parameters?: string;
  details?: Record<string, unknown>;
};

/** Ollama's `parameters` is Modelfile text: one `key value` per line, keys may repeat (e.g. stop). */
function parseParameters(text: string | undefined): [string, string][] {
  return (text ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const i = line.search(/\s/);
      return i < 0 ? [line, ""] : [line.slice(0, i), line.slice(i).trim()];
    });
}

export default function OllamaParamsDemoPage() {
  const { data: providers = [], isLoading: loadingProviders } = useAiProviders();
  const ollamaProviders = providers.filter((p) => p.kind === "ollama");
  const [providerId, setProviderId] = useState("");
  const [model, setModel] = useState("");
  const provider =
    ollamaProviders.find((p) => p.id === providerId) ??
    ollamaProviders.find((p) => p.isDefault) ??
    ollamaProviders[0];

  const { data: modelsData, isFetching: loadingModels, error: modelsError } = useQuery<{ models: AiModel[] }>({
    queryKey: ["/api/ai/providers", provider?.id, "models"],
    enabled: !!provider,
    retry: false,
    staleTime: 60_000,
  });
  const models = modelsData?.models ?? [];

  const { data: show, isFetching: loadingShow, error: showError } = useQuery<ShowResult>({
    queryKey: ["/api/ai/providers", provider?.id, "show", { model }],
    enabled: !!provider && !!model,
    retry: false,
  });
  const params = parseParameters(show?.parameters);

  return (
    <div className="h-full overflow-auto">
    <div className="container mx-auto p-6 max-w-4xl">
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2">Ollama Model Params</h1>
        <p className="text-muted-foreground text-lg">
          Pick an Ollama provider and model to see its capabilities, thinking support, and default
          parameters from <code className="font-mono text-base">/api/show</code>.
        </p>
      </div>

      <Card className="mb-6">
        <CardContent className="pt-6 grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>Ollama provider</Label>
            <Select
              value={provider?.id ?? ""}
              onValueChange={(id) => { setProviderId(id); setModel(""); }}
              disabled={loadingProviders || ollamaProviders.length === 0}
            >
              <SelectTrigger data-testid="select-ollama-provider">
                <SelectValue placeholder={loadingProviders ? "Loading…" : "No Ollama providers"} />
              </SelectTrigger>
              <SelectContent>
                {ollamaProviders.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name} <span className="text-xs text-muted-foreground ml-1">{p.baseUrl}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Model</Label>
            <Select value={model} onValueChange={setModel} disabled={!provider || models.length === 0}>
              <SelectTrigger className="font-mono" data-testid="select-ollama-model">
                <SelectValue placeholder={loadingModels ? "Loading…" : "Select a model"} />
              </SelectTrigger>
              <SelectContent>
                {models.map((m) => (
                  <SelectItem key={m.name} value={m.name} className="font-mono">
                    {m.name}
                    {m.parameterSize && <span className="text-xs text-muted-foreground ml-2">{m.parameterSize}</span>}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {modelsError && (
              <p className="text-xs text-destructive">Couldn't list models: {apiErrorMessage(modelsError as Error)}</p>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            Results
            {model && <span className="font-mono text-base font-normal text-muted-foreground">{model}</span>}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6" data-testid="ollama-params-results">
          {!model ? (
            <p className="text-sm text-muted-foreground italic">Select a model to see its details.</p>
          ) : loadingShow ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </div>
          ) : showError ? (
            <p className="text-sm text-destructive">{apiErrorMessage(showError as Error)}</p>
          ) : show && (
            <>
              <section className="space-y-2">
                <h3 className="text-sm font-semibold">Capabilities</h3>
                <div className="flex flex-wrap gap-1.5">
                  {show.capabilities?.length
                    ? show.capabilities.map((c) => <Badge key={c} variant="secondary">{c}</Badge>)
                    : <span className="text-sm text-muted-foreground">None reported</span>}
                </div>
              </section>

              <section className="space-y-2">
                <h3 className="text-sm font-semibold">Thinking</h3>
                <p className="text-sm font-mono">{show.thinking === undefined ? "not reported" : JSON.stringify(show.thinking)}</p>
              </section>

              <section className="space-y-2">
                <h3 className="text-sm font-semibold">Parameters</h3>
                {params.length ? (
                  <table className="w-full text-sm">
                    <tbody>
                      {params.map(([k, v], i) => (
                        <tr key={i} className="border-b last:border-0">
                          <td className="py-1.5 pr-4 font-mono text-muted-foreground whitespace-nowrap align-top">{k}</td>
                          <td className="py-1.5 font-mono break-all">{v}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <p className="text-sm text-muted-foreground">No parameters set (Ollama defaults apply).</p>
                )}
              </section>

              <section className="space-y-2">
                <h3 className="text-sm font-semibold">Raw</h3>
                <pre className="text-xs font-mono bg-muted rounded-md p-3 overflow-x-auto">
                  {JSON.stringify(show, null, 2)}
                </pre>
              </section>
            </>
          )}
        </CardContent>
      </Card>
    </div>
    </div>
  );
}
