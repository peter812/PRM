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
  Download,
} from "lucide-react";
import {
  FamilyTreeFlow,
  FamilyTreeData,
  FamilyTreeCanvasHandle,
  FamilyTreeViewMode,
} from "@/components/family-tree-flow";
import { FamilyTreePersonSelector } from "@/components/family-tree-person-selector";
import { FamilyMemberDialog } from "@/components/family-member-dialog";
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
import { Mail, Phone, Briefcase } from "lucide-react";
import { PersonSocialAccountsChips } from "@/components/person-social-accounts-chips";
import { PersonTagsChips } from "@/components/person-tags-chips";
import type { PersonWithRelations } from "@shared/schema";

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

export interface FamilyTreeExplorerProps {
  /** Initial root person for the tree. When omitted, defaults to the current user. */
  initialPersonId?: string | null;
  /** Initial depth of the tree. */
  initialDepth?: number;
  /** Initial node view mode. */
  initialView?: FamilyTreeViewMode;
  /**
   * Embedded mode (e.g. inside a profile tab): hides the dev banner, skips URL
   * syncing, and shows a "Full Tree" link to the standalone page instead.
   */
  embedded?: boolean;
  /**
   * Called whenever the explorer's view state changes. The standalone page uses
   * this to keep the URL in sync.
   */
  onStateChange?: (state: {
    personId: string;
    depth: number;
    viewMode: FamilyTreeViewMode;
  }) => void;
}

export function FamilyTreeExplorer({
  initialPersonId = null,
  initialDepth = 6,
  initialView = "name",
  embedded = false,
  onStateChange,
}: FamilyTreeExplorerProps) {
  const [, navigate] = useLocation();
  const canvasRef = useRef<FamilyTreeCanvasHandle>(null);

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
  const [connectRequest, setConnectRequest] = useState<{
    sourcePersonId: string;
    targetPersonId: string;
    defaultType?: string;
  } | null>(null);
  const [removeRelsConfirm, setRemoveRelsConfirm] = useState<string | null>(null);
  const [deleteEdgeConfirm, setDeleteEdgeConfirm] = useState<string | null>(null);
  const [deleteAllStage, setDeleteAllStage] = useState<0 | 1 | 2>(0);
  const { toast } = useToast();

  // When the host changes the root person (e.g. switching profiles), follow it.
  useEffect(() => {
    if (initialPersonId) {
      setSelectedPersonId(initialPersonId);
    }
  }, [initialPersonId]);

  // Fetch current user to use as default root
  const { data: meUser, isLoading: isMeLoading } = useQuery<PersonBasic>({
    queryKey: ["/api/me"],
    enabled: !initialPersonId,
  });

  useEffect(() => {
    if (!selectedPersonId && meUser?.id) {
      setSelectedPersonId(meUser.id);
    }
  }, [meUser, selectedPersonId]);

  // Notify host of state changes (used for URL syncing on the standalone page)
  useEffect(() => {
    if (selectedPersonId && onStateChange) {
      onStateChange({ personId: selectedPersonId, depth, viewMode });
    }
  }, [selectedPersonId, depth, viewMode, onStateChange]);

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

  const handleConnectPersons = (sourcePersonId: string, targetPersonId: string, defaultType?: string) => {
    setConnectRequest({ sourcePersonId, targetPersonId, defaultType });
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
        await apiRequest("POST", "/api/family/lineage", {
          childId: targetPersonId,
          parentId: spouseId,
          lineageType: "biological",
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
  // infer the role from the handle the drag started on: bottom → child, top → parent,
  // sides → spouse. This keeps the "add member" prompt defaulted to the right type.
  const handleDragEndNoTarget = (sourcePersonId: string, handleId: string | null) => {
    let suggestedRole = "spouse";
    if (handleId?.startsWith("bottom")) suggestedRole = "child";
    else if (handleId?.startsWith("top")) suggestedRole = "parent";
    setAddMemberContext({ relatedPersonId: sourcePersonId, suggestedRole });
  };

  // Mark a spouse/partner connection as divorced (red "X" toggle on the couple bubble).
  const divorcePartnership = useMutation({
    mutationFn: async (partnershipId: string) => {
      await apiRequest("PATCH", `/api/family/partnerships/${partnershipId}`, {
        status: "divorced",
      });
    },
    onSuccess: () => {
      toast({
        title: "Marked as divorced",
        description: "The relationship is now shown as divorced.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/family-tree"] });
    },
    onError: (err: Error) => {
      toast({
        title: "Failed to update relationship",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  const handleDivorce = (partnershipId: string) => {
    divorcePartnership.mutate(partnershipId);
  };

  // Delete every family relationship/connection (garbage-can button, double-confirmed).
  const deleteAllFamily = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("DELETE", "/api/family/relationships/all");
      return res.json() as Promise<{ count?: number }>;
    },
    onSuccess: (data) => {
      const count = data?.count ?? 0;
      toast({
        title: "All family relationships deleted",
        description: `Removed ${count} relationship${count === 1 ? "" : "s"}.`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/family-tree"] });
      queryClient.invalidateQueries({ queryKey: ["/api/people"] });
      queryClient.invalidateQueries({ queryKey: ["/api/graph"] });
      setDeleteAllStage(0);
    },
    onError: (err: Error) => {
      toast({
        title: "Failed to delete relationships",
        description: err.message,
        variant: "destructive",
      });
      setDeleteAllStage(0);
    },
  });

  // When the user clicks the trash icon on an edge, prompt to delete that connection.
  const handleDeleteEdge = (edgeId: string) => {
    setDeleteEdgeConfirm(edgeId);
  };

  // Helper to delete native relationships from synthesized IDs
  const deleteNativeRelationships = async (ids: string[]) => {
    const uniqueIds = Array.from(new Set(ids));
    for (const id of uniqueIds) {
      if (id.endsWith("_p") || id.endsWith("_c")) {
        const actualId = id.slice(0, -2);
        await apiRequest("DELETE", `/api/family/lineage/${actualId}`);
      } else if (id.endsWith("_s1") || id.endsWith("_s2")) {
        const actualId = id.slice(0, -3);
        await apiRequest("DELETE", `/api/family/partnerships/${actualId}`);
      }
    }
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

      await deleteNativeRelationships(relIds);
      return relIds.length;
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
      const cat = FAMILY_RELATIONSHIP_CATEGORIES[relationshipType];
      if (cat === "parent" || cat === "child") {
        const isParentRole = cat === "parent";
        const parentId = isParentRole ? sourcePersonId : targetPersonId;
        const childId = isParentRole ? targetPersonId : sourcePersonId;
        const lineageType = relationshipType.startsWith("step")
          ? "step"
          : relationshipType.startsWith("adoptive")
          ? "adoptive"
          : "biological";

        const res = await apiRequest("POST", "/api/family/lineage", {
          parentId,
          childId,
          lineageType,
        });
        return res.json();
      } else if (cat === "spouse") {
        let status: "married" | "partner" | "divorced" | "ex_partner" = "partner";
        if (relationshipType === "spouse") status = "married";
        else if (relationshipType === "ex_spouse") status = "divorced";
        else if (relationshipType === "partner") status = "partner";
        else if (relationshipType === "ex_partner") status = "ex_partner";

        const res = await apiRequest("POST", "/api/family/partnerships", {
          person1Id: sourcePersonId,
          person2Id: targetPersonId,
          status,
        });
        return res.json();
      } else {
        throw new Error("Unsupported relationship type for direct connection");
      }
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
      const ids = toDelete.map((r) => r.id);
      await deleteNativeRelationships(ids);
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

  const handleExportCSV = () => {
    const layout = canvasRef.current?.getLayoutData?.();
    if (!layout) {
      toast({
        title: "Export failed",
        description: "Could not retrieve family tree layout data.",
        variant: "destructive",
      });
      return;
    }

    const { nodes, edges } = layout;

    const headers = ["Entity Type", "ID", "Name/Label", "Type/Role", "X", "Y", "Source", "Target"];
    const rows = [headers];

    for (const node of nodes) {
      rows.push([
        node.type === "coupleGroup" ? "Group" : "Node",
        node.id,
        node.data?.label || "",
        node.data?.sublabel || node.data?.color || "",
        String(node.position?.x ?? ""),
        String(node.position?.y ?? ""),
        "",
        ""
      ]);
    }

    for (const edge of edges) {
      rows.push([
        "Edge",
        edge.id,
        "",
        edge.data?.strokeDasharray ? "ex-spouse/partner" : "active connection",
        "",
        "",
        edge.source,
        edge.target
      ]);
    }

    const csvContent = rows
      .map((row) =>
        row
          .map((val) => {
            const cleanVal = val.replace(/"/g, '""');
            return `"${cleanVal}"`;
          })
          .join(",")
      )
      .join("\n");

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `family_tree_layout_${selectedPersonId || "export"}.csv`);
    link.style.visibility = "hidden";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    toast({
      title: "Export successful",
      description: "Family tree layout CSV has been downloaded.",
    });
  };

  const handleAddMember = (relatedPersonId: string, suggestedRole: string) => {
    setAddMemberContext({ relatedPersonId, suggestedRole });
  };

  const getRelatedPersonName = () => {
    if (!addMemberContext) return undefined;
    if (addMemberContext.relatedPersonId.startsWith("couple-")) {
      const spouseIds = addMemberContext.relatedPersonId.replace(/^couple-/, "").split(":").filter(Boolean);
      const spouses = spouseIds.map(id => allPeople?.find(p => p.id === id)).filter(Boolean);
      if (spouses.length > 0) {
        return spouses.map(s => `${s!.firstName} ${s!.lastName}`).join(" & ");
      }
      return "Couple";
    }
    const person = allPeople?.find((p) => p.id === addMemberContext.relatedPersonId);
    return person ? personName(person) : undefined;
  };

  return (
    <div className="flex flex-col h-full">
      {/* Dev banner (standalone page only) */}
      {!embedded && (
        <div className="bg-amber-500/10 border-b border-amber-500/30 px-4 py-1 flex items-center gap-2 text-xs text-amber-700 dark:text-amber-400">
          <Info className="h-3 w-3" />
          <span className="font-medium">Development Version</span>
          <span className="hidden sm:inline">
            — This page uses React Flow for interactive graph visualization.
          </span>
        </div>
      )}

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

        {embedded && selectedPersonId && (
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              navigate(`/family-tree?person=${selectedPersonId}&depth=${depth}&view=${viewMode}`)
            }
            title="Open the full-page family tree"
            data-testid="button-open-full-tree"
          >
            <ExternalLink className="h-4 w-4 mr-1" />
            Full Tree
          </Button>
        )}

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
            onClick={handleExportCSV}
            title="Export layout to CSV"
            data-testid="button-export-csv"
          >
            <Download className="h-4 w-4" />
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
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8 text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950/30"
            onClick={() => setDeleteAllStage(1)}
            disabled={!selectedPersonId}
            title="Delete all family relations and connections"
            data-testid="button-delete-all-family"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Main content area */}
      <div className="flex-1 relative overflow-hidden bg-background min-h-[300px]">
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
            onDivorce={handleDivorce}
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
        <FamilyMemberDialog
          open={!!addMemberContext}
          onOpenChange={(open) => {
            if (!open) setAddMemberContext(null);
          }}
          personId={addMemberContext.relatedPersonId}
          personName={getRelatedPersonName()}
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
          defaultType={connectRequest.defaultType}
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

      {/* Delete ALL family relationships — double confirmation */}
      <AlertDialog
        open={deleteAllStage > 0}
        onOpenChange={(open) => {
          if (!open && !deleteAllFamily.isPending) setDeleteAllStage(0);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {deleteAllStage === 1
                ? "Delete ALL family relationships?"
                : "Are you absolutely sure?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {deleteAllStage === 1
                ? "This permanently removes every family relationship and connection for everyone — all lineage links and partnerships across the whole database. This cannot be undone."
                : "Final confirmation: this erases the entire family graph for all people. There is no way to recover it."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <Button
              variant="outline"
              onClick={() => setDeleteAllStage(0)}
              disabled={deleteAllFamily.isPending}
            >
              Cancel
            </Button>
            {deleteAllStage === 1 ? (
              <Button
                className="bg-red-600 hover:bg-red-700 text-white"
                onClick={() => setDeleteAllStage(2)}
                data-testid="confirm-delete-all-step-1"
              >
                Continue
              </Button>
            ) : (
              <Button
                className="bg-red-600 hover:bg-red-700 text-white"
                onClick={() => deleteAllFamily.mutate()}
                disabled={deleteAllFamily.isPending}
                data-testid="confirm-delete-all-step-2"
              >
                {deleteAllFamily.isPending && (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                )}
                Delete everything
              </Button>
            )}
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

  const { data: fullPerson, isLoading } = useQuery<PersonWithRelations>({
    queryKey: [`/api/people/${personId}`],
    enabled: !!personId,
  });

  if (!person) return null;

  return (
    <div
      className="absolute top-4 left-4 w-80 max-h-[calc(100%-2rem)] overflow-y-auto bg-background/90 backdrop-blur-sm border rounded-lg shadow-lg z-40"
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

        {isLoading || !fullPerson ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <>
            <div className="flex flex-col items-center gap-3">
              <Avatar className="h-20 w-20">
                {(fullPerson.imageUrl || person.avatarUrl) && (
                  <AvatarImage
                    src={fullPerson.imageUrl || person.avatarUrl || ""}
                    alt={`${fullPerson.firstName} ${fullPerson.lastName}`}
                  />
                )}
                <AvatarFallback className="text-lg">{initials(person)}</AvatarFallback>
              </Avatar>
              <div className="text-center space-y-0.5">
                <p className="font-medium" data-testid="text-info-panel-name">
                  {`${fullPerson.firstName} ${fullPerson.lastName}`.trim()}
                </p>
                {(fullPerson.title || fullPerson.company) && (
                  <div className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground mt-1">
                    <Briefcase className="h-3.5 w-3.5" />
                    <span className="truncate max-w-[200px]">
                      {[fullPerson.title, fullPerson.company].filter(Boolean).join(" at ")}
                    </span>
                  </div>
                )}
                {fullPerson.id === data.rootPersonId && (
                  <p className="text-xs text-muted-foreground mt-1">Root of this tree</p>
                )}
              </div>
            </div>

            <div className="space-y-3 border-t pt-3">
              <Label className="text-xs text-muted-foreground">Social Accounts</Label>
              <PersonSocialAccountsChips
                personId={fullPerson.id}
                socialAccountUuids={fullPerson.socialAccountUuids || []}
                onUpdate={() => {
                  queryClient.invalidateQueries({
                    queryKey: [`/api/people/${personId}`],
                  });
                }}
              />
            </div>

            {(fullPerson.email || fullPerson.phone) && (
              <div className="space-y-2 border-t pt-3">
                <Label className="text-xs text-muted-foreground">Contact Info</Label>
                <div className="flex flex-col gap-2">
                  {fullPerson.email && (
                    <div className="flex items-center gap-2 text-sm">
                      <Mail className="h-4 w-4 text-muted-foreground" />
                      <a
                        href={`mailto:${fullPerson.email}`}
                        className="hover:underline text-xs truncate max-w-[200px]"
                        data-testid="link-email"
                      >
                        {fullPerson.email}
                      </a>
                    </div>
                  )}
                  {fullPerson.phone && (
                    <div className="flex items-center gap-2 text-sm">
                      <Phone className="h-4 w-4 text-muted-foreground" />
                      <a
                        href={`tel:${fullPerson.phone}`}
                        className="hover:underline text-xs"
                        data-testid="link-phone"
                      >
                        {fullPerson.phone}
                      </a>
                    </div>
                  )}
                </div>
              </div>
            )}

            <div className="space-y-2 border-t pt-3">
              <Label className="text-xs text-muted-foreground">Tags</Label>
              <PersonTagsChips
                personId={fullPerson.id}
                tags={fullPerson.tags || []}
              />
            </div>
          </>
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
  defaultType,
  validate,
  onInvalid,
  onConfirm,
  submitting,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sourcePerson: PersonBasic | null;
  targetPerson: PersonBasic | null;
  defaultType?: string;
  validate: (relationshipType: string) => string | null;
  onInvalid: (reason: string) => void;
  onConfirm: (relationshipType: string) => void;
  submitting: boolean;
}) {
  const [relationshipType, setRelationshipType] = useState<string>(defaultType ?? "spouse");

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

  const supportedTypes = FAMILY_RELATIONSHIP_TYPES.filter((t) => {
    const cat = FAMILY_RELATIONSHIP_CATEGORIES[t];
    return cat === "parent" || cat === "child" || cat === "spouse";
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New family relationship</DialogTitle>
          <DialogDescription>
            <span className="font-medium">{sourceName}</span> will now be{" "}
            <span className="font-medium">{targetName}</span>'s{" "}
            <span className="font-medium">
              {FAMILY_RELATIONSHIP_LABELS[relationshipType] ?? relationshipType}
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
              {supportedTypes.map((t) => (
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
