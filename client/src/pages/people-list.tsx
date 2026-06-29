import { useInfiniteQuery, useMutation } from "@tanstack/react-query";
import { Plus, X, Star, Trophy, ArrowUpDown, CalendarDays, LayoutList, LayoutGrid, Maximize2, Phone, Mail, ExternalLink } from "lucide-react";
import { useState, useRef, useEffect } from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
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
import type { Person } from "@shared/schema";
import { PersonDialog } from "@/components/person-dialog";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { getInitials } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";

type SortOption = "relationship" | "added" | "starred" | "elo_high" | "elo_low";
type ViewMode = "details" | "snug" | "expanded";

const SORT_OPTIONS: { value: SortOption; label: string }[] = [
  { value: "relationship", label: "Relationship type" },
  { value: "added", label: "Added date" },
  { value: "starred", label: "Starred" },
  { value: "elo_high", label: "ELO score (high)" },
  { value: "elo_low", label: "ELO score (low)" },
];

const VIEW_OPTIONS: { value: ViewMode; label: string; icon: React.ReactNode }[] = [
  { value: "details", label: "Details", icon: <LayoutList className="h-4 w-4" /> },
  { value: "snug", label: "Snug", icon: <LayoutGrid className="h-4 w-4" /> },
  { value: "expanded", label: "Expanded", icon: <Maximize2 className="h-4 w-4" /> },
];

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
  const [sortBy, setSortBy] = useState<SortOption>("relationship");
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    const saved = localStorage.getItem("people-list-view-mode");
    return (saved as ViewMode) || "snug";
  });
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
    queryKey: ["/api/people/paginated", { sortBy }],
    queryFn: async ({ pageParam = 0 }) => {
      const response = await fetch(`/api/people/paginated?offset=${pageParam}&limit=30&sortBy=${sortBy}`);
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

  const showEloBadge = sortBy === "elo_high" || sortBy === "elo_low";

  return (
    <div className="flex flex-col h-full overflow-auto" ref={scrollContainerRef}>
      <div className="border-b px-6 py-4 sticky top-0 z-10 backdrop-blur-xl bg-background/70">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <h1 className="text-3xl font-semibold" data-testid="text-page-title">
            People
          </h1>
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-2">
              <ArrowUpDown className="h-4 w-4 text-muted-foreground" />
              <Select
                value={sortBy}
                onValueChange={(val) => setSortBy(val as SortOption)}
              >
                <SelectTrigger className="w-48" data-testid="select-sort-by">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SORT_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value} data-testid={`select-item-sort-${opt.value}`}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2">
              <Select
                value={viewMode}
                onValueChange={(val) => {
                  const mode = val as ViewMode;
                  setViewMode(mode);
                  localStorage.setItem("people-list-view-mode", mode);
                }}
              >
                <SelectTrigger className="w-40" data-testid="select-view-mode">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {VIEW_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value} data-testid={`select-item-view-${opt.value}`}>
                      <span className="flex items-center gap-2">
                        {opt.icon}
                        {opt.label}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button onClick={() => setIsAddDialogOpen(true)} data-testid="button-add-person">
              <Plus className="h-4 w-4" />
              Add Person
            </Button>
          </div>
        </div>
      </div>

      <div className="flex-1 px-3 md:px-6 py-6">
        {isLoading ? (
          <>
            {/* Details View Skeleton */}
            {viewMode === "details" && (
              <div className="overflow-x-auto">
                <table className="w-full text-sm" data-testid="table-people-details-skeleton">
                  <thead>
                    <tr className="border-b text-left text-muted-foreground">
                      <th className="py-2 px-3 font-medium">Name</th>
                      <th className="py-2 px-3 font-medium">Relationship</th>
                      <th className="py-2 px-3 font-medium">Tags</th>
                      <th className="py-2 px-3 font-medium w-10"></th>
                      <th className="py-2 px-3 font-medium">Phone</th>
                      <th className="py-2 px-3 font-medium">Email</th>
                      <th className="py-2 px-3 font-medium">Social</th>
                      <th className="py-2 px-3 font-medium w-10"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {[1, 2, 3, 4, 5].map((i) => (
                      <tr key={i} className="border-b">
                        <td className="py-2 px-3"><Skeleton className="h-4 w-24" /></td>
                        <td className="py-2 px-3"><Skeleton className="h-4 w-16" /></td>
                        <td className="py-2 px-3">
                          <div className="flex gap-1">
                            <Skeleton className="h-4 w-12" />
                            <Skeleton className="h-4 w-8" />
                          </div>
                        </td>
                        <td className="py-2 px-3"><Skeleton className="h-4 w-4" /></td>
                        <td className="py-2 px-3"><Skeleton className="h-4 w-20" /></td>
                        <td className="py-2 px-3"><Skeleton className="h-4 w-32" /></td>
                        <td className="py-2 px-3"><Skeleton className="h-4 w-8" /></td>
                        <td className="py-2 px-3"><Skeleton className="h-4 w-4" /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Snug View Skeleton */}
            {viewMode === "snug" && (
              <div className="flex flex-col gap-[5px]" data-testid="people-snug-skeleton">
                {[1, 2, 3, 4, 5].map((i) => (
                  <Card key={i} className="p-2">
                    <div className="flex items-center gap-2">
                      <Skeleton className="w-12 h-12 rounded-full" />
                      <div className="flex-1 space-y-1">
                        <div className="flex items-center gap-2">
                          <Skeleton className="h-4 w-1/4" />
                          <Skeleton className="h-4 w-4" />
                        </div>
                        <Skeleton className="h-3 w-1/3" />
                        <div className="flex gap-1 mt-1">
                          <Skeleton className="h-3.5 w-12" />
                          <Skeleton className="h-3.5 w-16" />
                        </div>
                      </div>
                      <Skeleton className="h-8 w-8 rounded-md" />
                    </div>
                  </Card>
                ))}
              </div>
            )}

            {/* Expanded View Skeleton */}
            {viewMode === "expanded" && (
              <div className="flex flex-col gap-3" data-testid="people-expanded-skeleton">
                {[1, 2, 3, 4].map((i) => (
                  <Card key={i} className="p-4">
                    <div className="flex items-center gap-4">
                      <Skeleton className="w-20 h-20 rounded-full" />
                      <div className="flex-1 space-y-2">
                        <div className="flex items-center gap-3">
                          <Skeleton className="h-6 w-1/3" />
                          <Skeleton className="h-6 w-6" />
                        </div>
                        <Skeleton className="h-4 w-24" />
                        <Skeleton className="h-3 w-1/4" />
                        <div className="flex gap-1 mt-2">
                          <Skeleton className="h-4 w-16" />
                          <Skeleton className="h-4 w-20" />
                        </div>
                      </div>
                      <Skeleton className="h-8 w-8 rounded-md" />
                    </div>
                  </Card>
                ))}
              </div>
            )}
          </>
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
          <>
            {/* Details View - Table-like */}
            {viewMode === "details" && (
              <div className="overflow-x-auto">
                <table className="w-full text-sm" data-testid="table-people-details">
                  <thead>
                    <tr className="border-b text-left text-muted-foreground">
                      <th className="py-2 px-3 font-medium">Name</th>
                      <th className="py-2 px-3 font-medium">Relationship</th>
                      <th className="py-2 px-3 font-medium">Tags</th>
                      <th className="py-2 px-3 font-medium w-10"></th>
                      <th className="py-2 px-3 font-medium">Phone</th>
                      <th className="py-2 px-3 font-medium">Email</th>
                      <th className="py-2 px-3 font-medium">Social</th>
                      <th className="py-2 px-3 font-medium w-10"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {people.map((person) => {
                      const isIsolated = !person.relationshipTypeName && person.groupCount === 0;
                      const starredVal = starredStates[person.id] ?? (person.isStarred || 0);
                      return (
                        <tr
                          key={person.id}
                          className="border-b hover:bg-muted/50 transition-colors cursor-pointer"
                          style={isIsolated ? { backgroundColor: 'var(--isolated-bg)' } : undefined}
                          data-testid={`row-person-${person.id}`}
                        >
                          <td className="py-2 px-3">
                            <Link href={`/person/${person.id}`} className="font-medium hover:underline" data-testid={`text-name-${person.id}`}>
                              {person.firstName} {person.lastName}
                            </Link>
                          </td>
                          <td className="py-2 px-3">
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
                          </td>
                          <td className="py-2 px-3">
                            <div className="flex flex-wrap gap-1">
                              {person.tags && person.tags.map((tag, idx) => (
                                <Badge key={idx} variant="secondary" className="text-xs">
                                  {tag}
                                </Badge>
                              ))}
                            </div>
                          </td>
                          <td className="py-2 px-3">
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
                              <Star className={`h-4 w-4 ${starredVal === 1 ? "fill-current" : ""}`} />
                            </Button>
                          </td>
                          <td className="py-2 px-3 text-muted-foreground">
                            {person.phone && (
                              <span className="flex items-center gap-1" data-testid={`text-phone-${person.id}`}>
                                <Phone className="h-3 w-3" />
                                {person.phone}
                              </span>
                            )}
                          </td>
                          <td className="py-2 px-3 text-muted-foreground">
                            {person.email && (
                              <a
                                href={`mailto:${person.email}`}
                                className="flex items-center gap-1 hover:underline"
                                onClick={(e) => e.stopPropagation()}
                                data-testid={`text-email-${person.id}`}
                              >
                                <Mail className="h-3 w-3" />
                                {person.email}
                              </a>
                            )}
                          </td>
                          <td className="py-2 px-3">
                            {person.socialAccountUuids && person.socialAccountUuids.length > 0 && (
                              <Link href={`/person/${person.id}`}>
                                <Badge variant="outline" className="text-xs cursor-pointer" data-testid={`badge-social-${person.id}`}>
                                  <ExternalLink className="h-3 w-3 mr-1" />
                                  {person.socialAccountUuids.length}
                                </Badge>
                              </Link>
                            )}
                          </td>
                          <td className="py-2 px-3">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6 text-destructive hover:text-destructive hover:bg-destructive/10"
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                setPersonToDelete(person);
                              }}
                              data-testid={`button-delete-${person.id}`}
                            >
                              <X className="h-3 w-3" />
                            </Button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {/* Snug View - Current layout */}
            {viewMode === "snug" && (
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
                            <h3 className="text-sm md:text-lg font-medium" data-testid={`text-name-${person.id}`}>
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
                          <div className="flex items-center gap-1 text-xs md:text-sm text-muted-foreground">
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
                            {showEloBadge && (
                              <Badge
                                variant="secondary"
                                className="text-[0.65rem] md:text-xs"
                                data-testid={`badge-elo-${person.id}`}
                              >
                                <Trophy className="h-3 w-3 mr-1" />
                                {person.eloScore}
                              </Badge>
                            )}
                            {sortBy === "added" && person.createdAt && (
                              <Badge
                                variant="secondary"
                                className="text-[0.65rem] md:text-xs"
                                data-testid={`badge-added-${person.id}`}
                              >
                                <CalendarDays className="h-3 w-3 mr-1" />
                                {new Date(person.createdAt).toLocaleDateString()}
                              </Badge>
                            )}
                            {person.relationshipTypeName && (
                              <Badge
                                variant="secondary"
                                className="text-[0.65rem] md:text-xs"
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
                              <Badge key={idx} variant="secondary" className="text-[0.65rem] md:text-xs">
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
              </div>
            )}

            {/* Expanded View - Large profile images and fonts */}
            {viewMode === "expanded" && (
              <div className="flex flex-col gap-3">
                {people.map((person) => {
                  const isIsolated = !person.relationshipTypeName && person.groupCount === 0;
                  const starredVal = starredStates[person.id] ?? (person.isStarred || 0);
                  return (
                  <Link key={person.id} href={`/person/${person.id}`}>
                    <Card
                      className="p-4 hover-elevate transition-all cursor-pointer"
                      style={isIsolated ? { backgroundColor: 'var(--isolated-bg)' } : undefined}
                      data-testid={`card-person-${person.id}`}
                    >
                      <div className="flex items-center gap-4">
                        <Avatar className="w-20 h-20">
                          {person.imageUrl && (
                            <AvatarImage src={person.imageUrl} alt={`${person.firstName} ${person.lastName}`} />
                          )}
                          <AvatarFallback className="text-xl">
                            {getInitials(person.firstName, person.lastName)}
                          </AvatarFallback>
                        </Avatar>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-3">
                            <h3 className="text-xl md:text-2xl font-semibold" data-testid={`text-name-${person.id}`}>
                              {person.firstName} {person.lastName}
                            </h3>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-yellow-500 hover:text-yellow-600 p-0"
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                handleStarClick(person);
                              }}
                              data-testid={`button-star-${person.id}`}
                            >
                              <Star className={`h-6 w-6 ${starredVal === 1 ? "fill-current" : ""}`} />
                            </Button>
                          </div>
                          {person.relationshipTypeName && (
                            <Badge
                              variant="secondary"
                              className="text-sm mt-1"
                              style={{
                                backgroundColor: person.relationshipTypeColor || undefined,
                                color: 'white',
                              }}
                              data-testid={`badge-relationship-${person.id}`}
                            >
                              {person.relationshipTypeName}
                            </Badge>
                          )}
                          <div className="flex items-center gap-1 text-sm text-muted-foreground mt-1">
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
                          <div className="flex flex-wrap gap-1 mt-2">
                            {showEloBadge && (
                              <Badge
                                variant="secondary"
                                className="text-xs"
                                data-testid={`badge-elo-${person.id}`}
                              >
                                <Trophy className="h-3 w-3 mr-1" />
                                {person.eloScore}
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
              </div>
            )}

            {isFetchingNextPage && (
              <div className="flex justify-center py-4">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                  Loading more...
                </div>
              </div>
            )}
          </>
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

      <PersonDialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen} />

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
