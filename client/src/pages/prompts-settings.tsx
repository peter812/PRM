import { useEffect, useState } from "react";
import { useSearch } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Loader2, ScrollText } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PromptDialog, type PromptEntry } from "@/components/prompt-dialog";

type PromptsResponse = {
  sections: { id: string; title: string; description: string }[];
  prompts: PromptEntry[];
};

export default function PromptsSettingsPage() {
  const search = useSearch();
  const [openKey, setOpenKey] = useState<string | null>(null);

  const { data, isLoading } = useQuery<PromptsResponse>({ queryKey: ["/api/prompts"] });

  // Other settings pages link here with ?prompt=<key> to open that prompt directly
  useEffect(() => {
    const key = new URLSearchParams(search).get("prompt");
    if (key) setOpenKey(key);
  }, [search]);

  if (isLoading || !data) {
    return (
      <div className="flex items-center justify-center py-16" data-testid="loading-prompts-settings">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const openPrompt = data.prompts.find((p) => p.key === openKey) ?? null;

  return (
    <div className="container max-w-full py-3 md:py-8 px-4 md:pl-12 mx-auto md:mx-0">
      <div className="space-y-2 mb-6 max-w-3xl">
        <h1 className="text-2xl font-semibold flex items-center gap-2" data-testid="text-prompts-title">
          <ScrollText className="h-6 w-6" />
          Prompts
        </h1>
        <p className="text-sm text-muted-foreground">
          Every instruction this app sends to an AI model. Open one to read it, then edit it to change how that feature behaves.
        </p>
      </div>

      <div className="settings-cards-grid">
        {data.sections.map((section) => (
          <Card key={section.id} data-testid={`card-prompts-${section.id}`}>
            <CardHeader>
              <CardTitle className="text-lg">{section.title}</CardTitle>
              <CardDescription>{section.description}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {data.prompts.filter((p) => p.section === section.id).map((prompt) => (
                <button
                  key={prompt.key}
                  type="button"
                  onClick={() => setOpenKey(prompt.key)}
                  className="w-full rounded-md border px-3 py-2 text-left transition-colors hover-elevate"
                  data-testid={`button-open-prompt-${prompt.key}`}
                >
                  <span className="flex items-center gap-2 text-sm font-medium">
                    {prompt.title}
                    {prompt.modified && <Badge variant="secondary" data-testid={`badge-modified-${prompt.key}`}>Modified</Badge>}
                  </span>
                  <span className="block text-xs text-muted-foreground">{prompt.description}</span>
                </button>
              ))}
            </CardContent>
          </Card>
        ))}
      </div>

      <PromptDialog prompt={openPrompt} onClose={() => setOpenKey(null)} />
    </div>
  );
}
