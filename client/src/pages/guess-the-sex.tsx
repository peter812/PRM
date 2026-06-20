import { useQuery, useMutation } from "@tanstack/react-query";
import { useState, useEffect, useCallback, useRef } from "react";
import { HelpCircle, Check, X, Loader2, PartyPopper, Clock, Ban } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import type { Person } from "@shared/schema";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { getInitials } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";

type QueueItem = {
  id: string;
  personId: string;
  guessedSex: string;
  reasoning: string;
  dateAdded: string;
  answered: number;
  snoozedUntil?: string | null;
  person: Person;
};

type QueueResponse = {
  status: "ready" | "loading" | "empty" | "error";
  queue: QueueItem[];
  message?: string;
  error?: string;
};

const LOADING_MESSAGES = [
  "Getting things ready for you...",
  "Preparing the gender reveal party...",
  "Making sure I checked right...",
  "Consulting the oracle...",
  "Analyzing names and profiles...",
];

export default function GuessTheSex() {
  const { toast } = useToast();
  const [seenPersonIds, setSeenPersonIds] = useState<Set<string>>(new Set());
  const [loadingMessageIndex, setLoadingMessageIndex] = useState(0);
  // Prevent firing the prefetch more than once per batch
  const prefetchTriggered = useRef(false);

  const { data: queueData, isLoading, isError, error, refetch } = useQuery<QueueResponse, Error>({
    queryKey: ["/api/guess-sex/queue"],
  });

  // Cycle through loading messages while waiting
  useEffect(() => {
    if (isLoading || queueData?.status === "loading") {
      const interval = setInterval(() => {
        setLoadingMessageIndex((prev) => (prev + 1) % LOADING_MESSAGES.length);
      }, 3000);
      return () => clearInterval(interval);
    }
  }, [isLoading, queueData?.status]);

  // ── Mutations ─────────────────────────────────────────────────────────────

  const advanceAfterAction = useCallback((personId: string) => {
    setSeenPersonIds((prev) => {
      const next = new Set(prev);
      next.add(personId);
      return next;
    });
  }, []);

  const answerMutation = useMutation({
    mutationFn: async ({ queueItemId, correct }: { queueItemId: string; correct: boolean }) => {
      const res = await apiRequest("POST", "/api/guess-sex/answer", { queueItemId, correct });
      return res.json();
    },
    onSuccess: (data, variables) => {
      toast({ title: "Saved!", description: `Marked as ${data.sex}.` });
      advanceAfterAction(currentItem!.personId);
      queryClient.invalidateQueries({ queryKey: ["/api/people"] });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const skipTempMutation = useMutation({
    mutationFn: async (queueItemId: string) => {
      const res = await apiRequest("POST", "/api/guess-sex/skip-temp", { queueItemId });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Snoozed", description: "We'll ask again in 1 day." });
      advanceAfterAction(currentItem!.personId);
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const skipPermMutation = useMutation({
    mutationFn: async (queueItemId: string) => {
      const res = await apiRequest("POST", "/api/guess-sex/skip-perm", { queueItemId });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Skipped", description: "This person won't appear again." });
      advanceAfterAction(currentItem!.personId);
      queryClient.invalidateQueries({ queryKey: ["/api/people"] });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const isBusy = answerMutation.isPending || skipTempMutation.isPending || skipPermMutation.isPending;

  // ── Derived state ─────────────────────────────────────────────────────────

  // Filter out anyone already seen this session
  const pendingItems = (queueData?.queue ?? []).filter(
    (item) => !seenPersonIds.has(item.personId)
  );

  const currentItem = pendingItems[0] ?? null;
  const isEmpty = queueData?.status === "empty";

  // We've worked through the local batch — fetch the next one
  const batchExhausted =
    !isLoading &&
    queueData?.status === "ready" &&
    pendingItems.length === 0 &&
    (queueData?.queue ?? []).length > 0;

  useEffect(() => {
    if (batchExhausted) {
      prefetchTriggered.current = false;
      refetch();
    }
  }, [batchExhausted, refetch]);

  // Compute remaining here (before early returns) so the prefetch effect can use it
  const remaining = pendingItems.length;

  // When 9 items or fewer remain, silently prefetch the next batch from the LLM
  useEffect(() => {
    if (
      !prefetchTriggered.current &&
      queueData?.status === "ready" &&
      remaining > 0 &&
      remaining <= 9
    ) {
      prefetchTriggered.current = true;
      fetch("/api/guess-sex/prefetch", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
      })
        .then((res) => res.json())
        .then((data) => {
          if (data.generated > 0) {
            // LLM generated more items — refresh the queue
            queryClient.invalidateQueries({ queryKey: ["/api/guess-sex/queue"] });
            prefetchTriggered.current = false;
          }
        })
        .catch(() => {}); // ignore errors silently
    }
  }, [remaining, queueData?.status]);

  // ── Render states ─────────────────────────────────────────────────────────

  if (isError) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 p-8">
        <HelpCircle className="h-12 w-12 text-destructive" />
        <p className="text-lg font-medium">Something went wrong</p>
        <p className="text-sm text-muted-foreground text-center max-w-md">
          {error?.message ?? "Unknown error"}
        </p>
        <Button onClick={() => refetch()} variant="outline">
          Try Again
        </Button>
      </div>
    );
  }

  // Loading — initial fetch or waiting on LLM
  if (isLoading || !queueData) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 p-8">
        <Loader2 className="h-12 w-12 animate-spin text-muted-foreground" />
        <p className="text-lg text-muted-foreground animate-pulse">
          {LOADING_MESSAGES[loadingMessageIndex]}
        </p>
        <p className="text-sm text-muted-foreground">
          Asking the AI to guess — this may take a moment...
        </p>
      </div>
    );
  }

  // Server-side error with partial queue
  if (queueData?.status === "error" && (!queueData.queue || queueData.queue.length === 0)) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 p-8">
        <HelpCircle className="h-12 w-12 text-muted-foreground" />
        <p className="text-lg text-muted-foreground">{queueData.error}</p>
        <Button onClick={() => refetch()} variant="outline">
          Try Again
        </Button>
      </div>
    );
  }

  // Fetching next batch after exhausting current one
  if (batchExhausted) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 p-8">
        <Loader2 className="h-12 w-12 animate-spin text-muted-foreground" />
        <p className="text-lg text-muted-foreground animate-pulse">Loading more people...</p>
      </div>
    );
  }

  // Server confirmed no more unknown-sex people
  if (isEmpty) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 p-8">
        <PartyPopper className="h-12 w-12 text-primary" />
        <h2 className="text-2xl font-bold">Looks like you're finished!</h2>
        <p className="text-muted-foreground">Come back later for more.</p>
        <Button
          onClick={() => {
            setSeenPersonIds(new Set());
            refetch();
          }}
          variant="outline"
        >
          Refresh Queue
        </Button>
      </div>
    );
  }

  // No current item — LLM generating
  if (!currentItem) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 p-8">
        <Loader2 className="h-12 w-12 animate-spin text-muted-foreground" />
        <p className="text-lg text-muted-foreground animate-pulse">
          Asking the AI to guess — this may take a moment...
        </p>
      </div>
    );
  }

  // ── Main card ─────────────────────────────────────────────────────────────

  const person = currentItem.person;
  const guessLabel = currentItem.guessedSex === "male" ? "Male" : "Female";
  const oppositeLabel = currentItem.guessedSex === "male" ? "Female" : "Male";
  return (
    <div className="flex flex-col items-center justify-center h-full p-4 md:p-8">
      <div className="w-full max-w-md space-y-6">
        {/* Progress indicator */}
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>Guess the Sex</span>
          <span>{remaining} remaining in batch</span>
        </div>

        {/* Person Card */}
        <Card className="overflow-hidden">
          <CardContent className="flex flex-col items-center gap-4 p-8">
            <Avatar className="h-28 w-28">
              <AvatarImage src={person.imageUrl || undefined} alt={`${person.firstName} ${person.lastName}`} />
              <AvatarFallback className="text-2xl">
                {getInitials(`${person.firstName} ${person.lastName}`)}
              </AvatarFallback>
            </Avatar>

            <h2 className="text-2xl font-bold text-center">
              {person.firstName} {person.lastName}
            </h2>

            {person.company && (
              <p className="text-sm text-muted-foreground">{person.company}</p>
            )}

            {person.tags && person.tags.length > 0 && (
              <div className="flex flex-wrap gap-1 justify-center">
                {person.tags.map((tag) => (
                  <Badge key={tag} variant="secondary" className="text-xs">
                    {tag}
                  </Badge>
                ))}
              </div>
            )}

            {/* LLM reasoning */}
            <p className="text-xs text-muted-foreground italic text-center mt-2">
              "{currentItem.reasoning}"
            </p>
          </CardContent>
        </Card>

        {/* Confirm buttons */}
        <div className="flex gap-3">
          <Button
            className="flex-1 h-14 text-base"
            variant="default"
            onClick={() => answerMutation.mutate({ queueItemId: currentItem.id, correct: true })}
            disabled={isBusy}
          >
            <Check className="h-5 w-5 mr-2" />
            {guessLabel}
          </Button>
          <Button
            className="flex-1 h-14 text-base"
            variant="outline"
            onClick={() => answerMutation.mutate({ queueItemId: currentItem.id, correct: false })}
            disabled={isBusy}
          >
            <X className="h-5 w-5 mr-2" />
            {oppositeLabel}
          </Button>
        </div>

        {/* Skip buttons */}
        <div className="flex gap-3">
          <Button
            className="flex-1 h-10 text-sm"
            variant="ghost"
            onClick={() => skipTempMutation.mutate(currentItem.id)}
            disabled={isBusy}
            title="Hide for 1 day, then show again"
          >
            <Clock className="h-4 w-4 mr-1.5" />
            Skip (1 Day)
          </Button>
          <Button
            className="flex-1 h-10 text-sm"
            variant="ghost"
            onClick={() => skipPermMutation.mutate(currentItem.id)}
            disabled={isBusy}
            title="Never ask about this person again"
          >
            <Ban className="h-4 w-4 mr-1.5" />
            Skip (Never)
          </Button>
        </div>

        {queueData?.error && (
          <p className="text-xs text-amber-500 text-center">{queueData.error}</p>
        )}
      </div>
    </div>
  );
}
