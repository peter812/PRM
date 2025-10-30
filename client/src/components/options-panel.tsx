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
  disablePersonLines: boolean;
  onDisablePersonLinesChange: (disable: boolean) => void;
  hideOrphans: boolean;
  onHideOrphansChange: (hide: boolean) => void;
  anonymizePeople: boolean;
  onAnonymizePeopleChange: (anonymize: boolean) => void;
  highlightedPersonId: string | null;
  onHighlightedPersonChange: (personId: string | null) => void;
  people: Array<{ id: string; firstName: string; lastName: string; company: string | null }>;
  centerForce: number;
  onCenterForceChange: (value: number) => void;
  repelForce: number;
  onRepelForceChange: (value: number) => void;
  linkForce: number;
  onLinkForceChange: (value: number) => void;
  linkDistance: number;
  onLinkDistanceChange: (value: number) => void;
}

export function OptionsPanel({
  isOpen,
  onOpenChange,
  isCollapsed,
  onCollapsedChange,
  showGroups,
  onShowGroupsChange,
  disablePersonLines,
  onDisablePersonLinesChange,
  hideOrphans,
  onHideOrphansChange,
  anonymizePeople,
  onAnonymizePeopleChange,
  highlightedPersonId,
  onHighlightedPersonChange,
  people,
  centerForce,
  onCenterForceChange,
  repelForce,
  onRepelForceChange,
  linkForce,
  onLinkForceChange,
  linkDistance,
  onLinkDistanceChange,
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
          <div className="p-4 border-b flex items-center justify-between shrink-0">
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
          <div className="flex-1 overflow-y-auto overscroll-contain p-4 space-y-6 pb-8" style={{ WebkitOverflowScrolling: 'touch' } as React.CSSProperties}>
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

          {/* Disable Person to Person Lines Toggle */}
          <div className="space-y-3">
            <Label htmlFor="disable-person-lines" className="text-base font-medium">
              Disable Person Lines
            </Label>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">
                Hide person-to-person relationships
              </span>
              <Switch
                id="disable-person-lines"
                checked={disablePersonLines}
                onCheckedChange={onDisablePersonLinesChange}
                data-testid="switch-disable-person-lines"
              />
            </div>
          </div>

          {/* Hide Orphans Toggle */}
          <div className="space-y-3">
            <Label htmlFor="hide-orphans" className="text-base font-medium">
              Hide Orphans
            </Label>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">
                Hide people with no connections
              </span>
              <Switch
                id="hide-orphans"
                checked={hideOrphans}
                onCheckedChange={onHideOrphansChange}
                data-testid="switch-hide-orphans"
              />
            </div>
          </div>

          {/* Anonymize People Toggle */}
          <div className="space-y-3">
            <Label htmlFor="anonymize-people" className="text-base font-medium">
              Anonymize People
            </Label>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">
                Hide names except Me node
              </span>
              <Switch
                id="anonymize-people"
                checked={anonymizePeople}
                onCheckedChange={onAnonymizePeopleChange}
                data-testid="switch-anonymize-people"
              />
            </div>
          </div>

          {/* User Highlight */}
          <div className="space-y-3">
            <Label className="text-base font-medium">User Highlight</Label>
            <p className="text-sm text-muted-foreground">
              Focus on a specific person and their connections
            </p>
            <Popover open={searchOpen} onOpenChange={setSearchOpen} modal={true}>
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
              <PopoverContent className="w-72 p-0" align="start" side="bottom" sideOffset={4}>
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
            
            {/* Center Force */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="center-force" className="text-sm">
                  Center Force
                </Label>
                <span className="text-xs text-muted-foreground font-mono">
                  {centerForce?.toFixed(4) ?? '0.0010'}
                </span>
              </div>
              <Slider
                id="center-force"
                min={0}
                max={0.01}
                step={0.0001}
                value={[centerForce]}
                onValueChange={(values) => onCenterForceChange(values[0])}
                data-testid="slider-center-force"
              />
            </div>

            {/* Repel Force */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="repel-force" className="text-sm">
                  Repel Force
                </Label>
                <span className="text-xs text-muted-foreground font-mono">
                  {repelForce?.toFixed(0) ?? '3000'}
                </span>
              </div>
              <Slider
                id="repel-force"
                min={500}
                max={10000}
                step={100}
                value={[repelForce]}
                onValueChange={(values) => onRepelForceChange(values[0])}
                data-testid="slider-repel-force"
              />
            </div>

            {/* Link Force */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="link-force" className="text-sm">
                  Link Force
                </Label>
                <span className="text-xs text-muted-foreground font-mono">
                  {linkForce?.toFixed(4) ?? '0.0100'}
                </span>
              </div>
              <Slider
                id="link-force"
                min={0.001}
                max={0.05}
                step={0.001}
                value={[linkForce]}
                onValueChange={(values) => onLinkForceChange(values[0])}
                data-testid="slider-link-force"
              />
            </div>

            {/* Link Distance */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="link-distance" className="text-sm">
                  Link Distance
                </Label>
                <span className="text-xs text-muted-foreground font-mono">
                  {linkDistance?.toFixed(0) ?? '100'}
                </span>
              </div>
              <Slider
                id="link-distance"
                min={50}
                max={300}
                step={10}
                value={[linkDistance]}
                onValueChange={(values) => onLinkDistanceChange(values[0])}
                data-testid="slider-link-distance"
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
            className="fixed right-0 top-0 bottom-0 w-full max-w-sm bg-card border-l shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-4 border-b flex items-center justify-between shrink-0">
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
            <div className="overflow-y-auto overscroll-contain p-4 space-y-6 h-[calc(100%-73px)] pb-8" style={{ WebkitOverflowScrolling: 'touch' } as React.CSSProperties}>
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

              {/* Disable Person to Person Lines Toggle */}
              <div className="space-y-3">
                <Label htmlFor="disable-person-lines-mobile" className="text-base font-medium">
                  Disable Person Lines
                </Label>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">
                    Hide person-to-person relationships
                  </span>
                  <Switch
                    id="disable-person-lines-mobile"
                    checked={disablePersonLines}
                    onCheckedChange={onDisablePersonLinesChange}
                    data-testid="switch-disable-person-lines-mobile"
                  />
                </div>
              </div>

              {/* Hide Orphans Toggle */}
              <div className="space-y-3">
                <Label htmlFor="hide-orphans-mobile" className="text-base font-medium">
                  Hide Orphans
                </Label>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">
                    Hide people with no connections
                  </span>
                  <Switch
                    id="hide-orphans-mobile"
                    checked={hideOrphans}
                    onCheckedChange={onHideOrphansChange}
                    data-testid="switch-hide-orphans-mobile"
                  />
                </div>
              </div>

              {/* Anonymize People Toggle */}
              <div className="space-y-3">
                <Label htmlFor="anonymize-people-mobile" className="text-base font-medium">
                  Anonymize People
                </Label>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">
                    Hide names except Me node
                  </span>
                  <Switch
                    id="anonymize-people-mobile"
                    checked={anonymizePeople}
                    onCheckedChange={onAnonymizePeopleChange}
                    data-testid="switch-anonymize-people-mobile"
                  />
                </div>
              </div>

              {/* User Highlight */}
              <div className="space-y-3">
                <Label className="text-base font-medium">User Highlight</Label>
                <p className="text-sm text-muted-foreground">
                  Focus on a specific person and their connections
                </p>
                <Popover open={searchOpen} onOpenChange={setSearchOpen} modal={true}>
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
                  <PopoverContent className="w-72 p-0" align="start" side="bottom" sideOffset={4}>
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
                
                {/* Center Force */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="center-force-mobile" className="text-sm">
                      Center Force
                    </Label>
                    <span className="text-xs text-muted-foreground font-mono">
                      {centerForce?.toFixed(4) ?? '0.0010'}
                    </span>
                  </div>
                  <Slider
                    id="center-force-mobile"
                    min={0}
                    max={0.01}
                    step={0.0001}
                    value={[centerForce]}
                    onValueChange={(values) => onCenterForceChange(values[0])}
                    data-testid="slider-center-force-mobile"
                  />
                </div>

                {/* Repel Force */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="repel-force-mobile" className="text-sm">
                      Repel Force
                    </Label>
                    <span className="text-xs text-muted-foreground font-mono">
                      {repelForce?.toFixed(0) ?? '3000'}
                    </span>
                  </div>
                  <Slider
                    id="repel-force-mobile"
                    min={500}
                    max={10000}
                    step={100}
                    value={[repelForce]}
                    onValueChange={(values) => onRepelForceChange(values[0])}
                    data-testid="slider-repel-force-mobile"
                  />
                </div>

                {/* Link Force */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="link-force-mobile" className="text-sm">
                      Link Force
                    </Label>
                    <span className="text-xs text-muted-foreground font-mono">
                      {linkForce?.toFixed(4) ?? '0.0100'}
                    </span>
                  </div>
                  <Slider
                    id="link-force-mobile"
                    min={0.001}
                    max={0.05}
                    step={0.001}
                    value={[linkForce]}
                    onValueChange={(values) => onLinkForceChange(values[0])}
                    data-testid="slider-link-force-mobile"
                  />
                </div>

                {/* Link Distance */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="link-distance-mobile" className="text-sm">
                      Link Distance
                    </Label>
                    <span className="text-xs text-muted-foreground font-mono">
                      {linkDistance?.toFixed(0) ?? '100'}
                    </span>
                  </div>
                  <Slider
                    id="link-distance-mobile"
                    min={50}
                    max={300}
                    step={10}
                    value={[linkDistance]}
                    onValueChange={(values) => onLinkDistanceChange(values[0])}
                    data-testid="slider-link-distance-mobile"
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
