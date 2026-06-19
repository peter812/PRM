import { useState, useEffect, useRef, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import {
  Loader2,
  ZoomIn,
  ZoomOut,
  Maximize,
  RotateCcw,
  UserSearch,
  User,
  Image as ImageIcon,
  Circle,
  Sparkles,
  Eye,
  EyeOff,
  Bug,
  BarChart3,
  Download,
  Filter,
  ChevronDown,
  ChevronUp,
  Info,
} from "lucide-react";
import {
  FamilyTreeCanvas,
  FamilyTreeData,
  FamilyTreeCanvasHandle,
  FamilyTreeViewMode,
} from "@/components/family-tree-canvas";
import { FamilyTreePersonSelector } from "@/components/family-tree-person-selector";
import { AddFamilyMemberDialog } from "@/components/add-family-member-dialog";
import { GenerateFamilyConnectionsDialog } from "@/components/generate-family-connections-dialog";
import { apiRequest } from "@/lib/queryClient";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface PersonBasic {
  id: string;
  firstName: string;
  lastName: string;
}

const VIEW_MODE_CYCLE: FamilyTreeViewMode[] = ["name", "avatar-name", "avatar-circle"];
const VIEW_MODE_LABELS: Record<FamilyTreeViewMode, string> = {
  name: "Name & relation",
  "avatar-name": "Photo & name",
  "avatar-circle": "Photo only",
};

const RELATIONSHIP_CATEGORIES = [
  "parent",
  "child",
  "spouse",
  "sibling",
  "grandparent",
  "grandchild",
  "uncle/aunt",
  "nephew/niece",
  "cousin",
  "extended",
] as const;

type RelationshipCategory = (typeof RELATIONSHIP_CATEGORIES)[number];

function categorizeRelType(type: string): RelationshipCategory {
  if (["father", "mother", "parent"].includes(type)) return "parent";
  if (["child", "son", "daughter"].includes(type)) return "child";
  if (["spouse", "ex_spouse"].includes(type)) return "spouse";
  if (["sibling", "brother", "sister", "half_brother", "half_sister", "half_sibling"].includes(type))
    return "sibling";
  if (["grandfather", "grandmother", "grandparent"].includes(type)) return "grandparent";
  if (["grandchild", "grandson", "granddaughter"].includes(type)) return "grandchild";
  if (["uncle", "aunt", "uncle_or_aunt"].includes(type)) return "uncle/aunt";
  if (["nephew", "niece", "nephew_or_niece"].includes(type)) return "nephew/niece";
  if (["cousin"].includes(type)) return "cousin";
  if (type.startsWith("step") || type.startsWith("great_")) return "extended";
  return "parent"; // fallback
}

/** Compute tree statistics from the API data */
function computeTreeStats(data: FamilyTreeData) {
  const totalPeople = data.people.length;
  const totalRelationships = data.relationships.length;
  const missingLinks = data.missingLinks.length;

  // Count by relationship category
  const relCounts: Record<string, number> = {};
  for (const rel of data.relationships) {
    const cat = categorizeRelType(rel.familyRelationshipType);
    relCounts[cat] = (relCounts[cat] || 0) + 1;
  }

  // Determine generations
  const depths = data.people.map((p) => p.depth);
  const minDepth = Math.min(...depths, 0);
  const maxDepth = Math.max(...depths, 0);
  const generations = maxDepth - minDepth + 1;

  // People with avatars
  const withAvatars = data.people.filter((p) => p.avatarUrl).length;

  return {
    totalPeople,
    totalRelationships,
    missingLinks,
    relCounts,
    generations,
    withAvatars,
    minDepth,
    maxDepth,
  };
}

export default function FamilyTreeDevPage() {
  const [, navigate] = useLocation();
  const canvasRef = useRef<FamilyTreeCanvasHandle>(null);

  // Read initial state from URL params
  const params = new URLSearchParams(window.location.search);
  const initialPersonId = params.get("person") || null;
  const initialDepth = parseInt(params.get("depth") ?? "6", 10) || 6;
  const initialViewParam = params.get("view") as FamilyTreeViewMode | null;
  const initialView: FamilyTreeViewMode =
    initialViewParam && VIEW_MODE_CYCLE.includes(initialViewParam)
      ? initialViewParam
      : "name";

  const [selectedPersonId, setSelectedPersonId] = useState<string | null>(initialPersonId);
  const [depth, setDepth] = useState(initialDepth);
  const [viewMode, setViewMode] = useState<FamilyTreeViewMode>(initialView);
  const [showPersonSelector, setShowPersonSelector] = useState(false);
  const [showGenerateDialog, setShowGenerateDialog] = useState(false);
  const [showAddOptions, setShowAddOptions] = useState(true);
  const [addMemberContext, setAddMemberContext] = useState<{
    relatedPersonId: string;
    suggestedRole: string;
  } | null>(null);

  // Dev-specific state
  const [debugMode, setDebugMode] = useState(false);
  const [showStats, setShowStats] = useState(false);
  const [activeFilters, setActiveFilters] = useState<Set<RelationshipCategory>>(
    new Set(RELATIONSHIP_CATEGORIES),
  );

  // Fetch current user (ME user) to use as default if no person param in URL
  const { data: meUser, isLoading: isMeLoading } = useQuery<PersonBasic>({
    queryKey: ["/api/me"],
  });

  // If no person is selected in URL, default to the current logged-in user
  useEffect(() => {
    if (!selectedPersonId && meUser?.id) {
      setSelectedPersonId(meUser.id);
    }
  }, [meUser, selectedPersonId]);

  // Update URL when person/depth/view changes
  useEffect(() => {
    if (selectedPersonId) {
      const newParams = new URLSearchParams();
      newParams.set("person", selectedPersonId);
      newParams.set("depth", String(depth));
      newParams.set("view", viewMode);
      window.history.replaceState(
        null,
        "",
        `/family-tree-dev-version?${newParams.toString()}`,
      );
    }
  }, [selectedPersonId, depth, viewMode]);

  // Fetch tree data
  const {
    data: treeData,
    isLoading: isTreeLoading,
    isError,
  } = useQuery<FamilyTreeData>({
    queryKey: ["/api/family-tree", selectedPersonId, depth],
    queryFn: async () => {
      const res = await apiRequest(
        "GET",
        `/api/family-tree/${selectedPersonId}?depth=${depth}`,
      );
      return res.json();
    },
    enabled: !!selectedPersonId,
  });

  // Apply relationship category filters to tree data
  const filteredTreeData = useMemo<FamilyTreeData | null>(() => {
    if (!treeData) return null;
    // If all filters active, pass data through unmodified
    if (activeFilters.size === RELATIONSHIP_CATEGORIES.length) return treeData;

    const filteredRels = treeData.relationships.filter((rel) => {
      const cat = categorizeRelType(rel.familyRelationshipType);
      return activeFilters.has(cat);
    });

    // Keep only people that are still connected via filtered relationships
    const connectedIds = new Set<string>([treeData.rootPersonId]);
    for (const rel of filteredRels) {
      connectedIds.add(rel.fromPersonId);
      connectedIds.add(rel.toPersonId);
    }

    return {
      ...treeData,
      relationships: filteredRels,
      people: treeData.people.filter((p) => connectedIds.has(p.id)),
      missingLinks: showAddOptions
        ? treeData.missingLinks.filter((ml) => connectedIds.has(ml.relatedPersonId))
        : [],
    };
  }, [treeData, activeFilters, showAddOptions]);

  // Compute stats
  const stats = useMemo(
    () => (treeData ? computeTreeStats(treeData) : null),
    [treeData],
  );

  // Get person name for display
  const { data: allPeople } = useQuery<PersonBasic[]>({
    queryKey: ["/api/people"],
  });

  const selectedPerson = allPeople?.find((p) => p.id === selectedPersonId);
  const selectedPersonName = selectedPerson
    ? `${selectedPerson.firstName} ${selectedPerson.lastName}`.trim()
    : "";

  const handlePersonSelect = (personId: string) => {
    setSelectedPersonId(personId);
    setShowPersonSelector(false);
  };

  const handlePersonClick = (personId: string) => {
    if (personId !== selectedPersonId) {
      setSelectedPersonId(personId);
    }
  };

  const cycleViewMode = () => {
    const idx = VIEW_MODE_CYCLE.indexOf(viewMode);
    const next = VIEW_MODE_CYCLE[(idx + 1) % VIEW_MODE_CYCLE.length];
    setViewMode(next);
  };

  const ViewIcon =
    viewMode === "name" ? User : viewMode === "avatar-name" ? ImageIcon : Circle;

  const handleAddMember = (relatedPersonId: string, suggestedRole: string) => {
    setAddMemberContext({ relatedPersonId, suggestedRole });
  };

  const relatedPerson = addMemberContext
    ? allPeople?.find((p) => p.id === addMemberContext.relatedPersonId)
    : null;

  const toggleFilter = (cat: RelationshipCategory) => {
    setActiveFilters((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) {
        next.delete(cat);
      } else {
        next.add(cat);
      }
      return next;
    });
  };

  const handleExportTree = () => {
    if (!treeData) return;
    const blob = new Blob([JSON.stringify(treeData, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `family-tree-${(selectedPersonName || "export").replace(/[^a-z0-9]/gi, "-").toLowerCase()}-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex flex-col h-full">
      {/* Dev banner */}
      <div className="bg-amber-500/10 border-b border-amber-500/30 px-4 py-1 flex items-center gap-2 text-xs text-amber-700 dark:text-amber-400">
        <Info className="h-3 w-3" />
        <span className="font-medium">Development Version</span>
        <span className="hidden sm:inline">
          — This page uses the same API endpoints and PixiJS canvas with additional dev tools.
        </span>
        <Button
          variant="link"
          size="sm"
          className="ml-auto text-xs h-auto p-0 text-amber-700 dark:text-amber-400"
          onClick={() => navigate("/family-tree")}
        >
          Switch to stable →
        </Button>
      </div>

      {/* Controls bar */}
      <div className="border-b px-4 py-2 flex items-center gap-3 flex-wrap">
        <Button
          variant="outline"
          size="sm"
          onClick={() => setShowPersonSelector(true)}
          data-testid="button-change-person"
        >
          <UserSearch className="h-4 w-4 mr-1" />
          {selectedPersonName || "Select Person"}
        </Button>

        <div className="flex items-center gap-2 ml-auto">
          <span className="text-xs text-muted-foreground">Depth: {depth}</span>
          <Slider
            value={[depth]}
            min={1}
            max={10}
            step={1}
            onValueChange={([v]) => setDepth(v)}
            className="w-24"
          />
        </div>

        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowGenerateDialog(true)}
            disabled={!selectedPersonId}
            title="Generate connections with AI"
            data-testid="button-generate-connections"
          >
            <Sparkles className="h-4 w-4 mr-1" />
            Generate
          </Button>
          <Button
            variant={showAddOptions ? "default" : "outline"}
            size="sm"
            onClick={() => setShowAddOptions((v) => !v)}
            title={
              showAddOptions
                ? "Hide unknown/add person boxes"
                : "Show unknown/add person boxes"
            }
            data-testid="button-toggle-add-options"
          >
            {showAddOptions ? (
              <Eye className="h-4 w-4 mr-1" />
            ) : (
              <EyeOff className="h-4 w-4 mr-1" />
            )}
            {showAddOptions ? "Unknowns on" : "Unknowns off"}
          </Button>

          {/* Relationship filter dropdown */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant={
                  activeFilters.size < RELATIONSHIP_CATEGORIES.length
                    ? "default"
                    : "outline"
                }
                size="sm"
                title="Filter relationship types"
              >
                <Filter className="h-4 w-4 mr-1" />
                Filter
                {activeFilters.size < RELATIONSHIP_CATEGORIES.length && (
                  <Badge
                    variant="secondary"
                    className="ml-1 h-4 px-1 text-[10px]"
                  >
                    {activeFilters.size}/{RELATIONSHIP_CATEGORIES.length}
                  </Badge>
                )}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>Relationship Types</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {RELATIONSHIP_CATEGORIES.map((cat) => (
                <DropdownMenuCheckboxItem
                  key={cat}
                  checked={activeFilters.has(cat)}
                  onCheckedChange={() => toggleFilter(cat)}
                >
                  {cat.charAt(0).toUpperCase() + cat.slice(1)}
                </DropdownMenuCheckboxItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuCheckboxItem
                checked={activeFilters.size === RELATIONSHIP_CATEGORIES.length}
                onCheckedChange={() => {
                  if (activeFilters.size === RELATIONSHIP_CATEGORIES.length) {
                    setActiveFilters(new Set());
                  } else {
                    setActiveFilters(new Set(RELATIONSHIP_CATEGORIES));
                  }
                }}
              >
                Select All
              </DropdownMenuCheckboxItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8"
            onClick={cycleViewMode}
            title={`View: ${VIEW_MODE_LABELS[viewMode]} (click to change)`}
            data-testid="button-view-mode"
          >
            <ViewIcon className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8"
            onClick={() => canvasRef.current?.zoomIn()}
            title="Zoom in"
          >
            <ZoomIn className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8"
            onClick={() => canvasRef.current?.zoomOut()}
            title="Zoom out"
          >
            <ZoomOut className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8"
            onClick={() => canvasRef.current?.fitToScreen()}
            title="Fit to screen"
          >
            <Maximize className="h-4 w-4" />
          </Button>

          {/* Dev tools */}
          <div className="h-6 w-px bg-border mx-1" />

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant={debugMode ? "default" : "outline"}
                size="icon"
                className="h-8 w-8"
                onClick={() => setDebugMode((v) => !v)}
                title="Toggle debug mode"
              >
                <Bug className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Debug mode: show IDs & raw data</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant={showStats ? "default" : "outline"}
                size="icon"
                className="h-8 w-8"
                onClick={() => setShowStats((v) => !v)}
                title="Toggle statistics panel"
              >
                <BarChart3 className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Show/hide tree statistics</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8"
                onClick={handleExportTree}
                disabled={!treeData}
                title="Export tree data as JSON"
              >
                <Download className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Export tree data (JSON)</TooltipContent>
          </Tooltip>
        </div>
      </div>

      {/* Main content area */}
      <div className="flex-1 flex overflow-hidden">
        {/* Canvas area */}
        <div className="flex-1 relative overflow-hidden bg-background">
          {(isMeLoading || (selectedPersonId && isTreeLoading)) && (
            <div className="flex items-center justify-center h-full">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          )}

          {!selectedPersonId && !isMeLoading && (
            <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
              <UserSearch className="h-12 w-12 mb-4 opacity-50" />
              <p className="text-lg font-medium">
                Select a person to view their family tree
              </p>
              <Button
                className="mt-4"
                onClick={() => setShowPersonSelector(true)}
              >
                Select Person
              </Button>
            </div>
          )}

          {selectedPersonId && isError && (
            <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
              <p className="text-lg font-medium">Failed to load family tree</p>
              <Button
                variant="outline"
                className="mt-4"
                onClick={() => setSelectedPersonId(null)}
              >
                <RotateCcw className="h-4 w-4 mr-1" />
                Try again
              </Button>
            </div>
          )}

          {selectedPersonId && filteredTreeData && !isTreeLoading && (
            <FamilyTreeCanvas
              ref={canvasRef}
              data={filteredTreeData}
              onPersonClick={handlePersonClick}
              onAddMember={handleAddMember}
              viewMode={viewMode}
              showAddOptions={showAddOptions}
            />
          )}

          {/* Debug overlay */}
          {debugMode && treeData && (
            <div className="absolute bottom-2 left-2 bg-background/90 border rounded-lg p-3 text-xs font-mono max-w-sm max-h-60 overflow-auto shadow-lg">
              <p className="font-bold mb-1">Debug Info</p>
              <p>Root: {treeData.rootPersonId}</p>
              <p>People: {treeData.people.length}</p>
              <p>Relationships: {treeData.relationships.length}</p>
              <p>Missing links: {treeData.missingLinks.length}</p>
              <p>Depth setting: {depth}</p>
              <p>View mode: {viewMode}</p>
              <p>
                Active filters: {activeFilters.size}/
                {RELATIONSHIP_CATEGORIES.length}
              </p>
              {filteredTreeData && filteredTreeData !== treeData && (
                <>
                  <p className="mt-1 font-bold text-amber-600">
                    Filtered view:
                  </p>
                  <p>Visible people: {filteredTreeData.people.length}</p>
                  <p>Visible rels: {filteredTreeData.relationships.length}</p>
                </>
              )}
            </div>
          )}
        </div>

        {/* Statistics sidebar */}
        {showStats && stats && (
          <div className="w-64 border-l overflow-y-auto p-4 bg-muted/30">
            <h3 className="text-sm font-semibold mb-3 flex items-center gap-1">
              <BarChart3 className="h-4 w-4" />
              Tree Statistics
            </h3>

            <div className="space-y-3">
              <StatItem label="Total People" value={stats.totalPeople} />
              <StatItem
                label="Total Relationships"
                value={stats.totalRelationships}
              />
              <StatItem
                label="Missing Links"
                value={stats.missingLinks}
                highlight={stats.missingLinks > 0}
              />
              <StatItem label="Generations" value={stats.generations} />
              <StatItem
                label="With Photos"
                value={`${stats.withAvatars}/${stats.totalPeople}`}
              />
              <StatItem
                label="Depth Range"
                value={`${stats.minDepth} to ${stats.maxDepth}`}
              />

              <Collapsible>
                <CollapsibleTrigger
                  className="flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground w-full"
                  aria-label="Toggle relationship breakdown details"
                >
                  <ChevronDown className="h-3 w-3 transition-transform data-[state=open]:rotate-180" />
                  Relationship Breakdown
                </CollapsibleTrigger>
                <CollapsibleContent className="pt-2 space-y-1">
                  {Object.entries(stats.relCounts)
                    .sort(([, a], [, b]) => b - a)
                    .map(([cat, count]) => (
                      <div
                        key={cat}
                        className="flex justify-between text-xs px-2"
                      >
                        <span className="text-muted-foreground capitalize">
                          {cat}
                        </span>
                        <span className="font-mono">{count}</span>
                      </div>
                    ))}
                </CollapsibleContent>
              </Collapsible>

              {selectedPerson && (
                <div className="pt-3 border-t">
                  <p className="text-xs font-medium text-muted-foreground mb-1">
                    Root Person
                  </p>
                  <p className="text-sm font-medium">{selectedPersonName}</p>
                  <p className="text-xs text-muted-foreground font-mono">
                    {selectedPersonId}
                  </p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Person selector dialog */}
      <FamilyTreePersonSelector
        open={showPersonSelector}
        onOpenChange={setShowPersonSelector}
        onSelect={handlePersonSelect}
        required={!selectedPersonId}
      />

      {/* Add family member dialog */}
      {addMemberContext && (
        <AddFamilyMemberDialog
          open={!!addMemberContext}
          onOpenChange={(open) => {
            if (!open) setAddMemberContext(null);
          }}
          relatedPersonId={addMemberContext.relatedPersonId}
          relatedPersonName={
            relatedPerson
              ? `${relatedPerson.firstName} ${relatedPerson.lastName}`.trim()
              : undefined
          }
          suggestedRole={addMemberContext.suggestedRole}
          onSuccess={() => {
            setAddMemberContext(null);
          }}
        />
      )}
      {/* Generate connections (AI) dialog */}
      <GenerateFamilyConnectionsDialog
        open={showGenerateDialog}
        onOpenChange={setShowGenerateDialog}
        personId={selectedPersonId}
        personName={selectedPersonName || undefined}
      />
    </div>
  );
}

function StatItem({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string | number;
  highlight?: boolean;
}) {
  return (
    <div className="flex justify-between items-center">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span
        className={`text-sm font-mono font-medium ${
          highlight ? "text-amber-600 dark:text-amber-400" : ""
        }`}
      >
        {value}
      </span>
    </div>
  );
}
