import { useEffect, useRef, useCallback, useState } from "react";
import { Application, Container, Graphics, Text, TextStyle } from "pixi.js";
import { useLocation } from "wouter";

// Layout constants
const LAYOUT = {
  NODE_WIDTH: 160,
  NODE_HEIGHT: 80,
  HORIZONTAL_GAP: 40,
  VERTICAL_GAP: 100,
  SPOUSE_GAP: 20,
  COUPLE_LINE_DROP: 40,
};

// Colors
const COLORS = {
  PERSON_BG: 0xffffff,
  PERSON_BORDER: 0xe5e7eb,
  PERSON_ACCENT: 0xef4444,
  ROOT_ACCENT: 0x3b82f6,
  MISSING_BG: 0x1f2937,
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
}

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

// Build tree structure from flat API data
function buildRenderTree(data: FamilyTreeData): { nodes: RenderNode[]; edges: RenderEdge[] } {
  const { rootPersonId, people, relationships, missingLinks } = data;
  const personMap = new Map(people.map((p) => [p.id, p]));

  // Build adjacency - who is parent/child/spouse of whom
  const spouses = new Map<string, Set<string>>();
  const parents = new Map<string, Set<string>>(); // child -> parents
  const children = new Map<string, Set<string>>(); // parent -> children
  const relTypeMap = new Map<string, string>(); // `from:to` -> type

  for (const rel of relationships) {
    const cat = getRelationshipCategory(rel.familyRelationshipType);
    const key = `${rel.fromPersonId}:${rel.toPersonId}`;
    relTypeMap.set(key, rel.familyRelationshipType);

    if (cat === "spouse") {
      if (!spouses.has(rel.fromPersonId)) spouses.set(rel.fromPersonId, new Set());
      if (!spouses.has(rel.toPersonId)) spouses.set(rel.toPersonId, new Set());
      spouses.get(rel.fromPersonId)!.add(rel.toPersonId);
      spouses.get(rel.toPersonId)!.add(rel.fromPersonId);
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
    }
  }

  // Assign generations using BFS from root
  const generations = new Map<string, number>();
  generations.set(rootPersonId, 0);
  const queue = [rootPersonId];
  const visited = new Set<string>([rootPersonId]);

  while (queue.length > 0) {
    const current = queue.shift()!;
    const gen = generations.get(current)!;

    // Parents are generation - 1
    const parentSet = parents.get(current) ?? new Set();
    for (const parentId of parentSet) {
      if (!visited.has(parentId)) {
        visited.add(parentId);
        generations.set(parentId, gen - 1);
        queue.push(parentId);
      }
    }

    // Children are generation + 1
    const childSet = children.get(current) ?? new Set();
    for (const childId of childSet) {
      if (!visited.has(childId)) {
        visited.add(childId);
        generations.set(childId, gen + 1);
        queue.push(childId);
      }
    }

    // Spouses are same generation
    const spouseSet = spouses.get(current) ?? new Set();
    for (const spouseId of spouseSet) {
      if (!visited.has(spouseId)) {
        visited.add(spouseId);
        generations.set(spouseId, gen);
        queue.push(spouseId);
      }
    }
  }

  // Handle people not reached by BFS
  for (const p of people) {
    if (!generations.has(p.id)) {
      generations.set(p.id, p.depth);
    }
  }

  // Group people by generation
  const genGroups = new Map<number, string[]>();
  for (const [personId, gen] of generations) {
    if (!genGroups.has(gen)) genGroups.set(gen, []);
    genGroups.get(gen)!.push(personId);
  }

  // Sort generations
  const sortedGens = Array.from(genGroups.keys()).sort((a, b) => a - b);

  // Identify couples
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
        units.push({
          ids: [a, b],
          width: LAYOUT.NODE_WIDTH * 2 + LAYOUT.SPOUSE_GAP,
        });
      } else {
        units.push({ ids: [pid], width: LAYOUT.NODE_WIDTH });
      }
    }

    const totalWidth = units.reduce((sum, u) => sum + u.width, 0) + (units.length - 1) * LAYOUT.HORIZONTAL_GAP;
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

  // Create render nodes
  for (const person of people) {
    const pos = nodePositions.get(person.id) ?? { x: 0, y: 0 };
    const relToRoot = relationships.find(
      (r) => (r.fromPersonId === person.id && r.toPersonId === rootPersonId) ||
             (r.toPersonId === person.id && r.fromPersonId === rootPersonId)
    );
    let roleLabel = "";
    if (relToRoot) {
      if (relToRoot.fromPersonId === person.id) {
        roleLabel = formatRelationshipLabel(relToRoot.familyRelationshipType);
      } else {
        roleLabel = formatRelationshipLabel(relToRoot.familyRelationshipType);
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

  // Create missing link placeholder nodes
  for (const link of missingLinks) {
    const relatedPos = nodePositions.get(link.relatedPersonId);
    if (!relatedPos) continue;

    const missingId = `missing-${link.personId}-${link.missingRole}`;
    const relatedGen = generations.get(link.relatedPersonId) ?? 0;
    let yOffset = 0;
    if (["father", "mother", "parent"].includes(link.missingRole)) {
      yOffset = -(LAYOUT.NODE_HEIGHT + LAYOUT.VERTICAL_GAP);
    } else if (link.missingRole === "spouse") {
      yOffset = 0;
    }

    const xOffset = link.missingRole === "spouse"
      ? LAYOUT.NODE_WIDTH + LAYOUT.SPOUSE_GAP
      : (link.missingRole === "mother" ? LAYOUT.NODE_WIDTH + LAYOUT.SPOUSE_GAP : -(LAYOUT.NODE_WIDTH + LAYOUT.SPOUSE_GAP));

    nodes.push({
      id: missingId,
      x: relatedPos.x + xOffset,
      y: relatedPos.y + yOffset,
      isMissing: true,
      missingRole: link.missingRole,
      relatedPersonId: link.relatedPersonId,
      label: `Unknown ${formatRelationshipLabel(link.missingRole)}`,
      sublabel: "+ Add Person",
    });
  }

  // Create render edges
  const edges: RenderEdge[] = [];
  const edgeSet = new Set<string>();

  for (const rel of relationships) {
    const cat = getRelationshipCategory(rel.familyRelationshipType);
    const edgeKey = [rel.fromPersonId, rel.toPersonId].sort().join(":");

    if (edgeSet.has(edgeKey)) continue;
    edgeSet.add(edgeKey);

    if (cat === "spouse") {
      edges.push({
        from: rel.fromPersonId,
        to: rel.toPersonId,
        type: "spouse",
        style: rel.familyRelationshipType === "ex_spouse" ? "dashed" : "solid",
      });
    } else if (cat === "parent") {
      edges.push({
        from: rel.fromPersonId,
        to: rel.toPersonId,
        type: "parent-child",
        style: "solid",
      });
    } else if (cat === "child") {
      edges.push({
        from: rel.toPersonId,
        to: rel.fromPersonId,
        type: "parent-child",
        style: "solid",
      });
    }
  }

  return { nodes, edges };
}

export function FamilyTreeCanvas({ data, onPersonClick, onAddMember, className }: FamilyTreeCanvasProps) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const appRef = useRef<Application | null>(null);
  const containerRef = useRef<Container | null>(null);
  const isMountedRef = useRef(true);
  const isDraggingRef = useRef(false);
  const dragStartRef = useRef<{ x: number; y: number } | null>(null);
  const lastPanRef = useRef<{ x: number; y: number } | null>(null);
  const [, navigate] = useLocation();

  const isDarkMode = document.documentElement.classList.contains("dark");

  const destroyApp = useCallback(() => {
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

  // Expose fitToScreen via ref-like mechanism
  useEffect(() => {
    (window as any).__familyTreeFitToScreen = fitToScreen;
    return () => { delete (window as any).__familyTreeFitToScreen; };
  }, [fitToScreen]);

  useEffect(() => {
    isMountedRef.current = true;

    if (!canvasRef.current || !data) return;

    const initCanvas = async () => {
      destroyApp();

      if (!canvasRef.current || !isMountedRef.current) return;

      const app = new Application();
      await app.init({
        width: canvasRef.current.clientWidth || 800,
        height: canvasRef.current.clientHeight || 600,
        backgroundColor: isDarkMode ? COLORS.CANVAS_BG_DARK : COLORS.CANVAS_BG,
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

      // Build tree
      const { nodes, edges } = buildRenderTree(data);

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
            drawDashedLine(edgeGraphics, x1, y, x2, y, color, 2, 8);
          } else {
            edgeGraphics.moveTo(x1, y);
            edgeGraphics.lineTo(x2, y);
            edgeGraphics.stroke({ color, width: 2 });
          }
        } else {
          // Parent to child line
          const parentY = fromNode.y + LAYOUT.NODE_HEIGHT;
          const childY = toNode.y;
          const parentX = fromNode.x;
          const childX = toNode.x;
          const midY = parentY + (childY - parentY) / 2;

          edgeGraphics.moveTo(parentX, parentY);
          edgeGraphics.lineTo(parentX, midY);
          edgeGraphics.lineTo(childX, midY);
          edgeGraphics.lineTo(childX, childY);
          edgeGraphics.stroke({ color, width: 2 });
        }
      }

      // Draw nodes
      for (const node of nodes) {
        const nodeContainer = new Container();
        nodeContainer.x = node.x - LAYOUT.NODE_WIDTH / 2;
        nodeContainer.y = node.y;

        const bg = new Graphics();

        if (node.isMissing) {
          // Missing person - dark background with dashed border
          bg.roundRect(0, 0, LAYOUT.NODE_WIDTH, LAYOUT.NODE_HEIGHT, 8);
          bg.fill({ color: COLORS.MISSING_BG });
          bg.roundRect(0, 0, LAYOUT.NODE_WIDTH, LAYOUT.NODE_HEIGHT, 8);
          bg.stroke({ color: COLORS.LINE_DASHED, width: 2 });
        } else {
          // Regular person box
          const isRoot = node.id === data.rootPersonId;
          const accentColor = isRoot ? COLORS.ROOT_ACCENT : COLORS.PERSON_ACCENT;

          bg.roundRect(0, 0, LAYOUT.NODE_WIDTH, LAYOUT.NODE_HEIGHT, 8);
          bg.fill({ color: isDarkMode ? 0x374151 : COLORS.PERSON_BG });
          bg.roundRect(0, 0, LAYOUT.NODE_WIDTH, LAYOUT.NODE_HEIGHT, 8);
          bg.stroke({ color: isDarkMode ? 0x4b5563 : COLORS.PERSON_BORDER, width: 1 });

          // Left accent bar
          bg.roundRect(0, 0, 4, LAYOUT.NODE_HEIGHT, 4);
          bg.fill({ color: accentColor });
        }

        nodeContainer.addChild(bg);

        // Name text
        const nameStyle = new TextStyle({
          fontFamily: "Inter, system-ui, sans-serif",
          fontSize: 13,
          fontWeight: "600",
          fill: node.isMissing ? COLORS.MISSING_TEXT : (isDarkMode ? 0xf9fafb : 0x111827),
          wordWrap: true,
          wordWrapWidth: LAYOUT.NODE_WIDTH - 20,
        });
        const nameText = new Text({ text: node.label, style: nameStyle });
        nameText.x = 12;
        nameText.y = node.sublabel ? 16 : 28;
        nodeContainer.addChild(nameText);

        // Sublabel text
        if (node.sublabel) {
          const subStyle = new TextStyle({
            fontFamily: "Inter, system-ui, sans-serif",
            fontSize: 11,
            fontWeight: node.isMissing ? "500" : "400",
            fill: node.isMissing ? 0x93c5fd : (isDarkMode ? 0x9ca3af : 0x6b7280),
          });
          const subText = new Text({ text: node.sublabel, style: subStyle });
          subText.x = 12;
          subText.y = 44;
          nodeContainer.addChild(subText);
        }

        // Make interactive
        nodeContainer.eventMode = "static";
        nodeContainer.cursor = "pointer";

        nodeContainer.on("pointerover", () => {
          bg.clear();
          if (node.isMissing) {
            bg.roundRect(0, 0, LAYOUT.NODE_WIDTH, LAYOUT.NODE_HEIGHT, 8);
            bg.fill({ color: 0x374151 });
            bg.roundRect(0, 0, LAYOUT.NODE_WIDTH, LAYOUT.NODE_HEIGHT, 8);
            bg.stroke({ color: COLORS.HOVER_SHADOW, width: 2 });
          } else {
            const isRoot = node.id === data.rootPersonId;
            const accentColor = isRoot ? COLORS.ROOT_ACCENT : COLORS.PERSON_ACCENT;
            bg.roundRect(0, 0, LAYOUT.NODE_WIDTH, LAYOUT.NODE_HEIGHT, 8);
            bg.fill({ color: isDarkMode ? 0x4b5563 : 0xf3f4f6 });
            bg.roundRect(0, 0, LAYOUT.NODE_WIDTH, LAYOUT.NODE_HEIGHT, 8);
            bg.stroke({ color: COLORS.HOVER_SHADOW, width: 2 });
            bg.roundRect(0, 0, 4, LAYOUT.NODE_HEIGHT, 4);
            bg.fill({ color: accentColor });
          }
          app.renderer.render(app.stage);
        });

        nodeContainer.on("pointerout", () => {
          bg.clear();
          if (node.isMissing) {
            bg.roundRect(0, 0, LAYOUT.NODE_WIDTH, LAYOUT.NODE_HEIGHT, 8);
            bg.fill({ color: COLORS.MISSING_BG });
            bg.roundRect(0, 0, LAYOUT.NODE_WIDTH, LAYOUT.NODE_HEIGHT, 8);
            bg.stroke({ color: COLORS.LINE_DASHED, width: 2 });
          } else {
            const isRoot = node.id === data.rootPersonId;
            const accentColor = isRoot ? COLORS.ROOT_ACCENT : COLORS.PERSON_ACCENT;
            bg.roundRect(0, 0, LAYOUT.NODE_WIDTH, LAYOUT.NODE_HEIGHT, 8);
            bg.fill({ color: isDarkMode ? 0x374151 : COLORS.PERSON_BG });
            bg.roundRect(0, 0, LAYOUT.NODE_WIDTH, LAYOUT.NODE_HEIGHT, 8);
            bg.stroke({ color: isDarkMode ? 0x4b5563 : COLORS.PERSON_BORDER, width: 1 });
            bg.roundRect(0, 0, 4, LAYOUT.NODE_HEIGHT, 4);
            bg.fill({ color: accentColor });
          }
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

      // Keyboard handlers
      const handleKeyDown = (e: KeyboardEvent) => {
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
    initCanvas().then((c) => { cleanup = c; });

    return () => {
      isMountedRef.current = false;
      cleanup?.();
      destroyApp();
    };
  }, [data, isDarkMode, onPersonClick, onAddMember, destroyApp, fitToScreen]);

  return (
    <div
      ref={canvasRef}
      className={`w-full h-full ${className ?? ""}`}
      tabIndex={0}
      style={{ outline: "none" }}
    />
  );
}

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

export { fitToScreen as fitToScreenFn };

function fitToScreen() {
  (window as any).__familyTreeFitToScreen?.();
}
