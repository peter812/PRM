import { useState } from "react";
import { X, Search, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
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
interface OptionsPanelProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  isCollapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
  showGroups: boolean;
  onShowGroupsChange: (show: boolean) => void;
  highlightedPersonId: string | null;
  onHighlightedPersonChange: (personId: string | null) => void;
  people: Array<{ id: string; firstName: string; lastName: string; company: string | null }>;
  personLineOpacity: number;
  onPersonLineOpacityChange: (value: number) => void;
  groupLineOpacity: number;
  onGroupLineOpacityChange: (value: number) => void;
  personPull: number;
  onPersonPullChange: (value: number) => void;
  groupPull: number;
  onGroupPullChange: (value: number) => void;
}

export function OptionsPanel({
  isOpen,
  onOpenChange,
  isCollapsed,
  onCollapsedChange,
  showGroups,
  onShowGroupsChange,
  highlightedPersonId,
  onHighlightedPersonChange,
  people,
  personLineOpacity,
  onPersonLineOpacityChange,
  groupLineOpacity,
  onGroupLineOpacityChange,
  personPull,
  onPersonPullChange,
  groupPull,
  onGroupPullChange,
}: OptionsPanelProps) {
  const [searchOpen, setSearchOpen] = useState(false);

  const highlightedPerson = highlightedPersonId
    ? people.find((p) => p.id === highlightedPersonId)
    : null;

  return (
    <>
      {/* Desktop: Toggle button when collapsed */}
      {isCollapsed && (
        <div className="hidden lg:block absolute top-4 right-4 z-10">
          <Button
            variant="outline"
            size="icon"
            onClick={() => onCollapsedChange(false)}
            data-testid="button-expand-sidebar"
            className="bg-card shadow-md"
          >
            <ChevronLeft className="h-5 w-5" />
          </Button>
        </div>
      )}

      {/* Desktop: Sidebar panel */}
      {!isCollapsed && (
        <div className="hidden lg:flex lg:flex-col lg:w-80 lg:border-l lg:bg-card">
          <div className="p-4 border-b flex items-center justify-between">
            <h3 className="font-semibold text-lg">Graph Options</h3>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => onCollapsedChange(true)}
              data-testid="button-collapse-sidebar"
            >
              <ChevronRight className="h-5 w-5" />
            </Button>
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

          {/* Sliders Section */}
          <div className="space-y-6 pt-4 border-t">
            <h4 className="font-medium text-sm text-muted-foreground">Physics & Appearance</h4>
            
            {/* Person to Person Line Opacity */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="person-opacity" className="text-sm">
                  Person-to-Person Line Opacity
                </Label>
                <span className="text-xs text-muted-foreground font-mono">
                  {personLineOpacity?.toFixed(2) ?? '0.30'}
                </span>
              </div>
              <Slider
                id="person-opacity"
                min={0}
                max={1}
                step={0.05}
                value={[personLineOpacity]}
                onValueChange={(values) => onPersonLineOpacityChange(values[0])}
                data-testid="slider-person-opacity"
              />
            </div>

            {/* Group to Person Line Opacity */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="group-opacity" className="text-sm">
                  Group-to-Person Line Opacity
                </Label>
                <span className="text-xs text-muted-foreground font-mono">
                  {groupLineOpacity?.toFixed(2) ?? '0.20'}
                </span>
              </div>
              <Slider
                id="group-opacity"
                min={0}
                max={1}
                step={0.05}
                value={[groupLineOpacity]}
                onValueChange={(values) => onGroupLineOpacityChange(values[0])}
                data-testid="slider-group-opacity"
              />
            </div>

            {/* Person to Person Pull */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="person-pull" className="text-sm">
                  Person-to-Person Pull
                </Label>
                <span className="text-xs text-muted-foreground font-mono">
                  {personPull?.toFixed(3) ?? '0.010'}
                </span>
              </div>
              <Slider
                id="person-pull"
                min={0}
                max={0.05}
                step={0.001}
                value={[personPull]}
                onValueChange={(values) => onPersonPullChange(values[0])}
                data-testid="slider-person-pull"
              />
            </div>

            {/* Group to Person Pull */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="group-pull" className="text-sm">
                  Group-to-Person Pull
                </Label>
                <span className="text-xs text-muted-foreground font-mono">
                  {groupPull?.toFixed(3) ?? '0.003'}
                </span>
              </div>
              <Slider
                id="group-pull"
                min={0}
                max={0.05}
                step={0.001}
                value={[groupPull]}
                onValueChange={(values) => onGroupPullChange(values[0])}
                data-testid="slider-group-pull"
              />
            </div>
          </div>
        </div>
        </div>
      )}

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

              {/* Sliders Section - Mobile */}
              <div className="space-y-6 pt-4 border-t">
                <h4 className="font-medium text-sm text-muted-foreground">Physics & Appearance</h4>
                
                {/* Person to Person Line Opacity */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="person-opacity-mobile" className="text-sm">
                      Person-to-Person Line Opacity
                    </Label>
                    <span className="text-xs text-muted-foreground font-mono">
                      {personLineOpacity?.toFixed(2) ?? '0.30'}
                    </span>
                  </div>
                  <Slider
                    id="person-opacity-mobile"
                    min={0}
                    max={1}
                    step={0.05}
                    value={[personLineOpacity]}
                    onValueChange={(values) => onPersonLineOpacityChange(values[0])}
                    data-testid="slider-person-opacity-mobile"
                  />
                </div>

                {/* Group to Person Line Opacity */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="group-opacity-mobile" className="text-sm">
                      Group-to-Person Line Opacity
                    </Label>
                    <span className="text-xs text-muted-foreground font-mono">
                      {groupLineOpacity?.toFixed(2) ?? '0.20'}
                    </span>
                  </div>
                  <Slider
                    id="group-opacity-mobile"
                    min={0}
                    max={1}
                    step={0.05}
                    value={[groupLineOpacity]}
                    onValueChange={(values) => onGroupLineOpacityChange(values[0])}
                    data-testid="slider-group-opacity-mobile"
                  />
                </div>

                {/* Person to Person Pull */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="person-pull-mobile" className="text-sm">
                      Person-to-Person Pull
                    </Label>
                    <span className="text-xs text-muted-foreground font-mono">
                      {personPull?.toFixed(3) ?? '0.010'}
                    </span>
                  </div>
                  <Slider
                    id="person-pull-mobile"
                    min={0}
                    max={0.05}
                    step={0.001}
                    value={[personPull]}
                    onValueChange={(values) => onPersonPullChange(values[0])}
                    data-testid="slider-person-pull-mobile"
                  />
                </div>

                {/* Group to Person Pull */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="group-pull-mobile" className="text-sm">
                      Group-to-Person Pull
                    </Label>
                    <span className="text-xs text-muted-foreground font-mono">
                      {groupPull?.toFixed(3) ?? '0.003'}
                    </span>
                  </div>
                  <Slider
                    id="group-pull-mobile"
                    min={0}
                    max={0.05}
                    step={0.001}
                    value={[groupPull]}
                    onValueChange={(values) => onGroupPullChange(values[0])}
                    data-testid="slider-group-pull-mobile"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
