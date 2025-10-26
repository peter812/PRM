import { useState } from "react";
import { X, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { Person } from "@shared/schema";

interface OptionsPanelProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  showGroups: boolean;
  onShowGroupsChange: (show: boolean) => void;
  highlightedPersonId: string | null;
  onHighlightedPersonChange: (personId: string | null) => void;
  people: Person[];
}

export function OptionsPanel({
  isOpen,
  onOpenChange,
  showGroups,
  onShowGroupsChange,
  highlightedPersonId,
  onHighlightedPersonChange,
  people,
}: OptionsPanelProps) {
  const [searchOpen, setSearchOpen] = useState(false);

  const highlightedPerson = highlightedPersonId
    ? people.find((p) => p.id === highlightedPersonId)
    : null;

  return (
    <>
      {/* Desktop: Always visible sidebar on the right */}
      <div className="hidden lg:flex lg:flex-col lg:w-80 lg:border-l lg:bg-card">
        <div className="p-4 border-b">
          <h3 className="font-semibold text-lg">Graph Options</h3>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-6">
          {/* Show Groups Toggle */}
          <div className="space-y-3">
            <Label htmlFor="show-groups" className="text-base font-medium">
              Show Groups
            </Label>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">
                Display group nodes on the graph
              </span>
              <Switch
                id="show-groups"
                checked={showGroups}
                onCheckedChange={onShowGroupsChange}
                data-testid="switch-show-groups"
              />
            </div>
          </div>

          {/* User Highlight */}
          <div className="space-y-3">
            <Label className="text-base font-medium">User Highlight</Label>
            <p className="text-sm text-muted-foreground">
              Focus on a specific person and their connections
            </p>
            <Popover open={searchOpen} onOpenChange={setSearchOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  role="combobox"
                  aria-expanded={searchOpen}
                  className="w-full justify-between"
                  data-testid="button-select-person"
                >
                  {highlightedPerson
                    ? `${highlightedPerson.firstName} ${highlightedPerson.lastName}`
                    : "Select person..."}
                  <Search className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-72 p-0" align="start">
                <Command>
                  <CommandInput placeholder="Search people..." />
                  <CommandList>
                    <CommandEmpty>No person found.</CommandEmpty>
                    <CommandGroup>
                      {people.map((person) => (
                        <CommandItem
                          key={person.id}
                          value={`${person.firstName} ${person.lastName}`}
                          onSelect={() => {
                            onHighlightedPersonChange(person.id);
                            setSearchOpen(false);
                          }}
                          data-testid={`option-person-${person.id}`}
                        >
                          {person.firstName} {person.lastName}
                          {person.company && (
                            <span className="ml-2 text-xs text-muted-foreground">
                              {person.company}
                            </span>
                          )}
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>

            {highlightedPerson && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => onHighlightedPersonChange(null)}
                className="w-full"
                data-testid="button-clear-highlight"
              >
                <X className="h-4 w-4 mr-2" />
                Clear Filter
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Mobile: Overlay panel */}
      {isOpen && (
        <div
          className="lg:hidden fixed inset-0 bg-background/80 backdrop-blur-sm z-50"
          onClick={() => onOpenChange(false)}
        >
          <div
            className="fixed right-0 top-0 bottom-0 w-80 bg-card border-l shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-4 border-b flex items-center justify-between">
              <h3 className="font-semibold text-lg">Graph Options</h3>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => onOpenChange(false)}
                data-testid="button-close-options-mobile"
              >
                <X className="h-5 w-5" />
              </Button>
            </div>
            <div className="overflow-y-auto p-4 space-y-6 h-[calc(100%-73px)]">
              {/* Show Groups Toggle */}
              <div className="space-y-3">
                <Label htmlFor="show-groups-mobile" className="text-base font-medium">
                  Show Groups
                </Label>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">
                    Display group nodes on the graph
                  </span>
                  <Switch
                    id="show-groups-mobile"
                    checked={showGroups}
                    onCheckedChange={onShowGroupsChange}
                    data-testid="switch-show-groups-mobile"
                  />
                </div>
              </div>

              {/* User Highlight */}
              <div className="space-y-3">
                <Label className="text-base font-medium">User Highlight</Label>
                <p className="text-sm text-muted-foreground">
                  Focus on a specific person and their connections
                </p>
                <Popover open={searchOpen} onOpenChange={setSearchOpen}>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      role="combobox"
                      aria-expanded={searchOpen}
                      className="w-full justify-between"
                      data-testid="button-select-person-mobile"
                    >
                      {highlightedPerson
                        ? `${highlightedPerson.firstName} ${highlightedPerson.lastName}`
                        : "Select person..."}
                      <Search className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-72 p-0" align="start">
                    <Command>
                      <CommandInput placeholder="Search people..." />
                      <CommandList>
                        <CommandEmpty>No person found.</CommandEmpty>
                        <CommandGroup>
                          {people.map((person) => (
                            <CommandItem
                              key={person.id}
                              value={`${person.firstName} ${person.lastName}`}
                              onSelect={() => {
                                onHighlightedPersonChange(person.id);
                                setSearchOpen(false);
                              }}
                              data-testid={`option-person-mobile-${person.id}`}
                            >
                              {person.firstName} {person.lastName}
                              {person.company && (
                                <span className="ml-2 text-xs text-muted-foreground">
                                  {person.company}
                                </span>
                              )}
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>

                {highlightedPerson && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => onHighlightedPersonChange(null)}
                    className="w-full"
                    data-testid="button-clear-highlight-mobile"
                  >
                    <X className="h-4 w-4 mr-2" />
                    Clear Filter
                  </Button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
