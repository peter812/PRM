import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, ChevronsUpDown, Globe, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export type AiProviderDto = {
  id: string;
  name: string;
  kind: "ollama" | "openai";
  baseUrl: string;
  authType: "none" | "basic" | "bearer";
  username: string;
  hasSecret: boolean;
  isDefault: boolean;
  isExternal: boolean;
};

/** '' providerId = the default provider; '' model = unset (use the fallback). */
export type ModelSelection = { providerId: string; model: string };

type AiModel = { name: string; parameterSize: string | null };

export function useAiProviders() {
  return useQuery<AiProviderDto[]>({ queryKey: ["/api/ai/providers"] });
}

/** apiRequest errors look like `409: {"error":"..."}` — pull out the message. */
export function apiErrorMessage(e: Error): string {
  const body = e.message.replace(/^\d+:\s*/, "");
  try { return JSON.parse(body).error ?? body; } catch { return body; }
}

export const EXTERNAL_WARNING = "This provider is outside your network. Prompts, notes, and images sent to it leave your machine.";

/** Warning shown wherever a remote provider can be picked. */
export function ExternalBadge({ compact = false }: { compact?: boolean }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge
          variant="outline"
          className="gap-1 border-amber-500/50 text-amber-700 dark:text-amber-400 px-1.5 py-0 text-[10px] font-medium shrink-0"
          data-testid="badge-external-provider"
        >
          <Globe className="h-3 w-3" />
          {!compact && "External"}
        </Badge>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs text-xs">{EXTERNAL_WARNING}</TooltipContent>
    </Tooltip>
  );
}

/**
 * Provider dropdown + model combobox. The model list comes from the provider,
 * and any typed name is accepted (OpenAI-compatible servers don't always list).
 */
export function ProviderModelPicker({
  value,
  onChange,
  fallbackLabel,
  disabled,
  testId = "picker",
}: {
  value: ModelSelection;
  onChange: (value: ModelSelection) => void;
  /** When set, an empty model is allowed and shown as this label (e.g. "Use text model"). */
  fallbackLabel?: string;
  disabled?: boolean;
  testId?: string;
}) {
  const { data: providers = [], isLoading: loadingProviders } = useAiProviders();
  const missingProvider = !loadingProviders && !!value.providerId && !providers.some((p) => p.id === value.providerId);
  // A deleted provider is not silently swapped for the default: the model box
  // stays disabled until a provider is picked.
  const provider = missingProvider
    ? undefined
    : providers.find((p) => p.id === value.providerId) ?? providers.find((p) => p.isDefault) ?? providers[0];

  const { data: modelsData, isFetching: loadingModels, error: modelsError } = useQuery<{ models: AiModel[] }>({
    queryKey: ["/api/ai/providers", provider?.id, "models"],
    enabled: !!provider,
    retry: false,
    staleTime: 60_000,
  });
  const models = modelsData?.models ?? [];

  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const typed = search.trim();
  const shown = typed ? models.filter((m) => m.name.toLowerCase().includes(typed.toLowerCase())) : models;

  if (!loadingProviders && providers.length === 0) {
    return <p className="text-xs text-muted-foreground italic">Add an AI provider above to choose a model.</p>;
  }

  const pickModel = (model: string) => {
    onChange({ providerId: provider?.id ?? "", model });
    setOpen(false);
    setSearch("");
  };

  return (
    <div className="flex flex-col sm:flex-row gap-1.5 min-w-0" data-testid={`${testId}-container`}>
      <Select
        value={missingProvider ? "__missing__" : provider?.id ?? ""}
        // Model names aren't portable across servers, so switching clears the model.
        onValueChange={(id) => onChange({ providerId: id, model: "" })}
        disabled={disabled || loadingProviders}
      >
        <SelectTrigger className="h-8 text-xs sm:w-[42%] min-w-0" data-testid={`${testId}-provider`}>
          <SelectValue placeholder="Provider" />
        </SelectTrigger>
        <SelectContent>
          {missingProvider && (
            <SelectItem value="__missing__" disabled className="text-xs text-destructive">Deleted provider</SelectItem>
          )}
          {providers.map((p) => (
            <SelectItem key={p.id} value={p.id} className="text-xs">
              <span className="flex items-center gap-1.5">
                {p.name}
                {p.isDefault && <span className="text-[10px] text-muted-foreground">(default)</span>}
                {p.isExternal && <Globe className="h-3 w-3 text-amber-600 dark:text-amber-400" aria-label="External provider" />}
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Popover open={open} onOpenChange={(o) => { setOpen(o); if (!o) setSearch(""); }}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            role="combobox"
            aria-expanded={open}
            disabled={disabled || !provider}
            className="h-8 flex-1 min-w-0 justify-between px-2.5 text-xs font-mono font-normal"
            data-testid={`${testId}-model`}
          >
            <span className={cn("truncate", !value.model && "text-muted-foreground italic font-sans")}>
              {value.model || fallbackLabel || "Select a model"}
            </span>
            {loadingModels ? <Loader2 className="h-3.5 w-3.5 animate-spin opacity-50" /> : <ChevronsUpDown className="h-3.5 w-3.5 opacity-50 shrink-0" />}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="p-0 w-[--radix-popover-trigger-width] min-w-[240px]" align="start">
          {/* Filtering is done here: cmdk's fuzzy scoring hides names like "llama3:8b". */}
          <Command shouldFilter={false}>
            <CommandInput
              placeholder="Search or type a model name…"
              value={search}
              onValueChange={setSearch}
              // Enter always commits exactly what was typed, never a nearby match.
              onKeyDown={(e) => { if (e.key === "Enter" && typed) { e.preventDefault(); pickModel(typed); } }}
              className="text-xs"
            />
            <CommandList>
              {(modelsError || (!loadingModels && models.length === 0)) && (
                <p className="py-2 px-3 text-xs text-muted-foreground" data-testid={`${testId}-models-note`}>
                  {modelsError ? `Couldn't list models: ${apiErrorMessage(modelsError as Error)}` : "This provider lists no models. Type a name."}
                </p>
              )}
              {typed && !models.some((m) => m.name === typed) && (
                <CommandGroup>
                  <CommandItem value={typed} onSelect={() => pickModel(typed)} className="text-xs">
                    Use <span className="font-mono ml-1">"{typed}"</span>
                  </CommandItem>
                </CommandGroup>
              )}
              {fallbackLabel && (
                <CommandGroup>
                  <CommandItem value="__fallback__" onSelect={() => pickModel("")} className="text-xs italic text-muted-foreground">
                    <Check className={cn("h-3.5 w-3.5 mr-1.5", value.model ? "opacity-0" : "opacity-100")} />
                    {fallbackLabel}
                  </CommandItem>
                </CommandGroup>
              )}
              {shown.length > 0 && (
                <CommandGroup heading={provider?.name}>
                  {shown.map((m) => (
                    <CommandItem key={m.name} value={m.name} onSelect={() => pickModel(m.name)} className="text-xs">
                      <Check className={cn("h-3.5 w-3.5 mr-1.5", value.model === m.name ? "opacity-100" : "opacity-0")} />
                      <span className="font-mono truncate">{m.name}</span>
                      {m.parameterSize && <span className="ml-auto pl-2 text-[10px] text-muted-foreground">{m.parameterSize}</span>}
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {provider?.isExternal && <span className="self-center"><ExternalBadge compact /></span>}
    </div>
  );
}
