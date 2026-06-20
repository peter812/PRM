import { useQuery, useMutation } from "@tanstack/react-query";
import { useState, useEffect, useCallback } from "react";
import { HelpCircle, Check, X, Loader2, PartyPopper } from "lucide-react";
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
  const [currentIndex, setCurrentIndex] = useState(0);
  const [loadingMessageIndex, setLoadingMessageIndex] = useState(0);
  const [answeredIds, setAnsweredIds] = useState<Set<string>>(new Set());

  const { data: queueData, isLoading, refetch } = useQuery<QueueResponse>({
    queryKey: ["/api/guess-sex/queue"],
  });

  // Cycle through loading messages
  useEffect(() => {
    if (isLoading || queueData?.status === "loading") {
      const interval = setInterval(() => {
        setLoadingMessageIndex((prev) => (prev + 1) % LOADING_MESSAGES.length);
      }, 3000);
      return () => clearInterval(interval);
    }
  }, [isLoading, queueData?.status]);

  const answerMutation = useMutation({
    mutationFn: async ({ queueItemId, correct }: { queueItemId: string; correct: boolean }) => {
      const res = await apiRequest("POST", "/api/guess-sex/answer", { queueItemId, correct });
      return res.json();
    },
    onSuccess: (data, variables) => {
      setAnsweredIds((prev) => new Set(prev).add(variables.queueItemId));
      toast({
        title: "Saved!",
        description: `Marked as ${data.sex}.`,
      });
      // Move to next person
      setCurrentIndex((prev) => prev + 1);
      // Invalidate people queries since sex was updated
      queryClient.invalidateQueries({ queryKey: ["/api/people"] });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleAnswer = useCallback(
    (queueItemId: string, correct: boolean) => {
      answerMutation.mutate({ queueItemId, correct });
    },
    [answerMutation]
  );

  // Filter out already-answered items from local state
  const pendingItems = (queueData?.queue ?? []).filter((item) => !answeredIds.has(item.id));
  const currentItem = pendingItems[currentIndex] ?? null;
  const allDone = queueData?.status === "ready" && pendingItems.length === 0;
  const isEmpty = queueData?.status === "empty";

  // Loading state
  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 p-8">
        <Loader2 className="h-12 w-12 animate-spin text-muted-foreground" />
        <p className="text-lg text-muted-foreground animate-pulse">
          {LOADING_MESSAGES[loadingMessageIndex]}
        </p>
      </div>
    );
  }

  // Error state
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

  // Empty state - no unknown people
  if (isEmpty) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 p-8">
        <PartyPopper className="h-12 w-12 text-muted-foreground" />
        <p className="text-lg text-muted-foreground">
          {queueData?.message || "No people with unknown sex found."}
        </p>
      </div>
    );
  }

  // All done state
  if (allDone || (!currentItem && !isLoading)) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 p-8">
        <PartyPopper className="h-12 w-12 text-primary" />
        <h2 className="text-2xl font-bold">Looks like you're finished!</h2>
        <p className="text-muted-foreground">Come back later for more.</p>
        <Button
          onClick={() => {
            setCurrentIndex(0);
            setAnsweredIds(new Set());
            refetch();
          }}
          variant="outline"
        >
          Refresh Queue
        </Button>
      </div>
    );
  }

  if (!currentItem) return null;

  const person = currentItem.person;
  const guessLabel = currentItem.guessedSex === "male" ? "Male" : "Female";
  const oppositeLabel = currentItem.guessedSex === "male" ? "Female" : "Male";
  const remaining = pendingItems.length - currentIndex;

  return (
    <div className="flex flex-col items-center justify-center h-full p-4 md:p-8">
      <div className="w-full max-w-md space-y-6">
        {/* Progress indicator */}
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>Guess the Sex</span>
          <span>{remaining} remaining</span>
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

        {/* Action Buttons */}
        <div className="flex gap-3">
          <Button
            className="flex-1 h-14 text-base"
            variant="default"
            onClick={() => handleAnswer(currentItem.id, true)}
            disabled={answerMutation.isPending}
          >
            <Check className="h-5 w-5 mr-2" />
            {guessLabel}
          </Button>
          <Button
            className="flex-1 h-14 text-base"
            variant="outline"
            onClick={() => handleAnswer(currentItem.id, false)}
            disabled={answerMutation.isPending}
          >
            <X className="h-5 w-5 mr-2" />
            Incorrect ({oppositeLabel})
          </Button>
        </div>

        {queueData?.error && (
          <p className="text-xs text-amber-500 text-center">{queueData.error}</p>
        )}
      </div>
    </div>
  );
}
