import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
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
  Info,
  X,
  Trash2,
  Crosshair,
  ExternalLink,
} from "lucide-react";
import {
  FamilyTreeFlow,
  FamilyTreeData,
  FamilyTreeCanvasHandle,
  FamilyTreeViewMode,
} from "@/components/family-tree-flow";
import { FamilyTreePersonSelector } from "@/components/family-tree-person-selector";
import { AddFamilyMemberDialog } from "@/components/add-family-member-dialog";
import { GenerateFamilyConnectionsDialog } from "@/components/generate-family-connections-dialog";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@/components/ui/avatar";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import {
  FAMILY_RELATIONSHIP_TYPES,
  FAMILY_RELATIONSHIP_LABELS,
  FAMILY_RELATIONSHIP_CATEGORIES,
  FAMILY_RELATIONSHIP_INVERSES,
} from "@shared/schema";

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

function personName(p: { firstName: string; lastName: string } | undefined | null): string {
  return p ? `${p.firstName} ${p.lastName}`.trim() : "";
}

function initials(p: { firstName: string; lastName: string }): string {
  return `${p.firstName.charAt(0)}${p.lastName.charAt(0)}`.toUpperCase();
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

  // Single-click info panel, right-click context menu, drag-to-connect dialog
  const [infoPanelPersonId, setInfoPanelPersonId] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<
    { personId: string; x: number; y: number } | null
  >(null);
  const [connectRequest, setConnectRequest] = useState<
    { sourcePersonId: string; targetPersonId: string } | null
  >(null);
  const [removeRelsConfirm, setRemoveRelsConfirm] = useState<string | null>(null);
  const [deleteEdgeConfirm, setDeleteEdgeConfirm] = useState<string | null>(null);
  const { toast } = useToast();

  // Fetch current user to use as default root
  const { data: meUser, isLoading: isMeLoading } = useQuery<PersonBasic>({
    queryKey: ["/api/me"],
  });

  useEffect(() => {
    if (!selectedPersonId && meUser?.id) {
      setSelectedPersonId(meUser.id);
    }
  }, [meUser, selectedPersonId]);

  // Sync URL params
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

  const { data: allPeople } = useQuery<PersonBasic[]>({
    queryKey: ["/api/people"],
  });

  const selectedPerson = allPeople?.find((p) => p.id === selectedPersonId);
  const selectedPersonName = personName(selectedPerson);

  const handlePersonSelect = (personId: string) => {
    setSelectedPersonId(personId);
    setShowPersonSelector(false);
  };

  const handlePersonSingleClick = (personId: string) => {
    setInfoPanelPersonId(personId);
    setContextMenu(null);
  };

  const handlePersonDoubleClick = (personId: string) => {
    if (personId !== selectedPersonId) {
      setSelectedPersonId(personId);
    }
    setContextMenu(null);
  };

  const handlePersonContextMenu = (personId: string, x: number, y: number) => {
    setContextMenu({ personId, x, y });
  };

  // Close context menu on outside interaction
  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    window.addEventListener("click", close);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [contextMenu]);

  // ---- Link validation ----------------------------------------------------
  const validateProposedLink = (
    sourcePersonId: string,
    targetPersonId: string,
    relationshipType: string,
  ): string | null => {
    if (!treeData) return "Tree not loaded";
    if (sourcePersonId === targetPersonId) return "A person cannot be related to themselves";

    const exact = treeData.relationships.find(
      (r) =>
        r.fromPersonId === sourcePersonId &&
        r.toPersonId === targetPersonId &&
        r.familyRelationshipType === relationshipType,
    );
    if (exact) return "That relationship already exists";

    const cat = FAMILY_RELATIONSHIP_CATEGORIES[relationshipType];

    const isAncestor = (descendantId: string, ancestorCandidateId: string) => {
      const stack = [descendantId];
      const seen = new Set<string>();
      while (stack.length) {
        const cur = stack.pop()!;
        if (seen.has(cur)) continue;
        seen.add(cur);
        for (const rel of treeData.relationships) {
          if (rel.toPersonId === cur) {
            const c = FAMILY_RELATIONSHIP_CATEGORIES[rel.familyRelationshipType];
            if (c === "parent") {
              if (rel.fromPersonId === ancestorCandidateId) return true;
              stack.push(rel.fromPersonId);
            }
          }
        }
      }
      return false;
    };

    if (cat === "parent" && isAncestor(sourcePersonId, targetPersonId)) {
      return "That would create a cycle (the proposed parent is already a descendant)";
    }
    if (cat === "child" && isAncestor(targetPersonId, sourcePersonId)) {
      return "That would create a cycle (the proposed child is already an ancestor)";
    }

    return null;
  };

  const handleConnectPersons = (sourcePersonId: string, targetPersonId: string) => {
    setConnectRequest({ sourcePersonId, targetPersonId });
  };

  // Add child to both spouses in a couple group
  const addChildToCoupleGroup = useMutation({
    mutationFn: async ({
      groupId,
      targetPersonId,
    }: {
      groupId: string;
      targetPersonId: string;
    }) => {
      if (!treeData) throw new Error("Tree not loaded");
      const spouseIds = groupId.replace(/^couple-/, "").split(":").filter(Boolean);
      if (spouseIds.length === 0) throw new Error("Invalid couple group");
      if (spouseIds.includes(targetPersonId)) {
        throw new Error("A spouse cannot be made their own child");
      }

      const created: string[] = [];
      const skipped: { spouseId: string; reason: string }[] = [];
      for (const spouseId of spouseIds) {
        const reason = validateProposedLink(spouseId, targetPersonId, "parent");
        if (reason) {
          skipped.push({ spouseId, reason });
          continue;
        }
        await apiRequest("POST", "/api/relationships", {
          fromPersonId: spouseId,
          toPersonId: targetPersonId,
          familyRelationshipType: "parent",
        });
        created.push(spouseId);
      }

      if (created.length === 0) {
        throw new Error(skipped[0]?.reason ?? "No relationships could be added");
      }
      return { created: created.length, skipped: skipped.length };
    },
    onSuccess: ({ created, skipped }) => {
      const desc =
        skipped > 0
          ? `Added ${created} parent link${created === 1 ? "" : "s"} (${skipped} skipped).`
          : `Added ${created} parent link${created === 1 ? "" : "s"} to the couple.`;
      toast({ title: "Child added to couple", description: desc });
      queryClient.invalidateQueries({ queryKey: ["/api/family-tree"] });
    },
    onError: (err: Error) => {
      toast({
        title: "Invalid pick",
        description: `${err.message}. Please try again.`,
        variant: "destructive",
      });
    },
  });

  const handleConnectGroupChild = (groupId: string, targetPersonId: string) => {
    addChildToCoupleGroup.mutate({ groupId, targetPersonId });
  };

  // When the user drags from a person and releases without connecting to another node,
  // prompt them to add a spouse for that person.
  const handleDragEndNoTarget = (sourcePersonId: string) => {
    setAddMemberContext({ relatedPersonId: sourcePersonId, suggestedRole: "spouse" });
  };

  // When the user clicks the trash icon on an edge, prompt to delete that connection.
  const handleDeleteEdge = (edgeId: string) => {
    setDeleteEdgeConfirm(edgeId);
  };

  // Delete relationships associated with an edge
  const deleteEdgeRelationships = useMutation({
    mutationFn: async (edgeId: string) => {
      if (!treeData) throw new Error("Tree not loaded");
      // Edge id format: "edge-personA:personB" or "edge-couple-X:Y:personC"
      // Couple group IDs contain ":" internally (e.g. "couple-X:Y"), so we
      // cannot simply split on ":". Instead, detect couple- prefixes and parse
      // accordingly.
      const key = edgeId.replace(/^edge-/, "");

      let idA: string;
      let idB: string;

      if (key.startsWith("couple-")) {
        // Format: "couple-X:Y:personC" — first two segments form the group id
        const parts = key.split(":");
        idA = `${parts[0]}:${parts[1]}`;
        idB = parts[2];
      } else if (key.includes(":couple-")) {
        // Format: "personC:couple-X:Y" — last two segments form the group id
        const idx = key.indexOf(":couple-");
        idA = key.slice(0, idx);
        idB = key.slice(idx + 1);
      } else {
        // Simple: "personA:personB"
        const parts = key.split(":");
        idA = parts[0];
        idB = parts[1];
      }
      if (!idA || !idB) throw new Error("Invalid edge id");

      // Find all relationships between these two entities (could be couple group)
      // For couple groups, the key contains the group id like "couple-X:Y"
      const isCoupleSource = idA.startsWith("couple-");
      const isCoupleTarget = idB.startsWith("couple-");

      const relIds: string[] = [];

      if (isCoupleSource) {
        // Source is a couple group — find relationships from both spouses to the target
        const spouseIds = idA.replace(/^couple-/, "").split(":").filter(Boolean);
        for (const rel of treeData.relationships) {
          if (
            (spouseIds.includes(rel.fromPersonId) && rel.toPersonId === idB) ||
            (spouseIds.includes(rel.toPersonId) && rel.fromPersonId === idB)
          ) {
            relIds.push(rel.id);
          }
        }
      } else if (isCoupleTarget) {
        const spouseIds = idB.replace(/^couple-/, "").split(":").filter(Boolean);
        for (const rel of treeData.relationships) {
          if (
            (spouseIds.includes(rel.fromPersonId) && rel.toPersonId === idA) ||
            (spouseIds.includes(rel.toPersonId) && rel.fromPersonId === idA)
          ) {
            relIds.push(rel.id);
          }
        }
      } else {
        // Both are person ids — find all relationships between them
        for (const rel of treeData.relationships) {
          if (
            (rel.fromPersonId === idA && rel.toPersonId === idB) ||
            (rel.fromPersonId === idB && rel.toPersonId === idA)
          ) {
            relIds.push(rel.id);
          }
        }
      }

      if (relIds.length === 0) throw new Error("No relationships found for this connection");

      // The server-side DELETE /api/relationships/:id already handles deleting
      // the inverse family relationship, so we just delete each found relationship.
      const uniqueIds = Array.from(new Set(relIds));
      for (const id of uniqueIds) {
        await apiRequest("DELETE", `/api/relationships/${id}`);
      }
      return uniqueIds.length;
    },
    onSuccess: (count) => {
      toast({
        title: "Connection deleted",
        description: `Removed ${count} relationship${count === 1 ? "" : "s"}.`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/family-tree"] });
      queryClient.invalidateQueries({ queryKey: ["/api/graph"] });
      queryClient.invalidateQueries({ queryKey: ["/api/people"] });
      setDeleteEdgeConfirm(null);
    },
    onError: (err: Error) => {
      toast({
        title: "Failed to delete connection",
        description: err.message,
        variant: "destructive",
      });
      setDeleteEdgeConfirm(null);
    },
  });

  const submitProposedLink = useMutation({
    mutationFn: async ({
      sourcePersonId,
      targetPersonId,
      relationshipType,
    }: {
      sourcePersonId: string;
      targetPersonId: string;
      relationshipType: string;
    }) => {
      const res = await apiRequest("POST", "/api/relationships", {
        fromPersonId: sourcePersonId,
        toPersonId: targetPersonId,
        familyRelationshipType: relationshipType,
      });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Relationship added", description: "The new family link was saved." });
      queryClient.invalidateQueries({ queryKey: ["/api/family-tree"] });
      setConnectRequest(null);
    },
    onError: (err: Error) => {
      toast({
        title: "Could not add relationship",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  // Remove all family relationships for a person
  const removeAllFamilyRelsForPerson = useMutation({
    mutationFn: async (personId: string) => {
      if (!treeData) throw new Error("Tree not loaded");
      const toDelete = treeData.relationships.filter(
        (r) => r.fromPersonId === personId || r.toPersonId === personId,
      );
      const ids = Array.from(new Set(toDelete.map((r) => r.id)));
      for (const id of ids) {
        await apiRequest("DELETE", `/api/relationships/${id}`);
      }
      return ids.length;
    },
    onSuccess: (count) => {
      toast({
        title: "Family relationships removed",
        description: `Deleted ${count} relationship${count === 1 ? "" : "s"}.`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/family-tree"] });
      setRemoveRelsConfirm(null);
    },
    onError: (err: Error) => {
      toast({
        title: "Failed to remove relationships",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  const cycleViewMode = () => {
    const idx = VIEW_MODE_CYCLE.indexOf(viewMode);
    setViewMode(VIEW_MODE_CYCLE[(idx + 1) % VIEW_MODE_CYCLE.length]);
  };

  const ViewIcon =
    viewMode === "name" ? User : viewMode === "avatar-name" ? ImageIcon : Circle;

  const handleAddMember = (relatedPersonId: string, suggestedRole: string) => {
    setAddMemberContext({ relatedPersonId, suggestedRole });
  };

  const relatedPerson = addMemberContext
    ? allPeople?.find((p) => p.id === addMemberContext.relatedPersonId)
    : null;

  return (
    <div className="flex flex-col h-full">
      {/* Dev banner */}
      <div className="bg-amber-500/10 border-b border-amber-500/30 px-4 py-1 flex items-center gap-2 text-xs text-amber-700 dark:text-amber-400">
        <Info className="h-3 w-3" />
        <span className="font-medium">Development Version</span>
        <span className="hidden sm:inline">
          — This page uses React Flow for interactive graph visualization.
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

      {/* Main content area */}
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

        {selectedPersonId && treeData && !isTreeLoading && (
          <FamilyTreeFlow
            ref={canvasRef}
            data={treeData}
            onPersonClick={handlePersonSingleClick}
            onPersonDoubleClick={handlePersonDoubleClick}
            onPersonContextMenu={handlePersonContextMenu}
            onAddMember={handleAddMember}
            onConnectPersons={handleConnectPersons}
            onConnectGroupChild={handleConnectGroupChild}
            onDragEndNoTarget={handleDragEndNoTarget}
            onDeleteEdge={handleDeleteEdge}
            viewMode={viewMode}
            showAddOptions={showAddOptions}
          />
        )}

        {/* Single-click person info panel */}
        {infoPanelPersonId && treeData && (
          <PersonInfoPanel
            personId={infoPanelPersonId}
            data={treeData}
            onClose={() => setInfoPanelPersonId(null)}
            onSetAsRoot={(id) => {
              setSelectedPersonId(id);
              setInfoPanelPersonId(null);
            }}
            onGoToProfile={(id) => navigate(`/person/${id}`)}
          />
        )}

        {/* Right-click context menu */}
        {contextMenu && (
          <div
            className="fixed z-50 min-w-[14rem] rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
            style={{ left: contextMenu.x, top: contextMenu.y }}
            onClick={(e) => e.stopPropagation()}
            data-testid="family-tree-context-menu"
          >
            <button
              type="button"
              className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent"
              onClick={() => {
                setRemoveRelsConfirm(contextMenu.personId);
                setContextMenu(null);
              }}
              data-testid="context-menu-remove-rels"
            >
              <Trash2 className="h-4 w-4" />
              Remove all family relationships
            </button>
            <button
              type="button"
              className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent"
              onClick={() => {
                setSelectedPersonId(contextMenu.personId);
                setContextMenu(null);
              }}
              data-testid="context-menu-highlight"
            >
              <Crosshair className="h-4 w-4" />
              Highlight (set as root)
            </button>
            <button
              type="button"
              className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent"
              onClick={() => {
                navigate(`/person/${contextMenu.personId}`);
                setContextMenu(null);
              }}
              data-testid="context-menu-go-to-person"
            >
              <ExternalLink className="h-4 w-4" />
              Go to person page
            </button>
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
              ? personName(relatedPerson)
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

      {/* User-drawn relationship confirmation dialog */}
      {connectRequest && (
        <ConnectRelationshipDialog
          open={!!connectRequest}
          onOpenChange={(open) => {
            if (!open) setConnectRequest(null);
          }}
          sourcePerson={
            allPeople?.find((p) => p.id === connectRequest.sourcePersonId) ?? null
          }
          targetPerson={
            allPeople?.find((p) => p.id === connectRequest.targetPersonId) ?? null
          }
          validate={(rt) =>
            validateProposedLink(
              connectRequest.sourcePersonId,
              connectRequest.targetPersonId,
              rt,
            )
          }
          onInvalid={(reason) =>
            toast({
              title: "Invalid pick",
              description: `${reason}. Please try again.`,
              variant: "destructive",
            })
          }
          onConfirm={(rt) =>
            submitProposedLink.mutate({
              sourcePersonId: connectRequest.sourcePersonId,
              targetPersonId: connectRequest.targetPersonId,
              relationshipType: rt,
            })
          }
          submitting={submitProposedLink.isPending}
        />
      )}

      {/* Remove all family relationships confirmation */}
      <AlertDialog
        open={!!removeRelsConfirm}
        onOpenChange={(open) => {
          if (!open) setRemoveRelsConfirm(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove all family relationships?</AlertDialogTitle>
            <AlertDialogDescription>
              This will delete every family relationship that involves{" "}
              <span className="font-medium">
                {personName(allPeople?.find((x) => x.id === removeRelsConfirm)) || "this person"}
              </span>
              . This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (removeRelsConfirm) {
                  removeAllFamilyRelsForPerson.mutate(removeRelsConfirm);
                }
              }}
              data-testid="confirm-remove-family-rels"
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete edge connection confirmation */}
      <AlertDialog
        open={!!deleteEdgeConfirm}
        onOpenChange={(open) => {
          if (!open) setDeleteEdgeConfirm(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this connection?</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove the family relationship(s) represented by this connection line.
              For spouse relationships, both directions will be deleted. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (deleteEdgeConfirm) {
                  deleteEdgeRelationships.mutate(deleteEdgeConfirm);
                }
              }}
              data-testid="confirm-delete-edge"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Single-click info panel
// ---------------------------------------------------------------------------
function PersonInfoPanel({
  personId,
  data,
  onClose,
  onSetAsRoot,
  onGoToProfile,
}: {
  personId: string;
  data: FamilyTreeData;
  onClose: () => void;
  onSetAsRoot: (id: string) => void;
  onGoToProfile: (id: string) => void;
}) {
  const person = data.people.find((p) => p.id === personId);
  if (!person) return null;

  const relsForPerson = data.relationships.filter(
    (r) => r.fromPersonId === personId || r.toPersonId === personId,
  );

  const rows = relsForPerson.map((rel) => {
    const isOutgoing = rel.fromPersonId === personId;
    const otherId = isOutgoing ? rel.toPersonId : rel.fromPersonId;
    const otherPerson = data.people.find((p) => p.id === otherId);
    const otherRole = isOutgoing
      ? FAMILY_RELATIONSHIP_INVERSES[rel.familyRelationshipType] ?? rel.familyRelationshipType
      : rel.familyRelationshipType;
    return {
      id: rel.id,
      otherPerson,
      roleLabel: FAMILY_RELATIONSHIP_LABELS[otherRole] ?? otherRole,
    };
  });

  return (
    <div
      className="absolute top-4 left-4 w-72 max-h-[calc(100%-2rem)] overflow-y-auto bg-background/90 backdrop-blur-sm border rounded-lg shadow-lg z-40"
      data-testid="family-tree-info-panel"
    >
      <div className="p-4 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-sm">Person Info</h3>
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            data-testid="button-close-info-panel"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
        <div className="flex flex-col items-center gap-3">
          <Avatar className="h-20 w-20">
            {person.avatarUrl && (
              <AvatarImage
                src={person.avatarUrl}
                alt={`${person.firstName} ${person.lastName}`}
              />
            )}
            <AvatarFallback className="text-lg">{initials(person)}</AvatarFallback>
          </Avatar>
          <div className="text-center space-y-0.5">
            <p className="font-medium" data-testid="text-info-panel-name">
              {`${person.firstName} ${person.lastName}`.trim()}
            </p>
            {person.id === data.rootPersonId && (
              <p className="text-xs text-muted-foreground">Root of this tree</p>
            )}
          </div>
        </div>

        {rows.length > 0 && (
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">Relationships</Label>
            <div className="flex flex-col gap-1" data-testid="info-panel-relationships">
              {rows.map((row) => (
                <div
                  key={row.id}
                  className="flex items-center gap-2 rounded-md border px-2 py-1"
                >
                  <Avatar className="h-6 w-6">
                    {row.otherPerson?.avatarUrl && (
                      <AvatarImage
                        src={row.otherPerson.avatarUrl}
                        alt={`${row.otherPerson.firstName} ${row.otherPerson.lastName}`}
                      />
                    )}
                    <AvatarFallback className="text-[10px]">
                      {row.otherPerson
                        ? initials(row.otherPerson)
                        : "?"}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm truncate">
                      {row.otherPerson
                        ? `${row.otherPerson.firstName} ${row.otherPerson.lastName}`.trim()
                        : "Unknown"}
                    </p>
                    <p className="text-[10px] text-muted-foreground">{row.roleLabel}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="pt-2 border-t flex flex-col gap-2">
          <Button
            variant="outline"
            className="w-full"
            onClick={() => onSetAsRoot(person.id)}
            data-testid="button-info-panel-set-root"
          >
            Set as root
          </Button>
          <Button
            variant="outline"
            className="w-full"
            onClick={() => onGoToProfile(person.id)}
            data-testid="button-info-panel-go-to-profile"
          >
            Go to profile
          </Button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Relationship confirmation dialog
// ---------------------------------------------------------------------------
function ConnectRelationshipDialog({
  open,
  onOpenChange,
  sourcePerson,
  targetPerson,
  validate,
  onInvalid,
  onConfirm,
  submitting,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sourcePerson: PersonBasic | null;
  targetPerson: PersonBasic | null;
  validate: (relationshipType: string) => string | null;
  onInvalid: (reason: string) => void;
  onConfirm: (relationshipType: string) => void;
  submitting: boolean;
}) {
  const [relationshipType, setRelationshipType] = useState<string>("spouse");

  const sourceName = personName(sourcePerson) || "Person A";
  const targetName = personName(targetPerson) || "Person B";

  const handleConfirm = () => {
    const reason = validate(relationshipType);
    if (reason) {
      onInvalid(reason);
      return;
    }
    onConfirm(relationshipType);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New family relationship</DialogTitle>
          <DialogDescription>
            <span className="font-medium">{sourceName}</span> will now be{" "}
            <span className="font-medium">{targetName}</span>'s{" "}
            <span className="font-medium">
              {FAMILY_RELATIONSHIP_LABELS[
                FAMILY_RELATIONSHIP_INVERSES[relationshipType] ?? relationshipType
              ] ?? relationshipType}
            </span>
            .
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2 py-2">
          <Label className="text-xs text-muted-foreground">Relationship type</Label>
          <Select value={relationshipType} onValueChange={setRelationshipType}>
            <SelectTrigger data-testid="select-relationship-type">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="max-h-60">
              {FAMILY_RELATIONSHIP_TYPES.map((t) => (
                <SelectItem key={t} value={t}>
                  {FAMILY_RELATIONSHIP_LABELS[t] ?? t}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
            data-testid="button-deny-relationship"
          >
            Deny
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={submitting}
            data-testid="button-confirm-relationship"
          >
            {submitting ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
            Confirm
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
