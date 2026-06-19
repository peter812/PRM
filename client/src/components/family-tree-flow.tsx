import { useMemo, forwardRef, useImperativeHandle, useCallback } from "react";
import {
  ReactFlow,
  Node,
  Edge,
  useNodesState,
  useEdgesState,
  useReactFlow,
  ReactFlowProvider,
  Background,
  BackgroundVariant,
  MarkerType,
  Handle,
  Position,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  FamilyTreeData,
  FamilyTreePerson,
  FamilyTreeViewMode,
  FamilyTreeCanvasHandle,
} from "./family-tree-canvas";

// Re-export types so the dev page doesn't need to change its imports
export type { FamilyTreeData, FamilyTreePerson, FamilyTreeViewMode, FamilyTreeCanvasHandle };

// Layout constants
const LAYOUT = {
  NODE_WIDTH: 180,
  NODE_HEIGHT: 80,
  HORIZONTAL_GAP: 60,
  VERTICAL_GAP: 140,
  SPOUSE_GAP: 30,
};

// Relationship type helpers
const PARENT_TYPES = ["father", "mother", "parent", "stepfather", "stepmother", "stepparent"];
const CHILD_TYPES = ["child", "son", "daughter", "stepchild", "stepson", "stepdaughter"];
const SPOUSE_TYPES = ["spouse", "ex_spouse"];

function getRelationshipCategory(type: string): "parent" | "child" | "spouse" | "other" {
  if (PARENT_TYPES.includes(type)) return "parent";
  if (CHILD_TYPES.includes(type)) return "child";
  if (SPOUSE_TYPES.includes(type)) return "spouse";
  return "other";
}

function formatRelationshipLabel(type: string): string {
  return type.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function getInverseParentRole(childType: string): string {
  if (childType === "son") return "father";
  if (childType === "daughter") return "mother";
  return "parent";
}

// ---------------------------------------------------------------------------
// Custom node components
// ---------------------------------------------------------------------------

interface PersonNodeData {
  label: string;
  sublabel: string;
  avatarUrl?: string | null;
  isRoot: boolean;
  isMissing: boolean;
  missingKind?: "unknown" | "add";
  viewMode: FamilyTreeViewMode;
  onPersonClick?: (personId: string) => void;
  onAddMember?: (relatedPersonId: string, suggestedRole: string) => void;
  relatedPersonId?: string;
  missingRole?: string;
}

function PersonNode({ data, id }: { data: PersonNodeData; id: string }) {
  const handleClick = () => {
    if (data.isMissing && data.onAddMember && data.relatedPersonId && data.missingRole) {
      data.onAddMember(data.relatedPersonId, data.missingRole);
    } else if (!data.isMissing && data.onPersonClick) {
      data.onPersonClick(id);
    }
  };

  const baseClasses =
    "rounded-xl border-2 px-3 py-2 shadow-sm cursor-pointer transition-all hover:shadow-md flex flex-col items-center justify-center text-center w-full h-full";

  let nodeClasses = baseClasses;
  if (data.isMissing) {
    if (data.missingKind === "unknown") {
      nodeClasses += " bg-sky-950 border-sky-400 text-sky-100";
    } else {
      nodeClasses += " bg-gray-800 border-gray-500 text-gray-100";
    }
  } else if (data.isRoot) {
    nodeClasses += " bg-white dark:bg-gray-900 border-blue-500 ring-2 ring-blue-200 dark:ring-blue-800";
  } else {
    nodeClasses += " bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-700";
  }

  const showAvatar = data.viewMode !== "name" && data.avatarUrl;
  const showName = data.viewMode !== "avatar-circle";
  const isCircle = data.viewMode === "avatar-circle";

  return (
    <div className={nodeClasses} onClick={handleClick}>
      <Handle type="target" position={Position.Top} className="!bg-gray-400 !w-2 !h-2 !border-0" />
      {showAvatar && (
        <img
          src={data.avatarUrl ?? ""}
          alt={data.label}
          className={`object-cover ${isCircle ? "w-12 h-12 rounded-full" : "w-8 h-8 rounded-full mb-1"}`}
        />
      )}
      {showName && (
        <>
          <span className={`font-medium text-xs leading-tight ${data.isMissing ? "" : "text-gray-900 dark:text-gray-100"}`}>
            {data.label}
          </span>
          {data.sublabel && (
            <span className={`text-[10px] leading-tight mt-0.5 ${data.isMissing ? "opacity-70" : "text-muted-foreground"}`}>
              {data.sublabel}
            </span>
          )}
        </>
      )}
      {isCircle && !showAvatar && (
        <span className="font-medium text-xs leading-tight text-gray-900 dark:text-gray-100">
          {data.label}
        </span>
      )}
      <Handle type="source" position={Position.Bottom} className="!bg-gray-400 !w-2 !h-2 !border-0" />
    </div>
  );
}

const nodeTypes = { person: PersonNode };

// ---------------------------------------------------------------------------
// Build React Flow nodes/edges from FamilyTreeData
// ---------------------------------------------------------------------------
function buildFlowElements(
  data: FamilyTreeData,
  viewMode: FamilyTreeViewMode,
  showAddOptions: boolean,
  onPersonClick?: (personId: string) => void,
  onAddMember?: (relatedPersonId: string, suggestedRole: string) => void,
): { nodes: Node[]; edges: Edge[] } {
  const { rootPersonId, people, relationships } = data;
  const missingLinks = showAddOptions ? data.missingLinks : [];

  // Build adjacency maps
  const spouses = new Map<string, Set<string>>();
  const parents = new Map<string, Set<string>>();
  const children = new Map<string, Set<string>>();
  const relTypeMap = new Map<string, string>();

  for (const rel of relationships) {
    const cat = getRelationshipCategory(rel.familyRelationshipType);
    relTypeMap.set(`${rel.fromPersonId}:${rel.toPersonId}`, rel.familyRelationshipType);

    if (cat === "spouse") {
      if (!spouses.has(rel.fromPersonId)) spouses.set(rel.fromPersonId, new Set());
      if (!spouses.has(rel.toPersonId)) spouses.set(rel.toPersonId, new Set());
      spouses.get(rel.fromPersonId)!.add(rel.toPersonId);
      spouses.get(rel.toPersonId)!.add(rel.fromPersonId);
    } else if (cat === "parent") {
      if (!parents.has(rel.toPersonId)) parents.set(rel.toPersonId, new Set());
      parents.get(rel.toPersonId)!.add(rel.fromPersonId);
      if (!children.has(rel.fromPersonId)) children.set(rel.fromPersonId, new Set());
      children.get(rel.fromPersonId)!.add(rel.toPersonId);
    } else if (cat === "child") {
      if (!parents.has(rel.fromPersonId)) parents.set(rel.fromPersonId, new Set());
      parents.get(rel.fromPersonId)!.add(rel.toPersonId);
      if (!children.has(rel.toPersonId)) children.set(rel.toPersonId, new Set());
      children.get(rel.toPersonId)!.add(rel.fromPersonId);
    }
  }

  // BFS to assign generations from root
  const generations = new Map<string, number>();
  generations.set(rootPersonId, 0);
  const queue = [rootPersonId];
  const visited = new Set<string>([rootPersonId]);

  while (queue.length > 0) {
    const current = queue.shift()!;
    const gen = generations.get(current)!;

    for (const parentId of parents.get(current) ?? []) {
      if (!visited.has(parentId)) {
        visited.add(parentId);
        generations.set(parentId, gen - 1);
        queue.push(parentId);
      }
    }
    for (const childId of children.get(current) ?? []) {
      if (!visited.has(childId)) {
        visited.add(childId);
        generations.set(childId, gen + 1);
        queue.push(childId);
      }
    }
    for (const spouseId of spouses.get(current) ?? []) {
      if (!visited.has(spouseId)) {
        visited.add(spouseId);
        generations.set(spouseId, gen);
        queue.push(spouseId);
      }
    }
  }

  // People not reachable by BFS fall back to stored depth
  for (const p of people) {
    if (!generations.has(p.id)) generations.set(p.id, p.depth);
  }

  // Inject virtual missing-link nodes
  const missingKindMap = new Map<string, "unknown" | "add">();

  for (const link of missingLinks) {
    const virtualId = `missing-${link.personId}-${link.missingRole}`;
    const relatedGen = generations.get(link.relatedPersonId);
    if (relatedGen === undefined) continue;

    let kind: "unknown" | "add" = "add";
    if (link.missingRole === "spouse") {
      kind = "unknown";
    } else if (link.missingRole === "father") {
      const hasRealMother = Array.from(parents.get(link.relatedPersonId) ?? []).some((pid) => {
        const t = relTypeMap.get(`${pid}:${link.relatedPersonId}`);
        return t === "mother";
      });
      kind = hasRealMother ? "unknown" : "add";
    } else if (link.missingRole === "mother") {
      const hasRealFather = Array.from(parents.get(link.relatedPersonId) ?? []).some((pid) => {
        const t = relTypeMap.get(`${pid}:${link.relatedPersonId}`);
        return t === "father" || t === "parent";
      });
      kind = hasRealFather ? "unknown" : "add";
    }

    missingKindMap.set(virtualId, kind);

    if (link.missingRole === "father" || link.missingRole === "mother" || link.missingRole === "parent") {
      generations.set(virtualId, relatedGen - 1);
    } else if (link.missingRole === "spouse") {
      generations.set(virtualId, relatedGen);
      if (!spouses.has(link.relatedPersonId)) spouses.set(link.relatedPersonId, new Set());
      if (!spouses.has(virtualId)) spouses.set(virtualId, new Set());
      spouses.get(link.relatedPersonId)!.add(virtualId);
      spouses.get(virtualId)!.add(link.relatedPersonId);
    } else if (link.missingRole === "sibling") {
      generations.set(virtualId, relatedGen);
    }
  }

  // Group by generation
  const genGroups = new Map<number, string[]>();
  for (const [id, gen] of generations) {
    if (!genGroups.has(gen)) genGroups.set(gen, []);
    genGroups.get(gen)!.push(id);
  }

  const sortedGens = Array.from(genGroups.keys()).sort((a, b) => a - b);

  // Identify couples
  const coupleSet = new Set<string>();
  const personCouple = new Map<string, string>();
  for (const [personId, spouseIds] of spouses) {
    for (const spouseId of spouseIds) {
      const key = [personId, spouseId].sort().join(":");
      if (!coupleSet.has(key) && generations.get(personId) === generations.get(spouseId)) {
        coupleSet.add(key);
        personCouple.set(personId, key);
        personCouple.set(spouseId, key);
      }
    }
  }

  // Position nodes
  const nodePositions = new Map<string, { x: number; y: number }>();
  const minGen = sortedGens.length > 0 ? sortedGens[0] : 0;

  for (const gen of sortedGens) {
    const members = genGroups.get(gen) ?? [];
    const row = gen - minGen;
    const y = row * (LAYOUT.NODE_HEIGHT + LAYOUT.VERTICAL_GAP);

    const processed = new Set<string>();
    const units: Array<{ ids: string[]; width: number }> = [];

    for (const pid of members) {
      if (processed.has(pid)) continue;
      processed.add(pid);

      const coupleKey = personCouple.get(pid);
      if (coupleKey) {
        const [a, b] = coupleKey.split(":");
        processed.add(a);
        processed.add(b);
        units.push({ ids: [a, b], width: LAYOUT.NODE_WIDTH * 2 + LAYOUT.SPOUSE_GAP });
      } else {
        units.push({ ids: [pid], width: LAYOUT.NODE_WIDTH });
      }
    }

    const totalWidth =
      units.reduce((sum, u) => sum + u.width, 0) + (units.length - 1) * LAYOUT.HORIZONTAL_GAP;
    let currentX = -totalWidth / 2;

    for (const unit of units) {
      if (unit.ids.length === 2) {
        const x1 = currentX;
        const x2 = currentX + LAYOUT.NODE_WIDTH + LAYOUT.SPOUSE_GAP;
        nodePositions.set(unit.ids[0], { x: x1, y });
        nodePositions.set(unit.ids[1], { x: x2, y });
        currentX += unit.width + LAYOUT.HORIZONTAL_GAP;
      } else {
        nodePositions.set(unit.ids[0], { x: currentX, y });
        currentX += unit.width + LAYOUT.HORIZONTAL_GAP;
      }
    }
  }

  // Build React Flow nodes
  const flowNodes: Node[] = [];
  const personMap = new Map(people.map((p) => [p.id, p]));

  for (const person of people) {
    const pos = nodePositions.get(person.id) ?? { x: 0, y: 0 };
    const relToRoot = relationships.find(
      (r) =>
        (r.fromPersonId === person.id && r.toPersonId === rootPersonId) ||
        (r.toPersonId === person.id && r.fromPersonId === rootPersonId),
    );
    let roleLabel = "";
    if (relToRoot) {
      if (relToRoot.fromPersonId === person.id) {
        roleLabel = formatRelationshipLabel(relToRoot.familyRelationshipType);
      } else {
        const category = getRelationshipCategory(relToRoot.familyRelationshipType);
        if (category === "parent") {
          roleLabel = "Child";
        } else if (category === "child") {
          roleLabel = formatRelationshipLabel(getInverseParentRole(relToRoot.familyRelationshipType));
        } else {
          roleLabel = formatRelationshipLabel(relToRoot.familyRelationshipType);
        }
      }
    }

    flowNodes.push({
      id: person.id,
      type: "person",
      position: pos,
      data: {
        label: `${person.firstName} ${person.lastName}`.trim(),
        sublabel: roleLabel,
        avatarUrl: person.avatarUrl,
        isRoot: person.id === rootPersonId,
        isMissing: false,
        viewMode,
        onPersonClick,
      } satisfies PersonNodeData,
      style: { width: LAYOUT.NODE_WIDTH, height: LAYOUT.NODE_HEIGHT },
    });
  }

  // Virtual / placeholder nodes
  for (const link of missingLinks) {
    const virtualId = `missing-${link.personId}-${link.missingRole}`;
    const pos = nodePositions.get(virtualId);
    if (!pos) continue;

    const kind = missingKindMap.get(virtualId) ?? "add";
    const roleLabel = formatRelationshipLabel(link.missingRole);
    const label = kind === "unknown" ? `Unknown ${roleLabel}` : `+ Add ${roleLabel}`;
    const sublabel = kind === "unknown" ? "Click to add" : "Optional";

    flowNodes.push({
      id: virtualId,
      type: "person",
      position: pos,
      data: {
        label,
        sublabel,
        isRoot: false,
        isMissing: true,
        missingKind: kind,
        viewMode,
        onAddMember,
        relatedPersonId: link.relatedPersonId,
        missingRole: link.missingRole,
      } satisfies PersonNodeData,
      style: { width: LAYOUT.NODE_WIDTH, height: LAYOUT.NODE_HEIGHT },
    });
  }

  // Build React Flow edges
  const flowEdges: Edge[] = [];
  const edgeSet = new Set<string>();

  for (const rel of relationships) {
    const cat = getRelationshipCategory(rel.familyRelationshipType);
    const edgeKey = [rel.fromPersonId, rel.toPersonId].sort().join(":");
    if (edgeSet.has(edgeKey)) continue;
    edgeSet.add(edgeKey);

    if (cat === "spouse") {
      flowEdges.push({
        id: `edge-${edgeKey}`,
        source: rel.fromPersonId,
        target: rel.toPersonId,
        type: "straight",
        style: {
          stroke: rel.familyRelationshipType === "ex_spouse" ? "#9ca3af" : "#6b7280",
          strokeDasharray: rel.familyRelationshipType === "ex_spouse" ? "5,5" : undefined,
          strokeWidth: 2,
        },
        sourceHandle: null,
        targetHandle: null,
      });
    } else if (cat === "parent") {
      flowEdges.push({
        id: `edge-${edgeKey}`,
        source: rel.fromPersonId,
        target: rel.toPersonId,
        type: "smoothstep",
        style: { stroke: "#6b7280", strokeWidth: 2 },
        markerEnd: { type: MarkerType.ArrowClosed, color: "#6b7280", width: 12, height: 12 },
      });
    } else if (cat === "child") {
      flowEdges.push({
        id: `edge-${edgeKey}`,
        source: rel.toPersonId,
        target: rel.fromPersonId,
        type: "smoothstep",
        style: { stroke: "#6b7280", strokeWidth: 2 },
        markerEnd: { type: MarkerType.ArrowClosed, color: "#6b7280", width: 12, height: 12 },
      });
    }
  }

  // Edges for virtual nodes
  for (const link of missingLinks) {
    const virtualId = `missing-${link.personId}-${link.missingRole}`;
    if (!nodePositions.has(virtualId)) continue;

    if (link.missingRole === "father" || link.missingRole === "mother" || link.missingRole === "parent") {
      const edgeKey = `${virtualId}:${link.relatedPersonId}`;
      flowEdges.push({
        id: `edge-${edgeKey}`,
        source: virtualId,
        target: link.relatedPersonId,
        type: "smoothstep",
        style: { stroke: "#9ca3af", strokeDasharray: "5,5", strokeWidth: 1.5 },
      });
    } else if (link.missingRole === "spouse") {
      const edgeKey = [virtualId, link.relatedPersonId].sort().join(":");
      if (!edgeSet.has(edgeKey)) {
        flowEdges.push({
          id: `edge-${edgeKey}`,
          source: virtualId,
          target: link.relatedPersonId,
          type: "straight",
          style: { stroke: "#9ca3af", strokeDasharray: "5,5", strokeWidth: 1.5 },
        });
      }
    } else if (link.missingRole === "sibling") {
      for (const parentId of parents.get(link.relatedPersonId) ?? []) {
        const edgeKey = `${parentId}:${virtualId}`;
        flowEdges.push({
          id: `edge-${edgeKey}`,
          source: parentId,
          target: virtualId,
          type: "smoothstep",
          style: { stroke: "#9ca3af", strokeDasharray: "5,5", strokeWidth: 1.5 },
        });
      }
    }
  }

  return { nodes: flowNodes, edges: flowEdges };
}

// ---------------------------------------------------------------------------
// Inner component (has access to useReactFlow)
// ---------------------------------------------------------------------------
interface FamilyTreeFlowInnerProps {
  data: FamilyTreeData;
  viewMode: FamilyTreeViewMode;
  showAddOptions: boolean;
  onPersonClick?: (personId: string) => void;
  onAddMember?: (relatedPersonId: string, suggestedRole: string) => void;
}

const FamilyTreeFlowInner = forwardRef<FamilyTreeCanvasHandle, FamilyTreeFlowInnerProps>(
  function FamilyTreeFlowInner({ data, viewMode, showAddOptions, onPersonClick, onAddMember }, ref) {
    const { fitView, zoomIn, zoomOut } = useReactFlow();

    const { nodes: initialNodes, edges: initialEdges } = useMemo(
      () => buildFlowElements(data, viewMode, showAddOptions, onPersonClick, onAddMember),
      [data, viewMode, showAddOptions, onPersonClick, onAddMember],
    );

    useImperativeHandle(ref, () => ({
      fitToScreen: () => fitView({ padding: 0.1, duration: 300 }),
      zoomIn: () => zoomIn({ duration: 200 }),
      zoomOut: () => zoomOut({ duration: 200 }),
    }));

    return (
      <ReactFlow
        nodes={initialNodes}
        edges={initialEdges}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.1 }}
        minZoom={0.1}
        maxZoom={3}
        nodesDraggable={true}
        nodesConnectable={false}
        elementsSelectable={true}
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="#e5e7eb" />
      </ReactFlow>
    );
  },
);

// ---------------------------------------------------------------------------
// Public component (wraps with ReactFlowProvider)
// ---------------------------------------------------------------------------
interface FamilyTreeFlowProps {
  data: FamilyTreeData | null;
  onPersonClick?: (personId: string) => void;
  onAddMember?: (relatedPersonId: string, suggestedRole: string) => void;
  className?: string;
  viewMode?: FamilyTreeViewMode;
  showAddOptions?: boolean;
}

export const FamilyTreeFlow = forwardRef<FamilyTreeCanvasHandle, FamilyTreeFlowProps>(
  function FamilyTreeFlow(
    { data, onPersonClick, onAddMember, className, viewMode = "name", showAddOptions = true },
    ref,
  ) {
    if (!data) return null;

    return (
      <div className={`w-full h-full ${className ?? ""}`}>
        <ReactFlowProvider>
          <FamilyTreeFlowInner
            ref={ref}
            data={data}
            viewMode={viewMode}
            showAddOptions={showAddOptions}
            onPersonClick={onPersonClick}
            onAddMember={onAddMember}
          />
        </ReactFlowProvider>
      </div>
    );
  },
);
