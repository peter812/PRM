import { useState, useRef, useEffect, useLayoutEffect } from "react";
import { Search as SearchIcon, Sparkles, Calendar, FileText, AtSign, BookOpen, MessageSquare, ChevronDown, LayoutGrid, History, X } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import {
  type SearchHistoryItem,
  loadSearchHistory,
  addToSearchHistory,
  removeFromSearchHistory,
  clearSearchHistory,
} from "@/lib/search-history";

function HistoryChip() {
  return (
    <Badge
      variant="secondary"
      className="text-[10px] px-1.5 py-0 h-4 font-normal text-muted-foreground bg-muted/80 border shrink-0"
    >
      history
    </Badge>
  );
}

type SearchTypeFilter = 'all' | SearchCategory;

export function GlobalSearch() {
  const [searchQuery, setSearchQuery] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [preferences, setPreferences] = useState<SearchPreferences>(loadPreferences);
  const [history, setHistory] = useState<SearchHistoryItem[]>(loadSearchHistory);
  const [isSuperSearchActive, setIsSuperSearchActive] = useState(false);
  const [typeFilter, setTypeFilter] = useState<SearchTypeFilter>('all');
  const [leadingWidth, setLeadingWidth] = useState(0);
  const [, setLocation] = useLocation();
  const containerRef = useRef<HTMLDivElement>(null);
  const leadingRef = useRef<HTMLDivElement>(null);

  // Keep the input's left padding in sync with the width of the type dropdown + search icon.
  useLayoutEffect(() => {
    const el = leadingRef.current;
    if (!el) return;
    const update = () => setLeadingWidth(el.getBoundingClientRect().width);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // An explicit type selection overrides the per-category preferences; "all" respects them.
  const effectiveEnabled: Record<SearchCategory, boolean> = typeFilter === 'all'
    ? preferences.enabled
    : (Object.fromEntries(
        preferences.order.map((category) => [category, category === typeFilter])
      ) as Record<SearchCategory, boolean>);

  const TypeFilterIcon = typeFilter === 'all' ? LayoutGrid : CATEGORY_ICONS[typeFilter];
  const typeFilterLabel = typeFilter === 'all' ? 'All' : CATEGORY_LABELS[typeFilter];

  // UUID detection regex
  const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const isUuidQuery = UUID_REGEX.test(searchQuery.trim());

  const queryParams = new URLSearchParams();
  queryParams.set('q', searchQuery);
  Object.entries(effectiveEnabled).forEach(([key, value]) => {
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
    const handleHistoryChanged = () => {
      setHistory(loadSearchHistory());
    };
    window.addEventListener('searchPreferencesChanged', handlePreferencesChanged);
    window.addEventListener('searchHistoryChanged', handleHistoryChanged);
    return () => {
      window.removeEventListener('searchPreferencesChanged', handlePreferencesChanged);
      window.removeEventListener('searchHistoryChanged', handleHistoryChanged);
    };
  }, []);

  const handleNavigate = (path: string) => {
    setLocation(path);
    setSearchQuery("");
    setIsOpen(false);
    setIsSuperSearchActive(false);
  };

  const handleSelect = (item: {
    id: string | number;
    category: SearchCategory;
    title: string;
    subtitle?: string;
    url: string;
    imageUrl?: string | null;
  }) => {
    addToSearchHistory({
      id: `${item.category}:${item.id}`,
      category: item.category,
      title: item.title,
      subtitle: item.subtitle,
      url: item.url,
      imageUrl: item.imageUrl,
    });
    handleNavigate(item.url);
  };

  const isHistoryMatch = (category: SearchCategory, id: string | number, title: string) => {
    const normTitle = title.trim().toLowerCase();
    const targetId = `${category}:${id}`;
    return history.some(
      (h) => h.id === targetId || (normTitle && h.title.trim().toLowerCase() === normTitle)
    );
  };

  const sortWithHistory = <T extends { id: any }>(
    category: SearchCategory,
    items: T[] | undefined,
    getTitle: (item: T) => string
  ) => {
    if (!items || items.length === 0) return [];
    const mapped = items.map((item) => {
      const title = getTitle(item);
      return {
        item,
        title,
        inHistory: isHistoryMatch(category, item.id, title),
      };
    });
    mapped.sort((a, b) => (b.inHistory ? 1 : 0) - (a.inHistory ? 1 : 0));
    return mapped.slice(0, 4);
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
    if (!effectiveEnabled[category]) return null;

    const Icon = CATEGORY_ICONS[category];
    const label = CATEGORY_LABELS[category];

    switch (category) {
      case 'people': {
        const entries = sortWithHistory(
          'people',
          results?.people,
          (p) => `${p.firstName} ${p.lastName}`
        );
        if (entries.length === 0) return null;
        return (
          <div key={category}>
            <div className="px-3 py-2 text-xs font-medium text-muted-foreground flex items-center gap-2 border-t first:border-t-0">
              <Icon className="h-3 w-3" />
              {label}
            </div>
            {entries.map(({ item: person, title: fullName, inHistory }) => (
              <button
                key={person.id}
                onClick={() =>
                  handleSelect({
                    id: person.id,
                    category: 'people',
                    title: fullName,
                    subtitle: [person.company, person.title].filter(Boolean).join(" • "),
                    url: `/person/${person.id}`,
                    imageUrl: person.imageUrl,
                  })
                }
                className="w-full px-3 py-2 hover-elevate active-elevate-2 text-left"
                data-testid={`result-person-${person.id}`}
              >
                <div className="flex items-center gap-3">
                  <Avatar className="w-8 h-8">
                    {person.imageUrl && (
                      <AvatarImage src={person.imageUrl} alt={fullName} />
                    )}
                    <AvatarFallback className="text-xs">
                      {getInitials(person.firstName, person.lastName)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="font-medium text-sm truncate">{fullName}</span>
                      {inHistory && <HistoryChip />}
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
        const entries = sortWithHistory(
          'groups',
          results?.groups,
          (g) => g.name
        );
        if (entries.length === 0) return null;
        return (
          <div key={category}>
            <div className="px-3 py-2 text-xs font-medium text-muted-foreground flex items-center gap-2 border-t">
              <Icon className="h-3 w-3" />
              {label}
            </div>
            {entries.map(({ item: group, title: groupName, inHistory }) => (
              <button
                key={group.id}
                onClick={() =>
                  handleSelect({
                    id: group.id,
                    category: 'groups',
                    title: groupName,
                    url: `/group/${group.id}`,
                    imageUrl: group.imageUrl,
                  })
                }
                className="w-full px-3 py-2 hover-elevate active-elevate-2 text-left"
                data-testid={`result-group-${group.id}`}
              >
                <div className="flex items-center gap-3">
                  <Avatar className="w-8 h-8">
                    {group.imageUrl && (
                      <AvatarImage src={group.imageUrl} alt={groupName} />
                    )}
                    <AvatarFallback
                      className="text-xs"
                      style={{ backgroundColor: group.color }}
                    >
                      {getInitials(groupName)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="font-medium text-sm truncate">{groupName}</span>
                      {inHistory && <HistoryChip />}
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
        const entries = sortWithHistory(
          'interactions',
          results?.interactions,
          (i) => i.title || 'Interaction'
        );
        if (entries.length === 0) return null;
        return (
          <div key={category}>
            <div className="px-3 py-2 text-xs font-medium text-muted-foreground flex items-center gap-2 border-t">
              <Icon className="h-3 w-3" />
              {label}
            </div>
            {entries.map(({ item: interaction, title, inHistory }) => (
              <button
                key={interaction.id}
                onClick={() => {
                  if (interaction.peopleIds && interaction.peopleIds.length > 0) {
                    handleSelect({
                      id: interaction.id,
                      category: 'interactions',
                      title,
                      subtitle: interaction.description || undefined,
                      url: `/person/${interaction.peopleIds[0]}`,
                    });
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
                    <div className="flex items-center gap-1.5">
                      <span className="font-medium text-sm truncate">{title}</span>
                      {inHistory && <HistoryChip />}
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
        const entries = sortWithHistory(
          'notes',
          results?.notes,
          (n) => n.content
        );
        if (entries.length === 0) return null;
        return (
          <div key={category}>
            <div className="px-3 py-2 text-xs font-medium text-muted-foreground flex items-center gap-2 border-t">
              <Icon className="h-3 w-3" />
              {label}
            </div>
            {entries.map(({ item: note, title, inHistory }) => (
              <button
                key={note.id}
                onClick={() =>
                  handleSelect({
                    id: note.id,
                    category: 'notes',
                    title,
                    url: `/person/${note.personId}`,
                  })
                }
                className="w-full px-3 py-2 hover-elevate active-elevate-2 text-left"
                data-testid={`result-note-${note.id}`}
              >
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center">
                    <FileText className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-sm truncate">{title}</span>
                      {inHistory && <HistoryChip />}
                    </div>
                  </div>
                </div>
              </button>
            ))}
          </div>
        );
      }
      case 'socialProfiles': {
        const entries = sortWithHistory(
          'socialProfiles',
          results?.socialProfiles,
          (a) => `@${a.username}`
        );
        if (entries.length === 0) return null;
        return (
          <div key={category}>
            <div className="px-3 py-2 text-xs font-medium text-muted-foreground flex items-center gap-2 border-t">
              <Icon className="h-3 w-3" />
              {label}
            </div>
            {entries.map(({ item: account, title, inHistory }) => (
              <button
                key={account.id}
                onClick={() => {
                  handleSelect({
                    id: account.id,
                    category: 'socialProfiles',
                    title,
                    subtitle: account.currentProfile?.accountUrl || undefined,
                    url: `/social-accounts/${account.id}`,
                  });
                }}
                className="w-full px-3 py-2 hover-elevate active-elevate-2 text-left"
                data-testid={`result-social-${account.id}`}
              >
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center">
                    <AtSign className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="font-medium text-sm truncate">{title}</span>
                      {inHistory && <HistoryChip />}
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
        const entries = sortWithHistory(
          'dailyNotes',
          results?.dailyNotes,
          (d) => d.userTitle || d.date
        );
        if (entries.length === 0) return null;
        return (
          <div key={category}>
            <div className="px-3 py-2 text-xs font-medium text-muted-foreground flex items-center gap-2 border-t">
              <Icon className="h-3 w-3" />
              {label}
            </div>
            {entries.map(({ item: dailyNote, title, inHistory }) => (
              <button
                key={dailyNote.id}
                onClick={() =>
                  handleSelect({
                    id: dailyNote.id,
                    category: 'dailyNotes',
                    title,
                    subtitle: dailyNote.body || undefined,
                    url: `/daily-notes/${dailyNote.id}`,
                  })
                }
                className="w-full px-3 py-2 hover-elevate active-elevate-2 text-left"
                data-testid={`result-daily-note-${dailyNote.id}`}
              >
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center">
                    <BookOpen className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="font-medium text-sm truncate">{title}</span>
                      {inHistory && <HistoryChip />}
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
        const entries = sortWithHistory(
          'chats',
          results?.chats,
          (c) => c.title
        );
        if (entries.length === 0) return null;
        return (
          <div key={category}>
            <div className="px-3 py-2 text-xs font-medium text-muted-foreground flex items-center gap-2 border-t">
              <Icon className="h-3 w-3" />
              {label}
            </div>
            {entries.map(({ item: chat, title, inHistory }) => (
              <button
                key={chat.id}
                onClick={() =>
                  handleSelect({
                    id: chat.id,
                    category: 'chats',
                    title,
                    url: `/ai-chat-demo/${chat.id}`,
                  })
                }
                className="w-full px-3 py-2 hover-elevate active-elevate-2 text-left"
                data-testid={`result-chat-${chat.id}`}
              >
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center">
                    <MessageSquare className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="font-medium text-sm truncate">{title}</span>
                      {inHistory && <HistoryChip />}
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
        <div
          ref={leadingRef}
          className="absolute left-1 top-1/2 -translate-y-1/2 flex items-center gap-1"
        >
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
                data-testid="btn-search-type-filter"
                aria-label={`Search type: ${typeFilterLabel}`}
              >
                <TypeFilterIcon className="h-3.5 w-3.5" />
                <span>{typeFilterLabel}</span>
                <ChevronDown className="h-3 w-3 opacity-60" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="min-w-[10rem]">
              <DropdownMenuRadioGroup
                value={typeFilter}
                onValueChange={(value) => setTypeFilter(value as SearchTypeFilter)}
              >
                <DropdownMenuRadioItem value="all" data-testid="search-type-all">
                  <LayoutGrid className="h-3.5 w-3.5 mr-2 text-muted-foreground" />
                  All
                </DropdownMenuRadioItem>
                {preferences.order.map((category) => {
                  const Icon = CATEGORY_ICONS[category];
                  return (
                    <DropdownMenuRadioItem
                      key={category}
                      value={category}
                      data-testid={`search-type-${category}`}
                    >
                      <Icon className="h-3.5 w-3.5 mr-2 text-muted-foreground" />
                      {CATEGORY_LABELS[category]}
                    </DropdownMenuRadioItem>
                  );
                })}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
          <SearchIcon className="h-4 w-4 text-muted-foreground pointer-events-none" />
        </div>
        <Input
          type="search"
          placeholder={isSuperSearchActive ? "Super Search..." : "Search..."}
          style={{ paddingLeft: leadingWidth ? leadingWidth + 12 : undefined }}
          className={`pl-9 transition-all duration-300 ${isSuperSearchReady ? "pr-20" : "pr-10"} ${
            isSuperSearchActive
              ? "border-red-500 focus-visible:ring-red-500 shadow-[0_0_10px_2px_rgba(239,68,68,0.3)] focus:shadow-[0_0_12px_3px_rgba(239,68,68,0.5)] dark:border-red-500/80 dark:focus-visible:ring-red-500 dark:shadow-[0_0_12px_rgba(239,68,68,0.4)]"
              : ""
          }`}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          onFocus={() => {
            if (searchQuery.length > 0 || history.length > 0) {
              setIsOpen(true);
            }
          }}
          onClick={() => {
            if (searchQuery.length > 0 || history.length > 0) {
              setIsOpen(true);
            }
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setIsOpen(false);
            } else if (e.key === "Enter" && searchQuery.trim()) {
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

      {isOpen && (searchQuery.trim().length > 0 || history.length > 0) && (
        <Card className="absolute top-full mt-1 w-full max-h-96 overflow-auto z-50" data-testid="card-search-results">
          {searchQuery.trim().length === 0 ? (
            <div className="py-1">
              <div className="px-3 py-1.5 text-xs font-medium text-muted-foreground flex items-center justify-between border-b">
                <span className="flex items-center gap-1.5">
                  <History className="h-3.5 w-3.5" />
                  Recent History
                </span>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    clearSearchHistory();
                  }}
                  className="text-[11px] text-muted-foreground hover:text-foreground transition-colors px-1 py-0.5 rounded hover:bg-muted"
                  data-testid="btn-clear-search-history"
                >
                  Clear all
                </button>
              </div>
              <div className="max-h-80 overflow-y-auto">
                {history.map((item) => {
                  const Icon = CATEGORY_ICONS[item.category] || History;
                  return (
                    <div
                      key={item.id}
                      className="group flex items-center justify-between px-3 py-2 hover-elevate active-elevate-2 cursor-pointer text-left"
                      onClick={() => {
                        addToSearchHistory({
                          id: item.id,
                          category: item.category,
                          title: item.title,
                          subtitle: item.subtitle,
                          url: item.url,
                          imageUrl: item.imageUrl,
                        });
                        handleNavigate(item.url);
                      }}
                      data-testid={`history-item-${item.id}`}
                    >
                      <div className="flex items-center gap-3 min-w-0 flex-1">
                        {item.imageUrl ? (
                          <Avatar className="w-8 h-8 shrink-0">
                            <AvatarImage src={item.imageUrl} alt={item.title} />
                            <AvatarFallback className="text-xs">{getInitials(item.title)}</AvatarFallback>
                          </Avatar>
                        ) : (
                          <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center shrink-0">
                            <Icon className="h-4 w-4 text-muted-foreground" />
                          </div>
                        )}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="font-medium text-sm truncate">{item.title}</span>
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground shrink-0">
                              {CATEGORY_LABELS[item.category] || item.category}
                            </span>
                          </div>
                          {item.subtitle && (
                            <div className="text-xs text-muted-foreground truncate">{item.subtitle}</div>
                          )}
                        </div>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-foreground shrink-0 ml-2"
                        onClick={(e) => {
                          e.stopPropagation();
                          removeFromSearchHistory(item.id);
                        }}
                        title="Remove from history"
                        data-testid={`btn-remove-history-${item.id}`}
                      >
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : isUuidQuery ? (
            uuidResult ? (
              <div className="py-2">
                <div className="px-3 py-2 text-xs font-medium text-muted-foreground flex items-center gap-2">
                  <SearchIcon className="h-3 w-3" />
                  UUID Match
                </div>
                <button
                  onClick={() => {
                    const itemCat: SearchCategory = uuidResult.type === 'person' ? 'people' : uuidResult.type === 'social_account' ? 'socialProfiles' : 'people';
                    handleSelect({
                      id: uuidResult.id,
                      category: itemCat,
                      title: uuidResult.id,
                      subtitle: uuidResult.type.replace('_', ' '),
                      url: uuidResult.route,
                    });
                  }}
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
