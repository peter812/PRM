import { useQuery, useMutation } from "@tanstack/react-query";
import { useState, useRef, useCallback, useEffect } from "react";
import { Trophy, RefreshCw, ArrowLeft, ArrowRight, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import type { Person, RelationshipType, RelationshipWithPerson } from "@shared/schema";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

const GREY_COLOR = "#9ca3af";

function useRelationshipColor(personId: string | undefined, meUserId: string | undefined) {
  const { data: relationships } = useQuery<RelationshipWithPerson[]>({
    queryKey: ["/api/relationships", personId],
    enabled: !!personId,
    select: (data: any) => {
      if (Array.isArray(data)) return data;
      if (data?.relationships) return data.relationships;
      return [];
    },
  });

  if (!personId || !meUserId || !relationships) return { color: GREY_COLOR, hasRelationship: false };

  const meRel = relationships.find(
    (r) => r.toPerson?.id === meUserId || r.fromPersonId === meUserId
  );

  if (meRel?.type?.color) {
    return { color: meRel.type.color, hasRelationship: true };
  }

  return { color: GREY_COLOR, hasRelationship: false };
}

interface PersonCardContentProps {
  person: Person;
  meUserId: string | undefined;
  relationshipColor: string;
  hasRelationship: boolean;
  relationshipTypes: RelationshipType[] | undefined;
  onDelete: (person: Person) => void;
  onAddRelationship: (personId: string, typeId: string) => void;
  isAddingRelationship: boolean;
  size: "sm" | "lg";
  testIdSuffix: string;
}

function PersonCardContent({
  person,
  relationshipColor,
  hasRelationship,
  relationshipTypes,
  onDelete,
  onAddRelationship,
  isAddingRelationship,
  size,
  testIdSuffix,
}: PersonCardContentProps) {
  const getInitials = (firstName: string, lastName: string) => {
    return `${firstName[0]}${lastName[0]}`.toUpperCase();
  };

  const avatarSize = size === "lg" ? "w-24 h-24" : "w-16 h-16";
  const nameSize = size === "lg" ? "text-xl" : "text-base";
  const fallbackSize = size === "lg" ? "text-2xl" : "text-lg";
  const gap = size === "lg" ? "gap-3" : "gap-2";

  return (
    <>
      <Button
        size="icon"
        variant="ghost"
        className="absolute top-1 left-1 h-7 w-7 text-destructive z-20"
        onClick={(e) => {
          e.stopPropagation();
          onDelete(person);
        }}
        onTouchStart={(e) => e.stopPropagation()}
        onTouchEnd={(e) => e.stopPropagation()}
        data-testid={`button-delete-elo-${testIdSuffix}`}
      >
        <X className="h-4 w-4" />
      </Button>
      <div className={`flex flex-col items-center ${gap} flex-1 justify-center`}>
        <Avatar className={avatarSize}>
          {person.imageUrl && (
            <AvatarImage src={person.imageUrl} alt={`${person.firstName} ${person.lastName}`} />
          )}
          <AvatarFallback className={fallbackSize}>
            {getInitials(person.firstName, person.lastName)}
          </AvatarFallback>
        </Avatar>
        <h2 className={`${nameSize} font-semibold text-center`} data-testid={`text-elo-name-${testIdSuffix}`}>
          {person.firstName} {person.lastName}
        </h2>
        {(person.company || person.title) && (
          <p className="text-xs text-muted-foreground text-center line-clamp-2">
            {person.title}{person.title && person.company ? " at " : ""}{person.company}
          </p>
        )}
        <Badge variant="secondary" className="mt-1" data-testid={`badge-elo-score-${testIdSuffix}`}>
          <Trophy className="h-3 w-3 mr-1" />
          {person.eloScore}
        </Badge>
      </div>
      {!hasRelationship && relationshipTypes && relationshipTypes.length > 0 && (
        <div
          className="mt-2 w-full"
          onClick={(e) => e.stopPropagation()}
          onTouchStart={(e) => e.stopPropagation()}
          onTouchEnd={(e) => e.stopPropagation()}
        >
          <Select
            onValueChange={(typeId) => onAddRelationship(person.id, typeId)}
            disabled={isAddingRelationship}
          >
            <SelectTrigger
              className="w-full text-xs"
              data-testid={`select-add-rel-${testIdSuffix}`}
            >
              <SelectValue placeholder="Add relationship..." />
            </SelectTrigger>
            <SelectContent>
              {relationshipTypes.map((type) => (
                <SelectItem key={type.id} value={type.id}>
                  <div className="flex items-center gap-2">
                    <div
                      className="w-3 h-3 rounded-full shrink-0"
                      style={{ backgroundColor: type.color }}
                    />
                    {type.name}
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
    </>
  );
}

function MobileSwipeableView({
  leftPerson,
  rightPerson,
  isVoting,
  onVote,
  meUserId,
  relationshipTypes,
  onDelete,
  onAddRelationship,
  isAddingRelationship,
}: {
  leftPerson: Person;
  rightPerson: Person;
  isVoting: boolean;
  onVote: (winnerId: string, loserId: string) => void;
  meUserId: string | undefined;
  relationshipTypes: RelationshipType[] | undefined;
  onDelete: (person: Person) => void;
  onAddRelationship: (personId: string, typeId: string) => void;
  isAddingRelationship: boolean;
}) {
  const [swipeX, setSwipeX] = useState(0);
  const [swipeTransition, setSwipeTransition] = useState(false);
  const startX = useRef(0);
  const startY = useRef(0);
  const isDragging = useRef(false);
  const isHorizontalSwipe = useRef<boolean | null>(null);
  const hasMoved = useRef(false);
  const tappedSide = useRef<"left" | "right" | null>(null);

  const SWIPE_THRESHOLD = 60;

  const leftRel = useRelationshipColor(leftPerson.id, meUserId);
  const rightRel = useRelationshipColor(rightPerson.id, meUserId);

  const handleTouchStart = useCallback((e: React.TouchEvent, side: "left" | "right" | null) => {
    if (isVoting) return;
    startX.current = e.touches[0].clientX;
    startY.current = e.touches[0].clientY;
    isDragging.current = true;
    isHorizontalSwipe.current = null;
    hasMoved.current = false;
    tappedSide.current = side;
    setSwipeTransition(false);
  }, [isVoting]);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (!isDragging.current || isVoting) return;
    const currentX = e.touches[0].clientX;
    const currentY = e.touches[0].clientY;
    const diffX = currentX - startX.current;
    const diffY = currentY - startY.current;

    if (Math.abs(diffX) > 8 || Math.abs(diffY) > 8) {
      hasMoved.current = true;
    }

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

    if (!hasMoved.current && tappedSide.current) {
      if (tappedSide.current === "left") {
        onVote(leftPerson.id, rightPerson.id);
      } else {
        onVote(rightPerson.id, leftPerson.id);
      }
      tappedSide.current = null;
      return;
    }

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

  return (
    <div className="flex flex-col items-center gap-3 w-full h-full justify-center">
      <div
        className="flex gap-3 w-full"
        style={{
          transform: `translateX(${swipeX * 0.3}px)`,
          transition: swipeTransition ? "transform 0.25s ease-out" : "none",
        }}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        <div
          className="flex-1 flex flex-col gap-1 items-center"
          onTouchStart={(e) => handleTouchStart(e, "left")}
        >
          <div
            className="transition-opacity duration-150"
            style={{ opacity: leftHighlight ? highlightIntensity : 0 }}
          >
            <Badge variant="default" className="bg-green-600 text-white border-green-600">
              <Trophy className="h-3 w-3 mr-1" />
              Pick
            </Badge>
          </div>
          <Card
            className={`flex-1 p-3 flex flex-col relative w-full transition-all duration-150 ${isVoting ? "opacity-50 pointer-events-none" : ""}`}
            style={{
              transform: leftHighlight ? `scale(${1 + highlightIntensity * 0.05})` : `scale(${1 - highlightIntensity * 0.03})`,
              opacity: leftHighlight ? 1 : (1 - highlightIntensity * 0.4),
              borderColor: leftRel.color,
              borderWidth: "2px",
            }}
            data-testid={`card-elo-left-${leftPerson.id}`}
          >
            <PersonCardContent
              person={leftPerson}
              meUserId={meUserId}
              relationshipColor={leftRel.color}
              hasRelationship={leftRel.hasRelationship}
              relationshipTypes={relationshipTypes}
              onDelete={onDelete}
              onAddRelationship={onAddRelationship}
              isAddingRelationship={isAddingRelationship}
              size="sm"
              testIdSuffix="left"
            />
          </Card>
        </div>
        <div
          className="flex-1 flex flex-col gap-1 items-center"
          onTouchStart={(e) => handleTouchStart(e, "right")}
        >
          <div
            className="transition-opacity duration-150"
            style={{ opacity: rightHighlight ? highlightIntensity : 0 }}
          >
            <Badge variant="default" className="bg-green-600 text-white border-green-600">
              <Trophy className="h-3 w-3 mr-1" />
              Pick
            </Badge>
          </div>
          <Card
            className={`flex-1 p-3 flex flex-col relative w-full transition-all duration-150 ${isVoting ? "opacity-50 pointer-events-none" : ""}`}
            style={{
              transform: rightHighlight ? `scale(${1 + highlightIntensity * 0.05})` : `scale(${1 - highlightIntensity * 0.03})`,
              opacity: rightHighlight ? 1 : (1 - highlightIntensity * 0.4),
              borderColor: rightRel.color,
              borderWidth: "2px",
            }}
            data-testid={`card-elo-right-${rightPerson.id}`}
          >
            <PersonCardContent
              person={rightPerson}
              meUserId={meUserId}
              relationshipColor={rightRel.color}
              hasRelationship={rightRel.hasRelationship}
              relationshipTypes={relationshipTypes}
              onDelete={onDelete}
              onAddRelationship={onAddRelationship}
              isAddingRelationship={isAddingRelationship}
              size="sm"
              testIdSuffix="right"
            />
          </Card>
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
  const [personToDelete, setPersonToDelete] = useState<Person | null>(null);

  const { data: meUser } = useQuery<Person>({
    queryKey: ["/api/me"],
  });

  const { data: relationshipTypes } = useQuery<RelationshipType[]>({
    queryKey: ["/api/relationship-types"],
  });

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

  const deleteMutation = useMutation({
    mutationFn: async (personId: string) => {
      await apiRequest("DELETE", `/api/people/${personId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/people/paginated"] });
      queryClient.invalidateQueries({ queryKey: ["/api/people"] });
      queryClient.invalidateQueries({ queryKey: ["/api/people/elo/pair"] });
      toast({
        title: "Person deleted",
        description: "The person and all associated data have been removed.",
      });
      setPersonToDelete(null);
      refetch();
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to delete person",
        variant: "destructive",
      });
    },
  });

  const addRelationshipMutation = useMutation({
    mutationFn: async ({ personId, typeId }: { personId: string; typeId: string }) => {
      await apiRequest("POST", "/api/relationships", {
        fromPersonId: personId,
        toPersonId: meUser!.id,
        typeId,
        notes: "",
      });
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/relationships", variables.personId] });
      queryClient.invalidateQueries({ queryKey: ["/api/relationships", meUser?.id] });
      queryClient.invalidateQueries({ queryKey: ["/api/people"] });
      toast({
        title: "Relationship added",
        description: "Relationship to you has been created.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to add relationship",
        variant: "destructive",
      });
    },
  });

  const handleVote = useCallback((winnerId: string, loserId: string) => {
    if (isVoting || voteMutation.isPending) return;
    setIsVoting(true);
    voteMutation.mutate({ winnerId, loserId });
  }, [isVoting, voteMutation]);

  const handleDelete = useCallback((person: Person) => {
    setPersonToDelete(person);
  }, []);

  const handleAddRelationship = useCallback((personId: string, typeId: string) => {
    if (!meUser) return;
    addRelationshipMutation.mutate({ personId, typeId });
  }, [meUser, addRelationshipMutation]);

  const leftPerson = pair?.[0];
  const rightPerson = pair?.[1];

  const leftRel = useRelationshipColor(leftPerson?.id, meUser?.id);
  const rightRel = useRelationshipColor(rightPerson?.id, meUser?.id);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isLoading || isVoting || !leftPerson || !rightPerson) return;
      if (personToDelete) return;
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        handleVote(leftPerson.id, rightPerson.id);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        handleVote(rightPerson.id, leftPerson.id);
      } else if (e.key === " ") {
        e.preventDefault();
        refetch();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isLoading, isVoting, leftPerson, rightPerson, handleVote, refetch, personToDelete]);

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
                meUserId={meUser?.id}
                relationshipTypes={relationshipTypes}
                onDelete={handleDelete}
                onAddRelationship={handleAddRelationship}
                isAddingRelationship={addRelationshipMutation.isPending}
              />
            </div>

            {/* Desktop: Side-by-side cards */}
            <div className="hidden md:flex items-stretch justify-center gap-8 h-full max-h-[500px]">
              <Card
                className={`flex-1 max-w-sm p-6 cursor-pointer hover-elevate transition-all flex flex-col relative ${isVoting ? "opacity-50 pointer-events-none" : ""}`}
                style={{
                  borderColor: leftRel.color,
                  borderWidth: "2px",
                }}
                onClick={() => handleVote(leftPerson.id, rightPerson.id)}
                data-testid={`card-elo-left-${leftPerson.id}`}
              >
                <div className="flex items-center gap-1 text-muted-foreground mb-2 justify-center">
                  <ArrowLeft className="h-4 w-4" />
                  <span className="text-xs font-medium uppercase tracking-wide">Pick</span>
                </div>
                <PersonCardContent
                  person={leftPerson}
                  meUserId={meUser?.id}
                  relationshipColor={leftRel.color}
                  hasRelationship={leftRel.hasRelationship}
                  relationshipTypes={relationshipTypes}
                  onDelete={handleDelete}
                  onAddRelationship={handleAddRelationship}
                  isAddingRelationship={addRelationshipMutation.isPending}
                  size="lg"
                  testIdSuffix="left"
                />
              </Card>

              <div className="flex items-center">
                <span className="text-2xl font-bold text-muted-foreground">VS</span>
              </div>

              <Card
                className={`flex-1 max-w-sm p-6 cursor-pointer hover-elevate transition-all flex flex-col relative ${isVoting ? "opacity-50 pointer-events-none" : ""}`}
                style={{
                  borderColor: rightRel.color,
                  borderWidth: "2px",
                }}
                onClick={() => handleVote(rightPerson.id, leftPerson.id)}
                data-testid={`card-elo-right-${rightPerson.id}`}
              >
                <div className="flex items-center gap-1 text-muted-foreground mb-2 justify-center">
                  <span className="text-xs font-medium uppercase tracking-wide">Pick</span>
                  <ArrowRight className="h-4 w-4" />
                </div>
                <PersonCardContent
                  person={rightPerson}
                  meUserId={meUser?.id}
                  relationshipColor={rightRel.color}
                  hasRelationship={rightRel.hasRelationship}
                  relationshipTypes={relationshipTypes}
                  onDelete={handleDelete}
                  onAddRelationship={handleAddRelationship}
                  isAddingRelationship={addRelationshipMutation.isPending}
                  size="lg"
                  testIdSuffix="right"
                />
              </Card>
            </div>
          </>
        )}
      </div>

      <AlertDialog open={!!personToDelete} onOpenChange={(open) => !open && setPersonToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {personToDelete?.firstName} {personToDelete?.lastName}?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete {personToDelete?.firstName} {personToDelete?.lastName}? This will permanently remove this person and all associated notes, interactions, and relationships. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete">Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground"
              onClick={() => personToDelete && deleteMutation.mutate(personToDelete.id)}
              data-testid="button-confirm-delete"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
