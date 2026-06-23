import { useMemo, forwardRef, useImperativeHandle, useCallback, useRef, useState } from "react";
import {
  ReactFlow,
  Node,
  Edge,
  Connection,
  useReactFlow,
  ReactFlowProvider,
  Background,
  BackgroundVariant,
  MarkerType,
  Handle,
  Position,
  EdgeProps,
  getBezierPath,
  BaseEdge,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Trash2 } from "lucide-react";
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
  // Optional / "+ Add" placeholder boxes are slightly smaller and greyed out
  ADD_NODE_WIDTH: 140,
  ADD_NODE_HEIGHT: 60,
  HORIZONTAL_GAP: 60,
  VERTICAL_GAP: 140,
  SPOUSE_GAP: 30,
  GROUP_PADDING: 10,
};

export type CoupleGroupColor = "together" | "dating";

// Relationship type helpers
const PARENT_TYPES = ["father", "mother", "parent", "stepfather", "stepmother", "stepparent"];
const CHILD_TYPES = ["child", "son", "daughter", "stepchild", "stepson", "stepdaughter"];
const SPOUSE_TYPES = ["spouse", "ex_spouse"];
const SIBLING_TYPES = ["sibling", "brother", "sister", "half_sibling", "half_brother", "half_sister"];

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

/**
 * Group node that wraps a spouse couple. Provides handles on all four sides
 * so edges can be routed to/from any direction. Color reflects relationship
 * status: green for "together" (default for spouse), orange for "dating".
 */
function CoupleGroupNode({ data }: { id: string; data: { color?: CoupleGroupColor } }) {
  const color: CoupleGroupColor = data.color ?? "together";
  const palette =
    color === "dating"
      ? {
          border: "border-orange-400 dark:border-orange-600",
          bg: "bg-orange-50/40 dark:bg-orange-950/20",
          handle: "!bg-orange-400",
        }
      : {
          border: "border-emerald-500 dark:border-emerald-600",
          bg: "bg-emerald-50/40 dark:bg-emerald-950/20",
          handle: "!bg-emerald-500",
        };

  const handleClass = `${palette.handle} !w-2 !h-2 !border-0`;

  return (
    <div className={`w-full h-full rounded-2xl border-2 ${palette.border} ${palette.bg}`}>
      <Handle id="top" type="source" position={Position.Top} className={handleClass} />
      <Handle id="top-target" type="target" position={Position.Top} className={handleClass} />
      <Handle id="bottom" type="source" position={Position.Bottom} className={handleClass} />
      <Handle id="bottom-target" type="target" position={Position.Bottom} className={handleClass} />
      <Handle id="left" type="source" position={Position.Left} className={handleClass} />
      <Handle id="left-target" type="target" position={Position.Left} className={handleClass} />
      <Handle id="right" type="source" position={Position.Right} className={handleClass} />
      <Handle id="right-target" type="target" position={Position.Right} className={handleClass} />
    </div>
  );
}

interface PersonNodeData {
  label: string;
  sublabel: string;
  avatarUrl?: string | null;
  isRoot: boolean;
  isMissing: boolean;
  missingKind?: "unknown" | "add";
  viewMode: FamilyTreeViewMode;
  onAddMember?: (relatedPersonId: string, suggestedRole: string) => void;
  relatedPersonId?: string;
  missingRole?: string;
}

function PersonNode({ data }: { data: PersonNodeData; id: string }) {
  // Only the "+ Add" / "Unknown" placeholder boxes have a built-in click
  // handler — real person nodes rely on ReactFlow's onNodeClick at the
  // graph level (so the dev page can wire single/double/right click).
  const handleClick =
    data.isMissing && data.onAddMember && data.relatedPersonId && data.missingRole
      ? () => data.onAddMember!(data.relatedPersonId!, data.missingRole!)
      : undefined;

  const baseClasses =
    "rounded-xl border-2 px-3 py-2 shadow-sm transition-all hover:shadow-md flex flex-col items-center justify-center text-center w-full h-full";

  let nodeClasses = baseClasses + " cursor-pointer";
  if (data.isMissing) {
    // Optional / placeholder nodes are visually de-emphasised (greyed out).
    if (data.missingKind === "unknown") {
      nodeClasses += " bg-sky-950/70 border-sky-700 text-sky-100 opacity-80";
    } else {
      nodeClasses += " bg-gray-700/60 border-gray-500 text-gray-200 opacity-70";
    }
  } else if (data.isRoot) {
    nodeClasses += " bg-white dark:bg-gray-900 border-blue-500 ring-2 ring-blue-200 dark:ring-blue-800";
  } else {
    nodeClasses += " bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-700";
  }

  const showAvatar = data.viewMode !== "name" && data.avatarUrl;
  const showName = data.viewMode !== "avatar-circle";
  const isCircle = data.viewMode === "avatar-circle";

  // Each side gets both a source and a target handle so edges can be drawn
  // and connected in either direction. Same id space across sides keeps
  // markup compact.
  const handleClass = "!bg-gray-400 !w-2 !h-2 !border-0";

  return (
    <div className={nodeClasses} onClick={handleClick}>
      <Handle id="top" type="target" position={Position.Top} className={handleClass} />
      <Handle id="top-source" type="source" position={Position.Top} className={handleClass} />
      <Handle id="left" type="target" position={Position.Left} className={handleClass} />
      <Handle id="left-source" type="source" position={Position.Left} className={handleClass} />
      <Handle id="right" type="target" position={Position.Right} className={handleClass} />
      <Handle id="right-source" type="source" position={Position.Right} className={handleClass} />
      {showAvatar && (
        <img
          src={data.avatarUrl ?? ""}
          alt={data.label}
          className={`object-cover ${isCircle ? "w-12 h-12 rounded-full" : "w-8 h-8 rounded-full mb-1"}`}
        />
      )}
      {showName && (
        <>
          <span className={`font-medium text-sm leading-tight ${data.isMissing ? "" : "text-gray-900 dark:text-gray-100"}`}>
            {data.label}
          </span>
          {data.sublabel && (
            <span className={`text-xs leading-tight mt-0.5 ${data.isMissing ? "opacity-70" : "text-muted-foreground"}`}>
              {data.sublabel}
            </span>
          )}
        </>
      )}
      {isCircle && !showAvatar && (
        <span className="font-medium text-sm leading-tight text-gray-900 dark:text-gray-100">
          {data.label}
        </span>
      )}
      <Handle id="bottom" type="source" position={Position.Bottom} className={handleClass} />
      <Handle id="bottom-target" type="target" position={Position.Bottom} className={handleClass} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Custom edge with delete button on hover
// ---------------------------------------------------------------------------

interface DeletableEdgeData {
  onDeleteEdge?: (edgeId: string) => void;
  stroke?: string;
  strokeDasharray?: string;
  strokeWidth?: number;
  markerEnd?: { type: MarkerType; color: string; width: number; height: number };
}

function DeletableEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  markerEnd,
}: EdgeProps & { data?: DeletableEdgeData }) {
  const [hovered, setHovered] = useState(false);
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  const stroke = data?.stroke ?? "#6b7280";
  const strokeWidth = data?.strokeWidth ?? 2;
  const strokeDasharray = data?.strokeDasharray;

  return (
    <g
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Invisible wider hit area for easier hover detection */}
      <path
        d={edgePath}
        fill="none"
        stroke="transparent"
        strokeWidth={20}
      />
      <BaseEdge
        id={id}
        path={edgePath}
        style={{ stroke, strokeWidth, strokeDasharray }}
        markerEnd={markerEnd}
      />
      {hovered && data?.onDeleteEdge && (
        <foreignObject
          x={labelX - 14}
          y={labelY - 14}
          width={28}
          height={28}
          className="overflow-visible"
        >
          <button
            className="flex items-center justify-center w-7 h-7 rounded-full bg-red-500 hover:bg-red-600 text-white shadow-md border border-red-400 transition-colors cursor-pointer"
            onClick={(e) => {
              e.stopPropagation();
              data.onDeleteEdge!(id);
            }}
            title="Delete connection"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </foreignObject>
      )}
    </g>
  );
}

const nodeTypes = { person: PersonNode, coupleGroup: CoupleGroupNode };
const edgeTypes = { deletable: DeletableEdge };

// ---------------------------------------------------------------------------
// Build React Flow nodes/edges from FamilyTreeData
// ---------------------------------------------------------------------------
function buildFlowElements(
  data: FamilyTreeData,
  viewMode: FamilyTreeViewMode,
  showAddOptions: boolean,
  onAddMember?: (relatedPersonId: string, suggestedRole: string) => void,
  onDeleteEdge?: (edgeId: string) => void,
): { nodes: Node[]; edges: Edge[] } {
  const { rootPersonId, people, relationships } = data;
  const missingLinks = showAddOptions ? data.missingLinks : [];

  // Build adjacency maps
  const spouses = new Map<string, Set<string>>();
  const parents = new Map<string, Set<string>>();
  const children = new Map<string, Set<string>>();
  const siblings = new Map<string, Set<string>>();
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
    } else if (SIBLING_TYPES.includes(rel.familyRelationshipType)) {
      if (!siblings.has(rel.fromPersonId)) siblings.set(rel.fromPersonId, new Set());
      if (!siblings.has(rel.toPersonId)) siblings.set(rel.toPersonId, new Set());
      siblings.get(rel.fromPersonId)!.add(rel.toPersonId);
      siblings.get(rel.toPersonId)!.add(rel.fromPersonId);
    }
  }

  // Propagate parent connections to siblings: if person A has parents and
  // person B is A's sibling but lacks those parent connections, inherit them.
  // This ensures all siblings connect to the same parent group visually.
  for (const [personId, siblingIds] of siblings) {
    const personParents = parents.get(personId);
    if (!personParents || personParents.size === 0) continue;
    for (const sibId of siblingIds) {
      if (!parents.has(sibId)) parents.set(sibId, new Set());
      const sibParents = parents.get(sibId)!;
      for (const parentId of personParents) {
        if (!sibParents.has(parentId)) {
          sibParents.add(parentId);
          // Also add to the children map for the parent
          if (!children.has(parentId)) children.set(parentId, new Set());
          children.get(parentId)!.add(sibId);
        }
      }
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
    for (const siblingId of siblings.get(current) ?? []) {
      if (!visited.has(siblingId)) {
        visited.add(siblingId);
        generations.set(siblingId, gen);
        queue.push(siblingId);
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
  // Track color: green ("together") for active spouse, orange ("dating") for ex_spouse
  // (the data model doesn't have a dedicated "dating" type, so ex_spouse is the
  // best surrogate for a non-active coupling).
  const coupleColor = new Map<string, CoupleGroupColor>();
  for (const [personId, spouseIds] of spouses) {
    for (const spouseId of spouseIds) {
      const key = [personId, spouseId].sort().join(":");
      if (!coupleSet.has(key) && generations.get(personId) === generations.get(spouseId)) {
        coupleSet.add(key);
        personCouple.set(personId, key);
        personCouple.set(spouseId, key);
        const relType =
          relTypeMap.get(`${personId}:${spouseId}`) ??
          relTypeMap.get(`${spouseId}:${personId}`);
        coupleColor.set(key, relType === "ex_spouse" ? "dating" : "together");
      }
    }
  }

  // Position nodes
  const nodePositions = new Map<string, { x: number; y: number }>();
  const minGen = sortedGens.length > 0 ? sortedGens[0] : 0;

  // Track couple group positions for later group node creation
  // coupleKey -> { x, y } of the group's top-left corner
  const coupleGroupPositions = new Map<string, { x: number; y: number }>();

  for (const gen of sortedGens) {
    const members = genGroups.get(gen) ?? [];
    const row = gen - minGen;
    const y = row * (LAYOUT.NODE_HEIGHT + LAYOUT.VERTICAL_GAP);

    const processed = new Set<string>();
    const units: Array<{ ids: string[]; width: number; coupleKey?: string }> = [];

    for (const pid of members) {
      if (processed.has(pid)) continue;
      processed.add(pid);

      const coupleKey = personCouple.get(pid);
      if (coupleKey) {
        const [a, b] = coupleKey.split(":");
        processed.add(a);
        processed.add(b);
        // Group width = padding + node + gap + node + padding
        const groupWidth = LAYOUT.GROUP_PADDING * 2 + LAYOUT.NODE_WIDTH * 2 + LAYOUT.SPOUSE_GAP;
        units.push({ ids: [a, b], width: groupWidth, coupleKey });
      } else {
        units.push({ ids: [pid], width: LAYOUT.NODE_WIDTH });
      }
    }

    const totalWidth =
      units.reduce((sum, u) => sum + u.width, 0) + (units.length - 1) * LAYOUT.HORIZONTAL_GAP;
    let currentX = -totalWidth / 2;

    for (const unit of units) {
      if (unit.ids.length === 2 && unit.coupleKey) {
        // Store the group's top-left position
        coupleGroupPositions.set(unit.coupleKey, { x: currentX, y });

        // Person positions are relative to the group node
        const x1Rel = LAYOUT.GROUP_PADDING;
        const x2Rel = LAYOUT.GROUP_PADDING + LAYOUT.NODE_WIDTH + LAYOUT.SPOUSE_GAP;
        const yRel = LAYOUT.GROUP_PADDING;

        // Store absolute positions (for edge routing debug / fallback) but mark them
        // as relative positions since they'll be children of the group
        nodePositions.set(unit.ids[0], { x: x1Rel, y: yRel });
        nodePositions.set(unit.ids[1], { x: x2Rel, y: yRel });
        currentX += unit.width + LAYOUT.HORIZONTAL_GAP;
      } else {
        nodePositions.set(unit.ids[0], { x: currentX, y });
        currentX += unit.width + LAYOUT.HORIZONTAL_GAP;
      }
    }
  }

  // Build a reverse lookup: personId -> coupleGroupId (for edge routing)
  const personToGroupId = new Map<string, string>();
  for (const coupleKey of coupleSet) {
    const [a, b] = coupleKey.split(":");
    const groupId = `couple-${coupleKey}`;
    personToGroupId.set(a, groupId);
    personToGroupId.set(b, groupId);
  }

  // Build React Flow nodes
  const flowNodes: Node[] = [];
  const personMap = new Map(people.map((p) => [p.id, p]));

  // 1. Create couple group nodes first (they must appear before their children in the array)
  for (const coupleKey of coupleSet) {
    const groupId = `couple-${coupleKey}`;
    const groupPos = coupleGroupPositions.get(coupleKey);
    if (!groupPos) continue;

    const groupWidth = LAYOUT.GROUP_PADDING * 2 + LAYOUT.NODE_WIDTH * 2 + LAYOUT.SPOUSE_GAP;
    const groupHeight = LAYOUT.GROUP_PADDING * 2 + LAYOUT.NODE_HEIGHT;

    flowNodes.push({
      id: groupId,
      type: "coupleGroup",
      position: groupPos,
      data: { color: coupleColor.get(coupleKey) ?? "together" },
      style: { width: groupWidth, height: groupHeight },
    });
  }

  // 2. Create person nodes (with parentId for coupled people)
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

    const groupId = personToGroupId.get(person.id);

    flowNodes.push({
      id: person.id,
      type: "person",
      position: pos,
      ...(groupId ? { parentId: groupId, extent: "parent" as const } : {}),
      data: {
        label: `${person.firstName} ${person.lastName}`.trim(),
        sublabel: roleLabel,
        avatarUrl: person.avatarUrl,
        isRoot: person.id === rootPersonId,
        isMissing: false,
        viewMode,
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

    const groupId = personToGroupId.get(virtualId);

    flowNodes.push({
      id: virtualId,
      type: "person",
      position: pos,
      ...(groupId ? { parentId: groupId, extent: "parent" as const } : {}),
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
      style: {
        width: LAYOUT.ADD_NODE_WIDTH,
        height: LAYOUT.ADD_NODE_HEIGHT,
        // Center smaller add nodes in the layout slot they were assigned.
        marginLeft: (LAYOUT.NODE_WIDTH - LAYOUT.ADD_NODE_WIDTH) / 2,
        marginTop: (LAYOUT.NODE_HEIGHT - LAYOUT.ADD_NODE_HEIGHT) / 2,
      },
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
      // Spouses in a group don't need an explicit edge – the group box shows the coupling.
      // Only draw a spouse edge if they are NOT in a couple group (shouldn't happen, but safe fallback).
      const groupA = personToGroupId.get(rel.fromPersonId);
      const groupB = personToGroupId.get(rel.toPersonId);
      if (groupA && groupA === groupB) continue; // same group – skip edge

      flowEdges.push({
        id: `edge-${edgeKey}`,
        source: rel.fromPersonId,
        target: rel.toPersonId,
        type: onDeleteEdge ? "deletable" : "default",
        ...(onDeleteEdge
          ? {
              data: {
                onDeleteEdge,
                stroke: rel.familyRelationshipType === "ex_spouse" ? "#9ca3af" : "#6b7280",
                strokeDasharray: rel.familyRelationshipType === "ex_spouse" ? "5,5" : undefined,
                strokeWidth: 2,
              },
            }
          : {
              style: {
                stroke: rel.familyRelationshipType === "ex_spouse" ? "#9ca3af" : "#6b7280",
                strokeDasharray: rel.familyRelationshipType === "ex_spouse" ? "5,5" : undefined,
                strokeWidth: 2,
              },
            }),
      });
    } else if (cat === "parent") {
      // fromPerson is parent of toPerson.
      // If the parent is in a couple group, route the edge from the group node so
      // a single line drops out of the couple box. Per the spec, edges always
      // terminate on the single child node — never on the child's couple group.
      const sourceGroupId = personToGroupId.get(rel.fromPersonId);
      const sourceId = sourceGroupId ?? rel.fromPersonId;
      const targetId = rel.toPersonId;

      // Deduplicate: multiple parents in the same group → only one edge from group to child
      const routedKey = [sourceId, targetId].sort().join(":");
      if (edgeSet.has(routedKey)) continue;
      edgeSet.add(routedKey);

      flowEdges.push({
        id: `edge-${routedKey}`,
        source: sourceId,
        target: targetId,
        sourceHandle: "bottom",
        targetHandle: "top",
        type: onDeleteEdge ? "deletable" : "default",
        ...(onDeleteEdge
          ? {
              data: {
                onDeleteEdge,
                stroke: "#6b7280",
                strokeWidth: 2,
                markerEnd: { type: MarkerType.ArrowClosed, color: "#6b7280", width: 12, height: 12 },
              },
            }
          : {
              style: { stroke: "#6b7280", strokeWidth: 2 },
              markerEnd: { type: MarkerType.ArrowClosed, color: "#6b7280", width: 12, height: 12 },
            }),
      });
    } else if (cat === "child") {
      // fromPerson is child of toPerson (i.e. toPerson is the parent).
      const sourceGroupId = personToGroupId.get(rel.toPersonId);
      const sourceId = sourceGroupId ?? rel.toPersonId;
      const targetId = rel.fromPersonId;

      const routedKey = [sourceId, targetId].sort().join(":");
      if (edgeSet.has(routedKey)) continue;
      edgeSet.add(routedKey);

      flowEdges.push({
        id: `edge-${routedKey}`,
        source: sourceId,
        target: targetId,
        sourceHandle: "bottom",
        targetHandle: "top",
        type: onDeleteEdge ? "deletable" : "default",
        ...(onDeleteEdge
          ? {
              data: {
                onDeleteEdge,
                stroke: "#6b7280",
                strokeWidth: 2,
                markerEnd: { type: MarkerType.ArrowClosed, color: "#6b7280", width: 12, height: 12 },
              },
            }
          : {
              style: { stroke: "#6b7280", strokeWidth: 2 },
              markerEnd: { type: MarkerType.ArrowClosed, color: "#6b7280", width: 12, height: 12 },
            }),
      });
    }
  }

  // Add edges for sibling-inherited parent connections (siblings connected to
  // parents they share via sibling relationship but lack direct parent edges)
  for (const [sibId] of siblings) {
    for (const parentId of parents.get(sibId) ?? []) {
      const sourceGroupId = personToGroupId.get(parentId);
      const sourceId = sourceGroupId ?? parentId;
      const targetId = sibId;

      const routedKey = [sourceId, targetId].sort().join(":");
      if (edgeSet.has(routedKey)) continue;
      edgeSet.add(routedKey);

      flowEdges.push({
        id: `edge-${routedKey}`,
        source: sourceId,
        target: targetId,
        sourceHandle: "bottom",
        targetHandle: "top",
        type: onDeleteEdge ? "deletable" : "default",
        ...(onDeleteEdge
          ? {
              data: {
                onDeleteEdge,
                stroke: "#6b7280",
                strokeWidth: 2,
                markerEnd: { type: MarkerType.ArrowClosed, color: "#6b7280", width: 12, height: 12 },
              },
            }
          : {
              style: { stroke: "#6b7280", strokeWidth: 2 },
              markerEnd: { type: MarkerType.ArrowClosed, color: "#6b7280", width: 12, height: 12 },
            }),
      });
    }
  }

  // Edges for virtual nodes
  for (const link of missingLinks) {
    const virtualId = `missing-${link.personId}-${link.missingRole}`;
    if (!nodePositions.has(virtualId)) continue;

    if (link.missingRole === "father" || link.missingRole === "mother" || link.missingRole === "parent") {
      // Route from the virtual parent (or its group) to the related child individual node.
      const sourceGroupId = personToGroupId.get(virtualId);
      const sourceId = sourceGroupId ?? virtualId;
      const targetId = link.relatedPersonId;

      const routedKey = `${sourceId}:${targetId}`;
      if (!edgeSet.has(routedKey)) {
        edgeSet.add(routedKey);
        flowEdges.push({
          id: `edge-${routedKey}`,
          source: sourceId,
          target: targetId,
          sourceHandle: "bottom",
          targetHandle: "top",
          type: "default",
          style: { stroke: "#9ca3af", strokeDasharray: "5,5", strokeWidth: 1.5 },
        });
      }
    } else if (link.missingRole === "spouse") {
      // If both are in the same group, no edge needed
      const virtualGroupId = personToGroupId.get(virtualId);
      const relatedGroupId = personToGroupId.get(link.relatedPersonId);
      if (virtualGroupId && virtualGroupId === relatedGroupId) continue;

      const edgeKey = [virtualId, link.relatedPersonId].sort().join(":");
      if (!edgeSet.has(edgeKey)) {
        flowEdges.push({
          id: `edge-${edgeKey}`,
          source: virtualId,
          target: link.relatedPersonId,
          type: "default",
          style: { stroke: "#9ca3af", strokeDasharray: "5,5", strokeWidth: 1.5 },
        });
      }
    } else if (link.missingRole === "sibling") {
      // The virtual sibling is treated like a real child of each known parent.
      for (const parentId of parents.get(link.relatedPersonId) ?? []) {
        const sourceGroupId = personToGroupId.get(parentId);
        const sourceId = sourceGroupId ?? parentId;
        const targetId = virtualId;

        const routedKey = `${sourceId}:${targetId}`;
        if (!edgeSet.has(routedKey)) {
          edgeSet.add(routedKey);
          flowEdges.push({
            id: `edge-${routedKey}`,
            source: sourceId,
            target: targetId,
            sourceHandle: "bottom",
            targetHandle: "top",
            type: "default",
            style: { stroke: "#9ca3af", strokeDasharray: "5,5", strokeWidth: 1.5 },
          });
        }
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
  onPersonDoubleClick?: (personId: string) => void;
  onPersonContextMenu?: (personId: string, x: number, y: number) => void;
  onAddMember?: (relatedPersonId: string, suggestedRole: string) => void;
  onConnectPersons?: (sourcePersonId: string, targetPersonId: string) => void;
  /** Fired when the user drags from a couple group's bottom handle to a real person node.
   *  The dev page uses this to add the target as a child of both spouses in the group. */
  onConnectGroupChild?: (groupId: string, targetPersonId: string) => void;
  /** Fired when the user drags from a person's side handle and releases without connecting.
   *  Used to prompt adding a spouse for that person. */
  onDragEndNoTarget?: (sourcePersonId: string) => void;
  /** Fired when the user clicks the delete button on an edge. */
  onDeleteEdge?: (edgeId: string) => void;
}

/** Returns true when a node id refers to a real person (not a couple group or virtual placeholder). */
function isRealPersonId(nodeId: string): boolean {
  return !nodeId.startsWith("couple-") && !nodeId.startsWith("missing-");
}

/** Returns true when a node id refers to a couple group node. */
function isCoupleGroupId(nodeId: string): boolean {
  return nodeId.startsWith("couple-");
}

const FamilyTreeFlowInner = forwardRef<FamilyTreeCanvasHandle, FamilyTreeFlowInnerProps>(
  function FamilyTreeFlowInner(
    {
      data,
      viewMode,
      showAddOptions,
      onPersonClick,
      onPersonDoubleClick,
      onPersonContextMenu,
      onAddMember,
      onConnectPersons,
      onConnectGroupChild,
      onDragEndNoTarget,
      onDeleteEdge,
    },
    ref,
  ) {
    const { fitView, zoomIn, zoomOut } = useReactFlow();
    const connectingNodeId = useRef<string | null>(null);

    const { nodes: initialNodes, edges: initialEdges } = useMemo(
      () => buildFlowElements(data, viewMode, showAddOptions, onAddMember, onDeleteEdge),
      [data, viewMode, showAddOptions, onAddMember, onDeleteEdge],
    );

    useImperativeHandle(ref, () => ({
      fitToScreen: () => fitView({ padding: 0.1, duration: 300 }),
      zoomIn: () => zoomIn({ duration: 200 }),
      zoomOut: () => zoomOut({ duration: 200 }),
    }));

    const handleNodeClick = useCallback(
      (_event: React.MouseEvent, node: Node) => {
        if (onPersonClick && isRealPersonId(node.id)) onPersonClick(node.id);
      },
      [onPersonClick],
    );

    const handleNodeDoubleClick = useCallback(
      (_event: React.MouseEvent, node: Node) => {
        if (onPersonDoubleClick && isRealPersonId(node.id)) onPersonDoubleClick(node.id);
      },
      [onPersonDoubleClick],
    );

    const handleNodeContextMenu = useCallback(
      (event: React.MouseEvent, node: Node) => {
        if (!onPersonContextMenu || !isRealPersonId(node.id)) return;
        event.preventDefault();
        onPersonContextMenu(node.id, event.clientX, event.clientY);
      },
      [onPersonContextMenu],
    );

    const handleConnectStart = useCallback(
      (_event: MouseEvent | TouchEvent, params: { nodeId: string | null; handleId: string | null }) => {
        connectingNodeId.current = params.nodeId;
      },
      [],
    );

    const handleConnectEnd = useCallback(
      (_event: MouseEvent | TouchEvent, connectionState: { isValid: boolean | null }) => {
        if (!onDragEndNoTarget || !connectingNodeId.current) return;
        // If connection was not successfully completed (i.e. didn't land on a valid target)
        if (!connectionState.isValid && isRealPersonId(connectingNodeId.current)) {
          onDragEndNoTarget(connectingNodeId.current);
        }
        connectingNodeId.current = null;
      },
      [onDragEndNoTarget],
    );

    const handleConnect = useCallback(
      (connection: Connection) => {
        if (!connection.source || !connection.target) return;
        if (connection.source === connection.target) return;

        // Dragging from a couple group's bottom handle to a real person adds
        // that person as a child of both spouses in the group.
        if (
          isCoupleGroupId(connection.source) &&
          isRealPersonId(connection.target) &&
          typeof connection.sourceHandle === "string" &&
          connection.sourceHandle.startsWith("bottom") &&
          onConnectGroupChild
        ) {
          onConnectGroupChild(connection.source, connection.target);
          return;
        }

        if (!onConnectPersons) return;
        // Only allow drawing person-to-person relationships between real people.
        if (!isRealPersonId(connection.source) || !isRealPersonId(connection.target)) return;
        onConnectPersons(connection.source, connection.target);
      },
      [onConnectPersons, onConnectGroupChild],
    );

    return (
      <ReactFlow
        nodes={initialNodes}
        edges={initialEdges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        fitView
        fitViewOptions={{ padding: 0.1 }}
        minZoom={0.1}
        maxZoom={3}
        nodesDraggable={true}
        nodesConnectable={!!onConnectPersons || !!onConnectGroupChild}
        elementsSelectable={true}
        proOptions={{ hideAttribution: true }}
        onNodeClick={handleNodeClick}
        onNodeDoubleClick={handleNodeDoubleClick}
        onNodeContextMenu={handleNodeContextMenu}
        onConnectStart={handleConnectStart}
        onConnectEnd={handleConnectEnd}
        onConnect={handleConnect}
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
  onPersonDoubleClick?: (personId: string) => void;
  onPersonContextMenu?: (personId: string, x: number, y: number) => void;
  onAddMember?: (relatedPersonId: string, suggestedRole: string) => void;
  onConnectPersons?: (sourcePersonId: string, targetPersonId: string) => void;
  onConnectGroupChild?: (groupId: string, targetPersonId: string) => void;
  onDragEndNoTarget?: (sourcePersonId: string) => void;
  onDeleteEdge?: (edgeId: string) => void;
  className?: string;
  viewMode?: FamilyTreeViewMode;
  showAddOptions?: boolean;
}

export const FamilyTreeFlow = forwardRef<FamilyTreeCanvasHandle, FamilyTreeFlowProps>(
  function FamilyTreeFlow(
    {
      data,
      onPersonClick,
      onPersonDoubleClick,
      onPersonContextMenu,
      onAddMember,
      onConnectPersons,
      onConnectGroupChild,
      onDragEndNoTarget,
      onDeleteEdge,
      className,
      viewMode = "name",
      showAddOptions = true,
    },
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
            onPersonDoubleClick={onPersonDoubleClick}
            onPersonContextMenu={onPersonContextMenu}
            onAddMember={onAddMember}
            onConnectPersons={onConnectPersons}
            onConnectGroupChild={onConnectGroupChild}
            onDragEndNoTarget={onDragEndNoTarget}
            onDeleteEdge={onDeleteEdge}
          />
        </ReactFlowProvider>
      </div>
    );
  },
);
