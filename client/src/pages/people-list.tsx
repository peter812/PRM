import { useInfiniteQuery, useMutation } from "@tanstack/react-query";
import { Plus, X, Star } from "lucide-react";
import { useState, useRef, useEffect } from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
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
} from "@/components/ui/alert-dialog";
import type { Person } from "@shared/schema";
import { AddPersonDialog } from "@/components/add-person-dialog";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

type PersonWithRelationship = Person & {
  maxRelationshipValue: number | null;
  relationshipTypeName: string | null;
  relationshipTypeColor: string | null;
  groupCount: number;
  isStarred?: number;
};

export default function PeopleList() {
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [personToDelete, setPersonToDelete] = useState<PersonWithRelationship | null>(null);
  const [starredStates, setStarredStates] = useState<Record<string, number>>({});
  const { toast } = useToast();
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const {
    data,
    isLoading,
    isError,
    error,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery<PersonWithRelationship[]>({
    queryKey: ["/api/people/paginated"],
    queryFn: async ({ pageParam = 0 }) => {
      const response = await fetch(`/api/people/paginated?offset=${pageParam}&limit=30`);
      if (!response.ok) throw new Error("Failed to fetch people");
      return response.json();
    },
    getNextPageParam: (lastPage, allPages) => {
      if (lastPage.length < 30) return undefined;
      return allPages.length * 30;
    },
    initialPageParam: 0,
  });

  // Infinite scroll handler
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = container;
      const scrollPercentage = (scrollTop + clientHeight) / scrollHeight;
      
      if (scrollPercentage > 0.8 && hasNextPage && !isFetchingNextPage) {
        fetchNextPage();
      }
    };

    container.addEventListener("scroll", handleScroll);
    return () => container.removeEventListener("scroll", handleScroll);
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const people = data?.pages.flat() || [];

  const deleteMutation = useMutation({
    mutationFn: async (personId: string) => {
      await apiRequest("DELETE", `/api/people/${personId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/people/paginated"] });
      queryClient.invalidateQueries({ queryKey: ["/api/people"] });
      toast({
        title: "Person deleted",
        description: "The person and all associated data have been removed.",
      });
      setPersonToDelete(null);
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to delete person",
        variant: "destructive",
      });
    },
  });

  const starMutation = useMutation({
    mutationFn: async ({ personId, isStarred }: { personId: string; isStarred: number }) => {
      await apiRequest("PATCH", `/api/people/${personId}`, {
        isStarred: isStarred === 1 ? 0 : 1,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/people/paginated"] });
      queryClient.invalidateQueries({ queryKey: ["/api/people"] });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update star status",
        variant: "destructive",
      });
    },
  });

  const handleStarClick = (person: PersonWithRelationship) => {
    const currentStarred = starredStates[person.id] ?? (person.isStarred || 0);
    const newStarred = currentStarred === 1 ? 0 : 1;
    setStarredStates((prev) => ({ ...prev, [person.id]: newStarred }));
    starMutation.mutate({ personId: person.id, isStarred: currentStarred });
  };

  const getInitials = (firstName: string, lastName: string) => {
    return `${firstName[0]}${lastName[0]}`.toUpperCase();
  };

  return (
    <div className="flex flex-col h-full">
      <div className="border-b px-6 py-4">
        <div className="flex items-center justify-between gap-4">
          <h1 className="text-3xl font-semibold" data-testid="text-page-title">
            People
          </h1>
          <Button onClick={() => setIsAddDialogOpen(true)} data-testid="button-add-person">
            <Plus className="h-4 w-4" />
            Add Person
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-auto px-6 py-6" ref={scrollContainerRef}>
        {isLoading ? (
          <div className="flex flex-col gap-[5px]">
            {[1, 2, 3, 4].map((i) => (
              <Card key={i} className="p-2 animate-pulse">
                <div className="flex items-center gap-2">
                  <div className="w-12 h-12 rounded-full bg-muted" />
                  <div className="flex-1 space-y-1">
                    <div className="h-4 bg-muted rounded w-1/3" />
                    <div className="h-3 bg-muted rounded w-1/4" />
                  </div>
                </div>
              </Card>
            ))}
          </div>
        ) : isError ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="w-16 h-16 rounded-full bg-destructive/10 flex items-center justify-center mb-4">
              <Users className="h-8 w-8 text-destructive" />
            </div>
            <h3 className="text-lg font-medium mb-2">Failed to load people</h3>
            <p className="text-sm text-muted-foreground mb-6 max-w-sm">
              {error?.message || "An error occurred while fetching people"}
            </p>
            <Button onClick={() => window.location.reload()} variant="outline" data-testid="button-retry">
              Try Again
            </Button>
          </div>
        ) : people && people.length > 0 ? (
          <div className="flex flex-col gap-[5px]">
            {people.map((person) => {
              const isIsolated = !person.relationshipTypeName && person.groupCount === 0;
              return (
              <Link key={person.id} href={`/person/${person.id}`}>
                <Card
                  className="p-2 hover-elevate transition-all cursor-pointer"
                  style={isIsolated ? { backgroundColor: 'var(--isolated-bg)' } : undefined}
                  data-testid={`card-person-${person.id}`}
                >
                  <div className="flex items-center gap-2">
                    <Avatar className="w-12 h-12">
                      {person.imageUrl && (
                        <AvatarImage src={person.imageUrl} alt={`${person.firstName} ${person.lastName}`} />
                      )}
                      <AvatarFallback>
                        {getInitials(person.firstName, person.lastName)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <h3 className="text-lg font-medium" data-testid={`text-name-${person.id}`}>
                          {person.firstName} {person.lastName}
                        </h3>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-5 w-5 text-yellow-500 hover:text-yellow-600 p-0"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            handleStarClick(person);
                          }}
                          data-testid={`button-star-${person.id}`}
                        >
                          <Star className={`h-4 w-4 ${(starredStates[person.id] ?? (person.isStarred || 0)) === 1 ? "fill-current" : ""}`} />
                        </Button>
                      </div>
                      <div className="flex items-center gap-1 text-sm text-muted-foreground">
                        {person.company && (
                          <span data-testid={`text-company-${person.id}`}>
                            {person.company}
                          </span>
                        )}
                        {person.title && person.company && <span>•</span>}
                        {person.title && (
                          <span data-testid={`text-title-${person.id}`}>
                            {person.title}
                          </span>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-1 mt-1">
                        {person.relationshipTypeName && (
                          <Badge
                            variant="secondary"
                            className="text-xs"
                            style={{
                              backgroundColor: person.relationshipTypeColor || undefined,
                              color: 'white',
                            }}
                            data-testid={`badge-relationship-${person.id}`}
                          >
                            {person.relationshipTypeName}
                          </Badge>
                        )}
                        {person.tags && person.tags.map((tag, idx) => (
                          <Badge key={idx} variant="secondary" className="text-xs">
                            {tag}
                          </Badge>
                        ))}
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setPersonToDelete(person);
                      }}
                      data-testid={`button-delete-${person.id}`}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                </Card>
              </Link>
            );
            })}
            {isFetchingNextPage && (
              <div className="flex justify-center py-4">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                  Loading more...
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <Users className="h-16 w-16 text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium mb-2">No people found</h3>
            <p className="text-sm text-muted-foreground mb-6 max-w-sm">
              Get started by adding your first contact
            </p>
            <Button onClick={() => setIsAddDialogOpen(true)} data-testid="button-add-person-empty">
              <Plus className="h-4 w-4" />
              Add Person
            </Button>
          </div>
        )}
      </div>

      <AddPersonDialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen} />

      <AlertDialog open={!!personToDelete} onOpenChange={(open) => !open && setPersonToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Person</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete {personToDelete?.firstName} {personToDelete?.lastName}? This will permanently remove this person and all associated notes, interactions, and relationships. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (personToDelete) {
                  deleteMutation.mutate(personToDelete.id);
                }
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleteMutation.isPending}
              data-testid="button-confirm-delete"
            >
              {deleteMutation.isPending ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function Users(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}
