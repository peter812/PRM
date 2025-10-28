import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Application, Graphics, Container, Text, TextStyle } from "pixi.js";
import { Button } from "@/components/ui/button";
import { Plus, Settings } from "lucide-react";
import { useLocation } from "wouter";
import { AddConnectionDialog } from "@/components/add-connection-dialog";
import { OptionsPanel } from "@/components/options-panel";

interface GraphData {
  people: Array<{ id: string; firstName: string; lastName: string; company: string | null }>;
  relationships: Array<{ id: string; fromPersonId: string; toPersonId: string; typeColor: string | null }>;
  groups: Array<{ id: string; name: string; color: string; members: string[] }>;
}

interface GraphPerson {
  id: string;
  firstName: string;
  lastName: string;
  company: string | null;
}

interface GraphGroup {
  id: string;
  name: string;
  color: string;
  members: string[];
}

interface Node {
  id: string;
  type: 'person' | 'group';
  person?: GraphPerson;
  group?: GraphGroup;
  x: number;
  y: number;
  vx: number;
  vy: number;
  graphics: Graphics;
  text: Text;
}

interface Edge {
  from: string;
  to: string;
  type: 'relationship' | 'group-member';
  color: number;
  graphics: Graphics;
}

// Helper to convert HSL from CSS variable to hex color
function hslToHex(h: number, s: number, l: number): number {
  l /= 100;
  const a = (s * Math.min(l, 1 - l)) / 100;
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * color);
  };
  return (f(0) << 16) + (f(8) << 8) + f(4);
}

// Parse HSL string from CSS variable
function parseHSL(hslString: string): { h: number; s: number; l: number } {
  const values = hslString.split(' ').map(v => parseFloat(v));
  return { h: values[0], s: values[1], l: values[2] };
}

// Convert hex color string to number
function hexToNumber(hex: string): number {
  return parseInt(hex.replace('#', ''), 16);
}

export default function Graph() {
  const canvasRef = useRef<HTMLDivElement>(null);
  const appRef = useRef<Application | null>(null);
  const nodesRef = useRef<Map<string, Node>>(new Map());
  const edgesRef = useRef<Edge[]>([]);
  const containerRef = useRef<Container | null>(null);
  const animationRef = useRef<number>(0);
  const isDraggingRef = useRef<string | null>(null);
  const dragStartRef = useRef<{ x: number; y: number } | null>(null);
  const wheelHandlerRef = useRef<((e: WheelEvent) => void) | null>(null);
  const [, navigate] = useLocation();
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [showGroups, setShowGroups] = useState(true);
  const [disablePersonLines, setDisablePersonLines] = useState(false);
  const [highlightedPersonId, setHighlightedPersonId] = useState<string | null>(null);
  const [isOptionsPanelOpen, setIsOptionsPanelOpen] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [personLineOpacity, setPersonLineOpacity] = useState(0.7);
  const [groupLineOpacity, setGroupLineOpacity] = useState(0.7);
  const [personPull, setPersonPull] = useState(0.01);
  const [groupPull, setGroupPull] = useState(0.003);
  const [hideOrphans, setHideOrphans] = useState(false);
  const [anonymizePeople, setAnonymizePeople] = useState(false);

  const { data: graphData } = useQuery<GraphData>({
    queryKey: ["/api/graph"],
  });

  const { data: meData } = useQuery<{ id: string }>({
    queryKey: ["/api/me"],
    select: (data) => ({ id: data.id }),
  });

  const allPeople = graphData?.people || [];
  const groups = graphData?.groups || [];
  const relationships = graphData?.relationships || [];

  // Set ME person as default highlight when data loads
  useEffect(() => {
    if (meData?.id && highlightedPersonId === null) {
      setHighlightedPersonId(meData.id);
    }
  }, [meData?.id]);

  // Filter out orphans if hideOrphans is enabled
  const people = hideOrphans 
    ? allPeople.filter(person => {
        // Check if person has any relationships
        const hasRelationship = relationships.some(
          rel => rel.fromPersonId === person.id || rel.toPersonId === person.id
        );
        // Check if person is a member of any group
        const isInGroup = groups.some(group => group.members.includes(person.id));
        return hasRelationship || isInGroup;
      })
    : allPeople;

  useEffect(() => {
    if (!canvasRef.current || !people.length) return;

    const initPixi = async () => {
      try {
        // Clean up existing app
        if (appRef.current) {
          appRef.current.destroy(true, { children: true, texture: true });
          appRef.current = null;
        }

        // Clean up any existing canvas elements
        if (canvasRef.current) {
          while (canvasRef.current.firstChild) {
            canvasRef.current.removeChild(canvasRef.current.firstChild);
          }
        }

        // Get theme colors from CSS variables
        const styles = getComputedStyle(document.documentElement);
        const backgroundHSL = styles.getPropertyValue('--background').trim();
        const foregroundHSL = styles.getPropertyValue('--foreground').trim();
        
        const bgColor = parseHSL(backgroundHSL);
        const fgColor = parseHSL(foregroundHSL);
        
        const backgroundColor = hslToHex(bgColor.h, bgColor.s, bgColor.l);
        const foregroundColor = hslToHex(fgColor.h, fgColor.s, fgColor.l);
        const defaultRelationshipColor = 0x6b7280; // Gray for relationships without a type

        // Create PIXI application
        const app = new Application();
        await app.init({
          width: canvasRef.current?.clientWidth || 800,
          height: canvasRef.current?.clientHeight || 600,
          backgroundColor: backgroundColor,
          antialias: true,
          resolution: window.devicePixelRatio || 1,
          autoDensity: true,
          preference: 'webgl',
        });

        if (canvasRef.current) {
          canvasRef.current.appendChild(app.canvas);
        }
        appRef.current = app;

        // Create main container for zooming/panning
        const container = new Container();
        app.stage.addChild(container);
        containerRef.current = container;

        // Center point
        const centerX = app.screen.width / 2;
        const centerY = app.screen.height / 2;

        // Initialize nodes
        const nodes = new Map<string, Node>();
        const radius = Math.min(app.screen.width, app.screen.height) / 3;

        // Add person nodes
        people.forEach((person, i) => {
          const angle = (i / people.length) * Math.PI * 2;
          const x = centerX + Math.cos(angle) * radius;
          const y = centerY + Math.sin(angle) * radius;

          const graphics = new Graphics();
          graphics.circle(0, 0, 20);
          graphics.fill({ color: 0x6366f1 });
          graphics.stroke({ color: 0x818cf8, width: 2 });
          graphics.x = x;
          graphics.y = y;
          graphics.eventMode = 'static';
          graphics.cursor = 'grab';

          const textStyle = new TextStyle({
            fontFamily: 'Inter, sans-serif',
            fontSize: 12,
            fill: foregroundColor,
          });

          const text = new Text({
            text: `${person.firstName} ${person.lastName}`,
            style: textStyle,
          });
          text.anchor.set(0.5, -1.5);
          text.x = x;
          text.y = y;
          
          // Hide text if anonymize is enabled and this is not the Me node
          if (anonymizePeople && person.id !== meData?.id) {
            text.visible = false;
          }

          // Interaction handlers
          graphics.on('pointerdown', (e) => {
            isDraggingRef.current = person.id;
            dragStartRef.current = { x: e.global.x, y: e.global.y };
            graphics.cursor = 'grabbing';
            e.stopPropagation();
          });

          graphics.on('pointerup', (e) => {
            if (isDraggingRef.current === person.id && dragStartRef.current) {
              // Only navigate if drag distance is small (click vs drag)
              const dx = e.global.x - dragStartRef.current.x;
              const dy = e.global.y - dragStartRef.current.y;
              const distance = Math.sqrt(dx * dx + dy * dy);
              
              if (distance < 5) {
                navigate(`/person/${person.id}?from=graph`);
              }
            }
            isDraggingRef.current = null;
            dragStartRef.current = null;
            graphics.cursor = 'grab';
          });

          graphics.on('pointerover', () => {
            graphics.clear();
            graphics.circle(0, 0, 24);
            graphics.fill({ color: 0x818cf8 });
            graphics.stroke({ color: 0xa5b4fc, width: 3 });
          });

          graphics.on('pointerout', () => {
            graphics.clear();
            graphics.circle(0, 0, 20);
            graphics.fill({ color: 0x6366f1 });
            graphics.stroke({ color: 0x818cf8, width: 2 });
          });

          container.addChild(graphics);
          container.addChild(text);

          nodes.set(person.id, {
            id: person.id,
            type: 'person',
            person,
            x,
            y,
            vx: 0,
            vy: 0,
            graphics,
            text,
          });
        });

        // Add group nodes (if showGroups is true)
        if (showGroups && groups.length > 0) {
          const groupRadius = radius * 1.5;
          groups.forEach((group, i) => {
            const angle = (i / groups.length) * Math.PI * 2;
            const x = centerX + Math.cos(angle) * groupRadius;
            const y = centerY + Math.sin(angle) * groupRadius;

            const graphics = new Graphics();
            graphics.roundRect(-30, -20, 60, 40, 8);
            const groupColor = group.color ? hexToNumber(group.color) : 0x8b5cf6;
            graphics.fill({ color: groupColor, alpha: 0.3 });
            graphics.stroke({ color: groupColor, width: 2 });
            graphics.x = x;
            graphics.y = y;
            graphics.eventMode = 'static';
            graphics.cursor = 'grab';

            const textStyle = new TextStyle({
              fontFamily: 'Inter, sans-serif',
              fontSize: 11,
              fill: foregroundColor,
              fontWeight: '600',
            });

            const text = new Text({
              text: group.name,
              style: textStyle,
            });
            text.anchor.set(0.5, 0.5);
            text.x = x;
            text.y = y;

            // Interaction handlers for groups (with drag support)
            graphics.on('pointerdown', (e) => {
              isDraggingRef.current = `group-${group.id}`;
              dragStartRef.current = { x: e.global.x, y: e.global.y };
              graphics.cursor = 'grabbing';
              e.stopPropagation();
            });

            graphics.on('pointerup', (e) => {
              if (isDraggingRef.current === `group-${group.id}` && dragStartRef.current) {
                // Only navigate if drag distance is small (click vs drag)
                const dx = e.global.x - dragStartRef.current.x;
                const dy = e.global.y - dragStartRef.current.y;
                const distance = Math.sqrt(dx * dx + dy * dy);
                
                if (distance < 5) {
                  navigate(`/group/${group.id}`);
                }
              }
              isDraggingRef.current = null;
              dragStartRef.current = null;
              graphics.cursor = 'grab';
            });

            graphics.on('pointerover', () => {
              graphics.clear();
              graphics.roundRect(-32, -22, 64, 44, 8);
              graphics.fill({ color: groupColor, alpha: 0.5 });
              graphics.stroke({ color: groupColor, width: 3 });
            });

            graphics.on('pointerout', () => {
              graphics.clear();
              graphics.roundRect(-30, -20, 60, 40, 8);
              graphics.fill({ color: groupColor, alpha: 0.3 });
              graphics.stroke({ color: groupColor, width: 2 });
            });

            container.addChild(graphics);
            container.addChild(text);

            nodes.set(`group-${group.id}`, {
              id: `group-${group.id}`,
              type: 'group',
              group,
              x,
              y,
              vx: 0,
              vy: 0,
              graphics,
              text,
            });
          });
        }

        nodesRef.current = nodes;

        // Create edges
        const edges: Edge[] = [];

        // Person-to-person relationship edges (only if not disabled)
        if (!disablePersonLines) {
          relationships.forEach((rel) => {
            const fromNode = nodes.get(rel.fromPersonId);
            const toNode = nodes.get(rel.toPersonId);

            if (fromNode && toNode) {
              const graphics = new Graphics();
              
              // Use relationship type color if available, otherwise default to gray
              const edgeColor = rel.typeColor ? hexToNumber(rel.typeColor) : defaultRelationshipColor;
              
              graphics.moveTo(fromNode.x, fromNode.y);
              graphics.lineTo(toNode.x, toNode.y);
              graphics.stroke({ color: edgeColor, width: 2, alpha: personLineOpacity });

              container.addChildAt(graphics, 0); // Add edges behind nodes
              edges.push({
                from: rel.fromPersonId,
                to: rel.toPersonId,
                type: 'relationship',
                color: edgeColor,
                graphics,
              });
            }
          });
        }

        // Group-to-person edges
        if (showGroups && groups.length > 0) {
          groups.forEach((group) => {
            if (group.members && group.members.length > 0) {
              group.members.forEach((memberId) => {
                const groupNode = nodes.get(`group-${group.id}`);
                const personNode = nodes.get(memberId);

                if (groupNode && personNode) {
                  const graphics = new Graphics();
                  
                  graphics.moveTo(groupNode.x, groupNode.y);
                  graphics.lineTo(personNode.x, personNode.y);
                  const groupColor = group.color ? hexToNumber(group.color) : 0x8b5cf6;
                  graphics.stroke({ color: groupColor, width: 1, alpha: groupLineOpacity });

                  container.addChildAt(graphics, 0); // Add edges behind nodes
                  edges.push({
                    from: `group-${group.id}`,
                    to: memberId,
                    type: 'group-member',
                    color: groupColor,
                    graphics,
                  });
                }
              });
            }
          });
        }

        edgesRef.current = edges;

        // Apply highlight filter if active
        if (highlightedPersonId) {
          const highlightedNode = nodes.get(highlightedPersonId);
          if (highlightedNode && highlightedNode.person) {
            // Get connected person IDs
            const connectedPersonIds = new Set<string>();
            connectedPersonIds.add(highlightedPersonId);
            
            // Add people with direct relationships (both directions) - only if person lines are not disabled
            if (!disablePersonLines) {
              relationships.forEach((rel) => {
                if (rel.fromPersonId === highlightedPersonId) {
                  connectedPersonIds.add(rel.toPersonId);
                } else if (rel.toPersonId === highlightedPersonId) {
                  connectedPersonIds.add(rel.fromPersonId);
                }
              });
            }
            
            // Get groups the highlighted person is a member of
            const userGroupIds = new Set<string>();
            groups.forEach((group) => {
              if (group.members && group.members.includes(highlightedPersonId)) {
                userGroupIds.add(`group-${group.id}`);
              }
            });
            
            // Hide nodes that aren't connected or in the same groups
            nodes.forEach((node, nodeId) => {
              if (node.type === 'person') {
                if (!connectedPersonIds.has(nodeId)) {
                  node.graphics.visible = false;
                  node.text.visible = false;
                }
              } else if (node.type === 'group') {
                if (!userGroupIds.has(nodeId)) {
                  node.graphics.visible = false;
                  node.text.visible = false;
                }
              }
            });
            
            // Hide edges that don't connect to highlighted nodes
            edges.forEach((edge) => {
              const shouldShow = 
                (edge.type === 'relationship' && connectedPersonIds.has(edge.from) && connectedPersonIds.has(edge.to)) ||
                (edge.type === 'group-member' && userGroupIds.has(edge.from) && connectedPersonIds.has(edge.to));
              edge.graphics.visible = shouldShow;
            });
            
            // Center camera on highlighted node
            if (containerRef.current) {
              containerRef.current.x = app.screen.width / 2 - highlightedNode.x;
              containerRef.current.y = app.screen.height / 2 - highlightedNode.y;
            }
          }
        }

        // Physics simulation
        const simulate = () => {
          // Guard: Stop simulation if app or container has been destroyed
          if (!appRef.current || !containerRef.current || nodesRef.current.size === 0) {
            // Cancel animation frame to stop the loop
            if (animationRef.current) {
              cancelAnimationFrame(animationRef.current);
              animationRef.current = 0;
            }
            return;
          }
          
          const nodes = Array.from(nodesRef.current.values());
          const damping = 0.9;
          const repulsion = 3000;
          const personAttraction = personPull;
          const groupAttraction = groupPull;
          const centerForce = 0.001;

          // Apply forces
          nodes.forEach((node) => {
            if (!node.graphics || !node.text) return; // Skip if graphics destroyed
            if (node.graphics.destroyed || node.text.destroyed) return; // Skip if destroyed by Pixi
            if (!node.graphics.visible) return; // Skip hidden nodes
            
            let fx = 0;
            let fy = 0;

            // Repulsion between nodes
            nodes.forEach((other) => {
              if (!other.graphics) return; // Skip if graphics destroyed
              if (other.graphics.destroyed) return; // Skip if destroyed by Pixi
              if (node.id !== other.id && other.graphics.visible) {
                const dx = node.x - other.x;
                const dy = node.y - other.y;
                const distSq = dx * dx + dy * dy + 1;
                const force = repulsion / distSq;
                fx += (dx / Math.sqrt(distSq)) * force;
                fy += (dy / Math.sqrt(distSq)) * force;
              }
            });

            // Attraction along edges
            edgesRef.current.forEach((edge) => {
              if (!edge.graphics || edge.graphics.destroyed || !edge.graphics.visible) return; // Skip hidden/destroyed edges
              
              let other: Node | undefined;
              let attraction = personAttraction;
              
              if (edge.from === node.id) {
                other = nodesRef.current.get(edge.to);
                if (edge.type === 'group-member') attraction = groupAttraction;
              } else if (edge.to === node.id) {
                other = nodesRef.current.get(edge.from);
                if (edge.type === 'group-member') attraction = groupAttraction;
              }

              if (other && other.graphics && other.graphics.visible) {
                const dx = other.x - node.x;
                const dy = other.y - node.y;
                fx += dx * attraction;
                fy += dy * attraction;
              }
            });

            // Center attraction
            const dx = centerX - node.x;
            const dy = centerY - node.y;
            fx += dx * centerForce;
            fy += dy * centerForce;

            node.vx = (node.vx + fx) * damping;
            node.vy = (node.vy + fy) * damping;
          });

          // Update positions (skip if dragging)
          nodes.forEach((node) => {
            if (!node.graphics || !node.text) return; // Skip if graphics destroyed
            if (node.graphics.destroyed || node.text.destroyed) return; // Skip if destroyed by Pixi
            if (!node.graphics.visible) return; // Skip hidden nodes
            
            if (isDraggingRef.current !== node.id) {
              node.x += node.vx;
              node.y += node.vy;
              node.graphics.x = node.x;
              node.graphics.y = node.y;
              node.text.x = node.x;
              node.text.y = node.y;
            }
          });

          // Update edge positions
          edgesRef.current.forEach((edge) => {
            if (!edge.graphics) return; // Skip if graphics destroyed
            if (edge.graphics.destroyed) return; // Skip if destroyed by Pixi
            if (!edge.graphics.visible) return; // Skip hidden edges
            
            const fromNode = nodesRef.current.get(edge.from);
            const toNode = nodesRef.current.get(edge.to);
            if (fromNode && toNode && fromNode.graphics && toNode.graphics && 
                !fromNode.graphics.destroyed && !toNode.graphics.destroyed &&
                fromNode.graphics.visible && toNode.graphics.visible) {
              try {
                edge.graphics.clear();
                edge.graphics.moveTo(fromNode.x, fromNode.y);
                edge.graphics.lineTo(toNode.x, toNode.y);
                
                if (edge.type === 'relationship') {
                  edge.graphics.stroke({ color: edge.color, width: 2, alpha: personLineOpacity });
                } else if (edge.type === 'group-member') {
                  edge.graphics.stroke({ color: edge.color, width: 1, alpha: groupLineOpacity });
                }
              } catch (e) {
                // Graphics may have been destroyed during operation, skip silently
              }
            }
          });

          animationRef.current = requestAnimationFrame(simulate);
        };

        simulate();

        // Handle dragging - node follows mouse in real-time
        app.stage.eventMode = 'static';
        app.stage.on('pointermove', (e) => {
          if (isDraggingRef.current) {
            const node = nodesRef.current.get(isDraggingRef.current);
            if (node && containerRef.current && node.graphics && node.text && 
                !node.graphics.destroyed && !node.text.destroyed) {
              // Convert screen coordinates to world coordinates accounting for zoom
              const currentScale = containerRef.current.scale.x;
              const worldX = (e.global.x - containerRef.current.x) / currentScale;
              const worldY = (e.global.y - containerRef.current.y) / currentScale;
              
              node.x = worldX;
              node.y = worldY;
              node.vx = 0;
              node.vy = 0;
              node.graphics.x = node.x;
              node.graphics.y = node.y;
              node.text.x = node.x;
              node.text.y = node.y;
            }
          }
        });

        app.stage.on('pointerup', () => {
          if (isDraggingRef.current) {
            const node = nodesRef.current.get(isDraggingRef.current);
            if (node && node.graphics && !node.graphics.destroyed) {
              node.graphics.cursor = 'grab';
            }
          }
          isDraggingRef.current = null;
          dragStartRef.current = null;
        });

        app.stage.on('pointerupoutside', () => {
          if (isDraggingRef.current) {
            const node = nodesRef.current.get(isDraggingRef.current);
            if (node && node.graphics && !node.graphics.destroyed) {
              node.graphics.cursor = 'grab';
            }
          }
          isDraggingRef.current = null;
          dragStartRef.current = null;
        });

        // Scroll wheel zoom
        const handleWheel = (e: WheelEvent) => {
          e.preventDefault();
          
          if (!containerRef.current) return;
          
          const zoomSpeed = 0.001;
          const minZoom = 0.1;
          const maxZoom = 5;
          
          // Calculate zoom delta
          const delta = -e.deltaY * zoomSpeed;
          const currentScale = containerRef.current.scale.x;
          const newScale = Math.min(Math.max(currentScale * (1 + delta), minZoom), maxZoom);
          
          // Get mouse position relative to canvas
          const rect = app.canvas.getBoundingClientRect();
          const mouseX = e.clientX - rect.left;
          const mouseY = e.clientY - rect.top;
          
          // Calculate world position before zoom
          const worldX = (mouseX - containerRef.current.x) / currentScale;
          const worldY = (mouseY - containerRef.current.y) / currentScale;
          
          // Apply new scale
          containerRef.current.scale.set(newScale);
          
          // Adjust position to zoom towards mouse
          containerRef.current.x = mouseX - worldX * newScale;
          containerRef.current.y = mouseY - worldY * newScale;
        };
        
        wheelHandlerRef.current = handleWheel;
        app.canvas.addEventListener('wheel', handleWheel, { passive: false });
      } catch (error) {
        console.error('Failed to initialize Pixi.js:', error);
        // Fallback: show error message instead of crashing
        if (canvasRef.current) {
          canvasRef.current.innerHTML = `
            <div style="display: flex; flex-direction: column; align-items: center; justify-center; height: 100%; text-align: center; padding: 2rem;">
              <h3 style="font-size: 1.125rem; font-weight: 500; margin-bottom: 0.5rem;">Graph visualization temporarily unavailable</h3>
              <p style="font-size: 0.875rem; color: #6b7280;">Unable to initialize WebGL renderer. Try refreshing the page.</p>
            </div>
          `;
        }
      }
    };

    initPixi();

    return () => {
      // Cancel animation frame immediately
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
        animationRef.current = 0;
      }
      
      // Remove wheel event listener before destroying app
      if (appRef.current?.canvas && wheelHandlerRef.current) {
        appRef.current.canvas.removeEventListener('wheel', wheelHandlerRef.current);
        wheelHandlerRef.current = null;
      }
      
      // Clear refs to prevent race conditions
      nodesRef.current.clear();
      edgesRef.current = [];
      containerRef.current = null;
      
      // Destroy PIXI app with a small delay to ensure rendering has stopped
      if (appRef.current) {
        try {
          appRef.current.destroy(true, { children: true, texture: true });
        } catch (e) {
          // Ignore errors during destroy - app may already be destroyed
        }
        appRef.current = null;
      }
      
      // Clean up DOM
      if (canvasRef.current) {
        while (canvasRef.current.firstChild) {
          canvasRef.current.removeChild(canvasRef.current.firstChild);
        }
      }
    };
  }, [people, groups, navigate, showGroups, disablePersonLines, highlightedPersonId, personLineOpacity, groupLineOpacity, personPull, groupPull, anonymizePeople, meData?.id]);

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between gap-2 px-4 py-3 border-b">
        <div>
          <h1 className="text-2xl font-semibold" data-testid="text-page-title">
            Connection Graph
          </h1>
          <p className="text-sm text-muted-foreground">
            Visualize relationships between people
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button 
            variant="ghost" 
            size="icon"
            className="lg:hidden"
            onClick={() => setIsOptionsPanelOpen(!isOptionsPanelOpen)}
            data-testid="button-toggle-options-mobile"
          >
            <Settings className="h-5 w-5" />
          </Button>
          <Button onClick={() => setIsAddDialogOpen(true)} data-testid="button-add-connection">
            <Plus className="h-4 w-4" />
            Add Connection
          </Button>
        </div>
      </div>

      <div className="flex-1 relative bg-background flex">
        {people.length === 0 ? (
          <div className="flex flex-col items-center justify-center flex-1 h-full text-center">
            <h3 className="text-lg font-medium mb-2">No people to display</h3>
            <p className="text-sm text-muted-foreground">
              Add some people to see the connection graph
            </p>
          </div>
        ) : (
          <>
            <div ref={canvasRef} className="flex-1 w-full h-full" />
            <OptionsPanel
              isOpen={isOptionsPanelOpen}
              onOpenChange={setIsOptionsPanelOpen}
              isCollapsed={isSidebarCollapsed}
              onCollapsedChange={setIsSidebarCollapsed}
              showGroups={showGroups}
              onShowGroupsChange={setShowGroups}
              disablePersonLines={disablePersonLines}
              onDisablePersonLinesChange={setDisablePersonLines}
              hideOrphans={hideOrphans}
              onHideOrphansChange={setHideOrphans}
              anonymizePeople={anonymizePeople}
              onAnonymizePeopleChange={setAnonymizePeople}
              highlightedPersonId={highlightedPersonId}
              onHighlightedPersonChange={setHighlightedPersonId}
              people={people}
              personLineOpacity={personLineOpacity}
              onPersonLineOpacityChange={setPersonLineOpacity}
              groupLineOpacity={groupLineOpacity}
              onGroupLineOpacityChange={setGroupLineOpacity}
              personPull={personPull}
              onPersonPullChange={setPersonPull}
              groupPull={groupPull}
              onGroupPullChange={setGroupPull}
            />
          </>
        )}
      </div>

      <AddConnectionDialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen} />
    </div>
  );
}
