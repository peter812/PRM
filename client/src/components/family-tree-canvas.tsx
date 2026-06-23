import { useEffect, useRef, useCallback, forwardRef, useImperativeHandle } from "react";
import { Application, Assets, Container, Graphics, Sprite, Text, TextStyle, Texture } from "pixi.js";

export type FamilyTreeViewMode = "name" | "avatar-name" | "avatar-circle";

// Layout constants
const LAYOUT = {
  NODE_WIDTH: 160,
  NODE_HEIGHT: 80,
  HORIZONTAL_GAP: 40,
  VERTICAL_GAP: 100,
  SPOUSE_GAP: 20,
  COUPLE_LINE_DROP: 40,
  AVATAR_SIZE: 56,
  CIRCLE_DIAMETER: 96,
  NODE_ROUNDING: 16,
};

// Colors
const COLORS = {
  PERSON_BG: 0xffffff,
  PERSON_BORDER: 0xe5e7eb,
  PERSON_ACCENT: 0xef4444,
  ROOT_ACCENT: 0x3b82f6,
  // "Unknown" = definitely exists but not yet recorded (blue-tinted dark)
  UNKNOWN_BG: 0x1e3a4c,
  UNKNOWN_ACCENT: 0x38bdf8,
  // "Add" = optional extension (neutral dark)
  ADD_BG: 0x1f2937,
  ADD_ACCENT: 0x6b7280,
  MISSING_TEXT: 0xf9fafb,
  LINE_COLOR: 0x6b7280,
  LINE_DASHED: 0x9ca3af,
  CANVAS_BG: 0xf9fafb,
  CANVAS_BG_DARK: 0x111827,
  HOVER_SHADOW: 0x3b82f6,
};

export interface FamilyTreePerson {
  id: string;
  firstName: string;
  lastName: string;
  avatarUrl: string | null;
  depth: number;
}

export interface FamilyTreeRelationship {
  id: string;
  fromPersonId: string;
  toPersonId: string;
  familyRelationshipType: string;
}

export interface MissingLink {
  personId: string;
  missingRole: string;
  context: string;
  relatedPersonId: string;
}

export interface FamilyTreeData {
  rootPersonId: string;
  people: FamilyTreePerson[];
  relationships: FamilyTreeRelationship[];
  missingLinks: MissingLink[];
}

interface RenderNode {
  id: string;
  person?: FamilyTreePerson;
  x: number;
  y: number;
  isMissing: boolean;
  /** "unknown" = person definitely exists but is not yet recorded.
   *  "add"     = person may or may not exist (optional extension). */
  missingKind?: "unknown" | "add";
  missingRole?: string;
  relatedPersonId?: string;
  label: string;
  sublabel: string;
}

interface RenderEdge {
  from: string;
  to: string;
  type: "spouse" | "parent-child";
  style: "solid" | "dashed";
}

interface FamilyTreeCanvasProps {
  data: FamilyTreeData | null;
  onPersonClick?: (personId: string) => void;
  onAddMember?: (relatedPersonId: string, suggestedRole: string) => void;
  className?: string;
  viewMode?: FamilyTreeViewMode;
  /** When false, all placeholder / unknown / add-person nodes are hidden. Default true. */
  showAddOptions?: boolean;
}

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
// Build tree structure from flat API data
// ---------------------------------------------------------------------------
function buildRenderTree(
  data: FamilyTreeData,
  showAddOptions: boolean = true,
): { nodes: RenderNode[]; edges: RenderEdge[] } {
  const { rootPersonId, people, relationships } = data;

  // Apply the global toggle — treat missingLinks as empty when disabled.
  const missingLinks = showAddOptions ? data.missingLinks : [];

  // Build adjacency maps
  const spouses = new Map<string, Set<string>>();
  const parents = new Map<string, Set<string>>(); // child -> set of parent IDs
  const children = new Map<string, Set<string>>(); // parent -> set of child IDs
  const siblings = new Map<string, Set<string>>();
  const relTypeMap = new Map<string, string>(); // "from:to" -> type

  for (const rel of relationships) {
    const cat = getRelationshipCategory(rel.familyRelationshipType);
    relTypeMap.set(`${rel.fromPersonId}:${rel.toPersonId}`, rel.familyRelationshipType);

    if (cat === "spouse") {
      if (rel.familyRelationshipType === "ex_spouse" || rel.familyRelationshipType === "ex_partner") {
        // Divorced spouses do not form a couple group/lineage grouping
      } else {
        if (!spouses.has(rel.fromPersonId)) spouses.set(rel.fromPersonId, new Set());
        if (!spouses.has(rel.toPersonId)) spouses.set(rel.toPersonId, new Set());
        spouses.get(rel.fromPersonId)!.add(rel.toPersonId);
        spouses.get(rel.toPersonId)!.add(rel.fromPersonId);
      }
    } else if (cat === "parent") {
      // fromPerson is parent of toPerson
      if (!parents.has(rel.toPersonId)) parents.set(rel.toPersonId, new Set());
      parents.get(rel.toPersonId)!.add(rel.fromPersonId);
      if (!children.has(rel.fromPersonId)) children.set(rel.fromPersonId, new Set());
      children.get(rel.fromPersonId)!.add(rel.toPersonId);
    } else if (cat === "child") {
      // fromPerson is child of toPerson
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
  for (const [personId, siblingIds] of siblings) {
    const personParents = parents.get(personId);
    if (!personParents || personParents.size === 0) continue;
    for (const sibId of siblingIds) {
      if (!parents.has(sibId)) parents.set(sibId, new Set());
      const sibParents = parents.get(sibId)!;
      for (const parentId of personParents) {
        if (!sibParents.has(parentId)) {
          sibParents.add(parentId);
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

  // People not reachable by BFS fall back to their stored depth
  for (const p of people) {
    if (!generations.has(p.id)) generations.set(p.id, p.depth);
  }

  // -------------------------------------------------------------------------
  // Inject virtual missing-link nodes into the generation layout
  // -------------------------------------------------------------------------
  const missingKindMap = new Map<string, "unknown" | "add">();

  for (const link of missingLinks) {
    const virtualId = `missing-${link.personId}-${link.missingRole}`;
    const relatedGen = generations.get(link.relatedPersonId);
    if (relatedGen === undefined) continue;

    // Determine semantic kind ------------------------------------------------
    let kind: "unknown" | "add" = "add";

    if (link.missingRole === "spouse") {
      kind = "unknown"; // co-parent definitely exists biologically
    } else if (link.missingRole === "father") {
      // "Unknown" only when a real mother already exists in the tree
      const hasRealMother = Array.from(parents.get(link.relatedPersonId) ?? []).some((pid) => {
        const t = relTypeMap.get(`${pid}:${link.relatedPersonId}`);
        return t === "mother";
      });
      kind = hasRealMother ? "unknown" : "add";
    } else if (link.missingRole === "mother") {
      // "Unknown" only when a real father already exists in the tree
      const hasRealFather = Array.from(parents.get(link.relatedPersonId) ?? []).some((pid) => {
        const t = relTypeMap.get(`${pid}:${link.relatedPersonId}`);
        return t === "father" || t === "parent";
      });
      kind = hasRealFather ? "unknown" : "add";
    }
    // sibling / parent -> always "add"

    missingKindMap.set(virtualId, kind);

    // Assign generation for layout -------------------------------------------
    if (link.missingRole === "father" || link.missingRole === "mother" || link.missingRole === "parent") {
      generations.set(virtualId, relatedGen - 1);
    } else if (link.missingRole === "spouse") {
      generations.set(virtualId, relatedGen);
      // Register as spouse pair so couple-layout positions them side-by-side
      if (!spouses.has(link.relatedPersonId)) spouses.set(link.relatedPersonId, new Set());
      if (!spouses.has(virtualId)) spouses.set(virtualId, new Set());
      spouses.get(link.relatedPersonId)!.add(virtualId);
      spouses.get(virtualId)!.add(link.relatedPersonId);
    } else if (link.missingRole === "sibling") {
      generations.set(virtualId, relatedGen);
    }
  }

  // Group all IDs (real + virtual) by generation
  const genGroups = new Map<number, string[]>();
  for (const [id, gen] of generations) {
    if (!genGroups.has(gen)) genGroups.set(gen, []);
    genGroups.get(gen)!.push(id);
  }

  // Sort generations
  const sortedGens = Array.from(genGroups.keys()).sort((a, b) => a - b);

  // Identify couples (real + virtual spouses)
  const coupleSet = new Set<string>(); // "a:b" sorted pair
  const personCouple = new Map<string, string>(); // personId -> coupleKey
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

  // ---- Reorder: sibling virtual nodes should appear adjacent to their relative ----
  for (const link of missingLinks) {
    if (link.missingRole !== "sibling") continue;
    const virtualId = `missing-${link.personId}-${link.missingRole}`;
    const gen = generations.get(virtualId);
    if (gen === undefined) continue;
    const group = genGroups.get(gen);
    if (!group) continue;
    const curIdx = group.indexOf(virtualId);
    const relIdx = group.indexOf(link.relatedPersonId);
    if (curIdx !== -1 && relIdx !== -1) {
      // Determine if the relative is part of a couple in this generation
      const coupleKey = personCouple.get(link.relatedPersonId);
      let isLeftSpouse = false;
      let hasSpouse = false;
      if (coupleKey) {
        hasSpouse = true;
        const [a] = coupleKey.split(":");
        if (link.relatedPersonId === a) {
          isLeftSpouse = true;
        }
      }

      group.splice(curIdx, 1);
      const newRelIdx = group.indexOf(link.relatedPersonId);
      if (hasSpouse && isLeftSpouse) {
        // Left spouse's sibling goes to the left
        group.splice(newRelIdx, 0, virtualId);
      } else {
        // Right spouse's sibling (or single person sibling) goes to the right
        group.splice(newRelIdx + 1, 0, virtualId);
      }
    }
  }

  // ---- Reorder: parents in each generation G to align with the order of children in G+1 ----
  for (const gen of sortedGens) {
    const group = genGroups.get(gen);
    if (!group) continue;
    const childrenList = genGroups.get(gen + 1) ?? [];

    const orderedParents: string[] = [];
    const visitedParents = new Set<string>();

    const getParentScore = (pid: string, childId: string) => {
      if (pid.includes("-father")) return 1;
      if (pid.includes("-mother")) return 2;
      const type = relTypeMap.get(`${pid}:${childId}`);
      if (type === "father" || type === "stepfather") return 1;
      if (type === "mother" || type === "stepmother") return 2;
      return 3;
    };

    for (const childId of childrenList) {
      const realParents = Array.from(parents.get(childId) ?? []).filter(
        (pid) => generations.get(pid) === gen,
      );
      const virtualParents = [
        `missing-${childId}-father`,
        `missing-${childId}-mother`,
        `missing-${childId}-parent`,
      ].filter((pid) => group.includes(pid));

      const parentsOfC = [...realParents, ...virtualParents];
      parentsOfC.sort((x, y) => getParentScore(x, childId) - getParentScore(y, childId));

      for (const p of parentsOfC) {
        if (!visitedParents.has(p)) {
          visitedParents.add(p);
          orderedParents.push(p);
        }
      }
    }

    let parentInsertIdx = 0;
    const newGroup = group.map((pid) => {
      if (visitedParents.has(pid)) {
        return orderedParents[parentInsertIdx++];
      }
      return pid;
    });
    genGroups.set(gen, newGroup);
  }

  // Position nodes generation by generation
  const nodes: RenderNode[] = [];
  const nodePositions = new Map<string, { x: number; y: number }>();
  const minGen = sortedGens.length > 0 ? sortedGens[0] : 0;

  for (const gen of sortedGens) {
    const members = genGroups.get(gen) ?? [];
    const row = gen - minGen;
    const y = row * (LAYOUT.NODE_HEIGHT + LAYOUT.VERTICAL_GAP);

    // Group into couples and singles
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
        const x1 = currentX + LAYOUT.NODE_WIDTH / 2;
        const x2 = currentX + LAYOUT.NODE_WIDTH + LAYOUT.SPOUSE_GAP + LAYOUT.NODE_WIDTH / 2;
        nodePositions.set(unit.ids[0], { x: x1, y });
        nodePositions.set(unit.ids[1], { x: x2, y });
        currentX += unit.width + LAYOUT.HORIZONTAL_GAP;
      } else {
        const x = currentX + LAYOUT.NODE_WIDTH / 2;
        nodePositions.set(unit.ids[0], { x, y });
        currentX += unit.width + LAYOUT.HORIZONTAL_GAP;
      }
    }
  }

  // ---- Real person render nodes -------------------------------------------
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

    nodes.push({
      id: person.id,
      person,
      x: pos.x,
      y: pos.y,
      isMissing: false,
      label: `${person.firstName} ${person.lastName}`.trim(),
      sublabel: roleLabel,
    });
  }

  // ---- Virtual / placeholder render nodes ---------------------------------
  for (const link of missingLinks) {
    const virtualId = `missing-${link.personId}-${link.missingRole}`;
    const pos = nodePositions.get(virtualId);
    if (!pos) continue;

    const kind = missingKindMap.get(virtualId) ?? "add";
    const roleLabel = formatRelationshipLabel(link.missingRole);
    const label = kind === "unknown" ? `Unknown ${roleLabel}` : `+ Add ${roleLabel}`;
    const sublabel = kind === "unknown" ? "Click to add" : "Optional";

    nodes.push({
      id: virtualId,
      x: pos.x,
      y: pos.y,
      isMissing: true,
      missingKind: kind,
      missingRole: link.missingRole,
      relatedPersonId: link.relatedPersonId,
      label,
      sublabel,
    });
  }

  // ---- Edges from real relationships --------------------------------------
  const edges: RenderEdge[] = [];
  const edgeSet = new Set<string>();

  // Couples with shared REAL children suppress their direct spouse line
  const coupleHasSharedChildren = new Set<string>();
  for (const [a, spouseSet] of spouses) {
    for (const b of spouseSet) {
      const key = [a, b].sort().join(":");
      if (coupleHasSharedChildren.has(key)) continue;
      const aChildren = children.get(a);
      const bChildren = children.get(b);
      if (aChildren && bChildren) {
        for (const c of aChildren) {
          if (bChildren.has(c) && !c.startsWith("missing-")) {
            coupleHasSharedChildren.add(key);
            break;
          }
        }
      }
    }
  }

  for (const rel of relationships) {
    const cat = getRelationshipCategory(rel.familyRelationshipType);
    const edgeKey = [rel.fromPersonId, rel.toPersonId].sort().join(":");
    if (edgeSet.has(edgeKey)) continue;
    edgeSet.add(edgeKey);

    if (cat === "spouse") {
      if (coupleHasSharedChildren.has(edgeKey)) continue;
      edges.push({
        from: rel.fromPersonId,
        to: rel.toPersonId,
        type: "spouse",
        style: rel.familyRelationshipType === "ex_spouse" ? "dashed" : "solid",
      });
    } else if (cat === "parent") {
      edges.push({ from: rel.fromPersonId, to: rel.toPersonId, type: "parent-child", style: "solid" });
    } else if (cat === "child") {
      edges.push({ from: rel.toPersonId, to: rel.fromPersonId, type: "parent-child", style: "solid" });
    }
  }

  // Add edges for sibling-inherited parent connections (siblings connected to
  // parents they share via sibling relationship but lack direct parent edges)
  for (const [sibId] of siblings) {
    for (const parentId of parents.get(sibId) ?? []) {
      const edgeKey = [parentId, sibId].sort().join(":");
      if (edgeSet.has(edgeKey)) continue;
      edgeSet.add(edgeKey);
      edges.push({ from: parentId, to: sibId, type: "parent-child", style: "solid" });
    }
  }

  // ---- Edges for virtual / placeholder nodes ------------------------------
  for (const link of missingLinks) {
    const virtualId = `missing-${link.personId}-${link.missingRole}`;
    if (!nodePositions.has(virtualId)) continue;

    if (link.missingRole === "father" || link.missingRole === "mother" || link.missingRole === "parent") {
      // Dashed parent -> child elbow
      edges.push({ from: virtualId, to: link.relatedPersonId, type: "parent-child", style: "dashed" });
    } else if (link.missingRole === "spouse") {
      // Dashed spouse line (positioned as a couple so it is short and correct)
      const pairKey = [virtualId, link.relatedPersonId].sort().join(":");
      if (!coupleHasSharedChildren.has(pairKey)) {
        edges.push({ from: virtualId, to: link.relatedPersonId, type: "spouse", style: "dashed" });
      }
    } else if (link.missingRole === "sibling") {
      // Connect virtual sibling to each real shared parent with dashed lines
      for (const parentId of parents.get(link.relatedPersonId) ?? []) {
        edges.push({ from: parentId, to: virtualId, type: "parent-child", style: "dashed" });
      }
      // If no parents in tree, positional proximity conveys the relationship
    }
  }

  return { nodes, edges };
}

export interface FamilyTreeCanvasHandle {
  fitToScreen: () => void;
  zoomIn: () => void;
  zoomOut: () => void;
  getLayoutData?: () => { nodes: any[]; edges: any[] };
}

export const FamilyTreeCanvas = forwardRef<FamilyTreeCanvasHandle, FamilyTreeCanvasProps>(
  function FamilyTreeCanvas(
    { data, onPersonClick, onAddMember, className, viewMode = "name", showAddOptions = true },
    ref,
  ) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const appRef = useRef<Application | null>(null);
  const containerRef = useRef<Container | null>(null);
  const isMountedRef = useRef(true);
  const isDraggingRef = useRef(false);
  const dragStartRef = useRef<{ x: number; y: number } | null>(null);
  const lastPanRef = useRef<{ x: number; y: number } | null>(null);

  const isDarkMode = document.documentElement.classList.contains("dark");

  const destroyApp = useCallback(() => {
    isDraggingRef.current = false;
    dragStartRef.current = null;
    lastPanRef.current = null;
    if (appRef.current) {
      try {
        appRef.current.destroy(true);
      } catch {
        // ignore
      }
      appRef.current = null;
      containerRef.current = null;
    }
  }, []);

  // Fit to screen
  const fitToScreen = useCallback(() => {
    const container = containerRef.current;
    const app = appRef.current;
    if (!container || !app) return;

    const bounds = container.getLocalBounds();
    if (bounds.width === 0 || bounds.height === 0) return;

    const canvasW = app.screen.width;
    const canvasH = app.screen.height;
    const padding = 60;
    const scaleX = (canvasW - padding * 2) / bounds.width;
    const scaleY = (canvasH - padding * 2) / bounds.height;
    const scale = Math.min(scaleX, scaleY, 2);

    container.scale.set(scale);
    container.x = canvasW / 2 - (bounds.x + bounds.width / 2) * scale;
    container.y = canvasH / 2 - (bounds.y + bounds.height / 2) * scale;

    app.renderer.render(app.stage);
  }, []);

  const zoomBy = useCallback((delta: number) => {
    const container = containerRef.current;
    const app = appRef.current;
    if (!container || !app) return;
    const newScale = Math.min(Math.max(container.scale.x + delta, 0.1), 3.0);
    container.scale.set(newScale);
    app.renderer.render(app.stage);
  }, []);

  useImperativeHandle(ref, () => ({
    fitToScreen,
    zoomIn: () => zoomBy(0.2),
    zoomOut: () => zoomBy(-0.2),
  }), [fitToScreen, zoomBy]);

  useEffect(() => {
    isMountedRef.current = true;

    if (!canvasRef.current || !data) return;

    const initCanvas = async () => {
      isDraggingRef.current = false;
      dragStartRef.current = null;
      lastPanRef.current = null;
      destroyApp();

      if (!canvasRef.current || !isMountedRef.current) return;

      const app = new Application();
      await app.init({
        width: canvasRef.current.clientWidth || 800,
        height: canvasRef.current.clientHeight || 600,
        backgroundAlpha: 0,
        antialias: true,
        resolution: window.devicePixelRatio || 1,
        autoDensity: true,
        preference: "webgl",
        autoStart: false,
      });

      if (!canvasRef.current || !isMountedRef.current) {
        app.destroy(true);
        return;
      }

      canvasRef.current.appendChild(app.canvas);
      appRef.current = app;

      const container = new Container();
      app.stage.addChild(container);
      containerRef.current = container;

      // Build tree (includes virtual placeholder nodes when showAddOptions=true)
      const { nodes, edges } = buildRenderTree(data, showAddOptions);

      const nodeGraphicsMap = new Map<string, { graphics: Graphics; x: number; y: number }>();

      // Draw edges first (behind nodes)
      const edgeGraphics = new Graphics();
      container.addChild(edgeGraphics);

      for (const edge of edges) {
        const fromNode = nodes.find((n) => n.id === edge.from);
        const toNode = nodes.find((n) => n.id === edge.to);
        if (!fromNode || !toNode) continue;

        const color = edge.style === "dashed" ? COLORS.LINE_DASHED : COLORS.LINE_COLOR;

        if (edge.type === "spouse") {
          // Horizontal line between spouses
          const y = fromNode.y + LAYOUT.NODE_HEIGHT / 2;
          const x1 = Math.min(fromNode.x, toNode.x) + LAYOUT.NODE_WIDTH / 2;
          const x2 = Math.max(fromNode.x, toNode.x) - LAYOUT.NODE_WIDTH / 2;

          if (edge.style === "dashed") {
            drawDashedLine(edgeGraphics, x1, y, x2, y, color, 2, 5);
          } else {
            edgeGraphics.moveTo(x1, y);
            edgeGraphics.lineTo(x2, y);
            edgeGraphics.stroke({ color, width: 2 });
          }
        } else {
          // Parent -> child elbow line with 12px rounded corners
          const parentY = fromNode.y + LAYOUT.NODE_HEIGHT;
          const childY = toNode.y;
          const parentX = fromNode.x;
          const childX = toNode.x;
          const midY = parentY + (childY - parentY) / 2;

          if (parentX === childX) {
            // Straight vertical line
            if (edge.style === "dashed") {
              const state = { isDash: true, rem: 5 };
              drawDashedSegment(edgeGraphics, parentX, parentY, childX, childY, color, 2, 5, state);
            } else {
              edgeGraphics.moveTo(parentX, parentY);
              edgeGraphics.lineTo(childX, childY);
              edgeGraphics.stroke({ color, width: 2 });
            }
          } else {
            const sign = parentX < childX ? 1 : -1;
            const r = Math.min(12, Math.abs(childX - parentX) / 2, Math.abs(midY - parentY), Math.abs(childY - midY));

            if (edge.style === "dashed") {
              const state = { isDash: true, rem: 5 };

              // Segment 1 (vertical down to start of Corner 1 curve)
              drawDashedSegment(edgeGraphics, parentX, parentY, parentX, midY - r, color, 2, 5, state);

              // Corner 1 curve (approximated)
              const steps = 10;
              let prevX = parentX;
              let prevY = midY - r;
              const cx1 = parentX;
              const cy1 = midY;
              const endX1 = parentX + sign * r;
              const endY1 = midY;
              for (let i = 1; i <= steps; i++) {
                const t = i / steps;
                const mt = 1 - t;
                const x = mt * mt * parentX + 2 * mt * t * cx1 + t * t * endX1;
                const y = mt * mt * (midY - r) + 2 * mt * t * cy1 + t * t * endY1;
                drawDashedSegment(edgeGraphics, prevX, prevY, x, y, color, 2, 5, state);
                prevX = x;
                prevY = y;
              }

              // Segment 2 (horizontal to start of Corner 2 curve)
              drawDashedSegment(edgeGraphics, parentX + sign * r, midY, childX - sign * r, midY, color, 2, 5, state);

              // Corner 2 curve (approximated)
              prevX = childX - sign * r;
              prevY = midY;
              const cx2 = childX;
              const cy2 = midY;
              const endX2 = childX;
              const endY2 = midY + r;
              for (let i = 1; i <= steps; i++) {
                const t = i / steps;
                const mt = 1 - t;
                const x = mt * mt * (childX - sign * r) + 2 * mt * t * cx2 + t * t * endX2;
                const y = mt * mt * midY + 2 * mt * t * cy2 + t * t * endY2;
                drawDashedSegment(edgeGraphics, prevX, prevY, x, y, color, 2, 5, state);
                prevX = x;
                prevY = y;
              }

              // Segment 3 (vertical down to child)
              drawDashedSegment(edgeGraphics, childX, midY + r, childX, childY, color, 2, 5, state);
            } else {
              // Solid line with quadraticCurveTo
              edgeGraphics.moveTo(parentX, parentY);
              edgeGraphics.lineTo(parentX, midY - r);
              edgeGraphics.quadraticCurveTo(parentX, midY, parentX + sign * r, midY);
              edgeGraphics.lineTo(childX - sign * r, midY);
              edgeGraphics.quadraticCurveTo(childX, midY, childX, midY + r);
              edgeGraphics.lineTo(childX, childY);
              edgeGraphics.stroke({ color, width: 2 });
            }
          }
        }
      }

      // Helper to draw a node background
      const drawNodeBg = (
        bg: Graphics,
        node: (typeof nodes)[number],
        state: "normal" | "hover",
      ) => {
        bg.clear();
        const isCircle = viewMode === "avatar-circle";
        const w = LAYOUT.NODE_WIDTH;
        const h = LAYOUT.NODE_HEIGHT;
        const isRoot = !node.isMissing && node.id === data.rootPersonId;
        const accentColor = isRoot ? COLORS.ROOT_ACCENT : COLORS.PERSON_ACCENT;

        if (node.isMissing) {
          const isUnknown = node.missingKind === "unknown";
          const baseBg = isUnknown ? COLORS.UNKNOWN_BG : COLORS.ADD_BG;
          const hoverBg = isUnknown ? 0x1e4a62 : 0x374151;
          const fillColor = state === "hover" ? hoverBg : baseBg;
          const strokeColor = state === "hover"
            ? COLORS.HOVER_SHADOW
            : isUnknown ? COLORS.UNKNOWN_ACCENT : COLORS.ADD_ACCENT;

          bg.roundRect(0, 0, w, h, LAYOUT.NODE_ROUNDING);
          bg.fill({ color: fillColor });
          bg.roundRect(0, 0, w, h, LAYOUT.NODE_ROUNDING);
          bg.stroke({ color: strokeColor, width: state === "hover" ? 2 : 1.5 });
        } else {
          const fillColor = state === "hover"
            ? isDarkMode ? 0x4b5563 : 0xf3f4f6
            : isDarkMode ? 0x374151 : COLORS.PERSON_BG;
          const strokeColor =
            state === "hover"
              ? COLORS.HOVER_SHADOW
              : isRoot
              ? COLORS.ROOT_ACCENT
              : isDarkMode ? 0x4b5563 : COLORS.PERSON_BORDER;
          const strokeWidth = state === "hover" || isRoot ? 2 : 1;

          if (isCircle) {
            const cx = w / 2;
            const cy = h / 2;
            const radius = LAYOUT.CIRCLE_DIAMETER / 2;
            bg.circle(cx, cy, radius);
            bg.fill({ color: fillColor });
            bg.circle(cx, cy, radius);
            bg.stroke({
              color: state === "hover" ? COLORS.HOVER_SHADOW : accentColor,
              width: state === "hover" ? 3 : 2,
            });
          } else {
            bg.roundRect(0, 0, w, h, LAYOUT.NODE_ROUNDING);
            bg.fill({ color: fillColor });
            bg.roundRect(0, 0, w, h, LAYOUT.NODE_ROUNDING);
            bg.stroke({ color: strokeColor, width: strokeWidth });
          }
        }
      };

      // Draw nodes
      for (const node of nodes) {
        const nodeContainer = new Container();
        nodeContainer.x = node.x - LAYOUT.NODE_WIDTH / 2;
        nodeContainer.y = node.y;

        const bg = new Graphics();
        drawNodeBg(bg, node, "normal");
        nodeContainer.addChild(bg);

        const isCircleView = viewMode === "avatar-circle" && !node.isMissing;
        const showAvatar = (viewMode === "avatar-name" || viewMode === "avatar-circle") && !node.isMissing;

        // Avatar (sprite or initials placeholder)
        let avatarContainer: Container | null = null;
        if (showAvatar && node.person) {
          avatarContainer = new Container();
          const size = isCircleView ? LAYOUT.CIRCLE_DIAMETER : LAYOUT.AVATAR_SIZE;
          const cx = isCircleView ? LAYOUT.NODE_WIDTH / 2 : 12 + size / 2;
          const cy = isCircleView ? LAYOUT.NODE_HEIGHT / 2 : LAYOUT.NODE_HEIGHT / 2;

          // Initials placeholder (always drawn first; replaced by image when loaded)
          const initials = `${(node.person.firstName || "").charAt(0)}${(node.person.lastName || "").charAt(0)}`.toUpperCase() || "?";
          const placeholder = new Graphics();
          placeholder.circle(cx, cy, size / 2);
          placeholder.fill({ color: isDarkMode ? 0x4b5563 : 0xe5e7eb });
          avatarContainer.addChild(placeholder);

          const initialsText = new Text({
            text: initials,
            style: new TextStyle({
              fontFamily: "Inter, system-ui, sans-serif",
              fontSize: isCircleView ? 24 : 18,
              fontWeight: "600",
              fill: isDarkMode ? 0xf9fafb : 0x4b5563,
              align: "center",
            }),
          });
          initialsText.anchor.set(0.5);
          initialsText.x = cx;
          initialsText.y = cy;
          avatarContainer.addChild(initialsText);

          if (node.person.avatarUrl) {
            const url = node.person.avatarUrl;
            // Load avatar asynchronously and swap in once available.
            Assets.load<Texture>(url)
              .then((texture) => {
                if (!isMountedRef.current || !appRef.current) return;
                const sprite = new Sprite(texture);
                sprite.width = size;
                sprite.height = size;
                sprite.x = cx - size / 2;
                sprite.y = cy - size / 2;

                // Circular clip via mask
                const mask = new Graphics();
                mask.circle(cx, cy, size / 2);
                mask.fill({ color: 0xffffff });
                avatarContainer!.addChild(mask);
                sprite.mask = mask;
                avatarContainer!.addChild(sprite);

                appRef.current.renderer.render(appRef.current.stage);
              })
              .catch(() => {
                // Keep initials placeholder on failure.
              });
          }

          nodeContainer.addChild(avatarContainer);
        }

        // Text labels (skip in circle-only view for non-missing nodes)
        if (!isCircleView) {
          const textX = showAvatar ? 12 + LAYOUT.AVATAR_SIZE + 8 : 12;
          const textWrapWidth = LAYOUT.NODE_WIDTH - textX - 8;

          const nameStyle = new TextStyle({
            fontFamily: "Inter, system-ui, sans-serif",
            fontSize: 14,
            fontWeight: "600",
            fill: node.isMissing ? COLORS.MISSING_TEXT : (isDarkMode ? 0xf9fafb : 0x111827),
            wordWrap: true,
            wordWrapWidth: textWrapWidth,
          });
          const nameText = new Text({ text: node.label, style: nameStyle });
          nameText.x = textX;
          nameText.y = node.sublabel ? 16 : 28;
          nodeContainer.addChild(nameText);

          if (node.sublabel) {
            const subStyle = new TextStyle({
              fontFamily: "Inter, system-ui, sans-serif",
              fontSize: 10,
              fontWeight: "400",
              fill: node.isMissing
                ? node.missingKind === "unknown"
                  ? COLORS.UNKNOWN_ACCENT
                  : 0x9ca3af
                : isDarkMode
                ? 0x9ca3af
                : 0x6b7280,
            });
            const subText = new Text({ text: node.sublabel, style: subStyle });
            subText.x = textX;
            subText.y = 44;
            nodeContainer.addChild(subText);
          }
        }

        // Make interactive
        nodeContainer.eventMode = "static";
        nodeContainer.cursor = "pointer";

        nodeContainer.on("pointerover", () => {
          drawNodeBg(bg, node, "hover");
          app.renderer.render(app.stage);
        });

        nodeContainer.on("pointerout", () => {
          drawNodeBg(bg, node, "normal");
          app.renderer.render(app.stage);
        });

        nodeContainer.on("pointerdown", (e) => {
          e.stopPropagation();
        });

        nodeContainer.on("pointertap", () => {
          if (node.isMissing && node.relatedPersonId && node.missingRole) {
            onAddMember?.(node.relatedPersonId, node.missingRole);
          } else if (node.person) {
            onPersonClick?.(node.person.id);
          }
        });

        container.addChild(nodeContainer);
        nodeGraphicsMap.set(node.id, { graphics: bg, x: node.x, y: node.y });
      }

      // Zoom/pan handlers
      const handleWheel = (e: WheelEvent) => {
        e.preventDefault();
        if (!containerRef.current) return;

        const zoomSpeed = 0.001;
        const minZoom = 0.1;
        const maxZoom = 3.0;

        const delta = -e.deltaY * zoomSpeed;
        const currentScale = container.scale.x;
        const newScale = Math.min(Math.max(currentScale * (1 + delta), minZoom), maxZoom);

        const rect = app.canvas.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;

        const worldX = (mouseX - container.x) / currentScale;
        const worldY = (mouseY - container.y) / currentScale;

        container.scale.set(newScale);
        container.x = mouseX - worldX * newScale;
        container.y = mouseY - worldY * newScale;

        app.renderer.render(app.stage);
      };

      app.canvas.addEventListener("wheel", handleWheel, { passive: false });

      // Pan handlers
      const handlePointerDown = (e: PointerEvent) => {
        isDraggingRef.current = true;
        dragStartRef.current = { x: e.clientX, y: e.clientY };
        lastPanRef.current = { x: container.x, y: container.y };
        app.canvas.style.cursor = "grabbing";
      };

      const handlePointerMove = (e: PointerEvent) => {
        if (!isDraggingRef.current || !dragStartRef.current || !lastPanRef.current) return;
        // If the primary mouse button is no longer pressed, cancel dragging
        if ((e.buttons & 1) !== 1) {
          handlePointerUp();
          return;
        }
        const dx = e.clientX - dragStartRef.current.x;
        const dy = e.clientY - dragStartRef.current.y;
        container.x = lastPanRef.current.x + dx;
        container.y = lastPanRef.current.y + dy;
        app.renderer.render(app.stage);
      };

      const handlePointerUp = () => {
        isDraggingRef.current = false;
        dragStartRef.current = null;
        lastPanRef.current = null;
        app.canvas.style.cursor = "default";
      };

      app.canvas.addEventListener("pointerdown", handlePointerDown);
      app.canvas.addEventListener("pointermove", handlePointerMove);
      app.canvas.addEventListener("pointerup", handlePointerUp);
      app.canvas.addEventListener("pointerleave", handlePointerUp);

      // Keyboard handlers - only active when canvas wrapper is focused
      const handleKeyDown = (e: KeyboardEvent) => {
        if (!canvasRef.current?.contains(document.activeElement) && document.activeElement !== canvasRef.current) return;
        const PAN_STEP = 50;
        const ZOOM_STEP = 0.1;
        switch (e.key) {
          case "ArrowLeft": container.x += PAN_STEP; break;
          case "ArrowRight": container.x -= PAN_STEP; break;
          case "ArrowUp": container.y += PAN_STEP; break;
          case "ArrowDown": container.y -= PAN_STEP; break;
          case "+":
          case "=":
            container.scale.set(Math.min(container.scale.x + ZOOM_STEP, 3.0));
            break;
          case "-":
            container.scale.set(Math.max(container.scale.x - ZOOM_STEP, 0.1));
            break;
          default: return;
        }
        e.preventDefault();
        app.renderer.render(app.stage);
      };

      window.addEventListener("keydown", handleKeyDown);

      // Initial render & fit
      app.renderer.render(app.stage);
      setTimeout(fitToScreen, 100);

      // Resize handler
      const handleResize = () => {
        if (!canvasRef.current || !app) return;
        const w = canvasRef.current.clientWidth;
        const h = canvasRef.current.clientHeight;
        app.renderer.resize(w, h);
        app.renderer.render(app.stage);
      };

      const resizeObserver = new ResizeObserver(handleResize);
      if (canvasRef.current) {
        resizeObserver.observe(canvasRef.current);
      }

      return () => {
        resizeObserver.disconnect();
        app.canvas.removeEventListener("wheel", handleWheel);
        app.canvas.removeEventListener("pointerdown", handlePointerDown);
        app.canvas.removeEventListener("pointermove", handlePointerMove);
        app.canvas.removeEventListener("pointerup", handlePointerUp);
        app.canvas.removeEventListener("pointerleave", handlePointerUp);
        window.removeEventListener("keydown", handleKeyDown);
      };
    };

    let cleanup: (() => void) | undefined;
    initCanvas().then((c) => {
      if (!isMountedRef.current) {
        c?.();
        return;
      }
      cleanup = c;
    });

    return () => {
      isMountedRef.current = false;
      cleanup?.();
      destroyApp();
    };
  }, [data, isDarkMode, onPersonClick, onAddMember, destroyApp, fitToScreen, viewMode, showAddOptions]);

  return (
    <div
      ref={canvasRef}
      className={`w-full h-full ${className ?? ""}`}
      tabIndex={0}
      style={{ outline: "none" }}
    />
  );
});

function drawDashedLine(
  g: Graphics,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  color: number,
  width: number,
  dashLength: number,
) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.sqrt(dx * dx + dy * dy);
  const dashes = Math.floor(len / (dashLength * 2));
  const ux = dx / len;
  const uy = dy / len;

  for (let i = 0; i < dashes; i++) {
    const sx = x1 + ux * i * dashLength * 2;
    const sy = y1 + uy * i * dashLength * 2;
    const ex = sx + ux * dashLength;
    const ey = sy + uy * dashLength;
    g.moveTo(sx, sy);
    g.lineTo(ex, ey);
    g.stroke({ color, width });
  }
}

interface DashState {
  isDash: boolean;
  rem: number;
}

function drawDashedSegment(
  g: Graphics,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  color: number,
  width: number,
  dashLength: number,
  state: DashState,
) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const totalLen = Math.sqrt(dx * dx + dy * dy);
  if (totalLen === 0) return;

  const ux = dx / totalLen;
  const uy = dy / totalLen;

  let currentDist = 0;
  while (currentDist < totalLen) {
    const step = Math.min(state.rem, totalLen - currentDist);
    if (state.isDash) {
      g.moveTo(x1 + ux * currentDist, y1 + uy * currentDist);
      g.lineTo(x1 + ux * (currentDist + step), y1 + uy * (currentDist + step));
      g.stroke({ color, width });
    }
    currentDist += step;
    state.rem -= step;
    if (state.rem <= 0) {
      state.isDash = !state.isDash;
      state.rem = dashLength;
    }
  }
}
