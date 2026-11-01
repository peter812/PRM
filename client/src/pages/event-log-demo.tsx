import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { Bot, Check, CheckCheck, ChevronDown, ChevronRight, Eye, Loader2, Trash2 } from "lucide-react";
import type { Event } from "@shared/schema";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

const EVENTS_KEY = ["/api/events"];

function ago(ts: Date | string | null) {
  return ts ? formatDistanceToNow(new Date(ts), { addSuffix: true }) : null;
}

function StatusChip({ icon: Icon, label, at }: { icon: typeof Eye; label: string; at: Date | string | null }) {
  return (
    <span
      className={`inline-flex items-center gap-1 text-xs ${at ? "text-foreground" : "text-muted-foreground/50"}`}
      title={at ? `${label} ${ago(at)}` : `Not ${label.toLowerCase()}`}
    >
      <Icon className="h-3.5 w-3.5" />
      {label}
    </span>
  );
}

function EventRow({ event, subEvents }: { event: Event; subEvents: Event[] }) {
  const [open, setOpen] = useState(false);
  const mark = useMutation({
    mutationFn: (m: "seen" | "acknowledged") => apiRequest("PATCH", `/api/events/${event.id}/${m}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: EVENTS_KEY }),
  });

  const toggle = () => {
    setOpen(!open);
    if (!open && !event.seenAt) mark.mutate("seen");
  };

  return (
    <div className={`rounded-md border ${event.seenAt ? "" : "border-primary/50 bg-primary/5"}`}>
      <div className="flex items-start gap-3 p-3">
        <button onClick={toggle} className="mt-0.5 text-muted-foreground" aria-label={open ? "Collapse" : "Expand"}>
          {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </button>
        <div className="flex-1 min-w-0 cursor-pointer" onClick={toggle}>
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{event.title}</span>
            <Badge variant="secondary" className="font-mono text-xs">{event.type}</Badge>
            {subEvents.length > 0 && <Badge variant="outline">{subEvents.length} sub-events</Badge>}
          </div>
          {event.subTitle && <p className="text-sm text-muted-foreground">{event.subTitle}</p>}
          <div className="mt-1 flex flex-wrap items-center gap-3">
            <span className="text-xs text-muted-foreground">{ago(event.createdAt)}</span>
            <StatusChip icon={Eye} label="Seen" at={event.seenAt} />
            <StatusChip icon={CheckCheck} label="Acknowledged" at={event.acknowledgedAt} />
            <StatusChip icon={Bot} label="AI seen" at={event.aiSeenAt} />
          </div>
        </div>
        <div className="flex gap-1">
          {!event.seenAt && (
            <Button size="sm" variant="ghost" onClick={() => mark.mutate("seen")} disabled={mark.isPending}>
              <Eye className="h-4 w-4 mr-1" /> Seen
            </Button>
          )}
          {!event.acknowledgedAt && (
            <Button size="sm" variant="outline" onClick={() => mark.mutate("acknowledged")} disabled={mark.isPending}>
              <Check className="h-4 w-4 mr-1" /> Acknowledge
            </Button>
          )}
        </div>
      </div>

      {open && (
        <div className="border-t px-3 py-2 pl-10 space-y-3">
          {subEvents.length > 0 && (
            <div className="space-y-2">
              {subEvents.map((s) => <EventRow key={s.id} event={s} subEvents={[]} />)}
            </div>
          )}
          {event.nextSteps && (
            <div>
              <p className="text-xs font-semibold uppercase text-muted-foreground mb-1">Next steps</p>
              <pre className="text-xs font-mono whitespace-pre-wrap break-all">{event.nextSteps}</pre>
            </div>
          )}
          <div>
            <p className="text-xs font-semibold uppercase text-muted-foreground mb-1">Log</p>
            <ul className="space-y-1 text-xs font-mono">
              {event.log.map((entry, i) => (
                <li key={i}>
                  <span className="text-muted-foreground">{new Date(entry.at).toLocaleString()}</span>{" "}
                  <span className="font-semibold">{entry.action}</span>
                  {entry.note && <span> — {entry.note}</span>}
                  {entry.data != null && (
                    <pre className="mt-0.5 whitespace-pre-wrap break-all text-muted-foreground">
                      {JSON.stringify(entry.data, null, 2)}
                    </pre>
                  )}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}

export default function EventLogDemoPage() {
  const { toast } = useToast();
  const { data: allEvents = [], isLoading } = useQuery<Event[]>({ queryKey: EVENTS_KEY });

  const onError = (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" });
  const clear = useMutation({
    mutationFn: () => apiRequest("DELETE", "/api/demos/events"),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: EVENTS_KEY }),
    onError,
  });

  const topLevel = allEvents.filter((e) => !e.parentEventId);
  const unseen = topLevel.filter((e) => !e.seenAt).length;

  return (
    <div className="h-full overflow-auto">
      <div className="container mx-auto p-6 max-w-4xl space-y-6">
        <div>
          <h1 className="text-3xl font-bold mb-2">Event Log</h1>
          <p className="text-muted-foreground">
            Changes an external agent should know about, such as deleted posts and unfollows.
          </p>
        </div>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <CardTitle>
              Events {topLevel.length > 0 && <span className="text-muted-foreground font-normal">({unseen} unseen)</span>}
            </CardTitle>
            <div className="flex gap-2">
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="outline" disabled={clear.isPending || allEvents.length === 0}>
                    <Trash2 className="h-4 w-4 mr-1" /> Clear
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Clear all events?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This will permanently delete all {allEvents.length} events, including sub-events. This cannot be undone.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={() => clear.mutate()}
                      className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    >
                      Clear
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </CardHeader>
          <CardContent className="space-y-2">
            {isLoading ? (
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            ) : topLevel.length === 0 ? (
              <p className="text-sm text-muted-foreground">No events yet.</p>
            ) : (
              topLevel.map((e) => (
                <EventRow key={e.id} event={e} subEvents={allEvents.filter((s) => s.parentEventId === e.id)} />
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
