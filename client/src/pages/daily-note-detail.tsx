import { useState } from "react";
import { useRoute, Link } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { DailyNoteModal } from "@/components/daily-note-modal";
import { queryClient, apiRequest } from "@/lib/queryClient";
import type { DailyNoteWithDetails } from "@shared/schema";
import { format, parseISO } from "date-fns";
import { ArrowLeft, Edit2, Lock, List, Users, Trash2, CalendarDays } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
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

const partyTypeLabel: Record<string, string> = {
  person: "Person",
  group: "Group",
  social_account: "Account",
};

interface ResolvedParty {
  partyType: string;
  refId: string;
  label: string;
}

export default function DailyNoteDetail() {
  const [, params] = useRoute("/daily-notes/:id");
  const id = params?.id;
  const { toast } = useToast();
  const [editOpen, setEditOpen] = useState(false);

  const { data: note, isLoading } = useQuery<DailyNoteWithDetails>({
    queryKey: ["/api/daily-notes", id],
    queryFn: async () => {
      const res = await fetch(`/api/daily-notes/${id}`);
      if (!res.ok) throw new Error("Note not found");
      return res.json();
    },
    enabled: !!id,
  });

  const { data: people = [] } = useQuery<any[]>({ queryKey: ["/api/people"] });
  const { data: groups = [] } = useQuery<any[]>({ queryKey: ["/api/groups"] });
  const { data: socialAccounts = [] } = useQuery<any[]>({ queryKey: ["/api/social-accounts"] });

  const deleteMutation = useMutation({
    mutationFn: () => apiRequest("DELETE", `/api/daily-notes/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/daily-notes"] });
      window.history.back();
      toast({ title: "Deleted", description: "Daily note deleted." });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to delete.", variant: "destructive" });
    },
  });

  const resolveParties = (): ResolvedParty[] => {
    if (!note?.involvedParties) return [];
    return note.involvedParties.map(p => {
      let label = p.refId;
      if (p.partyType === "person") {
        const person = (people as any[]).find(x => x.id === p.refId);
        if (person) label = `${person.firstName} ${person.lastName}`.trim();
      } else if (p.partyType === "group") {
        const grp = (groups as any[]).find(x => x.id === p.refId);
        if (grp) label = grp.name;
      } else if (p.partyType === "social_account") {
        const acc = (socialAccounts as any[]).find(x => x.id === p.refId);
        if (acc) label = acc.username || p.refId;
      }
      return { partyType: p.partyType, refId: p.refId, label };
    });
  };

  if (isLoading) {
    return (
      <div className="h-full overflow-y-auto">
        <div className="max-w-3xl mx-auto p-6 space-y-4">
          <div className="h-8 w-32 bg-muted rounded animate-pulse" />
          <div className="h-6 w-64 bg-muted rounded animate-pulse" />
          <div className="h-48 bg-muted rounded animate-pulse" />
        </div>
      </div>
    );
  }

  if (!note) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center">
          <CalendarDays className="h-12 w-12 mx-auto text-muted-foreground mb-3" />
          <h2 className="text-lg font-medium">Note not found</h2>
          <Link href="/daily-notes">
            <Button variant="outline" className="mt-4">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to Daily Notes
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  const resolvedParties = resolveParties();
  const today = format(new Date(), "yyyy-MM-dd");

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-3xl mx-auto p-6 space-y-6">
        {/* Back link and actions */}
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <Link href="/daily-notes" data-testid="link-back-to-daily-notes">
            <Button variant="ghost" size="sm">
              <ArrowLeft className="h-4 w-4 mr-1" />
              Daily Notes
            </Button>
          </Link>
          <div className="flex items-center gap-2">
            {note.isEditable && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => setEditOpen(true)}
                data-testid="button-edit-daily-note"
              >
                <Edit2 className="h-3.5 w-3.5 mr-1.5" />
                Edit
              </Button>
            )}
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="ghost" size="icon" className="text-muted-foreground" data-testid="button-delete-daily-note">
                  <Trash2 className="h-4 w-4" />
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete this daily note?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This permanently deletes the note for {format(parseISO(note.date), "MMMM d, yyyy")}. This cannot be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() => deleteMutation.mutate()}
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  >
                    Delete
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </div>

        {/* Header info */}
        <div className="space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm text-muted-foreground font-medium">
              {format(parseISO(note.date), "EEEE, MMMM d, yyyy")}
            </span>
            {!note.isEditable && (
              <Badge variant="secondary" className="gap-1">
                <Lock className="h-3 w-3" />
                Read-only
              </Badge>
            )}
            {note.date === today && <Badge>Today</Badge>}
          </div>
          <h1 className="text-xl font-mono font-semibold break-all" data-testid="text-daily-note-title">
            {formatFullTitle(note.date, note.userTitle)}
          </h1>
        </div>

        {/* Body */}
        {note.body ? (
          <div className="prose prose-sm dark:prose-invert max-w-none" data-testid="div-daily-note-body">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{note.body}</ReactMarkdown>
          </div>
        ) : (
          <p className="text-muted-foreground italic text-sm">No body text.</p>
        )}

        {/* Event tree */}
        {note.events.length > 0 && (
          <div className="space-y-2" data-testid="div-event-tree">
            <div className="flex items-center gap-2">
              <List className="h-4 w-4 text-muted-foreground" />
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                Events ({note.events.length})
              </h2>
            </div>
            <ol className="space-y-1.5 list-none">
              {note.events
                .slice()
                .sort((a, b) => a.position - b.position)
                .map((ev, i) => (
                  <li key={ev.id} className="flex items-start gap-2" data-testid={`text-event-${i}`}>
                    <span className="text-muted-foreground text-sm shrink-0 w-5 text-right mt-0.5">{i + 1}.</span>
                    <span className="text-sm">{ev.text}</span>
                  </li>
                ))}
            </ol>
          </div>
        )}

        {/* Involved parties */}
        {resolvedParties.length > 0 && (
          <div className="space-y-2" data-testid="div-involved-parties">
            <div className="flex items-center gap-2">
              <Users className="h-4 w-4 text-muted-foreground" />
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                Involved Parties ({resolvedParties.length})
              </h2>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {resolvedParties.map(p => (
                <Badge key={`${p.partyType}-${p.refId}`} variant="secondary" className="gap-1" data-testid={`badge-party-${p.refId}`}>
                  <span className="text-xs text-muted-foreground">{partyTypeLabel[p.partyType] || p.partyType}</span>
                  <span>{p.label}</span>
                </Badge>
              ))}
            </div>
          </div>
        )}

        {/* Metadata */}
        <p className="text-xs text-muted-foreground border-t pt-3">
          Created {format(new Date(note.createdAt), "PPp")}
        </p>
      </div>

      <DailyNoteModal
        open={editOpen}
        onOpenChange={open => {
          setEditOpen(open);
          if (!open) {
            queryClient.invalidateQueries({ queryKey: ["/api/daily-notes", id] });
          }
        }}
        note={note}
      />
    </div>
  );
}
