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
import { Plus, Trash2, Eye, Edit2, ChevronDown, X, Lock, Sparkles, Loader2, Check, CloudOff, Mic, Square } from "lucide-react";
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

  // ── Autosave state ────────────────────────────────────────────────────────
  // The note id is known upfront when editing, or gets populated after the
  // first autosave POST creates the note. Kept in a ref so timers/unmount
  // handlers always read the latest value.
  const [noteId, setNoteId] = useState<string | undefined>(note?.id);
  const [status, setStatus] = useState<string>(note?.status || "finished");
  const [autosaveStatus, setAutosaveStatus] = useState<"idle" | "pending" | "saving" | "saved" | "error">("idle");
  const noteIdRef = useRef<string | undefined>(note?.id);
  const dirtyRef = useRef(false);
  const creatingRef = useRef(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestRef = useRef<{ userTitle: string; body: string; events: EventRow[]; parties: PartyItem[] }>({
    userTitle: "", body: "", events: [], parties: [],
  });
  // Keep the latest field values available to autosave timers / flush handlers.
  latestRef.current = { userTitle, body, events, parties };

  // ── Dictation (speech-to-text) state ──────────────────────────────────────
  const [recording, setRecording] = useState<"idle" | "recording" | "transcribing">("idle");
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const mediaStreamRef = useRef<MediaStream | null>(null);

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

    // Reset autosave tracking whenever the modal (re)opens.
    setNoteId(note?.id);
    noteIdRef.current = note?.id;
    setStatus(note?.status || "finished");
    setAutosaveStatus("idle");
    dirtyRef.current = false;
    creatingRef.current = false;
    if (debounceRef.current) { clearTimeout(debounceRef.current); debounceRef.current = null; }

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

  // Build the request payload from the latest field values, tagged with the
  // given status ("unfinished" for autosaves, "finished" for explicit saves).
  const buildPayload = (statusValue: "finished" | "unfinished") => {
    const src = latestRef.current;
    const payload: any = {
      date,
      userTitle: src.userTitle,
      body: src.body,
      status: statusValue,
      events: src.events.filter(e => e.text.trim()).map((e, i) => ({ text: e.text, position: i })),
      involvedParties: src.parties.map(p => ({ partyType: p.partyType, refId: p.refId })),
    };
    return payload;
  };

  const hasContent = () => {
    const src = latestRef.current;
    return (
      !!src.userTitle.trim() ||
      !!src.body.trim() ||
      src.events.some(e => e.text.trim()) ||
      src.parties.length > 0
    );
  };

  // Persist the current draft as "unfinished". Creates the note on first run,
  // then updates it in place on subsequent runs.
  const runAutosave = async () => {
    if (isReadOnly || !dirtyRef.current || creatingRef.current) return;
    // Never create an empty note; wait until the user has typed something.
    if (!noteIdRef.current && !hasContent()) return;
    setAutosaveStatus("saving");
    try {
      const payload = buildPayload("unfinished");
      if (noteIdRef.current) {
        payload.autosave = true;
        if (pinOverride) payload.pin = pinOverride;
        await apiRequest("PUT", `/api/daily-notes/${noteIdRef.current}`, payload);
      } else {
        creatingRef.current = true;
        const res = await apiRequest("POST", "/api/daily-notes", payload);
        const created = await res.json();
        noteIdRef.current = created.id;
        setNoteId(created.id);
        creatingRef.current = false;
      }
      dirtyRef.current = false;
      setStatus("unfinished");
      setAutosaveStatus("saved");
      queryClient.invalidateQueries({ queryKey: ["/api/daily-notes"] });
    } catch {
      creatingRef.current = false;
      setAutosaveStatus("error");
    }
  };

  // Debounce autosave so we save shortly after the user stops typing.
  const scheduleAutosave = () => {
    if (isReadOnly) return;
    dirtyRef.current = true;
    setAutosaveStatus("pending");
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => { void runAutosave(); }, 900);
  };

  // Save any pending changes immediately (used when the modal closes).
  const flushAutosave = () => {
    if (debounceRef.current) { clearTimeout(debounceRef.current); debounceRef.current = null; }
    if (dirtyRef.current && !isReadOnly) void runAutosave();
  };

  // ── Dictation helpers ─────────────────────────────────────────────────────
  const stopMediaStream = () => {
    mediaStreamRef.current?.getTracks().forEach(t => t.stop());
    mediaStreamRef.current = null;
  };

  // Insert transcribed text into the body at the caret (or append if no focus).
  const insertTranscript = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    setBody(prev => {
      const el = bodyRef.current;
      if (el && el.selectionStart != null) {
        const start = el.selectionStart;
        const end = el.selectionEnd ?? start;
        const before = prev.slice(0, start);
        const after = prev.slice(end);
        const needsLeadingSpace = before.length > 0 && !/\s$/.test(before);
        const insert = (needsLeadingSpace ? " " : "") + trimmed;
        const next = before + insert + after;
        // Restore caret just after the inserted text on the next tick.
        const caret = before.length + insert.length;
        setTimeout(() => {
          el.focus();
          el.setSelectionRange(caret, caret);
        }, 0);
        return next;
      }
      // No caret info — append with a separating space.
      return prev ? `${prev.replace(/\s*$/, "")} ${trimmed}` : trimmed;
    });
    scheduleAutosave();
  };

  const transcribeBlob = async (blob: Blob) => {
    setRecording("transcribing");
    try {
      const form = new FormData();
      const ext = blob.type.includes("ogg") ? "ogg" : "webm";
      form.append("audio", blob, `dictation.${ext}`);
      const res = await fetch("/api/daily-notes/transcribe", {
        method: "POST",
        body: form,
        credentials: "include",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Transcription failed (${res.status})`);
      }
      const data = await res.json() as { text?: string };
      insertTranscript(data.text || "");
    } catch (err: any) {
      toast({ title: "Dictation failed", description: err.message || "Could not transcribe audio.", variant: "destructive" });
    } finally {
      setRecording("idle");
    }
  };

  const startRecording = async () => {
    if (isReadOnly || recording !== "idle") return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;
      const mimeType = MediaRecorder.isTypeSupported("audio/webm")
        ? "audio/webm"
        : MediaRecorder.isTypeSupported("audio/ogg")
          ? "audio/ogg"
          : "";
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      audioChunksRef.current = [];
      recorder.ondataavailable = e => { if (e.data.size > 0) audioChunksRef.current.push(e.data); };
      recorder.onstop = () => {
        stopMediaStream();
        const blob = new Blob(audioChunksRef.current, { type: recorder.mimeType || "audio/webm" });
        audioChunksRef.current = [];
        if (blob.size > 0) void transcribeBlob(blob);
        else setRecording("idle");
      };
      mediaRecorderRef.current = recorder;
      recorder.start();
      setRecording("recording");
    } catch (err: any) {
      stopMediaStream();
      setRecording("idle");
      toast({
        title: "Microphone unavailable",
        description: err?.name === "NotAllowedError"
          ? "Microphone permission was denied."
          : (err?.message || "Could not access the microphone."),
        variant: "destructive",
      });
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
  };

  const toggleRecording = () => {
    if (recording === "recording") stopRecording();
    else if (recording === "idle") void startRecording();
  };

  // Stop the mic if the modal unmounts mid-recording.
  useEffect(() => {
    return () => {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
        mediaRecorderRef.current.stop();
      }
      stopMediaStream();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Best-effort save if the tab/page is closing mid-edit.
  useEffect(() => {
    const handler = () => {
      if (!dirtyRef.current || isReadOnly) return;
      const payload = buildPayload("unfinished");
      const targetId = noteIdRef.current;
      if (targetId) {
        payload.autosave = true;
        if (pinOverride) payload.pin = pinOverride;
      }
      try {
        fetch(targetId ? `/api/daily-notes/${targetId}` : "/api/daily-notes", {
          method: targetId ? "PUT" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
          credentials: "include",
          keepalive: true,
        });
      } catch { /* best effort */ }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isReadOnly, pinOverride]);

  // Flush pending changes when the modal unmounts (e.g. navigation away).
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (dirtyRef.current && !isReadOnly) void runAutosave();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (debounceRef.current) { clearTimeout(debounceRef.current); debounceRef.current = null; }
      // If an autosave create is mid-flight, wait for its id so we update the
      // existing draft instead of creating a duplicate note for the same day.
      let waited = 0;
      while (creatingRef.current && waited < 5000) {
        await new Promise(r => setTimeout(r, 100));
        waited += 100;
      }
      const payload = buildPayload("finished");
      const targetId = noteIdRef.current;
      if (targetId) {
        if (pinOverride) payload.pin = pinOverride;
        return apiRequest("PUT", `/api/daily-notes/${targetId}`, payload);
      }
      return apiRequest("POST", "/api/daily-notes", payload);
    },
    onSuccess: () => {
      dirtyRef.current = false;
      setStatus("finished");
      setAutosaveStatus("idle");
      queryClient.invalidateQueries({ queryKey: ["/api/daily-notes"] });
      if (noteIdRef.current) queryClient.invalidateQueries({ queryKey: ["/api/daily-notes", noteIdRef.current] });
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
      scheduleAutosave();
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
    scheduleAutosave();
  };

  const removeEvent = (id: string) => {
    setEvents(prev => prev.filter(e => e.id !== id));
    scheduleAutosave();
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
    scheduleAutosave();
  };

  const removeParty = (refId: string, partyType: string) => {
    setParties(prev => prev.filter(p => !(p.refId === refId && p.partyType === partyType)));
    scheduleAutosave();
  };

  const partyTypeLabel: Record<string, string> = {
    person: "Person",
    group: "Group",
    social_account: "Account",
  };

  // Closing the modal flushes any pending autosave so nothing is lost.
  const handleOpenChange = (next: boolean) => {
    if (!next) flushAutosave();
    onOpenChange(next);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2" data-testid="text-daily-note-modal-title">
            {isReadOnly && <Lock className="h-4 w-4 text-muted-foreground" />}
            {`${formatModalTitleDate(date)} - Daily Note`}
            {!isReadOnly && status === "unfinished" && (
              <Badge variant="outline" className="ml-1 text-[10px] font-normal" data-testid="badge-draft-status">
                Unfinished
              </Badge>
            )}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-5">
          {/* Title */}
          <div className="space-y-1.5">
            <Label htmlFor="daily-note-title">Title</Label>
            <Input
              id="daily-note-title"
              value={userTitle}
              onChange={e => { setUserTitle(e.target.value); scheduleAutosave(); }}
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
                <div className="flex items-center gap-1">
                  <Button
                    type="button"
                    variant={recording === "recording" ? "destructive" : "ghost"}
                    size="sm"
                    onClick={toggleRecording}
                    disabled={showPreview || recording === "transcribing"}
                    data-testid="button-dictate-body"
                    title={recording === "recording" ? "Stop dictation" : "Dictate with your microphone"}
                  >
                    {recording === "transcribing" ? (
                      <><Loader2 className="h-3 w-3 mr-1 animate-spin" /> Transcribing…</>
                    ) : recording === "recording" ? (
                      <><Square className="h-3 w-3 mr-1 fill-current" /> Stop</>
                    ) : (
                      <><Mic className="h-3 w-3 mr-1" /> Dictate</>
                    )}
                  </Button>
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
                </div>
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
              <>
                <Textarea
                  ref={bodyRef}
                  value={body}
                  onChange={e => { setBody(e.target.value); scheduleAutosave(); }}
                  placeholder="Write your daily note in markdown..."
                  className="min-h-[8rem] font-mono text-sm resize-y"
                  disabled={isReadOnly}
                  data-testid="textarea-daily-note-body"
                />
                {recording === "recording" && (
                  <p className="flex items-center gap-1.5 text-xs text-destructive" data-testid="text-recording-indicator">
                    <span className="inline-block h-2 w-2 rounded-full bg-destructive animate-pulse" />
                    Recording… click Stop when finished.
                  </p>
                )}
              </>
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
        <div className="flex items-center justify-end gap-2 pt-2 border-t mt-2">
          {!isReadOnly && (
            <div className="mr-auto flex items-center text-xs text-muted-foreground" data-testid="text-autosave-status">
              {(autosaveStatus === "pending" || autosaveStatus === "saving") && (
                <><Loader2 className="h-3 w-3 mr-1 animate-spin" /> Saving draft…</>
              )}
              {autosaveStatus === "saved" && (
                <><Check className="h-3 w-3 mr-1 text-green-600" /> Draft saved</>
              )}
              {autosaveStatus === "error" && (
                <span className="flex items-center text-destructive">
                  <CloudOff className="h-3 w-3 mr-1" /> Autosave failed
                </span>
              )}
            </div>
          )}
          <Button variant="outline" onClick={() => handleOpenChange(false)} data-testid="button-daily-note-cancel">
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
