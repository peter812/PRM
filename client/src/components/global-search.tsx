import { useState, useRef, useEffect } from "react";
import { Search as SearchIcon, Sparkles, Calendar, FileText, AtSign, BookOpen, MessageSquare } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useLocation } from "wouter";
import { getInitials } from "@/lib/utils";
import type { Person, Group, Interaction, Note, SocialAccountWithCurrentProfile, DailyNote, AiChat, MegaSearchResult, UuidLookupResult } from "@shared/schema";
import {
  type SearchCategory,
  type SearchPreferences,
  loadPreferences,
  CATEGORY_LABELS,
  CATEGORY_ICONS,
} from "@/lib/search-preferences";

export function GlobalSearch() {
  const [searchQuery, setSearchQuery] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [preferences, setPreferences] = useState<SearchPreferences>(loadPreferences);
  const [isSuperSearchActive, setIsSuperSearchActive] = useState(false);
  const [, setLocation] = useLocation();
  const containerRef = useRef<HTMLDivElement>(null);

  // UUID detection regex
  const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const isUuidQuery = UUID_REGEX.test(searchQuery.trim());

  const queryParams = new URLSearchParams();
  queryParams.set('q', searchQuery);
  Object.entries(preferences.enabled).forEach(([key, value]) => {
    const paramName = key === 'people' ? 'includePeople' :
      key === 'groups' ? 'includeGroups' :
        key === 'interactions' ? 'includeInteractions' :
          key === 'notes' ? 'includeNotes' :
            key === 'dailyNotes' ? 'includeDailyNotes' :
              key === 'chats' ? 'includeChats' :
                'includeSocialProfiles';
    queryParams.set(paramName, value.toString());
  });

  const { data: results } = useQuery<MegaSearchResult>({
    queryKey: searchQuery.length > 0 && !isUuidQuery ? [`/api/mega-search?${queryParams.toString()}`] : ["/api/mega-search"],
    enabled: searchQuery.length > 0 && !isUuidQuery,
  });

  // UUID lookup query
  const { data: uuidResult } = useQuery<UuidLookupResult>({
    queryKey: [`/api/uuid-lookup/${searchQuery.trim()}`],
    enabled: isUuidQuery,
  });

  const { data: vectorStatus } = useQuery<{ enabled: boolean; collectionReady: boolean }>({
    queryKey: ["/api/vector/universal/status"],
  });

  const isSuperSearchReady = !!(vectorStatus?.enabled && vectorStatus?.collectionReady);

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

  useEffect(() => {
    const handlePreferencesChanged = () => {
      setPreferences(loadPreferences());
    };
    window.addEventListener('searchPreferencesChanged', handlePreferencesChanged);
    return () => window.removeEventListener('searchPreferencesChanged', handlePreferencesChanged);
  }, []);

  const handleNavigate = (path: string) => {
    setLocation(path);
    setSearchQuery("");
    setIsOpen(false);
    setIsSuperSearchActive(false);
  };

  const totalResults =
    (results?.people?.length || 0) +
    (results?.groups?.length || 0) +
    (results?.interactions?.length || 0) +
    (results?.notes?.length || 0) +
    (results?.socialProfiles?.length || 0) +
    (results?.dailyNotes?.length || 0) +
    (results?.chats?.length || 0);

  const renderCategory = (category: SearchCategory) => {
    if (!preferences.enabled[category]) return null;

    const Icon = CATEGORY_ICONS[category];
    const label = CATEGORY_LABELS[category];

    switch (category) {
      case 'people': {
        const items = results?.people?.slice(0, 4) || [];
        if (items.length === 0) return null;
        return (
          <div key={category}>
            <div className="px-3 py-2 text-xs font-medium text-muted-foreground flex items-center gap-2 border-t first:border-t-0">
              <Icon className="h-3 w-3" />
              {label}
            </div>
            {items.map((person) => (
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
        );
      }
      case 'groups': {
        const items = results?.groups?.slice(0, 4) || [];
        if (items.length === 0) return null;
        return (
          <div key={category}>
            <div className="px-3 py-2 text-xs font-medium text-muted-foreground flex items-center gap-2 border-t">
              <Icon className="h-3 w-3" />
              {label}
            </div>
            {items.map((group) => (
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
                      {getInitials(group.name)}
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
        );
      }
      case 'interactions': {
        const items = results?.interactions?.slice(0, 4) || [];
        if (items.length === 0) return null;
        return (
          <div key={category}>
            <div className="px-3 py-2 text-xs font-medium text-muted-foreground flex items-center gap-2 border-t">
              <Icon className="h-3 w-3" />
              {label}
            </div>
            {items.map((interaction) => (
              <button
                key={interaction.id}
                onClick={() => {
                  if (interaction.peopleIds && interaction.peopleIds.length > 0) {
                    handleNavigate(`/person/${interaction.peopleIds[0]}`);
                  }
                }}
                className="w-full px-3 py-2 hover-elevate active-elevate-2 text-left"
                data-testid={`result-interaction-${interaction.id}`}
              >
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center">
                    <Calendar className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm truncate">
                      {interaction.title || 'Interaction'}
                    </div>
                    {interaction.description && (
                      <div className="text-xs text-muted-foreground truncate">
                        {interaction.description}
                      </div>
                    )}
                  </div>
                </div>
              </button>
            ))}
          </div>
        );
      }
      case 'notes': {
        const items = results?.notes?.slice(0, 4) || [];
        if (items.length === 0) return null;
        return (
          <div key={category}>
            <div className="px-3 py-2 text-xs font-medium text-muted-foreground flex items-center gap-2 border-t">
              <Icon className="h-3 w-3" />
              {label}
            </div>
            {items.map((note) => (
              <button
                key={note.id}
                onClick={() => handleNavigate(`/person/${note.personId}`)}
                className="w-full px-3 py-2 hover-elevate active-elevate-2 text-left"
                data-testid={`result-note-${note.id}`}
              >
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center">
                    <FileText className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm truncate">
                      {note.content}
                    </div>
                  </div>
                </div>
              </button>
            ))}
          </div>
        );
      }
      case 'socialProfiles': {
        const items = results?.socialProfiles?.slice(0, 4) || [];
        if (items.length === 0) return null;
        return (
          <div key={category}>
            <div className="px-3 py-2 text-xs font-medium text-muted-foreground flex items-center gap-2 border-t">
              <Icon className="h-3 w-3" />
              {label}
            </div>
            {items.map((account) => (
              <button
                key={account.id}
                onClick={() => {
                  handleNavigate(`/social-accounts/${account.id}`);
                }}
                className="w-full px-3 py-2 hover-elevate active-elevate-2 text-left"
                data-testid={`result-social-${account.id}`}
              >
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center">
                    <AtSign className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm truncate">
                      @{account.username}
                    </div>
                    {account.currentProfile?.accountUrl && (
                      <div className="text-xs text-muted-foreground truncate">
                        {account.currentProfile?.accountUrl}
                      </div>
                    )}
                  </div>
                </div>
              </button>
            ))}
          </div>
        );
      }
      case 'dailyNotes': {
        const items = results?.dailyNotes?.slice(0, 4) || [];
        if (items.length === 0) return null;
        return (
          <div key={category}>
            <div className="px-3 py-2 text-xs font-medium text-muted-foreground flex items-center gap-2 border-t">
              <Icon className="h-3 w-3" />
              {label}
            </div>
            {items.map((dailyNote) => (
              <button
                key={dailyNote.id}
                onClick={() => handleNavigate(`/daily-notes/${dailyNote.id}`)}
                className="w-full px-3 py-2 hover-elevate active-elevate-2 text-left"
                data-testid={`result-daily-note-${dailyNote.id}`}
              >
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center">
                    <BookOpen className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm truncate">
                      {dailyNote.userTitle || dailyNote.date}
                    </div>
                    {dailyNote.body && (
                      <div className="text-xs text-muted-foreground truncate">
                        {dailyNote.body}
                      </div>
                    )}
                  </div>
                </div>
              </button>
            ))}
          </div>
        );
      }
      case 'chats': {
        const items = results?.chats?.slice(0, 4) || [];
        if (items.length === 0) return null;
        return (
          <div key={category}>
            <div className="px-3 py-2 text-xs font-medium text-muted-foreground flex items-center gap-2 border-t">
              <Icon className="h-3 w-3" />
              {label}
            </div>
            {items.map((chat) => (
              <button
                key={chat.id}
                onClick={() => handleNavigate(`/ai-chat-demo/${chat.id}`)}
                className="w-full px-3 py-2 hover-elevate active-elevate-2 text-left"
                data-testid={`result-chat-${chat.id}`}
              >
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center">
                    <MessageSquare className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm truncate">
                      {chat.title}
                    </div>
                  </div>
                </div>
              </button>
            ))}
          </div>
        );
      }
      default:
        return null;
    }
  };

  return (
    <div className="relative flex-1 max-w-2xl" ref={containerRef}>
      <div className="relative flex items-center">
        <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
        <Input
          type="search"
          placeholder={isSuperSearchActive ? "Super Search..." : "Search..."}
          className={`pl-9 transition-all duration-300 ${isSuperSearchReady ? "pr-20" : "pr-10"} ${
            isSuperSearchActive
              ? "border-red-500 focus-visible:ring-red-500 shadow-[0_0_10px_2px_rgba(239,68,68,0.3)] focus:shadow-[0_0_12px_3px_rgba(239,68,68,0.5)] dark:border-red-500/80 dark:focus-visible:ring-red-500 dark:shadow-[0_0_12px_rgba(239,68,68,0.4)]"
              : ""
          }`}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          onFocus={() => searchQuery.length > 0 && setIsOpen(true)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && searchQuery.trim()) {
              if (isSuperSearchActive && isSuperSearchReady) {
                setIsOpen(false);
                setIsSuperSearchActive(false);
                setLocation(`/super-search?q=${encodeURIComponent(searchQuery.trim())}`);
              }
            }
          }}
          data-testid="input-global-search"
        />
        <div className="absolute right-1 top-1/2 -translate-y-1/2 flex items-center gap-0.5">
          {isSuperSearchReady && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className={`h-7 w-7 transition-colors ${
                    isSuperSearchActive
                      ? "text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/50 bg-red-50 dark:bg-red-950/30"
                      : "text-blue-500 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-950"
                  }`}
                  onClick={() => {
                    setIsSuperSearchActive(!isSuperSearchActive);
                  }}
                  data-testid="btn-super-search"
                >
                  <Sparkles className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>
                  {isSuperSearchActive
                    ? "Disable Super Search (AI-powered)"
                    : "Super Search — AI-powered semantic search"}
                </p>
              </TooltipContent>
            </Tooltip>
          )}
        </div>
      </div>

      {isOpen && searchQuery.length > 0 && (
        <Card className="absolute top-full mt-1 w-full max-h-96 overflow-auto z-50" data-testid="card-search-results">
          {isUuidQuery ? (
            uuidResult ? (
              <div className="py-2">
                <div className="px-3 py-2 text-xs font-medium text-muted-foreground flex items-center gap-2">
                  <SearchIcon className="h-3 w-3" />
                  UUID Match
                </div>
                <button
                  onClick={() => handleNavigate(uuidResult.route)}
                  className="w-full px-3 py-2 hover-elevate active-elevate-2 text-left"
                  data-testid="result-uuid-match"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center">
                      <SearchIcon className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-sm truncate">
                        {uuidResult.type === 'person' ? 'Person' : uuidResult.type === 'social_account' ? 'Social Account' : 'Image'}
                      </div>
                      <div className="text-xs text-muted-foreground truncate">
                        {uuidResult.id}
                      </div>
                    </div>
                    <Badge variant="secondary" className="text-xs">
                      {uuidResult.type.replace('_', ' ')}
                    </Badge>
                  </div>
                </button>
              </div>
            ) : (
              <div className="p-4 text-center text-sm text-muted-foreground">
                No match found for this UUID
              </div>
            )
          ) : totalResults === 0 ? (
            <div className="p-4 text-center text-sm text-muted-foreground">
              No results found
            </div>
          ) : (
            <div className="py-2">
              {preferences.order.map(category => renderCategory(category))}
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
