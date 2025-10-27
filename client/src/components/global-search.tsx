import { useState, useRef, useEffect } from "react";
import { Search as SearchIcon, Users, Users2 } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { useLocation } from "wouter";
import type { Person, Group } from "@shared/schema";

interface SearchResult {
  people: Person[];
  groups: Group[];
}

export function GlobalSearch() {
  const [searchQuery, setSearchQuery] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [, setLocation] = useLocation();
  const containerRef = useRef<HTMLDivElement>(null);

  const { data: results } = useQuery<SearchResult>({
    queryKey: searchQuery.length > 0 ? [`/api/search?q=${encodeURIComponent(searchQuery)}`] : ["/api/search"],
    enabled: searchQuery.length > 0,
  });

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    if (searchQuery.length > 0) {
      setIsOpen(true);
    } else {
      setIsOpen(false);
    }
  }, [searchQuery]);

  const handleNavigate = (path: string) => {
    setLocation(path);
    setSearchQuery("");
    setIsOpen(false);
  };

  const getInitials = (firstName: string, lastName: string) => {
    return `${firstName[0]}${lastName[0]}`.toUpperCase();
  };

  const getGroupInitials = (name: string) => {
    const words = name.split(" ");
    if (words.length >= 2) {
      return `${words[0][0]}${words[1][0]}`.toUpperCase();
    }
    return name.slice(0, 2).toUpperCase();
  };

  const displayedPeople = results?.people?.slice(0, 6) || [];
  const displayedGroups = results?.groups?.slice(0, 6) || [];
  const totalResults = (results?.people?.length || 0) + (results?.groups?.length || 0);

  // Show up to 6 results total, prioritizing people then groups
  const maxResults = 6;
  let peopleToShow = displayedPeople;
  let groupsToShow = displayedGroups;

  if (displayedPeople.length + displayedGroups.length > maxResults) {
    if (displayedPeople.length >= maxResults) {
      peopleToShow = displayedPeople.slice(0, maxResults);
      groupsToShow = [];
    } else {
      const remainingSlots = maxResults - displayedPeople.length;
      groupsToShow = displayedGroups.slice(0, remainingSlots);
    }
  }

  return (
    <div className="relative flex-1 max-w-md" ref={containerRef}>
      <div className="relative">
        <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          type="search"
          placeholder="Search people and groups..."
          className="pl-9"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          onFocus={() => searchQuery.length > 0 && setIsOpen(true)}
          data-testid="input-global-search"
        />
      </div>

      {isOpen && searchQuery.length > 0 && (
        <Card className="absolute top-full mt-1 w-full max-h-96 overflow-auto z-50" data-testid="card-search-results">
          {totalResults === 0 ? (
            <div className="p-4 text-center text-sm text-muted-foreground">
              No results found
            </div>
          ) : (
            <div className="py-2">
              {peopleToShow.length > 0 && (
                <div>
                  <div className="px-3 py-2 text-xs font-medium text-muted-foreground flex items-center gap-2">
                    <Users className="h-3 w-3" />
                    People
                  </div>
                  {peopleToShow.map((person) => (
                    <button
                      key={person.id}
                      onClick={() => handleNavigate(`/person/${person.id}`)}
                      className="w-full px-3 py-2 hover-elevate active-elevate-2 text-left"
                      data-testid={`result-person-${person.id}`}
                    >
                      <div className="flex items-center gap-3">
                        <Avatar className="w-8 h-8">
                          {person.imageUrl && (
                            <AvatarImage src={person.imageUrl} alt={`${person.firstName} ${person.lastName}`} />
                          )}
                          <AvatarFallback className="text-xs">
                            {getInitials(person.firstName, person.lastName)}
                          </AvatarFallback>
                        </Avatar>
                        <div className="flex-1 min-w-0">
                          <div className="font-medium text-sm truncate">
                            {person.firstName} {person.lastName}
                          </div>
                          {(person.company || person.title) && (
                            <div className="text-xs text-muted-foreground truncate">
                              {person.company}
                              {person.company && person.title && " • "}
                              {person.title}
                            </div>
                          )}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              )}

              {groupsToShow.length > 0 && (
                <div>
                  <div className="px-3 py-2 text-xs font-medium text-muted-foreground flex items-center gap-2 border-t mt-1">
                    <Users2 className="h-3 w-3" />
                    Groups
                  </div>
                  {groupsToShow.map((group) => (
                    <button
                      key={group.id}
                      onClick={() => handleNavigate(`/group/${group.id}`)}
                      className="w-full px-3 py-2 hover-elevate active-elevate-2 text-left"
                      data-testid={`result-group-${group.id}`}
                    >
                      <div className="flex items-center gap-3">
                        <Avatar className="w-8 h-8">
                          {group.imageUrl && (
                            <AvatarImage src={group.imageUrl} alt={group.name} />
                          )}
                          <AvatarFallback 
                            className="text-xs"
                            style={{ backgroundColor: group.color }}
                          >
                            {getGroupInitials(group.name)}
                          </AvatarFallback>
                        </Avatar>
                        <div className="flex-1 min-w-0">
                          <div className="font-medium text-sm truncate">
                            {group.name}
                          </div>
                          {group.type && group.type.length > 0 && (
                            <div className="flex gap-1 mt-1">
                              {group.type.slice(0, 2).map((t, idx) => (
                                <Badge key={idx} variant="secondary" className="text-xs">
                                  {t}
                                </Badge>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
