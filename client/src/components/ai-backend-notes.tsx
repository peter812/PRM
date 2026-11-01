import { useMutation, useQuery } from "@tanstack/react-query";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { AiBackendNote } from "@shared/schema";

/** Facts the summary LLM pulled from the user's Fix corrections; fed into future summaries. Hidden when empty. */
export function AiBackendNotes({ kind, id }: { kind: "people" | "social-accounts"; id: string }) {
  const { toast } = useToast();
  const url = `/api/${kind}/${id}/ai-backend-notes`;
  const { data: notes } = useQuery<AiBackendNote[]>({ queryKey: [url] });

  const deleteMutation = useMutation({
    mutationFn: async (target: number | { index: number; note?: AiBackendNote }) => {
      const index = typeof target === "number" ? target : target.index;
      const note = typeof target === "object" ? target.note : notes?.[index];

      // Re-check index against current cached notes in case notes updated since render
      const cachedNotes = queryClient.getQueryData<AiBackendNote[]>([url]);
      let targetIndex = index;
      if (note && cachedNotes) {
        const foundIndex = cachedNotes.findIndex(
          (n) => n.createdAt === note.createdAt && n.text === note.text
        );
        if (foundIndex !== -1) {
          targetIndex = foundIndex;
        }
      }

      const res = await apiRequest("DELETE", `${url}/${targetIndex}`);
      return res.json() as Promise<AiBackendNote[]>;
    },
    onSuccess: (remaining) => {
      queryClient.setQueryData([url], remaining);
      queryClient.invalidateQueries({ queryKey: [url] });

      if (kind === "people") {
        queryClient.invalidateQueries({ queryKey: ["/api/people", id] });
        queryClient.invalidateQueries({ queryKey: [`/api/people/${id}`] });
        queryClient.invalidateQueries({ queryKey: ["/api/me"] });
        queryClient.invalidateQueries({
          predicate: (q) =>
            typeof q.queryKey[0] === "string" &&
            q.queryKey[0].startsWith("/api/social-accounts/") &&
            q.queryKey[0].endsWith("/summary"),
        });
        queryClient.invalidateQueries({ queryKey: ["/api/social-accounts"] });
      } else {
        queryClient.invalidateQueries({ queryKey: [`/api/social-accounts/${id}/summary`] });
        queryClient.invalidateQueries({ queryKey: ["/api/social-accounts", id] });
        queryClient.invalidateQueries({ queryKey: [`/api/social-accounts/${id}`] });
      }
    },
    onError: (err: Error) => {
      toast({ title: "Failed to delete note", description: err.message, variant: "destructive" });
    },
  });

  if (!notes?.length) return null;

  return (
    <div className="space-y-1.5" data-testid="ai-backend-notes">
      <span className="font-semibold text-[10px] text-muted-foreground uppercase tracking-wider block">AI Notes</span>
      {notes.map((note, i) => (
        <div key={`${i}-${note.createdAt}`} className="flex items-start gap-1.5 text-xs" data-testid={`ai-backend-note-${i}`}>
          <span className="flex-1 min-w-0 leading-snug">
            {note.text}
            <span className="block text-[10px] text-muted-foreground">
              {note.source.kind === "post_append" ? `From a fix on image ${note.source.imageIndex + 1}` : "Added manually"} ·{" "}
              {new Date(note.createdAt).toLocaleDateString()}
            </span>
          </span>
          <Button
            variant="ghost"
            size="icon"
            className="h-5 w-5 shrink-0"
            title="Delete note"
            disabled={deleteMutation.isPending}
            onClick={() => deleteMutation.mutate({ index: i, note })}
            data-testid={`button-delete-ai-note-${i}`}
          >
            <X className="h-3 w-3" />
          </Button>
        </div>
      ))}
    </div>
  );
}
