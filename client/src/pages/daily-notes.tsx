import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { DailyNoteModal } from "@/components/daily-note-modal";
import { queryClient, apiRequest } from "@/lib/queryClient";
import type { DailyNoteWithDetails } from "@shared/schema";
import { format, parseISO } from "date-fns";
import { Plus, Lock, CalendarDays, List, Users, Trash2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

function formatFullTitle(date: string, userTitle: string): string {
  return `{${date}${userTitle ? `-[${userTitle}]` : ""}}`;
}

function getTodayDate(): string {
  return format(new Date(), "yyyy-MM-dd");
}

export default function DailyNotesList() {
  const { toast } = useToast();
  const [modalOpen, setModalOpen] = useState(false);
  const [selectedNote, setSelectedNote] = useState<DailyNoteWithDetails | null>(null);

  const today = getTodayDate();

  const { data: notes = [], isLoading } = useQuery<DailyNoteWithDetails[]>({
    queryKey: ["/api/daily-notes"],
  });

  const todayNote = notes.find(n => n.date === today);

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/daily-notes/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/daily-notes"] });
      toast({ title: "Deleted", description: "Daily note deleted." });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to delete note.", variant: "destructive" });
    },
  });

  const handleOpenToday = () => {
    if (todayNote) {
      setSelectedNote(todayNote);
    } else {
      setSelectedNote(null);
    }
    setModalOpen(true);
  };

  const handleNoteClick = (note: DailyNoteWithDetails) => {
    setSelectedNote(note);
    setModalOpen(true);
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-3xl mx-auto p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div>
            <h1 className="text-2xl font-semibold">Daily Notes</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Date-anchored journal entries. Editable for 2 days, then read-only.
            </p>
          </div>
          <Button onClick={handleOpenToday} data-testid="button-open-today">
            <CalendarDays className="h-4 w-4 mr-2" />
            {todayNote ? "Open Today's Note" : "New Note for Today"}
          </Button>
        </div>

        {/* Notes list */}
        {isLoading ? (
          <div className="space-y-3">
            {[1, 2, 3].map(i => (
              <div key={i} className="h-28 rounded-md bg-muted animate-pulse" />
            ))}
          </div>
        ) : notes.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <div className="w-14 h-14 rounded-full bg-muted flex items-center justify-center mb-4">
              <CalendarDays className="h-7 w-7 text-muted-foreground" />
            </div>
            <h3 className="text-lg font-medium mb-1">No daily notes yet</h3>
            <p className="text-sm text-muted-foreground mb-5 max-w-xs">
              Start capturing your day. Each note is editable for two days, then locked.
            </p>
            <Button onClick={handleOpenToday} data-testid="button-create-first-note">
              <Plus className="h-4 w-4 mr-2" />
              Create today's note
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            {notes.map(note => (
              <Card
                key={note.id}
                className="hover-elevate cursor-pointer"
                data-testid={`card-daily-note-${note.id}`}
                onClick={() => handleNoteClick(note)}
              >
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="min-w-0 flex-1">
                      {/* Date row */}
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <span className="text-xs font-medium text-muted-foreground">
                          {format(parseISO(note.date), "EEEE, MMMM d, yyyy")}
                        </span>
                        {!note.isEditable && (
                          <Badge variant="secondary" className="gap-1 text-xs py-0">
                            <Lock className="h-2.5 w-2.5" />
                            Read-only
                          </Badge>
                        )}
                        {note.date === today && (
                          <Badge className="text-xs py-0">Today</Badge>
                        )}
                      </div>

                      {/* Title */}
                      <p className="text-sm font-mono text-foreground truncate">
                        {formatFullTitle(note.date, note.userTitle)}
                      </p>

                      {/* Body preview */}
                      {note.body && (
                        <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
                          {note.body}
                        </p>
                      )}

                      {/* Chips row */}
                      <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground flex-wrap">
                        {note.events.length > 0 && (
                          <span className="flex items-center gap-1">
                            <List className="h-3 w-3" />
                            {note.events.length} event{note.events.length !== 1 ? "s" : ""}
                          </span>
                        )}
                        {note.involvedParties.length > 0 && (
                          <span className="flex items-center gap-1">
                            <Users className="h-3 w-3" />
                            {note.involvedParties.length} part{note.involvedParties.length !== 1 ? "ies" : "y"}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-1 shrink-0" onClick={e => e.stopPropagation()}>
                      <Link href={`/daily-notes/${note.id}`} data-testid={`link-daily-note-detail-${note.id}`}>
                        <Button variant="ghost" size="sm" className="text-xs">
                          View
                        </Button>
                      </Link>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="text-muted-foreground"
                            data-testid={`button-delete-note-${note.id}`}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Delete daily note?</AlertDialogTitle>
                            <AlertDialogDescription>
                              This will permanently delete the note for {format(parseISO(note.date), "MMMM d, yyyy")}. This cannot be undone.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction
                              onClick={() => deleteMutation.mutate(note.id)}
                              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                            >
                              Delete
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      <DailyNoteModal
        open={modalOpen}
        onOpenChange={open => {
          setModalOpen(open);
          if (!open) setSelectedNote(null);
        }}
        note={selectedNote}
        defaultDate={today}
      />
    </div>
  );
}
