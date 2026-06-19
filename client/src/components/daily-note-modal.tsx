import { useState, useEffect, useRef } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import type { DailyNoteWithDetails } from "@shared/schema";
import { Plus, Trash2, Eye, Edit2, ChevronDown, X, Lock, Sparkles, Loader2 } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { format, parseISO } from "date-fns";

interface EventRow {
  id: string;
  text: string;
}

interface PartyItem {
  partyType: "person" | "social_account" | "group";
  refId: string;
  label: string;
}

interface DailyNoteModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  note?: DailyNoteWithDetails | null;
  defaultDate?: string;
  pinOverride?: string; // PIN to include in update requests for locked notes
}

function formatModalTitleDate(date: string): string {
  try {
    return format(parseISO(date), "MMMM d, yyyy");
  } catch {
    return date;
  }
}

function generateId() {
  return Math.random().toString(36).slice(2);
}

export function DailyNoteModal({ open, onOpenChange, note, defaultDate, pinOverride }: DailyNoteModalProps) {
  const { toast } = useToast();
  const isEditing = !!note;
  const isReadOnly = isEditing && !note.isEditable && !pinOverride;

  const today = defaultDate || format(new Date(), "yyyy-MM-dd");
  const [date] = useState(note?.date || today);
  const [userTitle, setUserTitle] = useState(note?.userTitle || "");
  const [body, setBody] = useState(note?.body || "");
  const [events, setEvents] = useState<EventRow[]>(() =>
    (note?.events || []).map(e => ({ id: generateId(), text: e.text }))
  );
  const [parties, setParties] = useState<PartyItem[]>([]);
  const [showPreview, setShowPreview] = useState(false);
  const [partyPopoverOpen, setPartyPopoverOpen] = useState(false);
  const [partySearch, setPartySearch] = useState("");
  const lastEventRef = useRef<HTMLInputElement>(null);

  const { data: people = [] } = useQuery<any[]>({ queryKey: ["/api/people"] });
  const { data: groups = [] } = useQuery<any[]>({ queryKey: ["/api/groups"] });
  const { data: socialAccounts = [] } = useQuery<any[]>({ queryKey: ["/api/social-accounts"] });

  useEffect(() => {
    if (!open) return;
    setUserTitle(note?.userTitle || "");
    setBody(note?.body || "");
    setEvents((note?.events || []).map(e => ({ id: generateId(), text: e.text })));
    setShowPreview(false);
    setPartySearch("");

    if (note?.involvedParties) {
      const resolved: PartyItem[] = note.involvedParties.map(p => {
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
        return { partyType: p.partyType as any, refId: p.refId, label };
      });
      setParties(resolved);
    } else {
      setParties([]);
    }
  }, [open, note]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload: any = {
        date,
        userTitle,
        body,
        events: events.filter(e => e.text.trim()).map((e, i) => ({ text: e.text, position: i })),
        involvedParties: parties.map(p => ({ partyType: p.partyType, refId: p.refId })),
      };
      if (isEditing && note) {
        if (pinOverride) payload.pin = pinOverride;
        return apiRequest("PUT", `/api/daily-notes/${note.id}`, payload);
      }
      return apiRequest("POST", "/api/daily-notes", payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/daily-notes"] });
      toast({ title: "Saved", description: "Daily note saved." });
      onOpenChange(false);
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message || "Failed to save note", variant: "destructive" });
    },
  });

  const generateEventsMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/daily-notes/generate-events", { body });
      return res.json() as Promise<{ events: { text: string }[] }>;
    },
    onSuccess: (data) => {
      const generated = (data.events || [])
        .map(e => ({ id: generateId(), text: (e?.text ?? "").trim() }))
        .filter(e => e.text);
      if (generated.length === 0) {
        toast({ title: "No events found", description: "The AI did not extract any events from this body." });
        return;
      }
      setEvents(prev => [...prev, ...generated]);
      toast({ title: "Events generated", description: `Added ${generated.length} event${generated.length === 1 ? "" : "s"}.` });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message || "Failed to generate events", variant: "destructive" });
    },
  });

  const addEvent = () => {
    setEvents(prev => [...prev, { id: generateId(), text: "" }]);
    setTimeout(() => lastEventRef.current?.focus(), 50);
  };

  const updateEvent = (id: string, text: string) => {
    setEvents(prev => prev.map(e => e.id === id ? { ...e, text } : e));
  };

  const removeEvent = (id: string) => {
    setEvents(prev => prev.filter(e => e.id !== id));
  };

  const handleEventKeyDown = (e: React.KeyboardEvent, id: string) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      addEvent();
    }
  };

  const allPartyOptions: PartyItem[] = [
    ...(people as any[]).map((p: any) => ({
      partyType: "person" as const,
      refId: p.id,
      label: `${p.firstName} ${p.lastName}`.trim(),
    })),
    ...(groups as any[]).map((g: any) => ({
      partyType: "group" as const,
      refId: g.id,
      label: g.name,
    })),
    ...(socialAccounts as any[]).map((a: any) => ({
      partyType: "social_account" as const,
      refId: a.id,
      label: a.username || a.id,
    })),
  ];

  const filteredOptions = allPartyOptions.filter(
    opt =>
      opt.label.toLowerCase().includes(partySearch.toLowerCase()) &&
      !parties.some(p => p.refId === opt.refId && p.partyType === opt.partyType)
  );

  const addParty = (item: PartyItem) => {
    setParties(prev => [...prev, item]);
    setPartySearch("");
    setPartyPopoverOpen(false);
  };

  const removeParty = (refId: string, partyType: string) => {
    setParties(prev => prev.filter(p => !(p.refId === refId && p.partyType === partyType)));
  };

  const partyTypeLabel: Record<string, string> = {
    person: "Person",
    group: "Group",
    social_account: "Account",
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2" data-testid="text-daily-note-modal-title">
            {isReadOnly && <Lock className="h-4 w-4 text-muted-foreground" />}
            {`${formatModalTitleDate(date)} - Daily Note`}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-5">
          {/* Title */}
          <div className="space-y-1.5">
            <Label htmlFor="daily-note-title">Title</Label>
            <Input
              id="daily-note-title"
              value={userTitle}
              onChange={e => setUserTitle(e.target.value)}
              placeholder="Optional title for this day"
              disabled={isReadOnly}
              data-testid="input-daily-note-title"
            />
          </div>

          {/* Body */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label>Body</Label>
              {!isReadOnly && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowPreview(!showPreview)}
                  data-testid="button-toggle-preview"
                >
                  {showPreview ? <Edit2 className="h-3 w-3 mr-1" /> : <Eye className="h-3 w-3 mr-1" />}
                  {showPreview ? "Edit" : "Preview"}
                </Button>
              )}
            </div>
            {showPreview || isReadOnly ? (
              <div className="min-h-[8rem] rounded-md border bg-muted/30 p-3 prose prose-sm dark:prose-invert max-w-none text-sm">
                {body ? (
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{body}</ReactMarkdown>
                ) : (
                  <p className="text-muted-foreground italic">No body text.</p>
                )}
              </div>
            ) : (
              <Textarea
                value={body}
                onChange={e => setBody(e.target.value)}
                placeholder="Write your daily note in markdown..."
                className="min-h-[8rem] font-mono text-sm resize-y"
                disabled={isReadOnly}
                data-testid="textarea-daily-note-body"
              />
            )}
          </div>

          {/* Event tree */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Events</Label>
              {!isReadOnly && (
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => generateEventsMutation.mutate()}
                    disabled={!body.trim() || generateEventsMutation.isPending}
                    data-testid="button-ai-generate-events"
                  >
                    {generateEventsMutation.isPending ? (
                      <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                    ) : (
                      <Sparkles className="h-3 w-3 mr-1" />
                    )}
                    {generateEventsMutation.isPending ? "Generating…" : "AI generate"}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={addEvent}
                    data-testid="button-add-event"
                  >
                    <Plus className="h-3 w-3 mr-1" />
                    Add event
                  </Button>
                </div>
              )}
            </div>
            {events.length === 0 && (
              <p className="text-sm text-muted-foreground">
                {isReadOnly ? "No events recorded." : 'No events yet. Press "Add event" or Enter in a field.'}
              </p>
            )}
            <div className="space-y-1.5">
              {events.map((ev, idx) => (
                <div key={ev.id} className="flex items-center gap-2">
                  <span className="text-muted-foreground text-sm shrink-0 w-5 text-right">{idx + 1}.</span>
                  <Input
                    ref={idx === events.length - 1 ? lastEventRef : undefined}
                    value={ev.text}
                    onChange={e => updateEvent(ev.id, e.target.value)}
                    onKeyDown={e => handleEventKeyDown(e, ev.id)}
                    placeholder="Describe the event..."
                    disabled={isReadOnly}
                    className="flex-1"
                    data-testid={`input-event-${idx}`}
                  />
                  {!isReadOnly && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => removeEvent(ev.id)}
                      className="text-muted-foreground"
                      data-testid={`button-delete-event-${idx}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Involved parties */}
          <div className="space-y-2">
            <Label>Involved Parties</Label>
            <div className="flex flex-wrap gap-1.5 min-h-[2rem]">
              {parties.map(p => (
                <Badge
                  key={`${p.partyType}-${p.refId}`}
                  variant="secondary"
                  className="gap-1 pr-1"
                  data-testid={`badge-party-${p.refId}`}
                >
                  <span className="text-xs text-muted-foreground">{partyTypeLabel[p.partyType]}</span>
                  <span>{p.label}</span>
                  {!isReadOnly && (
                    <button
                      type="button"
                      onClick={() => removeParty(p.refId, p.partyType)}
                      className="ml-0.5 rounded-sm opacity-60 hover:opacity-100"
                      data-testid={`button-remove-party-${p.refId}`}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  )}
                </Badge>
              ))}
              {!isReadOnly && (
                <Popover open={partyPopoverOpen} onOpenChange={setPartyPopoverOpen}>
                  <PopoverTrigger asChild>
                    <Button variant="outline" size="sm" className="h-7" data-testid="button-add-party">
                      <Plus className="h-3 w-3 mr-1" />
                      Add
                      <ChevronDown className="h-3 w-3 ml-1" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="p-0 w-72" align="start">
                    <Command>
                      <CommandInput
                        placeholder="Search people, groups, accounts..."
                        value={partySearch}
                        onValueChange={setPartySearch}
                        data-testid="input-party-search"
                      />
                      <CommandList>
                        <CommandEmpty>No results found.</CommandEmpty>
                        <CommandGroup heading="People">
                          {filteredOptions
                            .filter(o => o.partyType === "person")
                            .slice(0, 8)
                            .map(opt => (
                              <CommandItem
                                key={opt.refId}
                                onSelect={() => addParty(opt)}
                                data-testid={`option-party-${opt.refId}`}
                              >
                                {opt.label}
                              </CommandItem>
                            ))}
                        </CommandGroup>
                        <CommandGroup heading="Groups">
                          {filteredOptions
                            .filter(o => o.partyType === "group")
                            .slice(0, 8)
                            .map(opt => (
                              <CommandItem
                                key={opt.refId}
                                onSelect={() => addParty(opt)}
                                data-testid={`option-party-${opt.refId}`}
                              >
                                {opt.label}
                              </CommandItem>
                            ))}
                        </CommandGroup>
                        <CommandGroup heading="Social Accounts">
                          {filteredOptions
                            .filter(o => o.partyType === "social_account")
                            .slice(0, 8)
                            .map(opt => (
                              <CommandItem
                                key={opt.refId}
                                onSelect={() => addParty(opt)}
                                data-testid={`option-party-${opt.refId}`}
                              >
                                {opt.label}
                              </CommandItem>
                            ))}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
              )}
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-2 pt-2 border-t mt-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} data-testid="button-daily-note-cancel">
            {isReadOnly ? "Close" : "Cancel"}
          </Button>
          {!isReadOnly && (
            <Button
              onClick={() => saveMutation.mutate()}
              disabled={saveMutation.isPending}
              data-testid="button-daily-note-save"
            >
              {saveMutation.isPending ? "Saving..." : "Save"}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
