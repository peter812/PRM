import { useQuery, useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { Trophy, RefreshCw, ArrowLeft, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import type { Person } from "@shared/schema";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

export default function EloRanking() {
  const { toast } = useToast();
  const [isVoting, setIsVoting] = useState(false);

  const {
    data: pair,
    isLoading,
    refetch,
  } = useQuery<Person[]>({
    queryKey: ["/api/people/elo/pair"],
  });

  const voteMutation = useMutation({
    mutationFn: async ({ winnerId, loserId }: { winnerId: string; loserId: string }) => {
      const res = await apiRequest("POST", "/api/people/elo/vote", { winnerId, loserId });
      return res.json();
    },
    onSuccess: (data) => {
      toast({
        title: "Vote recorded",
        description: `${data.winner.firstName} ${data.winner.lastName}: ${data.winner.eloScore} | ${data.loser.firstName} ${data.loser.lastName}: ${data.loser.eloScore}`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/people/paginated"] });
      queryClient.invalidateQueries({ queryKey: ["/api/people"] });
      refetch();
      setIsVoting(false);
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to record vote",
        variant: "destructive",
      });
      setIsVoting(false);
    },
  });

  const handleVote = (winnerId: string, loserId: string) => {
    if (isVoting || voteMutation.isPending) return;
    setIsVoting(true);
    voteMutation.mutate({ winnerId, loserId });
  };

  const getInitials = (firstName: string, lastName: string) => {
    return `${firstName[0]}${lastName[0]}`.toUpperCase();
  };

  const leftPerson = pair?.[0];
  const rightPerson = pair?.[1];

  return (
    <div className="flex flex-col h-full">
      <div className="border-b px-6 py-4">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <Trophy className="h-6 w-6" />
            <h1 className="text-3xl font-semibold" data-testid="text-page-title">
              ELO Ranking
            </h1>
          </div>
          <Button
            variant="outline"
            onClick={() => refetch()}
            disabled={isLoading || isVoting}
            data-testid="button-skip-pair"
          >
            <RefreshCw className="h-4 w-4" />
            Skip
          </Button>
        </div>
        <p className="text-sm text-muted-foreground mt-1">
          Pick who you rank higher. Their scores will update based on the ELO system.
        </p>
      </div>

      <div className="flex-1 overflow-auto px-3 md:px-6 py-6">
        {isLoading ? (
          <div className="flex items-center justify-center gap-4 md:gap-8 h-full">
            <Card className="flex-1 max-w-sm p-6 animate-pulse">
              <div className="flex flex-col items-center gap-4">
                <div className="w-20 h-20 rounded-full bg-muted" />
                <div className="h-5 bg-muted rounded w-2/3" />
                <div className="h-4 bg-muted rounded w-1/2" />
              </div>
            </Card>
            <div className="text-2xl font-bold text-muted-foreground">VS</div>
            <Card className="flex-1 max-w-sm p-6 animate-pulse">
              <div className="flex flex-col items-center gap-4">
                <div className="w-20 h-20 rounded-full bg-muted" />
                <div className="h-5 bg-muted rounded w-2/3" />
                <div className="h-4 bg-muted rounded w-1/2" />
              </div>
            </Card>
          </div>
        ) : !leftPerson || !rightPerson ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <Trophy className="h-16 w-16 text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium mb-2">Not enough people</h3>
            <p className="text-sm text-muted-foreground max-w-sm">
              You need at least 2 people in your contacts to start ranking.
            </p>
          </div>
        ) : (
          <div className="flex items-stretch justify-center gap-3 md:gap-8 h-full max-h-[500px]">
            <Card
              className={`flex-1 max-w-sm p-4 md:p-6 cursor-pointer hover-elevate transition-all flex flex-col ${isVoting ? "opacity-50 pointer-events-none" : ""}`}
              onClick={() => handleVote(leftPerson.id, rightPerson.id)}
              data-testid={`card-elo-left-${leftPerson.id}`}
            >
              <div className="flex flex-col items-center gap-3 flex-1 justify-center">
                <div className="flex items-center gap-1 text-muted-foreground mb-2">
                  <ArrowLeft className="h-4 w-4" />
                  <span className="text-xs font-medium uppercase tracking-wide">Pick</span>
                </div>
                <Avatar className="w-20 h-20 md:w-24 md:h-24">
                  {leftPerson.imageUrl && (
                    <AvatarImage src={leftPerson.imageUrl} alt={`${leftPerson.firstName} ${leftPerson.lastName}`} />
                  )}
                  <AvatarFallback className="text-xl md:text-2xl">
                    {getInitials(leftPerson.firstName, leftPerson.lastName)}
                  </AvatarFallback>
                </Avatar>
                <h2 className="text-lg md:text-xl font-semibold text-center" data-testid={`text-elo-name-left`}>
                  {leftPerson.firstName} {leftPerson.lastName}
                </h2>
                {(leftPerson.company || leftPerson.title) && (
                  <p className="text-sm text-muted-foreground text-center">
                    {leftPerson.title}{leftPerson.title && leftPerson.company ? " at " : ""}{leftPerson.company}
                  </p>
                )}
                {leftPerson.email && (
                  <p className="text-xs text-muted-foreground text-center truncate max-w-full">
                    {leftPerson.email}
                  </p>
                )}
                <Badge variant="secondary" className="mt-2" data-testid="badge-elo-score-left">
                  <Trophy className="h-3 w-3 mr-1" />
                  {leftPerson.eloScore}
                </Badge>
              </div>
            </Card>

            <div className="flex items-center">
              <span className="text-xl md:text-2xl font-bold text-muted-foreground">VS</span>
            </div>

            <Card
              className={`flex-1 max-w-sm p-4 md:p-6 cursor-pointer hover-elevate transition-all flex flex-col ${isVoting ? "opacity-50 pointer-events-none" : ""}`}
              onClick={() => handleVote(rightPerson.id, leftPerson.id)}
              data-testid={`card-elo-right-${rightPerson.id}`}
            >
              <div className="flex flex-col items-center gap-3 flex-1 justify-center">
                <div className="flex items-center gap-1 text-muted-foreground mb-2">
                  <span className="text-xs font-medium uppercase tracking-wide">Pick</span>
                  <ArrowRight className="h-4 w-4" />
                </div>
                <Avatar className="w-20 h-20 md:w-24 md:h-24">
                  {rightPerson.imageUrl && (
                    <AvatarImage src={rightPerson.imageUrl} alt={`${rightPerson.firstName} ${rightPerson.lastName}`} />
                  )}
                  <AvatarFallback className="text-xl md:text-2xl">
                    {getInitials(rightPerson.firstName, rightPerson.lastName)}
                  </AvatarFallback>
                </Avatar>
                <h2 className="text-lg md:text-xl font-semibold text-center" data-testid={`text-elo-name-right`}>
                  {rightPerson.firstName} {rightPerson.lastName}
                </h2>
                {(rightPerson.company || rightPerson.title) && (
                  <p className="text-sm text-muted-foreground text-center">
                    {rightPerson.title}{rightPerson.title && rightPerson.company ? " at " : ""}{rightPerson.company}
                  </p>
                )}
                {rightPerson.email && (
                  <p className="text-xs text-muted-foreground text-center truncate max-w-full">
                    {rightPerson.email}
                  </p>
                )}
                <Badge variant="secondary" className="mt-2" data-testid="badge-elo-score-right">
                  <Trophy className="h-3 w-3 mr-1" />
                  {rightPerson.eloScore}
                </Badge>
              </div>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}
