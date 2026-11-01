import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Info, Loader2, Pencil } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { apiErrorMessage } from "@/components/provider-model-picker";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

export type PromptEntry = {
  key: string;
  section: string;
  title: string;
  description: string;
  appended: string | null;
  value: string;
  default: string;
  modified: boolean;
};

/** Opens read-only on a prompt; Edit swaps in a textarea that fills the modal. */
export function PromptDialog({ prompt, onClose }: { prompt: PromptEntry | null; onClose: () => void }) {
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  useEffect(() => {
    setEditing(false);
    setDraft(prompt?.value ?? "");
  }, [prompt?.key]);

  const dirty = editing && draft !== prompt?.value;

  const saveMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("PUT", `/api/prompts/${prompt!.key}`, { value: draft });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["/api/prompts"] });
      setEditing(false);
      toast({ title: "Prompt saved" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to save prompt", description: apiErrorMessage(error), variant: "destructive" });
    },
  });

  const handleOpenChange = (open: boolean) => {
    if (open) return;
    if (dirty && !window.confirm("Discard your unsaved changes to this prompt?")) return;
    onClose();
  };

  const startEditing = () => {
    setDraft(prompt?.value ?? "");
    setEditing(true);
  };

  return (
    <Dialog open={!!prompt} onOpenChange={handleOpenChange}>
      <DialogContent className="flex h-[90vh] max-w-5xl flex-col gap-4 p-4 sm:p-6" data-testid="dialog-prompt">
        {prompt && (
          <>
            <DialogHeader className="pr-6">
              <DialogTitle className="flex items-center gap-2" data-testid="text-prompt-dialog-title">
                {editing ? `Edit: ${prompt.title}` : prompt.title}
                {prompt.modified && !editing && <Badge variant="secondary">Modified</Badge>}
              </DialogTitle>
              <DialogDescription>{prompt.description}</DialogDescription>
            </DialogHeader>

            {editing ? (
              <Textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                className="min-h-0 flex-1 resize-none font-mono text-sm leading-relaxed"
                autoFocus
                data-testid="textarea-prompt-edit"
              />
            ) : (
              <pre
                className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-words rounded-md border bg-muted/40 p-4 font-mono text-sm leading-relaxed"
                data-testid="text-prompt-view"
              >
                {prompt.value}
              </pre>
            )}

            {prompt.appended && (
              <p className="flex items-start gap-1.5 text-xs text-muted-foreground" data-testid="text-prompt-appended">
                <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                {prompt.appended}
              </p>
            )}

            {editing ? (
              <DialogFooter className="gap-2 sm:items-center sm:justify-between sm:space-x-0">
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    className="text-xs text-muted-foreground underline underline-offset-2 transition-colors hover:text-foreground disabled:opacity-50"
                    onClick={() => setDraft(prompt.default)}
                    disabled={draft === prompt.default}
                    data-testid="button-reset-prompt"
                  >
                    Reset to default
                  </button>
                  <span className="text-xs text-muted-foreground" data-testid="text-prompt-char-count">
                    {draft.length} characters
                  </span>
                </div>
                <div className="flex justify-end gap-2">
                  <Button variant="outline" onClick={() => setEditing(false)} data-testid="button-cancel-prompt">
                    Cancel
                  </Button>
                  <Button
                    onClick={() => saveMutation.mutate()}
                    disabled={!draft.trim() || !dirty || saveMutation.isPending}
                    data-testid="button-save-prompt"
                  >
                    {saveMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}
                  </Button>
                </div>
              </DialogFooter>
            ) : (
              <DialogFooter className="gap-2 sm:space-x-0">
                <Button variant="outline" onClick={onClose} data-testid="button-close-prompt">
                  Close
                </Button>
                <Button onClick={startEditing} data-testid="button-edit-prompt">
                  <Pencil className="mr-1.5 h-4 w-4" />
                  Edit
                </Button>
              </DialogFooter>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
