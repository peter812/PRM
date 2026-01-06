import { useState, useRef, useEffect, useCallback } from "react";
import { Search as SearchIcon, Users, Users2, MoreVertical, GripVertical, FileText, Calendar, AtSign, ChevronUp, ChevronDown } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useLocation } from "wouter";
import type { Person, Group, Interaction, Note, SocialAccount, MegaSearchResult } from "@shared/schema";

type SearchCategory = 'people' | 'groups' | 'interactions' | 'notes' | 'socialProfiles';

interface SearchPreferences {
  order: SearchCategory[];
  enabled: Record<SearchCategory, boolean>;
}

const DEFAULT_PREFERENCES: SearchPreferences = {
  order: ['people', 'groups', 'interactions', 'notes', 'socialProfiles'],
  enabled: {
    people: true,
    groups: true,
    interactions: true,
    notes: true,
    socialProfiles: true,
  },
};

const CATEGORY_LABELS: Record<SearchCategory, string> = {
  people: 'People',
  groups: 'Groups',
  interactions: 'Interactions',
  notes: 'Notes',
  socialProfiles: 'Social Profiles',
};

const CATEGORY_ICONS: Record<SearchCategory, typeof Users> = {
  people: Users,
  groups: Users2,
  interactions: Calendar,
  notes: FileText,
  socialProfiles: AtSign,
};

function loadPreferences(): SearchPreferences {
  try {
    const stored = localStorage.getItem('searchPreferences');
    if (stored) {
      return JSON.parse(stored);
    }
  } catch (e) {
    console.error('Failed to load search preferences:', e);
  }
  return DEFAULT_PREFERENCES;
}

function savePreferences(prefs: SearchPreferences): void {
  try {
    localStorage.setItem('searchPreferences', JSON.stringify(prefs));
  } catch (e) {
    console.error('Failed to save search preferences:', e);
  }
}

function DraggableList({ 
  items, 
  enabled, 
  onReorder, 
  onToggle 
}: { 
  items: SearchCategory[];
  enabled: Record<SearchCategory, boolean>;
  onReorder: (items: SearchCategory[]) => void;
  onToggle: (category: SearchCategory, checked: boolean) => void;
}) {
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  const handleDragStart = (e: React.DragEvent, index: number) => {
    setDraggedIndex(index);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    if (draggedIndex !== null && draggedIndex !== index) {
      setDragOverIndex(index);
    }
  };

  const handleDragEnd = () => {
    if (draggedIndex !== null && dragOverIndex !== null && draggedIndex !== dragOverIndex) {
      const newItems = [...items];
      const [removed] = newItems.splice(draggedIndex, 1);
      newItems.splice(dragOverIndex, 0, removed);
      onReorder(newItems);
    }
    setDraggedIndex(null);
    setDragOverIndex(null);
  };

  const moveItem = (index: number, direction: 'up' | 'down') => {
    const newIndex = direction === 'up' ? index - 1 : index + 1;
    if (newIndex < 0 || newIndex >= items.length) return;
    const newItems = [...items];
    [newItems[index], newItems[newIndex]] = [newItems[newIndex], newItems[index]];
    onReorder(newItems);
  };

  return (
    <div className="space-y-2">
      {items.map((category, index) => {
        const Icon = CATEGORY_ICONS[category];
        const isDragging = draggedIndex === index;
        const isDragOver = dragOverIndex === index;
        
        return (
          <div
            key={category}
            draggable
            onDragStart={(e) => handleDragStart(e, index)}
            onDragOver={(e) => handleDragOver(e, index)}
            onDragEnd={handleDragEnd}
            className={`flex items-center gap-3 p-3 rounded-md border cursor-move transition-colors ${
              isDragging ? 'opacity-50 bg-muted' : ''
            } ${isDragOver ? 'border-primary bg-accent' : 'border-border'}`}
            data-testid={`search-category-${category}`}
          >
            <div className="flex flex-col gap-0.5">
              <Button
                variant="ghost"
                size="icon"
                className="h-5 w-5"
                onClick={() => moveItem(index, 'up')}
                disabled={index === 0}
                data-testid={`move-up-${category}`}
              >
                <ChevronUp className="h-3 w-3" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-5 w-5"
                onClick={() => moveItem(index, 'down')}
                disabled={index === items.length - 1}
                data-testid={`move-down-${category}`}
              >
                <ChevronDown className="h-3 w-3" />
              </Button>
            </div>
            <GripVertical className="h-4 w-4 text-muted-foreground flex-shrink-0" />
            <Checkbox
              checked={enabled[category]}
              onCheckedChange={(checked) => onToggle(category, checked as boolean)}
              data-testid={`checkbox-${category}`}
            />
            <Icon className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium flex-1">{CATEGORY_LABELS[category]}</span>
          </div>
        );
      })}
    </div>
  );
}

export function GlobalSearch() {
  const [searchQuery, setSearchQuery] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [preferences, setPreferences] = useState<SearchPreferences>(loadPreferences);
  const [, setLocation] = useLocation();
  const containerRef = useRef<HTMLDivElement>(null);

  const queryParams = new URLSearchParams();
  queryParams.set('q', searchQuery);
  Object.entries(preferences.enabled).forEach(([key, value]) => {
    const paramName = key === 'people' ? 'includePeople' :
                      key === 'groups' ? 'includeGroups' :
                      key === 'interactions' ? 'includeInteractions' :
                      key === 'notes' ? 'includeNotes' : 'includeSocialProfiles';
    queryParams.set(paramName, value.toString());
  });

  const { data: results } = useQuery<MegaSearchResult>({
    queryKey: searchQuery.length > 0 ? [`/api/mega-search?${queryParams.toString()}`] : ["/api/mega-search"],
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

  const handleReorder = useCallback((newOrder: SearchCategory[]) => {
    const newPrefs = { ...preferences, order: newOrder };
    setPreferences(newPrefs);
    savePreferences(newPrefs);
  }, [preferences]);

  const handleToggle = useCallback((category: SearchCategory, checked: boolean) => {
    const newPrefs = {
      ...preferences,
      enabled: { ...preferences.enabled, [category]: checked },
    };
    setPreferences(newPrefs);
    savePreferences(newPrefs);
  }, [preferences]);

  const handleNavigate = (path: string) => {
    setLocation(path);
    setSearchQuery("");
    setIsOpen(false);
  };

  const getInitials = (firstName: string, lastName: string) => {
    return `${firstName[0] || ''}${lastName[0] || ''}`.toUpperCase();
  };

  const getGroupInitials = (name: string) => {
    const words = name.split(" ");
    if (words.length >= 2) {
      return `${words[0][0]}${words[1][0]}`.toUpperCase();
    }
    return name.slice(0, 2).toUpperCase();
  };

  const totalResults = 
    (results?.people?.length || 0) + 
    (results?.groups?.length || 0) + 
    (results?.interactions?.length || 0) + 
    (results?.notes?.length || 0) + 
    (results?.socialProfiles?.length || 0);

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
                  if (account.accountUrl) {
                    window.open(account.accountUrl, '_blank');
                  }
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
                    {account.accountUrl && (
                      <div className="text-xs text-muted-foreground truncate">
                        {account.accountUrl}
                      </div>
                    )}
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
    <div className="relative flex-1 max-w-md" ref={containerRef}>
      <div className="relative flex items-center">
        <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          type="search"
          placeholder="Search..."
          className="pl-9 pr-9"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          onFocus={() => searchQuery.length > 0 && setIsOpen(true)}
          data-testid="input-global-search"
        />
        <Dialog open={isSettingsOpen} onOpenChange={setIsSettingsOpen}>
          <DialogTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7 z-10"
              data-testid="button-search-settings"
            >
              <MoreVertical className="h-4 w-4" />
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Search Settings</DialogTitle>
              <DialogDescription>
                Customize the order and visibility of search results.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div>
                <h4 className="text-sm font-medium mb-3">Search Order</h4>
                <p className="text-sm text-muted-foreground mb-4">
                  Drag items to reorder how results appear. Uncheck to exclude from search.
                </p>
                <DraggableList
                  items={preferences.order}
                  enabled={preferences.enabled}
                  onReorder={handleReorder}
                  onToggle={handleToggle}
                />
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {isOpen && searchQuery.length > 0 && (
        <Card className="absolute top-full mt-1 w-full max-h-96 overflow-auto z-50" data-testid="card-search-results">
          {totalResults === 0 ? (
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
