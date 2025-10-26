import { useMutation } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import type { Note } from "@shared/schema";
import { formatDistanceToNow } from "date-fns";

interface NotesTabProps {
  notes: Note[];
  personId: string;
  onAddNote: () => void;
}

export function NotesTab({ notes, personId, onAddNote }: NotesTabProps) {
  const { toast } = useToast();

  const deleteMutation = useMutation({
    mutationFn: async (noteId: string) => {
      return await apiRequest("DELETE", `/api/notes/${noteId}`, undefined);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/people", String(personId)] });
      toast({
        title: "Success",
        description: "Note deleted successfully",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to delete note",
        variant: "destructive",
      });
    },
  });

  const sortedNotes = [...notes].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-semibold">Notes</h2>
        <Button onClick={onAddNote} size="sm" data-testid="button-add-note">
          <Plus className="h-4 w-4" />
          Add Note
        </Button>
      </div>

      {sortedNotes.length > 0 ? (
        <div className="space-y-4">
          {sortedNotes.map((note) => (
            <Card key={note.id} className="p-6" data-testid={`card-note-${note.id}`}>
              <div className="flex items-start justify-between gap-4 mb-3">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  {formatDistanceToNow(new Date(note.createdAt), {
                    addSuffix: true,
                  })}
                </p>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => deleteMutation.mutate(note.id)}
                  disabled={deleteMutation.isPending}
                  className="h-8 text-destructive hover:text-destructive"
                  data-testid={`button-delete-note-${note.id}`}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
              <p className="text-base whitespace-pre-wrap" data-testid={`text-note-content-${note.id}`}>
                {note.content}
              </p>
              {note.imageUrl && (
                <div className="mt-4">
                  <img
                    src={note.imageUrl}
                    alt="Note attachment"
                    className="rounded-md max-w-md w-full border"
                    data-testid={`img-note-${note.id}`}
                  />
                </div>
              )}
            </Card>
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-4">
            <Plus className="h-8 w-8 text-muted-foreground" />
          </div>
          <h3 className="text-lg font-medium mb-2">No notes yet</h3>
          <p className="text-sm text-muted-foreground mb-6 max-w-sm">
            Add notes to keep track of important information about this person
          </p>
          <Button onClick={onAddNote} data-testid="button-add-note-empty">
            <Plus className="h-4 w-4" />
            Add Note
          </Button>
        </div>
      )}
    </div>
  );
}
