import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  Loader2,
  Mic,
  Square,
  SkipForward,
  PartyPopper,
  Plus,
  X,
  RotateCcw,
  Save,
  MessageSquareText,
  Tag as TagIcon,
  Calendar,
  NotebookPen,
  Check,
  CheckSquare,
  Sparkles,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type {
  Person,
  PotentialInteraction,
  PotentialNote,
  PotentialTag,
  DescribeMeExtractionResult,
  ApplyDescribeMeInput,
} from "@shared/schema";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { getInitials } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { useDictation } from "@/hooks/use-dictation";
import { useAudioDevices } from "@/hooks/use-audio-devices";

export default function DescribeMePage() {
  const { toast } = useToast();
  // People skipped this session; they come back after a reload.
  const [skipped, setSkipped] = useState<string[]>([]);
  const [transcript, setTranscript] = useState<string | null>(null);

  // Extracted proposals from LLM hooks
  const [potentialInteractions, setPotentialInteractions] = useState<PotentialInteraction[]>([]);
  const [potentialNotes, setPotentialNotes] = useState<PotentialNote[]>([]);
  const [potentialTags, setPotentialTags] = useState<PotentialTag[]>([]);

  // Local state for adding a new tag
  const [newTagInput, setNewTagInput] = useState("");
  const [isAddingTag, setIsAddingTag] = useState(false);

  const { data: settings } = useQuery<{ whisperSource?: "prm-compute" | "external" | null }>({
    queryKey: ["/api/ollama/settings"],
  });
  const whisperConfigured = !!settings?.whisperSource;

  const next = useQuery<{ person: Person | null }>({
    queryKey: [`/api/describe-me/next?exclude=${skipped.join(",")}`],
    gcTime: 0,
  });
  const person = next.data?.person ?? null;

  const extract = useMutation({
    mutationFn: async (text: string) => {
      const res = await apiRequest("POST", "/api/describe-me/extract", {
        personId: person!.id,
        transcript: text,
      });
      return (await res.json()) as DescribeMeExtractionResult;
    },
    onSuccess: (data) => {
      setPotentialInteractions(data.potentialInteractions || []);
      setPotentialNotes(data.potentialNotes || []);
      setPotentialTags(data.potentialTags || []);

      const count =
        (data.potentialInteractions?.length || 0) +
        (data.potentialNotes?.length || 0) +
        (data.potentialTags?.length || 0);

      if (count === 0) {
        toast({
          title: "Nothing detected",
          description: "The AI didn't detect specific notes, interactions, or tags. You can add them manually or re-record.",
        });
      }
    },
    onError: (error: any) =>
      toast({
        title: "Couldn't extract details",
        description: error.message,
        variant: "destructive",
      }),
  });

  const apply = useMutation({
    mutationFn: async () => {
      const payload: ApplyDescribeMeInput = {
        personId: person!.id,
        notes: potentialNotes
          .filter((n) => n.selected && n.content.trim())
          .map((n) => ({
            title: n.title,
            content: n.content.trim(),
          })),
        interactions: potentialInteractions
          .filter((i) => i.selected && (i.title.trim() || i.description.trim()))
          .map((i) => ({
            title: i.title.trim() || undefined,
            date: i.date,
            description: i.description.trim() || undefined,
            type: i.type,
          })),
        tags: potentialTags
          .filter((t) => t.selected && t.tag.trim())
          .map((t) => t.tag.trim()),
      };

      const res = await apiRequest("POST", "/api/describe-me/apply", payload);
      return await res.json();
    },
    onSuccess: (data: any) => {
      const { applied } = data || {};
      const parts: string[] = [];
      if (applied?.notes) parts.push(`${applied.notes} note${applied.notes > 1 ? "s" : ""}`);
      if (applied?.interactions) parts.push(`${applied.interactions} interaction${applied.interactions > 1 ? "s" : ""}`);
      if (applied?.tags) parts.push(`${applied.tags} tag${applied.tags > 1 ? "s" : ""}`);
      const summary = parts.length > 0 ? parts.join(", ") : "changes";

      toast({
        title: "Profile updated",
        description: `Applied ${summary} to ${person!.firstName} ${person!.lastName}.`,
      });

      queryClient.invalidateQueries({ queryKey: ["/api/people"] });
      queryClient.invalidateQueries({ queryKey: ["/api/notes"] });
      queryClient.invalidateQueries({ queryKey: ["/api/interactions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/me"] });

      reset();
      next.refetch();
    },
    onError: (error: any) =>
      toast({
        title: "Couldn't apply changes",
        description: error.message,
        variant: "destructive",
      }),
  });

  const { devices, selectedDeviceId, setSelectedDeviceId, refreshDevices } = useAudioDevices();

  const dictation = useDictation(
    (text) => {
      if (!text) {
        return toast({
          title: "Nothing heard",
          description: "The recording came back empty. Try again.",
          variant: "destructive",
        });
      }
      setTranscript(text);
      extract.mutate(text);
    },
    {
      deviceId: selectedDeviceId,
      onPermissionGranted: refreshDevices,
    }
  );

  const reset = () => {
    setTranscript(null);
    setPotentialInteractions([]);
    setPotentialNotes([]);
    setPotentialTags([]);
    setNewTagInput("");
    setIsAddingTag(false);
  };

  const skip = () => {
    reset();
    setSkipped((prev) => [...prev, person!.id]);
  };

  // ── Selection helpers ──────────────────────────────────────────────────────

  const hasProposals =
    potentialInteractions.length > 0 || potentialNotes.length > 0 || potentialTags.length > 0;

  const selectedInteractionsCount = potentialInteractions.filter((i) => i.selected).length;
  const selectedNotesCount = potentialNotes.filter((n) => n.selected).length;
  const selectedTagsCount = potentialTags.filter((t) => t.selected).length;

  const totalItems = potentialInteractions.length + potentialNotes.length + potentialTags.length;
  const totalSelected = selectedInteractionsCount + selectedNotesCount + selectedTagsCount;
  const allSelected = totalItems > 0 && totalSelected === totalItems;

  const toggleSelectAll = (select: boolean) => {
    setPotentialInteractions((prev) => prev.map((i) => ({ ...i, selected: select })));
    setPotentialNotes((prev) => prev.map((n) => ({ ...n, selected: select })));
    setPotentialTags((prev) => prev.map((t) => ({ ...t, selected: select })));
  };

  const toggleTag = (id: string) => {
    setPotentialTags((prev) =>
      prev.map((t) => (t.id === id ? { ...t, selected: !t.selected } : t))
    );
  };

  const removeTag = (id: string) => {
    setPotentialTags((prev) => prev.filter((t) => t.id !== id));
  };

  const addNewTag = () => {
    const trimmed = newTagInput.trim().toLowerCase();
    if (!trimmed) {
      setIsAddingTag(false);
      return;
    }
    if (!potentialTags.some((t) => t.tag.toLowerCase() === trimmed)) {
      setPotentialTags((prev) => [
        ...prev,
        {
          id: `custom_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          tag: trimmed,
          selected: true,
        },
      ]);
    }
    setNewTagInput("");
    setIsAddingTag(false);
  };

  const toggleNote = (id: string) => {
    setPotentialNotes((prev) =>
      prev.map((n) => (n.id === id ? { ...n, selected: !n.selected } : n))
    );
  };

  const updateNoteContent = (id: string, content: string) => {
    setPotentialNotes((prev) =>
      prev.map((n) => (n.id === id ? { ...n, content } : n))
    );
  };

  const removeNote = (id: string) => {
    setPotentialNotes((prev) => prev.filter((n) => n.id !== id));
  };

  const addBlankNote = () => {
    setPotentialNotes((prev) => [
      ...prev,
      {
        id: `custom_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        content: "",
        selected: true,
      },
    ]);
  };

  const toggleInteraction = (id: string) => {
    setPotentialInteractions((prev) =>
      prev.map((i) => (i.id === id ? { ...i, selected: !i.selected } : i))
    );
  };

  const updateInteraction = (id: string, patch: Partial<PotentialInteraction>) => {
    setPotentialInteractions((prev) =>
      prev.map((i) => (i.id === id ? { ...i, ...patch } : i))
    );
  };

  const removeInteraction = (id: string) => {
    setPotentialInteractions((prev) => prev.filter((i) => i.id !== id));
  };

  const addBlankInteraction = () => {
    setPotentialInteractions((prev) => [
      ...prev,
      {
        id: `custom_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        title: "Interaction",
        date: new Date().toISOString().split("T")[0],
        description: "",
        selected: true,
      },
    ]);
  };

  // ── Render states ─────────────────────────────────────────────────────────

  if (next.isError) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 p-8">
        <MessageSquareText className="h-12 w-12 text-destructive" />
        <p className="text-lg font-medium">Something went wrong</p>
        <p className="text-sm text-muted-foreground text-center max-w-md">{next.error.message}</p>
        <Button onClick={() => next.refetch()} variant="outline">
          Try Again
        </Button>
      </div>
    );
  }

  if (next.isLoading) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 p-8">
        <Loader2 className="h-12 w-12 animate-spin text-muted-foreground" />
        <p className="text-lg text-muted-foreground animate-pulse">Picking someone...</p>
      </div>
    );
  }

  if (!person) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 p-8">
        <PartyPopper className="h-12 w-12 text-primary" />
        <h2 className="text-2xl font-bold">Everyone's been described</h2>
        <p className="text-muted-foreground text-center max-w-md">
          {skipped.length > 0
            ? "Only people you skipped this session are left. Reload to get them back."
            : "Each person can be described once every 90 days. Come back later."}
        </p>
      </div>
    );
  }

  const busy = dictation.status !== "idle" || extract.isPending || apply.isPending;

  return (
    <div className="flex flex-col items-center justify-center min-h-full p-4 md:p-8">
      <div className="w-full max-w-2xl space-y-6">
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span className="font-semibold text-foreground flex items-center gap-1.5">
            <Sparkles className="h-4 w-4 text-primary" /> Describe Me
          </span>
          <span>{hasProposals ? "Review suggestions" : "Tell me about this person"}</span>
        </div>

        {/* Contact Profile Overview Card */}
        <Card className="overflow-hidden shadow-sm">
          <CardContent className="flex flex-col items-center gap-3 p-6">
            <Avatar className="h-24 w-24 border-2 border-border shadow-sm">
              <AvatarImage
                src={person.imageUrl || undefined}
                alt={`${person.firstName} ${person.lastName}`}
              />
              <AvatarFallback className="text-xl">
                {getInitials(person.firstName, person.lastName)}
              </AvatarFallback>
            </Avatar>
            <div className="text-center">
              <h2 className="text-2xl font-bold">
                {person.firstName} {person.lastName}
              </h2>
              {(person.title || person.company) && (
                <p className="text-sm text-muted-foreground mt-0.5">
                  {[person.title, person.company].filter(Boolean).join(" · ")}
                </p>
              )}
            </div>
            {person.tags && person.tags.length > 0 && (
              <div className="flex flex-wrap gap-1.5 justify-center max-w-md">
                {person.tags.map((tag) => (
                  <Badge key={tag} variant="secondary" className="text-xs">
                    {tag}
                  </Badge>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* PROPOSALS REVIEW STATE */}
        {hasProposals ? (
          <div className="space-y-6">
            {/* Master Select Bar */}
            <div className="flex items-center justify-between border-b pb-3">
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold">Suggested Updates</span>
                <Badge variant="outline" className="text-xs">
                  {totalSelected} of {totalItems} selected
                </Badge>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="text-xs h-8"
                onClick={() => toggleSelectAll(!allSelected)}
                disabled={apply.isPending}
              >
                <CheckSquare className="h-3.5 w-3.5 mr-1.5" />
                {allSelected ? "Deselect all" : "Select all"}
              </Button>
            </div>

            {/* 1. Potential Tags Section */}
            <div className="space-y-2.5">
              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                  <TagIcon className="h-3.5 w-3.5 text-primary" />
                  Potential Tags ({selectedTagsCount}/{potentialTags.length})
                </label>
              </div>

              <div className="flex flex-wrap items-center gap-2 p-3 rounded-lg border bg-card">
                {potentialTags.length === 0 && !isAddingTag && (
                  <span className="text-xs text-muted-foreground italic">No tags proposed.</span>
                )}
                {potentialTags.map((tag) => (
                  <Badge
                    key={tag.id}
                    variant={tag.selected ? "default" : "outline"}
                    className={`cursor-pointer select-none transition-all py-1 px-2.5 flex items-center gap-1.5 text-xs ${
                      tag.selected ? "" : "opacity-60 line-through bg-muted/30"
                    }`}
                    onClick={() => toggleTag(tag.id)}
                  >
                    {tag.selected && <Check className="h-3 w-3" />}
                    <span>{tag.tag}</span>
                    <button
                      type="button"
                      className="ml-1 hover:text-destructive p-0.5 rounded-full"
                      onClick={(e) => {
                        e.stopPropagation();
                        removeTag(tag.id);
                      }}
                      title="Remove tag"
                      disabled={apply.isPending}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                ))}

                {isAddingTag ? (
                  <div className="flex items-center gap-1.5">
                    <Input
                      className="h-7 w-28 text-xs"
                      placeholder="tag name"
                      value={newTagInput}
                      onChange={(e) => setNewTagInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          addNewTag();
                        } else if (e.key === "Escape") {
                          setIsAddingTag(false);
                          setNewTagInput("");
                        }
                      }}
                      autoFocus
                    />
                    <Button size="icon" variant="ghost" className="h-7 w-7" onClick={addNewTag}>
                      <Check className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7"
                      onClick={() => {
                        setIsAddingTag(false);
                        setNewTagInput("");
                      }}
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs border-dashed"
                    onClick={() => setIsAddingTag(true)}
                    disabled={apply.isPending}
                  >
                    <Plus className="h-3 w-3 mr-1" /> Add tag
                  </Button>
                )}
              </div>
            </div>

            {/* 2. Potential Notes Section */}
            <div className="space-y-2.5">
              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                  <NotebookPen className="h-3.5 w-3.5 text-primary" />
                  Potential Notes ({selectedNotesCount}/{potentialNotes.length})
                </label>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-xs h-7"
                  onClick={addBlankNote}
                  disabled={apply.isPending}
                >
                  <Plus className="h-3 w-3 mr-1" /> Add note
                </Button>
              </div>

              {potentialNotes.length === 0 ? (
                <div className="p-3 rounded-lg border bg-muted/20 text-xs text-muted-foreground italic text-center">
                  No notes proposed.
                </div>
              ) : (
                <div className="space-y-3">
                  {potentialNotes.map((note) => (
                    <Card
                      key={note.id}
                      className={`transition-colors border ${
                        note.selected ? "border-primary/40 bg-card" : "opacity-60 bg-muted/20"
                      }`}
                    >
                      <CardContent className="p-3.5 space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <Checkbox
                              id={`note-${note.id}`}
                              checked={note.selected}
                              onCheckedChange={() => toggleNote(note.id)}
                              disabled={apply.isPending}
                            />
                            <label
                              htmlFor={`note-${note.id}`}
                              className="text-xs font-medium cursor-pointer text-muted-foreground"
                            >
                              Include in profile note
                            </label>
                          </div>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-muted-foreground hover:text-destructive"
                            onClick={() => removeNote(note.id)}
                            disabled={apply.isPending}
                            title="Remove note"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                        <Textarea
                          value={note.content}
                          onChange={(e) => updateNoteContent(note.id, e.target.value)}
                          placeholder="Note content..."
                          disabled={apply.isPending}
                          className="text-sm min-h-[72px] resize-y"
                        />
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </div>

            {/* 3. Potential Interactions Section */}
            <div className="space-y-2.5">
              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                  <Calendar className="h-3.5 w-3.5 text-primary" />
                  Potential Interactions ({selectedInteractionsCount}/{potentialInteractions.length})
                </label>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-xs h-7"
                  onClick={addBlankInteraction}
                  disabled={apply.isPending}
                >
                  <Plus className="h-3 w-3 mr-1" /> Add interaction
                </Button>
              </div>

              {potentialInteractions.length === 0 ? (
                <div className="p-3 rounded-lg border bg-muted/20 text-xs text-muted-foreground italic text-center">
                  No interactions proposed.
                </div>
              ) : (
                <div className="space-y-3">
                  {potentialInteractions.map((interaction) => (
                    <Card
                      key={interaction.id}
                      className={`transition-colors border ${
                        interaction.selected ? "border-primary/40 bg-card" : "opacity-60 bg-muted/20"
                      }`}
                    >
                      <CardContent className="p-3.5 space-y-2.5">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <Checkbox
                              id={`int-${interaction.id}`}
                              checked={interaction.selected}
                              onCheckedChange={() => toggleInteraction(interaction.id)}
                              disabled={apply.isPending}
                            />
                            <label
                              htmlFor={`int-${interaction.id}`}
                              className="text-xs font-medium cursor-pointer text-muted-foreground"
                            >
                              Include in interactions
                            </label>
                          </div>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-muted-foreground hover:text-destructive"
                            onClick={() => removeInteraction(interaction.id)}
                            disabled={apply.isPending}
                            title="Remove interaction"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          <div>
                            <Input
                              value={interaction.title}
                              onChange={(e) =>
                                updateInteraction(interaction.id, { title: e.target.value })
                              }
                              placeholder="Title (e.g. Lunch at Cafe)"
                              disabled={apply.isPending}
                              className="text-xs h-8"
                            />
                          </div>
                          <div>
                            <Input
                              type="date"
                              value={interaction.date.split("T")[0]}
                              onChange={(e) =>
                                updateInteraction(interaction.id, { date: e.target.value })
                              }
                              disabled={apply.isPending}
                              className="text-xs h-8"
                            />
                          </div>
                        </div>

                        <Textarea
                          value={interaction.description}
                          onChange={(e) =>
                            updateInteraction(interaction.id, { description: e.target.value })
                          }
                          placeholder="Details of what was discussed or happened..."
                          disabled={apply.isPending}
                          className="text-xs min-h-[56px] resize-y"
                        />
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </div>

            {/* Collapsible Transcript */}
            {transcript && (
              <details className="text-xs text-muted-foreground rounded-lg border p-3 bg-muted/20">
                <summary className="cursor-pointer font-medium hover:text-foreground">
                  Show spoken transcript
                </summary>
                <p className="mt-2 whitespace-pre-wrap text-foreground/80 leading-relaxed font-mono text-[11px] bg-background/50 p-2.5 rounded border">
                  {transcript}
                </p>
              </details>
            )}

            {/* Action Buttons */}
            <div className="flex flex-col sm:flex-row gap-3 pt-2">
              <Button
                className="flex-1 h-12 text-base font-medium"
                onClick={() => apply.mutate()}
                disabled={apply.isPending || totalSelected === 0}
              >
                {apply.isPending ? (
                  <Loader2 className="h-5 w-5 mr-2 animate-spin" />
                ) : (
                  <Save className="h-5 w-5 mr-2" />
                )}
                {totalSelected > 0
                  ? `Apply Selected (${totalSelected})`
                  : "Select items to apply"}
              </Button>
              <Button
                className="sm:w-36 h-12 text-base"
                variant="outline"
                onClick={reset}
                disabled={apply.isPending}
              >
                <RotateCcw className="h-4 w-4 mr-2" /> Re-record
              </Button>
            </div>
          </div>
        ) : !whisperConfigured ? (
          <p className="text-sm text-muted-foreground text-center">
            Describe Me needs speech-to-text. Connect PRM-Compute under{" "}
            <Link href="/settings/recognition" className="underline">
              Settings → Recognition
            </Link>
            , or set a Whisper server URL under{" "}
            <Link href="/settings/intelligence" className="underline">
              Settings → Intelligence
            </Link>
            .
          </p>
        ) : (
          /* RECORDING STATE */
          <>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                <Mic className="h-3.5 w-3.5" />
                Microphone
              </label>
              <Select
                value={selectedDeviceId}
                onValueChange={setSelectedDeviceId}
                disabled={busy}
              >
                <SelectTrigger
                  className="w-full text-xs h-9"
                  aria-label="Select audio input device"
                >
                  <SelectValue placeholder="Select microphone" />
                </SelectTrigger>
                <SelectContent>
                  {devices.map((device) => (
                    <SelectItem
                      key={device.deviceId}
                      value={device.deviceId}
                      className="text-xs"
                    >
                      {device.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="relative w-full">
              {dictation.status === "recording" && (
                <div
                  className="absolute -inset-0.5 rounded-md bg-destructive transition-all duration-75 pointer-events-none"
                  style={{
                    opacity:
                      dictation.audioLevel > 0.05
                        ? Math.min(0.6, 0.2 + dictation.audioLevel * 0.5)
                        : 0,
                    transform: `scale(${1 + dictation.audioLevel * 0.05})`,
                    filter: "blur(6px)",
                  }}
                />
              )}
              <Button
                className="relative w-full h-14 text-base font-medium"
                variant={dictation.status === "recording" ? "destructive" : "default"}
                onClick={dictation.toggle}
                disabled={dictation.status === "transcribing" || extract.isPending}
              >
                {dictation.status === "recording" ? (
                  <>
                    <Square className="h-5 w-5 mr-2 fill-current" /> Stop recording
                  </>
                ) : dictation.status === "transcribing" ? (
                  <>
                    <Loader2 className="h-5 w-5 mr-2 animate-spin" /> Transcribing…
                  </>
                ) : extract.isPending ? (
                  <>
                    <Loader2 className="h-5 w-5 mr-2 animate-spin" /> Extracting details with AI…
                  </>
                ) : (
                  <>
                    <Mic className="h-5 w-5 mr-2" /> Start recording
                  </>
                )}
              </Button>
            </div>

            {dictation.status === "recording" && (
              <div className="flex flex-col items-center justify-center gap-1.5 py-1">
                <div className="flex items-center justify-center gap-1 h-6">
                  {[0.5, 0.8, 1.2, 0.7, 1.0].map((multiplier, i) => {
                    const height = Math.max(
                      4,
                      Math.min(24, Math.round(dictation.audioLevel * 24 * multiplier))
                    );
                    return (
                      <span
                        key={i}
                        className="w-1 rounded-full bg-destructive transition-all duration-75 ease-out"
                        style={{
                          height: `${height}px`,
                          opacity: dictation.audioLevel > 0.04 ? 0.95 : 0.35,
                        }}
                      />
                    );
                  })}
                </div>
                <p className="flex items-center justify-center gap-2 text-xs text-destructive font-medium">
                  <span
                    className="inline-block h-2 w-2 rounded-full bg-destructive transition-transform duration-75"
                    style={{
                      transform: `scale(${1 + dictation.audioLevel * 1.5})`,
                    }}
                  />
                  {dictation.audioLevel > 0.05
                    ? "Hearing you speak…"
                    : "Listening… click Stop when finished"}
                </p>
              </div>
            )}

            <Button
              className="w-full h-10 text-sm"
              variant="ghost"
              onClick={skip}
              disabled={busy}
            >
              <SkipForward className="h-4 w-4 mr-2" /> Skip for now
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

