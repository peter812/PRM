import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import { Loader2, Mic, Square, SkipForward, PartyPopper, Plus, X, RotateCcw, Save, MessageSquareText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import type { Person } from "@shared/schema";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { getInitials } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { useDictation } from "@/hooks/use-dictation";

export default function DescribeMePage() {
  const { toast } = useToast();
  // People skipped this session; they come back after a reload.
  const [skipped, setSkipped] = useState<string[]>([]);
  const [transcript, setTranscript] = useState<string | null>(null);
  // Non-null while reviewing the extracted bullets.
  const [bullets, setBullets] = useState<string[] | null>(null);

  const { data: settings } = useQuery<{ whisperApiUrl?: string }>({ queryKey: ["/api/ollama/settings"] });
  const whisperConfigured = !!settings?.whisperApiUrl?.trim();

  const next = useQuery<{ person: Person | null }>({
    queryKey: [`/api/describe-me/next?exclude=${skipped.join(",")}`],
    gcTime: 0,
  });
  const person = next.data?.person ?? null;

  const extract = useMutation({
    mutationFn: async (text: string) => {
      const res = await apiRequest("POST", "/api/describe-me/extract", { personId: person!.id, transcript: text });
      return (await res.json()) as { bullets: string[] };
    },
    onSuccess: ({ bullets }) => setBullets(bullets),
    onError: (error: any) => toast({ title: "Couldn't extract bullet points", description: error.message, variant: "destructive" }),
  });

  const save = useMutation({
    mutationFn: async (bullets: string[]) => {
      await apiRequest("POST", "/api/describe-me/save", { personId: person!.id, bullets });
    },
    onSuccess: () => {
      toast({ title: "Note added", description: `Saved ${bullets?.length} bullet points for ${person!.firstName} ${person!.lastName}.` });
      queryClient.invalidateQueries({ queryKey: ["/api/people"] });
      queryClient.invalidateQueries({ queryKey: ["/api/notes"] });
      reset();
      next.refetch();
    },
    onError: (error: any) => toast({ title: "Couldn't save note", description: error.message, variant: "destructive" }),
  });

  const dictation = useDictation((text) => {
    if (!text) return toast({ title: "Nothing heard", description: "The recording came back empty. Try again.", variant: "destructive" });
    setTranscript(text);
    extract.mutate(text);
  });

  const reset = () => {
    setTranscript(null);
    setBullets(null);
  };

  const skip = () => {
    reset();
    setSkipped((prev) => [...prev, person!.id]);
  };

  // ── Render states ─────────────────────────────────────────────────────────

  if (next.isError) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 p-8">
        <MessageSquareText className="h-12 w-12 text-destructive" />
        <p className="text-lg font-medium">Something went wrong</p>
        <p className="text-sm text-muted-foreground text-center max-w-md">{next.error.message}</p>
        <Button onClick={() => next.refetch()} variant="outline">Try Again</Button>
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

  const busy = dictation.status !== "idle" || extract.isPending || save.isPending;
  const validBullets = (bullets ?? []).map((b) => b.trim()).filter(Boolean);

  return (
    <div className="flex flex-col items-center justify-center h-full p-4 md:p-8">
      <div className="w-full max-w-md space-y-6">
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>Describe Me</span>
          <span>{bullets ? "Check the bullet points" : "Tell me about this person"}</span>
        </div>

        <Card className="overflow-hidden">
          <CardContent className="flex flex-col items-center gap-4 p-8">
            <Avatar className="h-28 w-28">
              <AvatarImage src={person.imageUrl || undefined} alt={`${person.firstName} ${person.lastName}`} />
              <AvatarFallback className="text-2xl">{getInitials(person.firstName, person.lastName)}</AvatarFallback>
            </Avatar>
            <h2 className="text-2xl font-bold text-center">{person.firstName} {person.lastName}</h2>
            {(person.title || person.company) && (
              <p className="text-sm text-muted-foreground">{[person.title, person.company].filter(Boolean).join(" · ")}</p>
            )}
            {person.tags && person.tags.length > 0 && (
              <div className="flex flex-wrap gap-1 justify-center">
                {person.tags.map((tag) => <Badge key={tag} variant="secondary" className="text-xs">{tag}</Badge>)}
              </div>
            )}
          </CardContent>
        </Card>

        {bullets ? (
          <>
            <div className="space-y-2">
              {bullets.map((bullet, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="text-muted-foreground">•</span>
                  <Input
                    value={bullet}
                    onChange={(e) => setBullets(bullets.map((b, j) => (j === i ? e.target.value : b)))}
                    disabled={save.isPending}
                  />
                  <Button variant="ghost" size="icon" onClick={() => setBullets(bullets.filter((_, j) => j !== i))} disabled={save.isPending} title="Remove">
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ))}
              <Button variant="ghost" size="sm" onClick={() => setBullets([...bullets, ""])} disabled={save.isPending}>
                <Plus className="h-4 w-4 mr-1" /> Add bullet
              </Button>
            </div>
            {transcript && (
              <details className="text-sm text-muted-foreground">
                <summary className="cursor-pointer">Show transcript</summary>
                <p className="mt-2 whitespace-pre-wrap">{transcript}</p>
              </details>
            )}
            <div className="flex gap-3">
              <Button className="flex-1 h-14 text-base" onClick={() => save.mutate(validBullets)} disabled={save.isPending || validBullets.length === 0}>
                {save.isPending ? <Loader2 className="h-5 w-5 mr-2 animate-spin" /> : <Save className="h-5 w-5 mr-2" />}
                Save note
              </Button>
              <Button className="flex-1 h-14 text-base" variant="outline" onClick={reset} disabled={save.isPending}>
                <RotateCcw className="h-5 w-5 mr-2" /> Re-record
              </Button>
            </div>
          </>
        ) : !whisperConfigured ? (
          <p className="text-sm text-muted-foreground text-center">
            Describe Me needs a speech-to-text server. Set one up under{" "}
            <Link href="/settings/intelligence" className="underline">Settings → Intelligence</Link>.
          </p>
        ) : (
          <>
            <Button
              className="w-full h-14 text-base"
              variant={dictation.status === "recording" ? "destructive" : "default"}
              onClick={dictation.toggle}
              disabled={dictation.status === "transcribing" || extract.isPending}
            >
              {dictation.status === "recording" ? (
                <><Square className="h-5 w-5 mr-2 fill-current" /> Stop</>
              ) : dictation.status === "transcribing" ? (
                <><Loader2 className="h-5 w-5 mr-2 animate-spin" /> Transcribing…</>
              ) : extract.isPending ? (
                <><Loader2 className="h-5 w-5 mr-2 animate-spin" /> Extracting bullet points…</>
              ) : (
                <><Mic className="h-5 w-5 mr-2" /> Record</>
              )}
            </Button>
            {dictation.status === "recording" && (
              <p className="flex items-center justify-center gap-1.5 text-xs text-destructive">
                <span className="inline-block h-2 w-2 rounded-full bg-destructive animate-pulse" />
                Recording… click Stop when finished.
              </p>
            )}
            <Button className="w-full h-10 text-sm" variant="ghost" onClick={skip} disabled={busy}>
              <SkipForward className="h-4 w-4 mr-2" /> Skip for now
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
