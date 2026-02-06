import { useQuery, useMutation } from "@tanstack/react-query";
import { useState, useRef, useCallback } from "react";
import { Trophy, RefreshCw, ArrowLeft, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import type { Person } from "@shared/schema";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

function MobileSwipeableView({
  leftPerson,
  rightPerson,
  isVoting,
  onVote,
}: {
  leftPerson: Person;
  rightPerson: Person;
  isVoting: boolean;
  onVote: (winnerId: string, loserId: string) => void;
}) {
  const [swipeX, setSwipeX] = useState(0);
  const [swipeTransition, setSwipeTransition] = useState(false);
  const startX = useRef(0);
  const startY = useRef(0);
  const isDragging = useRef(false);
  const isHorizontalSwipe = useRef<boolean | null>(null);

  const getInitials = (firstName: string, lastName: string) => {
    return `${firstName[0]}${lastName[0]}`.toUpperCase();
  };

  const SWIPE_THRESHOLD = 60;

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (isVoting) return;
    startX.current = e.touches[0].clientX;
    startY.current = e.touches[0].clientY;
    isDragging.current = true;
    isHorizontalSwipe.current = null;
    setSwipeTransition(false);
  }, [isVoting]);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (!isDragging.current || isVoting) return;
    const currentX = e.touches[0].clientX;
    const currentY = e.touches[0].clientY;
    const diffX = currentX - startX.current;
    const diffY = currentY - startY.current;

    if (isHorizontalSwipe.current === null) {
      if (Math.abs(diffX) > 10 || Math.abs(diffY) > 10) {
        isHorizontalSwipe.current = Math.abs(diffX) > Math.abs(diffY);
      }
    }

    if (isHorizontalSwipe.current) {
      e.preventDefault();
      setSwipeX(diffX);
    }
  }, [isVoting]);

  const handleTouchEnd = useCallback(() => {
    if (!isDragging.current || isVoting) return;
    isDragging.current = false;
    setSwipeTransition(true);

    if (swipeX < -SWIPE_THRESHOLD) {
      setSwipeX(-300);
      setTimeout(() => {
        onVote(leftPerson.id, rightPerson.id);
        setSwipeX(0);
        setSwipeTransition(false);
      }, 250);
    } else if (swipeX > SWIPE_THRESHOLD) {
      setSwipeX(300);
      setTimeout(() => {
        onVote(rightPerson.id, leftPerson.id);
        setSwipeX(0);
        setSwipeTransition(false);
      }, 250);
    } else {
      setSwipeX(0);
    }
  }, [swipeX, isVoting, leftPerson, rightPerson, onVote]);

  const leftHighlight = swipeX < -20;
  const rightHighlight = swipeX > 20;
  const highlightIntensity = Math.min(1, Math.abs(swipeX) / SWIPE_THRESHOLD);

  const renderMobileCard = (person: Person, side: "left" | "right", highlighted: boolean) => (
    <Card
      className={`flex-1 p-3 flex flex-col transition-all duration-150 ${isVoting ? "opacity-50 pointer-events-none" : ""}`}
      style={{
        transform: highlighted ? `scale(${1 + highlightIntensity * 0.05})` : `scale(${1 - highlightIntensity * 0.03})`,
        opacity: highlighted ? 1 : (1 - highlightIntensity * 0.4),
        boxShadow: highlighted ? `0 0 0 2px hsl(var(--primary) / ${highlightIntensity})` : "none",
      }}
      data-testid={`card-elo-${side}-${person.id}`}
    >
      <div className="flex flex-col items-center gap-2 flex-1 justify-center">
        <Avatar className="w-16 h-16">
          {person.imageUrl && (
            <AvatarImage src={person.imageUrl} alt={`${person.firstName} ${person.lastName}`} />
          )}
          <AvatarFallback className="text-lg">
            {getInitials(person.firstName, person.lastName)}
          </AvatarFallback>
        </Avatar>
        <h2 className="text-base font-semibold text-center" data-testid={`text-elo-name-${side}`}>
          {person.firstName} {person.lastName}
        </h2>
        {(person.company || person.title) && (
          <p className="text-xs text-muted-foreground text-center line-clamp-2">
            {person.title}{person.title && person.company ? " at " : ""}{person.company}
          </p>
        )}
        <Badge variant="secondary" className="mt-1" data-testid={`badge-elo-score-${side}`}>
          <Trophy className="h-3 w-3 mr-1" />
          {person.eloScore}
        </Badge>
      </div>
    </Card>
  );

  return (
    <div className="flex flex-col items-center gap-3 w-full h-full justify-center">
      <div
        className="flex gap-3 w-full"
        style={{
          transform: `translateX(${swipeX * 0.3}px)`,
          transition: swipeTransition ? "transform 0.25s ease-out" : "none",
        }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        <div className="flex-1 flex flex-col gap-1 items-center">
          <div
            className="transition-opacity duration-150"
            style={{ opacity: leftHighlight ? highlightIntensity : 0 }}
          >
            <Badge variant="default" className="bg-green-600 text-white border-green-600">
              <Trophy className="h-3 w-3 mr-1" />
              Pick
            </Badge>
          </div>
          {renderMobileCard(leftPerson, "left", leftHighlight)}
        </div>
        <div className="flex-1 flex flex-col gap-1 items-center">
          <div
            className="transition-opacity duration-150"
            style={{ opacity: rightHighlight ? highlightIntensity : 0 }}
          >
            <Badge variant="default" className="bg-green-600 text-white border-green-600">
              <Trophy className="h-3 w-3 mr-1" />
              Pick
            </Badge>
          </div>
          {renderMobileCard(rightPerson, "right", rightHighlight)}
        </div>
      </div>
      <span className="text-xs text-muted-foreground flex items-center gap-1 mt-2">
        <ArrowLeft className="h-3 w-3" /> Swipe toward your pick
        <ArrowRight className="h-3 w-3" />
      </span>
    </div>
  );
}

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

  const handleVote = useCallback((winnerId: string, loserId: string) => {
    if (isVoting || voteMutation.isPending) return;
    setIsVoting(true);
    voteMutation.mutate({ winnerId, loserId });
  }, [isVoting, voteMutation]);

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
            <div className="hidden md:block text-2xl font-bold text-muted-foreground">VS</div>
            <Card className="hidden md:block flex-1 max-w-sm p-6 animate-pulse">
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
          <>
            {/* Mobile: Both cards visible, swipeable */}
            <div className="flex md:hidden items-center justify-center h-full">
              <MobileSwipeableView
                leftPerson={leftPerson}
                rightPerson={rightPerson}
                isVoting={isVoting}
                onVote={handleVote}
              />
            </div>

            {/* Desktop: Side-by-side cards */}
            <div className="hidden md:flex items-stretch justify-center gap-8 h-full max-h-[500px]">
              <Card
                className={`flex-1 max-w-sm p-6 cursor-pointer hover-elevate transition-all flex flex-col ${isVoting ? "opacity-50 pointer-events-none" : ""}`}
                onClick={() => handleVote(leftPerson.id, rightPerson.id)}
                data-testid={`card-elo-left-${leftPerson.id}`}
              >
                <div className="flex flex-col items-center gap-3 flex-1 justify-center">
                  <div className="flex items-center gap-1 text-muted-foreground mb-2">
                    <ArrowLeft className="h-4 w-4" />
                    <span className="text-xs font-medium uppercase tracking-wide">Pick</span>
                  </div>
                  <Avatar className="w-24 h-24">
                    {leftPerson.imageUrl && (
                      <AvatarImage src={leftPerson.imageUrl} alt={`${leftPerson.firstName} ${leftPerson.lastName}`} />
                    )}
                    <AvatarFallback className="text-2xl">
                      {getInitials(leftPerson.firstName, leftPerson.lastName)}
                    </AvatarFallback>
                  </Avatar>
                  <h2 className="text-xl font-semibold text-center" data-testid={`text-elo-name-left`}>
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
                <span className="text-2xl font-bold text-muted-foreground">VS</span>
              </div>

              <Card
                className={`flex-1 max-w-sm p-6 cursor-pointer hover-elevate transition-all flex flex-col ${isVoting ? "opacity-50 pointer-events-none" : ""}`}
                onClick={() => handleVote(rightPerson.id, leftPerson.id)}
                data-testid={`card-elo-right-${rightPerson.id}`}
              >
                <div className="flex flex-col items-center gap-3 flex-1 justify-center">
                  <div className="flex items-center gap-1 text-muted-foreground mb-2">
                    <span className="text-xs font-medium uppercase tracking-wide">Pick</span>
                    <ArrowRight className="h-4 w-4" />
                  </div>
                  <Avatar className="w-24 h-24">
                    {rightPerson.imageUrl && (
                      <AvatarImage src={rightPerson.imageUrl} alt={`${rightPerson.firstName} ${rightPerson.lastName}`} />
                    )}
                    <AvatarFallback className="text-2xl">
                      {getInitials(rightPerson.firstName, rightPerson.lastName)}
                    </AvatarFallback>
                  </Avatar>
                  <h2 className="text-xl font-semibold text-center" data-testid={`text-elo-name-right`}>
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
          </>
        )}
      </div>
    </div>
  );
}
