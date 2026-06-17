import { useState, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Loader2, ZoomIn, ZoomOut, Maximize, RotateCcw, UserSearch, User, Image as ImageIcon, Circle } from "lucide-react";
import { FamilyTreeCanvas, FamilyTreeData, FamilyTreeCanvasHandle, FamilyTreeViewMode } from "@/components/family-tree-canvas";
import { FamilyTreePersonSelector } from "@/components/family-tree-person-selector";
import { AddFamilyMemberDialog } from "@/components/add-family-member-dialog";
import { apiRequest } from "@/lib/queryClient";

interface PersonBasic {
  id: string;
  firstName: string;
  lastName: string;
}

const VIEW_MODE_CYCLE: FamilyTreeViewMode[] = ["name", "avatar-name", "avatar-circle"];
const VIEW_MODE_LABELS: Record<FamilyTreeViewMode, string> = {
  "name": "Name & relation",
  "avatar-name": "Photo & name",
  "avatar-circle": "Photo only",
};

export default function FamilyTreePage() {
  const [, navigate] = useLocation();
  const canvasRef = useRef<FamilyTreeCanvasHandle>(null);

  // Read initial state from URL params
  const params = new URLSearchParams(window.location.search);
  const initialPersonId = params.get("person") || null;
  const initialDepth = parseInt(params.get("depth") ?? "6", 10) || 6;
  const initialViewParam = params.get("view") as FamilyTreeViewMode | null;
  const initialView: FamilyTreeViewMode = initialViewParam && VIEW_MODE_CYCLE.includes(initialViewParam)
    ? initialViewParam
    : "name";

  const [selectedPersonId, setSelectedPersonId] = useState<string | null>(initialPersonId);
  const [depth, setDepth] = useState(initialDepth);
  const [viewMode, setViewMode] = useState<FamilyTreeViewMode>(initialView);
  const [showPersonSelector, setShowPersonSelector] = useState(!initialPersonId);
  const [addMemberContext, setAddMemberContext] = useState<{
    relatedPersonId: string;
    suggestedRole: string;
  } | null>(null);

  // Update URL when person/depth/view changes
  useEffect(() => {
    if (selectedPersonId) {
      const newParams = new URLSearchParams();
      newParams.set("person", selectedPersonId);
      newParams.set("depth", String(depth));
      newParams.set("view", viewMode);
      window.history.replaceState(null, "", `/family-tree?${newParams.toString()}`);
    }
  }, [selectedPersonId, depth, viewMode]);

  // Fetch tree data
  const { data: treeData, isLoading: isTreeLoading, isError } = useQuery<FamilyTreeData>({
    queryKey: ["/api/family-tree", selectedPersonId, depth],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/family-tree/${selectedPersonId}?depth=${depth}`);
      return res.json();
    },
    enabled: !!selectedPersonId,
  });

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
    // Re-root the tree on the clicked person instead of navigating to the
    // profile page. This keeps the user inside the tree view so they can keep
    // exploring connections without losing their place.
    if (personId !== selectedPersonId) {
      setSelectedPersonId(personId);
    }
  };

  const cycleViewMode = () => {
    const idx = VIEW_MODE_CYCLE.indexOf(viewMode);
    const next = VIEW_MODE_CYCLE[(idx + 1) % VIEW_MODE_CYCLE.length];
    setViewMode(next);
  };

  const ViewIcon = viewMode === "name" ? User : viewMode === "avatar-name" ? ImageIcon : Circle;

  const handleAddMember = (relatedPersonId: string, suggestedRole: string) => {
    setAddMemberContext({ relatedPersonId, suggestedRole });
  };

  const relatedPerson = addMemberContext
    ? allPeople?.find((p) => p.id === addMemberContext.relatedPersonId)
    : null;

  return (
    <div className="flex flex-col h-full">
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
        </div>
      </div>

      {/* Canvas area */}
      <div className="flex-1 relative overflow-hidden bg-background">
        {!selectedPersonId && (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
            <UserSearch className="h-12 w-12 mb-4 opacity-50" />
            <p className="text-lg font-medium">Select a person to view their family tree</p>
            <Button
              className="mt-4"
              onClick={() => setShowPersonSelector(true)}
            >
              Select Person
            </Button>
          </div>
        )}

        {selectedPersonId && isTreeLoading && (
          <div className="flex items-center justify-center h-full">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
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

        {selectedPersonId && treeData && !isTreeLoading && (
          <FamilyTreeCanvas
            ref={canvasRef}
            data={treeData}
            onPersonClick={handlePersonClick}
            onAddMember={handleAddMember}
            viewMode={viewMode}
          />
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
    </div>
  );
}
