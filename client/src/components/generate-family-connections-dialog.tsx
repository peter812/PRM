import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Sparkles, Loader2, Plus, Pencil, Trash2, UserPlus } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

type ProposedChange =
  | {
      kind: "add";
      fromPersonId: string;
      fromPersonName: string;
      toPersonId?: string;
      toPersonName?: string;
      newPerson?: { firstName: string; lastName?: string };
      familyRelationshipType: string;
      reason?: string;
    }
  | {
      kind: "edit";
      relationshipId: string;
      fromPersonId: string;
      fromPersonName: string;
      toPersonId: string;
      toPersonName: string;
      currentType: string;
      familyRelationshipType: string;
      reason?: string;
    }
  | {
      kind: "delete";
      relationshipId: string;
      fromPersonId: string;
      fromPersonName: string;
      toPersonId: string;
      toPersonName: string;
      currentType: string;
      reason?: string;
    };

interface GenerateResponse {
  changes: ProposedChange[];
  notes: string;
  iterations: number;
}

interface ApplyResponse {
  applied: number;
  failed: number;
  errors: Array<{ index: number; error: string }>;
}

interface GenerateFamilyConnectionsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  personId: string | null;
  personName?: string;
  onApplied?: () => void;
}

function humanizeType(t: string): string {
  return t.replace(/_/g, " ");
}

function describeChange(c: ProposedChange): { label: string; targetLabel: string } {
  if (c.kind === "add") {
    const target = c.toPersonName
      ? c.toPersonName
      : c.newPerson
        ? `${c.newPerson.firstName}${c.newPerson.lastName ? " " + c.newPerson.lastName : ""} (new)`
        : "(unknown)";
    return {
      label: `${c.fromPersonName || "(unnamed)"} → ${target}`,
      targetLabel: humanizeType(c.familyRelationshipType),
    };
  }
  if (c.kind === "edit") {
    return {
      label: `${c.fromPersonName || "(unnamed)"} → ${c.toPersonName || "(unnamed)"}`,
      targetLabel: `${humanizeType(c.currentType)} → ${humanizeType(c.familyRelationshipType)}`,
    };
  }
  return {
    label: `${c.fromPersonName || "(unnamed)"} → ${c.toPersonName || "(unnamed)"}`,
    targetLabel: `delete (${humanizeType(c.currentType)})`,
  };
}

function changeIcon(kind: ProposedChange["kind"], hasNewPerson: boolean) {
  if (kind === "add") return hasNewPerson ? UserPlus : Plus;
  if (kind === "edit") return Pencil;
  return Trash2;
}

function changeColor(kind: ProposedChange["kind"]): string {
  if (kind === "add") return "text-green-600 dark:text-green-400";
  if (kind === "edit") return "text-amber-600 dark:text-amber-400";
  return "text-red-600 dark:text-red-400";
}

export function GenerateFamilyConnectionsDialog({
  open,
  onOpenChange,
  personId,
  personName,
  onApplied,
}: GenerateFamilyConnectionsDialogProps) {
  const { toast } = useToast();
  const [prompt, setPrompt] = useState("");
  const [allowDeletions, setAllowDeletions] = useState(false);
  const [askForChanges, setAskForChanges] = useState(false);
  const [changes, setChanges] = useState<ProposedChange[] | null>(null);
  const [notes, setNotes] = useState("");
  const [selected, setSelected] = useState<boolean[]>([]);

  const reset = () => {
    setPrompt("");
    setChanges(null);
    setNotes("");
    setSelected([]);
  };

  const handleOpenChange = (next: boolean) => {
    if (!next) reset();
    onOpenChange(next);
  };

  const generateMutation = useMutation({
    mutationFn: async () => {
      if (!personId) throw new Error("No person selected");
      const res = await apiRequest("POST", "/api/family-tree/ai/generate", {
        personId,
        prompt,
        allowDeletions,
        askForChanges,
      });
      return res.json() as Promise<GenerateResponse>;
    },
    onSuccess: (data) => {
      setChanges(data.changes);
      setNotes(data.notes ?? "");
      // Every change is enabled by default.
      setSelected(data.changes.map(() => true));
      if (data.changes.length === 0) {
        toast({
          title: "No changes proposed",
          description: data.notes || "The AI did not identify any relationship changes to make.",
        });
      }
    },
    onError: (err: Error) => {
      toast({ title: "Failed to generate changes", description: err.message, variant: "destructive" });
    },
  });

  const applyMutation = useMutation({
    mutationFn: async () => {
      const approved = (changes ?? []).filter((_, i) => selected[i]);
      const res = await apiRequest("POST", "/api/family-tree/ai/apply", { changes: approved });
      return res.json() as Promise<ApplyResponse>;
    },
    onSuccess: (data) => {
      toast({
        title: "Changes applied",
        description: `${data.applied} applied${data.failed ? `, ${data.failed} failed` : ""}.`,
        variant: data.failed > 0 ? "destructive" : undefined,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/family-tree"] });
      queryClient.invalidateQueries({ queryKey: ["/api/people"] });
      queryClient.invalidateQueries({ queryKey: ["/api/me"] });
      if (personId) {
        queryClient.invalidateQueries({ queryKey: [`/api/relationships/${personId}`] });
        queryClient.invalidateQueries({ queryKey: [`/api/people/${personId}/relationships-grouped`] });
      }
      onApplied?.();
      handleOpenChange(false);
    },
    onError: (err: Error) => {
      toast({ title: "Failed to apply changes", description: err.message, variant: "destructive" });
    },
  });

  const enabledCount = selected.filter(Boolean).length;
  const isGenerating = generateMutation.isPending;
  const isApplying = applyMutation.isPending;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            Generate connections
          </DialogTitle>
          <DialogDescription>
            Describe {personName ? `${personName}'s` : "this person's"} family in plain language. The AI
            will propose a set of relationship changes which you can review before applying.
          </DialogDescription>
        </DialogHeader>

        {changes === null ? (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="generate-prompt">Describe the family</Label>
              <Textarea
                id="generate-prompt"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="e.g. I am Sam Smith, my brother is Mark Smith, my dad is Dale Smith and my mom is Sarah Smith."
                rows={5}
                className="resize-y"
                data-testid="textarea-generate-prompt"
              />
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between gap-4">
                <div className="space-y-0.5">
                  <Label htmlFor="allow-deletions-switch" className="text-sm font-medium">
                    Willing to delete connections?
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    Allow the AI to propose removing existing relationships that contradict the prompt.
                  </p>
                </div>
                <Switch
                  id="allow-deletions-switch"
                  checked={allowDeletions}
                  onCheckedChange={setAllowDeletions}
                  data-testid="switch-allow-deletions"
                />
              </div>
              <div className="flex items-center justify-between gap-4">
                <div className="space-y-0.5">
                  <Label htmlFor="ask-changes-switch" className="text-sm font-medium">
                    Ask about changes?
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    Ask the model to include a short reasoning summary for each proposed change.
                  </p>
                </div>
                <Switch
                  id="ask-changes-switch"
                  checked={askForChanges}
                  onCheckedChange={setAskForChanges}
                  data-testid="switch-ask-changes"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => handleOpenChange(false)} disabled={isGenerating}>
                Cancel
              </Button>
              <Button
                onClick={() => generateMutation.mutate()}
                disabled={!prompt.trim() || isGenerating || !personId}
                data-testid="button-generate-changes"
              >
                {isGenerating ? (
                  <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Generating…</>
                ) : (
                  <><Sparkles className="h-4 w-4 mr-2" />Generate changes</>
                )}
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {notes && (
              <p className="text-xs text-muted-foreground whitespace-pre-wrap" data-testid="text-generate-notes">
                {notes}
              </p>
            )}

            {changes.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                The AI didn't propose any changes. Try rephrasing your prompt.
              </p>
            ) : (
              <>
                <div className="text-xs text-muted-foreground">
                  {enabledCount} of {changes.length} change{changes.length === 1 ? "" : "s"} selected.
                </div>
                <ScrollArea className="max-h-[50vh] -mx-2">
                  <ul className="space-y-2 px-2">
                    {changes.map((c, i) => {
                      const Icon = changeIcon(c.kind, c.kind === "add" && !!c.newPerson);
                      const color = changeColor(c.kind);
                      const { label, targetLabel } = describeChange(c);
                      return (
                        <li
                          key={i}
                          className="flex items-start gap-3 rounded-md border p-3"
                          data-testid={`row-change-${i}`}
                        >
                          <Checkbox
                            id={`change-${i}`}
                            checked={selected[i]}
                            onCheckedChange={(v) => {
                              setSelected((prev) => {
                                const next = [...prev];
                                next[i] = !!v;
                                return next;
                              });
                            }}
                            className="mt-0.5"
                            data-testid={`checkbox-change-${i}`}
                          />
                          <Icon className={`h-4 w-4 mt-0.5 shrink-0 ${color}`} />
                          <label htmlFor={`change-${i}`} className="flex-1 min-w-0 cursor-pointer">
                            <div className="text-sm font-medium leading-tight">{label}</div>
                            <div className={`text-xs ${color}`}>{targetLabel}</div>
                            {c.reason && (
                              <div className="text-xs text-muted-foreground mt-1">{c.reason}</div>
                            )}
                          </label>
                        </li>
                      );
                    })}
                  </ul>
                </ScrollArea>
              </>
            )}

            <div className="flex justify-between gap-2 pt-2">
              <Button
                variant="outline"
                onClick={() => { setChanges(null); setNotes(""); setSelected([]); }}
                disabled={isApplying}
                data-testid="button-back-to-prompt"
              >
                Back
              </Button>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => handleOpenChange(false)} disabled={isApplying}>
                  Cancel
                </Button>
                <Button
                  onClick={() => applyMutation.mutate()}
                  disabled={enabledCount === 0 || isApplying}
                  data-testid="button-apply-changes"
                >
                  {isApplying ? (
                    <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Applying…</>
                  ) : (
                    `Apply ${enabledCount} change${enabledCount === 1 ? "" : "s"}`
                  )}
                </Button>
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
